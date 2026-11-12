// End-to-end: a fresh app connects to a real server and works with it. __ADDR__ / __CODE__ are filled in by scripts/e2e-server.js.
(async () => {
  const ADDR = '__ADDR__';
  const CODE = '__CODE__';
  const results = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const st = () => window.api.getState();
  const byName = async (n) => (await st()).items.find((i) => i.name === n);
  const row = (name) => $$('.row').find((r) => $('.name', r).textContent === name);
  const waitFor = async (fn, ms = 8000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return v; await sleep(100); } };
  const click = (el) => { if (!el) throw new Error('element not found'); el.click(); };
  const type = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const expect = (c, m) => { if (!c) throw new Error(m); };
  async function step(name, fn) { try { results.push({ name, ok: true, detail: (await fn()) || '' }); } catch (e) { results.push({ name, ok: false, detail: String((e && e.message) || e) }); } }

  await step('first start shows only "Connect to your Inventru server"', async () => {
    expect(!$('#connect').hidden && $('#app').hidden, 'connect screen shown, list hidden');
    expect(/Connect to your Inventru server/.test($('#connect').textContent), 'title');
  });

  await step('a wrong pairing code is explained', async () => {
    type($('#cAddr'), ADDR); type($('#cCode'), CODE === '000000' ? '111111' : '000000');
    click($('#cGo'));
    expect(await waitFor(() => /Wrong pairing code/.test($('.cmsg').textContent)), `message: ${$('.cmsg').textContent}`);
  });

  await step('the right code connects, and the stock list appears', async () => {
    type($('#cCode'), `${CODE.slice(0, 3)} ${CODE.slice(3)}`);
    click($('#cGo'));
    expect(await waitFor(() => $('#connect').hidden && !$('#app').hidden), 'list shown');
    expect(await waitFor(() => row('Wireless mouse')), 'items from the server');
    expect($('#listName').textContent === 'IT Store Room', `server name in the header: ${$('#listName').textContent}`);
    expect(!$('#dashBtn').hidden, 'TV dashboard button');
  });

  await step('+ / − / Ordered are saved on the server', async () => {
    click($('.c-plus', row('Wireless mouse'))); click($('.c-plus', row('Wireless mouse')));
    click($('.c-minus', row('Webcam'))); click($('.c-ord', row('Webcam')));
    expect(await waitFor(async () => { const it = await byName('Wireless mouse'); return it.qty === 12 && !it.pending; }), 'mouse');
    expect(await waitFor(async () => { const it = await byName('Webcam'); return it.qty === 0 && it.ordered && !it.pending; }), 'webcam');
    expect(/Up to date/.test($('#sync .label').textContent), `status: ${$('#sync .label').textContent}`);
  });

  await step('edit mode: new item with category, subcategory and warn level', async () => {
    const r = await window.api.addItem({ name: '27" monitor', group: 'Monitors', sub: 'Used' });
    await window.api.setMeta(r.id, { lowThreshold: 2 });
    await window.api.tap(r.id, 1);
    expect(await waitFor(async () => { const it = (await st()).items.find((x) => x.id === r.id); return it && !it.pending && it.qty === 1; }, 10000), 'synced');
  });

  await step('a change made on another PC shows up by itself', async () => {
    expect(await waitFor(async () => (await byName('HDMI cable')).qty === 105, 20000), `HDMI cable now ${(await byName('HDMI cable')).qty}`);
    expect(await waitFor(() => $('.qty', row('HDMI cable')).textContent === '105'), 'on screen');
  });

  await step('Settings shows the server and can check the connection', async () => {
    click($('#gear')); await waitFor(() => !$('#settings').hidden);
    expect(/IT Store Room/.test($('#p-server').textContent), 'server name');
    click($('#testServer'));
    expect(await waitFor(() => /Connected to "IT Store Room"/.test(($('#p-server .msg.ok') || {}).textContent || '')), 'check ok');
    click($('#settingsClose'));
  });

  return results;
})();
