const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');

test('all app icon surfaces use the single generated icon source', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  assert.equal(pkg.build.win.icon, 'electron/app-icon.ico');
  assert.equal(pkg.build.nsis.installerIcon, 'electron/app-icon.ico');
  assert.equal(pkg.build.nsis.uninstallerIcon, 'electron/app-icon.ico');
  assert.equal(pkg.build.nsis.installerHeaderIcon, 'electron/app-icon.ico');
  assert.equal(pkg.build.nsis.createDesktopShortcut, 'always');
  assert.match(main, /app-icon\.png/);
  assert.doesNotMatch(main, /tray\.png/);
  assert.doesNotMatch(JSON.stringify(pkg), /build\/icon\.png/);
});

test('legacy icon files are not used as build inputs', () => {
  assert.equal(fs.existsSync(path.join(root, 'electron', 'tray.png')), false);
  assert.equal(fs.existsSync(path.join(root, 'build', 'icon.png')), false);
});
