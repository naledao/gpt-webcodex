const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const APP_NAME = 'web-mcp-assistant';

function homeRoot() {
  return process.env.HOME || os.homedir();
}

function configRoot() {
  const base = process.env.XDG_CONFIG_HOME || path.join(homeRoot(), '.config');
  return path.join(base, APP_NAME);
}

function stateRoot() {
  const base = process.env.XDG_STATE_HOME || path.join(homeRoot(), '.local', 'state');
  return path.join(base, APP_NAME);
}

function resourcesRoot() {
  if (process.env.WEB_MCP_RESOURCES_ROOT) {
    return path.resolve(process.env.WEB_MCP_RESOURCES_ROOT);
  }
  return path.resolve(__dirname, '..', 'resources');
}

function tunnelExecutable() {
  const tools = path.join(resourcesRoot(), 'tools');
  const candidates = process.arch === 'arm64'
    ? ['tunnel-client-linux-arm64', 'tunnel-client']
    : ['tunnel-client', 'tunnel-client-linux-amd64'];
  return candidates
    .map((name) => path.join(tools, name))
    .find((file) => fs.existsSync(file)) || path.join(tools, candidates[0]);
}

module.exports = {
  APP_NAME,
  configRoot,
  stateRoot,
  resourcesRoot,
  settingsFile: () => path.join(configRoot(), 'settings.json'),
  secretsFile: () => path.join(configRoot(), 'secrets.json'),
  stateFile: () => path.join(stateRoot(), 'runtime-state.json'),
  logFile: () => path.join(stateRoot(), 'logs', 'assistant.log'),
  mcpLogFile: () => path.join(stateRoot(), 'logs', 'mcp.log'),
  tunnelLogFile: () => path.join(stateRoot(), 'logs', 'tunnel.log'),
  tunnelExecutable
};
