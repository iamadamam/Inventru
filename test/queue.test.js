'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PersistentQueue } = require('../src/core/queue');
const { tmpDir } = require('./helpers');

const file = () => path.join(tmpDir(), 'q.json');

test('enqueue persists immediately and survives a restart', () => {
  const f = file();
  const q = new PersistentQueue(f);
  q.enqueue({ itemId: 'a', name: 'A', delta: 1 });
  const q2 = new PersistentQueue(f); // "crash" + reload
  assert.equal(q2.length, 1);
  assert.equal(q2.pendingDelta('a'), 1);
});

test('rapid taps on the same item coalesce into one op, keeping the tap count', () => {
  const q = new PersistentQueue(file());
  q.enqueue({ itemId: 'a', name: 'A', delta: 1 });
  q.enqueue({ itemId: 'a', name: 'A', delta: 1 });
  q.enqueue({ itemId: 'a', name: 'A', delta: 5 });
  assert.equal(q.length, 1);
  assert.equal(q.pendingDelta('a'), 7);
  assert.equal(q.pendingTaps, 3);
});

test('different items do not merge', () => {
  const q = new PersistentQueue(file());
  q.enqueue({ itemId: 'a', name: 'A', delta: 1 });
  q.enqueue({ itemId: 'b', name: 'B', delta: 1 });
  assert.equal(q.length, 2);
});

test('+1 then -1 cancels out', () => {
  const q = new PersistentQueue(file());
  q.enqueue({ itemId: 'a', name: 'A', delta: 1 });
  q.enqueue({ itemId: 'a', name: 'A', delta: -1 });
  assert.equal(q.length, 0);
});

test('an in-flight op is never merged into (a new op is created)', () => {
  const q = new PersistentQueue(file());
  const op = q.enqueue({ itemId: 'a', name: 'A', delta: 1 });
  q.markInflight([op.id]);
  q.enqueue({ itemId: 'a', name: 'A', delta: 1 });
  assert.equal(q.length, 2);
});

test('ops that were in flight when the app died reload as ambiguous', () => {
  const f = file();
  const q = new PersistentQueue(f);
  const op = q.enqueue({ itemId: 'a', name: 'A', delta: 3 });
  q.markInflight([op.id]);
  const q2 = new PersistentQueue(f);
  assert.equal(q2.pending()[0].ambiguous, true);
  assert.equal(q2.pending()[0].inflight, false);
});

test('ambiguous ops are not merged into either', () => {
  const q = new PersistentQueue(file());
  const op = q.enqueue({ itemId: 'a', name: 'A', delta: 1 });
  q.markAmbiguous([op.id]);
  q.enqueue({ itemId: 'a', name: 'A', delta: 1 });
  assert.equal(q.length, 2);
});

test('rejects zero / fractional deltas', () => {
  const q = new PersistentQueue(file());
  assert.throws(() => q.enqueue({ itemId: 'a', name: 'A', delta: 0 }));
  assert.throws(() => q.enqueue({ itemId: 'a', name: 'A', delta: 1.5 }));
});

test('dead-lettered ops are kept for inspection, not silently lost', () => {
  const f = file();
  const q = new PersistentQueue(f);
  const op = q.enqueue({ itemId: 'a', name: 'A', delta: 1 });
  q.toDead(op.id, 'gone');
  const q2 = new PersistentQueue(f);
  assert.equal(q2.length, 0);
  assert.equal(q2.dead.length, 1);
  assert.equal(q2.dead[0].reason, 'gone');
});

test('a corrupt queue file falls back to the backup instead of losing everything', () => {
  const f = file();
  const q = new PersistentQueue(f);
  q.enqueue({ itemId: 'a', name: 'A', delta: 1 });
  q.enqueue({ itemId: 'b', name: 'B', delta: 1 }); // 2nd write creates .bak of the 1st state
  fs.writeFileSync(f, '{ not json');
  const q2 = new PersistentQueue(f);
  assert.ok(q2.length >= 1);
});
