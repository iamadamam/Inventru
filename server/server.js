'use strict';
/*
 * Inventru server - the one place the stock list lives (e.g. a Hyper-V VM on your network).
 *
 *   http://<server>:8080/          live dashboard for the TV (any browser, read-only)
 *   http://localhost:8080/setup    setup page - only opens on the server itself
 *   /api/...                       used by the Inventru app on the store-room PC
 *
 * Store-room PCs pair once with a 6-digit code shown on the setup page and get their own device token.
 * Changes are deltas, never overwrites, and every change is applied at most once.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { readJson, writeJsonAtomic } = require('../src/core/jsonfile');
const { openStockBook, cleanOp } = require('../src/core/stockbook');

const VERSION = '1.0.0'; // keep in step with package.json (checked by test/server.test.js)
const APP_ID = 'inventru-server';
const MAX_BODY = 2 * 1024 * 1024;
const MAX_OPS = 2000;
const PAIR_MINUTES = 30;
const PAIR_MAX_TRIES = 5;
const MAX_LIVE = 100;                // browsers following live updates at the same time
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
// The setup page also checks the address the browser asked for, so a web page can't reach it by pointing
// its own domain name at 127.0.0.1 ("DNS rebinding").
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;
const sameSecret = (a, b) => { const x = Buffer.from(String(a || '')); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

function addresses(port) {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${port}`);
  }
  return out;
}

/**
 * createServer({ dataDir, port, host, getAsset, log, warnings, maxLive, logRotateBytes }) -> { listen(), close(), state, name, port, applyOps, ... }
 * getAsset(name) returns a web file (string) or null. warnings() returns problems to show on the setup page.
 */
