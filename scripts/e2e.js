'use strict';
// The app walk-through: runs test/e2e/ui.e2e.js inside the real app window (demo list, throw-away settings folder).
// Usage: npm run test:e2e
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, sleep } = require('./cdp');

const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inventru-e2e-'));
const csv = path.join(tmp, 'import.csv');
fs.writeFileSync(csv, 'Item,Category,Quantity,Ordered\r\nLaptop bag 15",Bags,6,Yes\r\nWireless mouse,Mice,30,No\r\n');

(async () => {
  const t0 = Date.now();
  const env = { ...process.env, INVENTRU_TEST_FILE: csv };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await launch(require(path.join(root, 'node_modules', 'electron')), [root, '--demo', `--user-data-dir=${path.join(tmp, 'data')}`],
    { env, ready: 'document.readyState === "complete" && !!window.api && document.querySelectorAll(".row").length > 0' });
  await sleep(500);
  let results;
  try { results = await app.evaluate(fs.readFileSync(path.join(root, 'test', 'e2e', 'ui.e2e.js'), 'utf8')); } catch (e) { results = [{ name: 'harness', ok: false, detail: e.message }]; }
  await app.close();

  let failed = 0;
  const line = (ok, name, detail) => { if (!ok) failed++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `  -  ${detail}` : ''}`); };
  for (const r of results) line(r.ok, r.name, r.detail);
  const exported = `${csv}.export.csv`;
  const lines = fs.existsSync(exported) ? fs.readFileSync(exported, 'utf8').trim().split(/\r?\n/) : [];
  line(lines[0] && lines[0].replace(/^﻿/, '') === 'Item,Category,Subcategory,Quantity,Ordered,Warn at', `exported CSV has header + ${Math.max(0, lines.length - 1)} rows`);
  console.log(`\n${results.length + 1 - failed} passed, ${failed} failed  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
