'use strict';
// The Inventru server, pairing, the setup page's protections, and the app's client (ServerStore + SyncEngine) against a real server.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { createServer, cleanOp, VERSION, APP_ID } = require('../server/server');
const { ServerStore, serverOrigin } = require('../src/core/serverstore');
const { PersistentQueue } = require('../src/core/queue');
const { SyncEngine } = require('../src/core/sync');
const { tmpDir } = require('./helpers');

const asset = (n) => ({ 'index.html': '<!doctype html><title>dash</title>', 'setup.html': '<!doctype html><title>setup</title>{{CODE}} {{NEW_CODE_FORM}}', 'icons.js': '/*icons*/' }[n] ?? null);

async function start(t, dir = tmpDir(), port = 0, opts = {}) {
  const srv = createServer({ dataDir: dir, port, host: '127.0.0.1', getAsset: asset, ...opts });
  const p = await srv.listen();
  if (t) t.after(() => srv.close());
  return { srv, dir, base: `http://127.0.0.1:${p}`, port: p };
}
const post = (base, p, body, token, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify(body) });
const op = (o) => ({ opId: `op${Math.random().toString(36).slice(2)}`, ts: new Date().toISOString(), ...o });
async function pairPC(base, srv, name = 'adam@PC1') {
  const code = srv.newPairingCode().code;
  const r = await (await post(base, '/api/pair', { code, device: name })).json();
  return r.token;
}
/** The setup page's secret (from one of its forms). */
const pageToken = async (base) => /name="t" value="([^"]+)"/.exec(await (await fetch(`${base}/setup`)).text())[1];
const form = (base, action, fields) => fetch(base + action, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
/** A request with a chosen Host header (fetch() does not allow setting it). */
const rawGet = (port, p, host) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: p, headers: { Host: host } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
});

// ---------------------------------------------------------------- pairing
test('pairing: right code gives this PC its own token; the code works once', async (t) => {
  const { srv, base } = await start(t);
  const code = srv.newPairingCode().code;
  const r = await post(base, '/api/pair', { code: `${code.slice(0, 3)} ${code.slice(3)}`, device: 'adam@PC1' }); // spaces are fine
  assert.equal(r.status, 200);
  const { token, name } = await r.json();
  assert.ok(token.length >= 40); assert.equal(name, 'Inventru');
  assert.equal((await post(base, '/api/check', {}, token)).status, 200);
  assert.equal((await post(base, '/api/pair', { code, device: 'other' })).status, 403, 'one code, one PC');
  assert.equal(srv.cfg.devices.length, 1);
  assert.ok(!JSON.stringify(srv.cfg).includes(token), 'only a hash of the token is stored');
});

test('pairing: 5 wrong codes close pairing; a new code is needed', async (t) => {
  const { srv, base } = await start(t);
  const { code } = srv.newPairingCode();
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) assert.equal((await post(base, '/api/pair', { code: wrong })).status, 401);
  assert.equal((await post(base, '/api/pair', { code })).status, 403, 'even the right code is refused now');
});

test('pairing: not possible until someone opens the setup page', async (t) => {
  const { base } = await start(t);
  assert.equal((await post(base, '/api/pair', { code: '123456' })).status, 403);
});

test('pairing: the setup page\'s own refresh (?auto=1) never opens a new code - only opening the page does', async (t) => {
  const { srv, base } = await start(t);
  await fetch(`${base}/setup?auto=1`);
  assert.equal(srv.setupInfo().pairing, null, 'refresh: still closed');
  await fetch(`${base}/setup`);
  const first = srv.setupInfo().pairing.code;
  await post(base, '/api/pair', { code: first, device: 'pc1' }); // used up
  await fetch(`${base}/setup?auto=1`);
  assert.equal(srv.setupInfo().pairing, null, 'after a PC paired, the refresh does not offer another code');
});

