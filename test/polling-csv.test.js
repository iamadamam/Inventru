'use strict';
// Polling policy and CSV import/export.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { setup, tmpDir } = require('./helpers');
const { PersistentQueue } = require('../src/core/queue');
const { SyncEngine } = require('../src/core/sync');
const { toCsv, parseCsv, rowsToItems } = require('../src/core/csv');

// ---------------------------------------------------------------- polling policy
test('when polling is not allowed, tick sends changes but does NOT read from the server', async () => {
  const { engine, store } = await setup();
  engine.shouldPoll = () => false;
  const reads = store.calls.fetch;
  engine.tap('a', 1);
  await engine.tick();
  assert.equal(store.rows[0].qty, 11, 'write still delivered');
  assert.equal(store.calls.fetch, reads, 'no read from the server');
});

test('a forced tick (Sync button / window focus) reads even when polling is paused', async () => {
  const { engine, store } = await setup();
  engine.shouldPoll = () => false;
  const reads = store.calls.fetch;
  await engine.tick(true);
  assert.equal(store.calls.fetch, reads + 1);
});

test('first load always reads, even with polling paused', async () => {
  const dir = tmpDir();
  const { MemoryStore } = require('../src/core/memorystore');
  const store = new MemoryStore([{ id: 'a', name: 'A', qty: 1 }]);
  const engine = new SyncEngine({ store, queue: new PersistentQueue(path.join(dir, 'q.json')), autoTimers: false, shouldPoll: () => false });
  await engine.tick();
  assert.equal(engine.getItem('a').qty, 1);
});

test('adding an item triggers a read afterwards even with polling paused (to pick up the new item)', async () => {
  const { engine, store } = await setup();
  engine.shouldPoll = () => false;
  engine.addItem({ name: 'Dock' });
  const reads = store.calls.fetch;
  await engine.tick();
  assert.ok(store.calls.fetch > reads);
});

// ---------------------------------------------------------------- CSV
test('CSV round-trips quotes, commas and newlines', () => {
  const rows = [['Item', 'Note'], ['24" monitor, IPS', 'line1\nline2']];
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
});

test('CSV export neutralises formula injection but keeps negative numbers', () => {
  const out = toCsv([['=HYPERLINK("x")', '-3', '+SUM(A1)', '@cmd']]);
  assert.ok(out.startsWith(`"'=HYPERLINK(""x"")",-3,'+SUM(A1),'@cmd`));
});

test('CSV import understands headers in any order, and Excel semicolon CSVs', () => {
  const items = rowsToItems(parseCsv('Category;Qty;Item;Ordered\r\nMice;4;Mouse;yes\r\nMonitors;x;Monitor;\r\n'));
  assert.deepEqual(items, [
    { name: 'Mouse', qty: 4, ordered: true, group: 'Mice', sub: '' },
    { name: 'Monitor', qty: 0, ordered: false, group: 'Monitors', sub: '' },
  ]);
});

test('CSV import keeps inch marks in unquoted names (24" monitor)', () => {
  assert.deepEqual(rowsToItems(parseCsv('Item,Quantity\r\n24" monitor,3\r\nLaptop bag 15",2\r\n')).map((i) => [i.name, i.qty]),
    [['24" monitor', 3], ['Laptop bag 15"', 2]]);
});

test('CSV import without a header assumes Item, Quantity, Ordered, Category', () => {
  assert.deepEqual(rowsToItems(parseCsv('Keyboard,3,no,Keyboards\n')), [{ name: 'Keyboard', qty: 3, ordered: false, group: 'Keyboards', sub: '' }]);
});
