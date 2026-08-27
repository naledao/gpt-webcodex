const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { NativeService } = require('./nativeService');
const { TunnelService } = require('./tunnelService');
const { validateRuntimeSettings, mergeRecentWorkspaces, workspaceKey } = require('./config');
const { canConnect } = require('./environmentService');
const { resolveProxy } = require('./proxyService');
const { stateFile } = require('../paths');
const { readJson, updateJsonAtomic } = require('./jsonStore');

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function probeMcp(port, token, expectedWorkspace = '') {
  return new Promise((resolve) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: '/__control/health',
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      timeout: 1200
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { if (body.length < 65536) body += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) { resolve(false); return; }
        try {
          const payload = JSON.parse(body);
          const workspaceMatches = !expectedWorkspace
            || workspaceKey(payload.workspace) === workspaceKey(expectedWorkspace);
          resolve(payload.ready === true && workspaceMatches);
        } catch {
          resolve(false);
        }
      });
    });
    request.on('timeout', () => { request.destroy(); resolve(false); });
    request.on('error', () => resolve(false));
    request.end();
  });
}


function setMcpAuthorizedRoots(port, token, roots) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ roots });
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: '/__control/roots',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 5000
    }, (response) => {
      let payload = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { if (payload.length < 65536) payload += chunk; });
      response.on('end', () => {
        let parsed = {};
        try { parsed = payload ? JSON.parse(payload) : {}; } catch { /* handled below */ }
        if (response.statusCode !== 200 || parsed.ready !== true) {
          reject(new Error(parsed.error || `MCP 授权目录更新失败（HTTP ${response.statusCode}）`));
          return;
        }
        resolve(parsed);
      });
    });
    request.on('timeout', () => { request.destroy(new Error('MCP 授权目录更新超时')); });
    request.on('error', reject);
    request.end(body);
  });
}

class RuntimeOrchestrator {
  constructor({ settings, secrets, environment, log, emitProgress, emitStatus = () => {} }) {
    this.settingsStore = settings;
    this.secrets = secrets;
    this.environment = environment;
    this.log = log;
    this.emitProgress = emitProgress;
    this.emitStatus = emitStatus;
    this.native = new NativeService(log);
    this.tunnel = new TunnelService(log);
    this.busy = false;
    this.snapshotCache = null;
    this.snapshotCacheAt = 0;
    this.snapshotInFlight = null;
    this.heartbeatFailures = 0;
    this.recovering = false;
    this.recoveryAttempts = 0;
    this.nextRecoveryAt = 0;
    this.autoRecoveryBlocked = false;
    this.lastStartFailure = '';
  }

  progress(step, percent, message) {
    this.emitProgress({ step, percent, message, time: new Date().toISOString() });
    this.log.info(message, { step, percent });
  }

  invalidateSnapshot() {
    this.snapshotCacheAt = 0;
  }

  publishSnapshot(snapshot, reason = 'refresh') {
    const signature = (value) => JSON.stringify(value ? { settings: value.settings, secrets: value.secrets, environment: value.environment, status: value.status } : null);
    const previous = signature(this.snapshotCache);
    this.snapshotCache = snapshot;
    this.snapshotCacheAt = Date.now();
    if (previous !== signature(snapshot)) this.emitStatus({ reason, snapshot });
    return snapshot;
  }

  async ensureToken() {
    let token = this.secrets.get('mcpAuthToken');
    if (!token) {
      token = crypto.randomBytes(32).toString('base64url');
      this.secrets.set('mcpAuthToken', token);
    }
    return token;
  }

  isManuallyStopped() {
    return readJson(stateFile(), {}).manualStop === true;
  }

  setManualStop(value) {
    updateJsonAtomic(stateFile(), (state) => ({
      ...state,
      manualStop: Boolean(value),
      intentChangedAt: new Date().toISOString()
    }));
  }

  validate(settings) {
    if (!settings.workspace || !fs.existsSync(settings.workspace)) throw new Error('请选择一个存在的工作目录。');
    validateRuntimeSettings(settings);
  }

