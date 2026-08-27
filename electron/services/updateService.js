const { resolveProxy } = require('./proxyService');
const { readJson, writeJsonAtomic } = require('./jsonStore');

const RELEASES_URL = 'https://github.com/naledao/gpt-webcodex/releases';
const AUTOMATIC_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function errorMessage(error) {
  const message = error instanceof Error ? error.message : String(error || '未知错误');
  const code = error?.code || '';
  if (code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' || /Cannot find latest\.yml|latest\.yml.*404/i.test(message)) {
    return 'GitHub 最新稳定版尚未包含 Windows 更新文件（latest.yml）。请稍后重试或从 Releases 手动下载安装包。';
  }
  if (code === 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND') {
    return '没有找到可用的 GitHub 稳定版本。';
  }
  if (/net::ERR_(?:PROXY_CONNECTION_FAILED|CONNECTION_REFUSED)/i.test(message)) {
    return '更新服务器连接失败，请检查当前代理设置。';
  }
  if (/net::ERR_(?:INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|TIMED_OUT)/i.test(message)) {
    return '无法连接 GitHub 更新服务器，请检查网络或代理后重试。';
  }
  return message;
}

function releaseNotesText(value) {
  const text = Array.isArray(value)
    ? value.map((item) => item?.note || '').filter(Boolean).join('\n\n')
    : String(value || '');
  return text.trim().slice(0, 8000);
}

function normalizeInfo(info = {}) {
  const version = String(info.version || '').trim();
  return {
    version,
    releaseName: String(info.releaseName || '').trim().slice(0, 300),
    releaseNotes: releaseNotesText(info.releaseNotes),
    releaseDate: String(info.releaseDate || '').trim(),
    releaseUrl: version ? `${RELEASES_URL}/tag/v${encodeURIComponent(version)}` : RELEASES_URL
  };
}

class UpdateService {
  constructor(options = {}) {
    this.updater = options.updater || require('electron-updater').autoUpdater;
    this.currentVersion = String(options.currentVersion || '0.0.0');
    this.platform = options.platform || process.platform;
    this.architecture = options.architecture || process.arch;
    this.isPackaged = options.isPackaged === true;
    this.settingsStore = options.settingsStore || null;
    this.log = options.log || null;
    this.emitState = options.emitState || (() => {});
    this.proxyResolver = options.proxyResolver || resolveProxy;
    this.runtimeStatus = options.runtimeStatus || (async () => null);
    this.stopRuntime = options.stopRuntime || (async () => {});
    this.markQuit = options.markQuit || (() => {});
    this.resumeStateFile = options.resumeStateFile || '';
    this.setTimer = options.setTimer || setTimeout;
    this.busy = '';
    this.state = {
      currentVersion: this.currentVersion,
      platform: this.platform,
      architecture: this.architecture,
      canUpdate: this.isPackaged && this.platform === 'win32',
      capabilityReason: this.capabilityReason(),
      phase: 'idle',
      available: false,
      downloaded: false,
      progress: 0,
      bytesPerSecond: 0,
      transferred: 0,
      total: 0,
      latest: null,
      checkedAt: '',
      error: ''
    };
    this.configureUpdater();
  }

  capabilityReason() {
    if (this.platform !== 'win32') return '当前更新器只支持 Windows NSIS 安装版。';
    if (!this.isPackaged) return '开发模式不会替换本地源码，请安装正式版后测试更新。';
    return '';
  }

  configureUpdater() {
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.allowPrerelease = false;
    this.updater.disableWebInstaller = true;
    if (this.log) {
      this.updater.logger = {
        info: (message) => this.log.info(String(message), { stage: 'update' }),
        warn: (message) => this.log.warn(String(message), { stage: 'update' }),
        error: (message) => this.log.error(String(message), { stage: 'update' })
      };
    }
    this.updater.on('checking-for-update', () => this.updateState({ phase: 'checking', progress: 0, error: '' }));
    this.updater.on('update-available', (info) => this.updateState({
      phase: 'available', available: true, downloaded: false, latest: normalizeInfo(info), checkedAt: new Date().toISOString(), error: ''
    }));
    this.updater.on('update-not-available', (info) => this.updateState({
      phase: 'up-to-date', available: false, downloaded: false, latest: normalizeInfo(info), checkedAt: new Date().toISOString(), progress: 100, error: ''
    }));
    this.updater.on('download-progress', (progress) => this.updateState({
      phase: 'downloading', progress: Math.max(0, Math.min(100, Number(progress.percent || 0))),
      bytesPerSecond: Number(progress.bytesPerSecond || 0), transferred: Number(progress.transferred || 0), total: Number(progress.total || 0), error: ''
    }));
    this.updater.on('update-downloaded', (info) => this.updateState({
      phase: 'downloaded', available: true, downloaded: true, latest: normalizeInfo(info), progress: 100, error: ''
    }));
    this.updater.on('error', (error) => this.updateState({ phase: 'error', error: errorMessage(error) }));
  }

