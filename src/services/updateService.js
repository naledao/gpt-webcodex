const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const { isSea } = require('node:sea');

const packageJson = require('../../package.json');
const { requestJson, requestStream } = require('./httpClient');
const { GitHubReleaseResolver } = require('./githubReleaseResolver');
const { resolveProxy } = require('./proxyService');
const { readJson, writeJsonAtomic, ensureParent } = require('./jsonStore');
const { updateRoot, updateStateFile, updateLogFile, stateRoot } = require('../paths');

const RELEASES_API = 'https://api.github.com/repos/naledao/gpt-webcodex/releases';
const UPDATE_HELPER_FLAG = '--web-mcp-update-restart-helper';
const CHECK_CACHE_MS = 15 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const DOWNLOAD_MAX_ATTEMPTS = 6;
const DOWNLOAD_RETRY_BASE_MS = 1_000;
const MAX_ASSET_BYTES = 512 * 1024 * 1024;
const RETRYABLE_DOWNLOAD_CODES = new Set([
  'ECONNABORTED', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'EPIPE',
  'ETIMEDOUT', 'EAI_AGAIN', 'ENETDOWN', 'ENETRESET', 'ENETUNREACH',
  'ERR_DOWNLOAD_INCOMPLETE', 'ERR_HTTP2_GOAWAY_SESSION', 'ERR_HTTP2_STREAM_CANCEL',
  'ERR_STREAM_PREMATURE_CLOSE'
]);
const RETRYABLE_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const DISCARD_PART_CODES = new Set([
  'ERR_DOWNLOAD_INTEGRITY', 'ERR_INVALID_CONTENT_RANGE', 'ERR_INVALID_RESUME_STATUS'
]);
const ARCHITECTURES = Object.freeze({
  x64: { asset: 'web-mcp-assistant-linux-x64', machine: 62 },
  arm64: { asset: 'web-mcp-assistant-linux-arm64', machine: 183 }
});

function parseVersion(value) {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    text: `${match[1]}.${match[2]}.${match[3]}${match[4] ? `-${match[4]}` : ''}`,
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] || ''
  };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error(`无法比较版本：${left} / ${right}`);
  for (let index = 0; index < a.numbers.length; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] > b.numbers[index] ? 1 : -1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, 'en', { numeric: true });
}

function expectedAsset(arch) {
  const value = ARCHITECTURES[arch];
  if (!value) throw new Error(`更新器不支持当前架构：${arch}`);
  return value;
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(file);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function validateElf(file, arch) {
  const descriptor = await fsp.open(file, 'r');
  try {
    const header = Buffer.alloc(20);
    const { bytesRead } = await descriptor.read(header, 0, header.length, 0);
    if (bytesRead < header.length
      || header[0] !== 0x7f || header.subarray(1, 4).toString('ascii') !== 'ELF'
      || header[4] !== 2 || header[5] !== 1) {
      throw new Error('下载内容不是受支持的 ELF64 little-endian 可执行文件。');
    }
    const machine = header.readUInt16LE(18);
    if (machine !== expectedAsset(arch).machine) {
      throw new Error(`下载的 ELF 架构不匹配：期望 ${arch}，machine=${machine}。`);
    }
  } finally {
    await descriptor.close();
  }
}

function releaseInfo(release, arch, currentVersion) {
  if (!release || typeof release !== 'object') throw new Error('GitHub Release 元数据为空。');
  if (release.draft || release.prerelease) throw new Error('选中的 GitHub Release 不是稳定发布。');
  const parsed = parseVersion(release.tag_name);
  if (!parsed || parsed.prerelease) throw new Error(`GitHub Release 标签不是稳定语义版本：${release.tag_name || 'unknown'}`);
  const expected = expectedAsset(arch);
  const asset = (Array.isArray(release.assets) ? release.assets : [])
    .find((item) => item?.name === expected.asset && item?.state === 'uploaded');
  if (!asset) throw new Error(`Release ${release.tag_name} 缺少 ${expected.asset}。`);
  const digest = String(asset.digest || '').match(/^sha256:([a-f0-9]{64})$/i)?.[1]?.toLowerCase();
  if (!digest) throw new Error(`Release 资产 ${asset.name} 缺少有效的 SHA-256 digest。`);
  const size = Number(asset.size);
  if (!Number.isSafeInteger(size) || size < 1024 || size > MAX_ASSET_BYTES) {
    throw new Error(`Release 资产大小异常：${asset.size}。`);
  }
  let downloadUrl;
  try { downloadUrl = new URL(asset.browser_download_url); } catch { throw new Error('Release 资产下载地址无效。'); }
  if (downloadUrl.protocol !== 'https:' || !['github.com', 'api.github.com'].includes(downloadUrl.hostname)) {
    throw new Error('Release 资产下载地址不属于 GitHub。');
  }
  return {
    latestVersion: parsed.text,
    tagName: release.tag_name,
    releaseUrl: String(release.html_url || ''),
    publishedAt: String(release.published_at || ''),
    immutable: release.immutable === true,
    available: compareVersions(parsed.text, currentVersion) > 0,
    asset: {
      name: asset.name,
      size,
      sha256: digest,
      downloadUrl: downloadUrl.href
    }
  };
}

async function defaultAtomicReplace(source, target) {
  await fsp.rename(source, target);
}

function errorCode(error) {
  return String(error?.code || error?.cause?.code || 'ERR_DOWNLOAD_FAILED');
}

function retryableDownloadError(error) {
  const code = errorCode(error);
  if (RETRYABLE_DOWNLOAD_CODES.has(code)) return true;
  if (code === 'ERR_GITHUB_HTTP_STATUS' && RETRYABLE_HTTP_STATUS.has(Number(error?.statusCode))) return true;
  return /socket hang up|premature close|connection (?:reset|closed)|网络请求超时|响应读取超时/i.test(String(error?.message || ''));
}

function incompleteDownload(received, expected) {
  const error = new Error(`下载提前结束：期望 ${expected}，实际 ${received}。`);
  error.code = 'ERR_DOWNLOAD_INCOMPLETE';
  return error;
}

function contentRange(value) {
  const match = String(value || '').match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
  if (!match) return null;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: match[3] === '*' ? null : Number(match[3])
  };
}