  async start(options = {}) {
    if (this.busy) throw new Error('当前已有部署任务正在运行。');
    const automatic = options.automatic === true;
    if (!automatic) {
      this.autoRecoveryBlocked = false;
      this.lastStartFailure = '';
      this.heartbeatFailures = 0;
      this.recoveryAttempts = 0;
      this.nextRecoveryAt = 0;
    }
    this.busy = true;
    try {
      const settings = this.settingsStore.load();
      this.validate(settings);
      const runtimeApiKey = this.secrets.get('runtimeApiKey');
      if (!runtimeApiKey) throw new Error('请先在“部署设置”中保存 Runtime API Key。');
      if (!settings.tunnelId) throw new Error('请先填写 OpenAI Tunnel ID。');
      const token = await this.ensureToken();

      this.progress('preflight', 8, '正在检查工作目录、运行环境和端口');
      const env = await this.environment.inspect(settings, { forceProxy: true });
      if (!env.tunnelClient.installed) throw new Error('缺少 OpenAI tunnel-client 运行文件。');
      if (!env.python.installed) {
        throw new Error('便携运行时尚未准备好，开发版需要 Python 3.11+；发行包将内置 Python。');
      }

      this.progress('proxy-detect', 14, '正在检测直连、Windows 系统代理和本地代理端口');
      const proxy = await resolveProxy(settings);
      if (settings.proxyMode === 'manual' && !proxy.reachable) {
        throw new Error(`手动代理不可用：${settings.proxyUrl}。请启动代理软件、修改端口，或切换到自动检测。`);
      }
      const proxyLabel = proxy.resolvedUrl || '直连';
      this.log.info('网络路径检测完成', { mode: settings.proxyMode, source: proxy.source, route: proxyLabel, reachable: proxy.reachable });
      this.progress('proxy-ready', 16, proxy.reachable ? `网络路径可用：${proxyLabel}` : '未验证到可用网络路径，将继续尝试直连并保留诊断日志');

      this.progress('runtime-stop-old', 18, '正在清理本助手上一次启动的旧运行实例');
      await this.tunnel.stop();
      await this.native.stop().catch(() => false);
      if (await canConnect('127.0.0.1', settings.mcpPort, 350)) {
        throw new Error(`本地端口 ${settings.mcpPort} 正被其他程序占用。助手不会强制结束未知进程，请在“工作目录”页面更换 MCP 端口。`);
      }
      if (await canConnect('127.0.0.1', settings.healthPort, 350)) {
        throw new Error(`本地端口 ${settings.healthPort} 正被其他程序占用。助手不会强制结束未知进程，请更换 Tunnel 控制台端口。`);
      }

      await this.native.start(settings, token, this.progress.bind(this));

      this.progress('mcp-health', 64, '正在验证 Coding Tools MCP');
      let ready = false;
      for (let index = 0; index < 35; index += 1) {
        if (await probeMcp(settings.mcpPort, token, settings.workspace)) { ready = true; break; }
        if (!(await this.native.status(settings))) {
          throw new Error('Coding Tools MCP 进程已提前退出。请查看运行日志中的 mcp.log 获取具体启动错误。');
        }
        await wait(1000);
      }
      if (!ready) throw new Error('Coding Tools MCP 未能在规定时间内通过健康检查。');

      await this.tunnel.start({ ...settings, effectiveProxyUrl: proxy.resolvedUrl }, runtimeApiKey, token, this.progress.bind(this));
      this.setManualStop(false);
      this.autoRecoveryBlocked = false;
      this.lastStartFailure = '';
      this.heartbeatFailures = 0;
      this.recoveryAttempts = 0;
      this.nextRecoveryAt = 0;
      this.progress('complete', 100, '部署完成，MCP 与 OpenAI Tunnel 均已运行');
      this.invalidateSnapshot();
      return await this.snapshot({ force: true, reason: 'started' });
    } catch (error) {
      this.autoRecoveryBlocked = true;
      this.lastStartFailure = error.message;
      this.heartbeatFailures = 0;
      this.recoveryAttempts = 0;
      this.nextRecoveryAt = 0;
      await this.tunnel.stop().catch(() => false);
      await this.native.stop().catch(() => false);
      this.invalidateSnapshot();
      this.log.error(error.message, { stage: 'start' });
      this.emitProgress({ step: 'failed', percent: 100, message: error.message, time: new Date().toISOString() });
      throw error;
    } finally {
      this.busy = false;
    }
  }

