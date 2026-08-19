const os = require('node:os');
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
  return path.resolve(__dirname, '..', 'resources');
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
  tunnelExecutable: () => path.join(resourcesRoot(), 'tools', 'tunnel-client')
};
