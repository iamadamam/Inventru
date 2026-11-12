'use strict';
const { SyncError } = require('./errors');
const { planBatch } = require('./batch');

/**
 * In-memory stand-in for the server: the demo mode (npm run start:demo) and the tests use it.
 * Same interface as ServerStore: fetchItems(), applyBatch(ops), wasApplied(opIds).
 */
class MemoryStore {
  constructor(items = [], { logEnabled = true } = {}) {
    this.rows = items.map((i) => ({ ordered: false, group: '', sub: '', ...i }));
    this.log = [];
    this.logEnabled = logEnabled; // false: the store cannot say which changes it has applied
    this.offline = false;
    this.failNext = null;         // { applied: bool } -> the next applyBatch loses its answer (applied or not)
    this.calls = { fetch: 0, apply: 0 };
  }

  _gate() { if (this.offline) throw new SyncError('offline', { kind: 'network' }); }

  async fetchItems() {
    this._gate(); this.calls.fetch++;
    return this.rows.map((r) => ({ ...r }));
  }

  async applyBatch(ops) {
    this._gate(); this.calls.apply++;
    const before = this.rows.map((r) => ({ ...r }));
    const plan = planBatch(this.rows.map((r, i) => ({ ...r, row: i })), ops);
    for (const w of plan.cellWrites) this.rows[w.row][w.field] = w.value;
    for (const a of plan.appends) this.rows.push({ id: a.id, name: a.name, group: a.group, sub: a.sub || '', qty: 0, ordered: false });
    if (plan.deletes.length) { const dead = new Set(plan.deletes); this.rows = this.rows.filter((_, i) => !dead.has(i)); }
    const okIds = new Set(plan.results.filter((r) => r.status === 'ok').map((r) => r.opId));
    const logged = plan.log.filter((l) => okIds.has(l.opId));
    if (this.failNext) {
      const { applied } = this.failNext; this.failNext = null;
      if (applied) { if (this.logEnabled) this.log.push(...logged); } else this.rows = before;
      throw new SyncError('connection reset', { kind: 'network', ambiguous: true });
    }
    if (this.logEnabled) this.log.push(...logged);
    return { results: plan.results };
  }

  async wasApplied(opIds) {
    this._gate();
    if (!this.logEnabled) return null;
    const seen = new Set(this.log.map((l) => l.opId));
    return new Set(opIds.filter((id) => seen.has(id)));
  }

  // test helper: another PC changes an item directly on the server
  externalSet(id, qty) { this.rows.find((r) => r.id === id).qty = qty; }
}

module.exports = { MemoryStore };
