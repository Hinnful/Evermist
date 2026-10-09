'use strict';
// dock.js — the dock on the right edge: the icon rail, the one pane open beside it, and its width.
// It sits over the map and never narrows it. DM window only; CSS hides it in Player and column
// windows.

// ⚠ NEW KEYS, never evermist.cpPane: the previous release reads that one and would open its
// panel on a tab it does not have.
const DOCK_PANE_KEY = 'evermist.dockPane';
const DOCK_WIDTH_KEY = 'evermist.dockWidth';
const DOCK_PANES = ['scene', 'music', 'sounds', 'settings'];
const DOCK_MIN_W = 230, DOCK_MAX_W = 420;   // the pane, in the dock's pre-zoom px
const DOCK_TOOLBAR_GAP = 16;                // screen px kept clear either side of the toolbar

let _dockPane = null;        // the open pane, or null with the rail alone
let _dockWantW = DOCK_MIN_W;

const _dockEl = () => document.getElementById('dock');

function initDock() {
  const dock = _dockEl();
  if (!dock) return;
  dock.addEventListener('mousedown', e => e.stopPropagation());
  dock.querySelectorAll('[data-dock-pane]').forEach(b => b.addEventListener('click', () => {
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
  dockOpen(DOCK_PANES.includes(saved) ? saved : null);
}

function dockActivePane() { return _dockPane; }

// The one way to open, switch or shut the pane; `name` is a pane, or null for the rail alone.
function dockOpen(name) {
  const dock = _dockEl();
  if (!dock) return;
  _dockPane = name;
  dockClosePop();
  dock.classList.toggle('open', !!name);
  dock.querySelectorAll('.dk-sec').forEach(s => { s.hidden = s.dataset.pane !== name; });
  try { localStorage.setItem(DOCK_PANE_KEY, name || ''); } catch (_) {}
  dockRefreshRail();
  dockLayout();
  document.dispatchEvent(new CustomEvent('dockpane', { detail: name }));
}

function _dockWindowOpen(name) {
  const shown = id => { const el = document.getElementById(id); return !!el && el.style.display !== 'none' && el.style.display !== ''; };
  if (name === 'world') return worldMapOpen;
  if (name === 'bestiary') { const m = document.getElementById('bs-modal'); return !!m && m.style.display !== 'none'; }
  if (name === 'combat') return shown('cb-fight');
  return false;
}

// Bestiary, the fight table and Help wire their own rail buttons; the world map is the dock's.
function _dockToggleWindow(name) {
  if (name === 'world') worldMapToggle();
}

function dockRefreshRail() {
  const dock = _dockEl();
  if (!dock) return;
  dock.querySelectorAll('[data-dock-pane]').forEach(b => {
    b.classList.toggle('active', b.dataset.dockPane === _dockPane);
  });
  const world = document.getElementById('btn-world');
  if (world) world.classList.toggle('active', worldMapOpen);
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

// ─── The world map ────────────────────────────────────────────────────────────
// The TV never changes while it is open, so Scene control and the fog that every scene shares go
// dark; the pane comes back on closing unless a tab was picked meanwhile.
let _dockBeforeWorld = null;

function dockHoldForWorld(on) {
  const tab = document.getElementById('dock-tab-scene');
  const fog = document.getElementById('fog-half-alpha-num');
  if (tab) tab.disabled = on;
  if (fog) fog.closest('.cp-group').inert = on;
  if (on) {
    _dockBeforeWorld = _dockPane === 'scene' ? 'scene' : null;
    if (_dockBeforeWorld) dockOpen(null);
    document.addEventListener('dockpane', _dockForgetWorld, { once: true });
  } else {
    document.removeEventListener('dockpane', _dockForgetWorld);
    if (_dockBeforeWorld && !_dockPane) dockOpen(_dockBeforeWorld);
    _dockBeforeWorld = null;
  }
}
function _dockForgetWorld() { _dockBeforeWorld = null; }

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
// ⚠ THE TOOLBAR IS CENTRED ON THE WINDOW, ALWAYS. No pane, panel or minimap moves it; the pane
// stops short of it instead, and only the narrowest width a pane can take ever covers it.
function _dockMaxW(dock) {
  const rail = dock.querySelector('.dk-rail').getBoundingClientRect().width;
  const room = (window.innerWidth / 2 - _dockBarW() / 2 - DOCK_TOOLBAR_GAP - rail) / _dockZoom(dock);
  return Math.max(DOCK_MIN_W, Math.min(DOCK_MAX_W, room));
}

// Applies the width the DM asked for, as far as the window allows. The asked-for width is what
// persists, so a bigger window gets it back.
function dockLayout() {
  const dock = _dockEl();
  if (!dock) return;
  const w = Math.max(DOCK_MIN_W, Math.min(_dockMaxW(dock), _dockWantW));
  dock.style.setProperty('--dock-pane-w', w + 'px');
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
