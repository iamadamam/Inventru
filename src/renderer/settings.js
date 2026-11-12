'use strict';
/* Settings: the server connection, appearance, and this PC (PIN, start with Windows, keep awake). */

const COLORS = ['#4f8cff', '#06b6d4', '#10b981', '#84cc16', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#8b5cf6', '#64748b'];

let S = null;        // { settings, server, pinSet, version, user }
let dirty = false;
const mark = () => { dirty = true; };
const sEl = () => document.getElementById('settings');

window.openSettings = async function openSettings() {
  try { S = await window.api.settingsGet(); } catch (e) { toast(errText(e)); return; }
  dirty = false;
  sEl().hidden = false;
  document.getElementById('app').inert = true;
  draw();
};

async function closeSettings(force) {
  if (sEl().hidden) return;
  if (dirty && !force && !(await confirmDialog('Discard changes?', 'You have unsaved changes in Settings.', 'Discard', true))) return;
  while ($('#modal-root').lastChild) $('#modal-root').lastChild.remove();
  sEl().hidden = true;
  document.getElementById('app').inert = false;
  window.api.lock('settings');
  if (state) applyUi(state.ui); // drop any unsaved appearance preview
  listEl.focus({ preventScroll: true });
}

function segmented(options, value, onPick) {
  const wrap = h('div', { class: 'seg', role: 'group' });
  const paint = (v) => wrap.replaceChildren(...options.map(([val, label]) => h('button', { type: 'button', class: val === v ? 'on' : '', 'data-val': val, onclick: () => { onPick(val); paint(val); mark(); } }, label)));
  paint(value);
  return wrap;
}
const toggle = (checked, onChange) => h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: checked ? true : null, onchange: (e) => { onChange(e.target.checked); mark(); } }));
const row = (label, sub, control) => h('div', { class: 'row2' }, h('div', { class: 'lbl' }, label, sub ? h('span', { class: 'sub' }, sub) : null), control);
const heading = (icon, title) => h('h2', {}, ic(icon), title);

// ---------------------------------------------------------------- where the list is kept: a server, or just this PC
const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;