  async stop(options = {}) {
    if (this.busy) throw new Error('当前已有任务正在运行。');
    this.busy = true;
    try {
      if (options.manual !== false) this.setManualStop(true);
      this.progress('stop-tunnel', 25, '正在停止 OpenAI Tunnel');
      await this.tunnel.stop();
      this.progress('stop-runtime', 65, '正在停止 Coding Tools MCP');
      await this.native.stop().catch(() => false);
      this.progress('stopped', 100, '所有由本助手启动的服务均已停止');
      this.invalidateSnapshot();
      return await this.snapshot({ force: true, reason: 'stopped' });
    } finally {
      this.busy = false;
    }
  }

  async restart(options = {}) {
    await this.stop({ manual: false });
    return this.start(options);
  }

  async switchWorkspace(nextWorkspace) {
    if (this.busy) throw new Error('当前已有任务正在运行。');
    const previous = this.settingsStore.load();
    const workspace = path.resolve(String(nextWorkspace || '').trim());
    if (!workspace || !fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) {
      throw new Error('请选择一个存在的工作目录。');
    }

    const recentWorkspaces = mergeRecentWorkspaces(previous.recentWorkspaces, workspace);
    if (workspaceKey(previous.workspace) === workspaceKey(workspace)) {
      if (JSON.stringify(recentWorkspaces) !== JSON.stringify(previous.recentWorkspaces || [])) {
        this.settingsStore.save({ recentWorkspaces });
      }
      return this.snapshot({ force: true, reason: 'workspace-reselected' });
    }

    this.busy = true;
    let servicesWereRunning = false;
    try {
      const [runtimeRunning, tunnelRunning] = await Promise.all([
        this.native.status().catch(() => false),
        this.tunnel.status(previous).catch(() => false)
      ]);
      servicesWereRunning = runtimeRunning || tunnelRunning;
    } finally {
      this.busy = false;
    }

    if (!servicesWereRunning) {
      this.settingsStore.save({ workspace, recentWorkspaces });
      this.progress('workspace-saved', 100, '工作目录已保存，服务下次启动时生效');
      this.invalidateSnapshot();
      return this.snapshot({ force: true, reason: 'workspace-saved' });
    }

    this.settingsStore.save({ workspace, recentWorkspaces });
    try {
      this.progress('workspace-restart', 10, '正在重启 MCP 与 Tunnel，以刷新 ChatGPT 项目指令');
      await this.restart();
      this.progress('workspace-complete', 100, '工作目录已切换，ChatGPT 将重新加载项目指令');
      this.invalidateSnapshot();
      return this.snapshot({ force: true, reason: 'workspace-reinitialized' });
    } catch (error) {
      this.log.error(error.message, { stage: 'workspace-switch', rollback: previous.workspace });
      this.settingsStore.save(previous);
      try {
        await this.restart();
      } catch (rollbackError) {
        this.log.error(rollbackError.message, { stage: 'workspace-rollback' });
      }
      throw new Error(`工作目录切换失败：${error.message}`);
    }
  }

  async updateAuthorizedRoots(roots) {
    if (this.busy) throw new Error('当前已有任务正在运行。');
    const previous = this.settingsStore.load();
    const normalized = (Array.isArray(roots) ? roots : [])
      .map((item) => path.resolve(String(item || '').trim()))
      .filter((item) => item && fs.existsSync(item) && fs.statSync(item).isDirectory())
      .filter((item, index, all) => all.findIndex((other) => workspaceKey(other) === workspaceKey(item)) === index)
      .filter((item) => workspaceKey(item) !== workspaceKey(previous.workspace))
      .slice(0, 32);
    this.busy = true;
    try {
      const runtimeWasRunning = await this.native.status().catch(() => false);
      if (runtimeWasRunning) {
        const token = await this.ensureToken();
        await setMcpAuthorizedRoots(previous.mcpPort, token, normalized);
      }
      const saved = this.settingsStore.save({ authorizedRoots: normalized });
      if (runtimeWasRunning) await this.native.markWorkspace(saved);
      this.invalidateSnapshot();
      return this.snapshot({ force: true, reason: 'authorized-roots-updated' });
    } finally {
      this.busy = false;
    }
  }

