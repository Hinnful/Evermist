'use strict';
// libraryList.js — the parts Music, Sounds and Pictures share: the ⋯ menu on the item or heading under the pointer,
// drag to reorder with a thin blue line, a hold over another item to make a group, a drop on a heading to join it,
// the list scrolling near its edges, the name edited in place, and Ctrl+R. Each pane draws its own rows; this
// module only reads the markup below and calls the pane back. The order rules are sceneGroups.js's.
//
// Markup: an item carries `data-lib-key` and holds `.lib-name` and a `.lib-more`; its section carries
// `data-lib-group` ('' for Ungrouped) and holds a `.lib-gh` heading. Every name goes in as text, never markup.

const LIB_HOLD_MS = 500;
const LIB_EDGE_PX = 28;
const _llLists = [];
let _llHover = null;     // { list, el } under the pointer, for Ctrl+R
let _llMenu = null;
let _llDrag = null;
let _llSwallow = -1e9;   // when the drop's mouseup came: its own click is never a play or a show

// `o`: grid (tiles side by side), filtering(), scroller, redraw(), groups() [{ key, name }], and the pane's calls back:
// rename(key), del(key), moveTo(key, group), move(key, group, before), hold(drag, target), groupRename(gk),
// ungroup(gk), fold(gk). A tree of rows (the Notes window) passes its own rules instead of sections: menu(key) the ⋯
// rows, canDrag(key), aim(drag, over, zone) answering 'line', 'in', 'hold' or null for the zone 'before', 'middle' or
// 'after' of a row, and drop(drag, { key, zone }) with zone 'before', 'after', 'in' or 'hold'.
function libraryList(root, o) {
  const list = { root, o };
  _llLists.push(list);
  root.addEventListener('mouseover', e => {
    const el = e.target.closest('[data-lib-key], .lib-gh');
    _llHover = el && root.contains(el) ? { list, el } : null;
  });
  root.addEventListener('mouseleave', () => { if (_llHover && _llHover.list === list) _llHover = null; });
  root.addEventListener('click', e => {
    const more = e.target.closest('.lib-more');
    if (more) { e.stopPropagation(); _llOpenMenu(list, more); return; }
    const head = e.target.closest('.lib-gh');
    if (head && !e.target.closest('input')) o.fold(_llGroupOf(head));
  }, true);
  root.addEventListener('mousedown', e => _llDown(list, e));
  return list;
}

// ⚠ A LIST IS NEVER REDRAWN UNDER A DRAG OR AN OPEN NAME FIELD: a redraw (a track's length read, a sound ending)
// would take the dragged row or the field away. The pane asks here first; the redraw it skipped runs when they end.
function libHold(root) {
  const d = _llDrag, busy = !!(d && d.on && d.list.root === root) || !!root.querySelector('.lib-edit, .ga-name-edit');
  root._libStale = busy;
  return busy;
}

function _llFresh(root) {
  const l = root && _llLists.find(x => x.root === root);
  if (l && root._libStale) { root._libStale = false; l.o.redraw(); }
}

const _llGroupOf = el => { const s = el.closest('[data-lib-group]'); return s && s.dataset.libGroup ? s.dataset.libGroup : null; };

// ─── Renaming in place ───────────────────────────────────────────────────────

// The name turns into a field: Enter or a click elsewhere keeps the text, Esc puts the old one back. `done(text)`
// hears the kept text, trimmed, only when it changed.
function libEditName(el, value, done) {
  const input = document.createElement('input');
  input.className = 'lib-edit';
  input.spellcheck = false;
  input.value = value;
  el.replaceWith(input);
  input.focus();
  input.select();
  let over = false;
  const finish = keep => {
    if (over) return;
    over = true;
    const text = input.value.replace(/\s+/g, ' ').trim();
    const list = _llLists.find(x => x.root.contains(input));
    if (input.isConnected) input.replaceWith(el);
    done(keep && text && text !== value ? text : null);
    if (list) _llFresh(list.root);
  };
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('mousedown', e => e.stopPropagation());
  input.addEventListener('click', e => e.stopPropagation());
  return input;
}

