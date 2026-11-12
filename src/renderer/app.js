'use strict';
/* Main screen: keyboard-first stock list with an edit mode. Depends on icons.js. */

const $ = (s, r = document) => r.querySelector(s);

// replaceChildren(a, null) would insert the text "null"; skip empty entries everywhere (we often pass `cond ? el : null`).
{
  const native = Element.prototype.replaceChildren;
  Element.prototype.replaceChildren = function replaceChildren(...kids) {
    return native.apply(this, kids.flat().filter((k) => k != null && k !== false));
  };
}

/** Tiny DOM builder: h('div', {class:'x', onclick}, child, 'text') */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v; // only ever our own static SVG strings
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}
const ic = (name) => h('span', { class: 'i', html: svgIcon(name) });

let state = null;
let editing = false;
let sel = null;            // selected item id
let filterCat = null;      // null = all categories
let filterSub = null;      // null = all subcategories of filterCat
let query = '';
let pendingFocus = null;   // { id } focus the name field of a just-added item
let qtyEditing = null;     // id whose quantity is being typed
let lastUndo = null;       // { snap }
const rowEls = new Map();
const catEls = new Map();
const subEls = new Map();
const listEl = $('#list');
const rowsEl = $('#rows');
const NEW_CAT = '\u0000new';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
const errText = (err) => String((err && err.message) || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// ---------------------------------------------------------------- toast / modal
let toastTimer;
function toast(msg, action) {
  const t = $('#toast');
  t.replaceChildren(h('span', {}, msg), action ? h('button', { onclick: () => { t.classList.remove('show'); action.onClick(); } }, action.label) : null);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 9000 : 2800);
}

const modalOpen = () => $('#modal-root').children.length > 0;

function modal(content, { wide = false, onClose } = {}) {
  const scrim = h('div', { class: 'scrim' }, h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true' }, content));
  let closed = false;
  const close = (result) => {
    if (closed) return; closed = true;
    scrim.remove(); document.removeEventListener('keydown', esc, true);
    if (onClose) onClose(result);
    returnFocus();
  };
  const esc = (e) => { if (e.key === 'Escape' && $('#modal-root').lastChild === scrim) { e.stopPropagation(); e.preventDefault(); close(); } };
  scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim) close(); });
  document.addEventListener('keydown', esc, true);
  $('#modal-root').append(scrim);
  const first = scrim.querySelector('[autofocus], input, .btn.primary, .btn.danger, button');
  if (first) setTimeout(() => first.focus(), 0);
  return { close, el: scrim };
}

function returnFocus() { if (!modalOpen() && $('#settings').hidden) listEl.focus({ preventScroll: true }); }

/** Resolves true/false. Resolve BEFORE closing: close() fires onClose, which would otherwise settle it as "cancelled". */
function confirmDialog(title, body, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    let m;
    const done = (v) => { resolve(v); m.close(); };
    m = modal([
      h('h3', {}, title), h('p', { class: 'sub' }, body),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => done(false) }, 'Cancel'),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, autofocus: true, 'data-ok': '', onclick: () => done(true) }, okLabel)),
    ], { onClose: () => resolve(false) });
  });
}

/** Resolves the typed text, or null if cancelled. */
function promptDialog(title, sub, value = '', okLabel = 'OK') {
  return new Promise((resolve) => {
    let m;
    const input = h('input', { class: 'input wide', value, maxlength: 80, autofocus: true, spellcheck: 'false' });
    const done = (v) => { resolve(v); m.close(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(input.value.trim()); } });
    m = modal([h('h3', {}, title), sub ? h('p', { class: 'sub' }, sub) : null, input,
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => done(null) }, 'Cancel'),
        h('button', { class: 'btn primary', 'data-ok': '', onclick: () => done(input.value.trim()) }, okLabel))],
    { onClose: () => resolve(null) });
    setTimeout(() => input.select(), 10);
  });
}

function numpad(onKey) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];
  return h('div', { class: 'numpad' }, keys.map((k) => h('button', { type: 'button', onclick: () => onKey(k) }, k)));
}

// ---------------------------------------------------------------- derived data
const lvl = (it) => (it.qty === 0 ? 'out' : (it.low != null && it.qty <= it.low ? 'low' : 'ok'));
const catOf = (it) => it.group || '';
const subOf = (it) => it.sub || '';
/**
 * Icons are linked to categories:
 *   item's own icon (if chosen)  ->  its category's icon (if chosen)  ->  guessed from the category name
 *   ->  guessed from the item name  ->  a box.
 */
const catIconSet = (cat) => (state && state.categoryIcons && state.categoryIcons[cat]) || '';
const autoIconOf = (it) => catIconSet(catOf(it)) || guessIcon(catOf(it)) || guessIcon(it.name) || 'box';
const iconOf = (it) => it.icon || autoIconOf(it);
const catIcon = (cat, items) => catIconSet(cat) || guessIcon(cat) || (items && items[0] ? guessIcon(items[0].name) : null) || 'tag';

// ---------------------------------------------------------------- collapsed categories / subcategories (remembered on this PC)
let collapsed = new Set();
const ckey = (cat, sub) => (sub === undefined ? `c\u0001${cat}` : `s\u0001${cat}\u0001${sub}`);
const collapseStoreKey = () => 'collapsed';
function loadCollapsed() { try { collapsed = new Set(JSON.parse(store.get(collapseStoreKey()) || '[]')); } catch { collapsed = new Set(); } }
function saveCollapsed() { store.set(collapseStoreKey(), JSON.stringify([...collapsed])); }
/** While searching, everything is expanded so matches are never hidden. */
const isCollapsed = (cat, sub) => !query.trim() && collapsed.has(ckey(cat, sub));
function toggleCollapse(cat, sub) {
  const k = ckey(cat, sub);
  if (collapsed.has(k)) collapsed.delete(k); else collapsed.add(k);
  saveCollapsed(); render();
}
function setAllCollapsed(on) {
  if (on) { for (const s of sections(shownItems())) collapsed.add(ckey(s.cat)); } else collapsed.clear();
  saveCollapsed(); render();
}

function allVisible() { return state.items.filter((i) => editing || !i.hidden); }
function categories() { return [...new Set(state.items.map(catOf))].filter(Boolean); }
function subcategories(cat) { return [...new Set(state.items.filter((i) => catOf(i) === cat).map(subOf))].filter(Boolean); }

function shownItems() {
  const q = query.trim().toLowerCase();
  return allVisible().filter((i) => (filterCat === null || catOf(i) === filterCat)
    && (filterCat === null || filterSub === null || subOf(i) === filterSub)
    && (!q || i.name.toLowerCase().includes(q) || catOf(i).toLowerCase().includes(q) || subOf(i).toLowerCase().includes(q)));
}

