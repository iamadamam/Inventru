'use strict';
// End-to-end: "Just this PC" - a fresh app with no server, restarted, then moved to a server and back.
// Usage: npm run test:e2e-local            (the app from the source code)
//        node scripts/e2e-local.js <exe>   (a built app, e.g. dist\win-unpacked\Inventru.exe - used by test-release.js)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createServer } = require('../server/server');
const { launch } = require('./cdp');

const root = path.join(__dirname, '..');

async function runLocalE2E(exe) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inventru-e2e-local-'));
  const results = [];
  const line = (ok, name, detail) => results.push({ ok: !!ok, name, detail });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const start = (dir) => {
    const args = [`--user-data-dir=${dir}`];
    return launch(exe || require(path.join(root, 'node_modules', 'electron')), exe ? args : [root, ...args], { env, ready: 'document.readyState === "complete" && !!window.api' });
  };
  const run = async (dir, phase, fill = {}) => {
    let script = fs.readFileSync(path.join(root, 'test', 'e2e', 'local.e2e.js'), 'utf8').replace(/__PHASE__/g, phase);
    for (const [k, v] of Object.entries(fill)) script = script.replace(new RegExp(k, 'g'), v);
    const app = await start(dir);
    try { for (const r of await app.evaluate(script)) line(r.ok, r.name, r.detail); } catch (e) { line(false, `${phase}: app ran the walk-through`, e.message); }
    await app.close();
  };

  const appDir = path.join(tmp, 'app');
  const stock = path.join(appDir, 'stock');
  await run(appDir, 'first');
  const data = fs.existsSync(path.join(stock, 'data.json')) ? JSON.parse(fs.readFileSync(path.join(stock, 'data.json'), 'utf8')) : { rows: [] };
  const mouse = data.rows.find((r) => r.name === 'Wireless mouse') || {};
  line(mouse.qty === 2 && data.rows.length === 2, 'the list is saved in the app\'s folder (stock\\data.json)', JSON.stringify(data.rows.map((r) => `${r.name}=${r.qty}`)));
  const log = fs.existsSync(path.join(stock, 'log.csv')) ? fs.readFileSync(path.join(stock, 'log.csv'), 'utf8') : '';
  line(log.includes(`${os.userInfo().username}@${os.hostname()}`) && /Wireless mouse/.test(log), 'its change log (stock\\log.csv) records who');
  const cfg = JSON.parse(fs.readFileSync(path.join(appDir, 'config.json'), 'utf8'));
  line(cfg.mode === 'local' && !cfg.server.url && !cfg.server.tokenEnc, 'settings say "Just this PC", with no server');

  await run(appDir, 'again');

  // move to a server (empty: this PC's list is copied to it) and back again
  const srv = createServer({ dataDir: path.join(tmp, 'server'), port: 0, host: '127.0.0.1', getAsset: () => null });
  const port = await srv.listen();
  try {
    await run(appDir, 'to-server', { __ADDR__: `127.0.0.1:${port}`, __CODE__: srv.newPairingCode().code });
    const onServer = srv.state.rows.map((r) => `${r.name}=${r.qty}${r.ordered ? ' ordered' : ''}`).sort();
    line(onServer.join(', ') === 'Webcam=0 ordered, Wireless mouse=2', 'the server received this PC\'s list', onServer.join(', '));
    const back = JSON.parse(fs.readFileSync(path.join(appDir, 'config.json'), 'utf8'));
    line(back.mode === 'local' && !back.server.tokenEnc, 'back on just this PC, the pairing token is not kept');

    // a PC already using the server switches to just this PC: it keeps a copy of the server's list
    const op = (o) => ({ opId: `seed-${Math.random().toString(36).slice(2)}`, ts: new Date().toISOString(), ...o });
    srv.applyOps([op({ kind: 'add', itemId: 'hdmi', name: 'HDMI cable', group: 'Cables' }), op({ kind: 'delta', itemId: 'hdmi', delta: 5 })], 'seed');
    const second = path.join(tmp, 'app2');
    await run(second, 'from-server', { __ADDR__: `127.0.0.1:${port}`, __CODE__: srv.newPairingCode().code });
    const copy = JSON.parse(fs.readFileSync(path.join(second, 'stock', 'data.json'), 'utf8')).rows;
    line(copy.length === 3 && copy.find((r) => r.name === 'HDMI cable').qty === 5, 'its own copy is saved on that PC', copy.map((r) => `${r.name}=${r.qty}`).join(', '));
    line(srv.state.rows.length === 3, 'the server\'s list is not changed');
  } finally {
    await srv.close();
  }
  return results;
}

if (require.main === module) {
  const t0 = Date.now();
  runLocalE2E(process.argv[2]).then((results) => {
    let failed = 0;
    for (const r of results) { if (!r.ok) failed++; console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}${r.detail ? `  -  ${r.detail}` : ''}`); }
    console.log(`\n${failed ? `${failed} failed` : 'all passed'}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    process.exit(failed ? 1 : 0);
  }).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { runLocalE2E };
