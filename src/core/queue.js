'use strict';
const crypto = require('crypto');
const { readJson, writeJsonAtomic } = require('./jsonfile');

/**
 * Durable queue of changes. Every change is persisted (fsync + atomic rename) before the UI
 * is told it succeeded, so a crash or power cut cannot lose anything.
 *
 * Op kinds (op.kind, default 'delta'):
 *   delta   { itemId, delta }                 quantity change (never an absolute value)
 *   set     { itemId, field, value }          field = name | group | sub | ordered   (last write wins)
 *   add     { itemId, name, group, sub }      new item row  (group = category, sub = subcategory)
 *   delete  { itemId }                        remove item row
 * Common: id, itemId, name, count, ts, inflight, ambiguous
 *  - inflight   currently being sent (persisted: a crash mid-send reloads as ambiguous)
 *  - ambiguous  a previous send may have been applied on the server
 */
class PersistentQueue {
  constructor(file, { now = () => new Date() } = {}) {
    this.file = file;
    this.now = now;
    const d = readJson(file, {});
    this.ops = Array.isArray(d.ops) ? d.ops : [];
    this.dead = Array.isArray(d.dead) ? d.dead : [];
    for (const op of this.ops) {
      op.kind = op.kind || 'delta';
      if (op.inflight) { op.ambiguous = true; op.inflight = false; }
    }
  }

  _save() { writeJsonAtomic(this.file, { ops: this.ops, dead: this.dead.slice(-100) }); }

  get length() { return this.ops.length; }
  get pendingTaps() { return this.ops.reduce((n, o) => n + (o.count || 1), 0); }
  has(id) { return this.ops.some((o) => o.id === id); }
  pending() { return this.ops.map((o) => ({ ...o })); }

  pendingDelta(itemId) {
    let sum = 0;
    for (const o of this.ops) if (o.itemId === itemId && o.kind === 'delta') sum += o.delta;
    return sum;
  }

  hasOps(itemId) { return this.ops.some((o) => o.itemId === itemId); }

  /** What the queue would change about an item once sent. */
  overlay(itemId) {
    const out = { delta: 0, fields: {}, added: false, deleted: false };
    for (const o of this.ops) {
      if (o.itemId !== itemId) continue;
      if (o.kind === 'delta') out.delta += o.delta;
      else if (o.kind === 'set') out.fields[o.field] = o.value;
      else if (o.kind === 'add') {
        // edits made before the add was sent are folded into it (see enqueueSet) - show them
        out.added = true;
        out.fields.name = o.name;
        out.fields.group = o.group || '';
        out.fields.sub = o.sub || '';
      }
      else if (o.kind === 'delete') out.deleted = true;
    }
    return out;
  }

  _free(op) { return !op.inflight && !op.ambiguous; }

  _push(fields) {
    const op = {
      id: crypto.randomUUID(), kind: 'delta', count: 1, ts: this.now().toISOString(),
      inflight: false, ambiguous: false, ...fields,
    };
    this.ops.push(op);
    this._save();
    return op;
  }

  enqueue({ itemId, name, delta }) {
    if (!Number.isInteger(delta) || delta === 0) throw new Error('delta must be a non-zero integer');
    // Merge into a not-yet-sent op for the same item (saves API calls on rapid taps).
    for (let i = this.ops.length - 1; i >= 0; i--) {
      const op = this.ops[i];
      if (op.kind === 'delta' && op.itemId === itemId && this._free(op)) {
        op.delta += delta;
        op.count += 1;
        if (op.delta === 0) this.ops.splice(i, 1); // net zero: nothing to send
        this._save();
        return op;
      }
    }
    return this._push({ kind: 'delta', itemId, name, delta });
  }

  enqueueSet({ itemId, name, field, value }) {
    for (let i = this.ops.length - 1; i >= 0; i--) {
      const op = this.ops[i];
      if (op.itemId !== itemId || !this._free(op)) continue;
      if (op.kind === 'set' && op.field === field) { op.value = value; op.count += 1; this._save(); return op; }
      // fold name / category / subcategory into an unsent add (other fields are sent as their own op after it)
      if (op.kind === 'add' && ['name', 'group', 'sub'].includes(field)) { op[field] = value; this._save(); return op; }
    }
    return this._push({ kind: 'set', itemId, name, field, value });
  }

  enqueueAdd({ itemId, name, group, sub }) {
    return this._push({ kind: 'add', itemId, name, group: group || '', sub: sub || '' });
  }

  /** Returns the delete op, or null when the item never reached the server (net nothing to do). */
  enqueueDelete({ itemId, name }) {
    const mine = this.ops.filter((o) => o.itemId === itemId);
    const unsent = mine.every((o) => this._free(o));
    if (unsent && mine.some((o) => o.kind === 'add')) {
      this.ops = this.ops.filter((o) => o.itemId !== itemId);
      this._save();
      return null;
    }
    this.ops = this.ops.filter((o) => !(o.itemId === itemId && this._free(o) && o.kind !== 'add'));
    return this._push({ kind: 'delete', itemId, name });
  }

  _each(ids, fn) {
    const set = new Set(ids);
    for (const op of this.ops) if (set.has(op.id)) fn(op);
    this._save();
  }

  markInflight(ids) { this._each(ids, (o) => { o.inflight = true; }); }
  release(ids) { this._each(ids, (o) => { o.inflight = false; }); }
  markAmbiguous(ids) { this._each(ids, (o) => { o.inflight = false; o.ambiguous = true; }); }

  remove(ids) {
    const set = new Set(ids);
    this.ops = this.ops.filter((o) => !set.has(o.id));
    this._save();
  }

  /** Permanently undeliverable (e.g. the item was deleted on another PC). Kept for inspection. */
  toDead(id, reason) {
    const op = this.ops.find((o) => o.id === id);
    if (!op) return;
    this.dead.push({ ...op, inflight: false, reason, at: this.now().toISOString() });
    this.remove([id]);
  }
}

module.exports = { PersistentQueue };
