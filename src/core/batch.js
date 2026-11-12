'use strict';

/**
 * Pure planner: given the current stock rows and a list of queued changes (ops), work out what to write.
 * Used by stockbook.js (the server, and the app's "Just this PC" mode) and by the in-memory demo store, so the rules are
 * written - and tested - once.
 *
 * rows: [{ id, row, name, qty, ordered, group, sub, low }]      row = the item's position in the list
 * ops:  [{ opId, kind, itemId, delta, field, value, name, group, sub, count, ts }]
 *
 * Returns
 *   results     [{ opId, status: 'ok' | 'missing' | 'retry', newQty? }]
 *   cellWrites  [{ row, field: 'qty' | 'name' | 'ordered' | 'group' | 'sub' | 'low', value }]   (existing items)
 *   appends     [{ id, name, group, sub }]                                                  (new items, qty 0)
 *   deletes     [row]
 *   log         [{ opId, ts, name, delta?, newQty?, desc }]
 *
 * Rules: quantity = max(0, current + delta). Changes to an item added in this same batch are answered 'retry'
 * and go in the next pass, after the item exists.
 */
function planBatch(rows, ops) {
  const model = new Map(rows.map((r) => [r.id, { ...r, dirty: new Set(), isNew: false, deleted: false }]));
  const out = { results: [], cellWrites: [], appends: [], deletes: [], log: [] };

  for (const op of ops) {
    const kind = op.kind || 'delta';
    const res = (status, extra) => out.results.push({ opId: op.opId, status, ...extra });
    const r = model.get(op.itemId);

    if (kind === 'add') {
      if (r) { res('ok'); continue; } // already there (e.g. sent twice)
      const row = { id: op.itemId, name: op.name, group: op.group || '', sub: op.sub || '', qty: 0, ordered: false, isNew: true, dirty: new Set(), deleted: false };
      model.set(op.itemId, row);
      out.appends.push(row);
      out.log.push({ opId: op.opId, ts: op.ts, name: op.name, desc: 'Item added' });
      res('ok');
      continue;
    }
    if (!r) { res(kind === 'delete' ? 'ok' : 'missing'); continue; }
    if (r.deleted) { res('ok'); continue; }
    if (r.isNew) { res('retry'); continue; }

    if (kind === 'delete') {
      r.deleted = true;
      out.deletes.push(r.row);
      out.log.push({ opId: op.opId, ts: op.ts, name: r.name, desc: 'Item deleted' });
      res('ok');
    } else if (kind === 'set') {
      const before = r[op.field];
      r[op.field] = op.value;
      if (before !== op.value) r.dirty.add(op.field);
      const desc = op.field === 'ordered' ? `Ordered: ${op.value ? 'Yes' : 'No'}`
        : op.field === 'name' ? `Renamed from "${before}"`
          : op.field === 'sub' ? `Subcategory: ${op.value || '(none)'}`
            : op.field === 'low' ? `Warn at: ${op.value == null ? 'off' : op.value}` : `Category: ${op.value || '(none)'}`;
      out.log.push({ opId: op.opId, ts: op.ts, name: r.name, desc });
      res('ok');
    } else { // delta
      const before = r.qty;
      r.qty = Math.max(0, r.qty + op.delta);
      if (r.qty !== before) r.dirty.add('qty');
      const taps = op.count > 1 ? ` (${op.count} taps)` : '';
      out.log.push({ opId: op.opId, ts: op.ts, name: `${r.name}${taps}`, delta: r.qty - before, newQty: r.qty, desc: 'app' });
      res('ok', { newQty: r.qty });
    }
  }

  // Report the item's final quantity for every delta op (a running value would mislead when ops are merged).
  for (const res of out.results) {
    if (res.status === 'ok' && res.newQty !== undefined) {
      const op = ops.find((o) => o.opId === res.opId);
      res.newQty = model.get(op.itemId).qty;
    }
  }
  for (const r of model.values()) {
    if (r.isNew || r.deleted) continue;
    for (const f of r.dirty) out.cellWrites.push({ row: r.row, field: f, value: r[f] });
  }
  return out;
}

module.exports = { planBatch };
