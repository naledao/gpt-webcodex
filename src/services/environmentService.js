const fs = require('node:fs');
const net = require('node:net');
const { run } = require('./commandRunner');
const paths = require('../paths');
const { resolveProxy } = require('./proxyService');

async function commandExists(name) {
  if (!/^[A-Za-z0-9._+-]+$/.test(String(name || ''))) return false;
  try {
    const result = await run('/bin/sh', ['-lc', `command -v -- ${name}`], { allowFailure: true });
    return result.code === 0;
  } catch {
    return false;
  }
}

function canConnect(host, port, timeout = 800) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(timeout);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function pythonStatus() {
  for (const command of ['python3', 'python']) {
    let result;
    try {
      result = await run(command, ['--version'], { allowFailure: true });
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      continue;
    }
    const output = `${result.stdout} ${result.stderr}`.trim();
    const match = output.match(/Python\s+(\d+)\.(\d+)\.(\d+)/i);
    const major = match ? Number(match[1]) : 0;
    const minor = match ? Number(match[2]) : 0;
    if (result.code === 0 && match && (major > 3 || (major === 3 && minor >= 11))) {
      return { installed: true, command, launchCommand: command, prefixArgs: [], version: match[0] };
    }
  }
  return { installed: false, command: '', launchCommand: '', prefixArgs: [], version: '' };
}

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

class EnvironmentService {
  async inspect(settings, options = {}) {
    const [python, proxy, mcpListening, tunnelListening] = await Promise.all([
      pythonStatus(),
      resolveProxy(settings, { force: options.forceProxy === true }).catch(() => ({ mode: settings.proxyMode, resolvedUrl: '', source: 'error', reachable: false })),
      canConnect('127.0.0.1', settings.mcpPort),
      canConnect('127.0.0.1', settings.healthPort)
    ]);
    const tunnelPath = paths.tunnelExecutable();
    return {
      platform: process.platform,
      python,
      proxy: {
        mode: proxy.mode,
        configured: Boolean(proxy.resolvedUrl),
        reachable: proxy.reachable,
        url: proxy.resolvedUrl,
        source: proxy.source
      },
      tunnelClient: { installed: isExecutable(tunnelPath), path: tunnelPath },
      workspace: { configured: Boolean(settings.workspace), exists: Boolean(settings.workspace && fs.existsSync(settings.workspace)) },
      ports: { mcpListening, tunnelListening }
    };
  }
}

module.exports = { EnvironmentService, commandExists, canConnect, pythonStatus, isExecutable };
