const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runtimeFingerprint, currentRuntimeState } = require('../electron/services/nativeService');
const { normalizeProxyValue } = require('../electron/services/proxyService');
const { RuntimeOrchestrator } = require('../electron/services/runtimeOrchestrator');

test('native runtime identity changes with workspace and port while tool mode stays smart', () => {
  const base = { workspace: 'C:\\work\\one', mcpPort: 18765, permissionMode: 'safe' };
  assert.equal(runtimeFingerprint(base), runtimeFingerprint({ ...base }));
  assert.notEqual(runtimeFingerprint(base), runtimeFingerprint({ ...base, workspace: 'C:\\work\\two' }));
  assert.notEqual(runtimeFingerprint(base), runtimeFingerprint({ ...base, mcpPort: 18766 }));
  assert.notEqual(runtimeFingerprint(base), runtimeFingerprint({ ...base, authorizedRoots: ['D:\\shared'] }));
  assert.notEqual(runtimeFingerprint(base), runtimeFingerprint({ ...base, globalAgentsEnabled: true }));
  assert.equal(runtimeFingerprint(base), runtimeFingerprint({ ...base, toolMode: 'readonly' }));
});

test('proxy values from Windows settings are normalized', () => {
  assert.equal(normalizeProxyValue('127.0.0.1:7890'), 'http://127.0.0.1:7890');
  assert.equal(normalizeProxyValue('http=127.0.0.1:8080;https=127.0.0.1:7890'), 'http://127.0.0.1:7890');
  assert.equal(normalizeProxyValue('http://user:pass@127.0.0.1:7890'), '');
});

test('background runtime processes are hidden and never detached on Windows', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(__dirname, '..');
  for (const relative of ['electron/services/nativeService.js', 'electron/services/tunnelService.js']) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    assert.match(source, /windowsHide:\s*true/);
    assert.match(source, /detached:\s*false/);
    assert.doesNotMatch(source, /detached:\s*true/);
  }
  const runner = fs.readFileSync(path.join(root, 'electron/services/commandRunner.js'), 'utf8');
  assert.doesNotMatch(runner, /spawnDetached/);
  const mcpServer = fs.readFileSync(path.join(root, 'resources/coding-tools-mcp/coding_tools_mcp/server.py'), 'utf8');
  assert.match(mcpServer, /CREATE_NO_WINDOW/);
  assert.match(mcpServer, /encoding="utf-8"/);
});

test('runtime state migration keeps only current native and tunnel fields', () => {
  assert.deepEqual(currentRuntimeState({ nativePid: 1, tunnelPid: 2, obsoletePid: 3 }), { nativePid: 1, tunnelPid: 2 });
});

test('workspace switch restarts services to refresh MCP initialization instructions', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gpt-webcodex-workspace-switch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const previousWorkspace = path.join(root, 'previous');
  const nextWorkspace = path.join(root, 'next');
  fs.mkdirSync(previousWorkspace);
  fs.mkdirSync(nextWorkspace);
  let current = {
    workspace: previousWorkspace,
    recentWorkspaces: [previousWorkspace],
    mcpPort: 18765,
    healthPort: 18081
  };
  const progress = [];
  const orchestrator = new RuntimeOrchestrator({
    settings: {
      load: () => ({ ...current }),
      save: (patch) => { current = { ...current, ...patch }; return { ...current }; }
    },
    secrets: { get: () => '', set: () => {}, status: () => ({}) },
    environment: { inspect: async () => ({}) },
    log: { info: (message) => progress.push(message), error: () => {}, warn: () => {} },
    emitProgress: () => {}
  });
  orchestrator.native.status = async () => true;
  orchestrator.tunnel.status = async () => true;
  let restarts = 0;
  orchestrator.restart = async () => { restarts += 1; return {}; };
  orchestrator.snapshot = async (options) => ({ reason: options.reason, workspace: current.workspace });

  const result = await orchestrator.switchWorkspace(nextWorkspace);

  assert.equal(restarts, 1);
  assert.equal(current.workspace, nextWorkspace);
  assert.equal(result.reason, 'workspace-reinitialized');
  assert.ok(progress.some((message) => message.includes('刷新 ChatGPT 项目指令')));
});
