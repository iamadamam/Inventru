'use strict';
// The server's own web pages in a real browser: the setup page's buttons and CSV import, and the TV dashboard
// updating live. Catches what plain HTTP tests can't (e.g. the browser's security policy blocking a button).
// Usage: npm run test:browser
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createServer } = require('../server/server');
const { launch, sleep } = require('./cdp');

const root = path.join(__dirname, '..');
const assets = (n) => { try { return fs.readFileSync(n === 'icons.js' ? path.join(root, 'src', 'renderer', 'icons.js') : path.join(root, 'server', 'web', n), 'utf8'); } catch { return null; } };

(async () => {
  const t0 = Date.now();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inventru-e2e-browser-'));
  const srv = createServer({ dataDir: path.join(tmp, 'server'), port: 0, host: '127.0.0.1', getAsset: assets });
  const port = await srv.listen();
  srv.cfg.name = 'IT Store Room';
  const op = (o) => ({ opId: `seed-${Math.random().toString(36).slice(2)}`, ts: new Date().toISOString(), ...o });
  srv.applyOps([
    op({ kind: 'add', itemId: 'mouse', name: 'Wireless mouse', group: 'Mice' }), op({ kind: 'delta', itemId: 'mouse', delta: 10 }),
    op({ kind: 'add', itemId: 'cam', name: 'Webcam', group: 'Audio & video' }),
    op({ kind: 'add', itemId: 'dock', name: 'USB-C dock', group: 'Docks', sub: 'New' }), op({ kind: 'delta', itemId: 'dock', delta: 2 }),
    op({ kind: 'set', itemId: 'dock', field: 'low', value: 3 }), op({ kind: 'set', itemId: 'dock', field: 'ordered', value: true }),
  ], 'seed');

  let failed = 0;
  const line = (ok, name, detail) => { if (!ok) failed++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `  -  ${detail}` : ''}`); };
  const env = { ...process.env, INVENTRU_URL: `http://localhost:${port}/setup` };
  delete env.ELECTRON_RUN_AS_NODE;
  const b = await launch(require(path.join(root, 'node_modules', 'electron')), [path.join(__dirname, 'browser-window.js'), `--user-data-dir=${path.join(tmp, 'browser')}`],
    { env, ready: 'document.readyState === "complete" && !!document.querySelector(".code")' });
  const problems = [];
  b.on((method, p) => {
    if (method === 'Log.entryAdded' && p.entry.level === 'error') problems.push(`${p.entry.source}: ${p.entry.text}`);
    if (method === 'Runtime.exceptionThrown') problems.push(`script error: ${p.exceptionDetails.text}`);
  });
  await b.call('Log.enable'); await b.call('Runtime.enable');
  const page = (js) => b.evaluate(js);
  const pageCode = () => page('document.querySelector(".code").textContent.replace(/\\s/g, "")');
  const flash = (re) => b.waitFor(`/${re}/.test((document.querySelector(".flash") || {}).textContent || "")`, 8000);
  try {
    // ---- setup page
    line((await pageCode()) === srv.setupInfo().pairing.code, 'setup page shows the open pairing code');
    line(await page('!document.getElementById("importRow").hidden && !document.getElementById("copyTv").hidden'), 'setup page script runs (import + copy buttons shown)');

    const before = srv.setupInfo().pairing.code;
    await page('document.querySelector("form[action=\'/setup/new-code\'] button").click()');
    line(await flash('New pairing code made'), '"New code" button works in the browser (not blocked by the page\'s security policy)');
    line(srv.setupInfo().pairing.code !== before && (await pageCode()) === srv.setupInfo().pairing.code, 'a new code is shown', `${before} -> ${srv.setupInfo().pairing.code}`);

    await page('var i = document.querySelector("form[action=\'/setup/name\'] input[name=name]"); i.value = "Store Room 2"; i.form.querySelector("button").click()');
    line((await flash('Name saved')) && srv.name === 'Store Room 2', 'rename with the Save button');

    await fetch(`http://127.0.0.1:${port}/api/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: srv.setupInfo().pairing.code, device: 'adam@STORE-PC' }) });
    await page('location.href = "/setup"');
    line(await b.waitFor('document.body.textContent.indexOf("adam@STORE-PC") >= 0', 8000), 'paired PC listed');
    await page('document.querySelector("form[action=\'/setup/remove\'] button").click()');
    line((await flash('PC removed')) && srv.cfg.devices.length === 0, 'remove a PC with its button');

    // CSV import through the page (file chooser filled in by the test)
    const csv = path.join(tmp, 'import.csv');
    fs.writeFileSync(csv, 'Item,Category,Quantity,Warn at\r\nHDMI cable,Cables,7,2\r\n');
    const input = await b.call('Runtime.evaluate', { expression: 'document.getElementById("importFile")' });
    const set = await b.call('DOM.setFileInputFiles', { objectId: input.result.result.objectId, files: [csv] });
    if (set.error) throw new Error(`choosing the file: ${set.error.message}`);
    line(await b.waitFor('/Imported: 1 added/.test(document.getElementById("importMsg").textContent)', 8000) && srv.state.rows.some((r) => r.name === 'HDMI cable' && r.qty === 7), 'CSV import from the setup page');

    // ---- TV dashboard
    await page('location.href = "/"');
    line(await b.waitFor('document.getElementById("title").textContent === "Store Room 2"', 8000), 'dashboard shows the server name');
    line(await b.waitFor('/Live/.test(document.querySelector("#status .txt").textContent)', 8000), 'dashboard is live');
    const kpi = await page('[].map.call(document.querySelectorAll("#kpis .kpi"), function (k) { return k.textContent; }).join(" | ")');
    line(/^4Items \| 19Units \| 1Low \| 1Out \| 1On order$/.test(kpi), 'totals: items, units, low, out, on order', kpi);
    line(await page('document.querySelectorAll("#attn .tile").length === 2'), 'needs attention lists the out-of-stock and low items');
    srv.applyOps([op({ kind: 'delta', itemId: 'cam', delta: 5 })], 'another PC');
    line(await b.waitFor('document.querySelectorAll("#attn .tile").length === 1 && /24Units/.test(document.getElementById("kpis").textContent)', 5000), 'a change appears on the TV by itself within seconds');
    await sleep(300);
    line(problems.length === 0, 'no errors in the browser (security policy, scripts, missing files)', problems.join(' / '));
  } catch (e) {
    line(false, 'browser test ran', e.message);
  } finally {
    await b.close();
    await srv.close();
  }
  console.log(`\n${failed ? `${failed} failed` : 'all passed'}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
