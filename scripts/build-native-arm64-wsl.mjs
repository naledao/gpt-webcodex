import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheRoot = path.resolve(process.env.WEB_MCP_CROSS_CACHE || path.join(projectRoot, '.cache', 'cross-arm64'));
const downloadRoot = path.join(cacheRoot, 'downloads');
const toolRoot = path.join(cacheRoot, 'tools');
const debRoot = path.join(cacheRoot, 'debs');
const sysroot = path.join(cacheRoot, 'sysroot');
const nodeVersion = process.versions.node;
const nodeArchiveName = `node-v${nodeVersion}-linux-arm64.tar.xz`;
const nodeArchive = path.join(downloadRoot, nodeArchiveName);
const nodeChecksums = path.join(downloadRoot, `SHASUMS256-v${nodeVersion}.txt`);
const nodeDirectory = path.join(toolRoot, `node-v${nodeVersion}-linux-arm64`);
const armNode = path.join(nodeDirectory, 'bin', 'node');
const qemuArchive = path.join(downloadRoot, 'qemu-aarch64-static-v7.2.0-1.tar.gz');
const qemu = path.join(toolRoot, 'qemu-aarch64-static');
const sysrootPrefix = path.join(sysroot, 'usr', 'aarch64-linux-gnu');
const crossStrip = path.join(sysroot, 'usr', 'bin', 'aarch64-linux-gnu-strip');
const crossStripLibraryPath = path.join(sysroot, 'usr', 'lib', 'x86_64-linux-gnu');
const esbuildBinary = path.join(projectRoot, 'node_modules', '@esbuild', 'linux-x64', 'bin', 'esbuild');

if (process.platform !== 'linux' || process.arch !== 'x64') {
  throw new Error(`WSL arm64 cross-build must start from linux/x64; received ${process.platform}/${process.arch}.`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || projectRoot,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stdout || ''}${result.stderr || ''}`.trimEnd() : '';
    throw new Error(`${command} exited with status ${result.status}.${detail}`);
  }
  return String(result.stdout || '').trim();
}

async function exists(file) {
  try { await fsp.access(file); return true; } catch { return false; }
}

async function download(url, target) {
  if (await exists(target)) return;
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await fsp.rm(temporary, { force: true });
  try {
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '';
    let loopbackProxy = false;
    try { loopbackProxy = ['127.0.0.1', 'localhost', '::1'].includes(new URL(proxy).hostname); } catch { /* direct */ }
    if (process.env.WSL_DISTRO_NAME && loopbackProxy) {
      const windowsTarget = run('wslpath', ['-w', temporary], { capture: true });
      run('curl.exe', ['--proxy', proxy, '--fail', '--location', '--retry', '3', '--output', windowsTarget, url]);
    } else {
      run('curl', ['--fail', '--location', '--retry', '3', '--output', temporary, url]);
    }
    await fsp.rename(temporary, target);
  } finally {
    await fsp.rm(temporary, { force: true });
  }
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(file);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

function assertElfArm64(file) {
  const header = fs.readFileSync(file).subarray(0, 20);
  const valid = header.length === 20
    && header[0] === 0x7f
    && header.subarray(1, 4).toString('ascii') === 'ELF'
    && header[4] === 2
    && header[5] === 1
    && header.readUInt16LE(18) === 183;
  if (!valid) throw new Error(`Expected an ELF64 AArch64 executable: ${file}`);
}

await Promise.all([
  download(
    'https://github.com/multiarch/qemu-user-static/releases/download/v7.2.0-1/qemu-aarch64-static.tar.gz',
    qemuArchive
  ),
  download(`https://nodejs.org/dist/v${nodeVersion}/${nodeArchiveName}`, nodeArchive),
  download(`https://nodejs.org/dist/v${nodeVersion}/SHASUMS256.txt`, nodeChecksums)
]);

const checksumLine = (await fsp.readFile(nodeChecksums, 'utf8'))
  .split(/\r?\n/)
  .find((line) => line.trim().endsWith(`  ${nodeArchiveName}`));
if (!checksumLine) throw new Error(`Official Node checksum is missing for ${nodeArchiveName}.`);
const expectedNodeHash = checksumLine.trim().split(/\s+/, 1)[0];
const actualNodeHash = await sha256(nodeArchive);
if (actualNodeHash !== expectedNodeHash) throw new Error(`Node arm64 checksum mismatch: ${actualNodeHash}`);

await fsp.mkdir(toolRoot, { recursive: true });
if (!await exists(qemu)) run('tar', ['-xzf', qemuArchive, '-C', toolRoot]);
if (!await exists(armNode)) run('tar', ['-xJf', nodeArchive, '-C', toolRoot]);
await fsp.chmod(qemu, 0o755);
await fsp.chmod(armNode, 0o755);

await fsp.mkdir(debRoot, { recursive: true });
for (const packageName of [
  'libc6-arm64-cross',
  'libstdc++6-arm64-cross',
  'libgcc-s1-arm64-cross',
  'binutils-aarch64-linux-gnu',
  'binutils-common'
]) {
  const metadata = run('apt-cache', ['show', packageName], { capture: true });
  const filename = metadata.match(/^Filename:\s+(.+)$/m)?.[1]?.trim();
  const expectedHash = metadata.match(/^SHA256:\s+([a-f0-9]{64})$/m)?.[1];
  if (!filename || !expectedHash) throw new Error(`APT metadata is incomplete for ${packageName}.`);
  const deb = path.join(debRoot, path.basename(filename));
  if (!await exists(deb)) await download(`https://archive.ubuntu.com/ubuntu/${filename}`, deb);
  const actualHash = await sha256(deb);
  if (actualHash !== expectedHash) throw new Error(`APT package checksum mismatch for ${path.basename(deb)}.`);
}

await fsp.rm(sysroot, { recursive: true, force: true });
await fsp.mkdir(sysroot, { recursive: true });
for (const name of (await fsp.readdir(debRoot)).filter((item) => item.endsWith('.deb')).sort()) {
  run('dpkg-deb', ['-x', path.join(debRoot, name), sysroot]);
}

for (const required of [qemu, armNode, crossStrip, esbuildBinary, path.join(sysrootPrefix, 'lib', 'ld-linux-aarch64.so.1')]) {
  if (!await exists(required)) throw new Error(`Missing arm64 cross-build dependency: ${required}`);
}

const reportedArch = run(qemu, ['-L', sysrootPrefix, armNode, '-p', '`${process.platform}/${process.arch}`'], { capture: true });
if (reportedArch !== 'linux/arm64') throw new Error(`Portable arm64 Node reported ${reportedArch}.`);

run(qemu, ['-L', sysrootPrefix, armNode, path.join(projectRoot, 'scripts', 'build-native.mjs')], {
  env: {
    ...process.env,
    ESBUILD_BINARY_PATH: esbuildBinary,
    NATIVE_QEMU: qemu,
    NATIVE_QEMU_LD_PREFIX: sysrootPrefix,
    NATIVE_STRIP: crossStrip,
    NATIVE_STRIP_LIBRARY_PATH: crossStripLibraryPath
  }
});

const binary = path.join(projectRoot, 'dist', 'web-mcp-assistant-linux-arm64');
assertElfArm64(binary);
console.log(JSON.stringify({
  architecture: 'arm64',
  binary,
  archive: path.join(projectRoot, 'dist', `web-mcp-assistant-v${JSON.parse(await fsp.readFile(path.join(projectRoot, 'package.json'), 'utf8')).version}-linux-arm64.tar.gz`),
  qemu,
  node: armNode,
  nodeSha256: actualNodeHash
}, null, 2));
