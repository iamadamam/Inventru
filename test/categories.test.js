'use strict';
// Subcategories, and the "edit a just-added item" display bug.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const { parseCsv, rowsToItems } = require('../src/core/csv');

test('category / name chosen for a just-added (unsent) item show immediately', async () => {
  const { engine, store } = await setup();
  store.offline = true; // keep the add unsent
  const id = engine.addItem({ name: 'New item' });
  engine.setField(id, 'group', 'Spares');
  engine.setField(id, 'name', 'Docking station');
  engine.setField(id, 'sub', 'Used');
  const v = engine.getItem(id);
  assert.deepEqual([v.name, v.group, v.sub], ['Docking station', 'Spares', 'Used']);
  assert.equal(engine.queue.length, 1, 'edits folded into the single add');
  store.offline = false;
  await engine.tick();
  const row = store.rows.find((r) => r.id === id);
  assert.deepEqual([row.name, row.group, row.sub], ['Docking station', 'Spares', 'Used']);
});

test('subcategory is set, synced and survives a pull', async () => {
  const { engine, store } = await setup();
  engine.setField('a', 'sub', 'Refurbished');
  assert.equal(engine.getItem('a').sub, 'Refurbished');
  await engine.tick();
  assert.equal(store.rows[0].sub, 'Refurbished');
  await engine.refresh();
  assert.equal(engine.getItem('a').sub, 'Refurbished');
});

test('add with category + subcategory', async () => {
  const { engine, store } = await setup();
  const id = engine.addItem({ name: '27" monitor', group: 'Monitors', sub: 'Used' });
  await engine.tick();
  const row = store.rows.find((r) => r.id === id);
  assert.deepEqual([row.group, row.sub], ['Monitors', 'Used']);
});

test('CSV import reads a Subcategory column', () => {
  const items = rowsToItems(parseCsv('Item,Category,Subcategory,Quantity\r\nMonitor,Monitors,Used,2\r\n'));
  assert.deepEqual(items[0], { name: 'Monitor', qty: 2, ordered: false, group: 'Monitors', sub: 'Used' });
});
