'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const c = require('../src/core/config');
const { tmpDir } = require('./helpers');

test('settings are clamped and validated; default theme is dark', () => {
  const s = c.sanitizeSettings({ fontScale: 9, theme: 'neon', accent: 'red', density: 'touch' });
  assert.equal(s.fontScale, 1.6);
  assert.equal(s.theme, 'dark');
  assert.equal(s.accent, c.DEFAULTS.accent);
  assert.equal(s.density, 'touch');
});

test('item options: step >= 1, optional threshold, icon key validated', () => {
  const i = c.sanitizeItem({ id: 'x', step: 0, lowThreshold: '', icon: '<b>' });
  assert.deepEqual([i.step, i.lowThreshold, i.icon], [1, null, '']);
  assert.equal(c.sanitizeItem({ id: 'x', lowThreshold: '3' }).lowThreshold, 3);
  assert.equal(c.sanitizeItem({ id: 'x', icon: 'c_ab12cd34' }).icon, 'c_ab12cd34');
});

test('PIN is hashed and verified; wrong PIN rejected; no PIN = open', () => {
  const rec = c.hashPin('1234');
  assert.ok(!JSON.stringify(rec).includes('1234'));
  assert.equal(c.verifyPin('1234', rec), true);
  assert.equal(c.verifyPin('4321', rec), false);
  assert.equal(c.verifyPin('anything', null), true);
  assert.equal(c.validPin('12'), false);
});

test('config round-trips: server, item options, category icons', () => {
  const f = path.join(tmpDir(), 'config.json');
  const cfg = c.loadConfig(f);
  assert.equal(cfg.server.url, '');
  cfg.server = { url: 'STOCK-VM', tokenEnc: 'QUJD', name: 'IT Store Room' };
  cfg.items.push(c.sanitizeItem({ id: 'a', step: 5 }));
  cfg.categories = { Mice: { icon: 'mouse' } };
  c.saveConfig(f, cfg);
  const back = c.loadConfig(f);
  assert.deepEqual(back.server, { url: 'STOCK-VM', tokenEnc: 'QUJD', name: 'IT Store Room' });
  assert.equal(back.items[0].step, 5);
  assert.deepEqual(back.categories, { Mice: { icon: 'mouse' } });
});

test('a damaged settings file is ignored safely: junk PIN records and items are dropped', () => {
  const f = path.join(tmpDir(), 'config.json');
  fs.writeFileSync(f, JSON.stringify({ theme: 'light', pin: { salt: 'x', hash: 'y' }, items: [null, { id: 5 }, { id: 'a', step: 3 }], server: 'nonsense' }));
  const cfg = c.loadConfig(f);
  assert.equal(cfg.theme, 'light');
  assert.equal(cfg.pin, null, 'a malformed PIN record is not trusted');
  assert.deepEqual(cfg.items.map((i) => [i.id, i.step]), [['a', 3]]);
  assert.deepEqual(cfg.server, { url: '', tokenEnc: '', name: '' });
  fs.writeFileSync(f, 'not json at all');
  assert.equal(c.loadConfig(f).theme, 'dark', 'unreadable file: defaults');
});

test('a PIN set by the app survives a restart', () => {
  const f = path.join(tmpDir(), 'config.json');
  const cfg = c.loadConfig(f);
  cfg.pin = c.hashPin('2468');
  c.saveConfig(f, cfg);
  assert.equal(c.verifyPin('2468', c.loadConfig(f).pin), true);
});

test('junk in the server settings is dropped', () => {
  assert.equal(c.sanitizeServer({ url: 'x', tokenEnc: '<script>' }).tokenEnc, '');
  assert.equal(c.sanitizeServer({ url: 'x'.repeat(500) }).url.length, 200);
});

test('category icons and custom icons are validated', () => {
  assert.deepEqual(c.sanitizeCategories({ Mice: { icon: 'mouse' }, Bad: { icon: '<script>' } }), { Mice: { icon: 'mouse' } });
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const icons = c.sanitizeCustomIcons([
    { id: 'c_ab12cd34', name: 'Logo', data: png },
    { id: 'c_bad', name: 'short id', data: png },
    { id: 'c_ef56ab78', name: 'html', data: 'data:text/html;base64,PHNjcmlwdD4=' },
    { id: 'c_ef56ab79', name: 'quote', data: 'data:image/png;base64,abc" onerror="x' },
    { id: 'c_ef56ab80', name: 'huge', data: `data:image/png;base64,${'A'.repeat(c.MAX_ICON_CHARS)}` },
  ]);
  assert.deepEqual(icons.map((i) => i.id), ['c_ab12cd34']);
});

test('server items merge into this PC\'s item options without losing them; reorder works', () => {
  const t = { items: [c.sanitizeItem({ id: 'a', step: 5 })] };
  assert.equal(c.mergeServerItems(t, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]), true);
  assert.equal(t.items[0].step, 5);
  assert.equal(c.mergeServerItems(t, [{ id: 'a' }]), false);
  c.reorderItems(t, ['c', 'a']);
  assert.deepEqual(t.items.map((i) => i.id), ['c', 'a', 'b']);
});