/** Items grouped by category, then subcategory, in order of first appearance. */
function sections(items) {
  const order = []; const by = new Map();
  for (const it of items) {
    const g = catOf(it);
    if (!by.has(g)) { by.set(g, { subOrder: [], subs: new Map() }); order.push(g); }
    const c = by.get(g); const s = subOf(it);
    if (!c.subs.has(s)) { c.subs.set(s, []); c.subOrder.push(s); }
    c.subs.get(s).push(it);
  }
  return order.map((g) => {
    const c = by.get(g);
    // items without a subcategory first, then each subcategory
    const subs = [...c.subOrder].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : 0)).map((s) => ({ sub: s, items: c.subs.get(s) }));
    return { cat: g, subs, items: subs.flatMap((s) => s.items) };
  });
}

/** Rows the keyboard can reach: shown, and not inside a collapsed category / subcategory. */
const flatRows = () => sections(shownItems()).flatMap((s) => (isCollapsed(s.cat) ? []
  : s.subs.flatMap((ss) => (ss.sub && isCollapsed(s.cat, ss.sub) ? [] : ss.items))));

// ---------------------------------------------------------------- rendering
function renderSync(s) {
  const el = $('#sync');
  const t = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const local = state.mode === 'local';
  let text;
  if (s.state === 'error') text = local ? 'Not saved - click for details' : 'Server problem - click for details';
  else if (s.state === 'offline') text = s.pending ? `Offline · ${s.pending} waiting` : 'Offline';
  else if (s.pending) text = `Saving ${s.pending}…`;
  else if (local) text = 'Saved on this PC';
  else if (s.lastSyncAt) text = `Up to date ${t(s.lastSyncAt)}`;
  else text = 'Connecting…';
  if (state.demo) text = `Demo · ${text}`;
  el.dataset.state = s.state;
  el.dataset.busy = (s.syncing || (s.pending && s.state === 'ok')) ? '1' : '0';
  $('.label', el).textContent = text;
  el.title = local ? `${s.error ? `${s.error}\n` : ''}Just this PC: the list is saved on this PC as soon as you change it.`
    : `${s.error ? `${s.error}\n` : ''}Server:${state.server.host || 'demo'}. Changes are saved there straight away; if the server can't be reached they wait here and are sent automatically. Click to check now.`;
}

function makeRow(id) {
  const t = { tabindex: '-1' };
  return h('div', { class: 'row', 'data-id': id, role: 'row' },
    h('div', { class: 'c-item' },
      h('span', { class: 'drag', title: 'Drag to move (or Alt+↑ / Alt+↓)', html: svgIcon('grip') }),
      h('button', { class: 'ico', ...t, title: 'Icon' }),
      h('span', { class: 'name' }), h('input', { class: 'in-name', 'data-f': 'name', maxlength: 80, spellcheck: 'false', 'aria-label': 'Item name' }),
      h('span', { class: 'tag' }), h('span', { class: 'pend', title: 'Waiting to sync' })),
    h('button', { class: 'c-qty', ...t, 'aria-label': 'Set quantity' }, h('span', { class: 'qty' })),
    h('button', { class: 'c-btn c-plus', ...t, 'aria-label': 'Add', html: svgIcon('plus') }),
    h('button', { class: 'c-btn c-minus', ...t, 'aria-label': 'Remove', html: svgIcon('minus') }),
    h('button', { class: 'c-ord', ...t, role: 'switch' }),
    h('div', { class: 'c-edit' },
      h('label', {}, 'Category', h('select', { class: 'in-cat', 'data-f': 'group' })),
      h('label', {}, 'Subcategory', h('select', { class: 'in-sub', 'data-f': 'sub' })),
      h('label', { title: 'How much one click of Add / Remove (or one → / ← key press) changes the quantity. Use 5 if you count in packs of 5.' },
        'Per click', h('input', { class: 'in-step', 'data-f': 'step', type: 'number', min: 1 })),
      h('label', { title: 'The row turns amber when the quantity is at or below this number. Leave empty for no warning.' },
        'Warn at ≤', h('input', { class: 'in-low', 'data-f': 'low', type: 'number', min: 0, placeholder: 'off' })),
      h('span', { class: 'sp' }),
      h('button', { class: 'ib e-up', ...t, title: 'Move up (Alt+↑)', html: svgIcon('up') }),
      h('button', { class: 'ib e-down', ...t, title: 'Move down (Alt+↓)', html: svgIcon('down') }),
      h('button', { class: 'ib e-hide', ...t, title: 'Hide from list', html: svgIcon('eye') }),
      h('button', { class: 'ib danger e-del', ...t, title: 'Delete (Del)', html: svgIcon('trash') })));
}

function setVal(input, v) { if (document.activeElement !== input && input.value !== String(v)) input.value = v; }

function fillSelect(selEl, options, current, newLabel) {
  if (document.activeElement === selEl) return;
  if (current && !options.includes(current)) options = [...options, current];
  const sig = `${options.join('\u0001')}|${current}`;
  if (selEl.dataset.sig === sig) return;
  selEl.dataset.sig = sig;
  selEl.replaceChildren(h('option', { value: '' }, '(none)'), ...options.map((c) => h('option', { value: c }, c)), h('option', { value: NEW_CAT }, newLabel));
  selEl.value = current;
}

function updateRow(el, it) {
  el.dataset.level = lvl(it);
  el.dataset.pending = it.pending ? '1' : '0';
  el.classList.toggle('ordered', it.ordered);
  el.classList.toggle('is-hidden', !!it.hidden);
  el.classList.toggle('sel', sel === it.id);
  const ico = $('.ico', el); const icn = iconOf(it);
  if (ico.dataset.icon !== icn) { ico.innerHTML = iconMarkup(icn); ico.dataset.icon = icn; }
  ico.title = editing ? (it.icon ? 'Own icon - click to change' : 'Uses the category icon - click to change') : '';
  $('.drag', el).hidden = !editing;
  const name = $('.name', el); if (name.textContent !== it.name) name.textContent = it.name;
  setVal($('.in-name', el), it.name);
  $('.tag', el).textContent = it.qty === 0 ? 'Out' : 'Low';
  if (qtyEditing !== it.id) {
    const q = $('.qty', el);
    if (q.textContent !== String(it.qty)) {
      const had = q.dataset.set === '1';
      q.textContent = it.qty;
      if (had) { q.classList.remove('bump'); void q.offsetWidth; q.classList.add('bump'); }
    }
    q.dataset.set = '1';
  }
  const ord = $('.c-ord', el);
  ord.setAttribute('aria-checked', it.ordered ? 'true' : 'false');
  ord.replaceChildren(it.ordered ? ic('check') : '', it.ordered ? 'Yes' : 'No');
  ord.title = it.ordered ? 'Ordered - click to clear (Space)' : 'Not ordered - click to mark as ordered (Space)';
  $('.c-minus', el).setAttribute('aria-disabled', it.qty === 0 ? 'true' : 'false');
  $('.c-plus', el).title = `Add ${it.step} (→ or +)`;
  $('.c-minus', el).title = `Remove ${it.step} (← or -)`;
  if (editing) {
    fillSelect($('.in-cat', el), categories(), catOf(it), '+ New category…');
    fillSelect($('.in-sub', el), subcategories(catOf(it)), subOf(it), '+ New subcategory…');
    setVal($('.in-step', el), it.step);
    setVal($('.in-low', el), it.low == null ? '' : it.low);
    const hide = $('.e-hide', el);
    hide.innerHTML = svgIcon(it.hidden ? 'eyeOff' : 'eye');
    hide.title = it.hidden ? 'Hidden - click to show' : 'Hide from list';
  }
}