test('changing stock needs a paired PC; reading is open', async (t) => {
  const { srv, base } = await start(t);
  assert.equal((await fetch(`${base}/api/items`)).status, 200);
  assert.equal((await post(base, '/api/batch', { ops: [] })).status, 401);
  assert.equal((await post(base, '/api/batch', { ops: [] }, 'not-a-token')).status, 401);
  const token = await pairPC(base, srv);
  assert.equal((await post(base, '/api/batch', { ops: [] }, token)).status, 200);
});

test('removing a PC on the setup page cuts it off', async (t) => {
  const { srv, base } = await start(t);
  const token = await pairPC(base, srv);
  const r = await form(base, '/setup/remove', { t: await pageToken(base), id: srv.cfg.devices[0].id });
  assert.equal(r.status, 303);
  assert.equal((await post(base, '/api/check', {}, token)).status, 401);
});

// ---------------------------------------------------------------- setup page protections
test('setup page: only on the server itself, only as localhost (not via another name pointing at it)', async (t) => {
  const { srv, base, port } = await start(t);
  assert.equal((await fetch(`${base}/setup`)).status, 200, '127.0.0.1 is fine');
  assert.equal(await rawGet(port, '/setup', `localhost:${port}`), 200, 'localhost is fine');
  assert.equal(await rawGet(port, '/setup', `[::1]:${port}`), 200);
  assert.equal(await rawGet(port, '/setup', `evil.example:${port}`), 403, 'a web page that points its own name at 127.0.0.1 is refused');
  assert.equal(await rawGet(port, '/api/setup/info', 'evil.example'), 403, 'so it cannot read the pairing code');
  // a request from another machine is refused (simulated by asking the handler directly)
  const fakeReq = Object.assign(require('stream').Readable.from([]), { url: '/api/setup/info', method: 'GET', headers: { host: 'localhost' }, socket: { remoteAddress: '10.0.0.9' } });
  let status;
  const fakeRes = { writeHead: (s) => { status = s; }, end: () => {} };
  srv.server.emit('request', fakeReq, fakeRes);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(status, 403);
});

test('setup page: changes need the page\'s secret token', async (t) => {
  const { srv, base } = await start(t);
  const csv = 'Item,Category,Quantity\r\nMouse,Mice,4\r\n';
  const imp = (h) => fetch(`${base}/api/setup/import`, { method: 'POST', headers: { 'Content-Type': 'text/csv', ...h }, body: csv });
  assert.equal((await imp({})).status, 403, 'no token');
  assert.equal((await imp({ 'X-Setup': '1' })).status, 403, 'a guessed header is not enough');
  assert.equal((await form(base, '/setup/name', { t: 'wrong', name: 'X' })).status, 403);
  const tok = await pageToken(base);
  assert.equal((await form(base, '/setup/name', { t: tok, name: 'IT Store Room' })).status, 303);
  const r = await (await imp({ 'X-Setup': tok })).json();
  assert.deepEqual([r.added, r.updated], [1, 0]);
  assert.equal(srv.name, 'IT Store Room');
});

test('setup page: its buttons (forms) are allowed by its security policy; the dashboard allows no forms', async (t) => {
  const { base } = await start(t);
  const setupCsp = (await fetch(`${base}/setup`)).headers.get('content-security-policy');
  assert.match(setupCsp, /form-action 'self'/);
  assert.match(setupCsp, /default-src 'none'/);
  assert.match((await fetch(`${base}/`)).headers.get('content-security-policy'), /form-action 'none'/);
});

test('setup page: shows warnings (e.g. a Public network) escaped', async (t) => {
  const { base } = await start(t, tmpDir(), 0, { warnings: () => ['Network <b>Public</b>'], getAsset: (n) => (n === 'setup.html' ? '<main>{{WARN}}</main>' : null) });
  const html = await (await fetch(`${base}/setup`)).text();
  assert.equal(html, '<main><p class="warn">Network &lt;b&gt;Public&lt;/b&gt;</p></main>');
});

