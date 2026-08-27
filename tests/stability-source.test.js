const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('smart mode keeps a fixed compact tool surface with hidden compatibility', () => {
  const server = read('resources/coding-tools-mcp/coding_tools_mcp/server.py');
  const block = server.match(/"smart": frozenset\(\{([\s\S]*?)\}\),/)?.[1] || '';
  const tools = [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(tools.sort(), [
    'agent_workflow', 'command_control', 'document_workflow', 'exec_command',
    'request_permissions', 'task_control', 'view_image', 'workspace_context'
  ].sort());
  assert.match(server, /SMART_COMPAT_TOOL_NAMES/);
  assert.match(server, /compatibility_call/);
  assert.match(server, /_tools_list_payload/);
  const workflowSchema = server.match(/"agent_workflow": object_schema\(\{([\s\S]*?)\n\s*\}\),\n\s*"workspace_context"/)?.[1] || '';
  assert.doesNotMatch(workflowSchema, /"max_total_bytes"/);
  assert.doesNotMatch(workflowSchema, /"max_diff_bytes"/);
  assert.doesNotMatch(workflowSchema, /"force_refresh"/);
});

test('HTTP sessions share one runtime and expose protocol health', () => {
  const transport = read('resources/coding-tools-mcp/coding_tools_mcp/transport_http.py');
  const server = read('resources/coding-tools-mcp/coding_tools_mcp/server.py');
  assert.match(transport, /Route all authenticated HTTP sessions through one shared Runtime/);
  assert.match(transport, /MAX_TRACKED_SESSION_ALIASES = 512/);
  assert.match(server, /HTTPSessionManager\(control_runtime\)/);
  assert.match(server, /__control\/health/);
  assert.match(server, /__control\/workspace/);
});

test('desktop runtime restarts workspace connections so ChatGPT reloads instructions', () => {
  const orchestrator = read('electron/services/runtimeOrchestrator.js');
  assert.doesNotMatch(orchestrator, /switchMcpWorkspace/);
  assert.match(orchestrator, /正在重启 MCP 与 Tunnel，以刷新 ChatGPT 项目指令/);
  assert.match(orchestrator, /workspace-reinitialized/);
  assert.match(orchestrator, /async supervise\(\)/);
});

test('startup failure cleans runtime state and blocks automatic recovery until manual retry', () => {
  const orchestrator = read('electron/services/runtimeOrchestrator.js');
  const main = read('electron/main.js');
  assert.match(orchestrator, /autoRecoveryBlocked/);
  assert.match(orchestrator, /lastStartFailure/);
  assert.match(orchestrator, /await this\.tunnel\.stop\(\)\.catch/);
  assert.match(orchestrator, /await this\.native\.stop\(\)\.catch/);
  assert.match(orchestrator, /if \(this\.autoRecoveryBlocked\)/);
  assert.match(orchestrator, /restart\(\{ automatic: true \}\)/);
  assert.match(orchestrator, /Coding Tools MCP 进程已提前退出/);
  assert.match(main, /start\(\{ automatic: true \}\)/);
});