function renderCats() {
  const nav = $('#groups');
  const all = allVisible();
  const names = [...new Set(all.map(catOf))].filter(Boolean);
  if (filterCat !== null && !names.includes(filterCat) && !(filterCat === '' && all.some((i) => !catOf(i)))) filterCat = null;
  if (!names.length) { nav.replaceChildren(); return; }
  const mk = (label, value, n, icon) => h('button', {
    class: `chip${filterCat === value ? ' on' : ''}`,
    onclick: () => { filterCat = value; filterSub = null; store.set('cat', value === null ? '' : `=${value}`); render(); },
  }, icon ? h('span', { class: 'i', html: iconMarkup(icon) }) : null, label, h('small', {}, n));
  const chips = [mk('All', null, all.length, 'list'),
    ...names.map((g) => { const its = all.filter((i) => catOf(i) === g); return mk(g, g, its.length, catIcon(g, its)); })];
  const none = all.filter((i) => !catOf(i));
  if (none.length) chips.push(mk('No category', '', none.length, 'tag'));
  const anyOpen = sections(shownItems()).some((s) => !collapsed.has(ckey(s.cat)));
  chips.push(h('button', { class: 'chip ghost', id: 'collapseAll', title: 'Collapse or expand every category (Shift+C)', onclick: () => setAllCollapsed(anyOpen) },
    ic(anyOpen ? 'collapse' : 'expand'), anyOpen ? 'Collapse all' : 'Expand all'));
  nav.replaceChildren(...chips);

  // second row: subcategories of the selected category
  const subNav = $('#subgroups');
  const inCat = filterCat === null ? [] : all.filter((i) => catOf(i) === filterCat);
  const subs = [...new Set(inCat.map(subOf))].filter(Boolean);
  if (filterSub !== null && !subs.includes(filterSub) && !(filterSub === '' && inCat.some((i) => !subOf(i)))) filterSub = null;
  if (!subs.length) { subNav.replaceChildren(); return; }
  const mks = (label, value, n) => h('button', { class: `chip sub${filterSub === value ? ' on' : ''}`, onclick: () => { filterSub = value; render(); } }, label, h('small', {}, n));
  const other = inCat.filter((i) => !subOf(i));
  subNav.replaceChildren(h('span', { class: 'sub-lbl' }, `${filterCat}:`), mks('All', null, inCat.length),
    ...subs.map((s) => mks(s, s, inCat.filter((i) => subOf(i) === s).length)), other.length ? mks('Other', '', other.length) : null);
}

function renderEditbar() {
  const bar = $('#editbar');
  bar.hidden = !editing;
  if (!editing) return;
  bar.replaceChildren(
    h('span', { class: 'lbl', title: 'Rename items, pick a category, click an icon to change it, set the step and low-stock level.' }, ic('edit'), 'Edit mode'),
    h('button', { class: 'btn small primary', id: 'eb-add', onclick: addItem, title: 'Ctrl+N' }, ic('plus'), 'Add item'),
    h('button', { class: 'btn small', id: 'eb-import', onclick: importCsv }, ic('upload'), 'Import CSV'),
    h('button', { class: 'btn small', id: 'eb-clear-ordered', onclick: () => bulk('ordered') }, ic('check'), 'Clear all “Ordered”'),
    h('button', { class: 'btn small danger', id: 'eb-zero', onclick: () => bulk('qty') }, 'Set all quantities to 0'));
}

function renderFoot(items) {
  const units = items.reduce((n, i) => n + i.qty, 0);
  const ordered = items.filter((i) => i.ordered).length;
  const low = items.filter((i) => lvl(i) !== 'ok').length;
  $('#totals').replaceChildren(
    h('span', {}, h('b', {}, items.length), ' items'), h('span', {}, h('b', {}, units), ' units'),
    h('span', {}, h('b', {}, ordered), ' ordered'), low ? h('span', { class: 'warn' }, h('b', {}, low), ' low / out') : null);
  $('#hints').replaceChildren(
    h('span', {}, h('kbd', {}, '↑'), h('kbd', {}, '↓'), ' select'), h('span', {}, h('kbd', {}, '+'), h('kbd', {}, '−'), ' change'),
    h('span', {}, h('kbd', {}, 'Space'), ' ordered'), h('span', {}, h('kbd', {}, 'Enter'), ' set qty'), h('span', {}, h('kbd', {}, '?'), ' all keys'));
}

