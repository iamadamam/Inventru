'use strict';

/** RFC 4180 CSV. Cells starting with = + - @ are prefixed with ' so Excel never runs them as formulas. */
function cell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows) {
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"' && cur === '') q = true; // a quote only opens a quoted field at its start (24" monitor stays literal)
    else if (c === ',' || c === ';' || c === '\t') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

/**
 * Turn CSV rows into items. Recognises headers in any order (Item/Name, Quantity/Qty, Ordered, Category/Group).
 * Without a recognisable header, columns are Item, Quantity, Ordered, Category.
 */
function rowsToItems(rows) {
  if (!rows.length) return [];
  const head = rows[0].map((x) => x.trim().toLowerCase());
  const find = (...names) => head.findIndex((x) => names.includes(x));
  let ix = {
    name: find('item', 'name', 'description'), qty: find('quantity', 'qty', 'stock', 'count'), ordered: find('ordered', 'on order'),
    cat: find('category', 'group', 'type'), sub: find('subcategory', 'sub-category', 'sub category', 'subgroup'),
    low: find('warn at', 'warn at ≤', 'low', 'low stock', 'reorder level', 'minimum', 'min'),
  };
  let body = rows.slice(1);
  if (ix.name < 0) { ix = { name: 0, qty: 1, ordered: 2, cat: 3, sub: 4 }; body = rows; }
  const yes = (v) => /^(true|yes|y|1|x|✓|✔)$/i.test(String(v || '').trim());
  return body.map((r) => ({
    name: String(r[ix.name] || '').replace(/^'/, '').trim(),
    qty: Math.max(0, Math.round(Number(String(r[ix.qty] ?? '').trim()) || 0)),
    ordered: ix.ordered >= 0 ? yes(r[ix.ordered]) : false,
    group: ix.cat >= 0 ? String(r[ix.cat] || '').trim() : '',
    sub: ix.sub >= 0 ? String(r[ix.sub] || '').trim() : '',
    // warn-at level only when the file has that column ('' = no warning)
    ...(ix.low >= 0 ? { low: /^\d+$/.test(String(r[ix.low] ?? '').trim()) ? Number(String(r[ix.low]).trim()) : null } : {}),
  })).filter((i) => i.name);
}

module.exports = { toCsv, parseCsv, rowsToItems };
