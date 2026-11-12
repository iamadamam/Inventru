'use strict';
/*
 * Inventru app (store-room PC). The stock list lives either on an Inventru server (shared with other PCs and the TV
 * dashboard) or, in "Just this PC" mode, in a folder on this PC. Either way every change goes through a durable queue
 * and is applied once; with a server, changes wait through network drops and are sent automatically.
 */
const { app, BrowserWindow, ipcMain, powerMonitor, powerSaveBlocker, safeStorage, shell, Menu, session, dialog } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Demo mode (built-in sample list, no server) only when running from the source code: npm run start:demo
const DEMO = !app.isPackaged && process.argv.includes('--demo');
// Settings, the offline queue and the cached list live in %APPDATA%\inventrustock-app.
// --user-data-dir=<folder> (the standard Chromium switch) uses another folder instead; the release tests use it.
const customDir = app.commandLine.getSwitchValue('user-data-dir');
app.setPath('userData', customDir ? path.resolve(customDir) : path.join(app.getPath('appData'), DEMO ? 'inventrustock-app-demo' : 'inventrustock-app'));
// Tests only (never in the installed app): read/write this file instead of showing the Open / Save dialogs.
const TEST_FILE = !app.isPackaged && process.env.INVENTRU_TEST_FILE;
app.enableSandbox();

const { PersistentQueue } = require('../core/queue');
const { SyncEngine } = require('../core/sync');
const { ServerStore, serverOrigin } = require('../core/serverstore');
const { MemoryStore } = require('../core/memorystore');
const { LocalStore } = require('../core/localstore');
const { toCsv, parseCsv, rowsToItems } = require('../core/csv');
const config = require('../core/config');

