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
}

module.exports = { SettingsStore, DEFAULTS, normalize };