function serverPanel() {
  const result = h('div');
  const show = (t, ok) => result.replaceChildren(h('div', { class: `msg ${ok ? 'ok' : 'err'}` }, t));
  const status = state.status;
  const local = S.mode === 'local';
  if (local) {
    return h('section', { class: 'panel', id: 'p-server' },
      heading('pc2', 'Stock list'),
      h('div', { class: 'srv' }, h('span', { class: 'i', html: svgIcon('pc2') }),
        h('div', {}, h('b', {}, 'Just this PC'), h('span', {}, status.state === 'error' ? status.error : `${plural(S.local.items, 'item')}, saved on this PC with a change log and daily backups`))),
      h('div', { class: 'row2' },
        h('button', { class: 'btn', id: 'openFolder', onclick: async () => { const r = await window.api.openLocalFolder(); if (!r.ok) show(r.error || 'Could not open the folder', false); } }, ic('archive'), 'Open the folder'),
        h('button', { class: 'btn', id: 'toServer', onclick: pairDialog }, ic('server'), 'Connect to a server…')),
      h('p', { class: 'hint' }, `Folder: ${S.local.folder}`),
      result);
  }
  const line = S.demo ? 'Demo mode - built-in sample list' : status.state === 'ok' ? 'Connected' : status.state === 'offline' ? 'Cannot reach the server right now (changes wait on this PC and are sent automatically)' : status.error || '';
  return h('section', { class: 'panel', id: 'p-server' },
    heading('server', 'Server'),
    h('div', { class: 'srv' }, h('span', { class: 'i', html: svgIcon('server') }),
      h('div', {}, h('b', {}, S.server.name || S.server.host || 'Not connected'), h('span', {}, `${S.server.host}${S.server.host ? ' · ' : ''}${line}`))),
    h('div', { class: 'row2' },
      h('button', { class: 'btn', id: 'testServer', onclick: async (e) => {
        const b = e.currentTarget; b.disabled = true; show('Checking…', true);
        const r = await window.api.testServer(); b.disabled = false; show(r.ok ? r.message : r.error, r.ok);
      } }, ic('refresh'), 'Check connection'),
      h('button', { class: 'btn', onclick: () => window.api.openDashboard() }, ic('tv'), 'Open the TV dashboard'),
      h('button', { class: 'btn', id: 'repair', onclick: pairDialog }, 'Pair again / other server'),
      S.demo ? null : h('button', { class: 'btn', id: 'toLocal', onclick: useLocal }, ic('pc2'), 'Use just this PC…')),
    result);

  function pairDialog() {
    const addr = h('input', { class: 'input wide', value: S.server.host, placeholder: 'e.g. STOCK-VM', spellcheck: 'false' });
    const code = h('input', { class: 'input wide', placeholder: '123 456', inputmode: 'numeric', maxlength: 7 });
    const err = h('div', { class: 'pin-err' });
    const note = local && S.local.items
      ? h('p', { class: 'sub' }, `If the server's list is empty, this PC's ${plural(S.local.items, 'item')} are copied to it. If the server already has items, its list is used and this PC's list is kept in its folder (to combine them, Export here and Import on the server).`)
      : null;
    const m = modal([h('h3', {}, 'Pair with the server'), h('p', { class: 'sub' }, 'Get a new pairing code on the server: double-click InventruServer there to open its setup page, and click "New code".'), note,
      h('div', { class: 'row2' }, h('div', { class: 'lbl' }, 'Server'), addr), h('div', { class: 'row2' }, h('div', { class: 'lbl' }, 'Pairing code'), code), err,
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', 'data-ok': '', onclick: async () => {
        err.textContent = 'Connecting…';
        const r = await window.api.connect(addr.value, code.value).catch((e) => ({ ok: false, error: errText(e) }));
        if (!r.ok) { err.textContent = r.error; return; }
        m.close();
        toast(r.copied ? `Connected to ${r.name} - copied ${plural(r.copied, 'item')} to it`
          : r.copied === 0 && local && S.local.items ? `Connected to ${r.name} - it already had a list, so that list is used` : `Connected to ${r.name}`);
        S = await window.api.settingsGet(); draw();
      } }, 'Connect'))]);
  }

  async function useLocal() {
    const n = state.items.length;
    const text = S.local.items
      ? `This PC goes back to its own list from before (${plural(S.local.items, 'item')}). `
      : `This PC keeps its own copy of the ${plural(n, 'item')} you see now. `;
    if (!(await confirmDialog('Use just this PC?', `${text}From then on its changes stay on this PC: the server's list, other PCs and the TV dashboard won't see them. To connect to the server again later you'll need a new pairing code.`, 'Use just this PC'))) return;
    const r = await window.api.useLocal().catch((e) => ({ ok: false, error: errText(e) }));
    if (!r.ok) { show(r.error, false); return; }
    toast(r.copied ? `Now using just this PC - copied ${plural(r.copied, 'item')}` : 'Now using just this PC');
    S = await window.api.settingsGet(); draw();
  }
}

// ---------------------------------------------------------------- appearance
function appearancePanel() {
  const st = S.settings;
  const sw = h('div', { class: 'swatches' });
  const preview = () => applyUi({ theme: st.theme, accent: st.accent, density: st.density, fontScale: Number(st.fontScale) });
  const paintSw = () => sw.replaceChildren(...COLORS.map((c) => { const b = h('button', { type: 'button', class: `sw${st.accent === c ? ' on' : ''}`, 'aria-label': c, onclick: () => { st.accent = c; mark(); paintSw(); preview(); } }, st.accent === c ? '✓' : ''); b.style.setProperty('--c', c); return b; }));
  paintSw();
  const fs = h('input', { type: 'range', min: 0.85, max: 1.6, step: 0.05, value: st.fontScale, oninput: (e) => { st.fontScale = Number(e.target.value); mark(); preview(); } });
  fs.style.width = '12rem';
  return h('section', { class: 'panel' },
    heading('eye', 'Appearance'),
    row('Theme', null, segmented([['dark', 'Dark'], ['light', 'Light'], ['auto', 'Follow Windows']], st.theme, (v) => { st.theme = v; preview(); })),
    row('Accent colour', null, sw),
    row('Row size', 'Touch makes rows and buttons large for a touchscreen', segmented([['compact', 'Compact'], ['comfortable', 'Comfortable'], ['touch', 'Touch']], st.density, (v) => { st.density = v; preview(); })),
    row('Text size', null, fs));
}