function createServer({ dataDir, port, host = '0.0.0.0', getAsset, log = () => {}, warnings = () => [], maxLive = MAX_LIVE, logRotateBytes }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const cfgFile = path.join(dataDir, 'server.json');

  // ---- settings: name, port, paired PCs (only a hash of each PC's token is kept) ------------------
  const cfg = readJson(cfgFile, {}) || {};
  cfg.name = typeof cfg.name === 'string' && cfg.name.trim() ? cfg.name.trim().slice(0, 60) : 'Inventru';
  cfg.port = Number(cfg.port) || 8080;
  cfg.devices = Array.isArray(cfg.devices) ? cfg.devices.filter((x) => x && typeof x.hash === 'string' && typeof x.id === 'string') : [];
  const saveCfg = () => writeJsonAtomic(cfgFile, cfg);
  saveCfg();
  let listenPort = port ?? cfg.port;
  let pairing = null; // { code, until, tries } - only after someone opens the setup page or asks for a new code

  // ---- the stock list (src/core/stockbook.js: the same code the app uses in "Just this PC" mode) ------------
  const book = openStockBook({ dir: dataDir, log, logRotateBytes, saveError: 'The server could not save the change - it will be sent again.', onChange: () => broadcast() });
  const { state, applyOps, importCsv, exportCsv } = book;
  const publicItems = book.items;

  // ---- pairing a store-room PC ---------------------------------------------------------------
  function newPairingCode() {
    pairing = { code: String(crypto.randomInt(0, 1000000)).padStart(6, '0'), until: Date.now() + PAIR_MINUTES * 60000, tries: 0 };
    return pairing;
  }
  const pairingOpen = () => pairing && pairing.until > Date.now() && pairing.tries < PAIR_MAX_TRIES;

  function pair(code, deviceName) {
    if (!pairingOpen()) return { status: 403, body: { error: 'Pairing is not open. On the server, open the setup page (double-click InventruServer) to get a pairing code.' } };
    const given = String(code || '').replace(/\D/g, '');
    if (!sameSecret(given, pairing.code)) {
      pairing.tries++;
      const left = PAIR_MAX_TRIES - pairing.tries;
      log(`wrong pairing code (${left} tries left)`);
      if (left <= 0) pairing = null;
      return { status: 401, body: { error: left > 0 ? `Wrong pairing code (${left} more tries).` : 'Wrong pairing code too often. Make a new code on the server.' } };
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const device = { id: crypto.randomBytes(6).toString('hex'), name: String(deviceName || 'PC').replace(/[^\w.@\\ -]/g, '').slice(0, 80) || 'PC', hash: sha(token), created: new Date().toISOString(), lastSeen: null };
    cfg.devices.push(device);
    try { saveCfg(); } catch (e) { cfg.devices.pop(); throw e; } // not saved: not paired (the code stays open)
    pairing = null; // one code, one PC
    log(`paired ${device.name}`);
    return { status: 200, body: { token, name: cfg.name, version: VERSION } };
  }

  let seenDirty = false;
  function deviceFor(req) {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    if (!m) return null;
    const h = sha(m[1].trim());
    const dev = cfg.devices.find((x) => sameSecret(x.hash, h));
    if (dev) { dev.lastSeen = new Date().toISOString(); seenDirty = true; }
    return dev || null;
  }
  const seenTimer = setInterval(() => { if (seenDirty) { seenDirty = false; saveCfg(); } }, 60000);
  seenTimer.unref();

  // ---- live updates (Server-Sent Events) ---------------------------------------------------------
  const clients = new Set();
  function broadcast() {
    const msg = `event: change\ndata: ${JSON.stringify({ rev: state.rev })}\n\n`;
    for (const res of clients) { try { res.write(msg); } catch { clients.delete(res); } }
  }
  const heartbeat = setInterval(() => { for (const res of clients) { try { res.write(': ping\n\n'); } catch { clients.delete(res); } } }, 25000);
  heartbeat.unref();

  // ---- HTTP ------------------------------------------------------------------------------
  const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' };
  const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
  const SETUP_CSP = CSP.replace("form-action 'none'", "form-action 'self'"); // the setup page's buttons are forms
  const TEXT = { 'Content-Type': 'text/plain; charset=utf-8' };
  function send(res, status, body, headers = {}) {
    const isObj = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
    res.writeHead(status, { ...SEC, 'Cache-Control': 'no-store', ...(isObj ? { 'Content-Type': 'application/json; charset=utf-8' } : {}), ...headers });
    res.end(isObj ? JSON.stringify(body) : body);
  }
  function readBody(req, { json = true } = {}) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (!json) return resolve(text);
        try { resolve(text ? JSON.parse(text) : {}); } catch { reject(Object.assign(new Error('bad JSON'), { status: 400 })); }
      });
      req.on('error', reject);
    });
  }
  const PAGES = {
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/dashboard': ['index.html', 'text/html; charset=utf-8'],
    '/dashboard.js': ['dashboard.js', 'text/javascript; charset=utf-8'],
    '/dashboard.css': ['dashboard.css', 'text/css; charset=utf-8'],
    '/icons.js': ['icons.js', 'text/javascript; charset=utf-8'],
    '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
  };
  const SETUP_PAGES = {
    '/setup.js': ['setup.js', 'text/javascript; charset=utf-8'],
    '/setup.css': ['setup.css', 'text/css; charset=utf-8'],
  };
  const asset = (res, [file, type], csp = CSP) => {
    const body = getAsset(file);
    if (body == null) return send(res, 404, { error: 'not found' });
    return send(res, 200, body, { 'Content-Type': type, 'Content-Security-Policy': csp, 'Cache-Control': 'no-cache' });
  };

  // ---- setup page (built here, complete, so it works in any browser - even without JavaScript) ----------
  const setupToken = crypto.randomBytes(24).toString('base64url'); // proves a request came from our own setup page
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const ago = (iso) => {
    if (!iso) return 'not connected yet';
    const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
    return s < 120 ? 'online now' : s < 3600 ? `last seen ${Math.round(s / 60)} min ago` : `last seen ${new Date(iso).toLocaleString('en-GB')}`;
  };
  function renderSetup(msg) {
    const i = setupInfo();
    const form = (action, fields, label, cls = 'btn') => `<form method="post" action="${action}" class="inline"><input type="hidden" name="t" value="${esc(setupToken)}">${fields}<button class="${cls}">${esc(label)}</button></form>`;
    const code = i.pairing ? `${i.pairing.code.slice(0, 3)} ${i.pairing.code.slice(3)}` : '- - -';
    const minutes = i.pairing ? Math.max(0, Math.round((Date.parse(i.pairing.until) - Date.now()) / 60000)) : 0;
    const devices = i.devices.length
      ? i.devices.map((d) => `<li><span class="grow">${esc(d.name)}</span><span class="muted small">${esc(ago(d.lastSeen))}</span>${form('/setup/remove', `<input type="hidden" name="id" value="${esc(d.id)}">`, 'Remove', 'rm')}</li>`).join('')
      : '<li class="muted">None yet.</li>';
    let warn = [];
    try { warn = warnings() || []; } catch { warn = []; }
    const vals = {
      MSG: msg ? `<p class="flash">${esc(msg)}</p>` : '',
      WARN: warn.map((w) => `<p class="warn">${esc(w)}</p>`).join(''),
      TV_URL: esc(i.tvUrl),
      ALT_URLS: i.addresses.length ? `If the TV can't find that name, use: ${i.addresses.map(esc).join(' &nbsp;or&nbsp; ')}` : '',
      APP_ADDRESS: esc(i.appAddress),
      CODE: esc(code),
      CODE_INFO: i.pairing ? `Valid for ${minutes} more minute${minutes === 1 ? '' : 's'}, for one PC.` : 'No code open right now.',
      NEW_CODE_FORM: form('/setup/new-code', '', 'New code'),
      DEVICES: devices,
      ITEMS: `${i.items} item${i.items === 1 ? '' : 's'}`,
      NAME_FORM: form('/setup/name', `<input name="name" maxlength="60" value="${esc(i.name)}"> `, 'Save'),
      FOOTER: esc(`Inventru server ${i.version} · data in ${i.dataDir} (backed up daily, 30 days kept)`),
    };
    const tpl = getAsset('setup.html') || '<!doctype html><title>Inventru server</title>{{TV_URL}} {{APP_ADDRESS}} {{CODE}}';
    return tpl.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in vals ? vals[k] : m));
  }

  const setupInfo = () => ({
    name: cfg.name, version: VERSION, port: listenPort, host: os.hostname(), addresses: addresses(listenPort),
    tvUrl: `http://${os.hostname()}:${listenPort}`, appAddress: listenPort === 8080 ? os.hostname() : `${os.hostname()}:${listenPort}`,
    pairing: pairingOpen() ? { code: pairing.code, until: new Date(pairing.until).toISOString() } : null,
    devices: cfg.devices.map(({ id, name, created, lastSeen }) => ({ id, name, created, lastSeen })),
    items: state.rows.length, updatedAt: state.updatedAt, dataDir,
  });

  async function setupRoute(req, res, p, url) {
    if (!isLocal(req) || !LOCAL_HOST.test(String(req.headers.host || ''))) {
      return send(res, 403, `The setup page only opens on the server itself: http://localhost:${listenPort}/setup`, TEXT);
    }
    if (req.method === 'GET' && p === '/setup') {
      // Opening the page offers a pairing code; its own 10-second refresh (?auto=1) never makes a new one.
      if (url.searchParams.get('auto') !== '1' && !pairingOpen()) newPairingCode();
      return send(res, 200, renderSetup(url.searchParams.get('msg')), { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': SETUP_CSP });
    }
    if (req.method === 'GET' && SETUP_PAGES[p]) return asset(res, SETUP_PAGES[p], SETUP_CSP);
    if (req.method === 'GET' && p === '/api/setup/info') { if (!pairingOpen()) newPairingCode(); return send(res, 200, setupInfo()); }
    // The page's buttons are plain HTML forms carrying the page's secret token, so other web pages can't use them.
    if (req.method === 'POST' && p.startsWith('/setup/')) {
      const form = new URLSearchParams(await readBody(req, { json: false }));
      if (!sameSecret(form.get('t'), setupToken)) return send(res, 403, 'This page is out of date - go back and reload it.', TEXT);
      let msg = '';
      if (p === '/setup/new-code') { newPairingCode(); msg = 'New pairing code made.'; }
      else if (p === '/setup/remove') {
        const before = cfg.devices.length;
        cfg.devices = cfg.devices.filter((x) => x.id !== form.get('id')); saveCfg();
        if (cfg.devices.length < before) { msg = 'PC removed. It needs a new pairing code to connect again.'; log(`removed a paired PC (${before - cfg.devices.length})`); }
      } else if (p === '/setup/name') { cfg.name = String(form.get('name') || '').trim().slice(0, 60) || cfg.name; saveCfg(); broadcast(); msg = 'Name saved.'; }
      else return send(res, 404, 'not found', TEXT);
      return send(res, 303, '', { Location: `/setup${msg ? `?msg=${encodeURIComponent(msg)}` : ''}` });
    }
    // CSV import from the setup page (setup.js sends the page's token in a header)
    if (req.method === 'POST' && p === '/api/setup/import') {
      if (!sameSecret(req.headers['x-setup'], setupToken)) return send(res, 403, { error: 'This page is out of date - reload it.' });
      const text = await readBody(req, { json: false });
      return send(res, 200, importCsv(text, 'import on server'));
    }
    return send(res, 404, { error: 'not found' });
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://server');
    const p = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (p === '/setup' || p.startsWith('/setup.') || p.startsWith('/setup/') || p.startsWith('/api/setup/')) return await setupRoute(req, res, p, url);

      if (req.method === 'GET' || req.method === 'HEAD') {
        if (PAGES[p]) return asset(res, PAGES[p]);
        if (p === '/favicon.ico') return send(res, 204, ''); // older browsers ask for this; the pages link favicon.svg
        if (p === '/api/health') return send(res, 200, { ok: true, app: APP_ID, version: VERSION, name: cfg.name, rev: state.rev, items: state.rows.length, updatedAt: state.updatedAt });
        if (p === '/api/items') {
          const etag = `"${state.rev}-${sha(cfg.name).slice(0, 8)}"`;
          if (req.headers['if-none-match'] === etag) return send(res, 304, '', { ETag: etag });
          return send(res, 200, { name: cfg.name, rev: state.rev, updatedAt: state.updatedAt, items: publicItems() }, { ETag: etag });
        }
        if (p === '/api/export.csv') {
          return send(res, 200, exportCsv(), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${cfg.name.replace(/[^\w -]/g, '') || 'Inventru'} ${new Date().toISOString().slice(0, 10)}.csv"` });
        }
        if (p === '/api/events' && req.method === 'GET') {
          if (clients.size >= maxLive) return send(res, 503, { error: 'Too many live connections.' }, { 'Retry-After': '60' });
          res.writeHead(200, { ...SEC, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
          res.write(`retry: 3000\nevent: change\ndata: ${JSON.stringify({ rev: state.rev })}\n\n`);
          clients.add(res);
          req.on('close', () => clients.delete(res));
          return undefined;
        }
        return send(res, 404, { error: 'not found' });
      }

      if (req.method === 'POST') {
        if (p === '/api/pair') {
          const body = await readBody(req);
          const r = pair(body.code, body.device);
          return send(res, r.status, r.body);
        }
        const dev = deviceFor(req);
        if (!dev) return send(res, 401, { error: 'This PC is not paired with the server (or was removed). Pair it again in Settings.' });
        const body = await readBody(req);
        const by = String(req.headers['x-inventru-user'] || dev.name).replace(/[^\w.@\\ -]/g, '').slice(0, 80);
        if (p === '/api/check') return send(res, 200, { ok: true, name: cfg.name });
        if (p === '/api/batch') {
          if (!Array.isArray(body.ops) || body.ops.length > MAX_OPS) return send(res, 400, { error: `ops must be an array of at most ${MAX_OPS}` });
          return send(res, 200, applyOps(body.ops, by));
        }
        if (p === '/api/applied') {
          const ids = Array.isArray(body.opIds) ? body.opIds.slice(0, MAX_OPS).map(String) : [];
          return send(res, 200, { applied: book.wasApplied(ids) });
        }
        if (p === '/api/import') return send(res, 200, importCsv(String(body.csv || ''), by));
        return send(res, 404, { error: 'not found' });
      }
      return send(res, 405, { error: 'method not allowed' }, { Allow: 'GET, HEAD, POST' });
    } catch (e) {
      log('request failed', e.stack || e.message);
      if (res.headersSent) { try { res.end(); } catch { /* ignore */ } return undefined; }
      return send(res, e.status || 500, { error: e.status ? e.message : 'internal error' });
    }
  }

  const server = http.createServer((req, res) => { handle(req, res); });
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 70000;
  server.requestTimeout = 30000;

  return {
    server, state, cfg, applyOps, importCsv, exportCsv, newPairingCode, setupInfo,
    get name() { return cfg.name; },
    get port() { return listenPort; },
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(listenPort, host, () => { listenPort = server.address().port; resolve(listenPort); });
    }),
    close: () => new Promise((resolve) => {
      clearInterval(heartbeat); clearInterval(seenTimer);
      if (seenDirty) saveCfg();
      for (const res of clients) { try { res.end(); } catch { /* ignore */ } }
      clients.clear();
      server.close(() => resolve());
      server.closeAllConnections?.();
    }),
  };
}

module.exports = { createServer, cleanOp, VERSION, APP_ID };
