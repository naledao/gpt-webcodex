const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { tunnelExecutable, tunnelLogFile, stateFile } = require('../paths');
const { readJson, updateJsonAtomic, ensureParent } = require('./jsonStore');
const { rotateLog } = require('./logService');
const { canConnect, isExecutable } = require('./environmentService');
const { isAlive, terminateOwnedProcess } = require('./processService');

class TunnelService {
  constructor(log) {
    this.log = log;
  }

  async start(settings, runtimeApiKey, token, progress) {
    const executable = tunnelExecutable();
    if (!isExecutable(executable)) throw new Error(`缺少可执行的 Linux tunnel-client：${executable}`);
    if (!runtimeApiKey) throw new Error('请先保存 OpenAI Runtime API Key。');
    if (!settings.tunnelId) throw new Error('请先填写 OpenAI Tunnel ID。');
    await this.stop();
    progress('tunnel-start', 72, '正在连接 OpenAI MCP Tunnel');
    ensureParent(tunnelLogFile());
    rotateLog(tunnelLogFile());
    const output = fs.openSync(tunnelLogFile(), 'a');
    const env = {
      ...process.env,
      CONTROL_PLANE_API_KEY: runtimeApiKey,
      MCP_RUNTIME_HEADER_VALUE: `Bearer ${token}`
    };
    const args = [
      'run',
      '--control-plane.tunnel-id', settings.tunnelId,
      '--control-plane.api-key', 'env:CONTROL_PLANE_API_KEY',
      '--health.listen-addr', `127.0.0.1:${settings.healthPort}`,
      '--mcp.server-url', `url=http://127.0.0.1:${settings.mcpPort}/mcp,channel=main`,
      '--mcp.extra-headers', 'Authorization: env:MCP_RUNTIME_HEADER_VALUE',
      '--mcp.discovery-extra-headers', 'Authorization: env:MCP_RUNTIME_HEADER_VALUE',
      '--log.file', tunnelLogFile()
    ];
    const proxyUrl = Object.prototype.hasOwnProperty.call(settings, 'effectiveProxyUrl')
      ? settings.effectiveProxyUrl
      : settings.proxyUrl;
    if (proxyUrl) args.push('--control-plane.http-proxy', proxyUrl);

    const child = spawn(executable, args, {
      detached: false,
      stdio: ['ignore', output, output],
      env
    });
    try {
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
    } finally {
      fs.closeSync(output);
    }
    child.unref();
    updateJsonAtomic(stateFile(), (state) => ({
      ...state,
      tunnelPid: child.pid,
      tunnelStartedAt: new Date().toISOString()
    }));

    for (let index = 0; index < 30; index += 1) {
      if (await canConnect('127.0.0.1', settings.healthPort, 500)) {
        this.log.info('OpenAI Tunnel 已启动', { pid: child.pid, tunnelId: settings.tunnelId });
        return;
      }
      if (!isAlive(child.pid)) throw new Error('Linux tunnel-client 进程已提前退出，请查看 Tunnel 日志。');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(`Tunnel 已启动，但 ${settings.healthPort} 端口未通过就绪检查。请查看 Tunnel 日志。`);
  }

  async stop() {
    const state = readJson(stateFile(), {});
    const alive = isAlive(state.tunnelPid);
    try {
      if (alive) await terminateOwnedProcess(state.tunnelPid);
      return alive;
    } finally {
      updateJsonAtomic(stateFile(), (value) => ({ ...value, tunnelPid: null }));
    }
  }

  async status(settings) {
    const state = readJson(stateFile(), {});
    return isAlive(state.tunnelPid) && await canConnect('127.0.0.1', settings.healthPort, 400);
  }
}

module.exports = { TunnelService };