// ---------------------------------------------------------------- this PC + PIN
function systemPanel() {
  const st = S.settings;
  const btns = h('div', { class: 'row2' });
  const paintPin = () => btns.replaceChildren(
    h('button', { class: 'btn', onclick: askNewPin }, S.pinSet ? 'Change PIN' : 'Set PIN'),
    S.pinSet ? h('button', { class: 'btn danger', onclick: async () => { await window.api.setPin(null); S.pinSet = false; paintPin(); toast('PIN removed'); } }, 'Remove PIN') : null);
  function askNewPin() {
    let pin = '';
    const dots = h('div', { class: 'pin-dots' }); const err = h('div', { class: 'pin-err' });
    const paint = () => dots.replaceChildren(...[...pin].map(() => h('i')));
    const key = (k) => { if (k === '⌫') pin = pin.slice(0, -1); else if (k === 'C') pin = ''; else if (pin.length < 8) pin += k; err.textContent = ''; paint(); };
    const typed = (e) => { if (/^\d$/.test(e.key)) { key(e.key); e.preventDefault(); } else if (e.key === 'Backspace') { key('⌫'); e.preventDefault(); } };
    document.addEventListener('keydown', typed, true);
    const m = modal([h('h3', {}, 'New PIN'), h('p', { class: 'sub' }, '4 to 8 digits. Needed for Settings and Edit mode. Adding / removing stock and Ordered stay open to everyone.'), dots, err, numpad(key),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: async () => {
        const r = await window.api.setPin(pin);
        if (!r.ok) { err.textContent = r.error; return; }
        S.pinSet = true; m.close(); paintPin(); toast('PIN saved');
      } }, 'Save'))], { onClose: () => document.removeEventListener('keydown', typed, true) });
  }
  paintPin();
  return h('section', { class: 'panel' },
    heading('pc2', 'This PC'),
    row('PIN lock', S.pinSet ? 'On: Settings and Edit mode need the PIN and lock again after 5 minutes without use.' : 'Off: anyone can open Settings and Edit mode.', h('span')), btns,
    row('Start when I sign in to Windows', null, toggle(st.autostart, (v) => { st.autostart = v; })),
    row('Keep the screen awake', 'While the app is open', toggle(st.keepAwake, (v) => { st.keepAwake = v; })),
    h('p', { class: 'hint' }, `Inventru ${S.version}${S.demo ? ' · DEMO' : ''} · changes are recorded as ${S.user}`));
}

// ---------------------------------------------------------------- shell
function draw() {
  const saveBtn = h('button', { class: 'btn primary', id: 'settingsSave', onclick: async () => {
    saveBtn.disabled = true;
    const r = await window.api.settingsSave({ settings: S.settings }).catch((err) => ({ ok: false, error: errText(err) }));
    saveBtn.disabled = false;
    if (r.ok) { toast('Saved'); closeSettings(true); } else toast(r.error || 'Could not save');
  } }, ic('check'), 'Save');
  sEl().replaceChildren(
    h('div', { class: 'bar' }, h('h1', {}, 'Settings'), h('button', { class: 'btn', id: 'settingsClose', onclick: () => closeSettings(false) }, 'Close (Esc)'), saveBtn),
    h('div', { class: 'body' }, serverPanel(), appearancePanel(), systemPanel()));
  sEl().scrollTop = 0;
}

document.addEventListener('keydown', (e) => {
  if (sEl().hidden || modalOpen()) return;
  if (e.key === 'Escape') { e.preventDefault(); closeSettings(false); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); document.getElementById('settingsSave').click(); }
});
