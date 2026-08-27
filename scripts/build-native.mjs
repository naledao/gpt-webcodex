import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildRoot = path.join(projectRoot, 'build', 'native');
const distRoot = path.join(projectRoot, 'dist');
const packageJson = JSON.parse(await fsp.readFile(path.join(projectRoot, 'package.json'), 'utf8'));
const platform = process.platform;
const arch = process.arch;

if (platform !== 'linux') throw new Error('Native packaging currently supports Linux only.');
if (!['arm64', 'x64'].includes(arch)) throw new Error(`Unsupported Linux architecture: ${arch}`);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
    ...options
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

async function walk(directory) {
  const output = [];
  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__pycache__' || entry.name === '.pytest_cache') continue;
      output.push(...await walk(full));
    } else if (entry.isFile() && !entry.name.endsWith('.pyc')) {
      output.push(full);
    }
  }
  return output;
}

function shouldIncludeAsset(relative) {
  if (arch === 'arm64' && relative === 'resources/tools/tunnel-client') return false;
  if (arch === 'x64' && relative === 'resources/tools/tunnel-client-linux-arm64') return false;
  return true;
}

async function fileHash(file) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(file);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function buildIdFor(files) {
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    const relative = path.relative(projectRoot, file).split(path.sep).join('/');
    hash.update(relative);
    hash.update('\0');
    hash.update(await fsp.readFile(file));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 24);
}

async function ownByCurrentUser(file) {
  if (typeof process.getuid !== 'function' || typeof process.getgid !== 'function') return;
  try { await fsp.chown(file, process.getuid(), process.getgid()); } catch { /* best effort */ }
}

await fsp.rm(buildRoot, { recursive: true, force: true });
await fsp.mkdir(buildRoot, { recursive: true });
await fsp.mkdir(distRoot, { recursive: true });

const assetFiles = [
  ...await walk(path.join(projectRoot, 'renderer')),
  ...await walk(path.join(projectRoot, 'resources'))
].filter((file) => shouldIncludeAsset(path.relative(projectRoot, file).split(path.sep).join('/')))
  .sort((left, right) => left.localeCompare(right));

const expectedTunnel = arch === 'arm64'
  ? path.join(projectRoot, 'resources', 'tools', 'tunnel-client-linux-arm64')
  : path.join(projectRoot, 'resources', 'tools', 'tunnel-client');
if (!assetFiles.includes(expectedTunnel)) throw new Error(`Missing tunnel-client for ${arch}: ${expectedTunnel}`);

const runtimeSourceFiles = [
  ...await walk(path.join(projectRoot, 'native')),
  ...await walk(path.join(projectRoot, 'src')),
  ...await walk(path.join(projectRoot, 'web')),
  path.join(projectRoot, 'package.json')
].filter((file) => ['.js', '.json'].includes(path.extname(file)))
  .sort((left, right) => left.localeCompare(right));
const buildId = await buildIdFor([...assetFiles, ...runtimeSourceFiles].sort((left, right) => left.localeCompare(right)));
const bundledEntry = path.join(buildRoot, 'entry.cjs');
await build({
  entryPoints: [path.join(projectRoot, 'native', 'entry.js')],
  outfile: bundledEntry,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: `node${process.versions.node.split('.')[0]}`,
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  define: { NATIVE_BUILD_ID: JSON.stringify(buildId) }
});

const seaBlob = path.join(buildRoot, 'sea-prep.blob');
const seaConfig = path.join(buildRoot, 'sea-config.json');
const assets = Object.fromEntries(assetFiles.map((file) => [
  path.relative(projectRoot, file).split(path.sep).join('/'),
  file
]));
await fsp.writeFile(seaConfig, `${JSON.stringify({
  main: bundledEntry,
  output: seaBlob,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: true,
  assets
}, null, 2)}\n`);
if (process.env.NATIVE_QEMU) {
  const qemuArgs = [];
  if (process.env.NATIVE_QEMU_LD_PREFIX) qemuArgs.push('-L', process.env.NATIVE_QEMU_LD_PREFIX);
  qemuArgs.push(process.execPath, '--experimental-sea-config', seaConfig);
  run(process.env.NATIVE_QEMU, qemuArgs);
} else {
  run(process.execPath, ['--experimental-sea-config', seaConfig]);
}

