const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getAsset, getAssetKeys, isSea } = require('node:sea');

const BUILD_ID = typeof NATIVE_BUILD_ID === 'string' ? NATIVE_BUILD_ID : 'development';
const ASSET_PREFIXES = ['renderer/', 'resources/'];

function cacheBase() {
  if (process.env.WEB_MCP_NATIVE_CACHE) return path.resolve(process.env.WEB_MCP_NATIVE_CACHE);
  const xdgCache = process.env.XDG_CACHE_HOME
    ? path.resolve(process.env.XDG_CACHE_HOME)
    : path.join(os.homedir(), '.cache');
  return path.join(xdgCache, 'web-mcp-assistant', 'native');
}

function safeAssetKey(key) {
  const normalized = path.posix.normalize(String(key || ''));
  if (!ASSET_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return '';
  if (normalized.startsWith('/') || normalized.includes('../')) return '';
  return normalized;
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(directory, 0o700); } catch { /* best effort */ }
}

function extractAssets() {
  if (!isSea()) return null;
  if (!/^[a-f0-9]{16,64}$/.test(BUILD_ID)) throw new Error('Invalid native build identifier.');

  const root = path.join(cacheBase(), BUILD_ID);
  const marker = path.join(root, '.complete');
  const tunnel = process.arch === 'arm64'
    ? path.join(root, 'resources', 'tools', 'tunnel-client-linux-arm64')
    : path.join(root, 'resources', 'tools', 'tunnel-client');
  const required = [
    path.join(root, 'renderer', 'index.html'),
    path.join(root, 'resources', 'coding-tools-mcp', 'coding_tools_mcp', '__main__.py'),
    tunnel
  ];
  const ready = fs.existsSync(marker) && required.every((file) => fs.existsSync(file));

  if (!ready) {
    ensureDirectory(root);
    for (const originalKey of getAssetKeys()) {
      const key = safeAssetKey(originalKey);
      if (!key) continue;
      const destination = path.join(root, ...key.split('/'));
      ensureDirectory(path.dirname(destination));
      const mode = key.startsWith('resources/tools/tunnel-client') ? 0o700 : 0o600;
      const temporary = `${destination}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, Buffer.from(getAsset(originalKey)), { mode });
      fs.renameSync(temporary, destination);
      try { fs.chmodSync(destination, mode); } catch { /* best effort */ }
    }
    fs.writeFileSync(marker, `${BUILD_ID}\n`, { mode: 0o600 });
  }

  if (!fs.existsSync(tunnel)) throw new Error(`Bundled tunnel-client is missing for ${process.arch}.`);
  try { fs.chmodSync(tunnel, 0o700); } catch { /* best effort */ }

  process.env.WEB_MCP_RENDERER_ROOT = path.join(root, 'renderer');
  process.env.WEB_MCP_RESOURCES_ROOT = path.join(root, 'resources');
  return root;
}

async function main() {
  extractAssets();
  process.title = 'web-mcp-assistant';
  const { startServer } = require('../web/server');
  let running;
  const shutdown = async () => {
    try { if (running) await running.close(); }
    finally { process.exit(0); }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  running = await startServer();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
