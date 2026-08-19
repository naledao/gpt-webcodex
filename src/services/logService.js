const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const { logFile } = require('../paths');
const { ensureParent } = require('./jsonStore');

const MAX_LOG_BYTES = 10 * 1024 * 1024;
const MAX_LOG_FILES = 5;

function rotateLog(file, maxBytes = MAX_LOG_BYTES, maxFiles = MAX_LOG_FILES) {
  try {
    if (!fs.existsSync(file) || fs.statSync(file).size < maxBytes) return false;
    for (let index = maxFiles - 1; index >= 1; index -= 1) {
      const source = `${file}.${index}`;
      const target = `${file}.${index + 1}`;
      if (fs.existsSync(source)) fs.renameSync(source, target);
    }
    fs.renameSync(file, `${file}.1`);
    return true;
  } catch {
    return false;
  }
}

class LogService extends EventEmitter {
  constructor() {
    super();
    this.buffer = [];
  }

  write(level, message, meta = {}) {
    const safeMeta = { ...meta };
    for (const key of Object.keys(safeMeta)) {
      if (/key|token|authorization|secret/i.test(key)) safeMeta[key] = '[已隐藏]';
    }
    const event = {
      time: new Date().toISOString(),
      level,
      message: String(message),
      meta: safeMeta
    };
    this.buffer.push(event);
    if (this.buffer.length > 1000) this.buffer.shift();
    ensureParent(logFile());
    rotateLog(logFile());
    fs.appendFileSync(logFile(), `${JSON.stringify(event)}\n`, 'utf8');
    this.emit('entry', event);
    return event;
  }

  info(message, meta) { return this.write('info', message, meta); }
  warn(message, meta) { return this.write('warn', message, meta); }
  error(message, meta) { return this.write('error', message, meta); }

  read(limit = 300) {
    if (this.buffer.length) return this.buffer.slice(-limit);
    try {
      return fs.readFileSync(logFile(), 'utf8').trim().split(/\r?\n/).filter(Boolean)
        .slice(-Math.max(limit * 3, limit))
        .map((line) => {
          try { return JSON.parse(line); } catch { return null; }
        })
        .filter(Boolean)
        .slice(-limit);
    } catch {
      return [];
    }
  }

  clear() {
    this.buffer = [];
    ensureParent(logFile());
    fs.writeFileSync(logFile(), '', 'utf8');
  }
}

module.exports = { LogService, rotateLog, MAX_LOG_BYTES, MAX_LOG_FILES };
