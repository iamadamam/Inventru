// End-to-end: "Just this PC" (no server). __PHASE__ is filled in by scripts/e2e-local.js.
(async () => {
  const PHASE = '__PHASE__';
  const results = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const st = () => window.api.getState();
  const byName = async (n) => (await st()).items.find((i) => i.name === n);
  const row = (name) => $$('.row').find((r) => $('.name', r).textContent === name);
  const waitFor = async (fn, ms = 8000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return v; await sleep(100); } };
  const click = (el) => { if (!el) throw new Error('element not found'); el.click(); };
  const expect = (c, m) => { if (!c) throw new Error(m); };
  async function step(name, fn) { try { results.push({ name, ok: true, detail: (await fn()) || '' }); } catch (e) { results.push({ name, ok: false, detail: String((e && e.message) || e) }); } }

  if (PHASE === 'first') {
    await step('first start offers "Just this PC" next to connecting to a server', async () => {
      expect(!$('#connect').hidden && $('#app').hidden, 'welcome screen shown');
      expect($('#cLocal') && /Just this PC/.test($('#cLocal').textContent), 'Just this PC button');
      expect($('#cGo'), 'Connect button still there');
    });
    await step('"Just this PC" opens an empty list with no server and no TV dashboard', async () => {
      click($('#cLocal'));
      expect(await waitFor(() => $('#connect').hidden && !$('#app').hidden), 'list shown');
      expect($('#dashBtn').hidden, 'no Dashboard button');
      expect(await waitFor(() => /Saved on this PC/.test($('#sync .label').textContent)), `status: ${$('#sync .label').textContent}`);
      expect(await waitFor(() => /No items yet/.test($('#empty').textContent)), 'empty list');
    });
    await step('add items, + / − / Ordered: saved on this PC', async () => {
      const a = await window.api.addItem({ name: 'Wireless mouse', group: 'Mice' });
      const b = await window.api.addItem({ name: 'Webcam', group: 'Audio & video', sub: 'USB' });
      await window.api.setMeta(b.id, { lowThreshold: 2 });
      expect(await waitFor(() => row('Wireless mouse') && row('Webcam')), 'rows shown');
      for (let i = 0; i < 3; i++) click($('.c-plus', row('Wireless mouse')));
      click($('.c-minus', row('Wireless mouse')));
      click($('.c-ord', row('Webcam')));
      expect(await waitFor(async () => { const m = await byName('Wireless mouse'); const w = await byName('Webcam'); return m.qty === 2 && !m.pending && w.ordered && !w.pending; }), 'saved');
      expect(/Saved on this PC/.test($('#sync .label').textContent), `status: ${$('#sync .label').textContent}`);
      return `${a.id}, ${b.id}`;
    });
    await step('Settings shows "Just this PC" with its folder, and offers to connect to a server', async () => {
      click($('#gear')); await waitFor(() => !$('#settings').hidden);
      const p = $('#p-server');
      expect(/Just this PC/.test(p.textContent) && /2 items/.test(p.textContent), p.textContent);
      expect(/inventru|stock/i.test(p.textContent) && $('#toServer') && $('#openFolder'), 'folder and buttons');
      expect(!$('#testServer'), 'no server check');
      click($('#settingsClose'));
      await waitFor(() => $('#settings').hidden);
    });
  }

  if (PHASE === 'again') {
    await step('started again, it opens its own list straight away', async () => {
      expect(await waitFor(() => $('#connect').hidden && row('Wireless mouse') && row('Webcam')), 'list shown');
      expect((await byName('Wireless mouse')).qty === 2, 'quantity kept');
      expect((await byName('Webcam')).ordered && (await byName('Webcam')).low === 2, 'ordered + warn level kept');
    });
  }

  if (PHASE === 'to-server') {
    await step('Connect to a server: this PC\'s list is copied to the (empty) server', async () => {
      const r = await window.api.connect('__ADDR__', '__CODE__');
      expect(r.ok && r.copied === 2, JSON.stringify(r));
      expect(await waitFor(() => !$('#dashBtn').hidden && /Up to date/.test($('#sync .label').textContent)), `status: ${$('#sync .label').textContent}`);
      expect((await byName('Wireless mouse')).qty === 2, 'same list, now from the server');
    });
    await step('Settings > Use just this PC: back to this PC\'s own list (nothing copied)', async () => {
      click($('#gear')); await waitFor(() => !$('#settings').hidden && $('#toLocal'));
      click($('#toLocal'));
      expect(await waitFor(() => $('.modal [data-ok]')), 'confirm dialog');
      expect(/its own list from before \(2 items\)/.test($('.modal').textContent), $('.modal').textContent);
      click($('.modal [data-ok]'));
      expect(await waitFor(() => /Just this PC/.test(($('#p-server') || {}).textContent || '')), 'Settings now shows Just this PC');
      click($('#settingsClose'));
      expect(await waitFor(() => $('#dashBtn').hidden && /Saved on this PC/.test($('#sync .label').textContent)), 'no server');
      expect((await byName('Wireless mouse')).qty === 2, 'own list');
    });
  }

  if (PHASE === 'from-server') {
    await step('a PC paired with a server can switch to just this PC, keeping a copy of the list', async () => {
      expect(!$('#connect').hidden, 'welcome screen');
      const c = await window.api.connect('__ADDR__', '__CODE__');
      expect(c.ok && c.copied === null, JSON.stringify(c));
      expect(await waitFor(async () => (await st()).items.length === 3), 'server list shown');
      const r = await window.api.useLocal();
      expect(r.ok && r.copied === 3, JSON.stringify(r));
      expect(await waitFor(async () => (await st()).mode === 'local' && (await st()).items.length === 3 && $('#dashBtn').hidden), 'copy shown');
    });
  }
  return results;
})();
