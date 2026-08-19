const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const paths = require('../src/paths');
const { normalize, validateRuntimeSettings, workspaceKey } = require('../src/services/config');
const { SettingsStore } = require('../src/services/settingsStore');

test('XDG config/state paths are used', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'web-mcp-paths-'));
  const oldConfig = process.env.XDG_CONFIG_HOME;
  const oldState = process.env.XDG_STATE_HOME;
  process.env.XDG_CONFIG_HOME = path.join(temp, 'config');
  process.env.XDG_STATE_HOME = path.join(temp, 'state');
  try {
    assert.equal(paths.configRoot(), path.join(temp, 'config', 'web-mcp-assistant'));
    assert.equal(paths.stateRoot(), path.join(temp, 'state', 'web-mcp-assistant'));
    assert.equal(paths.settingsFile(), path.join(temp, 'config', 'web-mcp-assistant', 'settings.json'));
    assert.equal(paths.secretsFile(), path.join(temp, 'config', 'web-mcp-assistant', 'secrets.json'));
    assert.equal(paths.stateFile(), path.join(temp, 'state', 'web-mcp-assistant', 'runtime-state.json'));
    const expectedTunnel = process.arch === 'arm64'
      ? 'tunnel-client-linux-arm64'
      : 'tunnel-client';
    assert.equal(paths.tunnelExecutable(), path.join(paths.resourcesRoot(), 'tools', expectedTunnel));
  } finally {
    if (oldConfig === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = oldConfig;
    if (oldState === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = oldState;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('settings normalize to Linux-only schema', () => {
  const value = normalize({
    configVersion: 5,
    workspace: '/home/User/project/',
    proxyMode: 'system',
    startWithWindows: true,
    keepRunningOnClose: true,
    autoStartServices: 1
  });
  assert.equal(value.configVersion, 6);
  assert.equal(value.workspace, '/home/User/project');
  assert.equal(value.proxyMode, 'environment');
  assert.equal(value.autoStartServices, true);
  assert.equal(Object.hasOwn(value, 'startWithWindows'), false);
  assert.equal(Object.hasOwn(value, 'keepRunningOnClose'), false);
  assert.notEqual(workspaceKey('/home/User/project'), workspaceKey('/home/user/project'));
});

test('runtime settings require Linux absolute paths', () => {
  const valid = normalize({ workspace: '/home/user/project' });
  assert.doesNotThrow(() => validateRuntimeSettings(valid));
  assert.throws(() => validateRuntimeSettings({ ...valid, workspace: 'relative/project' }), /Linux 绝对路径/);
});

test('SettingsStore persists normalized settings under XDG config', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'web-mcp-settings-'));
  const oldConfig = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = temp;
  try {
    const store = new SettingsStore();
    const saved = store.save({ proxyMode: 'environment', autoStartServices: true });
    assert.equal(saved.proxyMode, 'environment');
    assert.equal(saved.autoStartServices, true);
    assert.equal(store.load().proxyMode, 'environment');
    assert.equal(fs.existsSync(path.join(temp, 'web-mcp-assistant', 'settings.json')), true);
  } finally {
    if (oldConfig === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = oldConfig;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
