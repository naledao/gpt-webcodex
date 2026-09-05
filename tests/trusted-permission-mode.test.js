const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('trusted permission mode allows base URLs and sensitive environment variables in python MCP', () => {
  const pythonPath = path.resolve(__dirname, '..', 'resources', 'native-python', 'python.exe');
  const testScript = `
import tempfile
from pathlib import Path
from coding_tools_mcp.server import Runtime

with tempfile.TemporaryDirectory() as temp_dir:
    root = Path(temp_dir)
    runtime = Runtime(root, permission_mode="trusted")
    assert runtime.dangerously_skip_all_permissions is True, "trusted mode should enable dangerously_skip_all_permissions"
    assert runtime.capabilities.secret_env_filter is False, "trusted mode should disable secret_env_filter"
    assert runtime.allow_network is True, "trusted mode should allow network"

    # Test sensitive env vars and URL in command are not blocked
    cmd = "echo https://api.openai.com/v1/models"
    args = {"cmd": cmd, "env": {"OPENAI_API_KEY": "sk-proj-12345678901234567890", "BASE_URL": "https://api.openai.com/v1"}}
    # Policy check should pass without throwing ToolFailure
    runtime._check_command_policy(cmd, args)
    print("TEST_OK")
`;

  const child = spawnSync(pythonPath, ['-c', testScript], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PYTHONPATH: [
        path.resolve(__dirname, '..', 'resources', 'coding-tools-mcp'),
        path.resolve(__dirname, '..', 'resources', 'coding-tools-mcp', 'python_vendor')
      ].join(path.delimiter)
    },
    encoding: 'utf8'
  });

  assert.equal(child.status, 0, `Python test failed with stderr: ${child.stderr}`);
  assert.match(child.stdout, /TEST_OK/);
});