// ---------------------------------------------------------------- logging
const dataDir = app.getPath('userData');
const logFile = path.join(dataDir, 'app.log');
function log(...a) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 512 * 1024) fs.renameSync(logFile, `${logFile}.old`);
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${a.map((x) => (x && x.stack) || String(x)).join(' ')}\n`);
  } catch { /* logging must never throw */ }
}
let started = false; // until the window is open, an error means Inventru can't start: say so, don't linger unseen
process.on('uncaughtException', (e) => {
  log('uncaughtException', e);
  if (started) return;
  try { dialog.showErrorBox('Inventru could not start', `${(e && e.message) || e}\n\nIts files are in ${dataDir}. Restart the PC and try again, or ask IT.`); } catch { /* no UI */ }
  app.exit(1);
});
process.on('unhandledRejection', (e) => log('unhandledRejection', e));

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });

// ---------------------------------------------------------------- state
const configFile = path.join(dataDir, 'config.json');
let cfg = config.loadConfig(configFile);
const saveCfg = () => config.saveConfig(configFile, cfg);
const userTag = () => `${os.userInfo().username}@${os.hostname()}`;
let win = null;
let blockerId = null;
let pinFails = 0;
let pinLockedUntil = 0;

// The pairing token is encrypted with Windows DPAPI (only this Windows user on this PC can read it).
async function encrypt(plain) {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('Secure storage is not available on this PC.');
  return (await safeStorage.encryptStringAsync(plain)).toString('base64');
}
async function decrypt(enc) {
  if (!enc) return '';
  try {
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(Buffer.from(enc, 'base64'));
    if (shouldReEncrypt && result) { cfg.server.tokenEnc = await encrypt(result); saveCfg(); }
    return result;
  } catch { return ''; }
}

// ---------------------------------------------------------------- network: only the configured server, directly
let netSession = null;
function serverFetch(url, opts = {}, allowed) {
  let origin;
  try { origin = new URL(url).origin; } catch { return Promise.reject(new Error('bad address')); }
  const ok = allowed || (cfg.server.url ? (() => { try { return serverOrigin(cfg.server.url); } catch { return null; } })() : null);
  if (origin !== ok) return Promise.reject(new Error(`Blocked: ${origin} is not the configured server`));
  const { signal, ...rest } = opts;
  let timer;
  return Promise.race([
    netSession.fetch(url, { ...rest, cache: 'no-store' }),
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timed out')), 10000); }),
  ]).finally(() => clearTimeout(timer));
}
// The window may load only the app's own files (src\, inside app.asar when installed) - no web, no other local files.
const APP_FILES = path.join(__dirname, '..').toLowerCase() + path.sep;
function ownFile(u) {
  try {
    const p = decodeURIComponent(new URL(u).pathname).replace(/^\/([a-z]:)/i, '$1');
    return path.resolve(p).toLowerCase().startsWith(APP_FILES);
  } catch { return false; }
}
function lockDownRenderer() {
  const ses = session.defaultSession;
  ses.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !(/^(devtools|data|blob):/i.test(d.url) || (/^file:/i.test(d.url) && ownFile(d.url))) }));
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setSpellCheckerEnabled(false);
}

// ---------------------------------------------------------------- the stock list
function demoRows() {
  const rows = [];
  const add = (group, sub, name, qty) => rows.push({ id: `demo${rows.length}`, name, qty, group, sub, ordered: false, low: null });
  [['Mice', '', 'Wireless mouse', 14], ['Mice', '', 'Wired mouse', 9], ['Keyboards', '', 'Wired keyboard', 9], ['Keyboards', '', 'Wireless keyboard + mouse set', 6],
    ['Monitors', 'New', '24" monitor', 5], ['Monitors', 'Used', '27" monitor', 3], ['Laptops', 'New', 'Laptop 14"', 4], ['Laptops', 'Refurbished', 'Laptop 16"', 2],
    ['Docks & cables', 'Docks', 'USB-C dock', 7], ['Docks & cables', 'Cables', 'HDMI cable 2m', 25], ['Docks & cables', 'Power', 'Power adapter 65W', 10],
    ['Audio & video', '', 'USB headset', 11], ['Audio & video', '', 'Webcam 1080p', 0]].forEach(([g, s, n, q]) => add(g, s, n, q));
  rows[4].ordered = true; rows[12].ordered = true;
  return rows;
}

let demoStore = null;
// "Just this PC": the list, its change log and daily backups in %APPDATA%inventrustock-appstock
const localDir = path.join(dataDir, 'stock');
let localStore = null;
const getLocal = () => { localStore = localStore || new LocalStore({ dir: localDir, user: userTag(), log }); return localStore; };
async function makeStore() {
  if (DEMO) { demoStore = demoStore || new MemoryStore(demoRows()); return demoStore; }
  if (cfg.mode === 'local') return getLocal();
  if (cfg.mode !== 'server') return null;
  const token = await decrypt(cfg.server.tokenEnc);
  if (!cfg.server.url || !token) return null;
  try { return new ServerStore({ url: cfg.server.url, token, fetchFn: (u, o) => serverFetch(u, o), user: userTag() }); } catch { return null; }
}

const windowVisible = () => !!(win && !win.isDestroyed() && win.isVisible() && !win.isMinimized());
const engine = new SyncEngine({
  queue: new PersistentQueue(path.join(dataDir, 'queue.json')),
  cacheFile: path.join(dataDir, 'cache.json'),
  pollMs: 5000, autoFlushDelayMs: 250,
  shouldPoll: windowVisible, // read every 5 s while someone can see the window; changes are always sent
});
engine.on('change', pushState);
engine.on('items', (items) => {
  let changed = config.mergeServerItems(cfg, items);
  for (const it of items) { // warn-at levels live on the server
    const m = cfg.items.find((x) => x.id === it.id);
    if (m && it.low !== undefined && m.lowThreshold !== it.low) { m.lowThreshold = it.low; changed = true; }
  }
  if (engine.store && engine.store.name && engine.store.name !== cfg.server.name) { cfg.server.name = engine.store.name; changed = true; }
  if (changed) saveCfg();
  pushState();
});
async function connectEngine() { engine.setStore(await makeStore()); engine.start(); }

// ---------------------------------------------------------------- UI state
function buildState() {
  const snap = engine.snapshot();
  const byId = new Map(snap.items.map((i) => [i.id, i]));
  const items = [];
  for (const m of cfg.items) {
    const s = byId.get(m.id);
    if (!s) continue;
    items.push({ id: m.id, name: s.name, group: s.group, sub: s.sub, qty: s.qty, ordered: s.ordered, pending: s.pending, step: m.step, low: m.lowThreshold, hidden: m.hidden, icon: m.icon });
  }
  let serverHost = '';
  try { serverHost = cfg.server.url ? serverOrigin(cfg.server.url).replace(/^https?:\/\//, '') : ''; } catch { /* ignore */ }
  const mode = DEMO ? 'demo' : cfg.mode;
  return {
    items, status: snap.status, mode,
    ui: { theme: cfg.theme, accent: cfg.accent, density: cfg.density, fontScale: cfg.fontScale },
    server: { name: DEMO ? 'Demo' : mode === 'local' ? 'Inventru' : (cfg.server.name || serverHost), host: mode === 'server' ? serverHost : '' },
    categoryIcons: Object.fromEntries(Object.entries(cfg.categories || {}).map(([k, v]) => [k, v.icon])),
    customIcons: cfg.customIcons || [],
    pinSet: !!cfg.pin,
    connected: DEMO || mode === 'local' || !!(mode === 'server' && cfg.server.url && cfg.server.tokenEnc),
    demo: DEMO,
  };
}
let pushQueued = false;
function pushState() {
  if (pushQueued) return;
  pushQueued = true;
  setTimeout(() => { pushQueued = false; if (win && !win.isDestroyed()) win.webContents.send('state', buildState()); }, 16);
}

// ---------------------------------------------------------------- window + system
function applySystemSettings() {
  if (cfg.keepAwake && blockerId === null) blockerId = powerSaveBlocker.start('prevent-display-sleep');
  if (!cfg.keepAwake && blockerId !== null) { powerSaveBlocker.stop(blockerId); blockerId = null; }
  // "Start when I sign in": one value named Inventru under HKCU\Software\Microsoft\Windows\CurrentVersion\Run
  // (removed again by the uninstaller). Not for test copies started with --user-data-dir.
  if (app.isPackaged && !customDir) app.setLoginItemSettings({ openAtLogin: !!cfg.autostart, path: process.execPath, args: ['--autostart'], name: 'Inventru' });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 800, minWidth: 560, minHeight: 420,
    backgroundColor: '#0b0d12', title: 'Inventru', icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false, devTools: !app.isPackaged },
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setVisualZoomLevelLimits(1, 1);
  win.webContents.on('render-process-gone', (_e, d) => { log('render-process-gone', JSON.stringify(d)); setTimeout(() => win && !win.isDestroyed() && win.reload(), 1000); });
  win.on('unresponsive', () => { log('window unresponsive'); setTimeout(() => win && !win.isDestroyed() && win.reload(), 5000); });
  win.webContents.on('did-finish-load', pushState);
  const back = () => { if (Date.now() - engine.lastPullAt > 3000) engine.tick(true).catch(() => {}); };
  win.on('focus', back); win.on('restore', back);
  win.on('closed', () => { win = null; });
}

// Every window or frame: no navigating away, no pop-ups, no embedded pages.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (e) => e.preventDefault());
  contents.on('will-attach-webview', (e) => e.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

app.whenReady().then(() => {
  app.setAppUserModelId('com.inventru.app');
  Menu.setApplicationMenu(null);
  netSession = session.fromPartition('server');
  netSession.setProxy({ mode: 'direct' }); // the server is on the local network: never via an internet proxy
  lockDownRenderer();
  applySystemSettings();
  createWindow();
  started = true;
  connectEngine().catch((e) => log('connect', e));
  powerMonitor.on('resume', () => setTimeout(() => engine.tick(true).catch(() => {}), 4000));
  powerMonitor.on('unlock-screen', () => engine.tick(true).catch(() => {}));
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => engine.stop());

// ---------------------------------------------------------------- IPC: everyday use (open to everyone)
ipcMain.handle('state:get', () => buildState());
ipcMain.handle('tap', (_e, id, delta) => engine.tap(String(id), Number(delta)));
ipcMain.handle('setExact', (_e, id, qty) => engine.setExact(String(id), Number(qty)));
ipcMain.handle('syncNow', () => { engine.tick(true).catch(() => {}); });
ipcMain.handle('item:ordered', (_e, id, value) => engine.setField(String(id), 'ordered', !!value));
ipcMain.handle('server:openDashboard', () => {
  if (cfg.mode !== 'server' || !cfg.server.url) return { ok: false };
  shell.openExternal(serverOrigin(cfg.server.url)); return { ok: true };
});
ipcMain.handle('list:export', async () => {
  const r = TEST_FILE ? { filePath: `${TEST_FILE}.export.csv` } : await dialog.showSaveDialog(win, {
    title: 'Export stock list', defaultPath: path.join(app.getPath('documents'), `Inventru stock ${new Date().toISOString().slice(0, 10)}.csv`),
    filters: [{ name: 'CSV (opens in Excel)', extensions: ['csv'] }],
  });
  if (r.canceled || !r.filePath) return { ok: false };
  const byId = new Map(engine.snapshot().items.map((i) => [i.id, i]));
  const rows = [['Item', 'Category', 'Subcategory', 'Quantity', 'Ordered', 'Warn at']];
  for (const m of cfg.items) { const s = byId.get(m.id); if (s) rows.push([s.name, s.group, s.sub, s.qty, s.ordered ? 'Yes' : 'No', m.lowThreshold ?? '']); }
  fs.writeFileSync(r.filePath, `﻿${toCsv(rows)}`);
  return { ok: true, count: rows.length - 1 };
});

// ---------------------------------------------------------------- PIN: two separate locks (Edit mode, Settings)
const UNLOCK_MS = 10 * 60 * 1000;
const unlocked = { edit: 0, settings: 0 };
const isUnlocked = (scope) => !cfg.pin || Date.now() < unlocked[scope] || (scope === 'edit' && Date.now() < unlocked.settings);
function requireScope(scope) {
  if (!isUnlocked(scope)) throw new Error(scope === 'settings' ? 'Settings are locked: enter the PIN.' : 'Editing is locked: enter the PIN.');
  if (Date.now() < unlocked[scope]) unlocked[scope] = Date.now() + UNLOCK_MS;
}
const requireEdit = () => requireScope('edit');
const requireSettings = () => requireScope('settings');
ipcMain.handle('pin:required', (_e, scope = 'edit') => !!cfg.pin && (scope === 'settings' ? true : !isUnlocked('edit')));
ipcMain.handle('settings:unlock', (_e, pin, scope = 'edit') => {
  const s = scope === 'settings' ? 'settings' : 'edit';
  if (!cfg.pin) return { ok: true };
  if (Date.now() < pinLockedUntil) return { ok: false, error: `Too many attempts. Try again in ${Math.ceil((pinLockedUntil - Date.now()) / 1000)}s.` };
  if (config.verifyPin(pin, cfg.pin)) { pinFails = 0; unlocked[s] = Date.now() + UNLOCK_MS; return { ok: true }; }
  if (++pinFails >= 5) { pinFails = 0; pinLockedUntil = Date.now() + 30000; }
  return { ok: false, error: 'Wrong PIN' };
});
ipcMain.handle('settings:lock', (_e, scope) => { if (scope === 'edit' || scope === 'settings') unlocked[scope] = 0; else { unlocked.edit = 0; unlocked.settings = 0; } });

// ---------------------------------------------------------------- IPC: Edit mode
ipcMain.handle('item:setField', (_e, id, field, value) => { if (field !== 'ordered') requireEdit(); return engine.setField(String(id), field, value); });
ipcMain.handle('item:setMeta', (_e, id, meta) => {
  requireEdit();
  const m = cfg.items.find((i) => i.id === id);
  if (!m) return { ok: false };
  Object.assign(m, config.sanitizeItem({ ...m, ...meta, id }));
  if ('lowThreshold' in meta) engine.setField(String(id), 'low', m.lowThreshold); // shared via the server
  saveCfg(); pushState();
  return { ok: true };
});
ipcMain.handle('item:add', (_e, { name, group, sub }) => {
  requireEdit();
  const id = engine.addItem({ name, group, sub });
  cfg.items.push(config.sanitizeItem({ id }));
  saveCfg(); pushState();
  return { ok: true, id };
});
ipcMain.handle('item:delete', (_e, id) => {
  requireEdit();
  engine.deleteItem(String(id));
  cfg.items = cfg.items.filter((i) => i.id !== id);
  saveCfg(); pushState();
  return { ok: true };
});
ipcMain.handle('item:reorder', (_e, ids) => { requireEdit(); config.reorderItems(cfg, (ids || []).map(String)); saveCfg(); pushState(); });
ipcMain.handle('subcategory:rename', (_e, cat, from, to) => {
  requireEdit(); let n = 0;
  for (const v of engine.snapshot().items) if ((v.group || '') === cat && (v.sub || '') === from) { engine.setField(v.id, 'sub', to); n++; }
  return { ok: true, count: n };
});
ipcMain.handle('category:rename', (_e, from, to) => {
  requireEdit();
  if (cfg.categories[from] && to) { cfg.categories[String(to).trim()] = cfg.categories[from]; delete cfg.categories[from]; saveCfg(); }
  let n = 0;
  for (const v of engine.snapshot().items) if ((v.group || '') === from) { engine.setField(v.id, 'group', to); n++; }
  return { ok: true, count: n };
});
ipcMain.handle('category:setIcon', (_e, cat, icon) => {
  requireEdit();
  const name = String(cat || '').trim(); if (!name) return { ok: false };
  if (icon && config.ICON_KEY.test(icon)) cfg.categories[name] = { icon }; else delete cfg.categories[name];
  saveCfg(); pushState(); return { ok: true };
});
ipcMain.handle('icons:add', (_e, { name, data }) => {
  requireEdit();
  if ((cfg.customIcons || []).length >= config.MAX_CUSTOM_ICONS) return { ok: false, error: `You can add up to ${config.MAX_CUSTOM_ICONS} icons.` };
  const clean = config.sanitizeCustomIcons([{ id: `c_${require('crypto').randomBytes(4).toString('hex')}`, name: String(name || 'Icon').slice(0, 40), data: String(data || '') }]);
  if (!clean.length) return { ok: false, error: 'That image could not be used. Use a PNG, JPG, GIF, WebP or SVG under 90 KB.' };
  cfg.customIcons = [...(cfg.customIcons || []), clean[0]];
  saveCfg(); pushState(); return { ok: true, id: clean[0].id };
});
ipcMain.handle('icons:delete', (_e, id) => {
  requireEdit();
  cfg.customIcons = (cfg.customIcons || []).filter((c) => c.id !== id);
  for (const it of cfg.items) if (it.icon === id) it.icon = '';
  for (const [k, v] of Object.entries(cfg.categories)) if (v.icon === id) delete cfg.categories[k];
  saveCfg(); pushState(); return { ok: true };
});
ipcMain.handle('list:import', async () => {
  requireEdit();
  const r = TEST_FILE ? { filePaths: [TEST_FILE] } : await dialog.showOpenDialog(win, { title: 'Import items from CSV', properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }] });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  const text = fs.readFileSync(r.filePaths[0], 'utf8');
  if (!DEMO && engine.store && engine.store.importCsv) { // the server imports it in one go
    const res = await engine.store.importCsv(text);
    await engine.refresh();
    return { ok: true, ...res };
  }
  let added = 0, updated = 0; // demo mode: through the queue
  const key = (n, g) => `${n.trim().toLowerCase()}|${(g || '').trim().toLowerCase()}`;
  const existing = new Map(engine.snapshot().items.map((v) => [key(v.name, v.group), v.id]));
  for (const it of rowsToItems(parseCsv(text))) {
    let id = existing.get(key(it.name, it.group));
    if (id) updated++; else { id = engine.addItem({ name: it.name, group: it.group, sub: it.sub }); cfg.items.push(config.sanitizeItem({ id })); existing.set(key(it.name, it.group), id); added++; }
    engine.setExact(id, it.qty); engine.setField(id, 'ordered', it.ordered);
  }
  saveCfg(); pushState();
  return { ok: true, added, updated };
});
ipcMain.handle('reset:quantities', () => {
  requireEdit(); const before = {};
  for (const v of engine.snapshot().items) if (v.qty !== 0) { before[v.id] = v.qty; engine.setExact(v.id, 0); }
  return { qty: before, ordered: [] };
});
ipcMain.handle('reset:ordered', () => {
  requireEdit(); const ids = [];
  for (const v of engine.snapshot().items) if (v.ordered) { ids.push(v.id); engine.setField(v.id, 'ordered', false); }
  return { qty: {}, ordered: ids };
});
ipcMain.handle('reset:restore', (_e, snap) => {
  for (const [id, q] of Object.entries((snap && snap.qty) || {})) engine.setExact(id, Number(q));
  for (const id of (snap && snap.ordered) || []) engine.setField(id, 'ordered', true);
});

// ---------------------------------------------------------------- IPC: where the list is kept (server / this PC)
/** The changes that recreate `items` (same item IDs, so this PC's icons and order still match) in another store. */
function copyOps(items) {
  const ops = []; const t = Date.now().toString(36); const ts = new Date().toISOString();
  for (const it of items) {
    const op = (o) => ops.push({ opId: `copy-${t}-${ops.length}`, ts, itemId: it.id, ...o });
    op({ kind: 'add', name: it.name, group: it.group || '', sub: it.sub || '' });
    if (it.qty > 0) op({ kind: 'delta', delta: it.qty });
    if (it.ordered) op({ kind: 'set', field: 'ordered', value: true });
    if (it.low != null) op({ kind: 'set', field: 'low', value: it.low });
  }
  return ops;
}
async function copyItems(items, store) {
  for (let i = 0; i < items.length; i += 400) { // at most 1,600 changes per request
    const res = await store.applyBatch(copyOps(items.slice(i, i + 400)));
    if (res.results.some((r) => r.status !== 'ok')) throw new Error('The list could not be copied completely.');
  }
}
const unsent = () => (engine.queue.length ? `${engine.queue.pendingTaps} change(s) haven't been saved yet. Wait a moment (or press Sync), then try again.` : null);