  async lightweightSnapshot() {
    const settings = this.settingsStore.load();
    const token = this.secrets.get('mcpAuthToken');
    const [mcpRunning, tunnelRunning] = await Promise.all([
      token ? probeMcp(settings.mcpPort, token, settings.workspace) : Promise.resolve(false),
      this.tunnel.status(settings).catch(() => false)
    ]);
    return {
      workspace: settings.workspace,
      mcpRunning,
      tunnelRunning,
      fullyReady: mcpRunning && tunnelRunning,
      recovering: this.recovering,
      failures: this.heartbeatFailures,
      recoveryBlocked: this.autoRecoveryBlocked,
      lastStartFailure: this.lastStartFailure
    };
  }

  async supervise() {
    const status = await this.lightweightSnapshot();
    if (status.fullyReady) {
      this.heartbeatFailures = 0;
      this.recoveryAttempts = 0;
      this.nextRecoveryAt = 0;
      return status;
    }
    const runtimeState = readJson(stateFile(), {});
    const expectedRunning = runtimeState.manualStop === false
      && Boolean(runtimeState.nativePid || runtimeState.tunnelPid || this.settingsStore.load().autoStartServices);
    if (this.busy || this.recovering || this.isManuallyStopped() || !expectedRunning) return status;
    if (this.autoRecoveryBlocked) {
      return { ...status, recoveryBlocked: true, lastStartFailure: this.lastStartFailure };
    }
    this.heartbeatFailures += 1;
    if (this.heartbeatFailures < 3 || Date.now() < this.nextRecoveryAt) {
      return { ...status, failures: this.heartbeatFailures };
    }

    this.recovering = true;
    this.recoveryAttempts += 1;
    const delay = Math.min(60000, 2000 * (2 ** Math.min(this.recoveryAttempts - 1, 5)));
    this.nextRecoveryAt = Date.now() + delay;
    this.log.warn('运行时协议健康检查连续失败，开始自动恢复', {
      failures: this.heartbeatFailures,
      attempt: this.recoveryAttempts,
      mcpRunning: status.mcpRunning,
      tunnelRunning: status.tunnelRunning
    });
    try {
      await this.restart({ automatic: true });
      this.heartbeatFailures = 0;
      this.recoveryAttempts = 0;
      this.nextRecoveryAt = 0;
    } catch (error) {
      this.log.error(error.message, { stage: 'automatic-recovery', retryAfterMs: delay });
    } finally {
      this.recovering = false;
    }
    return this.lightweightSnapshot();
  }

  async snapshot(options = {}) {
    const force = options.force === true;
    if (!force && this.snapshotCache && Date.now() - this.snapshotCacheAt < 15000) return this.snapshotCache;
    if (!force && this.snapshotInFlight) return this.snapshotInFlight;
    this.snapshotInFlight = this._collectSnapshot(options.reason || 'refresh');
    try { return await this.snapshotInFlight; }
    finally { this.snapshotInFlight = null; }
  }

  async _collectSnapshot(reason) {
    const settings = this.settingsStore.load();
    const environment = await this.environment.inspect(settings);
    const token = this.secrets.get('mcpAuthToken');
    const runtimeRunning = token
      ? await probeMcp(settings.mcpPort, token, settings.workspace)
      : false;
    const tunnelRunning = await this.tunnel.status(settings).catch(() => false);
    return this.publishSnapshot({
      settings,
      secrets: this.secrets.status(),
      environment,
      status: {
        busy: this.busy,
        runtimeRunning,
        tunnelRunning,
        fullyReady: runtimeRunning && tunnelRunning,
        localMcpUrl: `http://127.0.0.1:${settings.mcpPort}/mcp`,
        tunnelUiUrl: `http://127.0.0.1:${settings.healthPort}/ui`,
        manuallyStopped: this.isManuallyStopped()
      }
    }, reason);
  }
}

module.exports = { RuntimeOrchestrator, probeMcp, setMcpAuthorizedRoots };


