const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { UpdateService, errorMessage } = require('../electron/services/updateService');

class MockUpdater extends EventEmitter {
  constructor() {
    super();
    this.proxyConfigs = [];
    this.closedConnections = 0;
    this.netSession = {
      setProxy: async (config) => this.proxyConfigs.push(config),
      closeAllConnections: async () => { this.closedConnections += 1; }
    };
    this.quitCalls = [];
  }

  async checkForUpdates() {
    this.emit('checking-for-update');
    const info = { version: '0.2.0', releaseName: 'v0.2.0', releaseNotes: '修复与改进' };
    this.emit('update-available', info);
    return { isUpdateAvailable: true, updateInfo: info };
  }

  async downloadUpdate() {
    this.emit('download-progress', { percent: 42.5, transferred: 425, total: 1000, bytesPerSecond: 128 });
    this.emit('update-downloaded', { version: '0.2.0', releaseNotes: '修复与改进' });
    return ['update.exe'];
  }

  quitAndInstall(...args) { this.quitCalls.push(args); }
}

function createService(options = {}) {
  const updater = options.updater || new MockUpdater();
  const settingsStore = options.settingsStore || { load: () => ({ proxyMode: 'manual', proxyUrl: 'http://127.0.0.1:7897' }) };
  return {
    updater,
    service: new UpdateService({
      updater,
      currentVersion: '0.1.9',
      platform: 'win32',
      architecture: 'x64',
      isPackaged: true,
      settingsStore,
      proxyResolver: options.proxyResolver || (async () => ({ resolvedUrl: 'http://127.0.0.1:7897' })),
      runtimeStatus: options.runtimeStatus,
      stopRuntime: options.stopRuntime,
      resumeStateFile: options.resumeStateFile,
      setTimer: options.setTimer,
      markQuit: options.markQuit
    })
  };
}

test('checks GitHub updates through the resolved proxy and exposes safe state', async () => {
  const { service, updater } = createService();
  const state = await service.check();
  assert.equal(state.phase, 'available');
  assert.equal(state.available, true);
  assert.equal(state.latest.version, '0.2.0');
  assert.equal(state.busy, false);
  assert.equal(state.latest.releaseNotes, '修复与改进');
  assert.deepEqual(updater.proxyConfigs, [{ mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:7897' }]);
  assert.equal(updater.closedConnections, 1);
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowPrerelease, false);
  assert.equal(updater.disableWebInstaller, true);
});

test('downloads only after a successful check and reports progress', async () => {
  const { service } = createService();
  await assert.rejects(service.download(), /请先检查更新/);
  await service.check();
  const state = await service.download();
  assert.equal(state.phase, 'downloaded');
  assert.equal(state.downloaded, true);
  assert.equal(state.progress, 100);
  assert.equal(state.busy, false);
});

test('stops owned services before install and restores the one-shot resume intent', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'web-mcp-update-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const resumeStateFile = path.join(directory, 'update-state.json');
  let stopped = 0;
  let markedQuit = 0;
  let timerAction;
  const { service, updater } = createService({
    resumeStateFile,
    runtimeStatus: async () => ({ status: { runtimeRunning: true, tunnelRunning: true } }),
    stopRuntime: async () => { stopped += 1; },
    setTimer: (action) => { timerAction = action; return 1; },
    markQuit: () => { markedQuit += 1; }
  });
  await service.check();
  await service.download();
  const result = await service.install();
  assert.equal(result.restartScheduled, true);
  assert.equal(stopped, 1);
  assert.equal(service.hasResumeServicesIntent(), true);
  service.clearResumeServicesIntent();
  assert.equal(service.hasResumeServicesIntent(), false);
  timerAction();
  assert.equal(markedQuit, 1);
  assert.deepEqual(updater.quitCalls, [[false, true]]);
});

test('development mode is explicit and never contacts the updater', async () => {
  const updater = new MockUpdater();
  const service = new UpdateService({ updater, currentVersion: '0.1.9', platform: 'win32', isPackaged: false });
  assert.equal(service.status().canUpdate, false);
  assert.match(service.status().capabilityReason, /开发模式/);
  await assert.rejects(service.check(), /开发模式/);
});

test('missing latest.yml and network failures are translated for the UI', () => {
  assert.match(errorMessage(Object.assign(new Error('404'), { code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' })), /latest\.yml/);
  assert.match(errorMessage(new Error('net::ERR_PROXY_CONNECTION_FAILED')), /代理/);
  assert.match(errorMessage(new Error('net::ERR_NAME_NOT_RESOLVED')), /无法连接 GitHub/);
});
