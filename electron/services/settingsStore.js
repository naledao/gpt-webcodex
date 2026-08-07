const crypto = require('node:crypto');
const { settingsFile } = require('../paths');
const { readJson, writeJsonAtomic } = require('./jsonStore');
const { DEFAULTS, normalize } = require('./config');

class SettingsStore {
  load() {
    return normalize(readJson(settingsFile(), {}));
  }

  save(patch) {
    const next = normalize({ ...this.load(), ...patch });
    writeJsonAtomic(settingsFile(), next);
    return next;
  }

  ensureAuthToken() {
    const current = this.load();
    if (!current.authTokenId) {
      current.authTokenId = crypto.randomBytes(16).toString('hex');
      writeJsonAtomic(settingsFile(), current);
    }
    return current.authTokenId;
  }
}

module.exports = { SettingsStore, DEFAULTS, normalize };
