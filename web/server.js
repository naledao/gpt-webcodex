const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const { SettingsStore } = require('../src/services/settingsStore');
const { SecretStore } = require('../src/services/secretStore');
const { LogService } = require('../src/services/logService');
const { EnvironmentService } = require('../src/services/environmentService');
const { RuntimeOrchestrator } = require('../src/services/runtimeOrchestrator');
const { BuildVerificationService } = require('../src/services/buildVerificationService');
const { HealthService } = require('../src/services/healthService');
const { resolveProxy, clearProxyCache } = require('../src/services/proxyService');
const { normalize, validateRuntimeSettings } = require('../src/services/config');
const { readJson, writeJsonAtomic } = require('../src/services/jsonStore');

const HOST = '127.0.0.1';
const DEFAULT_PORT = 17654;
const MAX_BODY_BYTES = 1024 * 1024;
const RENDERER_ROOT = path.resolve(__dirname, '..', 'renderer');
const STATIC_FILES = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
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

function sendJson(response, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(body);
}

function sendSuccess(response, data) {
  sendJson(response, 200, { ok: true, data });
}

function sendFailure(response, error, statusCode = 400) {
  sendJson(response, statusCode, { ok: false, error: safeMessage(error) });
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

function createApplication() {
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
  log.on('entry', (payload) => broadcast('logs:entry', payload));

  async function handleApi(request, response, pathname) {
    const method = request.method || 'GET';
    if (method === 'GET' && pathname === '/api/snapshot') return sendSuccess(response, await orchestrator.snapshot());
    if (method === 'POST' && pathname === '/api/settings') {
      const body = await readJsonBody(request);
      const allowed = new Set([
        'permissionMode', 'toolMode', 'mcpPort', 'healthPort', 'proxyMode', 'proxyUrl',
        'tunnelId', 'tunnelProfile', 'autoStartServices', 'progressReportSeconds',
        'theme', 'guideProgress', 'firstRunCompleted'
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
      const url = new URL(request.url || '/', `http://${HOST}`);
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

  return { server, settings, secrets, log, environment, orchestrator, buildVerification, healthService, sseClients, broadcast };
}

async function startServer(options = {}) {
  const app = createApplication();
  const requestedPort = options.port ?? Number(process.env.WEB_PORT || DEFAULT_PORT);
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(requestedPort, HOST, resolve);
  });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : requestedPort;

  const heartbeat = setInterval(() => {
    app.orchestrator.supervise()
      .then((status) => app.broadcast('runtime:heartbeat', status))
      .catch((error) => app.log.warn('运行状态检查失败', { message: safeMessage(error) }));
  }, 5000);
  heartbeat.unref();

  app.log.info('Linux Web 管理服务已启动', { host: HOST, port });
  console.log(`Web manager listening on http://${HOST}:${port}`);

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
  return { ...app, port, host: HOST, close };
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

module.exports = { HOST, DEFAULT_PORT, createApplication, startServer, workspaceStatePaths };
