'use strict';
// "Nothing to install": the setup page must work in any browser (even without JavaScript), and the TV dashboard
// must not use JavaScript that older smart-TV browsers don't have (target: Chromium 61 / Safari 11 / Firefox 60, 2017).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createServer } = require('../server/server');
const { tmpDir } = require('./helpers');

const web = (f) => fs.readFileSync(path.join(__dirname, '..', 'server', 'web', f), 'utf8');
const icons = () => fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'icons.js'), 'utf8');
const getAsset = (n) => (n === 'icons.js' ? icons() : web(n));

// newer than Chrome 61: each would stop the whole file from running on an older TV
const TOO_NEW = [
  [/\?\?/, '?? (Chrome 80)'], [/\?\.[\w([]/, '?. (Chrome 80)'], [/catch\s*\{/, 'catch without (e) (Chrome 66)'],
  [/\.replaceChildren\(/, 'replaceChildren (Chrome 86)'], [/\.flat\(|\.flatMap\(/, 'Array.flat (Chrome 69)'], [/\.at\(/, 'Array.at (Chrome 92)'],
  [/replaceAll\(/, 'replaceAll (Chrome 85)'], [/Object\.fromEntries/, 'Object.fromEntries (Chrome 73)'], [/structuredClone/, 'structuredClone (Chrome 98)'],
  [/\.finally\(/, 'Promise.finally (Chrome 63)'], [/globalThis/, 'globalThis (Chrome 71)'], [/matchAll\(/, 'matchAll (Chrome 73)'],
  [/\bfor\s+await\b/, 'for await (Chrome 63)'], [/\d_\d/, 'numeric separators (Chrome 75)'], [/\?\?=|\|\|=|&&=/, 'logical assignment (Chrome 85)'],
];

test('TV dashboard and icons use no JavaScript newer than 2017 browsers have', () => {
  for (const [name, src] of [['dashboard.js', web('dashboard.js')], ['icons.js', icons()]]) {
    for (const [re, what] of TOO_NEW) assert.ok(!re.test(src), `${name} uses ${what}`);
  }
});

test('setup.js is plain old JavaScript (runs even in Internet Explorer)', () => {
  const src = web('setup.js');
  for (const [re, what] of [[/=>/, 'arrow functions'], [/\blet\b|\bconst\b/, 'let/const'], [/`/, 'template strings'], [/\basync\b|\bawait\b/, 'async'], [/\bfetch\(/, 'fetch'], [/\.\.\./, 'spread'], [/catch\s*\{/, 'catch without (e)']]) {
    assert.ok(!re.test(src), `setup.js uses ${what}`);
  }
});

test('dashboard CSS has plain fallbacks before newer features', () => {
  const css = web('dashboard.css');
  assert.match(css, /--fs: 18px;/);
  assert.match(css, /@supports \(width: clamp/);
  for (const line of css.split('\n').filter((l) => l.includes('color-mix'))) {
    const prop = /(?:^|[;{\s])([a-z-]+)\s*:\s*color-mix/.exec(line); // the property that uses color-mix
    const plain = prop && line.slice(0, prop.index + 1).includes(` ${prop[1]}:`);
    assert.ok(plain, `no plain fallback before color-mix in: ${line.trim()}`);
  }
});

test('setup page arrives complete: TV address, server name, pairing code and PCs are in the HTML itself', async (t) => {
  const srv = createServer({ dataDir: tmpDir(), port: 0, host: '127.0.0.1', getAsset });
  const port = await srv.listen(); t.after(() => srv.close());
  const html = await (await fetch(`http://127.0.0.1:${port}/setup`)).text();
  const code = srv.setupInfo().pairing.code;
  assert.ok(html.includes(`${code.slice(0, 3)} ${code.slice(3)}`), 'pairing code in the page');
  assert.ok(html.includes(`:${port}`), 'TV address in the page');
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(html), 'all placeholders filled');
  assert.match(html, /<form method="post" action="\/setup\/new-code"/, 'buttons are plain forms');
  assert.match(html, /Inventru server is running/);
});

test('setup page forms work without JavaScript, and need the page\'s secret token', async (t) => {
  const srv = createServer({ dataDir: tmpDir(), port: 0, host: '127.0.0.1', getAsset });
  const port = await srv.listen(); t.after(() => srv.close());
  const base = `http://127.0.0.1:${port}`;
  const html = await (await fetch(`${base}/setup`)).text();
  const token = /name="t" value="([^"]+)"/.exec(html)[1];
  const form = (action, fields) => fetch(base + action, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
  const before = srv.setupInfo().pairing.code;
  let r = await form('/setup/new-code', { t: 'wrong' });
  assert.equal(r.status, 403, 'without the page token: refused');
  r = await form('/setup/new-code', { t: token });
  assert.equal(r.status, 303); assert.match(r.headers.get('location'), /^\/setup\?msg=/);
  assert.notEqual(srv.setupInfo().pairing.code, before, 'new code made');
  await form('/setup/name', { t: token, name: 'IT Store Room' });
  assert.equal(srv.name, 'IT Store Room');
  // pair a PC, then remove it with the form
  const code = srv.setupInfo().pairing.code;
  await fetch(`${base}/api/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, device: 'a@PC' }) });
  const page = await (await fetch(`${base}/setup`)).text();
  assert.ok(page.includes('a@PC'));
  await form('/setup/remove', { t: token, id: srv.cfg.devices[0].id });
  assert.equal(srv.cfg.devices.length, 0);
});

test('names typed by people are escaped on the setup page', async (t) => {
  const srv = createServer({ dataDir: tmpDir(), port: 0, host: '127.0.0.1', getAsset });
  const port = await srv.listen(); t.after(() => srv.close());
  srv.cfg.name = '<img src=x onerror=alert(1)>';
  srv.cfg.devices.push({ id: 'd1', name: '<script>x</script>', hash: 'x'.repeat(64), created: new Date().toISOString(), lastSeen: null });
  const html = await (await fetch(`http://127.0.0.1:${port}/setup`)).text();
  assert.ok(!html.includes('<script>x') && !html.includes('<img src=x'), 'escaped');
});
