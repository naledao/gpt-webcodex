const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');

const { requestJson } = require('../src/services/httpClient');
const { GitHubReleaseResolver } = require('../src/services/githubReleaseResolver');
const {
  UpdateService,
  parseVersion,
  compareVersions,
  releaseInfo,
  validateElf
} = require('../src/services/updateService');

function fakeElf(arch, size = 4096) {
  const machine = arch === 'arm64' ? 183 : 62;
  const buffer = Buffer.alloc(size, 0x5a);
  buffer[0] = 0x7f;
  buffer.write('ELF', 1, 'ascii');
  buffer[4] = 2;
  buffer[5] = 1;
  buffer.writeUInt16LE(machine, 18);
  return buffer;
}

function releaseFor(binary, options = {}) {
  const arch = options.arch || 'x64';
  const name = `web-mcp-assistant-linux-${arch}`;
  return {
    tag_name: options.version || 'v0.1.8',
    html_url: 'https://github.com/naledao/gpt-webcodex/releases/tag/v0.1.8',
    published_at: '2026-08-28T00:00:00Z',
    draft: false,
    prerelease: false,
    immutable: true,
    assets: [{
      name,
      state: 'uploaded',
      size: binary.length,
      digest: `sha256:${crypto.createHash('sha256').update(binary).digest('hex')}`,
      browser_download_url: `https://github.com/naledao/gpt-webcodex/releases/download/v0.1.8/${name}`
    }]
  };
}

function responseStream(chunks, options = {}) {
  const stream = Readable.from(chunks);
  stream.statusCode = options.statusCode || 200;
  stream.headers = options.headers || {};
  stream.requestHost = options.requestHost || 'release-assets.githubusercontent.com';
  return stream;
}

test('semantic versions and stable GitHub Release metadata are validated', () => {
  assert.deepEqual(parseVersion('v1.2.3').numbers, [1, 2, 3]);
  assert.equal(compareVersions('0.1.8', '0.1.7'), 1);
  assert.equal(compareVersions('0.1.7', '0.1.7'), 0);
  assert.equal(compareVersions('0.2.0-beta.1', '0.2.0'), -1);
  assert.throws(() => compareVersions('latest', '0.1.7'), /无法比较版本/);

  const binary = fakeElf('x64');
  const info = releaseInfo(releaseFor(binary), 'x64', '0.1.7');
  assert.equal(info.latestVersion, '0.1.8');
  assert.equal(info.available, true);
  assert.equal(info.immutable, true);
  assert.equal(info.asset.name, 'web-mcp-assistant-linux-x64');
  assert.throws(() => releaseInfo({ ...releaseFor(binary), prerelease: true }, 'x64', '0.1.7'), /不是稳定发布/);
  assert.throws(() => releaseInfo({ ...releaseFor(binary), assets: [] }, 'x64', '0.1.7'), /缺少/);
});

test('HTTP client follows redirects and parses bounded JSON', async (t) => {
  const server = http.createServer((request, response) => {
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: '/metadata' });
      response.end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true, path: request.url }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const result = await requestJson(`http://127.0.0.1:${port}/redirect`);
  assert.deepEqual(result, { ok: true, path: '/metadata' });
});

test('walks stable releases newest-first until one contains the current Linux asset', async () => {
  const binary = fakeElf('x64');
  const requests = [];
  const releases = [
    {
      tag_name: 'v0.2.0', draft: false, prerelease: false,
      assets: [{ name: 'latest.yml', state: 'uploaded' }, { name: 'setup.exe', state: 'uploaded' }]
    },
    {
      tag_name: 'v0.2.0-beta.1', draft: false, prerelease: true,
      assets: [{ name: 'web-mcp-assistant-linux-x64', state: 'uploaded' }]
    },
    releaseFor(binary)
  ];
  const resolver = new GitHubReleaseResolver({
    requestJson: async (url) => {
      requests.push(url);
      return releases;
    }
  });

  const selected = await resolver.findLatest('web-mcp-assistant-linux-x64');
  assert.equal(selected.release.tag_name, 'v0.1.8');
  assert.equal(selected.inspected, 2);
  assert.match(requests[0], /releases\?per_page=100&page=1$/);
});