async function writeAll(file, buffer, position) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await file.write(buffer, offset, buffer.length - offset, position + offset);
    if (!bytesWritten) throw new Error('无法继续写入更新暂存文件。');
    offset += bytesWritten;
  }
}

class UpdateService {
  constructor(options = {}) {
    this.currentVersion = options.currentVersion || packageJson.version;
    this.arch = options.arch || process.arch;
    this.platform = options.platform || process.platform;
    this.execPath = path.resolve(options.execPath || process.execPath);
    this.native = options.native ?? isSea();
    this.settingsStore = options.settingsStore || null;
    this.log = options.log || null;
    this.emitProgress = options.emitProgress || (() => {});
    this.requestJson = options.requestJson || requestJson;
    this.requestStream = options.requestStream || requestStream;
    this.releaseResolver = options.releaseResolver || new GitHubReleaseResolver({
      requestJson: this.requestJson,
      log: this.log
    });
    this.spawn = options.spawn || spawn;
    this.atomicReplace = options.atomicReplace || defaultAtomicReplace;
    this.updateRoot = options.updateRoot || updateRoot();
    this.stateFile = options.stateFile || updateStateFile();
    this.logFile = options.logFile || updateLogFile();
    this.managerStateDir = options.managerStateDir || stateRoot();
    this.now = options.now || (() => Date.now());
    this.sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.downloadMaxAttempts = Math.max(1, Number(options.downloadMaxAttempts) || DOWNLOAD_MAX_ATTEMPTS);
    this.downloadRetryBaseMs = Math.max(0, Number(options.downloadRetryBaseMs ?? DOWNLOAD_RETRY_BASE_MS));
  }

  progress(stage, percent, message, extra = {}) {
    const payload = { stage, percent, message, time: new Date(this.now()).toISOString(), ...extra };
    try { this.emitProgress(payload); } catch { /* progress reporting must not break an update */ }
    try { if (this.log) this.log.info(message, { stage, percent }); } catch { /* state remains authoritative */ }
    return payload;
  }

  readState() {
    return readJson(this.stateFile, {});
  }

  writeState(patch) {
    const next = { ...this.readState(), ...patch, updatedAt: new Date(this.now()).toISOString() };
    writeJsonAtomic(this.stateFile, next);
    return next;
  }

