'use strict';
// dock.js — the dock on the right edge: the icon rail, the one pane open beside it, and its width.
// It sits over the map and never narrows it. DM window only; CSS hides it in Player and column
// windows.

// ⚠ NEW KEYS, never evermist.cpPane: the previous release reads that one and would open its
// panel on a tab it does not have.
const DOCK_PANE_KEY = 'evermist.dockPane';
const DOCK_WIDTH_KEY = 'evermist.dockWidth';
const DOCK_PANES = ['scene', 'room', 'music', 'sounds', 'settings'];
const DOCK_MIN_W = 230, DOCK_MAX_W = 420;   // the pane, in the dock's pre-zoom px
const DOCK_TOOLBAR_GAP = 16;                // screen px kept clear either side of the toolbar

let _dockPane = null;        // the open pane, or null with the rail alone
let _dockBeforeRoom = null;  // what the Room tab replaced, for a deselect to go back to
let _dockRoomPid = null;
let _dockWantW = DOCK_MIN_W;

const _dockEl = () => document.getElementById('dock');

function initDock() {
  const dock = _dockEl();
  if (!dock) return;
  dock.addEventListener('mousedown', e => e.stopPropagation());
  dock.querySelectorAll('[data-dock-pane]').forEach(b => b.addEventListener('click', () => {
    if (b.classList.contains('off')) return;
    dockOpen(_dockPane === b.dataset.dockPane ? null : b.dataset.dockPane);
  }));
  dock.querySelectorAll('[data-dock-win]').forEach(b => b.addEventListener('click', () => {
    _dockToggleWindow(b.dataset.dockWin);
    dockRefreshRail();
  }));
  try { _dockWantW = parseFloat(localStorage.getItem(DOCK_WIDTH_KEY)) || DOCK_MIN_W; } catch (_) {}
  _dockInitEdge(document.getElementById('dock-edge'));
  _dockInitPops(dock);
  const bars = new ResizeObserver(dockLayout);
  ['toolbar-bottom', 'context-row'].forEach(id => { const el = document.getElementById(id); if (el) bars.observe(el); });
  bars.observe(document.documentElement);

  let saved = 'scene';
  try { const v = localStorage.getItem(DOCK_PANE_KEY); if (v !== null) saved = v; } catch (_) {}
  dockOpen(DOCK_PANES.includes(saved) && saved !== 'room' ? saved : null);
}

function dockActivePane() { return _dockPane; }

// The one way to open, switch or shut the pane; `name` is a pane, or null for the rail alone.
function dockOpen(name) {
  const dock = _dockEl();
  if (!dock) return;
  if (name === 'room' && _dockPane !== 'room') _dockBeforeRoom = _dockPane;
  _dockPane = name;
  dockClosePop();
  dock.classList.toggle('open', !!name);
  dock.querySelectorAll('.dk-sec').forEach(s => { s.hidden = s.dataset.pane !== name; });
  const keep = name === 'room' ? _dockBeforeRoom : name;
  try { localStorage.setItem(DOCK_PANE_KEY, keep || ''); } catch (_) {}
  dockRefreshRail();
  dockLayout();
  document.dispatchEvent(new CustomEvent('dockpane', { detail: name }));
}

// Called on every repaint with the selected room's id, or null. Only a CHANGE moves the pane, so
// a DM who shut the dock on a room is not handed it back on the next frame.
function dockSyncRoom(pid) {
  if (pid === _dockRoomPid) return;
  _dockRoomPid = pid;
  if (pid != null) dockOpen('room');
  else if (_dockPane === 'room') dockOpen(_dockBeforeRoom);
  else dockRefreshRail();
}

function _dockWindowOpen(name) {
  const shown = id => { const el = document.getElementById(id); return !!el && el.style.display !== 'none' && el.style.display !== ''; };
  if (name === 'library') return typeof smIsOpen === 'function' && smIsOpen();
  if (name === 'bestiary') { const m = document.getElementById('bs-modal'); return !!m && m.style.display !== 'none'; }
  if (name === 'combat') return shown('cb-fight');
  return false;
}

