const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { load: parseYaml } = require('js-yaml');

const pkg = require('../package.json');
const { annotateUpdateManifest } = require('../scripts/annotate-update-manifest');

test('annotates latest.yml with the Windows package target', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'web-mcp-manifest-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const installerName = `web-mcp-assistant-setup-${pkg.version}.exe`;
  fs.writeFileSync(path.join(directory, installerName), 'installer');
  fs.writeFileSync(path.join(directory, 'latest.yml'), [
    `version: ${pkg.version}`,
    'files:',
    `  - url: ${installerName}`,
    '    sha512: example',
    `path: ${installerName}`,
    'sha512: example'
  ].join('\n'));

  annotateUpdateManifest(directory, 'x64');
  const manifest = parseYaml(fs.readFileSync(path.join(directory, 'latest.yml'), 'utf8'));
  assert.deepEqual(manifest.updatePackages, [{
    platform: 'win32',
    arch: 'x64',
    type: 'nsis',
    file: installerName
  }]);
});