  async capabilities() {
    let canApply = true;
    let reason = '';
    if (!this.native) {
      canApply = false;
      reason = '源码运行模式不会替换系统 Node.js；请构建或安装原生 ELF。';
    } else if (this.platform !== 'linux') {
      canApply = false;
      reason = '原生自动更新当前仅支持 Linux。';
    } else if (!ARCHITECTURES[this.arch]) {
      canApply = false;
      reason = `不支持当前架构：${this.arch}。`;
    } else {
      try {
        await fsp.access(this.execPath, fs.constants.R_OK);
        await fsp.access(path.dirname(this.execPath), fs.constants.W_OK);
      } catch {
        canApply = false;
        reason = `当前用户无权替换 ${this.execPath}；请使用控制脚本或管理员权限手动更新。`;
      }
    }
    return {
      currentVersion: this.currentVersion,
      architecture: this.arch,
      native: this.native,
      canApply,
      applyReason: reason
    };
  }

  async status() {
    const saved = this.readState();
    const staged = Boolean(saved.stagedPath && fs.existsSync(saved.stagedPath));
    return {
      ...await this.capabilities(),
      checkedAt: saved.checkedAt || '',
      latestVersion: saved.latestVersion || '',
      tagName: saved.tagName || '',
      releaseUrl: saved.releaseUrl || '',
      publishedAt: saved.publishedAt || '',
      immutable: saved.immutable === true,
      inspectedReleases: Number(saved.inspectedReleases) || 0,
      available: saved.available === true,
      asset: saved.asset ? {
        name: saved.asset.name,
        size: saved.asset.size,
        sha256: saved.asset.sha256
      } : null,
      staged,
      stagedVersion: staged ? saved.stagedVersion || '' : '',
      phase: saved.phase || 'idle',
      error: saved.error || '',
      errorCode: saved.errorCode || '',
      downloadReceived: Number(saved.downloadReceived) || 0,
      downloadAttempt: Number(saved.downloadAttempt) || 0
    };
  }

  async proxyUrl() {
    if (!this.settingsStore) return '';
    const proxy = await resolveProxy(this.settingsStore.load());
    return proxy.resolvedUrl || '';
  }