function _llRename(list, el) {
  if (el.classList.contains('lib-gh')) { const g = _llGroupOf(el); if (g) list.o.groupRename(g); }
  else list.o.rename(el.dataset.libKey);
}

// ─── The ⋯ menu ──────────────────────────────────────────────────────────────

function libCloseMenu() {
  if (_llMenu) { _llMenu.remove(); _llMenu = null; }
  document.querySelectorAll('.lib-more.lit, .dk-addb.lit').forEach(b => b.classList.remove('lit'));
}

function _llMenuEl(rows, extra) {
  const menu = document.createElement('div');
  menu.className = 'sm-menu lib-menu' + (extra || '');
  menu.dataset.noI18n = '';
  for (const r of rows) {
    if (r.sep) { menu.insertAdjacentHTML('beforeend', '<div class="sm-msep"></div>'); continue; }
    const b = document.createElement('button');
    b.className = 'sm-mi' + (r.danger ? ' danger' : '') + (r.on ? ' on' : '');
    b.innerHTML = (r.icon ? uiIcon(r.icon, 13) : '') + '<span class="nm"></span><span class="ky"></span>';
    b.querySelector('.nm').textContent = r.raw ? r.label : t(r.label);
    b.querySelector('.ky').textContent = r.key || '';
    b.disabled = !!r.off;
    // A greyed row says why in the row itself: a disabled button shows no tooltip.
    if (r.off && r.hint) { b.classList.add('why'); const w = document.createElement('span'); w.className = 'nw-why'; w.textContent = r.hint; b.appendChild(w); }
    if (r.sub) b.addEventListener('mouseenter', () => _llSub(b, r.sub()));
    else b.addEventListener('mouseenter', () => { const s = menu.querySelector('.lib-sub'); if (s) s.remove(); });
    b.addEventListener('click', e => {
      e.stopPropagation();
      if (r.sub) { _llSub(b, r.sub()); return; }
      libCloseMenu();
      r.run();
    });
    menu.appendChild(b);
  }
  menu.addEventListener('mousedown', e => e.stopPropagation());
  menu.addEventListener('contextmenu', e => e.preventDefault());
  return menu;
}

function _llPlace(menu, x, y, left) {
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = Math.max(4, Math.min(left ? x - w : x, innerWidth - w - 4)) + 'px';
  menu.style.top = Math.max(4, Math.min(y, innerHeight - h - 4)) + 'px';
}

// Move to group's list opens to the left, toward the map, as every pop-out of the dock does.
function _llSub(row, rows) {
  const old = _llMenu && _llMenu.querySelector('.lib-sub');
  if (old) old.remove();
  const sub = _llMenuEl(rows, ' lib-sub');
  _llMenu.appendChild(sub);
  const r = row.getBoundingClientRect();
  _llPlace(sub, r.left - 2, r.top - 5, true);
}

// A menu under `btn`, its right edge on the button's. Rows: { label, raw, key, icon, danger, off, sub(), run() } or { sep }.
function libMenuAt(btn, rows) {
  libCloseMenu();
  const menu = _llMenuEl(rows);
  document.body.appendChild(menu);
  _llMenu = menu;
  btn.classList.add('lit');
  const r = btn.getBoundingClientRect();
  _llPlace(menu, r.right, r.bottom + 2, true);
}

// The same menu at a point: a right-click.
function libMenuAtPoint(x, y, rows) {
  libCloseMenu();
  if (!rows.length) return;
  const menu = _llMenuEl(rows);
  document.body.appendChild(menu);
  _llMenu = menu;
  _llPlace(menu, x, y, false);
}

