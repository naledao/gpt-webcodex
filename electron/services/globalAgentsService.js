const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function fileHasInstructions(filePath) {
  let handle;
  try {
    handle = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(16 * 1024);
    const bytesRead = fs.readSync(handle, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString('utf8').trim().length > 0;
  } catch {
    return false;
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
}

function isSafeInstructionFile(filePath, codexHome) {
  try {
    const resolvedHome = fs.realpathSync.native(codexHome);
    const resolvedFile = fs.realpathSync.native(filePath);
    const relative = path.relative(resolvedHome, resolvedFile);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;
    return fileHasInstructions(resolvedFile);
  } catch {
    return false;
  }
}

function inspectGlobalAgents(settings, env = process.env, homeDir = os.homedir()) {
  const enabled = Boolean(settings.globalAgentsEnabled);
  const configuredHome = String(env.CODEX_HOME || '').trim();
  const codexHome = path.resolve(configuredHome || path.join(homeDir, '.codex'));
  const candidates = ['AGENTS.override.md', 'AGENTS.md'].map((name) => path.join(codexHome, name));
  const selectedPath = enabled
    ? candidates.find((candidate) => isSafeInstructionFile(candidate, codexHome)) || ''
    : '';
  return {
    enabled,
    codexHome,
    path: selectedPath || candidates[1],
    exists: Boolean(selectedPath),
    source: selectedPath ? path.basename(selectedPath) : ''
  };
}

module.exports = { inspectGlobalAgents };
