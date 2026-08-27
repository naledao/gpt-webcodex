const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function collectFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

test('runtime source is pure Linux Web and Electron assets are absent', () => {
  assert.equal(fs.existsSync(path.join(root, 'electron')), false);
  assert.equal(fs.existsSync(path.join(root, 'scripts', 'build-native.mjs')), true);
  assert.equal(fs.existsSync(path.join(root, 'scripts', 'build-native-arm64-wsl.mjs')), true);
  assert.equal(fs.existsSync(path.join(root, 'native', 'entry.js')), true);
  for (const file of ['browser.html', 'browser.js', 'browser.css']) {
    assert.equal(fs.existsSync(path.join(root, 'renderer', file)), false);
  }
  assert.equal(fs.existsSync(path.join(root, 'web', 'server.js')), true);
  assert.equal(fs.existsSync(path.join(root, 'renderer', 'web-api.js')), true);
  assert.equal(fs.existsSync(path.join(root, 'resources', 'tools', 'tunnel-client-linux-arm64')), true);

  const tools = path.join(root, 'resources', 'tools');
  const toolNames = fs.existsSync(tools) ? fs.readdirSync(tools) : [];
  assert.equal(toolNames.some((name) => name.toLowerCase().endsWith('.exe')), false);

  const runtimeFiles = [
    ...collectFiles(path.join(root, 'src')),
    ...collectFiles(path.join(root, 'web')),
    ...collectFiles(path.join(root, 'renderer'))
  ].filter((file) => /\.(js|html)$/.test(file));
  const source = runtimeFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  for (const forbidden of [
    "require('electron')", 'safeStorage', 'BrowserWindow', 'WebContentsView', 'ipcMain',
    'taskkill.exe', 'cmd.exe', 'where.exe', 'reg.exe', 'netsh.exe',
    'startWithWindows', 'keepRunningOnClose', 'clearChatSession', 'installPython'
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test('package scripts start the Web server and have no Electron dependencies', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.start, 'node web/server.js');
  assert.equal(pkg.scripts['build:native'], 'node scripts/build-native.mjs');
  assert.equal(pkg.scripts['build:native:arm64'], 'node scripts/build-native-arm64-wsl.mjs');
  assert.equal(pkg.scripts.test, 'node --test tests/*.test.js');
  assert.equal(pkg.main, undefined);
  assert.equal(pkg.build, undefined);
  assert.equal(Object.keys(pkg.dependencies || {}).some((name) => name.includes('electron')), false);
  assert.equal(Object.keys(pkg.devDependencies || {}).some((name) => name.includes('electron')), false);
  assert.equal(typeof pkg.devDependencies.esbuild, 'string');
  assert.equal(typeof pkg.devDependencies.postject, 'string');
});

test('native build embeds runtime assets and uses Node SEA', () => {
  const entry = fs.readFileSync(path.join(root, 'native', 'entry.js'), 'utf8');
  const buildScript = fs.readFileSync(path.join(root, 'scripts', 'build-native.mjs'), 'utf8');
  const arm64BuildScript = fs.readFileSync(path.join(root, 'scripts', 'build-native-arm64-wsl.mjs'), 'utf8');
  assert.match(entry, /getAssetKeys/);
  assert.match(entry, /WEB_MCP_RESOURCES_ROOT/);
  assert.match(buildScript, /--experimental-sea-config/);
  assert.match(buildScript, /NODE_SEA_BLOB/);
  assert.match(buildScript, /NATIVE_QEMU/);
  assert.match(arm64BuildScript, /qemu-aarch64-static/);
  assert.match(arm64BuildScript, /node-v.*-linux-arm64/);
  assert.match(arm64BuildScript, /Expected an ELF64 AArch64 executable/);
});

test('Web API surface and LAN binding are declared', () => {
  const server = fs.readFileSync(path.join(root, 'web', 'server.js'), 'utf8');
  const api = fs.readFileSync(path.join(root, 'renderer', 'web-api.js'), 'utf8');
  assert.match(server, /const DEFAULT_HOST = '0\.0\.0\.0'/);
  for (const endpoint of [
    '/api/auth/login', '/api/auth/logout',
    '/api/snapshot', '/api/settings', '/api/workspace/switch', '/api/workspace/roots',
    '/api/secrets/runtime-key', '/api/secrets/mcp-token/regenerate',
    '/api/runtime/start', '/api/runtime/stop', '/api/runtime/restart',
    '/api/logs', '/api/task-state', '/api/task-history',
    '/api/build', '/api/build/run', '/api/health', '/api/health/repair',
    '/api/update/status', '/api/update/check', '/api/update/download', '/api/update/apply', '/api/events'
  ]) assert.ok(server.includes(endpoint), endpoint);
  for (const file of ['login.html', 'login.css', 'login.js']) {
    assert.equal(fs.existsSync(path.join(root, 'renderer', file)), true, file);
  }
  for (const event of ['runtime:progress', 'runtime:status', 'runtime:heartbeat', 'logs:entry', 'build:progress', 'update:progress']) {
    assert.ok(`${server}\n${api}`.includes(event), event);
  }
});

test('native release exposes verified self-update and controller update paths', () => {
  const updater = fs.readFileSync(path.join(root, 'src', 'services', 'updateService.js'), 'utf8');
  const entry = fs.readFileSync(path.join(root, 'native', 'entry.js'), 'utf8');
  const control = fs.readFileSync(path.join(root, 'scripts', 'web-mcp-assistantctl'), 'utf8');
  for (const marker of ['SHA-256', 'validateElf', 'web-mcp-assistant-linux-x64', 'web-mcp-assistant-linux-arm64']) {
    assert.ok(updater.includes(marker), marker);
  }
  assert.match(entry, /--self-update/);
  assert.match(entry, /--web-mcp-update-restart-helper/);
  assert.match(control, /update_service/);
});
