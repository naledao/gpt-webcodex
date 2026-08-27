const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pythonStatus } = require('./environmentService');
const { stateFile, mcpLogFile, resourcesRoot } = require('../paths');
const { readJson, updateJsonAtomic, ensureParent } = require('./jsonStore');
const { rotateLog } = require('./logService');
const { isAlive, terminateOwnedProcess } = require('./processService');

function runtimeFingerprint(settings) {
  return crypto.createHash('sha256').update(JSON.stringify({
    workspace: path.resolve(String(settings.workspace || '')),
    authorizedRoots: (settings.authorizedRoots || []).map((item) => path.resolve(String(item))).sort(),
    port: Number(settings.mcpPort),
    permissionMode: settings.permissionMode || 'safe',
    instructionSharingMode: settings.instructionSharingMode || 'metadata',
    toolMode: 'smart'
  })).digest('hex');
}

function currentRuntimeState(input = {}) {
  const allowed = new Set([
    'manualStop', 'tunnelPid', 'tunnelStartedAt',
    'nativePid', 'nativeFingerprint', 'nativeWorkspace', 'nativePort',
    'nativePermissionMode', 'nativeToolMode', 'nativeInstructionSharingMode', 'nativeCommand', 'nativeInstanceId', 'startedAt'
  ]);
  return Object.fromEntries(Object.entries(input).filter(([key]) => allowed.has(key)));
}

class NativeService {
  constructor(log) {
    this.log = log;
  }

  async start(settings, token, progress) {
    const python = await pythonStatus();
    if (!python.installed) throw new Error('未找到 Python 3.11+。请先在 Linux 系统中安装 Python 3.11 或更高版本。');

    const current = readJson(stateFile(), {});
    const fingerprint = runtimeFingerprint(settings);
    if (isAlive(current.nativePid) && current.nativeFingerprint === fingerprint) {
      this.log.info('Coding Tools MCP 已在目标工作目录运行', { pid: current.nativePid, workspace: settings.workspace });
      return { reused: true, pid: current.nativePid };
    }
    if (isAlive(current.nativePid)) {
      this.log.info('检测到 MCP 配置已变化，正在重建', { from: current.nativeWorkspace || '', to: settings.workspace });
      await this.stop();
    }

    progress('native-start', 45, `正在使用 ${python.version} 启动 Coding Tools MCP`);
    ensureParent(mcpLogFile());
    rotateLog(mcpLogFile());
    const output = fs.openSync(mcpLogFile(), 'a');
    const env = {
      ...process.env,
      CODING_TOOLS_MCP_AUTH_MODE: 'bearer',
      CODING_TOOLS_MCP_AUTH_TOKEN: token,
      CODING_TOOLS_MCP_TELEMETRY: 'off',
      PYTHONDONTWRITEBYTECODE: '1',
      CODING_TOOLS_MCP_TOOL_MODE: 'smart',
      CODING_TOOLS_MCP_INSTRUCTION_SHARING_MODE: settings.instructionSharingMode || 'metadata',
      CODING_TOOLS_MCP_AUTHORIZED_ROOTS: JSON.stringify(settings.authorizedRoots || []),
      CODING_TOOLS_MCP_LONG_TOOL_HANDOFF_SECONDS: String(settings.progressReportSeconds || 90)
    };
    const bundledTools = path.join(resourcesRoot(), 'tools');
    const vendoredPython = path.join(resourcesRoot(), 'coding-tools-mcp', 'python_vendor');
    env.PATH = [bundledTools, process.env.PATH || ''].filter(Boolean).join(path.delimiter);
    env.PYTHONPATH = [vendoredPython, path.join(resourcesRoot(), 'coding-tools-mcp'), process.env.PYTHONPATH || ''].filter(Boolean).join(path.delimiter);
    const args = [
      '-m', 'coding_tools_mcp',
      '--workspace', settings.workspace,
      '--host', '127.0.0.1',
      '--port', String(settings.mcpPort),
      '--permission-mode', settings.permissionMode
    ];
    const child = spawn(python.command, args, {
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
    updateJsonAtomic(stateFile(), (value) => ({
      ...currentRuntimeState(value),
      nativePid: child.pid,
      nativeFingerprint: fingerprint,
      nativeWorkspace: path.resolve(settings.workspace),
      nativePort: Number(settings.mcpPort),
      nativePermissionMode: settings.permissionMode,
      nativeToolMode: 'smart',
      nativeInstructionSharingMode: settings.instructionSharingMode || 'metadata',
      nativeCommand: python.command,
      startedAt: new Date().toISOString(),
      nativeInstanceId: crypto.randomBytes(12).toString('hex')
    }));
    this.log.info('Coding Tools MCP 已启动', { pid: child.pid, workspace: settings.workspace, command: python.command });
    return { reused: false, pid: child.pid };
  }

  async stop() {
    const state = readJson(stateFile(), {});
    const alive = isAlive(state.nativePid);
    try {
      if (alive) await terminateOwnedProcess(state.nativePid);
      return alive;
    } finally {
      updateJsonAtomic(stateFile(), (value) => ({
        ...value,
        nativePid: null,
        nativeFingerprint: '',
        nativeWorkspace: '',
        nativePort: null,
        nativePermissionMode: '',
        nativeInstructionSharingMode: '',
        nativeInstanceId: ''
      }));
    }
  }

  async markWorkspace(settings) {
    updateJsonAtomic(stateFile(), (value) => ({
      ...value,
      nativeFingerprint: runtimeFingerprint(settings),
      nativeWorkspace: path.resolve(settings.workspace),
      nativePort: Number(settings.mcpPort),
      nativePermissionMode: settings.permissionMode,
      nativeToolMode: 'smart',
      nativeInstructionSharingMode: settings.instructionSharingMode || 'metadata'
    }));
    return true;
  }

  async status(settings = null) {
    const state = readJson(stateFile(), {});
    if (!isAlive(state.nativePid)) return false;
    return !settings || state.nativeFingerprint === runtimeFingerprint(settings);
  }
}

module.exports = { NativeService, isAlive, runtimeFingerprint, currentRuntimeState };