const outputName = `web-mcp-assistant-linux-${arch}`;
const binary = path.join(distRoot, outputName);
await fsp.rm(binary, { force: true });
await fsp.copyFile(process.execPath, binary);
await fsp.chmod(binary, 0o755);
await ownByCurrentUser(binary);

if (process.env.NATIVE_SKIP_STRIP !== '1') {
  const stripCommand = process.env.NATIVE_STRIP || 'strip';
  const stripLibraryPath = process.env.NATIVE_STRIP_LIBRARY_PATH;
  const stripEnv = stripLibraryPath
    ? { ...process.env, LD_LIBRARY_PATH: [stripLibraryPath, process.env.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter) }
    : process.env;
  const strip = spawnSync(stripCommand, ['--strip-unneeded', binary], {
    cwd: projectRoot,
    env: stripEnv,
    stdio: 'inherit'
  });
  if (strip.error?.code !== 'ENOENT' && strip.status !== 0) {
    throw strip.error || new Error(`strip exited with status ${strip.status}`);
  }
}

const postject = path.join(projectRoot, 'node_modules', '.bin', 'postject');
run(postject, [
  binary,
  'NODE_SEA_BLOB',
  seaBlob,
  '--sentinel-fuse',
  'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
]);
await fsp.chmod(binary, 0o755);
await ownByCurrentUser(binary);

const releaseName = `web-mcp-assistant-v${packageJson.version}-linux-${arch}`;
const releaseDirectory = path.join(distRoot, releaseName);
await fsp.rm(releaseDirectory, { recursive: true, force: true });
await fsp.mkdir(releaseDirectory, { recursive: true });
const releaseBinary = path.join(releaseDirectory, 'web-mcp-assistant');
await fsp.copyFile(binary, releaseBinary);
await fsp.chmod(releaseBinary, 0o755);
await ownByCurrentUser(releaseBinary);
for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  await fsp.copyFile(path.join(projectRoot, name), path.join(releaseDirectory, name));
}
const controlScript = path.join(releaseDirectory, 'web-mcp-assistantctl');
await fsp.copyFile(path.join(projectRoot, 'scripts', 'web-mcp-assistantctl'), controlScript);
await fsp.chmod(controlScript, 0o755);
await ownByCurrentUser(controlScript);
await fsp.writeFile(path.join(releaseDirectory, 'README.txt'), [
  `Web MCP Assistant v${packageJson.version} for Linux ${arch}`,
  '',
  'Requirements:',
  '- Linux with glibc',
  '- Python 3.11 or newer available as python3 or python',
  '',
  'Run:',
  '  ./web-mcp-assistant',
  '',
  'Background service and updates:',
  '  ./web-mcp-assistantctl start',
  '  ./web-mcp-assistantctl update',
  '  ./web-mcp-assistantctl status',
  '',
  'Optional environment variables:',
  '  WEB_HOST=127.0.0.1',
  '  WEB_PORT=17654',
  '  WEB_PASSWORD=your-password',
  ''
].join('\n'));

const archive = path.join(distRoot, `${releaseName}.tar.gz`);
await fsp.rm(archive, { force: true });
run('tar', ['-C', distRoot, '-czf', archive, releaseName]);

const checksums = (await Promise.all(['x64', 'arm64'].map(async (candidateArch) => {
  const candidateBinary = path.join(distRoot, `web-mcp-assistant-linux-${candidateArch}`);
  const candidateArchive = path.join(distRoot, `web-mcp-assistant-v${packageJson.version}-linux-${candidateArch}.tar.gz`);
  return await Promise.all([candidateBinary, candidateArchive].map(async (file) => (
    await fsp.stat(file).then(() => file).catch(() => '')
  )));
}))).flat().filter(Boolean);
const checksumText = `${(await Promise.all(checksums.map(async (file) => (
  `${await fileHash(file)}  ${path.basename(file)}`
)))).join('\n')}\n`;
await fsp.writeFile(path.join(distRoot, 'SHA256SUMS-native.txt'), checksumText);

const stats = await fsp.stat(binary);
console.log(JSON.stringify({
  binary,
  archive,
  buildId,
  architecture: arch,
  bytes: stats.size,
  assets: assetFiles.length
}, null, 2));
