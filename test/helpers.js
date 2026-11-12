'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PersistentQueue } = require('../src/core/queue');
const { SyncEngine } = require('../src/core/sync');
const { MemoryStore } = require('../src/core/memorystore');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'inventru-test-')); }

async function setup({ items, logEnabled = true } = {}) {
  const dir = tmpDir();
  const qFile = path.join(dir, 'queue.json');
  const store = new MemoryStore(items || [
    { id: 'a', name: 'Apples', qty: 10 },
    { id: 'b', name: 'Bananas', qty: 2 },
  ], { logEnabled });
  const mk = (s = store) => new SyncEngine({
    store: s, queue: new PersistentQueue(qFile), cacheFile: path.join(dir, 'cache.json'), autoTimers: false,
  });
  const engine = mk();
  await engine.refresh();
  return { dir, qFile, store, engine, mk };
}

module.exports = { setup, tmpDir };
