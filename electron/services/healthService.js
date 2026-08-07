const net = require('node:net');

function freePort(start, avoid) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      if (port > 65535) return reject(new Error('没有找到可用的本地端口。'));
      if (port === avoid) return tryPort(port + 1);
      const server = net.createServer();
      server.once('error', () => tryPort(port + 1));
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(port)));
    };
    tryPort(Math.max(1024, Number(start) || 18765));
  });
}

class HealthService {
  constructor({ settings, secrets, environment, orchestrator }) {
    Object.assign(this, { settings, secrets, environment, orchestrator });
  }

  async ownership(current) {
    const runtimeOwned = await this.orchestrator.native.status(current).catch(() => false);
    const tunnelOwned = await this.orchestrator.tunnel.status(current).catch(() => false);
    return { runtimeOwned, tunnelOwned };
  }

  async inspect() {
    const current = this.settings.load();
    const env = await this.environment.inspect(current);
    const owned = await this.ownership(current);
    const secretState = this.secrets.status();
    const mcpConflict = env.ports.mcpListening && !owned.runtimeOwned;
    const tunnelConflict = env.ports.tunnelListening && !owned.tunnelOwned;
    const checks = [
      { id: 'workspace', label: '工作目录', ok: env.workspace.exists, repair: 'choose-workspace', detail: current.workspace || '尚未选择' },
      { id: 'runtime', label: '便携 Python', ok: env.python.installed, repair: 'runtime', detail: env.python.version || '便携 Python 不可用' },
      { id: 'tunnel-client', label: 'Tunnel 客户端', ok: env.tunnelClient.installed, repair: '', detail: env.tunnelClient.installed ? '文件完整' : '安装文件缺失，需要重新安装助手' },
      { id: 'runtime-key', label: 'Runtime API Key', ok: secretState.runtimeApiKey, repair: 'runtime-key', detail: secretState.runtimeApiKey ? '已安全保存' : '尚未填写' },
      { id: 'tunnel-id', label: 'Tunnel ID', ok: Boolean(current.tunnelId), repair: 'tunnel-id', detail: current.tunnelId || '尚未填写' },
      { id: 'mcp-port', label: 'MCP 本地端口', ok: !mcpConflict, repair: 'port', detail: mcpConflict ? `${current.mcpPort} 被非本助手进程占用` : `${current.mcpPort} 可用或由本助手管理` },
      { id: 'tunnel-port', label: 'Tunnel 控制台端口', ok: !tunnelConflict, repair: 'port', detail: tunnelConflict ? `${current.healthPort} 被非本助手进程占用` : `${current.healthPort} 可用或由本助手管理` },
      { id: 'mcp', label: 'Coding Tools MCP', ok: owned.runtimeOwned, repair: 'restart', detail: owned.runtimeOwned ? '助手实例运行正常' : '尚未启动' },
      { id: 'tunnel', label: 'OpenAI Tunnel', ok: owned.tunnelOwned, repair: 'restart', detail: owned.tunnelOwned ? '助手实例运行正常' : '尚未启动' }
    ];
    return { healthy: checks.every((item) => item.ok), checks, settings: current, environment: env, ownership: owned, inspectedAt: new Date().toISOString() };
  }

  async repair() {
    let current = this.settings.load();
    const before = await this.inspect();
    const actions = [];
    const unresolved = [];
    const patch = {};
    if (!before.checks.find((item) => item.id === 'mcp-port')?.ok) {
      patch.mcpPort = await freePort(current.mcpPort + 1, current.healthPort);
      actions.push(`MCP 端口已切换为 ${patch.mcpPort}`);
    }
    if (!before.checks.find((item) => item.id === 'tunnel-port')?.ok) {
      patch.healthPort = await freePort(current.healthPort + 1, patch.mcpPort || current.mcpPort);
      actions.push(`Tunnel 控制台端口已切换为 ${patch.healthPort}`);
    }
    if (!this.secrets.status().mcpAuthToken) {
      await this.orchestrator.ensureToken();
      actions.push('已生成 MCP 本地认证 Token');
    }
    if (Object.keys(patch).length) current = this.settings.save(patch);
    if (!current.workspace) unresolved.push('选择工作目录');
    if (!this.secrets.status().runtimeApiKey) unresolved.push('填写 Runtime API Key');
    if (!current.tunnelId) unresolved.push('填写 Tunnel ID');
    if (!before.environment.tunnelClient.installed) unresolved.push('重新安装助手以恢复 Tunnel 客户端');
    if (!before.environment.python.installed) unresolved.push('修复便携 Python');
    if (!unresolved.length) {
      await this.orchestrator.restart();
      actions.push('已重新启动 MCP 与 Tunnel');
    }
    const after = await this.inspect();
    return { ...after, actions, unresolved };
  }
}

module.exports = { HealthService, freePort };