let listIconMode = null;
function render() {
  if (!state) return;
  $('#listName').textContent = state.server.name || 'Stock';
  const local = state.mode === 'local';
  if (listIconMode !== local) { listIconMode = local; $('#listIcon').innerHTML = svgIcon(local ? 'pc2' : 'server'); }
  $('.list-btn').title = local ? 'The stock list on this PC (Just this PC)' : 'The stock list on your Inventru server';
  $('#dashBtn').hidden = !state.connected || state.mode !== 'server';
  $('#connect').hidden = state.connected;
  $('#app').hidden = !state.connected;
  if (!state.connected) { renderConnect(); return; }
  renderSync(state.status);
  renderCats();
  renderEditbar();
  document.body.classList.toggle('editing', editing);
  $('#editBtn').setAttribute('aria-pressed', editing ? 'true' : 'false');
  $('#editBtn .t').textContent = editing ? 'Done' : 'Edit';

  const items = shownItems();
  const secs = sections(items);
  const showHeaders = secs.length > 1 || (secs.length === 1 && secs[0].cat);
  const seq = [];
  const wantRows = new Set();
  const wantCats = new Set();
  const wantSubs = new Set();
  const units = (its) => its.reduce((n, i) => n + i.qty, 0);
  for (const s of secs) {
    const catClosed = showHeaders && isCollapsed(s.cat);
    if (showHeaders) {
      let g = catEls.get(s.cat);
      if (!g) {
        g = h('div', { class: 'group-row', 'data-cat': s.cat, role: 'button', 'aria-expanded': 'true', title: 'Click to collapse / expand' },
          h('span', { class: 'drag', title: 'Drag to move this whole category', html: svgIcon('grip') }),
          h('span', { class: 'chev', html: svgIcon('chevron') }),
          h('button', { class: 'gi', tabindex: '-1' }), h('span', { class: 'gname' }), h('small'),
          h('button', { class: 'ib cat-rename', tabindex: '-1', title: 'Rename this category', html: svgIcon('edit') }));
        catEls.set(s.cat, g);
      }
      const gi = $('.gi', g); const gk = catIcon(s.cat, s.items);
      if (gi.dataset.icon !== gk) { gi.innerHTML = iconMarkup(gk); gi.dataset.icon = gk; }
      gi.title = editing && s.cat ? 'Change the icon for this category (its items use it too)' : '';
      $('.gname', g).textContent = s.cat || 'No category';
      const lowN = s.items.filter((i) => lvl(i) !== 'ok').length;
      $('small', g).textContent = `${s.items.length} items · ${units(s.items)} units${catClosed && lowN ? ` · ${lowN} low / out` : ''}`;
      $('.cat-rename', g).hidden = !editing || !s.cat;
      $('.drag', g).hidden = !editing;
      g.classList.toggle('closed', catClosed);
      g.setAttribute('aria-expanded', catClosed ? 'false' : 'true');
      seq.push(g); wantCats.add(s.cat);
    }
    if (catClosed) continue;
    const hasSubs = s.subs.some((x) => x.sub);
    for (const ss of s.subs) {
      const subClosed = hasSubs && ss.sub && isCollapsed(s.cat, ss.sub);
      if (hasSubs && ss.sub) {
        const k = `${s.cat}\u0001${ss.sub}`;
        let sh = subEls.get(k);
        if (!sh) {
          sh = h('div', { class: 'sub-row', 'data-cat': s.cat, 'data-sub': ss.sub, role: 'button', title: 'Click to collapse / expand' },
            h('span', { class: 'chev', html: svgIcon('chevron') }), h('span', { class: 'sname' }), h('small'),
            h('button', { class: 'ib sub-rename', tabindex: '-1', title: 'Rename this subcategory', html: svgIcon('edit') }));
          subEls.set(k, sh);
        }
        $('.sname', sh).textContent = ss.sub;
        $('small', sh).textContent = `${ss.items.length} · ${units(ss.items)} units`;
        $('.sub-rename', sh).hidden = !editing;
        sh.classList.toggle('closed', !!subClosed);
        sh.setAttribute('aria-expanded', subClosed ? 'false' : 'true');
        seq.push(sh);
        wantSubs.add(k);
      }
      if (subClosed) continue;
      for (const it of ss.items) {
        let el = rowEls.get(it.id);
        if (!el) { el = makeRow(it.id); rowEls.set(it.id, el); }
        el.classList.toggle('in-sub', hasSubs && !!ss.sub);
        updateRow(el, it);
        seq.push(el); wantRows.add(it.id);
      }
    }
  }
  for (const [id, el] of rowEls) if (!wantRows.has(id)) { el.remove(); rowEls.delete(id); }
  for (const [g, el] of catEls) if (!wantCats.has(g)) { el.remove(); catEls.delete(g); }
  for (const [k, el] of subEls) if (!wantSubs.has(k)) { el.remove(); subEls.delete(k); }
  seq.forEach((node, i) => { if (rowsEl.children[i] !== node) rowsEl.insertBefore(node, rowsEl.children[i] || null); });
  while (rowsEl.children.length > seq.length) rowsEl.lastChild.remove();

  if (!wantRows.has(sel)) { const first = flatRows()[0]; sel = first ? first.id : null; }
  for (const [id, el] of rowEls) el.classList.toggle('sel', id === sel);

  const empty = $('#empty');
  if (!items.length) {
    empty.hidden = false;
    if (query || filterCat !== null) empty.replaceChildren(h('h2', {}, 'No matches'), h('p', {}, 'Try a different search or category.'));
    else if (state.status.state === 'error') empty.replaceChildren(h('h2', {}, state.mode === 'local' ? 'The list could not be opened' : 'Server problem'), h('p', {}, state.status.error));
    else if (state.status.state === 'offline' && !state.status.everSynced) empty.replaceChildren(h('h2', {}, 'Offline'), h('p', {}, state.status.error || 'Waiting for connection…'));
    else empty.replaceChildren(h('h2', {}, state.status.everSynced ? 'No items yet' : 'Loading…'), h('p', {}, state.status.everSynced ? 'Press Edit, then Add item (or Import CSV).' : ''));
  } else empty.hidden = true;
  renderFoot(items);

  if (pendingFocus && rowEls.has(pendingFocus.id)) {
    const id = pendingFocus.id; pendingFocus = null;
    select(id);
    const inp = $('.in-name', rowEls.get(id)); inp.focus(); inp.select();
  }
}

function applyUi(ui) {
  const r = document.documentElement;
  r.dataset.theme = ui.theme; r.dataset.density = ui.density;
  r.style.setProperty('--accent', ui.accent);
  r.style.fontSize = `${16 * ui.fontScale}px`;
}

function setState(s) {
  const first = !state;
  state = s; applyUi(s.ui);
  CUSTOM_ICONS = new Map((s.customIcons || []).map((c) => [c.id, c]));
  if (first) loadCollapsed();
  if (window.dnd && window.dnd.active()) return; // don't re-order the DOM under a drag; it re-renders on drop
  render();
}

// ---------------------------------------------------------------- actions
function select(id, scroll = true) {
  sel = id;
  for (const [i, el] of rowEls) el.classList.toggle('sel', i === id);
  if (scroll && id && rowEls.has(id)) rowEls.get(id).scrollIntoView({ block: 'nearest' });
}

const item = (id) => state.items.find((i) => i.id === id);

function step(id, dir, big) {
  const it = item(id); const el = rowEls.get(id);
  if (!it || !el) return;
  // In edit mode the Step field is the truth (it may have been typed a moment ago and not saved yet).
  const typed = editing ? parseInt($('.in-step', el).value, 10) : NaN;
  const stepSize = typed >= 1 ? typed : it.step;
  const delta = dir * stepSize * (big ? 10 : 1);
  if (delta < 0 && it.qty === 0) { const b = $('.c-minus', el); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); return; }
  it.qty = Math.max(0, it.qty + delta); it.pending = true; // optimistic
  updateRow(el, it);
  renderFoot(shownItems());
  window.api.tap(id, delta);
}