test('setup: rename the list and import a CSV with categories and warn levels', async (t) => {
  const { srv, base } = await start(t);
  const tok = await pageToken(base);
  await form(base, '/setup/name', { t: tok, name: 'IT Store Room' });
  const csv = 'Item,Category,Subcategory,Quantity,Ordered,Warn at\r\nMouse,Mice,,4,No,2\r\n24" monitor,Monitors,New,3,Yes,\r\n';
  const r = await (await fetch(`${base}/api/setup/import`, { method: 'POST', headers: { 'X-Setup': tok, 'Content-Type': 'text/csv' }, body: csv })).json();
  assert.deepEqual([r.added, r.updated], [2, 0]);
  const d = await (await fetch(`${base}/api/items`)).json();
  assert.equal(d.name, 'IT Store Room');
  assert.deepEqual(d.items.map((i) => [i.name, i.qty, i.ordered, i.low]), [['Mouse', 4, false, 2], ['24" monitor', 3, true, null]]);
  assert.equal(srv.state.rows.length, 2);
});

// ---------------------------------------------------------------- stock changes
test('add, change, order, warn level, delete - all as changes; never below 0', async (t) => {
  const { srv, base } = await start(t);
  const token = await pairPC(base, srv);
  const r = await (await post(base, '/api/batch', { ops: [
    op({ kind: 'add', itemId: 'm1', name: 'Wireless mouse', group: 'Mice' }), op({ kind: 'delta', itemId: 'm1', delta: 5 }),
    op({ kind: 'set', itemId: 'm1', field: 'ordered', value: true }), op({ kind: 'set', itemId: 'm1', field: 'low', value: 3 }),
    op({ kind: 'add', itemId: 'k1', name: 'Keyboard' }),
  ] }, token)).json();
  assert.ok(r.results.every((x) => x.status === 'ok'));
  await post(base, '/api/batch', { ops: [op({ kind: 'delete', itemId: 'k1' }), op({ kind: 'delta', itemId: 'm1', delta: -9 })] }, token);
  const items = (await (await fetch(`${base}/api/items`)).json()).items;
  assert.deepEqual(items, [{ id: 'm1', name: 'Wireless mouse', qty: 0, ordered: true, group: 'Mice', sub: '', low: 3 }]);
});

test('a change sent twice (lost response) is applied once', async (t) => {
  const { srv, base } = await start(t);
  const token = await pairPC(base, srv);
  await post(base, '/api/batch', { ops: [op({ kind: 'add', itemId: 'a', name: 'A' })] }, token);
  const d = op({ kind: 'delta', itemId: 'a', delta: 4 });
  await post(base, '/api/batch', { ops: [d] }, token);
  assert.equal((await (await post(base, '/api/batch', { ops: [d] }, token)).json()).results[0].duplicate, true);
  assert.equal((await (await fetch(`${base}/api/items`)).json()).items[0].qty, 4);
});

test('a change the server could not save is not reported as done - the PC sends it again and it counts once', async (t) => {
  const { srv, base, dir } = await start(t);
  const token = await pairPC(base, srv);
  await post(base, '/api/batch', { ops: [op({ kind: 'add', itemId: 'a', name: 'A' })] }, token);
  const blocker = path.join(dir, 'data.json.tmp');
  fs.mkdirSync(blocker); // the next save fails
  const d = op({ kind: 'delta', itemId: 'a', delta: 3 });
  const r = await post(base, '/api/batch', { ops: [d] }, token);
  assert.equal(r.status, 503);
  assert.equal(srv.state.rows[0].qty, 0, 'not applied');
  assert.deepEqual((await (await post(base, '/api/applied', { opIds: [d.opId] }, token)).json()).applied, [], 'and the server says so');
  fs.rmdirSync(blocker);
  const again = await (await post(base, '/api/batch', { ops: [d] }, token)).json();
  assert.equal(again.results[0].duplicate, undefined, 'applied now');
  assert.equal(srv.state.rows[0].qty, 3);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8')).rows[0].qty, 3, 'and saved');
});

test('malformed changes are refused', () => {
  assert.equal(cleanOp({ opId: 'x', itemId: 'a', kind: 'delta', delta: 1.5 }), null);
  assert.equal(cleanOp({ opId: 'x', itemId: 'a', kind: 'set', field: '__proto__', value: 1 }), null);
  assert.equal(cleanOp({ opId: 'x', itemId: '../etc', kind: 'delete' }), null);
  assert.equal(cleanOp({ opId: 'x', itemId: 'a', kind: 'set', field: 'name', value: '  ' }), null);
  assert.equal(cleanOp({ opId: 'x', itemId: 'a', kind: 'add', name: 'x'.repeat(500) }).name.length, 80);
});

