'use strict';
const fs = require('fs');
const path = require('path');

// Antivirus, backup or indexing software can hold a file for a moment: such errors are retried, never treated as "empty".
const TRANSIENT = new Set(['EBUSY', 'EPERM', 'EACCES', 'EMFILE', 'ENFILE']);
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function retrying(fn, retries) {
  for (let attempt = 0; ; attempt++) {
    try { return fn(); } catch (e) {
      if (!TRANSIENT.has(e.code) || attempt >= retries) throw e;
      pause(Math.min(1000, 50 * 2 ** attempt));
    }
  }
}

const parse = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/**
 * Read a JSON file.
 *  - missing: its .bak copy if there is one, otherwise `fallback`
 *  - damaged (not valid JSON): kept aside as .corrupt-<time>, then the .bak copy, otherwise `fallback`
 *  - can't be opened (locked, no permission): retried for a few seconds, then the error is thrown - it is never
 *    replaced by an empty value, which would be saved over the real data later.
 */
function readJson(file, fallback, { retries = 8 } = {}) {
  try {
    return retrying(() => parse(file), retries);
  } catch (e) {
    if (e.code === 'ENOENT') {
      try { return parse(`${file}.bak`); } catch { return fallback; }
    }
    if (!(e instanceof SyntaxError)) throw e;
    try { fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`); } catch { /* keep going */ }
    try { return parse(`${file}.bak`); } catch { return fallback; }
  }
}

/** Crash-safe write: temp file + fsync + rename, keeping one .bak copy. */
function writeJsonAtomic(file, data, { retries = 8 } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const fd = retrying(() => fs.openSync(tmp, 'w'), retries);
  try {
    fs.writeSync(fd, JSON.stringify(data, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (fs.existsSync(file)) {
    try { retrying(() => fs.copyFileSync(file, `${file}.bak`), retries); } catch { /* the main write matters more */ }
  }
  retrying(() => fs.renameSync(tmp, file), retries);
}

module.exports = { readJson, writeJsonAtomic };
