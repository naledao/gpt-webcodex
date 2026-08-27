const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');

const { SettingsStore } = require('../src/services/settingsStore');
const { SecretStore } = require('../src/services/secretStore');
const { LogService } = require('../src/services/logService');
const { EnvironmentService } = require('../src/services/environmentService');
const { RuntimeOrchestrator } = require('../src/services/runtimeOrchestrator');
const { BuildVerificationService } = require('../src/services/buildVerificationService');
const { HealthService } = require('../src/services/healthService');
const { UpdateService } = require('../src/services/updateService');
const { resolveProxy, clearProxyCache } = require('../src/services/proxyService');
const { normalize, validateRuntimeSettings } = require('../src/services/config');
const { readJson, writeJsonAtomic } = require('../src/services/jsonStore');

const DEFAULT_HOST = '0.0.0.0';
const HOST = String(process.env.WEB_HOST || DEFAULT_HOST).trim() || DEFAULT_HOST;
const DEFAULT_PORT = 17654;
const DEFAULT_WEB_PASSWORD_HASH = '96326fd1778346db3a14d0758c70c12b98a171b7e2ce5f35293552cad1cd1cc2';
const MAX_BODY_BYTES = 1024 * 1024;
const SESSION_COOKIE_NAME = 'web_mcp_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const CONTEXT_FILE_NAMES = new Set(['AGENTS.md', 'AGENTS.MD', 'CLAUDE.md', 'CLAUDE.MD']);
const SKIPPED_CONTEXT_DIRS = new Set([
  '.git', '.hg', '.svn', '.reference', 'node_modules', 'target', 'dist', 'build',
  '.venv', 'venv', '.tox', '.mypy_cache', '.pytest_cache', '.ruff_cache', '__pycache__'
]);
const MAX_INSTRUCTION_BYTES = 16 * 1024;
const MAX_ROOT_INSTRUCTION_BYTES = 32 * 1024;
const MAX_NESTED_INSTRUCTION_FILES = 64;
const MAX_CONTEXT_SCAN_FILES = 20_000;
const MAX_CONTEXT_SCAN_DEPTH = 12;
const RENDERER_ROOT = process.env.WEB_MCP_RENDERER_ROOT
  ? path.resolve(process.env.WEB_MCP_RENDERER_ROOT)
  : path.resolve(__dirname, '..', 'renderer');
const STATIC_FILES = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/login', 'login.html'],
  ['/login.html', 'login.html'],
  ['/login.js', 'login.js'],
  ['/login.css', 'login.css'],
  ['/app.js', 'app.js'],
  ['/web-api.js', 'web-api.js'],
  ['/styles.css', 'styles.css'],
  ['/settings-compact.css', 'settings-compact.css'],
  ['/theme-bootstrap.js', 'theme-bootstrap.js']
]);
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8'
};

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders
  });
  response.end(body);
}

function sendSuccess(response, data) {
  sendJson(response, 200, { ok: true, data });
}

function sendFailure(response, error, statusCode = 400) {
  sendJson(response, statusCode, { ok: false, error: safeMessage(error) });
}

