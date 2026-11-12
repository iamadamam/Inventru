'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

const qty = (engine, id) => engine.getItem(id).qty;

test('tap updates the UI immediately (optimistic), before any network call', async () => {
  const { engine, store } = await setup();
  engine.tap('a', 1);
  assert.equal(qty(engine, 'a'), 11);
  assert.equal(store.rows[0].qty, 10); // server untouched until flush
  assert.equal(engine.snapshot().status.pending, 1);
});

test('flush sends the delta to the server and clears the queue', async () => {
  const { engine, store } = await setup();
  engine.tap('a', 1); engine.tap('a', 1); engine.tap('a', 5);
  await engine.flush();
  assert.equal(store.rows[0].qty, 17);
  assert.equal(qty(engine, 'a'), 17);
  assert.equal(engine.snapshot().status.pending, 0);
  assert.equal(store.calls.apply, 1, 'rapid taps are sent as a single batch');
});

test('quantity can never go below 0', async () => {
  const { engine, store } = await setup();
  const r = engine.tap('b', -5); // has 2
  assert.equal(r.applied, -2);
  assert.equal(qty(engine, 'b'), 0);
  assert.equal(engine.tap('b', -1).applied, 0); // already 0: nothing queued
  await engine.flush();
  assert.equal(store.rows[1].qty, 0);
});

test('setExact is sent as a delta from the displayed value', async () => {
  const { engine, store } = await setup();
  engine.setExact('a', 25);
  assert.equal(engine.queue.pendingDelta('a'), 15);
  await engine.flush();
  assert.equal(store.rows[0].qty, 25);
});

test('a change made on another PC is NOT overwritten: deltas apply on top of the server value', async () => {
  const { engine, store } = await setup();
  engine.tap('a', 1);                 // local view 11, queued +1
  store.externalSet('a', 100);        // another PC changes it
  await engine.flush();
  assert.equal(store.rows[0].qty, 101, 'delta applied to the server value, not overwritten by 11');
  assert.equal(qty(engine, 'a'), 101);
});

test('pull while taps are pending shows server value + pending deltas', async () => {
  const { engine, store } = await setup();
  store.externalSet('a', 50);
  engine.tap('a', 2);
  await engine.refresh();
  assert.equal(qty(engine, 'a'), 52);
});

test('offline: taps are queued, status reports pending, nothing is lost', async () => {
  const { engine, store } = await setup();
  store.offline = true;
  engine.tap('a', 1); engine.tap('b', 1);
  assert.equal(await engine.flush(), false);
  const s = engine.snapshot().status;
  assert.equal(s.state, 'offline');
  assert.equal(s.pending, 2);
  assert.equal(qty(engine, 'a'), 11); // UI still correct
});

test('recovers automatically once back online and applies everything exactly once', async () => {
  const { engine, store } = await setup();
  store.offline = true;
  engine.tap('a', 1); await engine.flush();
  engine.tap('a', 1); await engine.flush();
  store.offline = false;
  await engine.tick();
  assert.equal(store.rows[0].qty, 12);
  assert.equal(engine.snapshot().status.state, 'ok');
  assert.equal(engine.snapshot().status.pending, 0);
});

test('taps made offline survive an app restart and are delivered afterwards', async () => {
  const { engine, store, mk } = await setup();
  store.offline = true;
  engine.tap('a', 3);
  await engine.flush();
  const engine2 = mk(); // new process, same files
  await engine2.refresh().catch(() => {});
  assert.equal(qty(engine2, 'a'), 13, 'cached server value + persisted pending delta');
  store.offline = false;
  await engine2.tick();
  assert.equal(store.rows[0].qty, 13);
});

test('lost response, server DID apply: not applied twice (detected via the log)', async () => {
  const { engine, store } = await setup();
  store.failNext = { applied: true };
  engine.tap('a', 4);
  assert.equal(await engine.flush(), false);
  assert.equal(store.rows[0].qty, 14);
  await engine.tick();
  assert.equal(store.rows[0].qty, 14, 'no duplicate');
  assert.equal(qty(engine, 'a'), 14);
  assert.equal(engine.snapshot().status.pending, 0);
});

test('lost request, server did NOT apply: retried and applied once', async () => {
  const { engine, store } = await setup();
  store.failNext = { applied: false };
  engine.tap('a', 4);
  await engine.flush();
  assert.equal(store.rows[0].qty, 10);
  await engine.tick();
  assert.equal(store.rows[0].qty, 14);
});

test('a tap made while a previous send is ambiguous is kept as its own op', async () => {
  const { engine, store } = await setup();
  store.failNext = { applied: true };
  engine.tap('a', 1);
  await engine.flush();
  engine.tap('a', 1);
  assert.equal(engine.queue.length, 2);
  await engine.tick();
  assert.equal(store.rows[0].qty, 12);
});

test('crash mid-send (reload with inflight op) does not double-apply', async () => {
  const { engine, store, mk } = await setup();
  engine.tap('a', 2);
  engine.queue.markInflight(engine.queue.pending().map((o) => o.id));
  await store.applyBatch(engine.queue.pending().map((o) => ({ opId: o.id, itemId: o.itemId, delta: o.delta })));
  // process dies here: server updated, queue not cleared
  const engine2 = mk();
  await engine2.tick();
  assert.equal(store.rows[0].qty, 12);
  assert.equal(engine2.snapshot().status.pending, 0);
});

test('item deleted on another PC: tap is dead-lettered, not retried forever', async () => {
  const { engine, store } = await setup();
  engine.tap('b', 1);
  store.rows = store.rows.filter((r) => r.id !== 'b');
  await engine.flush();
  assert.equal(engine.queue.length, 0);
  assert.equal(engine.queue.dead.length, 1);
  await engine.refresh();
  assert.equal(engine.getItem('b'), null);
});

test('two people tapping the same item in quick succession both count', async () => {
  const { engine, store } = await setup();
  engine.tap('a', 1);
  const f1 = engine.flush();
  engine.tap('a', 1);            // arrives while first send is in flight
  const f2 = engine.flush();
  await Promise.all([f1, f2]);
  assert.equal(store.rows[0].qty, 12);
  assert.equal(qty(engine, 'a'), 12);
});

test('items added on another PC appear after the next pull', async () => {
  const { engine, store } = await setup();
  store.rows.push({ id: 'c', name: 'Cherries', qty: 7 });
  await engine.refresh();
  assert.equal(qty(engine, 'c'), 7);
});

test('config problems (auth) are reported as an error, not as offline', async () => {
  const { engine, store } = await setup();
  const { SyncError } = require('../src/core/errors');
  store.fetchItems = async () => { throw new SyncError('No access', { kind: 'auth' }); };
  await engine.refresh();
  assert.equal(engine.snapshot().status.state, 'error');
});

test('backoff grows on repeated failures and resets on success', async () => {
  const { engine, store } = await setup();
  store.offline = true;
  engine.tap('a', 1);
  await engine.flush(); assert.equal(engine._backoffDelay(), 2000);
  await engine.flush(); assert.equal(engine._backoffDelay(), 4000);
  await engine.flush(); assert.equal(engine._backoffDelay(), 8000);
  store.offline = false;
  await engine.flush();
  assert.equal(engine._failures, 0);
});