function _llOpenMenu(list, btn) {
  const head = btn.closest('.lib-gh');
  const item = btn.closest('[data-lib-key]');
  libMenuAt(btn, head ? _llGroupRows(list, _llGroupOf(head)) : list.o.menu ? list.o.menu(item.dataset.libKey) : _llItemRows(list, item));
}

function _llItemRows(list, item) {
  const key = item.dataset.libKey, here = _llGroupOf(item), o = list.o;
  const move = () => {
    const rows = o.groups().filter(g => g.key !== here).map(g => ({ label: g.name, raw: true, run: () => o.moveTo(key, g.key) }));
    if (here != null) rows.push({ sep: true }, { label: 'No group', run: () => o.moveTo(key, null) });
    return rows.length ? rows : [{ label: 'No groups yet', off: true, run: () => {} }];
  };
  return [{ label: 'Rename', key: 'Ctrl+R', run: () => o.rename(key) }, { label: 'Move to group', key: '›', sub: move },
    { sep: true }, { label: 'Delete', icon: 'trash', danger: true, run: () => o.del(key) }];
}

function _llGroupRows(list, gk) {
  return [{ label: 'Rename', key: 'Ctrl+R', run: () => list.o.groupRename(gk) }, { label: 'Ungroup', run: () => list.o.ungroup(gk) }];
}

// ─── Drag ────────────────────────────────────────────────────────────────────

function _llDown(list, e) {
  const item = e.target.closest('[data-lib-key]');
  if (e.button !== 0 || !item || e.target.closest('input, .lib-more, button.lib-more') || list.o.filtering()) return;
  if (list.o.canDrag && !list.o.canDrag(item.dataset.libKey)) return;
  _llDrag = { list, item, key: item.dataset.libKey, x: e.clientX, y: e.clientY, on: false, ghost: null, line: null, at: null, hold: null, timer: 0, raf: 0 };
}

function _llStart(d) {
  d.on = true;
  libCloseMenu();
  window.getSelection().removeAllRanges();
  const r = d.item.getBoundingClientRect();
  d.ghost = d.item.cloneNode(true);
  d.ghost.classList.add('lib-ghost');
  // The dock is zoomed and the body is not, so the ghost wears the same zoom and its numbers are divided by it.
  d.z = r.width / (d.item.offsetWidth || r.width) || 1;
  d.ghost.style.zoom = d.z;
  d.ghost.style.width = d.item.offsetWidth + 'px';
  d.ghost.style.height = d.item.offsetHeight + 'px';
  d.dx = d.x - r.left;
  d.dy = d.y - r.top;
  document.body.appendChild(d.ghost);
  d.item.classList.add('lib-faded');
  d.list.root.classList.add('lib-dragging');
  d.line = document.createElement('div');
  d.line.className = 'lib-line' + (d.list.o.grid ? ' up' : '');
  d.line.hidden = true;
  d.list.root.appendChild(d.line);
  d.raf = requestAnimationFrame(() => _llScroll(d));
}

// Near the top or bottom edge the list scrolls, faster the closer the pointer.
function _llScroll(d) {
  if (_llDrag !== d) return;
  const box = d.list.o.scroller.getBoundingClientRect();
  const top = d.cy - box.top, bottom = box.bottom - d.cy;
  const step = top < LIB_EDGE_PX ? -(LIB_EDGE_PX - top) / 2 : bottom < LIB_EDGE_PX ? (LIB_EDGE_PX - bottom) / 2 : 0;
  if (step) { d.list.o.scroller.scrollTop += step; _llAim(d); }
  d.raf = requestAnimationFrame(() => _llScroll(d));
}

function _llMove(e) {
  const d = _llDrag;
  if (!d) return;
  if (!d.on) {
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
    _llStart(d);
  }
  d.cx = e.clientX;
  d.cy = e.clientY;
  d.ghost.style.left = (e.clientX - d.dx) / d.z + 'px';
  d.ghost.style.top = (e.clientY - d.dy) / d.z + 'px';
  _llAim(d);
}