function toggleOrdered(id) {
  const it = item(id); const el = rowEls.get(id);
  if (!it || !el) return;
  it.ordered = !it.ordered; it.pending = true;
  updateRow(el, it); renderFoot(shownItems());
  window.api.setOrdered(id, it.ordered);
}

function editQty(id) {
  const it = item(id); const el = rowEls.get(id);
  if (!it || !el || qtyEditing) return;
  select(id);
  qtyEditing = id;
  const btn = $('.c-qty', el);
  const input = h('input', { class: 'in-qty', value: String(it.qty), inputmode: 'numeric', 'aria-label': 'Quantity', title: 'Type a number, or +5 / -3 to add / remove. Enter to save, Esc to cancel.' });
  let done = false;
  const finish = (commit) => {
    if (done) return; done = true;
    qtyEditing = null; input.remove(); btn.hidden = false;
    if (commit) {
      const v = input.value.trim();
      if (/^[+-]\d+$/.test(v)) { const d = parseInt(v, 10); if (d) { it.qty = Math.max(0, it.qty + d); window.api.tap(id, d); } }
      else if (/^\d+$/.test(v)) { const n = parseInt(v, 10); if (n !== it.qty) { it.qty = n; window.api.setExact(id, n); } }
      else if (v) toast('Type a number (or +5 / -3)');
    }
    render(); listEl.focus({ preventScroll: true });
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); finish(true); moveSel(e.key === 'ArrowUp' ? -1 : 1); }
  });
  input.addEventListener('blur', () => finish(true));
  btn.hidden = true;
  btn.after(input);
  input.focus(); input.select();
}

function moveSel(d, to) {
  const rows = flatRows();
  if (!rows.length) return;
  let i = rows.findIndex((r) => r.id === sel);
  i = to === 'home' ? 0 : to === 'end' ? rows.length - 1 : Math.min(rows.length - 1, Math.max(0, (i < 0 ? 0 : i) + d));
  select(rows[i].id);
}

async function guarded(fn) {
  try { return await fn(); } catch (err) { toast(errText(err)); return null; }
}

async function addItem() {
  if (!(await ensureEditable())) return;
  query = ''; $('#search').value = '';
  const r = await guarded(() => window.api.addItem({ name: 'New item', group: filterCat || '', sub: (filterCat && filterSub) || '' }));
  if (r && r.ok) pendingFocus = { id: r.id };
}

async function deleteItem(id) {
  const it = item(id); if (!it) return;
  if (!(await confirmDialog(`Delete "${it.name}"?`, 'This removes it from the stock list for everyone. Use the eye button to hide it on this PC instead if you may want it back.', 'Delete', true))) return;
  const rows = flatRows(); const i = rows.findIndex((r) => r.id === id);
  const r = await guarded(() => window.api.deleteItem(id));
  if (!r) return;
  const next = rows[i + 1] || rows[i - 1]; sel = next ? next.id : null;
  toast(`Deleted "${it.name}"`);
}

function move(id, dir) {
  const rows = flatRows(); const it = item(id);
  const same = rows.filter((r) => catOf(r) === catOf(it) && subOf(r) === subOf(it));
  const i = same.findIndex((r) => r.id === id); const other = same[i + dir];
  if (!other) return;
  const ids = state.items.map((x) => x.id);
  const a = ids.indexOf(id); const b = ids.indexOf(other.id);
  [ids[a], ids[b]] = [ids[b], ids[a]];
  guarded(() => window.api.reorder(ids));
}

/** field: 'group' (category) or 'sub' (subcategory). value may be NEW_CAT to ask for a new name. */
async function setCategory(id, value, selEl, field = 'group') {
  let v = value;
  const it = item(id);
  if (value === NEW_CAT) {
    v = field === 'sub'
      ? await promptDialog('New subcategory', `Inside "${catOf(it) || 'No category'}". For example: New, Used, Refurbished, Wireless, 24 inch.`, '', 'Create')
      : await promptDialog('New category', 'For example: Mice, Keyboards, Monitors, Laptops, Cables.', '', 'Create');
    if (v === null || v === '') { if (selEl) { selEl.dataset.sig = ''; render(); } return; }
  }
  const r = await guarded(() => window.api.setField(id, field, v));
  if (!r) { if (selEl) { selEl.dataset.sig = ''; render(); } return; }
  // Keep the item on screen: if a filter would hide it now, follow it to its new place.
  if (field === 'group' && filterCat !== null && filterCat !== v) { filterCat = v; filterSub = null; }
  if (field === 'sub' && filterSub !== null && filterSub !== v) filterSub = v;
  if (it) { it[field] = v; } // optimistic until the pushed state arrives
  select(id);
  render();
  toast(field === 'sub' ? (v ? `Subcategory: ${v}` : 'Subcategory removed') : (v ? `Category: ${v}` : 'Category removed'));
}

async function renameCategory(from) {
  const to = await promptDialog(`Rename "${from}"`, 'Every item in this category is moved to the new name.', from, 'Rename');
  if (to === null || to === '' || to === from) return;
  const r = await guarded(() => window.api.renameCategory(from, to));
  if (r) { if (filterCat === from) filterCat = to; toast(`Renamed category (${r.count} items)`); }
}

async function renameSubcategory(cat, from) {
  const to = await promptDialog(`Rename "${from}"`, `Every item in "${cat}" › "${from}" is moved to the new name.`, from, 'Rename');
  if (to === null || to === '' || to === from) return;
  const r = await guarded(() => window.api.renameSubcategory(cat, from, to));
  if (r) { if (filterSub === from) filterSub = to; toast(`Renamed subcategory (${r.count} items)`); }
}

/**
 * Icon picker for an item or a category.
 *   target = { kind: 'item', id }  or  { kind: 'cat', cat }
 * Items default to their category's icon; categories default to an icon guessed from the name.
 */
