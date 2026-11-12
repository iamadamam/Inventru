'use strict';
/*
 * Live stock dashboard (read-only). Gets the list from the server and updates instantly via Server-Sent Events.
 * URL options:  ?theme=light   ?panels=attn,cats,order   ?title=Store%20room
 */
(() => {
  const $ = (s) => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  if (params.get('theme') === 'light') document.documentElement.dataset.theme = 'light';
  const panels = (params.get('panels') || 'attn,cats,order').split(',').map((x) => x.trim());
  const PANEL = { attn: '#p-attn', cats: '#p-cats', order: '#p-order' };
  for (const [k, sel] of Object.entries(PANEL)) $(sel).hidden = !panels.includes(k);
  const shown = Object.keys(PANEL).filter((k) => panels.includes(k)).length;
  $('#main').className = shown === 2 ? 'cols-2' : shown === 1 ? 'cols-1' : '';

  /** DOM builder; text is always set as text (never HTML), icons come from icons.js. */
  // flatten nested arrays without Array.flat (not in older TV browsers)
  const flat = (list) => list.reduce((acc, k) => acc.concat(Array.isArray(k) ? flat(k) : [k]), []);
  function h(tag, cls, ...kids) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    for (const k of flat(kids)) if (k != null && k !== false) el.appendChild(k.nodeType ? k : document.createTextNode(String(k)));
    return el;
  }
  // replace an element's contents without replaceChildren (not in older TV browsers)
  function fill(el, ...kids) {
    while (el.firstChild) el.removeChild(el.firstChild);
    for (const k of flat(kids)) if (k != null && k !== false) el.appendChild(k.nodeType ? k : document.createTextNode(String(k)));
  }
  const icon = (key) => { const s = document.createElement('span'); s.className = 'ic'; s.innerHTML = iconMarkup(key); return s; };
  const catIconKey = (cat, items) => guessIcon(cat) || (items[0] ? guessIcon(items[0].name) : null) || 'tag';
  const itemIconKey = (it) => guessIcon(it.group) || guessIcon(it.name) || 'box';
  const level = (it) => (it.qty === 0 ? 'out' : it.low != null && it.qty <= it.low ? 'low' : 'ok');
  const where = (it) => [it.group, it.sub].filter(Boolean).join(' › ');

  let data = { name: 'Inventru', items: [], updatedAt: null };

  function kpi(label, value, cls) { return h('div', `kpi ${cls || ''}`, h('b', null, value), h('span', null, label)); }

  function render() {
    const items = data.items;
    const name = params.get('title') || data.name || 'Inventru';
    $('#title').textContent = name;
    document.title = `${name} - stock dashboard`;
    const out = items.filter((i) => level(i) === 'out');
    const low = items.filter((i) => level(i) === 'low');
    const ordered = items.filter((i) => i.ordered);
    fill($('#kpis'),
      kpi('Items', items.length), kpi('Units', items.reduce((n, i) => n + i.qty, 0)),
      kpi('Low', low.length, low.length ? 'warn' : 'ok'), kpi('Out', out.length, out.length ? 'bad' : 'ok'),
      kpi('On order', ordered.length));

    // Needs attention: out first, then lowest relative to the warning level
    const attn = [...out, ...low.sort((a, b) => (a.qty / Math.max(1, a.low)) - (b.qty / Math.max(1, b.low)))];
    $('#attn-n').textContent = attn.length ? `${attn.length}` : '';
    fill($('#attn'), ...(attn.length ? attn.map((it) => {
      const lv = level(it);
      return h('div', `tile ${lv}`, icon(itemIconKey(it)), h('div', 'nm', it.name), h('div', 'q', it.qty),
        // every piece in its own element, so the flex gap separates them
        h('div', 'meta', h('span', 'badge', lv === 'out' ? 'Out' : 'Low'), where(it) ? h('span', null, where(it)) : null,
          it.low != null ? h('span', null, `warn at ${it.low}`) : null, it.ordered ? h('span', 'badge ord', 'On order') : null));
    }) : [h('div', 'allgood', h('div', 'big', '✓'), h('p', null, 'Everything is in stock'))]));

    // By category, with subcategory breakdown
    const cats = new Map();
    for (const it of items) { const k = it.group || 'No category'; if (!cats.has(k)) cats.set(k, []); cats.get(k).push(it); }
    fill($('#cats'), ...(cats.size ? [...cats.entries()].map(([cat, its]) => {
      const units = its.reduce((n, i) => n + i.qty, 0);
      const nLow = its.filter((i) => level(i) === 'low').length;
      const nOut = its.filter((i) => level(i) === 'out').length;
      const subs = new Map();
      for (const it of its) if (it.sub) subs.set(it.sub, (subs.get(it.sub) || 0) + it.qty);
      const max = Math.max(1, ...subs.values());
      return h('div', 'cat',
        h('div', 'top', icon(catIconKey(cat === 'No category' ? '' : cat, its)), h('div', 'nm', cat), h('div', 'units', units)),
        h('div', 'info', h('span', null, `${its.length} item${its.length === 1 ? '' : 's'}`), nLow ? h('span', 'w', `${nLow} low`) : null, nOut ? h('span', 'o', `${nOut} out`) : null),
        subs.size ? h('div', 'subs', ...[...subs.entries()].map(([s, q]) => {
          const bar = h('div', 'bar', h('i')); bar.firstChild.style.width = `${Math.round((q / max) * 100)}%`;
          return h('div', 'subrow', h('span', null, s), h('b', null, q), bar);
        })) : null);
    }) : [h('div', 'empty', 'No items yet')]));

    // On order
    $('#order-n').textContent = ordered.length ? `${ordered.length}` : '';
    fill($('#order'), ...(ordered.length ? ordered.map((it) => h('div', 'ord-row', icon(itemIconKey(it)), h('div', 'nm', it.name), h('div', 'q', it.qty), h('div', 'meta', where(it) || '—')))
      : [h('div', 'empty', 'Nothing on order')]));
    stamp();
  }

  // ---------------------------------------------------------------- status + clock
  let state = 'connecting';
  function setStatus(s) { state = s; $('#status').dataset.state = s; stamp(); }
  function stamp() {
    const t = data.updatedAt ? new Date(data.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
    $('#status .txt').textContent = state === 'live' ? (t ? `Live · last change ${t}` : 'Live')
      : state === 'offline' ? 'Reconnecting… (showing last known stock)' : 'Connecting…';
  }
  setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }, 1000);

  // ---------------------------------------------------------------- data
  let loading = false; let again = false;
  async function load() {
    if (loading) { again = true; return; }
    loading = true;
    try {
      const r = await fetch('/api/items', { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      data = await r.json();
      render();
    } catch (e) { setStatus('offline'); } finally {
      loading = false;
      if (again) { again = false; load(); }
    }
  }

  function connect() {
    const es = new EventSource('/api/events');
    es.addEventListener('change', () => { setStatus('live'); load(); });
    es.onerror = () => setStatus('offline'); // EventSource reconnects by itself
  }
  // safety net: refresh every 5 minutes even if events are blocked by a proxy
  setInterval(load, 5 * 60 * 1000);

  // ---------------------------------------------------------------- gentle auto-scroll for long panels
  const scrollers = ['#attn', '#cats', '#order'].map((s) => ({ el: $(s), pause: 60 }));
  setInterval(() => {
    for (const s of scrollers) {
      const el = s.el;
      if (el.scrollHeight <= el.clientHeight + 2) { el.scrollTop = 0; continue; }
      if (s.pause > 0) { s.pause--; continue; }
      el.scrollTop += 1;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) { s.pause = 80; setTimeout(() => { el.scrollTop = 0; s.pause = 60; }, 3000); }
    }
  }, 50);

  load();
  connect();
})();
