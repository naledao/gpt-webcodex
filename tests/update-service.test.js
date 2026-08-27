const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { UpdateService, errorMessage } = require('../electron/services/updateService');
const { GitHubReleaseResolver } = require('../electron/services/githubReleaseResolver');

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
    this.feedConfigs = [];
  }

  setFeedURL(config) { this.feedConfigs.push(config); }

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
  const releaseResolver = options.releaseResolver || {
    findLatest: async () => ({
      tagName: 'v0.2.0',
      version: '0.2.0',
      downloadBaseUrl: 'https://github.com/naledao/gpt-webcodex/releases/download/v0.2.0/',
      releaseUrl: 'https://github.com/naledao/gpt-webcodex/releases/tag/v0.2.0',
      releaseName: 'v0.2.0',
      releaseNotes: '修复与改进',
      releaseDate: '2026-08-27T00:00:00Z'
    })
  };
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
      releaseResolver,
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
  assert.deepEqual(updater.feedConfigs, [{
    provider: 'generic',
    url: 'https://github.com/naledao/gpt-webcodex/releases/download/v0.2.0/',
    channel: 'latest',
    useMultipleRangeRequest: false
  }]);
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

function response(body, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    json: async () => body,
    text: async () => String(body)
  };
}

test('walks stable releases newest-first until the manifest contains the current target', async () => {
  const requests = [];
  const releases = [
    {
      tag_name: 'v0.4.0', draft: false, prerelease: false,
      assets: [{ name: 'latest-linux.yml' }]
    },
    {
      tag_name: 'v0.3.0', draft: false, prerelease: false,
      assets: [{ name: 'latest.yml' }, { name: 'app-linux-x64' }]
    },
    {
      tag_name: 'v0.2.0', draft: false, prerelease: false, name: 'Windows 0.2.0',
      html_url: 'https://github.com/naledao/gpt-webcodex/releases/tag/v0.2.0',
      published_at: '2026-08-27T00:00:00Z',
      assets: [{ name: 'latest.yml' }, { name: 'setup.exe' }]
    },
    {
      tag_name: 'v0.5.0-beta.1', draft: false, prerelease: true,
      assets: [{ name: 'latest.yml' }, { name: 'setup.exe' }]
    }
  ];
  const manifests = {
    'v0.3.0': 'version: 0.3.0\nupdatePackages:\n  - platform: linux\n    arch: x64\n    file: app-linux-x64\n',
    'v0.2.0': 'version: 0.2.0\nupdatePackages:\n  - platform: win32\n    arch: x64\n    type: nsis\n    file: setup.exe\n'
  };
  const resolver = new GitHubReleaseResolver({
    fetch: async (url) => {
      requests.push(url);
      if (url.includes('api.github.com')) return response(releases);
      const tag = Object.keys(manifests).find((candidate) => url.includes(candidate));
      return tag ? response(manifests[tag]) : response('', 404);
    }
  });

  const selected = await resolver.findLatest('win32', 'x64');
  assert.equal(selected.tagName, 'v0.2.0');
  assert.equal(selected.version, '0.2.0');
  assert.equal(selected.inspected, 3);
  assert.equal(requests.some((url) => url.includes('v0.4.0/latest.yml')), false);
  assert.equal(requests.some((url) => url.includes('v0.3.0/latest.yml')), true);
  assert.equal(requests.some((url) => url.includes('v0.2.0/latest.yml')), true);
});

test('does not select a declared package when its release asset is missing', async () => {
  const resolver = new GitHubReleaseResolver({
    fetch: async (url) => url.includes('api.github.com')
      ? response([{
        tag_name: 'v0.2.0', draft: false, prerelease: false,
        assets: [{ name: 'latest.yml' }]
      }])
      : response('version: 0.2.0\nupdatePackages:\n  - platform: win32\n    arch: x64\n    file: missing.exe\n')
  });
  await assert.rejects(resolver.findLatest('win32', 'x64'), (error) => (
    error.code === 'ERR_UPDATER_TARGET_RELEASE_NOT_FOUND'
    && /win32-x64/.test(error.message)
  ));
});

test('does not hide GitHub service failures by falling back to an older release', async () => {
  const resolver = new GitHubReleaseResolver({
    fetch: async (url) => url.includes('api.github.com')
      ? response([{
        tag_name: 'v0.2.0', draft: false, prerelease: false,
        assets: [{ name: 'latest.yml' }, { name: 'setup.exe' }]
      }])
      : response('unavailable', 503)
  });
  await assert.rejects(resolver.findLatest('win32', 'x64'), (error) => (
    error.code === 'ERR_UPDATER_RELEASE_DISCOVERY_FAILED'
    && /HTTP 503/.test(error.message)
  ));
});
