'use strict';
// "Just this PC": the stock list kept in a folder on this PC (src/core/localstore.js + stockbook.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpDir } = require('./helpers');
const { PersistentQueue } = require('../src/core/queue');
const { SyncEngine } = require('../src/core/sync');
const { LocalStore } = require('../src/core/localstore');
const config = require('../src/core/config');

function open(dir) {
  const store = new LocalStore({ dir: path.join(dir, 'stock'), user: 'alex@PC1' });
  const engine = new SyncEngine({ store, queue: new PersistentQueue(path.join(dir, 'queue.json')), cacheFile: path.join(dir, 'cache.json'), autoTimers: false });
  return { store, engine };
}

test('just this PC: items and changes are saved in the folder and are there after a restart', async () => {
  const dir = tmpDir();
  let { engine } = open(dir);
  await engine.refresh();
  assert.equal(engine.snapshot().items.length, 0);
  const id = engine.addItem({ name: 'USB-C dock', group: 'Docks', sub: 'New' });
  await engine.flush();
  engine.tap(id, 5); engine.tap(id, -1); engine.setField(id, 'ordered', true); engine.setField(id, 'low', 2);
  await engine.flush();
  assert.equal(engine.snapshot().status.pending, 0);
  assert.equal(engine.snapshot().status.state, 'ok');

  ({ engine } = open(dir)); // the app is closed and started again
  await engine.refresh();
  const it = engine.snapshot().items[0];
  assert.deepEqual({ name: it.name, group: it.group, sub: it.sub, qty: it.qty, ordered: it.ordered, low: it.low }, { name: 'USB-C dock', group: 'Docks', sub: 'New', qty: 4, ordered: true, low: 2 });
});

test('just this PC: every change is in log.csv with who made it, and a daily backup is kept', async () => {
  const dir = tmpDir();
  const { engine } = open(dir);
  await engine.refresh();
  const id = engine.addItem({ name: 'Webcam' });
  await engine.flush();
  engine.tap(id, 3); await engine.flush();
  engine.tap(id, 1); await engine.flush();
  const log = fs.readFileSync(path.join(dir, 'stock', 'log.csv'), 'utf8');
  assert.match(log, /^.?Time,Item,Change,New quantity,What,Op ID,By/);
  assert.match(log, /Webcam,3,3,app,.*alex@PC1/);
  assert.match(log, /Webcam,1,4,app,.*alex@PC1/);
  const backups = fs.readdirSync(path.join(dir, 'stock', 'backups'));
  assert.equal(backups.length, 1);
  assert.match(backups[0], /^data-\d{4}-\d{2}-\d{2}\.json$/);
});

test('just this PC: a change saved before a crash is not counted twice when it is sent again', async () => {
  const dir = tmpDir();
  const { store, engine } = open(dir);
  await engine.refresh();
  const id = engine.addItem({ name: 'Mouse' });
  await engine.flush();
  const op = { opId: 'op-1', kind: 'delta', itemId: id, delta: 2, ts: new Date().toISOString() };
  await store.applyBatch([op]);
  await store.applyBatch([op]); // e.g. the app closed before it removed the change from its queue
  assert.equal((await store.fetchItems())[0].qty, 2);
  assert.deepEqual([...(await store.wasApplied(['op-1', 'op-2']))], ['op-1']);
});

test('just this PC: if the list cannot be saved, nothing is counted, the change waits and is saved later', async () => {
  const dir = tmpDir();
  const { engine } = open(dir);
  await engine.refresh();
  const id = engine.addItem({ name: 'Cable' });
  await engine.flush();
  const dataFile = path.join(dir, 'stock', 'data.json');
  const tmp = `${dataFile}.tmp`;
  fs.mkdirSync(tmp); // a folder where the temporary file goes: the save fails
  engine.tap(id, 7);
  assert.equal(await engine.flush(), false);
  const s = engine.snapshot();
  assert.equal(s.status.state, 'error');
  assert.equal(s.status.kind, 'disk');
  assert.equal(s.status.pending, 1, 'the change waits in the queue');
  assert.equal(engine.getItem(id).qty, 7, 'still shown');
  assert.equal(JSON.parse(fs.readFileSync(dataFile, 'utf8')).rows[0].qty, 0, 'not on disk');
  fs.rmdirSync(tmp);
  assert.equal(await engine.flush(), true);
  await engine.refresh();
  assert.equal(engine.getItem(id).qty, 7);
  assert.equal(JSON.parse(fs.readFileSync(dataFile, 'utf8')).rows[0].qty, 7);
});

test('just this PC: CSV import adds new items and updates existing ones', async () => {
  const dir = tmpDir();
  const { store, engine } = open(dir);
  await engine.refresh();
  const r1 = await store.importCsv('Item,Category,Quantity,Ordered\nHDMI cable,Cables,5,No\nMouse,Mice,3,Yes\n');
  assert.deepEqual(r1, { added: 2, updated: 0 });
  const r2 = await store.importCsv('Item,Category,Quantity\nHDMI cable,Cables,9\n');
  assert.deepEqual(r2, { added: 0, updated: 1 });
  await engine.refresh();
  const by = Object.fromEntries(engine.snapshot().items.map((i) => [i.name, i]));
  assert.equal(by['HDMI cable'].qty, 9);
  assert.equal(by.Mouse.ordered, true);
});

test('just this PC: looking at an unused folder does not create it', () => {
  const dir = tmpDir();
  const store = new LocalStore({ dir: path.join(dir, 'stock') });
  assert.equal(store.count(), 0);
  assert.equal(fs.existsSync(path.join(dir, 'stock')), false);
});

test('a list file that cannot be read is reported, never replaced by an empty list', async () => {
  const dir = tmpDir();
  const stock = path.join(dir, 'stock');
  fs.mkdirSync(path.join(stock, 'data.json'), { recursive: true }); // unreadable as a file
  const { engine } = open(dir);
  assert.equal(await engine.refresh(), false);
  assert.equal(engine.snapshot().status.kind, 'disk');
  assert.match(engine.snapshot().status.error, /Cannot open the stock list/);
});

test('settings: where the list is kept (mode)', () => {
  const dir = tmpDir();
  const f = path.join(dir, 'config.json');
  assert.equal(config.loadConfig(f).mode, '', 'first start: not chosen yet');
  fs.writeFileSync(f, JSON.stringify({ server: { url: 'stock-vm:8080', tokenEnc: 'abcd', name: 'X' } }));
  assert.equal(config.loadConfig(f).mode, 'server', 'already paired');
  fs.writeFileSync(f, JSON.stringify({ mode: 'local' }));
  assert.equal(config.loadConfig(f).mode, 'local');
  fs.writeFileSync(f, JSON.stringify({ mode: 'cloud' }));
  assert.equal(config.loadConfig(f).mode, '');
  assert.equal(config.sanitizeSettings({ mode: 'local' }).mode, undefined, 'Settings > Save cannot change it');
});

test('reset forgets the old list, its cache and anything unsent', async () => {
  const dir = tmpDir();
  const { engine } = open(dir);
  await engine.refresh();
  const id = engine.addItem({ name: 'Old' });
  await engine.flush();
  engine.tap(id, 1);
  await engine.reset();
  assert.equal(engine.snapshot().items.length, 0);
  assert.equal(engine.queue.length, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'cache.json'), 'utf8')).items, []);
});
