const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('Windows build contains only the local management renderer', () => {
  for (const relative of [
    'electron/chatViewController.js',
    'electron/browserPreload.js',
    'electron/services/downloadService.js',
    'renderer/browser.html',
    'renderer/browser.js',
    'renderer/browser.css'
  ]) assert.equal(fs.existsSync(path.join(root, relative)), false, relative);

  const main = read('electron/main.js');
  assert.doesNotMatch(main, /ChatViewController|WebContentsView|chatWindow|persist:chatgpt-session|browserPreload|browser\.html|chat:navigate|chat:status|chat:clear-session/);
  assert.match(main, /openManagerWindow\(\)/);
  assert.match(main, /loadFile\(path\.join\(__dirname, '\.\.', 'renderer', 'index\.html'\)/);
  assert.match(main, /app\.on\('second-instance', \(\) => openManagerWindow\(\)\)/);
  assert.match(main, /app\.on\('activate', \(\) => openManagerWindow\(\)\)/);
});

test('management window owns close behavior and preserves Windows runtime controls', () => {
  const main = read('electron/main.js');
  assert.match(main, /settings\.load\(\)\.keepRunningOnClose/);
  assert.match(main, /orchestrator\.stop\(\)/);
  assert.match(main, /app\.setLoginItemSettings/);
  assert.match(main, /winget\.exe/);
  assert.match(main, /shell\.openExternal\(urls\[target\]\)/);
  assert.match(main, /chatgpt\.com\/#settings\/Connectors/);
});

test('management UI has no embedded ChatGPT session controls', () => {
  const html = read('renderer/index.html');
  const app = read('renderer/app.js');
  const preload = read('electron/preload.js');
  assert.match(html, /外部浏览器/);
  assert.match(html, /id="authorizedRootsList"/);
  assert.match(app, /updateAuthorizedRoots/);
  assert.doesNotMatch(`${html}\n${app}\n${preload}`, /clearChatSession|ChatGPT 登录数据|内联网页/);
});