// Bestiary, the fight table and Help wire their own rail buttons; the library is the dock's.
function _dockToggleWindow(name) {
  if (name === 'library') toggleDropdown();
}

function dockRefreshRail() {
  const dock = _dockEl();
  if (!dock) return;
  dock.querySelectorAll('[data-dock-pane]').forEach(b => {
    const off = b.dataset.dockPane === 'room' && _dockRoomPid == null;
    b.classList.toggle('active', b.dataset.dockPane === _dockPane);
    b.classList.toggle('off', off);
    if (b.dataset.dockPane === 'room') b.title = off ? t('Room · click one on the map') : t('Room');
  });
  const lib = document.getElementById('dock-tab-library');
  if (lib) lib.classList.toggle('active', _dockWindowOpen('library'));
  const fight = document.getElementById('btn-combat');
  if (fight) fight.classList.toggle('win', _dockWindowOpen('combat'));
}

// ─── Pop-outs ─────────────────────────────────────────────────────────────────
// A colour picker or a menu opened from a pane row, placed to the dock's left level with that
// row. One at a time; a click anywhere else, Escape or a pane change puts it away.
let _dockPopEl = null, _dockPopFrom = null;

function _dockInitPops(dock) {
  dock.addEventListener('click', e => {
    const from = e.target.closest('[data-dock-pop]');
    if (!from) return;
    const id = from.dataset.dockPop;
    if (_dockPopEl && _dockPopEl.id === id) { dockClosePop(); return; }
    dockClosePop();
    _dockPopEl = document.getElementById(id);
    _dockPopFrom = from;
    _dockPopEl.hidden = false;
    from.classList.add('open');
    dockPlacePop(_dockPopEl, _dockPopEl.classList.contains('dk-drop') ? from : from.closest('.dk-r, .dk-blk') || from);
    document.dispatchEvent(new CustomEvent('dockpop', { detail: id }));
  });
  document.querySelectorAll('.dk-pop').forEach(p => {
    p.addEventListener('mousedown', e => e.stopPropagation());
    p.querySelectorAll('[data-pop-close]').forEach(b => b.addEventListener('click', dockClosePop));
  });
  window.addEventListener('mousedown', e => {
    if (_dockPopEl && !_dockPopEl.contains(e.target) && !_dockPopFrom.contains(e.target)) dockClosePop();
  }, true);
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _dockPopEl) { dockClosePop(); e.stopImmediatePropagation(); }
  }, true);
}

function dockClosePop() {
  if (!_dockPopEl) return;
  _dockPopEl.hidden = true;
  _dockPopFrom.classList.remove('open');
  _dockPopEl = _dockPopFrom = null;
}

// Its right edge 8px off the dock, its top level with `row`, kept inside the window. A dropdown's
// list (.dk-drop) opens under the dropdown instead, Figma's way, and above it where there is no room.
function dockPlacePop(el, row) {
  const dock = _dockEl();
  if (!dock || !row) return;
  if (el.classList.contains('dk-drop')) {
    el.style.minWidth = row.offsetWidth + 'px';
    const b = row.getBoundingClientRect(), h = el.getBoundingClientRect().height;
    const st = _rpScreenToStyle(el, b.left, b.bottom + 4 + h > window.innerHeight - 8 ? b.top - 4 - h : b.bottom + 4);
    el.style.left = st.left + 'px';
    el.style.top = st.top + 'px';
    return;
  }
  const r = el.getBoundingClientRect(), d = dock.getBoundingClientRect(), a = row.getBoundingClientRect();
  const top = Math.max(8, Math.min(window.innerHeight - r.height - 8, a.top));
  const st = _rpScreenToStyle(el, d.left - 8 - r.width, top);
  el.style.left = st.left + 'px';
  el.style.top = st.top + 'px';
}