  updateState(patch) {
    this.state = { ...this.state, ...patch, busy: Boolean(this.busy), operation: this.busy };
    const snapshot = this.status();
    try { this.emitState(snapshot); } catch { /* UI delivery must not break updates */ }
    return snapshot;
  }

  status() {
    return JSON.parse(JSON.stringify({ ...this.state, busy: Boolean(this.busy), operation: this.busy }));
  }

  assertSupported() {
    if (!this.state.canUpdate) throw new Error(this.state.capabilityReason);
  }

  async runExclusive(operation, action) {
    this.assertSupported();
    if (this.busy) throw new Error(`正在执行${this.busy === 'check' ? '更新检查' : this.busy === 'download' ? '更新下载' : '更新安装'}，请稍候。`);
    this.busy = operation;
    this.updateState({ error: '' });
    try {
      return await action();
    } catch (error) {
      const friendly = errorMessage(error);
      this.updateState({ phase: 'error', error: friendly });
      throw new Error(friendly);
    } finally {
      this.busy = '';
      this.updateState({});
    }
  }

  async applyProxy() {
    const networkSession = this.updater.netSession;
    if (!networkSession?.setProxy || !this.settingsStore) return;
    const settings = this.settingsStore.load();
    let config;
    if (settings.proxyMode === 'direct') {
      config = { mode: 'direct' };
    } else {
      const resolved = await this.proxyResolver(settings);
      config = resolved.resolvedUrl
        ? { mode: 'fixed_servers', proxyRules: resolved.resolvedUrl }
        : { mode: settings.proxyMode === 'system' ? 'system' : 'direct' };
    }
    await networkSession.setProxy(config);
    if (typeof networkSession.closeAllConnections === 'function') await networkSession.closeAllConnections();
    this.log?.info('更新网络路径已配置', { stage: 'update-proxy', mode: config.mode, route: config.proxyRules || '系统/直连' });
  }

  async check() {
    if (this.state.downloaded) return this.status();
    await this.runExclusive('check', async () => {
      await this.applyProxy();
      this.updateState({ phase: 'checking', progress: 0, error: '' });
      await this.updater.checkForUpdates();
    });
    return this.status();
  }

  async download() {
    await this.runExclusive('download', async () => {
      if (!this.state.available) throw new Error('请先检查更新并确认有可用的新版本。');
      await this.applyProxy();
      this.updateState({ phase: 'downloading', progress: 0, error: '' });
      await this.updater.downloadUpdate();
    });
    return this.status();
  }

  writeResumeIntent(value) {
    if (!this.resumeStateFile) return;
    writeJsonAtomic(this.resumeStateFile, {
      resumeServicesAfterUpdate: Boolean(value),
      targetVersion: this.state.latest?.version || '',
      writtenAt: new Date().toISOString()
    });
  }

  hasResumeServicesIntent() {
    if (!this.resumeStateFile) return false;
    const saved = readJson(this.resumeStateFile, {});
    return saved.resumeServicesAfterUpdate === true;
  }

  clearResumeServicesIntent() {
    if (!this.resumeStateFile) return;
    const saved = readJson(this.resumeStateFile, {});
    if (!saved.resumeServicesAfterUpdate) return;
    writeJsonAtomic(this.resumeStateFile, { ...saved, resumeServicesAfterUpdate: false, consumedAt: new Date().toISOString() });
  }

  async install() {
    await this.runExclusive('install', async () => {
      if (!this.state.downloaded) throw new Error('请先下载并验证更新。');
      const snapshot = await this.runtimeStatus();
      const runtime = snapshot?.status || snapshot || {};
      const resumeServices = Boolean(runtime.runtimeRunning || runtime.mcpRunning || runtime.tunnelRunning || runtime.fullyReady);
      this.writeResumeIntent(resumeServices);
      try {
        if (resumeServices) await this.stopRuntime();
      } catch (error) {
        this.writeResumeIntent(false);
        throw new Error(`更新安装前无法安全停止本地服务：${errorMessage(error)}`);
      }
      this.updateState({ phase: 'install-pending', progress: 100, error: '' });
      this.setTimer(() => {
        this.markQuit();
        this.updater.quitAndInstall(false, true);
      }, 350);
    });
    return { ...this.status(), restartScheduled: true };
  }
}

module.exports = {
  UpdateService,
  RELEASES_URL,
  AUTOMATIC_CHECK_INTERVAL_MS,
  errorMessage,
  normalizeInfo
};
