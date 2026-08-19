const fs = require('node:fs');
const path = require('node:path');
const { secretsFile } = require('../paths');

function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(directory, 0o700); } catch { /* best effort on non-POSIX test hosts */ }
}

class SecretStore {
  _readAll() {
    try {
      const value = JSON.parse(fs.readFileSync(secretsFile(), 'utf8'));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  _writeAll(value) {
    const file = secretsFile();
    ensurePrivateDirectory(path.dirname(file));
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    let descriptor;
    try {
      descriptor = fs.openSync(temporary, 'w', 0o600);
      fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      fs.fsyncSync(descriptor);
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, file);
    try { fs.chmodSync(file, 0o600); } catch { /* best effort on non-POSIX test hosts */ }
  }

  set(name, value) {
    const text = String(value || '').trim();
    if (!text) throw new Error('密钥不能为空。');
    const all = this._readAll();
    all[name] = text;
    this._writeAll(all);
  }

  get(name) {
    return this._readAll()[name] || '';
  }

  remove(name) {
    const all = this._readAll();
    delete all[name];
    this._writeAll(all);
  }

  status() {
    const all = this._readAll();
    return {
      runtimeApiKey: Boolean(all.runtimeApiKey),
      mcpAuthToken: Boolean(all.mcpAuthToken)
    };
  }
}

module.exports = { SecretStore, ensurePrivateDirectory };
