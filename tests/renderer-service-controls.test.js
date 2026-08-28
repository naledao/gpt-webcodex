const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('overview exposes a visible stop-service control wired to the runtime', () => {
  const html = read('renderer/index.html');
  const renderer = read('renderer/app.js');
  const preload = read('electron/preload.js');
  const main = read('electron/main.js');

  assert.match(html, /<div class="overview-hero-actions">[\s\S]*?id="overviewStop"[\s\S]*?停止服务[\s\S]*?<\/div>/);
  assert.equal((html.match(/id="overviewStop"/g) || []).length, 1);
  assert.match(renderer, /#overviewStop'\)\.addEventListener\('click', \(\) => runRuntime\('stop'\)\)/);
  assert.match(renderer, /stopButton\.disabled = state\.busy \|\| !runtimeActive/);
  assert.match(preload, /stop: \(\) => ipcRenderer\.invoke\('runtime:stop'\)/);
  assert.match(main, /secureHandle\('runtime:stop'/);
});