/** First run and Settings: pair this PC with the server using the code shown on the server's setup page. */
ipcMain.handle('server:connect', async (_e, address, code) => {
  if (DEMO) return { ok: false, error: 'Not available in demo mode.' };
  if (cfg.mode) requireSettings(); // changing an existing setup needs the PIN (if set)
  let origin;
  try { origin = serverOrigin(address); } catch (e) { return { ok: false, error: e.message }; }
  const fromLocal = cfg.mode === 'local';
  if (fromLocal && unsent()) return { ok: false, error: unsent() };
  try {
    const s = new ServerStore({ url: origin, fetchFn: (u, o) => serverFetch(u, o, origin), user: userTag() });
    const { token, name } = await s.pair(code, userTag());
    // Coming from "Just this PC": copy this PC's list to the server - only if the server's list is still empty, so
    // nothing on the server is ever overwritten. This PC's own list stays in its folder either way.
    let copied = null;
    if (fromLocal) {
      const mine = await getLocal().fetchItems();
      copied = mine.length && !(await s.fetchItems()).length ? (await copyItems(mine, s), mine.length) : 0;
    }
    const otherServer = !fromLocal && cfg.server.url && serverOrigin(cfg.server.url) !== origin;
    cfg.server = { url: origin.replace(/^http:\/\//, ''), tokenEnc: await encrypt(token), name: name || '' };
    if (otherServer) cfg.items = []; // a different server: start clean
    cfg.mode = 'server';
    saveCfg();
    if (otherServer || fromLocal) await engine.reset();
    await connectEngine();
    await engine.refresh();
    pushState();
    return { ok: true, name, copied };
  } catch (e) { return { ok: false, error: e.message }; }
});

/** First run and Settings: keep the list on this PC only (no server, no TV dashboard). */
ipcMain.handle('mode:local', async () => {
  if (DEMO) return { ok: false, error: 'Not available in demo mode.' };
  if (cfg.mode) requireSettings();
  if (cfg.mode === 'local') return { ok: true, copied: 0 };
  if (unsent()) return { ok: false, error: unsent() };
  try {
    const local = getLocal();
    // Coming from a server: start with a copy of the list shown now - unless this PC already has its own list.
    let copied = 0;
    if (cfg.mode === 'server' && local.count() === 0) {
      const items = engine.snapshot().items;
      await copyItems(items, local);
      copied = items.length;
    }
    await local.fetchItems(); // the folder can be opened and read
    cfg.mode = 'local';
    cfg.server = { url: '', tokenEnc: '', name: '' }; // the pairing token isn't kept: connecting again needs a new code
    saveCfg();
    await engine.reset();
    await connectEngine();
    await engine.refresh();
    pushState();
    return { ok: true, copied };
  } catch (e) { log('mode:local', e); return { ok: false, error: e.message }; }
});
ipcMain.handle('local:openFolder', async () => {
  requireSettings();
  if (cfg.mode !== 'local') return { ok: false };
  const err = await shell.openPath(localDir);
  return err ? { ok: false, error: err } : { ok: true };
});
ipcMain.handle('server:test', async () => {
  if (cfg.mode !== 'server') return { ok: false, error: 'Not connected to a server.' };
  try {
    const s = await makeStore(); if (!s) return { ok: false, error: 'Not connected yet.' };
    const h = await s.info(); await s.check();
    return { ok: true, message: `Connected to "${h.name}" - ${h.items} items, server version ${h.version}.` };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ---------------------------------------------------------------- IPC: Settings
ipcMain.handle('settings:get', () => {
  requireSettings();
  const { pin, server, items, categories, customIcons, ...settings } = cfg;
  let host = ''; try { host = server.url ? serverOrigin(server.url).replace(/^https?:\/\//, '') : ''; } catch { /* ignore */ }
  return {
    settings, server: { host, name: server.name, connected: !!server.tokenEnc }, pinSet: !!pin, version: app.getVersion(), user: userTag(), demo: DEMO,
    mode: DEMO ? 'demo' : cfg.mode, local: { folder: localDir, items: cfg.mode === 'local' ? engine.snapshot().items.length : getLocal().count() },
  };
});
ipcMain.handle('settings:save', (_e, payload) => {
  requireSettings();
  cfg = { ...cfg, ...config.sanitizeSettings((payload && payload.settings) || {}, cfg) };
  saveCfg(); applySystemSettings(); pushState();
  return { ok: true };
});
ipcMain.handle('settings:setPin', (_e, pin) => {
  requireSettings();
  if (pin === null || pin === '') { cfg.pin = null; saveCfg(); pushState(); return { ok: true }; }
  if (!config.validPin(pin)) return { ok: false, error: 'PIN must be 4 to 8 digits.' };
  cfg.pin = config.hashPin(pin); unlocked.settings = Date.now() + UNLOCK_MS; saveCfg(); pushState();
  return { ok: true };
});
