const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { detectProject, collectArtifacts } = require('../src/services/buildVerificationService');

test('Node projects are detected without Electron semantics', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'web-mcp-build-'));
  try {
    fs.writeFileSync(path.join(temp, 'package.json'), JSON.stringify({
      name: 'demo', version: '1.2.3', scripts: { test: 'node --test', build: 'node build.js' }
    }));
    const project = detectProject(temp);
    assert.equal(project.type, 'node');
    assert.equal(project.name, 'demo');
    assert.equal(project.testCommand, 'npm run test');
    assert.equal(project.buildCommand, 'npm run build');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('artifact collection hashes files and blocks paths outside workspace', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'web-mcp-artifacts-'));
  try {
    const dist = path.join(temp, 'dist');
    fs.mkdirSync(dist);
    fs.writeFileSync(path.join(dist, 'app.txt'), 'hello');
    const artifacts = await collectArtifacts(temp, ['dist']);
    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0].path.replace(/\\/g, '/'), 'dist/app.txt');
    assert.match(artifacts[0].sha256, /^[A-F0-9]{64}$/);
    await assert.rejects(() => collectArtifacts(temp, ['../outside']), /工作目录内/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