test('paginates release discovery and reports a missing Linux target', async () => {
  const binary = fakeElf('arm64');
  const pages = [
    [
      { tag_name: 'v0.3.0', draft: false, prerelease: false, assets: [] },
      { tag_name: 'v0.2.0', draft: false, prerelease: false, assets: [] }
    ],
    [releaseFor(binary, { arch: 'arm64' })]
  ];
  const resolver = new GitHubReleaseResolver({
    pageSize: 2,
    requestJson: async (url) => pages[Number(new URL(url).searchParams.get('page')) - 1] || []
  });
  const selected = await resolver.findLatest('web-mcp-assistant-linux-arm64');
  assert.equal(selected.release.tag_name, 'v0.1.8');
  assert.equal(selected.inspected, 3);

  const missing = new GitHubReleaseResolver({ requestJson: async () => pages[0] });
  await assert.rejects(
    missing.findLatest('web-mcp-assistant-linux-x64'),
    /没有找到包含 web-mcp-assistant-linux-x64 的稳定 Release；已检查 2 个 Release/
  );
});

test('does not fall back when the newest matching Linux asset has invalid metadata', async (t) => {
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'web-mcp-update-invalid-release-'));
  t.after(() => fsp.rm(temporary, { recursive: true, force: true }));
  const binary = fakeElf('x64');
  const invalid = releaseFor(binary, { version: 'v0.2.0' });
  delete invalid.assets[0].digest;
  const updater = new UpdateService({
    currentVersion: '0.1.7',
    arch: 'x64',
    platform: 'linux',
    native: false,
    stateFile: path.join(temporary, 'update-state.json'),
    requestJson: async () => [invalid, releaseFor(binary)]
  });

  await assert.rejects(updater.check({ force: true }), /缺少有效的 SHA-256 digest/);
});

test('UpdateService downloads, verifies and atomically installs the matching ELF', async (t) => {
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'web-mcp-update-'));
  t.after(() => fsp.rm(temporary, { recursive: true, force: true }));
  const target = path.join(temporary, 'web-mcp-assistant');
  const oldBinary = Buffer.from('old-native-binary');
  const newBinary = fakeElf('x64', 8192);
  await fsp.writeFile(target, oldBinary, { mode: 0o755 });
  const release = releaseFor(newBinary);
  const progress = [];
  const updater = new UpdateService({
    currentVersion: '0.1.7',
    arch: 'x64',
    platform: 'linux',
    execPath: target,
    native: true,
    updateRoot: path.join(temporary, 'state', 'updates'),
    stateFile: path.join(temporary, 'state', 'update-state.json'),
    logFile: path.join(temporary, 'state', 'logs', 'update.log'),
    managerStateDir: path.join(temporary, 'state'),
    requestJson: async () => [release],
    requestStream: async () => Readable.from([
      newBinary.subarray(0, 1024),
      newBinary.subarray(1024, 4096),
      newBinary.subarray(4096)
    ]),
    atomicReplace: async (source, destination) => {
      // Windows cannot rename over an existing destination. Production reaches
      // this hook only on Linux, where rename(2) performs the atomic replacement.
      await fsp.rm(destination, { force: true });
      await fsp.rename(source, destination);
    },
    emitProgress: (payload) => progress.push(payload)
  });

  const checked = await updater.check({ force: true });
  assert.equal(checked.available, true);
  assert.equal(checked.canApply, true);
  assert.equal(checked.latestVersion, '0.1.8');

  const downloaded = await updater.download();
  assert.equal(downloaded.staged, true);
  assert.equal(downloaded.stagedVersion, '0.1.8');
  await validateElf(updater.readState().stagedPath, 'x64');

  const installed = await updater.install({ restart: false });
  assert.equal(installed.installed, true);
  assert.equal(installed.restartScheduled, false);
  assert.deepEqual(await fsp.readFile(target), newBinary);
  assert.deepEqual(await fsp.readFile(`${target}.previous`), oldBinary);
  assert.ok(progress.some((item) => item.stage === 'downloaded'));
  assert.ok(progress.some((item) => item.stage === 'installed'));
});

