const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { normalize, DEFAULTS } = require('../electron/services/config');
const { runtimeFingerprint } = require('../electron/services/nativeService');

const root = path.resolve(__dirname, '..');

test('allowAllDirectories setting normalizes correctly', () => {
  assert.equal(DEFAULTS.allowAllDirectories, false);
  assert.equal(normalize({}).allowAllDirectories, false);
  assert.equal(normalize({ allowAllDirectories: true }).allowAllDirectories, true);
  assert.equal(normalize({ allowAllDirectories: false }).allowAllDirectories, false);
  assert.equal(normalize({ allowAllDirectories: 'yes' }).allowAllDirectories, true);
  assert.equal(normalize({ allowAllDirectories: 0 }).allowAllDirectories, false);
});

test('runtimeFingerprint changes when allowAllDirectories changes', () => {
  const base = {
    workspace: 'C:\codes\my-project',
    globalAgentsEnabled: false,
    authorizedRoots: [],
    mcpPort: 18765,
    permissionMode: 'safe'
  };
  const fpFalse = runtimeFingerprint({ ...base, allowAllDirectories: false });
  const fpTrue = runtimeFingerprint({ ...base, allowAllDirectories: true });
  assert.notEqual(fpFalse, fpTrue);
});

test('UI and IPC bindings for allowAllDirectories are established', () => {
  const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
  assert.match(html, /id="toggleAllowAllDirectories"/);
  assert.match(html, /id="addAuthorizedRoot"/);

  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.js'), 'utf8');
  assert.match(preload, /setAllowAllDirectories:\s*\(enabled\)\s*=>/);

  const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  assert.match(main, /secureHandle\('workspace:allow-all-directories'/);

  const appJs = fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8');
  assert.match(appJs, /toggleAllowAllDirectories/);
  assert.match(appJs, /api\.setAllowAllDirectories/);
  assert.match(appJs, /addRootBtn\.disabled\s*=\s*Boolean\(allowAllDirectories\)/);
});

test('Python MCP Workspace respects allow_all_directories flag', () => {
  const portable = path.join(root, 'resources', 'native-python', 'python.exe');
  if (!fs.existsSync(portable)) return;

  const script = `
import tempfile, pathlib, sys
sys.path.insert(0, 'resources/coding-tools-mcp')
from coding_tools_mcp.server import Workspace, ToolFailure

w1 = pathlib.Path(tempfile.mkdtemp()).resolve()
w2 = pathlib.Path(tempfile.mkdtemp()).resolve()
outside_file = w2 / "external.txt"
outside_file.write_text("hello outside", encoding="utf-8")

ws_restricted = Workspace(w1, allow_all_directories=False)
assert not ws_restricted._is_allowed(outside_file)
try:
    ws_restricted.resolve_existing(str(outside_file))
    raise AssertionError("Should have raised ToolFailure")
except ToolFailure as exc:
    assert exc.code == "PATH_OUTSIDE_WORKSPACE"

ws_open = Workspace(w1, allow_all_directories=True)
assert ws_open._is_allowed(outside_file)
resolved = ws_open.resolve_existing(str(outside_file))
assert resolved.path.resolve() == outside_file.resolve()

print("ALL_DIRECTORIES_VERIFIED")
`;

  const result = spawnSync(portable, ['-c', script], {
    cwd: root,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ALL_DIRECTORIES_VERIFIED/);
});
