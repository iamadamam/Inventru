'use strict';
/*
 * The stock list on disk - used by the Inventru server, and by the app itself in "Just this PC" mode, so the rules for
 * saving, backups and the change log are written (and tested) once.
 *
 *   <dir>\data.json        the list, and the IDs of changes already applied (a change sent twice counts once)
 *   <dir>\log.csv          every change: time, item, change, new quantity, who (archived as log-<time>.csv at 10 MB)
 *   <dir>\backups\         one copy of data.json per day, 30 kept
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { planBatch } = require('./batch');
const { readJson, writeJsonAtomic } = require('./jsonfile');
const { toCsv, parseCsv, rowsToItems } = require('./csv');

const APPLIED_KEEP = 20000;
const LOG_ROTATE_BYTES = 10 * 1024 * 1024;
const BACKUPS_KEPT = 30;
const FIELDS = ['name', 'group', 'sub', 'ordered', 'low'];
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Validate one incoming change. Returns a clean copy, or null if it isn't a valid change. */
function cleanOp(o) {
  if (!o || typeof o !== 'object') return null;
  const kind = o.kind || 'delta';
  if (!['delta', 'set', 'add', 'delete'].includes(kind)) return null;
  if (!ID_RE.test(String(o.opId || '')) || !ID_RE.test(String(o.itemId || ''))) return null;
  const str = (v) => String(v == null ? '' : v).trim().slice(0, 80);
  const op = { opId: String(o.opId), kind, itemId: String(o.itemId), count: Math.max(1, Math.min(1e6, Number(o.count) || 1)) };
  const ts = Date.parse(o.ts);
  op.ts = Number.isFinite(ts) ? new Date(ts).toISOString() : new Date().toISOString();
  if (kind === 'delta') {
    const d = Number(o.delta);
    if (!Number.isInteger(d) || d === 0 || Math.abs(d) > 1e7) return null;
    op.delta = d;
  } else if (kind === 'set') {
    if (!FIELDS.includes(o.field)) return null;
    op.field = o.field;
    if (o.field === 'ordered') op.value = !!o.value;
    else if (o.field === 'low') { const n = o.value == null || o.value === '' ? null : Math.round(Number(o.value)); op.value = Number.isFinite(n) && n >= 0 && n <= 1e7 ? n : null; }
    else { op.value = str(o.value); if (o.field === 'name' && !op.value) return null; }
  } else if (kind === 'add') {
    op.name = str(o.name) || 'New item'; op.group = str(o.group); op.sub = str(o.sub);
  }
  return op;
}

/** Local time as "2026-11-10 14:05:09" (what Excel shows). */
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * openStockBook({ dir, log, logRotateBytes, saveError, onChange })
 *   -> { state, items(), applyOps(ops, by), wasApplied(ids), importCsv(text, by), exportCsv(), files }
 * A file that can't be read (locked, no permission) throws here: it is never treated as an empty list.
 */
