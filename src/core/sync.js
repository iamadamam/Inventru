'use strict';
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { readJson, writeJsonAtomic } = require('./jsonfile');

/**
 * SyncEngine keeps this PC in step with the Inventru server.
 *
 *  - The server is the source of truth (serverQty, name, category, ordered, warn-at level).
 *  - Changes are stored in a durable queue; what the user sees = server value + queued changes.
 *  - Quantity changes are sent as deltas (never absolute values), so changes made on another PC
 *    at the same time are never overwritten.
 *  - All network work is serialised, so a poll can never interleave with a send.
 *
 * `store` interface: fetchItems(), applyBatch(ops) -> {results}, wasApplied?(opIds)
 */
class SyncEngine extends EventEmitter {
  constructor({
    store = null, queue, cacheFile = null, pollMs = 15000, autoFlushDelayMs = 250,
    backoff = { base: 2000, max: 60000 }, autoTimers = true, now = () => new Date(),
    shouldPoll = () => true,
  }) {
    super();
    this.store = store;
    this.queue = queue;
    this.cacheFile = cacheFile;
    this.pollMs = pollMs;
    this.autoFlushDelayMs = autoFlushDelayMs;
    this.backoff = backoff;
    this.autoTimers = autoTimers;
    this.now = now;
    this.shouldPoll = shouldPoll; // gate for *reading* the server; queued changes are always sent
    this.lastPullAt = 0;

    this.items = new Map();
    this._failures = 0;
    this._needRefresh = false;
    this._chain = Promise.resolve();
    this._timer = null;
    this._stopped = true;
    this.status = { syncing: false, lastSyncAt: null, error: null, kind: null, everSynced: false };
    this.dropped = 0;
    this._loadCache();
  }

  // ---- lifecycle -------------------------------------------------------
  start() { this._stopped = false; this._arm(0); }
  stop() { this._stopped = true; clearTimeout(this._timer); }
  setStore(store) { this.store = store; this._failures = 0; this._arm(0); }

  /** Moving to another list (another server, or "Just this PC"): forget the old list, its cache and unsent changes. */
  reset() {
    return this._run(() => {
      this.items = new Map();
      this.queue.ops.length = 0; this.queue.remove([]);
      this.dropped = 0; this._needRefresh = false; this.lastPullAt = 0;
      Object.assign(this.status, { syncing: false, lastSyncAt: null, error: null, kind: null, everSynced: false });
      this._persistCache();
      this.emit('change');
    });
  }