test('UpdateService resumes with Range after a transient socket reset', async (t) => {
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'web-mcp-update-resume-'));
  t.after(() => fsp.rm(temporary, { recursive: true, force: true }));
  const binary = fakeElf('x64', 16 * 1024);
  const release = releaseFor(binary);
  const ranges = [];
  const warnings = [];
  const sleeps = [];
  let requestCount = 0;
  const updater = new UpdateService({
    currentVersion: '0.1.7', arch: 'x64', platform: 'linux', native: false,
    updateRoot: path.join(temporary, 'updates'), stateFile: path.join(temporary, 'update-state.json'),
    requestJson: async () => [release],
    requestStream: async (_url, options) => {
      requestCount += 1;
      ranges.push(options.headers.Range || '');
      if (requestCount === 1) {
        return responseStream((async function* interrupted() {
          yield binary.subarray(0, 4096);
          const error = new Error('socket hang up');
          error.code = 'ECONNRESET';
          error.requestHost = 'github.com';
          throw error;
        })());
      }
      return responseStream([binary.subarray(4096)], {
        statusCode: 206,
        headers: { 'content-range': `bytes 4096-${binary.length - 1}/${binary.length}` }
      });
    },
    log: { info: () => {}, warn: (message, meta) => warnings.push({ message, meta }) },
    sleep: async (milliseconds) => sleeps.push(milliseconds),
    downloadRetryBaseMs: 25
  });

  await updater.check({ force: true });
  const status = await updater.download();
  assert.equal(status.staged, true);
  assert.deepEqual(ranges, ['', 'bytes=4096-']);
  assert.deepEqual(sleeps, [25]);
  assert.equal(warnings[0].meta.code, 'ECONNRESET');
  assert.equal(warnings[0].meta.received, 4096);
  assert.deepEqual(await fsp.readFile(updater.readState().stagedPath), binary);
});

test('UpdateService keeps and resumes a digest-scoped partial file across service instances', async (t) => {
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'web-mcp-update-restart-resume-'));
  t.after(() => fsp.rm(temporary, { recursive: true, force: true }));
  const binary = fakeElf('x64', 12 * 1024);
  const release = releaseFor(binary);
  const updateRoot = path.join(temporary, 'updates');
  const stateFile = path.join(temporary, 'update-state.json');
  const first = new UpdateService({
    currentVersion: '0.1.7', arch: 'x64', platform: 'linux', native: false,
    updateRoot, stateFile, requestJson: async () => [release]
  });
  await first.check({ force: true });

  const asset = first.readState().asset;
  const partial = path.join(updateRoot, 'v0.1.8', `${asset.name}.${asset.sha256.slice(0, 12)}.part`);
  await fsp.mkdir(path.dirname(partial), { recursive: true });
  await fsp.writeFile(partial, binary.subarray(0, 3072), { mode: 0o600 });

  let requestedRange = '';
  const restarted = new UpdateService({
    currentVersion: '0.1.7', arch: 'x64', platform: 'linux', native: false,
    updateRoot, stateFile,
    requestStream: async (_url, options) => {
      requestedRange = options.headers.Range || '';
      return responseStream([binary.subarray(3072)], {
        statusCode: 206,
        headers: { 'content-range': `bytes 3072-${binary.length - 1}/${binary.length}` }
      });
    }
  });
  const status = await restarted.download();
  assert.equal(requestedRange, 'bytes=3072-');
  assert.equal(status.staged, true);
  assert.equal(fs.existsSync(partial), false);
  assert.deepEqual(await fsp.readFile(restarted.readState().stagedPath), binary);
});

test('UpdateService rejects source mode, digest mismatches and wrong ELF architecture', async (t) => {
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'web-mcp-update-reject-'));
  t.after(() => fsp.rm(temporary, { recursive: true, force: true }));
  const target = path.join(temporary, 'web-mcp-assistant');
  await fsp.writeFile(target, 'old');
  const sourceUpdater = new UpdateService({
    currentVersion: '0.1.7', arch: 'x64', platform: 'linux', execPath: target, native: false,
    updateRoot: path.join(temporary, 'updates'), stateFile: path.join(temporary, 'update.json')
  });
  const capability = await sourceUpdater.capabilities();
  assert.equal(capability.canApply, false);
  assert.match(capability.applyReason, /源码运行模式/);

  const armFile = path.join(temporary, 'arm64');
  await fsp.writeFile(armFile, fakeElf('arm64'));
  await assert.rejects(validateElf(armFile, 'x64'), /架构不匹配/);

  const expected = fakeElf('x64');
  const corrupted = Buffer.from(expected);
  corrupted[128] ^= 0xff;
  const digestUpdater = new UpdateService({
    currentVersion: '0.1.7', arch: 'x64', platform: 'linux', execPath: target, native: false,
    updateRoot: path.join(temporary, 'digest-updates'), stateFile: path.join(temporary, 'digest-state.json'),
    requestJson: async () => [releaseFor(expected)],
    requestStream: async () => Readable.from([corrupted])
  });
  await digestUpdater.check({ force: true });
  await assert.rejects(digestUpdater.download(), /SHA-256/);
});
