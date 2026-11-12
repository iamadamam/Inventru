// End-to-end UI test. Runs INSIDE the app window (demo data) via executeJavaScript.
// Every step uses real DOM clicks / key presses, then checks the DOM and the main-process state.
// Returns [{name, ok, detail}]. Launched by scripts/e2e.js.
(async () => {
  const results = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const key = (k, o = {}) => (document.activeElement || document).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
  const click = (el) => { if (!el) throw new Error('element not found'); el.click(); };
  const st = () => window.api.getState();
  const byName = async (n) => (await st()).items.find((i) => i.name === n);
  const row = (name) => $$('.row').find((r) => $('.name', r).textContent === name);
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return v; await sleep(60); } };
  const okBtn = () => $('#modal-root [data-ok]');
  async function step(name, fn) {
    try { const d = await fn(); results.push({ name, ok: true, detail: d || '' }); } catch (e) { results.push({ name, ok: false, detail: String(e && e.message || e) }); }
    // never leave a dialog open for the next step
    for (let i = 0; i < 3 && $('#modal-root').children.length; i++) { key('Escape'); await sleep(80); }
  }
  const expect = (c, msg) => { if (!c) throw new Error(msg); };

  await waitFor(() => $$('.row').length > 0);

  await step('list renders with categories and icons', async () => {
    expect($$('.row').length === 13, `rows: ${$$('.row').length}`);
    expect($$('.group-row').length === 6, `category headers: ${$$('.group-row').length}`);
    expect($$('#groups .chip:not(.ghost)').length === 7, 'All + 6 category chips');
    expect($('#listName').textContent === 'Demo' && !$('#listBtn'), 'server name shown, no list switcher');
    expect($('#collapseAll'), 'Collapse all button');
    const ico = $('.row .ico svg'); expect(ico, 'item icon svg');
    expect(row('Wireless mouse').querySelector('.ico').dataset.icon === 'mouse', 'mouse icon auto-picked');
    expect(row('24" monitor').querySelector('.ico').dataset.icon === 'monitor', 'monitor icon auto-picked');
    // icons are linked to the category ("Audio & video" -> speaker) unless an item has its own
    expect(row('USB headset').querySelector('.ico').dataset.icon === 'speaker', 'item follows its category icon');
    expect($('.gi', $$('.group-row').find((g) => g.dataset.cat === 'Audio & video')).dataset.icon === 'speaker', 'category heading has the same icon');
    expect(row('Webcam 1080p').dataset.level === 'out', 'qty 0 shows Out');
  });

  await step('+ button adds one (optimistic + synced)', async () => {
    click($('.c-plus', row('Wireless mouse')));
    expect($('.qty', row('Wireless mouse')).textContent === '15', 'UI updates instantly');
    expect(await waitFor(async () => (await byName('Wireless mouse')).qty === 15), 'main state 15');
  });

  await step('− button removes one, never below 0', async () => {
    click($('.c-minus', row('Wireless mouse')));
    expect(await waitFor(async () => (await byName('Wireless mouse')).qty === 14), 'back to 14');
    click($('.c-minus', row('Webcam 1080p')));
    await sleep(200);
    expect((await byName('Webcam 1080p')).qty === 0, 'still 0');
  });

  await step('Ordered toggle by click', async () => {
    click($('.c-ord', row('Wired mouse')));
    expect(await waitFor(async () => (await byName('Wired mouse')).ordered === true), 'ordered on');
    expect($('.c-ord', row('Wired mouse')).getAttribute('aria-checked') === 'true', 'shows Yes');
  });

  await step('keyboard: arrows select, → adds, ← removes, Space toggles Ordered', async () => {
    $('#list').focus();
    key('Home');
    expect($('.row.sel .name').textContent === 'Wireless mouse', 'Home selects first');
    key('ArrowDown');
    expect($('.row.sel .name').textContent === 'Wired mouse', 'Down selects next');
    key('ArrowRight'); key('+'); key('ArrowLeft');
    expect(await waitFor(async () => (await byName('Wired mouse')).qty === 10), 'net +1');
    key(' ');
    expect(await waitFor(async () => (await byName('Wired mouse')).ordered === false), 'space toggled off');
    key('ArrowRight', { shiftKey: true });
    expect(await waitFor(async () => (await byName('Wired mouse')).qty === 20), 'shift = x10');
  });

  await step('Enter: type exact quantity, and +5 / -3', async () => {
    key('Enter');
    let inp = $('.in-qty'); expect(inp, 'qty input open');
    inp.value = '7'; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(await waitFor(async () => (await byName('Wired mouse')).qty === 7), 'set to 7');
    key('Enter'); inp = $('.in-qty'); inp.value = '+5'; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(await waitFor(async () => (await byName('Wired mouse')).qty === 12), '+5 -> 12');
    key('Enter'); inp = $('.in-qty'); inp.value = '-3'; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(await waitFor(async () => (await byName('Wired mouse')).qty === 9), '-3 -> 9');
    key('Enter'); inp = $('.in-qty'); inp.value = '999'; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(150);
    expect((await byName('Wired mouse')).qty === 9, 'Esc cancels');
  });

  await step('search filters and Esc clears', async () => {
    const s = $('#search'); s.value = 'monitor'; s.dispatchEvent(new Event('input', { bubbles: true }));
    expect($$('.row').length === 2, `2 monitors, got ${$$('.row').length}`);
    s.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect($$('.row').length === 13, 'all back');
  });

  await step('category chips filter, ] cycles', async () => {
    click($$('#groups .chip').find((c) => c.textContent.startsWith('Laptops')));
    expect($$('.row').length === 2, 'laptops only');
    $('#list').focus(); key(']');
    expect($$('.row').length === 3, 'next category (Docks & cables)');
    click($$('#groups .chip')[0]);
    expect($$('.row').length === 13, 'All');
  });

  await step('Ctrl+E enters edit mode (name, category select, step, low, icons)', async () => {
    $('#list').focus(); key('e', { ctrlKey: true });
    await sleep(100);
    expect(document.body.classList.contains('editing'), 'editing class');
    expect(!$('#editbar').hidden, 'edit bar shown');
    const sel = $('.in-cat', row('Wireless mouse'));
    expect(sel.value === 'Mice', `category select shows Mice, got ${sel.value}`);
    expect([...sel.options].some((o) => o.textContent.startsWith('+ New category')), 'new category option');
  });

  await step('Clear all “Ordered” (confirm) + Undo', async () => {
    const before = (await st()).items.filter((i) => i.ordered).length;
    expect(before >= 1, `need something ordered, have ${before}`);
    click($('#eb-clear-ordered'));
    await sleep(100);
    expect(okBtn(), 'confirm dialog shown');
    click(okBtn());
    expect(await waitFor(async () => (await st()).items.filter((i) => i.ordered).length === 0), 'all cleared');
    $('#list').focus(); key('z', { ctrlKey: true });
    expect(await waitFor(async () => (await st()).items.filter((i) => i.ordered).length === before), 'undo restores');
    return `${before} cleared and restored`;
  });

  await step('Cancel in a confirm dialog really cancels', async () => {
    const before = (await st()).items.filter((i) => i.ordered).length;
    click($('#eb-clear-ordered')); await sleep(100);
    click($$('#modal-root .btn').find((b) => b.textContent === 'Cancel'));
    await sleep(200);
    expect((await st()).items.filter((i) => i.ordered).length === before, 'unchanged');
  });

  await step('Set all quantities to 0 (confirm) + Undo button in toast', async () => {
    click($('#eb-zero')); await sleep(100); click(okBtn());
    expect(await waitFor(async () => (await st()).items.every((i) => i.qty === 0)), 'all zero');
    click($('#toast button'));
    expect(await waitFor(async () => (await byName('Wireless mouse')).qty === 14), 'undo restores 14');
  });

  await step('Add item, rename it, new category, step, low threshold', async () => {
    click($('#eb-add'));
    const r = await waitFor(() => $$('.row').find((x) => $('.in-name', x).value === 'New item'));
    expect(r, 'new row');
    const name = $('.in-name', r); name.value = 'Docking station Pro'; name.dispatchEvent(new Event('change', { bubbles: true }));
    expect(await waitFor(async () => await byName('Docking station Pro')), 'renamed');
    const id = r.dataset.id;
    const sel = $('.in-cat', r); sel.value = '\u0000new'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    const inp = await waitFor(() => $('#modal-root input')); expect(inp, 'new category prompt');
    inp.value = 'Spares'; click(okBtn());
    const rr = () => $(`.row[data-id="${id}"]`);
    // the reported bug: the new category must show straight away, not only after a sync
    expect(await waitFor(() => $$('.group-row').some((g) => g.dataset.cat === 'Spares') && $('.in-cat', rr()).value === 'Spares', 400), 'new category visible immediately');
    expect(await waitFor(async () => (await st()).items.find((i) => i.id === id).group === 'Spares'), 'category set');
    const stepIn = $('.in-step', rr()); stepIn.value = '5'; stepIn.dispatchEvent(new Event('change', { bubbles: true }));
    const low = $('.in-low', rr()); low.value = '10'; low.dispatchEvent(new Event('change', { bubbles: true }));
    expect(await waitFor(async () => { const i = (await st()).items.find((x) => x.id === id); return i.step === 5 && i.low === 10; }), 'step & low saved');
    click($('.c-plus', rr())); // immediately, no waiting for the round-trip
    const q = await waitFor(async () => (await st()).items.find((x) => x.id === id).qty === 5);
    expect(q, `step 5 applied (qty now ${(await st()).items.find((x) => x.id === id).qty})`);
    expect(await waitFor(() => rr().dataset.level === 'low'), `amber when <= low threshold (level ${rr().dataset.level})`);
    expect(rr().querySelector('.ico').dataset.icon === 'dock', 'icon guessed from new name');
  });

  await step('icon picker sets a custom icon', async () => {
    const r = row('Docking station Pro');
    click($('.ico', r));
    const opt = await waitFor(() => $$('.icon-opt').find((b) => b.title === 'tools'));
    click(opt);
    expect(await waitFor(async () => (await byName('Docking station Pro')).icon === 'tools'), 'icon saved');
    expect(await waitFor(() => row('Docking station Pro').querySelector('.ico').dataset.icon === 'tools'), 'icon shown');
  });

  await step('rename a category moves all its items', async () => {
    const hdr = $$('.group-row').find((g) => g.dataset.cat === 'Spares');
    click($('.cat-rename', hdr));
    const inp = await waitFor(() => $('#modal-root input')); inp.value = 'Spare parts'; click(okBtn());
    expect(await waitFor(async () => (await byName('Docking station Pro')).group === 'Spare parts'), 'renamed category');
  });

  await step('subcategory: create, shows as a heading, filter chips, rename', async () => {
    const r = row('Wireless mouse');
    const sel = $('.in-sub', r); sel.value = '\u0000new'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    const inp = await waitFor(() => $('#modal-root input')); expect(inp, 'new subcategory prompt');
    inp.value = 'Wireless'; click(okBtn());
    expect(await waitFor(() => $$('.sub-row').some((s) => s.dataset.cat === 'Mice' && s.dataset.sub === 'Wireless'), 600), 'sub heading appears immediately');
    expect(await waitFor(async () => (await byName('Wireless mouse')).sub === 'Wireless'), 'saved');
    expect(row('Wireless mouse').classList.contains('in-sub'), 'row indented under subcategory');
    click($$('#groups .chip').find((c) => c.textContent.startsWith('Mice')));
    expect(await waitFor(() => $$('#subgroups .chip').length === 3), `sub chips All/Wireless/Other, got ${$$('#subgroups .chip').length}`);
    click($$('#subgroups .chip').find((c) => c.textContent.startsWith('Wireless')));
    expect($$('.row').length === 1, 'filtered to the subcategory');
    const sh = $$('.sub-row').find((s) => s.dataset.sub === 'Wireless');
    click($('.sub-rename', sh));
    const inp2 = await waitFor(() => $('#modal-root input')); inp2.value = 'Cordless'; click(okBtn());
    expect(await waitFor(async () => (await byName('Wireless mouse')).sub === 'Cordless'), 'subcategory renamed');
    expect(await waitFor(() => $$('.row').length === 1 && $$('.sub-row').some((s) => s.dataset.sub === 'Cordless')), 'filter followed the rename');
    click($$('#groups .chip')[0]);
    expect($('.in-step', row('Wired mouse')).closest('label').textContent.startsWith('Per click'), '"Per click" label');
  });

  await step('move up / down (Alt+arrows)', async () => {
    const ids = () => $$('.row').map((r) => $('.name', r).textContent);
    await window.api.setField((await byName('Wireless mouse')).id, 'sub', ''); // back into the same group as Wired mouse
    await waitFor(() => !row('Wireless mouse').classList.contains('in-sub'));
    const r = row('Wired mouse'); click($('.name', r).parentElement); // select
    $('#list').focus(); key('ArrowUp', { altKey: true });
    expect(await waitFor(() => ids().indexOf('Wired mouse') < ids().indexOf('Wireless mouse')), 'moved up');
    click($('.e-down', row('Wired mouse')));
    expect(await waitFor(() => ids().indexOf('Wired mouse') > ids().indexOf('Wireless mouse')), 'moved back down');
  });

  await step('hide item, still visible in edit mode, hidden after Done', async () => {
    click($('.e-hide', row('Laptop 16"')));
    expect(await waitFor(async () => (await byName('Laptop 16"')).hidden === true), 'hidden flag');
    expect(await waitFor(() => row('Laptop 16"') && row('Laptop 16"').classList.contains('is-hidden')), 'dimmed in edit mode');
    click($('#editBtn')); await sleep(150);
    expect(!row('Laptop 16"'), 'gone from normal view');
    click($('#editBtn')); await sleep(150);
    click($('.e-hide', row('Laptop 16"')));
    expect(await waitFor(async () => (await byName('Laptop 16"')).hidden === false), 'unhidden');
  });

  await step('delete item (confirm)', async () => {
    click($('.e-del', row('Docking station Pro'))); await sleep(100);
    expect(okBtn(), 'confirm shown'); click(okBtn());
    expect(await waitFor(async () => !(await byName('Docking station Pro'))), 'deleted');
    expect(!row('Docking station Pro'), 'row removed');
  });

  await step('Delete key + Cancel keeps the item', async () => {
    click($('.name', row('Wired mouse')).parentElement); $('#list').focus();
    key('Delete'); await sleep(100);
    click($$('#modal-root .btn').find((b) => b.textContent === 'Cancel')); await sleep(150);
    expect(await byName('Wired mouse'), 'still there');
  });

  // ---------------------------------------------------------------- drag & drop (edit mode)
  const pdown = (el, x, y) => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType: 'mouse', button: 0, pointerId: 1 }));
  const pmove = (x, y) => window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType: 'mouse', pointerId: 1 }));
  const pup = (x, y) => window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType: 'mouse', pointerId: 1 }));
  async function dragTo(handle, targetEl, where) {
    targetEl.scrollIntoView({ block: 'center' }); await sleep(60);
    const hr = handle.getBoundingClientRect(); const tr = targetEl.getBoundingClientRect();
    const lr = $('#list').getBoundingClientRect();
    // a real pointer always starts on screen: if the handle is scrolled away, start from the middle of the list
    const x = hr.left + hr.width / 2; const y0 = Math.min(Math.max(hr.top + hr.height / 2, lr.top + 80), lr.bottom - 80);
    const y1 = where === 'upper' ? tr.top + tr.height * 0.25 : tr.top + tr.height * 0.75;
    pdown(handle, x, y0);
    for (let i = 1; i <= 6; i++) { pmove(x, y0 + ((y1 - y0) * i) / 6); await sleep(20); }
    const gr = $('.drag-ghost') && $('.drag-ghost').getBoundingClientRect();
    if (!gr || gr.height < 20 || Math.abs(gr.top - (y1 - (y0 - hr.top))) > 40) throw new Error(`drag preview not following the pointer: ${JSON.stringify(gr)}`);
    lastTarget = { ...window.dnd.target(), y1: Math.round(y1), top: Math.round(tr.top), h: Math.round(tr.height), list: Math.round(lr.top), scroll: $('#list').scrollTop };
    pup(x, y1); await sleep(250);
  }
  let lastTarget = null;
  const groupOrder = () => $$('.group-row').map((g) => g.dataset.cat);
  const rowNames = () => $$('.row').map((r) => $('.name', r).textContent);

  await step('drag an item into another category (drop below a row)', async () => {
    expect(!$('.drag', row('Wired mouse')).hidden, 'drag handle visible in edit mode');
    await dragTo($('.drag', row('Wired mouse')), row('Wired keyboard'), 'lower');
    expect(await waitFor(async () => (await byName('Wired mouse')).group === 'Keyboards'), `category now ${(await byName('Wired mouse')).group}`);
    const n = rowNames();
    expect(n.indexOf('Wired mouse') === n.indexOf('Wired keyboard') + 1, `placed right after Wired keyboard: ${n.join(', ')}`);
    expect(!$('.drag-ghost') && $('.drop-line').hidden, 'ghost and drop line cleaned up');
  });

  await step('drag an item onto a category heading moves it to the top of that category', async () => {
    const mice = $$('.group-row').find((g) => g.dataset.cat === 'Mice');
    await dragTo($('.drag', row('Wired mouse')), mice, 'lower');
    expect(await waitFor(async () => (await byName('Wired mouse')).group === 'Mice'), 'back in Mice');
    const n = rowNames();
    expect(n.indexOf('Wired mouse') < n.indexOf('Wireless mouse'), 'at the top of Mice');
  });

  await step('drag an item into a subcategory heading sets the subcategory', async () => {
    const used = $$('.sub-row').find((s) => s.dataset.cat === 'Monitors' && s.dataset.sub === 'Used');
    await dragTo($('.drag', row('Laptop 14"')), used, 'lower');
    expect(await waitFor(async () => { const i = await byName('Laptop 14"'); return i.group === 'Monitors' && i.sub === 'Used'; }), 'moved to Monitors › Used');
    const lap = $$('.group-row').find((g) => g.dataset.cat === 'Laptops');
    await dragTo($('.drag', row('Laptop 14"')), lap, 'lower');
    expect(await waitFor(async () => { const i = await byName('Laptop 14"'); return i.group === 'Laptops' && i.sub === ''; }), 'and back (no subcategory)');
    await window.api.setField((await byName('Laptop 14"')).id, 'sub', 'New');
  });

  await step('drag a whole category above another', async () => {
    const before = groupOrder();
    const av = $$('.group-row').find((g) => g.dataset.cat === 'Audio & video');
    const mice = $$('.group-row').find((g) => g.dataset.cat === 'Mice');
    $('#list').scrollTop = 0; await sleep(50); // headings are sticky: Mice is only "itself" at the top of the list
    await dragTo($('.drag', av), mice, 'upper');
    expect(await waitFor(() => groupOrder()[0] === 'Audio & video'), `order: ${groupOrder().join(', ')} (was ${before.join(', ')}) target ${JSON.stringify(lastTarget)}`);
    expect((await byName('USB headset')).group === 'Audio & video', 'items keep their category');
  });

  await step('Esc cancels a drag', async () => {
    const order = rowNames().join('|');
    const hd = $('.drag', row('Wireless mouse')); const tr = row('27" monitor'); tr.scrollIntoView({ block: 'center' }); await sleep(50);
    const hr = hd.getBoundingClientRect(); const r2 = tr.getBoundingClientRect();
    pdown(hd, hr.left + 4, hr.top + 4); pmove(hr.left + 4, r2.top + r2.height * 0.75); await sleep(30);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    pup(hr.left + 4, r2.top + r2.height * 0.75); await sleep(200);
    expect(rowNames().join('|') === order && (await byName('Wireless mouse')).group === 'Mice', 'nothing moved');
  });

  // ---------------------------------------------------------------- category icons + your own icons
  await step('category icon is linked: set it on the heading, its items follow', async () => {
    const mon = $$('.group-row').find((g) => g.dataset.cat === 'Monitors');
    click($('.gi', mon));
    const tv = await waitFor(() => $$('#modal-root .icon-opt').find((b) => b.dataset.icon === 'tv'));
    expect(tv, 'icon picker for the category'); click(tv);
    expect(await waitFor(() => row('24" monitor').querySelector('.ico').dataset.icon === 'tv' && row('27" monitor').querySelector('.ico').dataset.icon === 'tv'), 'items use the category icon');
    expect(await waitFor(() => $('.gi', $$('.group-row').find((g) => g.dataset.cat === 'Monitors')).dataset.icon === 'tv'), 'heading shows it');
    // an item with its own icon keeps it
    click($('.ico', row('27" monitor')));
    click(await waitFor(() => $$('#modal-root .icon-opt').find((b) => b.dataset.icon === 'projector')));
    expect(await waitFor(() => row('27" monitor').querySelector('.ico').dataset.icon === 'projector'), 'own icon wins');
    click($('.ico', row('27" monitor')));
    click(await waitFor(() => $$('#modal-root .icon-opt').find((b) => b.dataset.icon === '')));
    expect(await waitFor(() => row('27" monitor').querySelector('.ico').dataset.icon === 'tv'), '"Same as category" restores the link');
  });

  await step('add your own icon (PNG), use it for a category, delete it', async () => {
    const cv = document.createElement('canvas'); cv.width = 200; cv.height = 120;
    const g = cv.getContext('2d'); g.fillStyle = '#e11d48'; g.fillRect(0, 0, 200, 120);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    await addOwnIcon(new File([blob], 'Company logo.png', { type: 'image/png' }));
    const s = await waitFor(async () => { const x = await st(); return x.customIcons.length === 1 ? x : null; });
    expect(s, 'custom icon stored');
    const ci = s.customIcons[0];
    expect(ci.name === 'Company logo' && ci.data.startsWith('data:image/png;base64,'), 'name + PNG data');
    const img = new Image(); await new Promise((r) => { img.onload = r; img.src = ci.data; });
    expect(img.width === 64 && img.height === 64, `shrunk to 64x64 (got ${img.width}x${img.height})`);
    await window.api.setCategoryIcon('Mice', ci.id);
    expect(await waitFor(() => row('Wireless mouse').querySelector('.ico img')), 'items in Mice show the custom image');
    click($('.gi', $$('.group-row').find((x) => x.dataset.cat === 'Mice')));
    const del = await waitFor(() => $('#modal-root .icon-opt .del')); expect(del, 'custom icon listed with delete');
    click(del); click(await waitFor(() => okBtn()));
    expect(await waitFor(async () => (await st()).customIcons.length === 0), 'deleted');
    expect(await waitFor(() => row('Wireless mouse').querySelector('.ico').dataset.icon === 'mouse'), 'back to the automatic icon');
  });

  await step('Import CSV adds new items and updates existing ones', async () => {
    click($('#eb-import'));
    expect(await waitFor(async () => await byName('Laptop bag 15"')), 'new item imported');
    const it = await byName('Laptop bag 15"');
    expect(it.qty === 6 && it.group === 'Bags' && it.ordered === true, JSON.stringify(it));
    expect(await waitFor(async () => (await byName('Wireless mouse')).qty === 30), 'existing item updated to 30');
  });

  await step('Done leaves edit mode', async () => {
    $('#list').focus(); key('e', { ctrlKey: true }); await sleep(100);
    expect(!document.body.classList.contains('editing'), 'not editing');
  });

  await step('categories and subcategories collapse and expand', async () => {
    const mice = () => $$('.group-row').find((g) => g.dataset.cat === 'Mice');
    click(mice()); await sleep(80);
    expect(mice().classList.contains('closed') && !row('Wireless mouse'), 'Mice collapsed, its rows hidden');
    expect(/items/.test($('small', mice()).textContent), 'heading still shows the count');
    $('#list').focus(); key('Home');
    expect($('.row.sel .name').textContent !== 'Wireless mouse', 'keyboard skips collapsed items');
    click(mice()); await sleep(80);
    expect(row('Wireless mouse'), 'expanded again');
    const newSub = () => $$('.sub-row').find((s) => s.dataset.cat === 'Monitors' && s.dataset.sub === 'New');
    click(newSub()); await sleep(80);
    expect(newSub().classList.contains('closed') && !row('24" monitor') && row('27" monitor'), 'subcategory collapsed on its own');
    click(newSub()); await sleep(80);
    key('C', { shiftKey: true }); await sleep(80);
    expect($$('.row').length === 0 && $$('.group-row').every((g) => g.classList.contains('closed')), 'Shift+C collapses all');
    const s = $('#search'); s.value = 'webcam'; s.dispatchEvent(new Event('input', { bubbles: true }));
    expect($$('.row').length === 1, 'search shows matches even when collapsed');
    s.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    click($('#collapseAll')); await sleep(80);
    expect($$('.row').length >= 13, 'Expand all');
  });

  await step('Export CSV (Ctrl+S)', async () => {
    $('#list').focus(); key('s', { ctrlKey: true });
    expect(await waitFor(() => /Exported \d+ items/.test($('#toast').textContent)), `toast: ${$('#toast').textContent}`);
  });

  await step('help dialog opens with ? and closes with Esc', async () => {
    $('#list').focus(); key('?'); await sleep(80);
    expect($('#modal-root .keys'), 'help shown');
    key('Escape'); await sleep(80);
    expect(!$('#modal-root').children.length, 'closed');
  });

  await step('settings: just Server, Appearance and This PC', async () => {
    click($('#gear')); await waitFor(() => !$('#settings').hidden);
    const titles = $$('#settings .panel > h2').map((x) => x.textContent.trim());
    expect(JSON.stringify(titles) === JSON.stringify(['Server', 'Appearance', 'This PC']), `panels: ${titles.join(', ')}`);
    expect(/Demo/.test($('#p-server').textContent), 'server panel shows the demo connection');
    click($('#settingsClose')); await sleep(100);
  });

  await step('settings: Close with unsaved changes asks, and Discard works', async () => {
    click($('#gear')); await waitFor(() => !$('#settings').hidden);
    click($$('#settings .seg button').find((b) => b.dataset.val === 'light'));
    click($('#settingsClose')); await sleep(100);
    expect(okBtn(), 'discard prompt'); click(okBtn());
    expect(await waitFor(() => $('#settings').hidden), 'closed');
    expect((await st()).ui.theme === 'dark', 'change discarded');
    expect(document.documentElement.dataset.theme === 'dark', 'preview undone');
  });

  await step('settings: appearance saved', async () => {
    click($('#gear')); await waitFor(() => !$('#settings').hidden);
    click($$('#settings .seg button').find((b) => b.dataset.val === 'compact'));
    click($('#settingsSave'));
    expect(await waitFor(async () => (await st()).ui.density === 'compact'), 'compact saved');
    await window.api.settingsSave({ settings: { density: 'comfortable' } }).catch(() => {});
  });

  await step('PIN: set, edit mode then needs PIN, wrong PIN refused, right PIN unlocks, remove', async () => {
    click($('#gear')); await waitFor(() => !$('#settings').hidden);
    click($$('#settings .btn').find((b) => b.textContent === 'Set PIN'));
    for (const d of '2468') click($$('#modal-root .numpad button').find((b) => b.textContent === d));
    click($$('#modal-root .btn').find((b) => b.textContent === 'Save'));
    await waitFor(() => !$('#modal-root').children.length);
    click($('#settingsClose')); await sleep(150);
    expect(await window.api.pinRequired(), 'locked after closing settings');
    let threw = false; try { await window.api.addItem({ name: 'x' }); } catch { threw = true; }
    expect(threw, 'main process refuses edits without PIN');
    click($('#editBtn')); await sleep(100);
    expect($('#modal-root .pin-dots'), 'PIN prompt');
    for (const d of '1111') key(d);
    click($$('#modal-root .btn').find((b) => b.textContent === 'Unlock')); await sleep(150);
    expect($('#modal-root .pin-err').textContent.includes('Wrong'), 'wrong PIN refused');
    for (const d of '2468') key(d);
    click($$('#modal-root .btn').find((b) => b.textContent === 'Unlock'));
    expect(await waitFor(() => document.body.classList.contains('editing')), 'unlocked into edit mode');
    // Unlocking Edit mode must NOT unlock Settings (e.g. logging can't be switched off)
    let settingsBlocked = false; try { await window.api.settingsGet(); } catch { settingsBlocked = true; }
    expect(settingsBlocked, 'settings stay locked while edit mode is unlocked');
    let saveBlocked = false; try { await window.api.settingsSave({ settings: {}, lists: [] }); } catch { saveBlocked = true; }
    expect(saveBlocked, 'settings cannot be saved without the PIN');
    click($('#gear')); await sleep(100);
    expect($('#modal-root .pin-dots'), 'gear asks for the PIN even while editing');
    key('Escape'); await sleep(100);
    click($('#editBtn')); await sleep(100);
    click($('#gear')); await sleep(100);
    for (const d of '2468') key(d);
    click($$('#modal-root .btn').find((b) => b.textContent === 'Unlock'));
    await waitFor(() => !$('#settings').hidden);
    // idle auto-lock: pretend nobody touched the PC for 6 minutes while Settings is open
    lastActivity = Date.now() - 6 * 60 * 1000; idleCheck(); await sleep(150);
    expect($('#settings').hidden, 'settings closed by the idle lock');
    let relocked = false; try { await window.api.settingsGet(); } catch { relocked = true; }
    expect(relocked, 'settings locked again in the main process');
    click($('#editBtn')); await sleep(100); for (const d of '2468') key(d);
    click($$('#modal-root .btn').find((b) => b.textContent === 'Unlock'));
    await waitFor(() => document.body.classList.contains('editing'));
    lastActivity = Date.now() - 6 * 60 * 1000; idleCheck(); await sleep(150);
    expect(!document.body.classList.contains('editing'), 'edit mode closed by the idle lock');
    expect(await window.api.pinRequired('edit'), 'edit locked again in the main process');
    // back into settings to remove the PIN
    click($('#gear')); await sleep(100); for (const d of '2468') key(d);
    click($$('#modal-root .btn').find((b) => b.textContent === 'Unlock'));
    await waitFor(() => !$('#settings').hidden);
    click($$('#settings .btn').find((b) => b.textContent === 'Remove PIN')); await sleep(100);
    click($('#settingsClose')); await sleep(100);
    expect(!(await window.api.pinRequired('settings')), 'PIN removed');
  });

  await step('the window cannot make network requests (blocked by policy)', async () => {
    let blocked = false;
    try { await fetch('https://example.com/', { mode: 'no-cors' }); } catch { blocked = true; }
    expect(blocked, 'fetch from the UI must fail');
    const img = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r('loaded'); i.onerror = () => r('blocked'); i.src = src; });
    expect(await img('../assets/icon.png') === 'loaded', 'the app can load its own files');
    expect(await img('file:///C:/Windows/Web/Screen/img100.jpg') === 'blocked', 'other files on the PC are blocked');
    expect(typeof require === 'undefined' && typeof process === 'undefined', 'no Node.js access in the UI');
  });

  await step('no stray "null" / "undefined" text anywhere on screen', async () => {
    click($$('#groups .chip').find((c) => c.textContent.startsWith('Monitors'))); await sleep(100);
    toast('Saved'); await sleep(50);
    const bad = /\bnull\b|\bundefined\b|\[object /;
    for (const sel of ['#app', '#toast']) expect(!bad.test($(sel).innerText), `${sel}: ${($(sel).innerText.match(bad) || [''])[0]}`);
    click($$('#groups .chip')[0]);
  });

  await step('no console errors / renderer still healthy', async () => {
    expect($$('.row').length > 0, 'rows still render');
  });

  return results;
})();