// ─── Calibration ──────────────────────────────────────────────────────────────
// Arming puts the pane away and leaving gives it back; a tab picked meanwhile wins (dm-ui skill).
let _dockBeforeCal = null;

function dockHoldForCalibration(on) {
  if (on) {
    _dockBeforeCal = _dockPane;
    dockOpen(null);
    document.addEventListener('dockpane', _dockForgetCal, { once: true });
  } else {
    document.removeEventListener('dockpane', _dockForgetCal);
    const back = _dockBeforeCal;
    _dockBeforeCal = null;
    if (back && !_dockPane) dockOpen(back);
  }
}
function _dockForgetCal() { _dockBeforeCal = null; }

// The dock's zoom as the browser applied it. ⚠ OFF A BORDERLESS BUTTON, never the dock: a 1px border is snapped, not zoomed, and skews the
// ratio by a different amount with the pane open, which nudged the toolbar a pixel.
function _dockZoom(dock) {
  const b = dock.querySelector('.rail-btn');
  return b && b.offsetWidth > 0 ? b.getBoundingClientRect().width / b.offsetWidth : 1;
}

function _dockBarW() {
  return Math.max(...['toolbar-bottom', 'context-row'].map(id => {
    const el = document.getElementById(id);
    return el ? el.getBoundingClientRect().width : 0;
  }));
}
function _dockMinimapRight() {
  const mm = document.getElementById('minimap-panel');
  return mm ? mm.getBoundingClientRect().right : 0;
}

// ⚠ THE TOOLBAR'S PLACE DEPENDS ON THE WINDOW ALONE, never on the pane: centred between the
// minimap and the rail, and moved left only as far as the narrowest pane needs. The pane then
// stops at the toolbar, so opening, shutting or dragging it never moves the bar.
function _dockToolbarBox(dock) {
  const W = window.innerWidth, rail = dock.querySelector('.dk-rail').getBoundingClientRect().width;
  const bar = _dockBarW(), minPane = DOCK_MIN_W * _dockZoom(dock);
  const left = Math.max(0, Math.min(_dockMinimapRight(), W - rail - minPane - bar - 2 * DOCK_TOOLBAR_GAP));
  const centre = Math.min((left + W - rail) / 2, W - rail - minPane - DOCK_TOOLBAR_GAP - bar / 2);
  return { left, right: W - (2 * centre - left), barRight: centre + bar / 2, rail };
}

function _dockMaxW(dock) {
  const box = _dockToolbarBox(dock);
  const room = (window.innerWidth - box.rail - box.barRight - DOCK_TOOLBAR_GAP) / _dockZoom(dock);
  return Math.max(DOCK_MIN_W, Math.min(DOCK_MAX_W, room));
}

// Applies the width the DM asked for, as far as the window allows. The asked-for width is what
// persists, so a bigger window gets it back.
function dockLayout() {
  const dock = _dockEl();
  if (!dock) return;
  const w = Math.max(DOCK_MIN_W, Math.min(_dockMaxW(dock), _dockWantW));
  dock.style.setProperty('--dock-pane-w', w + 'px');
  const box = _dockToolbarBox(dock);
  document.documentElement.style.setProperty('--tb-left', box.left + 'px');
  document.documentElement.style.setProperty('--tb-right', box.right + 'px');
}

function _dockInitEdge(edge) {
  if (!edge) return;
  edge.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    const dock = _dockEl(), z = _dockZoom(dock), x0 = e.clientX;
    const w0 = dock.querySelector('.dk-pw').offsetWidth;
    dock.classList.add('resizing');
    const move = m => {
      _dockWantW = Math.max(DOCK_MIN_W, Math.min(_dockMaxW(dock), w0 + (x0 - m.clientX) / z));
      dockLayout();
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      dock.classList.remove('resizing');
      try { localStorage.setItem(DOCK_WIDTH_KEY, String(Math.round(_dockWantW))); } catch (_) {}
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}
