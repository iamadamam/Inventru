'use strict';
/*
 * Drag & drop in Edit mode (pointer events, so mouse, pen and touch all work).
 *   - Drag an item by its ⋮⋮ handle: drop it between other items, or on a category / subcategory heading.
 *     Dropping into another category or subcategory moves the item there.
 *   - Drag a category heading by its handle to reorder whole categories.
 *   - Esc cancels. The list scrolls when you drag near its top or bottom edge.
 * Depends on globals from app.js (state, editing, rowsEl, listEl, sections, catOf, subOf, item, render, guarded, toast, h).
 */
(() => {
  let drag = null;       // { kind: 'item'|'cat', id?, cat?, srcEl, ghost, offsetY, target, lastY }
  let eatClick = false;  // the click the browser fires right after the pointerup that ends a drag
  const line = h('div', { class: 'drop-line', hidden: true });
  listEl.append(line);

  window.dnd = {
    active: () => !!drag,
    justDropped: () => eatClick,
    target: () => (drag ? drag.target : null), // for tests / diagnostics
  };

  /** The order the list is displayed in (category by first appearance, then subcategory) - all items, incl. hidden. */
  const canonicalIds = () => sections(state.items).flatMap((s) => s.items).map((i) => i.id);

  function showLine(y) {
    const lr = listEl.getBoundingClientRect();
    line.hidden = false;
    line.style.top = `${y - lr.top + listEl.scrollTop - 1.5}px`;
  }

  /** Last DOM element (heading or row) that belongs to category `cat`. */
  function lastElOfCat(cat) {
    let last = null; let inside = false;
    for (const el of rowsEl.children) {
      if (el.classList.contains('group-row')) { if (inside) break; inside = el.dataset.cat === cat; }
      if (inside) last = el;
    }
    return last;
  }

  function findTarget(clientY) {
    const lr = listEl.getBoundingClientRect();
    const el = document.elementFromPoint(lr.left + Math.min(60, lr.width / 4), clientY);
    const node = el && el.closest('#rows > .row, #rows > .group-row, #rows > .sub-row');
    if (!node || node === drag.srcEl) return null;
    const r = node.getBoundingClientRect();
    const upper = clientY < r.top + r.height / 2;

    if (drag.kind === 'item') {
      if (node.classList.contains('row')) {
        const it = item(node.dataset.id); if (!it) return null;
        return { type: 'row', id: it.id, before: upper, cat: catOf(it), sub: subOf(it), y: upper ? r.top : r.bottom };
      }
      if (node.classList.contains('sub-row')) return { type: 'head', cat: node.dataset.cat, sub: node.dataset.sub, y: r.bottom };
      return { type: 'head', cat: node.dataset.cat, sub: '', y: r.bottom };
    }
    // category drag: target is another category, before or after it
    const cat = node.dataset.cat ?? catOf(item(node.dataset.id) || {});
    if (cat === drag.cat) return null;
    if (node.classList.contains('group-row') && upper) return { type: 'cat', cat, before: true, y: r.top };
    const last = lastElOfCat(cat);
    return { type: 'cat', cat, before: false, y: (last || node).getBoundingClientRect().bottom };
  }

  function autoScroll() {
    if (!drag) return;
    const lr = listEl.getBoundingClientRect();
    const edge = 48;
    if (drag.lastY < lr.top + edge) listEl.scrollTop -= Math.ceil((lr.top + edge - drag.lastY) / 4);
    else if (drag.lastY > lr.bottom - edge) listEl.scrollTop += Math.ceil((drag.lastY - (lr.bottom - edge)) / 4);
    requestAnimationFrame(autoScroll);
  }

  function onMove(e) {
    if (!drag) return;
    e.preventDefault();
    drag.lastY = e.clientY;
    drag.ghost.style.top = `${e.clientY - drag.offsetY}px`;
    drag.target = findTarget(e.clientY);
    if (drag.target) showLine(drag.target.y); else line.hidden = true;
  }

  function finish(cancel) {
    if (!drag) return;
    const d = drag; drag = null;
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    window.removeEventListener('keydown', onKey, true);
    d.ghost.remove(); line.hidden = true;
    d.srcEl.classList.remove('dragging');
    document.body.classList.remove('is-dragging');
    eatClick = true; setTimeout(() => { eatClick = false; }, 0); // click follows pointerup in the same input event
    if (!cancel && d.target) apply(d, d.target); else render();
  }
  const onUp = () => finish(false);
  const onCancel = () => finish(true);
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(true); } };

  async function apply(d, t) {
    const ids = canonicalIds();
    if (d.kind === 'item') {
      const it = item(d.id); if (!it) return render();
      ids.splice(ids.indexOf(d.id), 1);
      let at;
      if (t.type === 'row') at = ids.indexOf(t.id) + (t.before ? 0 : 1);
      else {
        // heading: first item of that category (and subcategory), else the end of the category
        const inCat = ids.filter((x) => catOf(item(x)) === t.cat);
        const first = ids.find((x) => catOf(item(x)) === t.cat && subOf(item(x)) === t.sub);
        at = first ? ids.indexOf(first) : (inCat.length ? ids.indexOf(inCat[inCat.length - 1]) + 1 : ids.length);
      }
      ids.splice(at, 0, d.id);
      const moveCat = catOf(it) !== t.cat; const moveSub = subOf(it) !== t.sub;
      // optimistic: show the result immediately
      state.items.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
      if (moveCat) it.group = t.cat;
      if (moveSub) it.sub = t.sub;
      render();
      await guarded(() => window.api.reorder(ids));
      if (moveCat) await guarded(() => window.api.setField(d.id, 'group', t.cat));
      if (moveSub) await guarded(() => window.api.setField(d.id, 'sub', t.sub));
      if (moveCat || moveSub) toast(`Moved to ${t.cat || 'No category'}${t.sub ? ` › ${t.sub}` : ''}`);
    } else {
      const block = ids.filter((x) => catOf(item(x)) === d.cat);
      const rest = ids.filter((x) => catOf(item(x)) !== d.cat);
      const tIds = rest.filter((x) => catOf(item(x)) === t.cat);
      if (!tIds.length) return render();
      const at = t.before ? rest.indexOf(tIds[0]) : rest.indexOf(tIds[tIds.length - 1]) + 1;
      rest.splice(at, 0, ...block);
      state.items.sort((a, b) => rest.indexOf(a.id) - rest.indexOf(b.id));
      render();
      await guarded(() => window.api.reorder(rest));
    }
  }

  rowsEl.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.drag');
    if (!handle || !editing || drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const src = handle.closest('.row, .group-row');
    if (!src) return;
    e.preventDefault(); e.stopPropagation();
    const r = src.getBoundingClientRect();
    const ghost = src.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.classList.remove('sel');
    Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px` });
    document.body.append(ghost);
    drag = src.classList.contains('row')
      ? { kind: 'item', id: src.dataset.id } : { kind: 'cat', cat: src.dataset.cat };
    Object.assign(drag, { srcEl: src, ghost, offsetY: e.clientY - r.top, target: null, lastY: e.clientY });
    src.classList.add('dragging');
    document.body.classList.add('is-dragging');
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('keydown', onKey, true);
    requestAnimationFrame(autoScroll);
  });
})();