test('dashboard: served at / with a strict CSP; live events on every change; CSV download', async (t) => {
  const { srv, base } = await start(t);
  const r = await fetch(`${base}/`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
  const ctrl = new AbortController();
  const ev = await fetch(`${base}/api/events`, { signal: ctrl.signal });
  const reader = ev.body.getReader(); const dec = new TextDecoder(); let buf = '';
  const until = async (re) => { while (!re.test(buf)) { const { value } = await reader.read(); buf += dec.decode(value); } };
  await until(/"rev":0/);
  const token = await pairPC(base, srv);
  await post(base, '/api/batch', { ops: [op({ kind: 'add', itemId: 'a', name: '24" monitor', group: 'Monitors' })] }, token);
  await until(/"rev":1/);
  ctrl.abort();
  assert.match(await (await fetch(`${base}/api/export.csv`)).text(), /"24"" monitor",Monitors/);
});

test('live updates are limited, so a misbehaving device cannot tie the server up', async (t) => {
  const { base } = await start(t, tmpDir(), 0, { maxLive: 2 });
  const ctrls = [new AbortController(), new AbortController()];
  const open = await Promise.all(ctrls.map((c) => fetch(`${base}/api/events`, { signal: c.signal })));
  assert.deepEqual(open.map((r) => r.status), [200, 200]);
  assert.equal((await fetch(`${base}/api/events`)).status, 503);
  for (const c of ctrls) c.abort();
});

test('the app sees a new server name even when it has the same length (cache tag)', async (t) => {
  const { srv, base } = await start(t);
  const e1 = (await fetch(`${base}/api/items`)).headers.get('etag');
  const tok = await pageToken(base);
  await form(base, '/setup/name', { t: tok, name: srv.name.split('').reverse().join('') }); // same length, different name
  const e2 = (await fetch(`${base}/api/items`)).headers.get('etag');
  assert.notEqual(e1, e2);
});

test('data, paired PCs and the change log survive a restart; daily backup written', async () => {
  const dir = tmpDir();
  let s = await start(null, dir);
  const token = await pairPC(s.base, s.srv);
  await post(s.base, '/api/batch', { ops: [op({ kind: 'add', itemId: 'a', name: 'A' }), op({ kind: 'delta', itemId: 'a', delta: 2 })] }, token, { 'X-Inventru-User': 'adam@PC1' });
  await s.srv.close();
  s = await start(null, dir);
  try {
    assert.equal((await post(s.base, '/api/check', {}, token)).status, 200, 'still paired');
    assert.equal((await (await fetch(`${s.base}/api/items`)).json()).items[0].qty, 2);
    assert.match(fs.readFileSync(path.join(dir, 'log.csv'), 'utf8'), /adam@PC1/);
    // the day's backup is a copy of the data as it was before the day's next change
    await post(s.base, '/api/batch', { ops: [op({ kind: 'delta', itemId: 'a', delta: 1 })] }, token);
    assert.ok(fs.readdirSync(path.join(dir, 'backups')).length >= 1);
  } finally { await s.srv.close(); }
});

test('the change log is archived when it gets big, and a new one starts with headings', async (t) => {
  const { srv, base, dir } = await start(t, tmpDir(), 0, { logRotateBytes: 300 });
  const token = await pairPC(base, srv);
  await post(base, '/api/batch', { ops: [op({ kind: 'add', itemId: 'a', name: 'A' })] }, token);
  for (let i = 0; i < 6; i++) await post(base, '/api/batch', { ops: [op({ kind: 'delta', itemId: 'a', delta: 1 })] }, token);
  const archived = fs.readdirSync(dir).filter((f) => /^log-.+\.csv$/.test(f));
  assert.ok(archived.length >= 1, 'archive written');
  assert.match(fs.readFileSync(path.join(dir, 'log.csv'), 'utf8'), /^Time,Item,Change/);
});

test('damaged settings are ignored, not trusted', async (t) => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'server.json'), JSON.stringify({ name: 42, port: 'x', devices: [null, { id: 'a' }, { id: 'b', hash: 'h' }] }));
  const { srv } = await start(t, dir);
  assert.equal(srv.name, 'Inventru');
  assert.deepEqual(srv.cfg.devices.map((d) => d.id), ['b']);
});

