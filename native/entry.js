const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { getAsset, getAssetKeys, isSea } = require('node:sea');

const UPDATE_HELPER_FLAG = '--web-mcp-update-restart-helper';

const BUILD_ID = typeof NATIVE_BUILD_ID === 'string' ? NATIVE_BUILD_ID : 'development';
const ASSET_PREFIXES = ['renderer/', 'resources/'];

function cacheBase() {
  if (process.env.WEB_MCP_NATIVE_CACHE) return path.resolve(process.env.WEB_MCP_NATIVE_CACHE);
  const xdgCache = process.env.XDG_CACHE_HOME
    ? path.resolve(process.env.XDG_CACHE_HOME)
    : path.join(os.homedir(), '.cache');
  return path.join(xdgCache, 'web-mcp-assistant', 'native');
}

function safeAssetKey(key) {
  const normalized = path.posix.normalize(String(key || ''));
  if (!ASSET_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return '';
  if (normalized.startsWith('/') || normalized.includes('../')) return '';
  return normalized;
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(directory, 0o700); } catch { /* best effort */ }
}

function extractAssets() {
  if (!isSea()) return null;
  if (!/^[a-f0-9]{16,64}$/.test(BUILD_ID)) throw new Error('Invalid native build identifier.');

  const root = path.join(cacheBase(), BUILD_ID);
  const marker = path.join(root, '.complete');
  const tunnel = process.arch === 'arm64'
    ? path.join(root, 'resources', 'tools', 'tunnel-client-linux-arm64')
    : path.join(root, 'resources', 'tools', 'tunnel-client');
  const required = [
    path.join(root, 'renderer', 'index.html'),
    path.join(root, 'resources', 'coding-tools-mcp', 'coding_tools_mcp', '__main__.py'),
    tunnel
  ];
  const ready = fs.existsSync(marker) && required.every((file) => fs.existsSync(file));

  if (!ready) {
    ensureDirectory(root);
    for (const originalKey of getAssetKeys()) {
      const key = safeAssetKey(originalKey);
      if (!key) continue;
      const destination = path.join(root, ...key.split('/'));
      ensureDirectory(path.dirname(destination));
      const mode = key.startsWith('resources/tools/tunnel-client') ? 0o700 : 0o600;
      const temporary = `${destination}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, Buffer.from(getAsset(originalKey)), { mode });
      fs.renameSync(temporary, destination);
      try { fs.chmodSync(destination, mode); } catch { /* best effort */ }
    }
    fs.writeFileSync(marker, `${BUILD_ID}\n`, { mode: 0o600 });
  }

  if (!fs.existsSync(tunnel)) throw new Error(`Bundled tunnel-client is missing for ${process.arch}.`);
  try { fs.chmodSync(tunnel, 0o700); } catch { /* best effort */ }

  process.env.WEB_MCP_RENDERER_ROOT = path.join(root, 'renderer');
  process.env.WEB_MCP_RESOURCES_ROOT = path.join(root, 'resources');
  return root;
}

function processIsRunning(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function processStartTime(pid) {
  const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
  const tail = raw.slice(raw.lastIndexOf(') ') + 2).trim().split(/\s+/);
  if (tail.length < 20 || !/^\d+$/.test(tail[19])) throw new Error('无法读取更新后进程的启动时间。');
  return tail[19];
}

function replaceManagerTracking(directory, expectedPid, nextPid) {
  if (!directory || !path.isAbsolute(directory)) return;
  const pidFile = path.join(directory, 'web-manager.pid');
  const startTimeFile = path.join(directory, 'web-manager.start-time');
  let tracked = '';
  try { tracked = fs.readFileSync(pidFile, 'utf8').trim(); } catch { return; }
  if (tracked !== String(expectedPid)) return;
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(pidFile, `${nextPid}\n`, { mode: 0o600 });
  fs.writeFileSync(startTimeFile, `${processStartTime(nextPid)}\n`, { mode: 0o600 });
}

function updateManagerTracking(directory, oldPid) {
  replaceManagerTracking(directory, oldPid, process.pid);
}

function writeUpdateState(file, patch) {
  if (!file || !path.isAbsolute(file)) return;
  let current = {};
  try { current = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* start a new status file */ }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({ ...current, ...patch, updatedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function decodeHelperPayload(encoded) {
  let payload;
  try { payload = JSON.parse(Buffer.from(String(encoded || ''), 'base64url').toString('utf8')); }
  catch { throw new Error('更新重启参数无效。'); }
  const managerStateDir = path.resolve(String(payload.managerStateDir || ''));
  const stateFile = path.resolve(String(payload.stateFile || ''));
  const readyFile = path.resolve(String(payload.readyFile || ''));
  const backup = path.resolve(String(payload.backup || ''));
  const executable = path.resolve(process.execPath);
  if (!Number.isInteger(payload.oldPid) || payload.oldPid < 2 || payload.oldPid === process.pid) throw new Error('待退出进程 PID 无效。');
  if (!path.isAbsolute(payload.managerStateDir || '') || !path.isAbsolute(payload.stateFile || '') || !path.isAbsolute(payload.readyFile || '')) {
    throw new Error('更新重启路径必须是绝对路径。');
  }
  const statePrefix = `${managerStateDir}${path.sep}`;
  if (!stateFile.startsWith(statePrefix) || !readyFile.startsWith(statePrefix)) throw new Error('更新状态路径超出应用状态目录。');
  if (backup !== `${executable}.previous`) throw new Error('更新备份路径与当前可执行文件不匹配。');
  return { ...payload, managerStateDir, stateFile, readyFile, backup, executable };
}

async function startApplication() {
  extractAssets();
  process.title = 'web-mcp-assistant';
  const { startServer } = require('../web/server');
  let running;
  const shutdown = async () => {
    try { if (running) await running.close(); }
    finally { process.exit(0); }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  running = await startServer();
  return running;
}

async function rollbackUpdate(payload, error) {
  const failed = `${payload.executable}.failed`;
  try {
    fs.rmSync(failed, { force: true });
    fs.renameSync(payload.executable, failed);
    fs.renameSync(payload.backup, payload.executable);
    fs.chmodSync(payload.executable, 0o755);
    writeUpdateState(payload.stateFile, {
      phase: 'rolled-back',
      error: error instanceof Error ? error.message : String(error),
      rolledBackAt: new Date().toISOString()
    });
    const child = spawn(payload.executable, [], { detached: true, stdio: 'ignore', env: process.env });
    replaceManagerTracking(payload.managerStateDir, process.pid, child.pid);
    child.unref();
  } catch (rollbackError) {
    writeUpdateState(payload.stateFile, {
      phase: 'rollback-failed',
      error: `${error instanceof Error ? error.message : String(error)}；回滚失败：${rollbackError.message}`
    });
    throw rollbackError;
  }
}

async function runRestartHelper(encoded) {
  const payload = decodeHelperPayload(encoded);
  fs.mkdirSync(path.dirname(payload.readyFile), { recursive: true, mode: 0o700 });
  fs.writeFileSync(payload.readyFile, `${process.pid}\n`, { mode: 0o600 });
  writeUpdateState(payload.stateFile, { phase: 'waiting-for-old-process', helperPid: process.pid, error: '' });
  const deadline = Date.now() + 60_000;
  while (processIsRunning(payload.oldPid) && Date.now() < deadline) await wait(100);
  fs.rmSync(payload.readyFile, { force: true });
  if (processIsRunning(payload.oldPid)) throw new Error(`旧版本进程 ${payload.oldPid} 未在 60 秒内退出。`);
  updateManagerTracking(payload.managerStateDir, payload.oldPid);
  try {
    await startApplication();
    writeUpdateState(payload.stateFile, {
      phase: 'completed',
      installedVersion: String(payload.version || ''),
      completedAt: new Date().toISOString(),
      helperPid: process.pid,
      error: ''
    });
  } catch (error) {
    await rollbackUpdate(payload, error);
    throw error;
  }
}

async function runSelfUpdate() {
  if (!isSea()) throw new Error('源码运行模式不能替换系统 Node.js。');
  const { SettingsStore } = require('../src/services/settingsStore');
  const { UpdateService } = require('../src/services/updateService');
  const updater = new UpdateService({
    settingsStore: new SettingsStore(),
    emitProgress: (payload) => console.error(`[${payload.percent}%] ${payload.message}`)
  });
  const status = await updater.check({ force: true });
  if (!status.available) {
    console.log(`当前已是最新版本 v${status.currentVersion}。`);
    return;
  }
  await updater.download();
  const result = await updater.install({ restart: false });
  console.log(`已安装 v${result.version}；请重新启动 web-mcp-assistant。`);
}

async function dispatch() {
  const helperIndex = process.argv.indexOf(UPDATE_HELPER_FLAG);
  if (helperIndex >= 0) return runRestartHelper(process.argv[helperIndex + 1]);
  if (process.argv.includes('--self-update')) return runSelfUpdate();
  return startApplication();
}

dispatch().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