function _llClearHold(d) {
  clearTimeout(d.timer);
  d.timer = 0;
  if (d.hold) d.hold.classList.remove('lib-merge');
  d.hold = null;
  d.list.root.querySelectorAll('.lib-join').forEach(x => x.classList.remove('lib-join'));
}

// What the pointer is over: the edge between two items (the line), the middle of one (a hold), or a heading (join).
function _llAim(d) {
  const root = d.list.root, under = document.elementFromPoint(d.cx, d.cy);
  const head = under && under.closest('.lib-gh'), item = under && under.closest('[data-lib-key]');
  if (head && root.contains(head)) {
    _llClearHold(d);
    head.classList.add('lib-join');
    d.line.hidden = true;
    d.at = { join: head };
    return;
  }
  if (!item || !root.contains(item) || item === d.item) {
    if (!item || item !== d.item) { _llClearHold(d); d.line.hidden = true; d.at = null; }
    return;
  }
  const r = item.getBoundingClientRect(), grid = d.list.o.grid;
  const f = grid ? (d.cx - r.left) / r.width : (d.cy - r.top) / r.height;
  const zone = f > 0.3 && f < 0.7 ? 'middle' : f >= 0.7 ? 'after' : 'before';
  const how = d.list.o.aim ? d.list.o.aim(d.key, item.dataset.libKey, zone) : zone === 'middle' ? 'hold' : 'line';
  if (!how) { _llClearHold(d); d.line.hidden = true; d.at = null; return; }
  if (how === 'in') {
    _llClearHold(d);
    item.classList.add('lib-join');
    d.line.hidden = true;
    d.at = { into: item };
    return;
  }
  if (how === 'hold') {
    d.line.hidden = true;
    if (d.hold === item) return;
    _llClearHold(d);
    d.hold = item;
    d.at = null;
    d.timer = setTimeout(() => { if (d.hold === item) { item.classList.add('lib-merge'); d.at = { hold: item }; } }, LIB_HOLD_MS);
    return;
  }
  _llClearHold(d);
  const after = zone === 'after';
  d.at = { item, after };
  const box = root.getBoundingClientRect(), zoom = box.width / root.offsetWidth || 1;
  d.line.hidden = false;
  if (grid) {
    d.line.style.left = ((after ? r.right + 3 : r.left - 5) - box.left) / zoom + root.scrollLeft + 'px';
    d.line.style.top = (r.top - box.top) / zoom + root.scrollTop + 'px';
    d.line.style.height = r.height / zoom + 'px';
  } else {
    // A list that scrolls itself carries the line in its content, so its scroll is added back.
    d.line.style.top = ((after ? r.bottom : r.top) - box.top) / zoom - 1 + root.scrollTop + 'px';
  }
}

function _llUp(e) {
  const d = _llDrag;
  _llDrag = null;
  if (!d || !d.on) return;
  cancelAnimationFrame(d.raf);
  _llClearHold(d);
  d.ghost.remove();
  d.line.remove();
  d.item.classList.remove('lib-faded');
  d.list.root.classList.remove('lib-dragging');
  _llSwallow = e.timeStamp;
  const at = d.at;
  if (at) _llDrop(d, at);
  _llFresh(d.list.root);
}

function _llDrop(d, at) {
  const o = d.list.o;
  if (o.drop) {
    const el = at.into || at.hold || at.item;
    o.drop(d.key, { key: el.dataset.libKey, zone: at.into ? 'in' : at.hold ? 'hold' : at.after ? 'after' : 'before' });
    return;
  }
  if (at.join) { o.moveTo(d.key, _llGroupOf(at.join)); return; }
  if (at.hold) { o.hold(d.key, at.hold.dataset.libKey); return; }
  const group = _llGroupOf(at.item);
  let before = at.item;
  if (at.after) {
    const items = [...(at.item.closest('[data-lib-group]') || d.list.root).querySelectorAll('[data-lib-key]')];
    before = items[items.indexOf(at.item) + 1] || null;
    if (before === d.item) before = items[items.indexOf(at.item) + 2] || null;
  }
  o.move(d.key, group, before ? before.dataset.libKey : null);
}

