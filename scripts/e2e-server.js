'use strict';
// End-to-end: a fresh app <-> a real server <-> TV dashboard, on this PC.
// Usage: npm run test:e2e-server            (the app from the source code)
//        node scripts/e2e-server.js <exe>   (a built app, e.g. dist\win-unpacked\Inventru.exe - used by test-release.js)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createServer } = require('../server/server');
const { launch } = require('./cdp');

const root = path.join(__dirname, '..');
const assets = (n) => { try { return fs.readFileSync(n === 'icons.js' ? path.join(root, 'src', 'renderer', 'icons.js') : path.join(root, 'server', 'web', n), 'utf8'); } catch { return null; } };

async function runServerE2E(exe) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inventru-e2e-server-'));
  const srv = createServer({ dataDir: path.join(tmp, 'server'), port: 0, host: '127.0.0.1', getAsset: assets });
  const port = await srv.listen();
  const base = `http://127.0.0.1:${port}`;
  const results = [];
  const line = (ok, name, detail) => results.push({ ok: !!ok, name, detail });
  try {
    srv.cfg.name = 'IT Store Room';
    const op = (o) => ({ opId: `seed-${Math.random().toString(36).slice(2)}`, ts: new Date().toISOString(), ...o });
    srv.applyOps([
      op({ kind: 'add', itemId: 'mouse', name: 'Wireless mouse', group: 'Mice' }), op({ kind: 'delta', itemId: 'mouse', delta: 10 }),
      op({ kind: 'add', itemId: 'cam', name: 'Webcam', group: 'Audio & video' }), op({ kind: 'delta', itemId: 'cam', delta: 1 }),
      op({ kind: 'add', itemId: 'hdmi', name: 'HDMI cable', group: 'Cables' }), op({ kind: 'delta', itemId: 'hdmi', delta: 5 }),
    ], 'seed');
    // "another PC" pairs first, so it can change something while the app is running
    const otherCode = srv.newPairingCode().code;
    const other = await (await fetch(`${base}/api/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: otherCode, device: 'other@PC2' }) })).json();
    const code = srv.newPairingCode().code; // what the setup page would show

    const script = fs.readFileSync(path.join(root, 'test', 'e2e', 'server.e2e.js'), 'utf8').replace(/__ADDR__/g, `127.0.0.1:${port}`).replace(/__CODE__/g, code);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const args = [`--user-data-dir=${path.join(tmp, 'app')}`];
    const app = await launch(exe || require(path.join(root, 'node_modules', 'electron')), exe ? args : [root, ...args], { env, ready: 'document.readyState === "complete" && !!window.api' });
    const timer = setTimeout(() => {
      fetch(`${base}/api/batch`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${other.token}` }, body: JSON.stringify({ ops: [op({ kind: 'delta', itemId: 'hdmi', delta: 100 })] }) });
    }, 12000);
    try {
      for (const r of await app.evaluate(script)) line(r.ok, r.name, r.detail);
    } catch (e) { line(false, 'app ran the walk-through', e.message); }
    clearTimeout(timer);
    await app.close();

    // started again (e.g. the next morning): it reads its encrypted pairing token and reconnects by itself
    const again = await launch(exe || require(path.join(root, 'node_modules', 'electron')), exe ? args : [root, ...args], { env, ready: 'document.readyState === "complete" && !!window.api' });
    line(await again.waitFor('document.getElementById("connect").hidden && document.querySelectorAll(".row").length >= 4 && /Up to date/.test(document.querySelector("#sync .label").textContent)', 15000),
      'started again, it reconnects by itself (no pairing needed)');
    await again.close();

    const items = (await (await fetch(`${base}/api/items`)).json()).items;
    const get = (n) => items.find((i) => i.name === n) || {};
    line(get('Wireless mouse').qty === 12, 'server: mouse is 12');
    line(get('Webcam').qty === 0 && get('Webcam').ordered, 'server: webcam 0 and on order');
    const mon = get('27" monitor');
    line(mon.group === 'Monitors' && mon.sub === 'Used' && mon.low === 2 && mon.qty === 1, 'server: new item with category, subcategory, warn level', JSON.stringify(mon));
    line(srv.cfg.devices.map((d) => d.name).includes(`${os.userInfo().username}@${os.hostname()}`), 'server lists this PC as paired');
    const cfgFile = path.join(tmp, 'app', 'config.json');
    const cfg = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {};
    line(cfg.server && cfg.server.tokenEnc && !JSON.stringify(cfg).includes(code), 'app stores the pairing token encrypted');
    const log = fs.readFileSync(path.join(tmp, 'server', 'log.csv'), 'utf8');
    line(log.includes(`${os.userInfo().username}@${os.hostname()}`) && log.includes('other@PC2'), 'server change log records who');
    const dash = await fetch(`${base}/`);
    line(dash.status === 200 && /default-src 'none'/.test(dash.headers.get('content-security-policy')), 'TV dashboard at the server address');
  } finally {
    await srv.close();
  }
  return results;
}

if (require.main === module) {
  const t0 = Date.now();
  runServerE2E(process.argv[2]).then((results) => {
    let failed = 0;
    for (const r of results) { if (!r.ok) failed++; console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}${r.detail ? `  -  ${r.detail}` : ''}`); }
    console.log(`\n${failed ? `${failed} failed` : 'all passed'}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    process.exit(failed ? 1 : 0);
  }).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { runServerE2E };