  _arm(ms) {
    if (!this.autoTimers || this._stopped) return;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => { this.tick().catch(() => {}); }, ms);
    if (this._timer.unref) this._timer.unref();
  }

  _backoffDelay() {
    const { base, max } = this.backoff;
    return Math.min(max, base * 2 ** Math.max(0, this._failures - 1));
  }

  /**
   * One sync cycle: send pending changes, then (if allowed) read the latest list from the server.
   * A pull happens when forced (user pressed Sync / window focused), on first load, after
   * structural changes (add/delete), or when the shouldPoll() policy allows it.
   */
  async tick(force = false) {
    const ok = await this.flush();
    const pull = ok && (this._needRefresh
      || (this.queue.length === 0 && (force || !this.status.everSynced || this.shouldPoll())));
    if (pull) await this.refresh();
    this._arm(this.status.error ? this._backoffDelay() : this.pollMs);
  }

  // ---- reading ---------------------------------------------------------
  /** Server state + queued changes. */
  view(it) {
    const o = this.queue.overlay(it.id);
    return {
      id: it.id,
      name: o.fields.name ?? it.name,
      group: o.fields.group ?? it.group,
      sub: o.fields.sub ?? (it.sub || ''),
      low: o.fields.low !== undefined ? o.fields.low : (it.low ?? null), // warn-at level (stored on the server)
      ordered: o.fields.ordered ?? it.ordered,
      qty: Math.max(0, it.serverQty + o.delta),
      serverQty: it.serverQty,
      pending: this.queue.hasOps(it.id),
      deleted: o.deleted,
    };
  }

  getItem(id) {
    const it = this.items.get(id);
    if (!it) return null;
    const v = this.view(it);
    return v.deleted ? null : v;
  }

  snapshot() {
    const items = [...this.items.values()].map((it) => this.view(it)).filter((v) => !v.deleted);
    const { error, kind, syncing, lastSyncAt, everSynced } = this.status;
    let state = 'ok';
    if (error) state = (kind === 'auth' || kind === 'config' || kind === 'disk') ? 'error' : 'offline';
    return {
      items,
      status: { state, error, kind, syncing, lastSyncAt, everSynced, pending: this.queue.pendingTaps, dropped: this.dropped },
    };
  }

  // ---- writing ---------------------------------------------------------
  _changed() { this.emit('change'); this._arm(this.autoFlushDelayMs); }

  /** Optimistic +/- . Returns the delta actually applied (clamped so qty never < 0). */
  tap(itemId, delta) {
    const v = this.getItem(itemId);
    if (!v || !Number.isFinite(delta)) return { ok: false, applied: 0 };
    delta = Math.trunc(delta);
    if (v.qty + delta < 0) delta = -v.qty;
    if (delta === 0) return { ok: true, applied: 0 };
    this.queue.enqueue({ itemId, name: v.name, delta });
    this._changed();
    return { ok: true, applied: delta };
  }

  /** "Set to N" is expressed as a delta from what the user currently sees. */
  setExact(itemId, target) {
    const v = this.getItem(itemId);
    if (!v || !Number.isFinite(target)) return { ok: false, applied: 0 };
    return this.tap(itemId, Math.max(0, Math.round(target)) - v.qty);
  }

  /** field: name | group (category) | sub (subcategory) | ordered | low (warn-at). Last write wins. */
  setField(itemId, field, value) {
    const v = this.getItem(itemId);
    if (!v || !['name', 'group', 'sub', 'ordered', 'low'].includes(field)) return { ok: false };
    if (field === 'ordered') value = !!value;
    else if (field === 'low') {
      const n = value === '' || value == null ? null : Math.round(Number(value));
      value = Number.isFinite(n) && n >= 0 ? n : null;
    } else {
      value = String(value == null ? '' : value).trim().slice(0, 80);
      if (field === 'name' && !value) return { ok: false };
    }
    if (v[field] === value) return { ok: true, changed: false };
    this.queue.enqueueSet({ itemId, name: v.name, field, value });
    this._changed();
    return { ok: true, changed: true };
  }

  addItem({ name, group = '', sub = '' }) {
    const id = `itm_${crypto.randomBytes(3).toString('hex')}`;
    const clean = String(name || '').trim().slice(0, 80) || 'New item';
    const g = String(group || '').trim().slice(0, 80);
    const s = String(sub || '').trim().slice(0, 80);
    this.items.set(id, { id, name: clean, group: g, sub: s, ordered: false, serverQty: 0 });
    this.queue.enqueueAdd({ itemId: id, name: clean, group: g, sub: s });
    this._changed();
    return id;
  }

  deleteItem(itemId) {
    const it = this.items.get(itemId);
    if (!it) return false;
    const op = this.queue.enqueueDelete({ itemId, name: this.view(it).name });
    if (!op) this.items.delete(itemId); // never reached the server
    this._changed();
    return true;
  }

  // ---- serialised network work ----------------------------------------
  _run(fn) {
    const p = this._chain.then(fn);
    this._chain = p.catch(() => {});
    return p;
  }
  flush() { return this._run(() => this._flushAll()); }
  refresh() { return this._run(() => this._refresh()); }

  /** Changes the store deferred (e.g. edits to an item added in the same batch) get another pass. */
  async _flushAll() {
    for (let pass = 0; pass < 3; pass++) {
      const before = this.queue.length;
      const ok = await this._flush();
      if (!ok || this.queue.length === 0 || this.queue.length >= before) return ok;
    }
    return true;
  }

  async _flush() {
    if (!this.queue.length) return true;
    if (!this.store) { this._fail({ message: 'Not connected to a server', kind: 'config' }); return false; }
    const ops = this.queue.pending();
    const ids = ops.map((o) => o.id);
    this.queue.markInflight(ids);
    this._set({ syncing: true });
    try {
      let send = ops;
      const amb = ops.filter((o) => o.ambiguous && o.kind === 'delta');
      if (amb.length && typeof this.store.wasApplied === 'function') {
        // A previous attempt may have succeeded without us hearing back. Check the log.
        const applied = await this.store.wasApplied(amb.map((o) => o.id));
        if (applied && applied.size) {
          this.queue.remove(amb.filter((o) => applied.has(o.id)).map((o) => o.id));
          send = ops.filter((o) => !applied.has(o.id));
          this._needRefresh = true;
        }
      }
      if (send.length) {
        const res = await this.store.applyBatch(send.map((o) => ({
          opId: o.id, kind: o.kind, itemId: o.itemId, name: o.name, delta: o.delta, field: o.field,
          value: o.value, group: o.group, sub: o.sub, count: o.count, ts: o.ts,
        })));
        this._applyResults(send, res.results);
      }
      this._persistCache();
      this._success();
      return true;
    } catch (err) {
      const live = ids.filter((id) => this.queue.has(id));
      if (err.ambiguous) this.queue.markAmbiguous(live); else this.queue.release(live);
      this._fail(err);
      return false;
    }
  }

  _applyResults(sent, results) {
    const byId = new Map((results || []).map((r) => [r.opId, r]));
    for (const op of sent) {
      const r = byId.get(op.id);
      const it = this.items.get(op.itemId);
      if (r && r.status === 'ok') {
        this.queue.remove([op.id]);
        if (it) {
          if (op.kind === 'delta') it.serverQty = r.newQty;
          else if (op.kind === 'set') it[op.field] = op.value;
          else if (op.kind === 'delete') this.items.delete(op.itemId);
        }
        if (op.kind === 'add') this._needRefresh = true;
      } else if (r && r.status === 'missing') {
        this.queue.toDead(op.id, 'item no longer exists on the server');
        this.dropped++;
        this._needRefresh = true;
      } else {
        this.queue.release([op.id]); // 'retry' or unknown: stays queued
      }
    }
  }

  async _refresh() {
    if (!this.store) { this._fail({ message: 'Not connected to a server', kind: 'config' }); return false; }
    this._set({ syncing: true });
    try {
      const list = await this.store.fetchItems();
      const next = new Map(list.map((i) => [i.id, {
        id: i.id, name: i.name, group: i.group || '', sub: i.sub || '', ordered: !!i.ordered, serverQty: i.qty, low: i.low ?? null,
      }]));
      // Keep items added on this PC that the server has not received yet.
      for (const op of this.queue.pending()) {
        if (op.kind === 'add' && !next.has(op.itemId)) {
          const old = this.items.get(op.itemId);
          next.set(op.itemId, old || { id: op.itemId, name: op.name, group: op.group || '', sub: op.sub || '', ordered: false, serverQty: 0 });
        }
      }
      this.items = next;
      this._needRefresh = false;
      this.lastPullAt = Date.now();
      this._persistCache();
      this._success();
      this.emit('items', list);
      return true;
    } catch (err) {
      this._fail(err);
      return false;
    }
  }

  // ---- status / cache --------------------------------------------------
  _set(patch) { Object.assign(this.status, patch); this.emit('change'); }
  _success() {
    this._failures = 0;
    this._set({ syncing: false, error: null, kind: null, lastSyncAt: this.now().toISOString(), everSynced: true });
  }
  _fail(err) {
    this._failures++;
    this._set({ syncing: false, error: err.message || String(err), kind: err.kind || 'network' });
  }

  _persistCache() {
    if (!this.cacheFile) return;
    try {
      writeJsonAtomic(this.cacheFile, {
        lastSyncAt: this.status.lastSyncAt,
        items: [...this.items.values()].map((i) => ({ id: i.id, name: i.name, group: i.group, sub: i.sub || '', ordered: i.ordered, qty: i.serverQty, low: i.low ?? null })),
      });
    } catch { /* cache is best-effort */ }
  }

  _loadCache() {
    if (!this.cacheFile) return;
    const d = readJson(this.cacheFile, null);
    if (!d || !Array.isArray(d.items)) return;
    for (const i of d.items) {
      this.items.set(i.id, { id: i.id, name: i.name, group: i.group || '', sub: i.sub || '', ordered: !!i.ordered, serverQty: Number(i.qty) || 0, low: i.low ?? null });
    }
    // re-add items that were added locally but never synced
    for (const op of this.queue.pending()) {
      if (op.kind === 'add' && !this.items.has(op.itemId)) {
        this.items.set(op.itemId, { id: op.itemId, name: op.name, group: op.group || '', sub: op.sub || '', ordered: false, serverQty: 0 });
      }
    }
    this.status.lastSyncAt = d.lastSyncAt || null;
  }
}

module.exports = { SyncEngine };