function redirect(response, location) {
  response.writeHead(302, {
    Location: location,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end();
}

function parseCookies(request) {
  const values = {};
  for (const item of String(request.headers.cookie || '').split(';')) {
    const separator = item.indexOf('=');
    if (separator < 1) continue;
    const name = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (name) values[name] = value;
  }
  return values;
}

function passwordDigest(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function sessionCookie(token, maxAgeSeconds) {
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

async function readJsonBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('请求体过大。');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('请求体必须是有效 JSON。');
  }
}

function workspaceStatePaths(settings) {
  const workspace = String(settings.load().workspace || '').trim();
  if (!workspace) throw new Error('请先填写工作目录。');
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

async function readTaskState(settings) {
  let statePath;
  try { ({ statePath } = workspaceStatePaths(settings)); }
  catch { return { exists: false, state: null }; }
  try {
    const state = JSON.parse(await fsp.readFile(statePath, 'utf8'));
    return { exists: true, statePath, state };
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, statePath, state: null };
    throw new Error(`任务状态读取失败：${safeMessage(error)}`);
  }
}

async function clearTaskState(settings) {
  let paths;
  try { paths = workspaceStatePaths(settings); }
  catch { return false; }
  archiveTask(readJson(paths.statePath, null), paths.historyPath, 'cleared-from-web-manager');
  await fsp.rm(paths.statePath, { force: true });
  return true;
}

async function updateTaskState(settings, action) {
  const { statePath } = workspaceStatePaths(settings);
  const state = readJson(statePath, null);
  if (!state) throw new Error(`当前没有可${action === 'pause' ? '暂停' : action === 'resume' ? '继续' : '停止'}的任务。`);
  if (action === 'pause') {
    state.status = 'paused';
    state.pause_reason = '用户从 Web 管理中心暂停';
  } else if (action === 'resume') {
    state.status = 'active';
    state.pause_reason = '';
  } else {
    state.status = 'stopped';
    state.failure = '用户从 Web 管理中心停止任务';
    state.next_step = state.next_step || '确认后继续当前任务，或开始新任务。';
  }
  state.updated_at = new Date().toISOString();
  writeJsonAtomic(statePath, state);
  return state;
}

async function readTaskHistory(settings) {
  let historyPath;
  try { ({ historyPath } = workspaceStatePaths(settings)); }
  catch { return []; }
  try {
    const value = JSON.parse(await fsp.readFile(historyPath, 'utf8'));
    return Array.isArray(value) ? value.slice(-50).reverse() : [];
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function readPerformance(settings) {
  let performancePath;
  try { ({ performancePath } = workspaceStatePaths(settings)); }
  catch { return null; }
  try { return JSON.parse(await fsp.readFile(performancePath, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

async function clearPerformance(settings) {
  const { performancePath } = workspaceStatePaths(settings);
  await fsp.rm(performancePath, { force: true });
  return true;
}

function decodeUtf8Prefix(buffer) {
  for (let trim = 0; trim <= Math.min(3, buffer.length); trim += 1) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(
        trim ? buffer.subarray(0, buffer.length - trim) : buffer
      );
    }
    catch { /* a byte limit may split the final UTF-8 code point */ }
  }
  throw new Error('文件不是有效 UTF-8 文本。');
}

function readInstructionPreview(file, scope, limit, applicableRoot = '') {
  const absolute = path.resolve(file);
  if (applicableRoot) {
    const resolvedRoot = fs.realpathSync(applicableRoot);
    const resolvedFile = fs.realpathSync(absolute);
    const relative = path.relative(resolvedRoot, resolvedFile);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('路径超出工作区。');
  }
  const stat = fs.statSync(absolute);
  if (!stat.isFile()) throw new Error('路径不是普通文件。');
  const handle = fs.openSync(absolute, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(stat.size, limit + 1));
    const bytesRead = fs.readSync(handle, buffer, 0, buffer.length, 0);
    const truncated = stat.size > limit;
    const content = decodeUtf8Prefix(buffer.subarray(0, Math.min(bytesRead, limit)));
    return {
      scope,
      path: fs.realpathSync(absolute),
      sizeBytes: stat.size,
      loadedBytes: Buffer.byteLength(content),
      truncated,
      status: 'loaded',
      content
    };
  } finally {
    fs.closeSync(handle);
  }
}

function instructionPreview(settingsStore) {
  const current = settingsStore.load();
  const workspace = String(current.workspace || '').trim();
  const result = {
    sharingMode: current.instructionSharingMode || 'metadata',
    workspace,
    files: [],
    warnings: []
  };
  const codexHome = String(process.env.CODEX_HOME || '').trim() || path.join(os.homedir(), '.codex');
  const globalFile = path.join(codexHome, 'AGENTS.md');
  if (fs.existsSync(globalFile)) {
    try { result.files.push(readInstructionPreview(globalFile, 'global', MAX_INSTRUCTION_BYTES)); }
    catch (error) { result.warnings.push({ scope: 'global', path: globalFile, status: 'unavailable', message: safeMessage(error) }); }
  }
  if (!workspace || !fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) return result;

  const resolvedRoot = fs.realpathSync(workspace);
  let rootBudget = MAX_ROOT_INSTRUCTION_BYTES;
  for (const name of [...CONTEXT_FILE_NAMES].sort()) {
    const file = path.join(resolvedRoot, name);
    if (!fs.existsSync(file)) continue;
    const budget = Math.min(MAX_INSTRUCTION_BYTES, rootBudget);
    if (budget <= 0) {
      result.warnings.push({ scope: 'project_root', path: file, status: 'unavailable', message: '项目根规则总字节上限已达到。' });
      continue;
    }
    try {
      const item = readInstructionPreview(file, 'project_root', budget, resolvedRoot);
      result.files.push(item);
      rootBudget -= item.loadedBytes;
    } catch (error) {
      result.warnings.push({ scope: 'project_root', path: file, status: 'unavailable', message: safeMessage(error) });
    }
  }

  let scanned = 0;
  const nested = [];
  const visit = (directory, depth) => {
    if (depth > MAX_CONTEXT_SCAN_DEPTH || nested.length > MAX_NESTED_INSTRUCTION_FILES || scanned > MAX_CONTEXT_SCAN_FILES) return;
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); }
    catch (error) { result.warnings.push({ scope: 'scan', path: directory, status: 'unavailable', message: safeMessage(error) }); return; }
    for (const entry of entries) {
      scanned += 1;
      if (scanned > MAX_CONTEXT_SCAN_FILES) return;
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory() && !SKIPPED_CONTEXT_DIRS.has(entry.name)) visit(candidate, depth + 1);
      if (!CONTEXT_FILE_NAMES.has(entry.name) || directory === resolvedRoot) continue;
      nested.push(candidate);
      if (nested.length > MAX_NESTED_INSTRUCTION_FILES) return;
    }
  };
  visit(resolvedRoot, 0);
  if (scanned > MAX_CONTEXT_SCAN_FILES) result.warnings.push({ scope: 'scan', path: resolvedRoot, status: 'truncated', message: `扫描在 ${MAX_CONTEXT_SCAN_FILES} 个文件后停止。` });
  if (nested.length > MAX_NESTED_INSTRUCTION_FILES) result.warnings.push({ scope: 'nested', path: resolvedRoot, status: 'truncated', message: `嵌套规则列表已限制为 ${MAX_NESTED_INSTRUCTION_FILES} 个文件。` });
  for (const file of nested.slice(0, MAX_NESTED_INSTRUCTION_FILES)) {
    try {
      if (fs.lstatSync(file).isSymbolicLink()) throw new Error('嵌套规则不允许使用符号链接。');
      result.files.push(readInstructionPreview(file, 'nested', MAX_INSTRUCTION_BYTES, resolvedRoot));
    } catch (error) {
      result.warnings.push({ scope: 'nested', path: file, status: 'unavailable', message: safeMessage(error) });
    }
  }
  return result;
}

function createApplication(options = {}) {
  const configuredPassword = options.authPassword;
  if (configuredPassword !== undefined && !String(configuredPassword)) throw new Error('Web 管理密码不能为空。');
  const authPasswordHash = configuredPassword === undefined
    ? Buffer.from(DEFAULT_WEB_PASSWORD_HASH, 'hex')
    : passwordDigest(configuredPassword);
  const sessions = new Map();
  const sseClients = new Set();
  const broadcast = (eventName, payload) => {
    const packet = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const response of [...sseClients]) {
      try { response.write(packet); }
      catch { sseClients.delete(response); }
    }
  };

  const settings = new SettingsStore();
  const secrets = new SecretStore();
  const log = new LogService();
  const environment = new EnvironmentService();
  const orchestrator = new RuntimeOrchestrator({
    settings,
    secrets,
    environment,
    log,
    emitProgress: (payload) => broadcast('runtime:progress', payload),
    emitStatus: (payload) => broadcast('runtime:status', payload)
  });
  const buildVerification = new BuildVerificationService(log, (payload) => broadcast('build:progress', payload));
  const healthService = new HealthService({ settings, secrets, environment, orchestrator });
  const updateService = options.updateService || new UpdateService({
    settingsStore: settings,
    log,
    emitProgress: (payload) => broadcast('update:progress', payload)
  });
  let updateBusy = false;
  let updateShutdown = async () => {};
  log.on('entry', (payload) => broadcast('logs:entry', payload));

  async function runUpdate(action) {
    if (updateBusy) throw new Error('已有更新操作正在进行，请等待完成。');
    updateBusy = true;
    try { return await action(); }
    finally { updateBusy = false; }
  }

  function cleanupSessions() {
    const now = Date.now();
    for (const [token, expiresAt] of sessions) {
      if (expiresAt <= now) sessions.delete(token);
    }
  }

  function currentSessionToken(request) {
    return parseCookies(request)[SESSION_COOKIE_NAME] || '';
  }

  function isAuthenticated(request) {
    cleanupSessions();
    const token = currentSessionToken(request);
    const expiresAt = sessions.get(token) || 0;
    if (!token || expiresAt <= Date.now()) {
      if (token) sessions.delete(token);
      return false;
    }
    return true;
  }

  async function login(request, response) {
    if (request.method !== 'POST') return sendFailure(response, '不支持该请求方法。', 405);
    const body = await readJsonBody(request);
    if (!crypto.timingSafeEqual(passwordDigest(body.password || ''), authPasswordHash)) {
      return sendFailure(response, '密码错误。', 401);
    }
    cleanupSessions();
    while (sessions.size >= 128) sessions.delete(sessions.keys().next().value);
    const token = crypto.randomBytes(32).toString('base64url');
    sessions.set(token, Date.now() + SESSION_TTL_MS);
    return sendJson(response, 200, { ok: true, data: true }, {
      'Set-Cookie': sessionCookie(token, Math.floor(SESSION_TTL_MS / 1000))
    });
  }

  function logout(request, response) {
    const token = currentSessionToken(request);
    if (token) sessions.delete(token);
    return sendJson(response, 200, { ok: true, data: true }, {
      'Set-Cookie': sessionCookie('', 0)
    });
  }

  async function handleApi(request, response, pathname) {
    const method = request.method || 'GET';
    if (method === 'GET' && pathname === '/api/snapshot') return sendSuccess(response, await orchestrator.snapshot());
    if (method === 'GET' && pathname === '/api/instructions/preview') return sendSuccess(response, instructionPreview(settings));
    if (method === 'POST' && pathname === '/api/settings') {
      const body = await readJsonBody(request);
      const allowed = new Set([
        'permissionMode', 'toolMode', 'mcpPort', 'healthPort', 'proxyMode', 'proxyUrl',
        'tunnelId', 'tunnelProfile', 'autoStartServices', 'progressReportSeconds',
        'theme', 'guideProgress', 'firstRunCompleted', 'instructionSharingMode'
      ]);
      const clean = Object.fromEntries(Object.entries(body || {}).filter(([key]) => allowed.has(key)));
      const candidate = normalize({ ...settings.load(), ...clean });
      validateRuntimeSettings(candidate);
      const saved = settings.save(clean);
      clearProxyCache();
      orchestrator.invalidateSnapshot();
      return sendSuccess(response, saved);
    }
    if (method === 'POST' && pathname === '/api/workspace/switch') {
      const body = await readJsonBody(request);
      return sendSuccess(response, await orchestrator.switchWorkspace(body.workspace));
    }
    if (method === 'POST' && pathname === '/api/workspace/roots') {
      const body = await readJsonBody(request);
      return sendSuccess(response, await orchestrator.updateAuthorizedRoots(body.roots));
    }
    if (method === 'POST' && pathname === '/api/secrets/runtime-key') {
      const body = await readJsonBody(request);
      if (String(body.value || '').trim().length < 12) throw new Error('Runtime API Key 长度不正确。');
      secrets.set('runtimeApiKey', body.value);
      orchestrator.invalidateSnapshot();
      return sendSuccess(response, secrets.status());
    }
    if (method === 'DELETE' && pathname === '/api/secrets/runtime-key') {
      secrets.remove('runtimeApiKey');
      orchestrator.invalidateSnapshot();
      return sendSuccess(response, secrets.status());
    }
    if (method === 'POST' && pathname === '/api/secrets/mcp-token/regenerate') {
      secrets.set('mcpAuthToken', crypto.randomBytes(32).toString('base64url'));
      orchestrator.invalidateSnapshot();
      return sendSuccess(response, secrets.status());
    }
    if (method === 'POST' && pathname === '/api/runtime/start') return sendSuccess(response, await orchestrator.start());
    if (method === 'POST' && pathname === '/api/runtime/stop') return sendSuccess(response, await orchestrator.stop());
    if (method === 'POST' && pathname === '/api/runtime/restart') return sendSuccess(response, await orchestrator.restart());
    if (method === 'GET' && pathname === '/api/logs') return sendSuccess(response, log.read());
    if (method === 'DELETE' && pathname === '/api/logs') { log.clear(); return sendSuccess(response, true); }
    if (method === 'GET' && pathname === '/api/task-state') return sendSuccess(response, await readTaskState(settings));
    if (method === 'DELETE' && pathname === '/api/task-state') return sendSuccess(response, await clearTaskState(settings));
    if (method === 'POST' && pathname === '/api/task-state/pause') return sendSuccess(response, await updateTaskState(settings, 'pause'));
    if (method === 'POST' && pathname === '/api/task-state/resume') return sendSuccess(response, await updateTaskState(settings, 'resume'));
    if (method === 'POST' && pathname === '/api/task-state/stop') return sendSuccess(response, await updateTaskState(settings, 'stop'));
    if (method === 'GET' && pathname === '/api/task-history') return sendSuccess(response, await readTaskHistory(settings));
    if (method === 'GET' && pathname === '/api/performance') return sendSuccess(response, await readPerformance(settings));
    if (method === 'DELETE' && pathname === '/api/performance') return sendSuccess(response, await clearPerformance(settings));
    if (method === 'GET' && pathname === '/api/build') return sendSuccess(response, buildVerification.inspect(settings.load().workspace));
    if (method === 'POST' && pathname === '/api/build/run') return sendSuccess(response, await buildVerification.execute(settings.load().workspace, await readJsonBody(request)));
    if (method === 'GET' && pathname === '/api/health') return sendSuccess(response, await healthService.inspect());
    if (method === 'POST' && pathname === '/api/health/repair') return sendSuccess(response, await healthService.repair());
    if (method === 'POST' && pathname === '/api/proxy/detect') return sendSuccess(response, await resolveProxy(settings.load(), { force: true }));
    if (method === 'GET' && pathname === '/api/update/status') return sendSuccess(response, await updateService.status());
    if (method === 'POST' && pathname === '/api/update/check') return sendSuccess(response, await runUpdate(() => updateService.check({ force: true })));
    if (method === 'POST' && pathname === '/api/update/download') return sendSuccess(response, await runUpdate(() => updateService.download()));
    if (method === 'POST' && pathname === '/api/update/apply') {
      const result = await runUpdate(() => updateService.install({ restart: true }));
      sendSuccess(response, result);
      setTimeout(() => updateShutdown().catch((error) => {
        log.error('更新已安装，但旧版 Web 服务退出失败', { message: safeMessage(error) });
      }), 250);
      return;
    }
    return sendFailure(response, '接口不存在。', 404);
  }

  async function serveStatic(request, response, pathname) {
    if (!['GET', 'HEAD'].includes(request.method || 'GET')) return sendFailure(response, '不支持该请求方法。', 405);
    const relative = STATIC_FILES.get(pathname);
    if (!relative) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not Found');
      return;
    }
    const file = path.join(RENDERER_ROOT, relative);
    const data = await fsp.readFile(file);
    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(file)] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY'
    });
    if (request.method === 'HEAD') response.end();
    else response.end(data);
  }

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://localhost');
      const publicStatic = new Set(['/login', '/login.html', '/login.js', '/login.css']);
      if (url.pathname === '/api/auth/login') return await login(request, response);
      if (publicStatic.has(url.pathname)) {
        if (isAuthenticated(request) && ['/login', '/login.html'].includes(url.pathname)) return redirect(response, '/');
        return await serveStatic(request, response, url.pathname);
      }
      if (!isAuthenticated(request)) {
        if (url.pathname.startsWith('/api/')) return sendFailure(response, '请先输入访问密码。', 401);
        return redirect(response, '/login');
      }
      if (url.pathname === '/api/auth/logout') {
        if (request.method !== 'POST') return sendFailure(response, '不支持该请求方法。', 405);
        return logout(request, response);
      }
      if (request.method === 'GET' && url.pathname === '/api/events') {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no'
        });
        response.write('retry: 3000\n: connected\n\n');
        sseClients.add(response);
        request.on('close', () => sseClients.delete(response));
        return;
      }
      if (url.pathname.startsWith('/api/')) return await handleApi(request, response, url.pathname);
      return await serveStatic(request, response, url.pathname);
    } catch (error) {
      if (!response.headersSent) sendFailure(response, error);
      else response.end();
    }
  });

  return {
    server,
    settings,
    secrets,
    log,
    environment,
    orchestrator,
    buildVerification,
    healthService,
    updateService,
    sseClients,
    broadcast,
    setUpdateShutdown: (handler) => { updateShutdown = handler; }
  };
}