function _llKey(e) {
  if (!(e.ctrlKey || e.metaKey) || e.code !== 'KeyR' || !_llHover || !_llHover.el.isConnected) return;
  const tg = e.target;
  if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable)) return;
  e.preventDefault();
  e.stopPropagation();
  _llRename(_llHover.list, _llHover.el);
}

window.addEventListener('mousemove', _llMove);
window.addEventListener('mouseup', _llUp);
// Only the real click that same mouseup makes, a moment later; a click the page itself sends is never one.
window.addEventListener('click', e => { if (e.isTrusted && e.timeStamp - _llSwallow < 50) { _llSwallow = -1e9; e.stopPropagation(); e.preventDefault(); } }, true);
// A new press is a new click, so a drop whose own click never came cannot eat it.
window.addEventListener('mousedown', e => { _llSwallow = -1e9; if (_llMenu && !_llMenu.contains(e.target)) libCloseMenu(); }, true);
window.addEventListener('wheel', () => libCloseMenu(), { passive: true });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && _llMenu) { e.stopPropagation(); libCloseMenu(); } else _llKey(e); }, true);

// ─── The parts each pane draws ───────────────────────────────────────────────

function libMoreBtn() {
  const b = document.createElement('button');
  b.className = 'lib-more';
  b.title = t('More');
  b.innerHTML = uiIcon('more', 14);
  return b;
}

// A section: the heading (fold arrow, name, count, ⋯ unless it is Ungrouped) and a body the pane fills.
function libSection(gk, name, count, shut) {
  const sec = document.createElement('div');
  sec.className = 'lib-sec' + (shut ? ' shut' : '');
  sec.dataset.libGroup = gk || '';
  const h = document.createElement('div');
  h.className = 'lib-gh';
  h.innerHTML = '<svg class="car" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg><span class="lib-name"></span><span class="c"></span><span class="sp"></span>';
  h.querySelector('.lib-name').textContent = name;
  h.querySelector('.c').textContent = String(count);
  if (gk) h.appendChild(libMoreBtn());
  const body = document.createElement('div');
  body.className = 'lib-body';
  sec.append(h, body);
  return sec;
}

// The heading of `gk` in `root`, its name turned into a field.
function libEditGroup(root, gk, value, done) {
  const sec = [...root.querySelectorAll('[data-lib-group]')].find(s => s.dataset.libGroup === gk);
  const el = sec && sec.querySelector('.lib-gh .lib-name');
  if (el) libEditName(el, value, done);
}

// Files dropped on a pane add to it. ⚠ STOPPED HERE, so a file dropped on the pane is never imported as a map.
function libDropFiles(pane, onPaths) {
  const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.items || []).some(i => i.kind === 'file');
  let depth = 0;
  pane.addEventListener('dragenter', e => { if (hasFiles(e)) { depth++; pane.classList.add('lib-filedrop'); } });
  pane.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; pane.classList.remove('lib-filedrop'); } });
  pane.addEventListener('dragover', e => { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); } });
  pane.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    depth = 0;
    pane.classList.remove('lib-filedrop');
    const paths = Array.from(e.dataTransfer.files || []).map(f => window.electronAPI.getPathForFile(f)).filter(Boolean);
    if (paths.length) onPaths(paths);
  });
}

// Renaming a group onto a name in use: both groups end up under that heading, once the DM says yes.
function libAskMerge(next, old, onYes) {
  confirmDialog({
    title: 'Merge these groups?',
    message: t('“{next}” already exists. Both groups end up under that one heading, and “{old}” goes away. Nothing is deleted.', { next, old }),
    confirmLabel: 'Merge',
    onConfirm: onYes,
  });
}
