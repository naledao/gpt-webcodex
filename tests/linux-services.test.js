const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const paths = require('../src/paths');
const { SecretStore } = require('../src/services/secretStore');
const { normalizeProxyValue, environmentProxyCandidates } = require('../src/services/proxyService');

function source(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

test('secrets are stored locally and API-facing status never contains plaintext', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'web-mcp-secrets-'));
  const oldConfig = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = temp;
  try {
    const store = new SecretStore();
    store.set('runtimeApiKey', 'sk-test-secret-value');
    store.set('mcpAuthToken', 'local-token-secret');
    assert.deepEqual(store.status(), { runtimeApiKey: true, mcpAuthToken: true });
    assert.equal(store.get('runtimeApiKey'), 'sk-test-secret-value');
    const file = paths.secretsFile();
    const raw = fs.readFileSync(file, 'utf8');
    assert.match(raw, /sk-test-secret-value/);
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
      assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
    }
  } finally {
    if (oldConfig === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = oldConfig;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('Linux process, Python and shell rules are present', () => {
  const processSource = source('src/services/processService.js');
  const environmentSource = source('src/services/environmentService.js');
  const buildSource = source('src/services/buildVerificationService.js');
  assert.match(processSource, /SIGTERM/);
  assert.match(processSource, /SIGKILL/);
  assert.match(environmentSource, /\['python3', 'python'\]/);
  assert.match(buildSource, /run\('\/bin\/sh', \['-lc', command\]/);
  for (const forbidden of ['where.exe', 'taskkill.exe', 'cmd.exe', 'reg.exe', 'netsh.exe']) {
    assert.equal(`${processSource}\n${environmentSource}\n${buildSource}`.includes(forbidden), false, forbidden);
  }
});

test('proxy parsing uses environment/manual HTTP(S) values without credentials', () => {
  assert.equal(normalizeProxyValue('127.0.0.1:7897'), 'http://127.0.0.1:7897');
  assert.equal(normalizeProxyValue('http://user:pass@127.0.0.1:7897'), '');
  const previous = process.env.HTTPS_PROXY;
  process.env.HTTPS_PROXY = 'http://127.0.0.1:7897';
  try {
    assert.ok(environmentProxyCandidates().includes('http://127.0.0.1:7897'));
  } finally {
    if (previous === undefined) delete process.env.HTTPS_PROXY; else process.env.HTTPS_PROXY = previous;
  }
});
