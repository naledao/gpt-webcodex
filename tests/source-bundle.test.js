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
  assert.equal(fs.existsSync(path.join(root, 'scripts')), false);
  for (const file of ['browser.html', 'browser.js', 'browser.css']) {
    assert.equal(fs.existsSync(path.join(root, 'renderer', file)), false);
  }
  assert.equal(fs.existsSync(path.join(root, 'web', 'server.js')), true);
  assert.equal(fs.existsSync(path.join(root, 'renderer', 'web-api.js')), true);

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
  assert.equal(pkg.scripts.test, 'node --test tests/*.test.js');
  assert.equal(pkg.main, undefined);
  assert.equal(pkg.build, undefined);
  assert.equal(Object.keys(pkg.dependencies || {}).some((name) => name.includes('electron')), false);
  assert.equal(Object.keys(pkg.devDependencies || {}).some((name) => name.includes('electron')), false);
});

test('Web API surface and loopback binding are declared', () => {
  const server = fs.readFileSync(path.join(root, 'web', 'server.js'), 'utf8');
  const api = fs.readFileSync(path.join(root, 'renderer', 'web-api.js'), 'utf8');
  assert.match(server, /const HOST = '127\.0\.0\.1'/);
  for (const endpoint of [
    '/api/snapshot', '/api/settings', '/api/workspace/switch', '/api/workspace/roots',
    '/api/secrets/runtime-key', '/api/secrets/mcp-token/regenerate',
    '/api/runtime/start', '/api/runtime/stop', '/api/runtime/restart',
    '/api/logs', '/api/task-state', '/api/task-history',
    '/api/build', '/api/build/run', '/api/health', '/api/health/repair', '/api/events'
  ]) assert.ok(server.includes(endpoint), endpoint);
  for (const event of ['runtime:progress', 'runtime:status', 'runtime:heartbeat', 'logs:entry', 'build:progress']) {
    assert.ok(`${server}\n${api}`.includes(event), event);
  }
});