  async check(options = {}) {
    const previous = this.readState();
    const checkedAt = Date.parse(previous.checkedAt || '') || 0;
    if (!options.force && previous.latestVersion && this.now() - checkedAt < CHECK_CACHE_MS) return this.status();
    this.progress('checking', 5, '正在查找适用于当前架构的 GitHub 稳定版本');
    try {
      const proxyUrl = await this.proxyUrl();
      const expected = expectedAsset(this.arch);
      const selected = await this.releaseResolver.findLatest(expected.asset, {
        proxyUrl,
        timeoutMs: 30_000,
        maxBytes: 8 * 1024 * 1024,
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': `web-mcp-assistant/${this.currentVersion}`
        }
      });
      const info = releaseInfo(selected.release, this.arch, this.currentVersion);
      const keepStage = previous.stagedVersion === info.latestVersion
        && previous.asset?.sha256 === info.asset.sha256
        && previous.stagedPath && fs.existsSync(previous.stagedPath);
      this.writeState({
        ...info,
        inspectedReleases: selected.inspected,
        checkedAt: new Date(this.now()).toISOString(),
        stagedPath: keepStage ? previous.stagedPath : '',
        stagedVersion: keepStage ? previous.stagedVersion : '',
        phase: keepStage ? 'downloaded' : 'checked',
        error: ''
      });
      this.progress('checked', 100, info.available
        ? `发现新版本 v${info.latestVersion}`
        : `当前已是最新版本 v${this.currentVersion}`);
      return this.status();
    } catch (error) {
      this.writeState({ phase: 'check-failed', error: error.message });
      this.progress('failed', 100, `更新检查失败：${error.message}`);
      throw error;
    }
  }

  async verifyFile(file, asset) {
    const stat = await fsp.stat(file);
    if (stat.size !== asset.size) throw new Error(`下载大小不匹配：期望 ${asset.size}，实际 ${stat.size}。`);
    const digest = await sha256File(file);
    if (!crypto.timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(asset.sha256, 'hex'))) {
      throw new Error('下载文件的 SHA-256 与 GitHub Release 不一致。');
    }
    await validateElf(file, this.arch);
    return digest;
  }

  async download(options = {}) {
    let saved = this.readState();
    if (!saved.available || !saved.asset?.downloadUrl) {
      await this.check({ force: options.forceCheck === true });
      saved = this.readState();
    }
    if (!saved.available) throw new Error(`当前已是最新版本 v${this.currentVersion}。`);
    if (saved.stagedPath && fs.existsSync(saved.stagedPath) && !options.force) {
      await this.verifyFile(saved.stagedPath, saved.asset);
      return this.status();
    }

    const version = parseVersion(saved.latestVersion)?.text;
    if (!version) throw new Error('待下载版本无效。');
    const directory = path.join(this.updateRoot, `v${version}`);
    const destination = path.join(directory, saved.asset.name);
    const temporary = `${destination}.${saved.asset.sha256.slice(0, 12)}.part`;
    await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
    if (options.force) await fsp.rm(temporary, { force: true });
    let received = 0;
    try {
      received = (await fsp.stat(temporary)).size;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (received > saved.asset.size) {
      await fsp.rm(temporary, { force: true });
      received = 0;
    }
    const initialPercent = Math.min(99, Math.floor((received / saved.asset.size) * 100));
    this.writeState({ phase: 'downloading', error: '', errorCode: '', downloadReceived: received, downloadAttempt: 0 });
    this.progress('downloading', initialPercent, received
      ? `正在从 ${received} 字节处继续下载 ${saved.asset.name}`
      : `正在下载 ${saved.asset.name}`, { received, total: saved.asset.size, resumed: received > 0 });

    let output;
    try {
      const proxyUrl = await this.proxyUrl();
      output = await fsp.open(temporary, received ? 'r+' : 'wx', 0o600);
      let lastReported = initialPercent;
      for (let attempt = 1; received < saved.asset.size && attempt <= this.downloadMaxAttempts; attempt += 1) {
        const attemptStarted = this.now();
        let attemptOffset = received;
        this.writeState({ phase: 'downloading', downloadReceived: received, downloadAttempt: attempt, error: '', errorCode: '' });
        try {
          const headers = { 'User-Agent': `web-mcp-assistant/${this.currentVersion}` };
          if (received > 0) headers.Range = `bytes=${received}-`;
          const response = await this.requestStream(saved.asset.downloadUrl, {
            proxyUrl,
            timeoutMs: DOWNLOAD_TIMEOUT_MS,
            preferHttp2: true,
            headers
          });
          const statusCode = Number(response.statusCode || (received ? 0 : 200));
          if (received > 0 && statusCode === 206) {
            const range = contentRange(response.headers?.['content-range']);
            if (!range || range.start !== received || (range.total !== null && range.total !== saved.asset.size)) {
              response.destroy();
              const error = new Error(`GitHub 断点响应无效：${response.headers?.['content-range'] || '缺少 Content-Range'}。`);
              error.code = 'ERR_INVALID_CONTENT_RANGE';
              throw error;
            }
          } else if (received > 0 && statusCode === 200) {
            await output.truncate(0);
            received = 0;
            attemptOffset = 0;
            lastReported = 0;
          } else if (received > 0) {
            response.destroy();
            const error = new Error(`GitHub 不支持从 ${received} 字节继续下载（HTTP ${statusCode || 'unknown'}）。`);
            error.code = 'ERR_INVALID_RESUME_STATUS';
            throw error;
          }

          try {
            for await (const chunk of response) {
              if (received + chunk.length > saved.asset.size) throw new Error('下载内容超过 Release 声明的大小。');
              await writeAll(output, chunk, received);
              received += chunk.length;
              const percent = Math.min(99, Math.floor((received / saved.asset.size) * 100));
              if (percent >= lastReported + 2) {
                lastReported = percent;
                this.writeState({ phase: 'downloading', downloadReceived: received, downloadAttempt: attempt });
                this.progress('downloading', percent, `正在下载 v${version}`, { received, total: saved.asset.size, attempt });
              }
            }
          } catch (error) {
            error.requestHost ||= response.requestHost;
            throw error;
          }
          if (received !== saved.asset.size) throw incompleteDownload(received, saved.asset.size);
        } catch (error) {
          await output.sync().catch(() => {});
          const code = errorCode(error);
          const canRetry = retryableDownloadError(error) && attempt < this.downloadMaxAttempts;
          const host = String(error.requestHost || '');
          this.log?.warn?.(canRetry ? '更新下载连接中断，将断点续传' : '更新下载连接失败', {
            stage: 'update-download-retry', attempt, maxAttempts: this.downloadMaxAttempts,
            received, attemptBytes: received - attemptOffset, total: saved.asset.size,
            code, host, durationMs: this.now() - attemptStarted
          });
          this.writeState({
            phase: canRetry ? 'downloading' : 'download-failed',
            downloadReceived: received, downloadAttempt: attempt,
            error: canRetry ? '' : error.message, errorCode: code
          });
          if (!canRetry) throw error;
          const delayMs = Math.min(8_000, this.downloadRetryBaseMs * (2 ** (attempt - 1)));
          const percent = Math.min(99, Math.floor((received / saved.asset.size) * 100));
          this.progress('downloading', percent, `连接中断，${Math.ceil(delayMs / 1000)} 秒后从 ${received} 字节继续（${attempt + 1}/${this.downloadMaxAttempts}）`, {
            received, total: saved.asset.size, attempt, nextAttempt: attempt + 1,
            errorCode: code, host, retryDelayMs: delayMs
          });
          await this.sleep(delayMs);
        }
      }
      await output.sync();
      await output.close();
      output = null;
      if (received !== saved.asset.size) throw incompleteDownload(received, saved.asset.size);
      const digest = await sha256File(temporary);
      if (!crypto.timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(saved.asset.sha256, 'hex'))) {
        const error = new Error('下载文件的 SHA-256 与 GitHub Release 不一致。');
        error.code = 'ERR_DOWNLOAD_INTEGRITY';
        throw error;
      }
      await validateElf(temporary, this.arch);
      await fsp.chmod(temporary, 0o700);
      await fsp.rm(destination, { force: true });
      await fsp.rename(temporary, destination);
      this.writeState({
        phase: 'downloaded',
        stagedPath: destination,
        stagedVersion: version,
        downloadedAt: new Date(this.now()).toISOString(),
        error: '',
        errorCode: '',
        downloadReceived: saved.asset.size
      });
      this.progress('downloaded', 100, `v${version} 已下载并通过 SHA-256 与 ELF 架构校验`, {
        received: saved.asset.size,
        total: saved.asset.size
      });
      return this.status();
    } catch (error) {
      if (output) await output.close().catch(() => {});
      if (DISCARD_PART_CODES.has(errorCode(error))) await fsp.rm(temporary, { force: true }).catch(() => {});
      this.writeState({
        phase: 'download-failed', error: error.message, errorCode: errorCode(error),
        downloadReceived: received
      });
      this.progress('failed', 100, `更新下载失败：${error.message}`, {
        received, total: saved.asset.size, errorCode: errorCode(error), requestHost: error.requestHost || ''
      });
      throw error;
    }
  }

  async createBackup(target, backup) {
    const temporary = `${backup}.${process.pid}.tmp`;
    await fsp.rm(temporary, { force: true });
    let linked = false;
    try {
      await fsp.link(target, temporary);
      linked = true;
    } catch {
      await fsp.copyFile(target, temporary);
    }
    if (!linked) {
      const descriptor = await fsp.open(temporary, 'r+');
      try { await descriptor.sync(); } finally { await descriptor.close(); }
    }
    await fsp.rm(backup, { force: true });
    await fsp.rename(temporary, backup);
  }

  async restoreBackup(target, backup) {
    if (!fs.existsSync(backup)) throw new Error('更新备份不存在，无法恢复旧版本。');
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.rollback.${process.pid}.tmp`);
    await fsp.rm(temporary, { force: true });
    await fsp.copyFile(backup, temporary);
    await fsp.chmod(temporary, 0o755);
    const descriptor = await fsp.open(temporary, 'r+');
    try { await descriptor.sync(); } finally { await descriptor.close(); }
    await this.atomicReplace(temporary, target);
  }

  async spawnRestartHelper(target, backup, version) {
    ensureParent(this.logFile);
    const descriptor = fs.openSync(this.logFile, 'a', 0o600);
    const readyFile = path.join(this.updateRoot, `restart-${process.pid}.ready`);
    await fsp.rm(readyFile, { force: true });
    const payload = Buffer.from(JSON.stringify({
      oldPid: process.pid,
      backup,
      version,
      currentVersion: this.currentVersion,
      stateFile: this.stateFile,
      managerStateDir: this.managerStateDir,
      readyFile
    })).toString('base64url');
    let child;
    try {
      child = this.spawn(target, [UPDATE_HELPER_FLAG, payload], {
        detached: true,
        stdio: ['ignore', descriptor, descriptor],
        env: process.env
      });
      await Promise.race([
        once(child, 'spawn'),
        once(child, 'error').then(([error]) => { throw error; })
      ]);
      const deadline = Date.now() + 5000;
      while (!fs.existsSync(readyFile) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!fs.existsSync(readyFile)) throw new Error('新版本重启助手没有按时就绪。');
      child.unref();
      return child.pid;
    } catch (error) {
      try { if (child?.pid) process.kill(child.pid, 'SIGTERM'); } catch { /* helper may already be gone */ }
      throw error;
    } finally {
      fs.closeSync(descriptor);
    }
  }

  async install(options = {}) {
    const saved = this.readState();
    if (!saved.stagedPath || !fs.existsSync(saved.stagedPath)) throw new Error('尚未下载可安装的更新。');
    if (!saved.asset || saved.stagedVersion !== saved.latestVersion) throw new Error('暂存更新与最新 Release 不一致，请重新下载。');
    if (!saved.available || compareVersions(saved.stagedVersion, this.currentVersion) <= 0) {
      throw new Error(`拒绝安装非递增版本：v${saved.stagedVersion || 'unknown'}。`);
    }
    const capabilities = await this.capabilities();
    if (!capabilities.canApply) throw new Error(capabilities.applyReason);
    await this.verifyFile(saved.stagedPath, saved.asset);

    const target = this.execPath;
    const targetDirectory = path.dirname(target);
    const temporary = path.join(targetDirectory, `.${path.basename(target)}.v${saved.stagedVersion}.${process.pid}.tmp`);
    const backup = `${target}.previous`;
    await fsp.rm(temporary, { force: true });
    this.writeState({ phase: 'installing', error: '' });
    this.progress('installing', 10, `正在安装 v${saved.stagedVersion}`);
    let replaced = false;
    let helperStarted = false;
    try {
      await fsp.copyFile(saved.stagedPath, temporary);
      await fsp.chmod(temporary, 0o755);
      const descriptor = await fsp.open(temporary, 'r+');
      try { await descriptor.sync(); } finally { await descriptor.close(); }
      await this.verifyFile(temporary, saved.asset);
      await this.createBackup(target, backup);
      await this.atomicReplace(temporary, target);
      replaced = true;
      await fsp.chmod(target, 0o755);
      this.writeState({
        phase: options.restart === false ? 'installed' : 'restart-pending',
        installedVersion: saved.stagedVersion,
        backupPath: backup,
        installedAt: new Date(this.now()).toISOString(),
        error: ''
      });

      let helperPid = 0;
      if (options.restart !== false) {
        helperPid = await this.spawnRestartHelper(target, backup, saved.stagedVersion);
        helperStarted = true;
        try { this.writeState({ phase: 'restart-pending', helperPid }); } catch { /* helper writes the next durable state */ }
      }
      this.progress('installed', 100, options.restart === false
        ? `v${saved.stagedVersion} 已安装`
        : `v${saved.stagedVersion} 已安装，服务即将重启`);
      return {
        installed: true,
        version: saved.stagedVersion,
        restartScheduled: options.restart !== false,
        helperPid
      };
    } catch (error) {
      await fsp.rm(temporary, { force: true }).catch(() => {});
      if (replaced && !helperStarted) {
        try { await this.restoreBackup(target, backup); }
        catch (rollbackError) { error = new Error(`${error.message}；恢复旧版本失败：${rollbackError.message}`); }
      }
      try { this.writeState({ phase: 'install-failed', error: error.message }); } catch { /* report the original error */ }
      this.progress('failed', 100, `更新安装失败：${error.message}`);
      throw error;
    }
  }
}

module.exports = {
  UpdateService,
  RELEASES_API,
  UPDATE_HELPER_FLAG,
  ARCHITECTURES,
  CHECK_CACHE_MS,
  DOWNLOAD_MAX_ATTEMPTS,
  DOWNLOAD_RETRY_BASE_MS,
  MAX_ASSET_BYTES,
  retryableDownloadError,
  contentRange,
  parseVersion,
  compareVersions,
  releaseInfo,
  sha256File,
  validateElf
};
