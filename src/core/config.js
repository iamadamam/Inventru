'use strict';
const crypto = require('crypto');
const { readJson, writeJsonAtomic } = require('./jsonfile');

/**
 * App settings (this PC only).
 *   mode        where the stock list is kept: 'server' (an Inventru server), 'local' ("Just this PC"), '' (not chosen yet)
 *   server      where the server is and this PC's (encrypted) pairing token
 *   items       per-item display options on this PC: icon, step, hidden, order (warn-at comes from the server)
 *   categories  category icons
 */
const DEFAULTS = {
  version: 1,
  mode: '',
  server: { url: '', tokenEnc: '', name: '' },
  theme: 'dark',            // dark | light | auto
  accent: '#4f8cff',
  density: 'comfortable',   // compact | comfortable | touch
  fontScale: 1,             // 0.85 .. 1.6
  keepAwake: true,
  autostart: true,
  pin: null,                // { salt, hash } - never the PIN itself
  items: [],
  categories: {},
  customIcons: [],
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const ICON_KEY = /^[a-z0-9_-]{1,24}$/;               // built-in icon name, or "c_xxxxxxxx" for a custom icon
const DATA_URL = /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
const MAX_ICON_CHARS = 120000;
const MAX_CUSTOM_ICONS = 100;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

function sanitizeItem(i) {
  const low = i.lowThreshold === '' || i.lowThreshold == null ? null : Number(i.lowThreshold);
  return {
    id: i.id,
    icon: ICON_KEY.test(i.icon || '') ? i.icon : '',
    step: clamp(Math.round(Number(i.step)) || 1, 1, 100000),
    lowThreshold: Number.isFinite(low) ? Math.max(0, Math.round(low)) : null,
    hidden: !!i.hidden,
  };
}

function sanitizeCustomIcons(list) {
  return (Array.isArray(list) ? list : [])
    .filter((c) => c && /^c_[a-z0-9]{4,16}$/.test(c.id) && typeof c.data === 'string' && c.data.length <= MAX_ICON_CHARS && DATA_URL.test(c.data))
    .slice(0, MAX_CUSTOM_ICONS)
    .map((c) => ({ id: c.id, name: str(c.name, 40) || 'Icon', data: c.data }));
}

function sanitizeCategories(obj) {
  const out = {};
  if (obj && typeof obj === 'object') {
    for (const [name, v] of Object.entries(obj).slice(0, 500)) {
      const n = String(name).trim().slice(0, 80);
      if (n && v && ICON_KEY.test(v.icon || '')) out[n] = { icon: v.icon };
    }
  }
  return out;
}

function sanitizeServer(s, base = DEFAULTS.server) {
  const o = s && typeof s === 'object' ? s : {};
  return {
    url: str(o.url !== undefined ? o.url : base.url, 200),
    tokenEnc: /^[A-Za-z0-9+/=]{0,4000}$/.test(o.tokenEnc || '') && o.tokenEnc !== undefined ? o.tokenEnc : (base.tokenEnc || ''),
    name: str(o.name !== undefined ? o.name : base.name, 60),
  };
}

/** Appearance and this-PC options. */
function sanitizeSettings(s, base = DEFAULTS) {
  const o = { ...s };
  return {
    theme: ['auto', 'light', 'dark'].includes(o.theme) ? o.theme : base.theme,
    accent: HEX.test(o.accent || '') ? o.accent : base.accent,
    density: ['compact', 'comfortable', 'touch'].includes(o.density) ? o.density : base.density,
    fontScale: clamp(Number(o.fontScale) || base.fontScale, 0.85, 1.6),
    keepAwake: 'keepAwake' in o ? !!o.keepAwake : base.keepAwake,
    autostart: 'autostart' in o ? !!o.autostart : base.autostart,
  };
}

function loadConfig(file) {
  const raw = readJson(file, {}) || {};
  const server = sanitizeServer(raw.server);
  return {
    ...DEFAULTS,
    ...sanitizeSettings(raw, DEFAULTS),
    version: 1,
    mode: ['server', 'local'].includes(raw.mode) ? raw.mode : (server.url && server.tokenEnc ? 'server' : ''),
    server,
    pin: raw.pin && /^[0-9a-f]{32}$/.test(raw.pin.salt) && /^[0-9a-f]{64}$/.test(raw.pin.hash) ? { salt: raw.pin.salt, hash: raw.pin.hash } : null,
    items: (Array.isArray(raw.items) ? raw.items : []).filter((i) => i && typeof i.id === 'string').map(sanitizeItem),
    categories: sanitizeCategories(raw.categories),
    customIcons: sanitizeCustomIcons(raw.customIcons),
  };
}

function saveConfig(file, cfg) { writeJsonAtomic(file, cfg); }

// ---- PIN (scrypt, constant-time compare) ---------------------------------
function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(String(pin), salt, 32).toString('hex') };
}
function verifyPin(pin, rec) {
  if (!rec) return true;
  const h = crypto.scryptSync(String(pin), rec.salt, 32);
  const want = Buffer.from(rec.hash, 'hex');
  return h.length === want.length && crypto.timingSafeEqual(h, want);
}
const validPin = (p) => /^\d{4,8}$/.test(String(p));

/** Add items from the server this PC does not know yet (appended in server order). True if changed. */
function mergeServerItems(target, serverItems) {
  const known = new Set(target.items.map((i) => i.id));
  let changed = false;
  for (const s of serverItems) {
    if (!known.has(s.id)) { target.items.push(sanitizeItem({ id: s.id })); known.add(s.id); changed = true; }
  }
  return changed;
}

/** Reorder target.items to follow `ids`; unknown ids are ignored, missing ones keep their order at the end. */
function reorderItems(target, ids) {
  const by = new Map(target.items.map((i) => [i.id, i]));
  const out = [];
  for (const id of ids) if (by.has(id)) { out.push(by.get(id)); by.delete(id); }
  target.items = [...out, ...by.values()];
}

module.exports = {
  DEFAULTS, sanitizeItem, sanitizeSettings, sanitizeServer, loadConfig, saveConfig,
  hashPin, verifyPin, validPin, mergeServerItems, reorderItems, sanitizeCustomIcons, sanitizeCategories,
  ICON_KEY, DATA_URL, MAX_ICON_CHARS, MAX_CUSTOM_ICONS,
};
