'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

test('ordered toggle is optimistic, queued, and saved on the server', async () => {
  const { engine, store } = await setup();
  engine.setField('a', 'ordered', true);
  assert.equal(engine.getItem('a').ordered, true);
  assert.equal(store.rows[0].ordered, false);
  await engine.flush();
  assert.equal(store.rows[0].ordered, true);
  assert.equal(engine.snapshot().status.pending, 0);
});

test('toggling ordered repeatedly offline sends only the final value', async () => {
  const { engine, store } = await setup();
  store.offline = true;
  engine.setField('a', 'ordered', true);
  engine.setField('a', 'ordered', false);
  engine.setField('a', 'ordered', true);
  assert.equal(engine.queue.length, 1);
  store.offline = false;
  await engine.flush();
  assert.equal(store.rows[0].ordered, true);
});

test('rename and group edits work offline and sync later', async () => {
  const { engine, store } = await setup();
  store.offline = true;
  engine.setField('a', 'name', '  Green apples ');
  engine.setField('a', 'group', 'Used');
  assert.equal(engine.getItem('a').name, 'Green apples');
  assert.equal(await engine.flush(), false);
  store.offline = false;
  await engine.tick();
  assert.equal(store.rows[0].name, 'Green apples');
  assert.equal(store.rows[0].group, 'Used');
});

test('empty names are rejected', async () => {
  const { engine } = await setup();
  assert.equal(engine.setField('a', 'name', '   ').ok, false);
});

test('a quantity change here and a rename on another PC do not interfere', async () => {
  const { engine, store } = await setup();
  engine.tap('a', 1);
  store.rows[0].name = 'Renamed elsewhere';
  await engine.tick();
  assert.equal(engine.getItem('a').name, 'Renamed elsewhere');
  assert.equal(store.rows[0].qty, 11);
});

test('added item shows immediately; qty/ordered edits to it apply right after the add', async () => {
  const { engine, store } = await setup();
  const id = engine.addItem({ name: 'Webcam', group: 'New' });
  assert.equal(engine.getItem(id).qty, 0);
  engine.tap(id, 4);
  engine.setField(id, 'ordered', true);
  await engine.tick();
  const row = store.rows.find((r) => r.id === id);
  assert.equal(row.qty, 4);
  assert.equal(row.ordered, true);
  assert.equal(row.group, 'New');
  assert.equal(store.rows.filter((r) => r.id === id).length, 1);
  assert.equal(engine.snapshot().status.pending, 0);
});

test('added item survives a restart while offline and is delivered later', async () => {
  const { engine, store, mk } = await setup();
  store.offline = true;
  const id = engine.addItem({ name: 'Dock' });
  await engine.flush();
  const engine2 = mk();
  assert.ok(engine2.getItem(id), 'restored from the queue');
  store.offline = false;
  await engine2.tick();
  assert.ok(store.rows.some((r) => r.id === id));
});

test('a new item whose answer was lost (but was saved) is not added twice', async () => {
  const { engine, store } = await setup();
  store.failNext = { applied: true };
  const id = engine.addItem({ name: 'Dock' });
  engine.tap(id, 2);
  await engine.flush();
  assert.equal(engine.snapshot().status.state, 'offline');
  await engine.tick();
  await engine.tick();
  assert.equal(store.rows.filter((r) => r.id === id).length, 1, 'exactly one Dock');
  assert.equal(store.rows.find((r) => r.id === id).qty, 2);
  assert.equal(engine.snapshot().status.pending, 0);
});

test('deleting hides the item immediately and removes it on sync', async () => {
  const { engine, store } = await setup();
  engine.deleteItem('b');
  assert.equal(engine.getItem('b'), null);
  await engine.tick();
  assert.deepEqual(store.rows.map((r) => r.id), ['a']);
});

test('deleting an item that never reached the server cancels everything quietly', async () => {
  const { engine, store } = await setup();
  store.offline = true;
  const id = engine.addItem({ name: 'Oops' });
  engine.tap(id, 2);
  engine.deleteItem(id);
  assert.equal(engine.queue.length, 0);
  assert.equal(engine.getItem(id), null);
});

test('delete while offline persists and is delivered later', async () => {
  const { engine, store } = await setup();
  store.offline = true;
  engine.deleteItem('a');
  await engine.flush();
  assert.equal(engine.getItem('a'), null);
  store.offline = false;
  await engine.tick();
  assert.equal(store.rows.some((r) => r.id === 'a'), false);
});
