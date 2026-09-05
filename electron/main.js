const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { app, BrowserWindow, dialog, ipcMain, shell, Tray, Menu, nativeImage, session } = require('electron');
const { SettingsStore } = require('./services/settingsStore');
const { SecretStore } = require('./services/secretStore');
const { LogService } = require('./services/logService');
const { EnvironmentService } = require('./services/environmentService');
const { RuntimeOrchestrator } = require('./services/runtimeOrchestrator');
const { run } = require('./services/commandRunner');
const { resolveProxy, clearProxyCache } = require('./services/proxyService');
const { BuildVerificationService } = require('./services/buildVerificationService');
const { HealthService } = require('./services/healthService');
const { UpdateService, AUTOMATIC_CHECK_INTERVAL_MS } = require('./services/updateService');
const { readJson, writeJsonAtomic } = require('./services/jsonStore');
const { updateStateFile } = require('./paths');

let managerWindow;
let orchestrator;
let forceQuit = false;
let tray = null;
let buildVerification;
let healthService;
let updateService;
const settings = new SettingsStore();
const secrets = new SecretStore();
const log = new LogService();
const environment = new EnvironmentService();

function appIconPath() {
  return path.join(__dirname, 'app-icon.png');
}

function sendManager(channel, payload) {
  if (managerWindow && !managerWindow.isDestroyed()) managerWindow.webContents.send(channel, payload);
}

function scheduleAutomaticUpdateChecks() {
  if (!updateService?.status().canUpdate) return;
  const check = () => {
    const state = updateService.status();
    if (state.busy || state.downloaded) return;
    updateService.check().catch((error) => {
      log.warn(`自动更新检查未完成：${safeMessage(error)}`, { stage: 'update-auto-check' });
    });
  };
  const initial = setTimeout(check, 20_000);
  const interval = setInterval(check, AUTOMATIC_CHECK_INTERVAL_MS);
  initial.unref();
  interval.unref();
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function assertTrustedIpc(event) {
  const url = event.senderFrame?.url || event.sender?.getURL?.() || '';
  if (!url.startsWith('file://')) throw new Error('已阻止来自非本地页面的 IPC 调用。');
}

function secureHandle(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedIpc(event);
    return handler(event, ...args);
  });
}

function workspaceStatePaths() {
  const workspace = String(settings.load().workspace || '').trim();
  if (!workspace) throw new Error('请先选择工作目录。');
  const root = path.resolve(workspace);
  return {
    root,
    statePath: path.join(root, '.coding-tools', 'task-state.json'),
    historyPath: path.join(root, '.coding-tools', 'task-history.json'),
    performancePath: path.join(root, '.coding-tools', 'performance.json')
  };
}

function archiveTask(state, historyPath, reason) {
  if (!state || typeof state !== 'object' || (!state.task_id && !state.objective)) return;
  const history = readJson(historyPath, []);
  const items = Array.isArray(history) ? history : [];
  items.push({ ...state, archived_at: new Date().toISOString(), archive_reason: reason });
  writeJsonAtomic(historyPath, items.slice(-100));
}

async function invokeSafely(action) {
  try { return { ok: true, data: await action() }; }
  catch (error) { return { ok: false, error: safeMessage(error) }; }
}

function createTray() {
  if (tray && !tray.isDestroyed()) return tray;
  const icon = nativeImage.createFromPath(appIconPath()).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('网页 MCP 助手 · 后台运行中');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开管理中心', click: () => openManagerWindow() },
    { type: 'separator' },
    { label: '退出助手（保留 MCP 服务）', click: () => { forceQuit = true; app.quit(); } }
  ]));
  tray.on('click', () => openManagerWindow());
  tray.on('double-click', () => openManagerWindow());
  return tray;
}

function openManagerWindow() {
  if (managerWindow && !managerWindow.isDestroyed()) {
    managerWindow.show();
    managerWindow.focus();
    return managerWindow;
  }

  const width = 980;
  const height = 720;

  managerWindow = new BrowserWindow({
    width,
    height,
    minWidth: 820,
    minHeight: 580,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#f7f7f8',
    title: '网页 MCP 助手 · 管理中心',
    icon: appIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  managerWindow.removeMenu();
  const initialTheme = settings.load().theme === 'light' ? 'light' : 'dark';
  managerWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { query: { theme: initialTheme } });
  managerWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  managerWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://')) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url).catch(() => {});
  });
  managerWindow.once('ready-to-show', () => managerWindow.show());
  managerWindow.on('close', (event) => {
    if (forceQuit) return;
    event.preventDefault();
    if (settings.load().keepRunningOnClose) {
      managerWindow.hide();
      return;
    }
    if (!orchestrator) {
      forceQuit = true;
      app.quit();
      return;
    }
    orchestrator.stop().catch((error) => log.error(error.message, { stage: 'close' })).finally(() => {
      forceQuit = true;
      app.quit();
    });
  });
  managerWindow.on('closed', () => { managerWindow = null; });
  return managerWindow;
}