async function startServer(options = {}) {
  const authPassword = options.password ?? process.env.WEB_PASSWORD;
  const app = createApplication({ authPassword, updateService: options.updateService });
  const requestedHost = String(options.host ?? process.env.WEB_HOST ?? DEFAULT_HOST).trim() || DEFAULT_HOST;
  const requestedPort = options.port ?? Number(process.env.WEB_PORT || DEFAULT_PORT);
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(requestedPort, requestedHost, resolve);
  });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : requestedPort;

  const heartbeat = setInterval(() => {
    app.orchestrator.supervise()
      .then((status) => app.broadcast('runtime:heartbeat', status))
      .catch((error) => app.log.warn('运行状态检查失败', { message: safeMessage(error) }));
  }, 5000);
  heartbeat.unref();

  app.log.info('Linux Web 管理服务已启动', { host: requestedHost, port });
  console.log(`Web manager listening on http://${requestedHost}:${port}`);

  if (app.settings.load().autoStartServices && !app.orchestrator.isManuallyStopped()) {
    app.orchestrator.start({ automatic: true }).catch((error) => app.log.error(error.message, { stage: 'auto-start' }));
  }

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    clearInterval(heartbeat);
    for (const client of app.sseClients) client.end();
    app.sseClients.clear();
    await Promise.allSettled([app.orchestrator.tunnel.stop(), app.orchestrator.native.stop()]);
    await new Promise((resolve) => app.server.close(resolve));
  };
  app.setUpdateShutdown(async () => {
    await close();
    if (typeof options.exitForUpdate === 'function') await options.exitForUpdate(0);
    else process.exit(0);
  });
  return { ...app, port, host: requestedHost, close };
}

if (require.main === module) {
  let running;
  startServer().then((instance) => { running = instance; }).catch((error) => {
    console.error(safeMessage(error));
    process.exitCode = 1;
  });
  const shutdown = async () => {
    try { if (running) await running.close(); }
    finally { process.exit(0); }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

module.exports = { HOST, DEFAULT_HOST, DEFAULT_PORT, createApplication, startServer, workspaceStatePaths };