// ---------------------------------------------------------------- the app's client
test('serverOrigin: a plain name gets http:// and port 8080', () => {
  assert.equal(serverOrigin('STOCK-VM'), 'http://stock-vm:8080');
  assert.equal(serverOrigin('10.0.0.5:8090'), 'http://10.0.0.5:8090');
  assert.equal(serverOrigin('http://stock-vm:8080/setup'), 'http://stock-vm:8080');
  assert.throws(() => serverOrigin(''));
  assert.throws(() => serverOrigin('ftp://x'));
});

test('app client: knows an Inventru server (and refuses something else)', async (t) => {
  const { base } = await start(t);
  const h = await new ServerStore({ url: base }).info();
  assert.equal(h.app, APP_ID);
  const other = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); });
  await new Promise((r) => other.listen(0, '127.0.0.1', r)); t.after(() => other.close());
  await assert.rejects(new ServerStore({ url: `127.0.0.1:${other.address().port}` }).info(), /not an Inventru server/);
});

test('app client: pair, sync both ways, survive a server restart', async () => {
  const dir = tmpDir();
  let s = await start(null, dir);
  const store = new ServerStore({ url: s.base, user: 'adam@PC1' });
  const code = s.srv.newPairingCode().code;
  const paired = await store.pair(code, 'adam@PC1');
  assert.ok(paired.token);
  const engine = new SyncEngine({ store, queue: new PersistentQueue(path.join(tmpDir(), 'q.json')), autoTimers: false });
  await engine.tick();
  const id = engine.addItem({ name: 'Dock', group: 'Docks', sub: 'USB-C' });
  engine.tap(id, 3); engine.setField(id, 'low', 2);
  await engine.tick();
  let items = (await (await fetch(`${s.base}/api/items`)).json()).items;
  assert.deepEqual(items.map((i) => [i.name, i.qty, i.group, i.sub, i.low]), [['Dock', 3, 'Docks', 'USB-C', 2]]);
  // the server restarts (VM reboot): taps wait on the PC
  await s.srv.close();
  engine.tap(id, 1); engine.tap(id, 1);
  assert.equal(await engine.flush(), false);
  assert.equal(engine.snapshot().status.state, 'offline');
  assert.equal(engine.getItem(id).qty, 5);
  s = await start(null, dir, s.port);
  try {
    await engine.tick();
    items = (await (await fetch(`${s.base}/api/items`)).json()).items;
    assert.equal(items[0].qty, 5);
    assert.equal(engine.snapshot().status.state, 'ok');
  } finally { await s.srv.close(); }
});

test('app client: a PC that was removed is told to pair again (not "offline")', async (t) => {
  const { base } = await start(t);
  const engine = new SyncEngine({ store: new ServerStore({ url: base, token: 'never-paired' }), queue: new PersistentQueue(path.join(tmpDir(), 'q.json')), autoTimers: false });
  await engine.refresh();
  engine.addItem({ name: 'X' });
  await engine.flush();
  assert.equal(engine.snapshot().status.state, 'error');
  assert.match(engine.snapshot().status.error, /pair/i);
});

test('app client: wrong pairing code gives a clear message', async (t) => {
  const { srv, base } = await start(t);
  srv.newPairingCode();
  const store = new ServerStore({ url: base });
  await assert.rejects(store.pair(srv.setupInfo().pairing.code === '000001' ? '000002' : '000001', 'x'), /Wrong pairing code/);
});

test('server version matches package.json (the .exe cannot read package.json)', () => {
  assert.equal(VERSION, require('../package.json').version);
});
