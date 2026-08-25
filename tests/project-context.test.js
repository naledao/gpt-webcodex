const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { inspectGlobalAgents } = require('../electron/services/globalAgentsService');

const root = path.resolve(__dirname, '..');

test('global AGENTS status follows override precedence without exposing file content', (t) => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gpt-webcodex-agents-'));
  t.after(() => fs.rmSync(codexHome, { recursive: true, force: true }));
  fs.writeFileSync(path.join(codexHome, 'AGENTS.override.md'), '  \n', 'utf8');
  fs.writeFileSync(path.join(codexHome, 'AGENTS.md'), 'standard rule', 'utf8');

  const disabled = inspectGlobalAgents(
    { globalAgentsEnabled: false },
    { CODEX_HOME: codexHome },
    codexHome
  );
  assert.equal(disabled.exists, false);
  assert.equal(disabled.source, '');

  const standard = inspectGlobalAgents(
    { globalAgentsEnabled: true },
    { CODEX_HOME: codexHome },
    codexHome
  );
  assert.equal(standard.enabled, true);
  assert.equal(standard.source, 'AGENTS.md');
  assert.equal(Object.hasOwn(standard, 'content'), false);

  fs.writeFileSync(path.join(codexHome, 'AGENTS.override.md'), 'override rule', 'utf8');
  const override = inspectGlobalAgents(
    { globalAgentsEnabled: true },
    { CODEX_HOME: codexHome },
    codexHome
  );
  assert.equal(override.source, 'AGENTS.override.md');
});

test('available Python verifies global and project instruction merging', () => {
  const portable = path.join(root, 'resources', 'native-python', 'python.exe');
  const portableExists = fs.existsSync(portable);
  const command = portableExists ? portable : process.platform === 'win32' ? 'py.exe' : 'python3';
  const prefixArgs = !portableExists && process.platform === 'win32' ? ['-3'] : [];
  const result = spawnSync(command, [
    ...prefixArgs,
    '-m', 'unittest', 'discover',
    '-s', 'resources/coding-tools-mcp/tests',
    '-p', 'test_project_context.py'
  ], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONPATH: [
        path.join(root, 'resources', 'coding-tools-mcp', 'python_vendor'),
        path.join(root, 'resources', 'coding-tools-mcp'),
        process.env.PYTHONPATH || ''
      ].filter(Boolean).join(path.delimiter)
    }
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