function openStockBook({ dir, log = () => {}, logRotateBytes = LOG_ROTATE_BYTES, saveError = 'The change could not be saved - it will be tried again.', onChange = () => {} }) {
  fs.mkdirSync(dir, { recursive: true });
  const dataFile = path.join(dir, 'data.json');
  const logFile = path.join(dir, 'log.csv');
  const backupDir = path.join(dir, 'backups');

  const d = readJson(dataFile, {}) || {};
  const state = {
    rev: Number(d.rev) || 0,
    rows: Array.isArray(d.rows) ? d.rows.filter((r) => r && ID_RE.test(String(r.id))) : [],
    applied: Array.isArray(d.applied) ? d.applied : [],
    updatedAt: d.updatedAt || null,
  };
  let appliedMap = new Map(state.applied.map((a) => [a[0], a]));

  function save() {
    if (state.applied.length > APPLIED_KEEP) { state.applied = state.applied.slice(-APPLIED_KEEP); appliedMap = new Map(state.applied.map((a) => [a[0], a])); }
    dailyBackup();
    writeJsonAtomic(dataFile, { rev: state.rev, updatedAt: state.updatedAt, rows: state.rows, applied: state.applied });
  }
  function dailyBackup() {
    try {
      if (!fs.existsSync(dataFile)) return;
      fs.mkdirSync(backupDir, { recursive: true });
      const f = path.join(backupDir, `data-${new Date().toISOString().slice(0, 10)}.json`);
      if (!fs.existsSync(f)) fs.copyFileSync(dataFile, f);
      const all = fs.readdirSync(backupDir).filter((x) => /^data-\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort();
      for (const old of all.slice(0, Math.max(0, all.length - BACKUPS_KEPT))) fs.unlinkSync(path.join(backupDir, old));
    } catch (e) { log('backup failed', e.message); }
  }
  function appendLog(lines) {
    if (!lines.length) return;
    try {
      try {
        if (fs.statSync(logFile).size > logRotateBytes) {
          const when = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
          let archive = path.join(dir, `log-${when}.csv`);
          for (let i = 2; fs.existsSync(archive); i++) archive = path.join(dir, `log-${when}-${i}.csv`);
          fs.renameSync(logFile, archive);
        }
      } catch { /* no log yet */ }
      const fresh = !fs.existsSync(logFile);
      fs.appendFileSync(logFile, toCsv(fresh ? [['Time', 'Item', 'Change', 'New quantity', 'What', 'Op ID', 'By'], ...lines] : lines));
    } catch (e) { log('log write failed', e.message); }
  }
  const items = () => state.rows.map((r) => ({ id: r.id, name: r.name, qty: r.qty, ordered: !!r.ordered, group: r.group || '', sub: r.sub || '', low: r.low ?? null }));

  /** The one write path. Applies valid changes once each, saves, logs. Throws (status 503) if it can't save. */
  function applyOps(rawOps, by) {
    const results = [];
    const fresh = [];
    for (const raw of rawOps) {
      const op = cleanOp(raw);
      if (!op) { results.push({ opId: raw && raw.opId, status: 'invalid' }); continue; }
      const seen = appliedMap.get(op.opId);
      if (seen) { results.push({ opId: op.opId, status: seen[1], newQty: seen[2], duplicate: true }); continue; }
      fresh.push(op);
    }
    if (!fresh.length) return { results };
    const undo = { rows: state.rows.map((r) => ({ ...r })), applied: state.applied.slice(), rev: state.rev, updatedAt: state.updatedAt };
    const okIds = new Set();
    const logLines = [];
    // all in memory, saved once: changes to an item added in the same batch just run in another pass
    let pending = fresh;
    for (let pass = 0; pass < 4 && pending.length; pass++) {
      const plan = planBatch(state.rows.map((r, i) => ({ ...r, row: i })), pending);
      for (const w of plan.cellWrites) state.rows[w.row][w.field] = w.value;
      for (const a of plan.appends) state.rows.push({ id: a.id, name: a.name, group: a.group || '', sub: a.sub || '', qty: 0, ordered: false, low: null });
      const dead = new Set(plan.deletes);
      if (dead.size) state.rows = state.rows.filter((_, i) => !dead.has(i));
      const retry = new Set();
      for (const r of plan.results) {
        if (r.status === 'retry') { retry.add(r.opId); continue; }
        const rec = [r.opId, r.status, r.newQty];
        state.applied.push(rec); appliedMap.set(r.opId, rec);
        results.push(r);
        if (r.status === 'ok') okIds.add(r.opId);
      }
      logLines.push(...plan.log.filter((l) => okIds.has(l.opId)));
      pending = pending.filter((o) => retry.has(o.opId));
    }
    for (const o of pending) results.push({ opId: o.opId, status: 'retry' });
    if (okIds.size) { state.rev++; state.updatedAt = new Date().toISOString(); }
    try { save(); } catch (e) {
      // Not saved (disk full, file held by another program...): undo, so nothing is reported as done that isn't on
      // disk. The change stays queued and is tried again.
      Object.assign(state, undo);
      appliedMap = new Map(state.applied.map((a) => [a[0], a]));
      log('could not save the stock list', e.message);
      throw Object.assign(new Error(saveError), { status: 503 });
    }
    appendLog(logLines.map((l) => [stamp(new Date(l.ts)), l.name, l.delta ?? '', l.newQty ?? '', l.desc, l.opId, by]));
    if (okIds.size) onChange();
    return { results };
  }

  const wasApplied = (ids) => ids.filter((id) => appliedMap.has(id));

  /** Import a CSV: new items are added, items with the same name + category + subcategory are updated. */
  function importCsv(text, by = 'import') {
    const list = rowsToItems(parseCsv(text));
    const key = (n, g, s) => `${n.toLowerCase()}|${(g || '').toLowerCase()}|${(s || '').toLowerCase()}`;
    const existing = new Map(state.rows.map((r) => [key(r.name, r.group, r.sub), r]));
    const ops = []; let added = 0, updated = 0, n = 0;
    const opId = () => `import-${Date.now().toString(36)}-${n++}`;
    for (const it of list) {
      let r = existing.get(key(it.name, it.group, it.sub));
      if (!r) {
        const id = `itm_${crypto.randomBytes(3).toString('hex')}`;
        ops.push({ opId: opId(), kind: 'add', itemId: id, name: it.name, group: it.group, sub: it.sub });
        r = { id, qty: 0, ordered: false, low: null }; existing.set(key(it.name, it.group, it.sub), r); added++;
      } else updated++;
      if (it.qty !== r.qty) ops.push({ opId: opId(), kind: 'delta', itemId: r.id, delta: it.qty - (r.qty || 0) });
      if (it.ordered !== !!r.ordered) ops.push({ opId: opId(), kind: 'set', itemId: r.id, field: 'ordered', value: it.ordered });
      if (it.low !== undefined && it.low !== (r.low ?? null)) ops.push({ opId: opId(), kind: 'set', itemId: r.id, field: 'low', value: it.low });
    }
    applyOps(ops, by);
    return { added, updated };
  }

  const exportCsv = () => `﻿${toCsv([['Item', 'Category', 'Subcategory', 'Quantity', 'Ordered', 'Warn at'],
    ...state.rows.map((r) => [r.name, r.group, r.sub, r.qty, r.ordered ? 'Yes' : 'No', r.low ?? ''])])}`;

  return { state, items, applyOps, wasApplied, importCsv, exportCsv, files: { dataFile, logFile, backupDir } };
}

module.exports = { openStockBook, cleanOp, stamp, ID_RE };