function registerIpc() {
  secureHandle('app:snapshot', (_event, options) => invokeSafely(() => orchestrator.snapshot(options || {})));
  secureHandle('workspace:switch', (_event, workspace) => invokeSafely(() => orchestrator.switchWorkspace(workspace)));
  secureHandle('workspace:authorized-roots', (_event, roots) => invokeSafely(() => orchestrator.updateAuthorizedRoots(roots)));
  secureHandle('workspace:allow-all-directories', (_event, enabled) => invokeSafely(() => orchestrator.setAllowAllDirectories(enabled)));
  secureHandle('task-state:read', () => invokeSafely(async () => {
    let statePath;
    try { ({ statePath } = workspaceStatePaths()); } catch { return { exists: false, state: null }; }
    try {
      const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
      return { exists: true, statePath, state };
    } catch (error) {
      if (error?.code === 'ENOENT') return { exists: false, statePath, state: null };
      throw new Error(`任务状态读取失败：${safeMessage(error)}`);
    }
  }));
  secureHandle('task-state:clear', () => invokeSafely(async () => {
    let paths;
    try { paths = workspaceStatePaths(); } catch { return false; }
    const { statePath, historyPath } = paths;
    archiveTask(readJson(statePath, null), historyPath, 'cleared-from-assistant');
    await fs.unlink(statePath).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
    return true;
  }));
  secureHandle('task-state:pause', () => invokeSafely(async () => {
    const { statePath } = workspaceStatePaths();
    const state = readJson(statePath, null); if (!state) throw new Error('当前没有可暂停的任务。');
    state.status = 'paused'; state.pause_reason = '用户从助手暂停'; state.updated_at = new Date().toISOString();
    writeJsonAtomic(statePath, state); return state;
  }));
  secureHandle('task-state:resume', () => invokeSafely(async () => {
    const { statePath } = workspaceStatePaths();
    const state = readJson(statePath, null); if (!state) throw new Error('当前没有可继续的任务。');
    state.status = 'active'; state.pause_reason = ''; state.updated_at = new Date().toISOString();
    writeJsonAtomic(statePath, state); return state;
  }));
  secureHandle('task-state:stop', () => invokeSafely(async () => {
    const { statePath } = workspaceStatePaths();
    const state = readJson(statePath, null); if (!state) throw new Error('当前没有可停止的任务。');
    state.status = 'stopped'; state.failure = '用户从助手停止任务';
    state.next_step = state.next_step || '确认后继续当前任务，或开始新任务。';
    state.updated_at = new Date().toISOString();
    writeJsonAtomic(statePath, state); return state;
  }));
  secureHandle('task-state:history', () => invokeSafely(async () => {
    let historyPath;
    try { ({ historyPath } = workspaceStatePaths()); } catch { return []; }
    try { const value = JSON.parse(await fs.readFile(historyPath, 'utf8')); return Array.isArray(value) ? value.slice(-50).reverse() : []; }
    catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
  }));
  secureHandle('performance:read', () => invokeSafely(async () => {
    let performancePath;
    try { ({ performancePath } = workspaceStatePaths()); } catch { return null; }
    try { return JSON.parse(await fs.readFile(performancePath, 'utf8')); }
    catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
  }));
  secureHandle('performance:clear', () => invokeSafely(async () => {
    const { performancePath } = workspaceStatePaths();
    await fs.rm(performancePath, { force: true });
    return true;
  }));
  secureHandle('build:inspect', () => invokeSafely(() => buildVerification.inspect(settings.load().workspace)));
  secureHandle('build:run', (_event, options) => invokeSafely(() => buildVerification.execute(settings.load().workspace, options || {})));
  secureHandle('health:inspect', () => invokeSafely(() => healthService.inspect()));
  secureHandle('health:repair', () => invokeSafely(() => healthService.repair()));
  secureHandle('update:status', () => invokeSafely(async () => updateService.status()));
  secureHandle('update:check', () => invokeSafely(() => updateService.check()));
  secureHandle('update:download', () => invokeSafely(() => updateService.download()));
  secureHandle('update:install', () => invokeSafely(() => updateService.install()));
  secureHandle('manager:close', () => invokeSafely(async () => {
    if (managerWindow && !managerWindow.isDestroyed()) setImmediate(() => managerWindow?.close());
    return true;
  }));
  secureHandle('dialog:workspace', () => invokeSafely(async () => {
    const result = await dialog.showOpenDialog(managerWindow, { properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? '' : result.filePaths[0];
  }));
  secureHandle('settings:save', (_event, patch) => invokeSafely(async () => {
    const allowed = ['permissionMode', 'toolMode', 'globalAgentsEnabled', 'allowAllDirectories', 'mcpPort', 'healthPort', 'proxyMode', 'proxyUrl', 'tunnelId', 'tunnelProfile', 'startWithWindows', 'autoStartServices', 'keepRunningOnClose', 'progressReportSeconds', 'theme', 'guideProgress', 'firstRunCompleted'];
    const clean = Object.fromEntries(Object.entries(patch || {}).filter(([key]) => allowed.includes(key)));
    const saved = settings.save(clean);
    if (Object.hasOwn(clean, 'startWithWindows')) {
      app.setLoginItemSettings({ openAtLogin: Boolean(saved.startWithWindows), path: process.execPath });
    }
    clearProxyCache();
    return saved;
  }));
  secureHandle('environment:detect-proxy', () => invokeSafely(async () => resolveProxy(settings.load(), { force: true })));
  secureHandle('secrets:runtime-key', (_event, value) => invokeSafely(async () => {
    if (String(value || '').trim().length < 12) throw new Error('Runtime API Key 长度不正确。');
    secrets.set('runtimeApiKey', value);
    return secrets.status();
  }));
  secureHandle('secrets:runtime-key-remove', () => invokeSafely(async () => {
    secrets.remove('runtimeApiKey');
    return secrets.status();
  }));
  secureHandle('secrets:mcp-token-regenerate', () => invokeSafely(async () => {
    secrets.set('mcpAuthToken', crypto.randomBytes(32).toString('base64url'));
    return secrets.status();
  }));
  secureHandle('runtime:start', () => invokeSafely(() => orchestrator.start()));
  secureHandle('runtime:stop', () => invokeSafely(() => orchestrator.stop()));
  secureHandle('runtime:restart', () => invokeSafely(() => orchestrator.restart()));
  secureHandle('logs:read', () => invokeSafely(async () => log.read()));
  secureHandle('logs:clear', () => invokeSafely(async () => { log.clear(); return true; }));
  secureHandle('environment:install-python', () => invokeSafely(async () => {
    const result = await run('winget.exe', ['install', '--id', 'Python.Python.3.12', '-e', '--accept-source-agreements', '--accept-package-agreements']);
    return result.stdout;
  }));
  secureHandle('shell:open', (_event, target) => invokeSafely(async () => {
    const allowed = new Set(['chatgpt-connectors', 'openai-tunnels', 'openai-runtime-keys', 'tunnel-ui', 'coding-tools-source', 'app-releases']);
    if (!allowed.has(target)) throw new Error('不允许打开该地址。');
    const current = settings.load();
    const urls = {
      'chatgpt-connectors': 'https://chatgpt.com/#settings/Connectors',
      'openai-tunnels': 'https://platform.openai.com/settings/organization/tunnels',
      'openai-runtime-keys': 'https://platform.openai.com/settings/organization/api-keys',
      'tunnel-ui': `http://127.0.0.1:${current.healthPort}/ui`,
      'coding-tools-source': 'https://github.com/xyTom/coding-tools-mcp',
      'app-releases': 'https://github.com/naledao/gpt-webcodex/releases'
    };
    await shell.openExternal(urls[target]);
    return true;
  }));
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
app.on('second-instance', () => openManagerWindow());

app.whenReady().then(async () => {
  app.setLoginItemSettings({ openAtLogin: Boolean(settings.load().startWithWindows), path: process.execPath });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
  createTray();
  orchestrator = new RuntimeOrchestrator({
    settings,
    secrets,
    environment,
    log,
    emitProgress: (payload) => sendManager('runtime:progress', payload),
    emitStatus: (payload) => sendManager('runtime:status-changed', payload)
  });
  buildVerification = new BuildVerificationService(log, (payload) => sendManager('build:progress', payload));
  healthService = new HealthService({ settings, secrets, environment, orchestrator });
  updateService = new UpdateService({
    currentVersion: app.getVersion(),
    platform: process.platform,
    architecture: process.arch,
    isPackaged: app.isPackaged,
    settingsStore: settings,
    log,
    emitState: (payload) => sendManager('update:state-changed', payload),
    runtimeStatus: () => orchestrator.snapshot({ force: true }),
    stopRuntime: () => orchestrator.stop({ manual: false }),
    markQuit: () => { forceQuit = true; },
    resumeStateFile: updateStateFile()
  });
  log.on('entry', (payload) => sendManager('logs:entry', payload));
  registerIpc();
  openManagerWindow();
  setInterval(() => orchestrator.supervise().then((status) => {
    sendManager('runtime:heartbeat', status);
  }).catch(() => {}), 5000).unref();
  log.info('网页 MCP 助手已启动');
  const resumeServicesAfterUpdate = updateService.hasResumeServicesIntent();
  if (resumeServicesAfterUpdate || (settings.load().autoStartServices && !orchestrator.isManuallyStopped())) {
    orchestrator.start({ automatic: true })
      .then(() => { if (resumeServicesAfterUpdate) updateService.clearResumeServicesIntent(); })
      .catch((error) => log.error(error.message, { stage: 'auto-start' }));
  }
  scheduleAutomaticUpdateChecks();
});

app.on('before-quit', () => { forceQuit = true; });
app.on('window-all-closed', () => {
  if (!forceQuit && settings.load().keepRunningOnClose) return;
  if (!forceQuit) app.quit();
});
app.on('activate', () => openManagerWindow());