function pickIcon(target) {
  const isCat = target.kind === 'cat';
  const it = isCat ? null : item(target.id);
  if (!isCat && !it) return;
  const current = isCat ? catIconSet(target.cat) : it.icon;
  const autoKey = isCat ? (guessIcon(target.cat) || 'tag') : autoIconOf(it);
  const autoLabel = isCat ? 'Automatic' : (catOf(it) ? `Same as “${catOf(it)}”` : 'Automatic');
  let m;
  const choose = async (icon) => {
    m.close();
    if (isCat) await guarded(() => window.api.setCategoryIcon(target.cat, icon));
    else await guarded(() => window.api.setMeta(target.id, { icon }));
  };
  const opt = (key, label, on, extra) => h('button', { class: `icon-opt${on ? ' on' : ''}`, title: label, 'data-icon': key, onclick: () => choose(key) },
    h('span', { class: 'i', html: iconMarkup(key || autoKey) }), h('small', {}, label), extra || null);
  const custom = [...CUSTOM_ICONS.values()];
  const fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,.svg', hidden: true,
    onchange: async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) { m.close(); await addOwnIcon(f); pickIcon(target); } } });
  m = modal([
    h('h3', {}, isCat ? `Icon for the “${target.cat}” category` : `Icon for “${it.name}”`),
    h('p', { class: 'sub' }, isCat
      ? 'Every item in this category shows this icon, unless you give an item its own.'
      : 'By default an item shows its category’s icon. Pick one here to give this item its own.'),
    h('div', { class: 'icon-grid' },
      opt('', autoLabel, !current),
      ...ITEM_ICONS.map((k) => opt(k, k, current === k))),
    h('h4', { class: 'icon-sec' }, 'Your icons'),
    h('div', { class: 'icon-grid' },
      ...custom.map((c) => opt(c.id, c.name, current === c.id,
        h('span', { class: 'del', title: `Delete “${c.name}”`, role: 'button', onclick: async (e) => {
          e.stopPropagation();
          if (!(await confirmDialog(`Delete the “${c.name}” icon?`, 'Items and categories using it go back to their automatic icon.', 'Delete', true))) return;
          m.close(); await guarded(() => window.api.deleteIcon(c.id)); pickIcon(target);
        } }, '×'))),
      h('button', { class: 'icon-opt add', id: 'addIconBtn', title: 'PNG, JPG, GIF, WebP or SVG', onclick: () => fileIn.click() },
        h('span', { class: 'i', html: svgIcon('plus') }), h('small', {}, 'Add your own…')), fileIn),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'))], { wide: true });
}

/** Read an image file, shrink raster images to 64x64, store it as a custom icon. */
async function addOwnIcon(file) {
  try {
    let data;
    if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
      const text = await file.text();
      data = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}`;
    } else {
      // read as a data: URL (blob: URLs are blocked by the app's Content-Security-Policy)
      const url = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(new Error('could not read the file')); fr.readAsDataURL(file); });
      if (!/^data:image\//.test(url)) throw new Error('not an image');
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('not an image')); i.src = url; });
      const c = document.createElement('canvas'); c.width = 64; c.height = 64;
      const k = Math.min(64 / img.width, 64 / img.height);
      const w = img.width * k; const hh = img.height * k;
      c.getContext('2d').drawImage(img, (64 - w) / 2, (64 - hh) / 2, w, hh);
      data = c.toDataURL('image/png');
    }
    const name = file.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Icon';
    const r = await guarded(() => window.api.addIcon(name, data));
    if (r && r.ok) toast(`Added icon “${name}”`); else if (r) toast(r.error);
  } catch (e) { toast(`Could not use that file: ${e.message}`); }
}

async function bulk(kind) {
  const label = kind === 'qty' ? 'Set every quantity to 0?' : 'Clear every “Ordered” flag?';
  if (!(await confirmDialog(label, 'You can undo this straight afterwards (Ctrl+Z).', 'Yes, do it', true))) return;
  const snap = await guarded(() => (kind === 'qty' ? window.api.resetQuantities() : window.api.resetOrdered()));
  if (!snap) return;
  const n = kind === 'qty' ? Object.keys(snap.qty).length : snap.ordered.length;
  lastUndo = { snap };
  toast(kind === 'qty' ? `${n} quantities set to 0` : `${n} “Ordered” flags cleared`, { label: 'Undo', onClick: undo });
}

async function undo() {
  if (!lastUndo) return;
  const snap = lastUndo.snap; lastUndo = null;
  await guarded(() => window.api.restore(snap));
  toast('Restored');
}

async function exportCsv() {
  const r = await guarded(() => window.api.exportList());
  if (r && r.ok) toast(`Exported ${r.count} items`);
}

async function importCsv() {
  const r = await guarded(() => window.api.importList());
  if (r && r.ok) toast(`Imported: ${r.added} new, ${r.updated} updated`);
  else if (r && r.error) toast(r.error);
}

/** Edit mode needs the PIN (only if one is set). */
async function ensureEditable() {
  if (!(await window.api.pinRequired('edit'))) return true;
  return askPin('edit');
}

async function toggleEdit() {
  if (!editing && !(await ensureEditable())) return;
  editing = !editing;
  if (!editing) window.api.lock('edit');
  render();
  listEl.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- auto-lock after inactivity
const IDLE_LOCK_MS = 5 * 60 * 1000;
let lastActivity = Date.now();
for (const ev of ['pointerdown', 'keydown', 'wheel']) document.addEventListener(ev, () => { lastActivity = Date.now(); }, true);
function idleCheck() {
  if (!state || !state.pinSet || Date.now() - lastActivity < IDLE_LOCK_MS) return;
  if (!$('#settings').hidden) { window.closeSettings(true); toast('Settings locked after 5 minutes without use'); }
  if (editing) { editing = false; window.api.lock('edit'); render(); toast('Edit mode locked after 5 minutes without use'); }
}
setInterval(idleCheck, 15000);

// ---------------------------------------------------------------- help + PIN
function openHelp() {
  if (modalOpen()) return;
  const k = (...keys) => h('dt', {}, keys.map((x, i) => [i ? ' / ' : '', h('kbd', {}, x)]));
  const m = modal([h('h3', {}, 'Keyboard shortcuts'), h('dl', { class: 'keys' },
    h('h4', {}, 'Moving around'), k('↑', '↓'), h('dd', {}, 'Select previous / next item'), k('PgUp', 'PgDn'), h('dd', {}, 'Jump 10 items'), k('Home', 'End'), h('dd', {}, 'First / last item'),
    k('/', 'Ctrl+F'), h('dd', {}, 'Search (Esc clears)'), k('[', ']'), h('dd', {}, 'Previous / next category'),
    k('C'), h('dd', {}, 'Collapse / expand the selected item’s category (or click a heading)'), k('Shift+C'), h('dd', {}, 'Collapse / expand all categories'),
    h('h4', {}, 'Changing stock'), k('→', '+'), h('dd', {}, 'Add one step (Shift = ×10)'), k('←', '-'), h('dd', {}, 'Remove one step (Shift = ×10)'),
    k('Enter', 'F2'), h('dd', {}, 'Type a quantity (or +5 / -3)'), k('Space', 'O'), h('dd', {}, 'Toggle Ordered'), k('Ctrl+Z'), h('dd', {}, 'Undo the last “clear all” / “set all to 0”'),
    k('Ctrl+S'), h('dd', {}, 'Export to CSV (Excel)'), k('F5'), h('dd', {}, 'Sync now'),
    h('h4', {}, 'Editing'), k('Ctrl+E'), h('dd', {}, 'Edit mode on / off'), k('Ctrl+N', 'Insert'), h('dd', {}, 'Add item (edit mode)'), k('Del'), h('dd', {}, 'Delete selected (edit mode)'),
    k('Alt+↑', 'Alt+↓'), h('dd', {}, 'Move item (edit mode) - or drag it by its ⋮⋮ handle, also into another category'), k('Tab'), h('dd', {}, 'Next field while editing'), k('Ctrl+,'), h('dd', {}, 'Settings')),
  h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => m.close() }, 'Close'))], { wide: true });
}

function askPin(scope = 'edit') {
  return new Promise((resolve) => {
    let pin = '';
    const dots = h('div', { class: 'pin-dots' }); const err = h('div', { class: 'pin-err' });
    const paint = () => dots.replaceChildren(...[...pin].map(() => h('i')));
    let m;
    const submit = async () => {
      if (pin.length < 4) { err.textContent = 'At least 4 digits'; return; }
      const r = await window.api.unlock(pin, scope);
      if (r.ok) { resolve(true); m.close(true); return; }
      err.textContent = r.error; pin = ''; paint();
    };
    const key = (k) => { if (k === '⌫') pin = pin.slice(0, -1); else if (k === 'C') pin = ''; else if (pin.length < 8) pin += k; err.textContent = ''; paint(); };
    const typed = (e) => { // physical keyboard
      if (/^\d$/.test(e.key)) { key(e.key); e.preventDefault(); } else if (e.key === 'Backspace') { key('⌫'); e.preventDefault(); } else if (e.key === 'Enter') { e.preventDefault(); submit(); }
    };
    m = modal([h('h3', {}, 'Enter PIN'), h('p', { class: 'sub' }, scope === 'settings' ? 'Settings are locked.' : 'Edit mode is locked.'), dots, err, numpad(key),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: submit }, 'Unlock'))],
    { onClose: () => { document.removeEventListener('keydown', typed, true); resolve(false); } });
    document.addEventListener('keydown', typed, true);
  });
}

/** Settings always asks for the PIN when one is set - even if Edit mode was just unlocked. */
async function openSettingsFlow() {
  if (await window.api.pinRequired('settings') && !(await askPin('settings'))) return;
  window.openSettings();
}

// ---------------------------------------------------------------- first run: connect to a server, or just this PC
let connectDrawn = false;
function renderConnect() {
  if (connectDrawn) return;
  connectDrawn = true;
  const addr = h('input', { class: 'input', id: 'cAddr', placeholder: 'e.g. STOCK-VM', autocomplete: 'off', spellcheck: 'false', autofocus: true });
  const code = h('input', { class: 'input code', id: 'cCode', placeholder: '123 456', inputmode: 'numeric', autocomplete: 'off', maxlength: 7 });
  const msg = h('div', { class: 'cmsg' });
  const btn = h('button', { class: 'btn primary big', id: 'cGo', type: 'submit' }, 'Connect');
  const go = async (e) => {
    e.preventDefault();
    btn.disabled = true; msg.className = 'cmsg'; msg.textContent = 'Connecting…';
    const r = await window.api.connect(addr.value, code.value).catch((err) => ({ ok: false, error: errText(err) }));
    btn.disabled = false;
    if (r.ok) { msg.textContent = ''; connectDrawn = false; toast(`Connected to ${r.name}`); }
    else { msg.className = 'cmsg err'; msg.textContent = r.error; }
  };
  const local = h('button', { class: 'btn big', id: 'cLocal', type: 'button', onclick: async () => {
    local.disabled = true; msg.className = 'cmsg'; msg.textContent = '';
    const r = await window.api.useLocal().catch((err) => ({ ok: false, error: errText(err) }));
    local.disabled = false;
    if (r.ok) { connectDrawn = false; toast('Inventru is ready - the list is kept on this PC'); }
    else { msg.className = 'cmsg err'; msg.textContent = r.error; }
  } }, ic('pc2'), 'Just this PC');
  $('#connect').replaceChildren(h('form', { class: 'connect-card', onsubmit: go },
    h('div', { class: 'cicon', html: svgIcon('server') }),
    h('h1', {}, 'Connect to your Inventru server'),
    h('p', { class: 'sub' }, 'The server’s setup page shows its name and a 6-digit pairing code. To open that page, double-click InventruServer on the server.'),
    h('label', {}, 'Server', addr),
    h('label', {}, 'Pairing code', code),
    btn, msg,
    h('div', { class: 'or' }, 'or'),
    local,
    h('p', { class: 'hint' }, 'No server? Choose Just this PC: the stock list is saved on this PC only, with no TV dashboard. You can connect to a server later in Settings.')));
  setTimeout(() => addr.focus(), 50);
}

// ---------------------------------------------------------------- events
rowsEl.addEventListener('click', (e) => {
  if (window.dnd && window.dnd.justDropped()) return; // the click that ends a drag
  const cat = e.target.closest('.cat-rename');
  if (cat) { renameCategory(cat.closest('.group-row').dataset.cat); return; }
  const subR = e.target.closest('.sub-rename');
  if (subR) { const sr = subR.closest('.sub-row'); renameSubcategory(sr.dataset.cat, sr.dataset.sub); return; }
  const gi = e.target.closest('.group-row .gi');
  if (gi && editing && gi.closest('.group-row').dataset.cat) { pickIcon({ kind: 'cat', cat: gi.closest('.group-row').dataset.cat }); return; }
  const hdr = e.target.closest('.group-row, .sub-row');
  if (hdr && !e.target.closest('.drag')) {
    if (hdr.classList.contains('group-row')) toggleCollapse(hdr.dataset.cat); else toggleCollapse(hdr.dataset.cat, hdr.dataset.sub);
    listEl.focus({ preventScroll: true });
    return;
  }
  const row = e.target.closest('.row'); if (!row) return;
  const id = row.dataset.id;
  select(id, false);
  const on = (c) => e.target.closest(c);
  if (on('.c-plus')) step(id, +1, e.shiftKey);
  else if (on('.c-minus')) step(id, -1, e.shiftKey);
  else if (on('.c-ord')) toggleOrdered(id);
  else if (on('.c-qty')) editQty(id);
  else if (on('.ico') && editing) pickIcon({ kind: 'item', id });
  else if (on('.e-up')) move(id, -1);
  else if (on('.e-down')) move(id, +1);
  else if (on('.e-hide')) guarded(() => window.api.setMeta(id, { hidden: !item(id).hidden }));
  else if (on('.e-del')) deleteItem(id);
  if (e.target.closest('button')) listEl.focus({ preventScroll: true }); // keep the keyboard on the list
});
rowsEl.addEventListener('dblclick', (e) => { const row = e.target.closest('.row'); if (row && !e.target.closest('button, input, select')) editQty(row.dataset.id); });

rowsEl.addEventListener('change', async (e) => {
  const inp = e.target; const f = inp.dataset.f; const row = inp.closest('.row');
  if (!f || !row) return;
  const id = row.dataset.id; const it = item(id);
  if (f === 'name') {
    if (!inp.value.trim()) { inp.value = it.name; return; }
    await guarded(() => window.api.setField(id, 'name', inp.value));
  } else if (f === 'group') await setCategory(id, inp.value, inp, 'group');
  else if (f === 'sub') await setCategory(id, inp.value, inp, 'sub');
  else if (f === 'step') await guarded(() => window.api.setMeta(id, { step: inp.value }));
  else if (f === 'low') await guarded(() => window.api.setMeta(id, { lowThreshold: inp.value }));
});
rowsEl.addEventListener('input', (e) => { // step / low take effect immediately, before the field loses focus
  const inp = e.target; const f = inp.dataset && inp.dataset.f; const row = inp.closest('.row');
  if (!row || (f !== 'step' && f !== 'low')) return;
  const it = item(row.dataset.id); if (!it) return;
  if (f === 'step') { const n = parseInt(inp.value, 10); if (n >= 1) it.step = n; }
  else { const n = parseInt(inp.value, 10); it.low = inp.value === '' ? null : (n >= 0 ? n : it.low); row.dataset.level = lvl(it); }
});
rowsEl.addEventListener('keydown', (e) => { // inside edit-mode fields
  const inp = e.target; if (!inp.dataset || !inp.dataset.f) return;
  if (e.key === 'Enter' && inp.tagName !== 'SELECT') { e.preventDefault(); inp.blur(); listEl.focus({ preventScroll: true }); }
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); inp.blur(); listEl.focus({ preventScroll: true }); }
});

$('#search').addEventListener('input', (e) => { query = e.target.value; render(); });
$('#search').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.target.value = ''; query = ''; render(); listEl.focus({ preventScroll: true }); e.stopPropagation(); }
  else if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); listEl.focus({ preventScroll: true }); }
});
$('#editBtn').addEventListener('click', toggleEdit);
$('#exportBtn').addEventListener('click', exportCsv);
$('#dashBtn').addEventListener('click', () => guarded(() => window.api.openDashboard()));
$('#helpBtn').addEventListener('click', openHelp);
$('#gear').addEventListener('click', openSettingsFlow);
const syncNow = () => { window.api.syncNow(); toast(state && state.status.error ? state.status.error : state && state.mode === 'local' ? 'Saved on this PC' : 'Syncing…'); };
$('#sync').addEventListener('click', syncNow);
listEl.addEventListener('pointerdown', (e) => { if (!e.target.closest('input, button, select')) listEl.focus({ preventScroll: true }); });
document.addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener('keydown', (e) => {
  if (!state || modalOpen() || !$('#settings').hidden || e.defaultPrevented) return;
  const t = e.target;
  const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key;

  if (ctrl && !e.altKey) {
    const k = key.toLowerCase();
    if (k === 'e') { e.preventDefault(); toggleEdit(); return; }
    if (k === ',') { e.preventDefault(); openSettingsFlow(); return; }
    if (k === 'f') { e.preventDefault(); $('#search').focus(); $('#search').select(); return; }
    if (k === 's') { e.preventDefault(); exportCsv(); return; }
    if (k === 'n' && editing) { e.preventDefault(); addItem(); return; }
    if (k === 'z' && !typing) { e.preventDefault(); undo(); return; }
  }
  if (key === 'F5') { e.preventDefault(); syncNow(); return; }
  if (typing) return;

  if (key === 'ArrowUp' && e.altKey && editing && sel) { e.preventDefault(); move(sel, -1); return; }
  if (key === 'ArrowDown' && e.altKey && editing && sel) { e.preventDefault(); move(sel, +1); return; }
  if (ctrl || e.altKey) return;

  const act = (fn) => { e.preventDefault(); fn(); };
  switch (key) {
    case 'ArrowDown': return act(() => moveSel(1));
    case 'ArrowUp': return act(() => moveSel(-1));
    case 'PageDown': return act(() => moveSel(10));
    case 'PageUp': return act(() => moveSel(-10));
    case 'Home': return act(() => moveSel(0, 'home'));
    case 'End': return act(() => moveSel(0, 'end'));
    case 'ArrowRight': case '+': case '=': return sel && act(() => step(sel, +1, e.shiftKey));
    case 'ArrowLeft': case '-': case '_': return sel && act(() => step(sel, -1, e.shiftKey));
    case ' ': case 'o': case 'O': return sel && act(() => toggleOrdered(sel));
    case 'Enter': case 'F2': return sel && act(() => (editing && key === 'F2' ? $('.in-name', rowEls.get(sel)).focus() : editQty(sel)));
    case 'c': case 'C': return act(() => {
      if (e.shiftKey) { setAllCollapsed(sections(shownItems()).some((s) => !collapsed.has(ckey(s.cat)))); return; }
      const it = sel && item(sel); if (!it) return;
      toggleCollapse(catOf(it));
    });
    case '/': return act(() => { $('#search').focus(); $('#search').select(); });
    case '?': return act(openHelp);
    case 'Escape': if (query) { query = ''; $('#search').value = ''; render(); } else if (editing) toggleEdit(); return;
    case 'Insert': if (editing) act(addItem); return;
    case 'Delete': if (editing && sel) act(() => deleteItem(sel)); return;
    case '[': case ']': return act(() => {
      const names = [null, ...new Set(allVisible().map(catOf).filter(Boolean))];
      if (names.length < 2) return;
      const i = names.indexOf(filterCat);
      filterCat = names[(i + (key === ']' ? 1 : -1) + names.length) % names.length];
      render();
    });
    default:
  }
});

// ---------------------------------------------------------------- boot
{
  const saved = store.get('cat');
  filterCat = saved && saved.startsWith('=') ? saved.slice(1) : null;
  $('#gear').innerHTML = svgIcon('gear');
  $('#helpBtn').innerHTML = svgIcon('help');
  $('#exportBtn').innerHTML = svgIcon('download');
  $('#dashBtn').prepend(ic('tv'));
  $('#editBtn').prepend(ic('edit'));
  $('#searchIcon').innerHTML = svgIcon('search');
}
window.api.onState(setState);
window.api.getState().then(setState);
setInterval(() => state && renderSync(state.status), 30000);
listEl.focus();
