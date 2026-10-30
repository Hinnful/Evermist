'use strict';
// notesWindow.js — the Notes window's shell: opening, shutting, its place, size and tree width, the header's
// back and forward, and the breadcrumbs. The tree is notesTree.js; the note's own fields are notesPanel.js.
//
// A viewing setting, so it is saved under its own key and never touches a scene or a backup.

const NW_KEY = 'evermist.notesWin';
const NW_TREE_MIN = 140;

let _nwOpen = false;
let _nwHeldForCal = false;   // open before grid calibration put it away
let _nwGeo = { treeW: 200, treeHidden: false, appearsShut: false };
let _nwHist = [], _nwHi = -1;
let _nwNav = false;          // a back or forward is moving the window, so it records nothing
let _nwCrumbsKey = '';

const _nwEl = () => document.getElementById('notes-window');
function _nwZoom() { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')) || 1.2; }

function nwIsOpen() { return _nwOpen; }

function _nwSave() {
  const w = _nwEl();
  try {
    localStorage.setItem(NW_KEY, JSON.stringify({ left: parseFloat(w.style.left), top: parseFloat(w.style.top),
      width: parseFloat(w.style.width), height: parseFloat(w.style.height), treeW: _nwGeo.treeW, treeHidden: _nwGeo.treeHidden,
      appearsShut: _nwGeo.appearsShut }));
  } catch (_) {}
}

function _nwLoad() {
  let g = null;
  try { g = JSON.parse(localStorage.getItem(NW_KEY) || 'null'); } catch (_) {}
  if (!g || typeof g !== 'object') return;
  const w = _nwEl(), n = v => (Number.isFinite(v) ? v + 'px' : '');
  w.style.left = n(g.left); w.style.top = n(g.top); w.style.width = n(g.width); w.style.height = n(g.height);
  if (Number.isFinite(g.treeW)) _nwGeo.treeW = Math.max(NW_TREE_MIN, g.treeW);
  _nwGeo.treeHidden = g.treeHidden === true;
  _nwGeo.appearsShut = g.appearsShut === true;
}

function nwAppearsShut() { return _nwGeo.appearsShut; }
function nwSetAppearsShut(shut) { _nwGeo.appearsShut = !!shut; _nwSave(); }

// Kept on screen: its header always reachable, whatever size the window was last.
function _nwPlace() {
  const w = _nwEl(), z = _nwZoom();
  const r = w.getBoundingClientRect(), ww = r.width / z, hh = r.height / z;
  const left = parseFloat(w.style.left), top = parseFloat(w.style.top);
  w.style.left = Math.max(8, Math.min(innerWidth / z - ww - 8, Number.isFinite(left) ? left : 90)) + 'px';
  w.style.top = Math.max(8, Math.min(innerHeight / z - Math.min(hh, 120), Number.isFinite(top) ? top : 40)) + 'px';
}

function _nwApplyTree() {
  const tree = document.getElementById('nw-tree'), btn = document.getElementById('nw-tree-btn');
  tree.style.width = _nwGeo.treeW + 'px';
  tree.classList.toggle('hide', _nwGeo.treeHidden);
  btn.classList.toggle('on', !_nwGeo.treeHidden);
  btn.title = t(_nwGeo.treeHidden ? 'Show the tree' : 'Hide the tree');
}

function nwShow() {
  if (_nwOpen || _nwHeldForCal) return;
  const w = _nwEl();
  _nwOpen = true;
  w.hidden = false;
  _nwApplyTree();
  _nwPlace();
  dockRefreshRail();
  refreshRoomPanel();
  _rpFitNotes();
}

function nwHide() {
  if (!_nwOpen) return;
  notesPanelSettle();
  ntCloseMenu();
  _nwOpen = false;
  _nwEl().hidden = true;
  dockRefreshRail();
}

function nwToggle() { if (_nwOpen) nwHide(); else nwShow(); }

// Grid calibration needs the map to itself; the window comes back after unless the DM shut it meanwhile.
function nwHoldForCalibration(on) {
  if (on) { _nwHeldForCal = _nwOpen; nwHide(); return; }
  const back = _nwHeldForCal;
  _nwHeldForCal = false;
  if (back) nwShow();
}

// ─── History ─────────────────────────────────────────────────────────────────

function _nwRecord(key) {
  if (_nwNav || _nwHist[_nwHi] === key) return;
  _nwHist = _nwHist.slice(0, _nwHi + 1).concat(key).slice(-60);
  _nwHi = _nwHist.length - 1;
}

function _nwStep(d) {
  const i = _nwHi + d;
  if (i < 0 || i >= _nwHist.length) return;
  _nwHi = i;
  _nwNav = true;
  try { ntGoKey(_nwHist[i]); } finally { _nwNav = false; }
}

function _nwButtons() {
  document.getElementById('nw-back').disabled = _nwHi <= 0;
  document.getElementById('nw-fwd').disabled = _nwHi >= _nwHist.length - 1;
}

// ─── Breadcrumbs ─────────────────────────────────────────────────────────────

function _nwCrumbEl(c, last) {
  const s = document.createElement('span');
  s.className = 'nw-crumb' + (last ? ' last' : '');
  s.textContent = c.name;
  s.title = c.name;
  s.dataset.noI18n = '';
  if (c.go && !last) { s.dataset.go = c.key; s.addEventListener('click', () => ntGoKey(c.key)); }
  return s;
}

function _nwSep() {
  const s = document.createElement('span');
  s.className = 'nw-sep';
  s.textContent = '›';
  return s;
}

function _nwDrawFolded(path, hidden, box) {
  box.textContent = '';
  path.forEach((c, i) => {
    if (i >= 1 && i <= hidden) {
      if (i === 1) {
        if (box.childNodes.length) box.appendChild(_nwSep());
        const more = document.createElement('span');
        more.className = 'nw-crumb more';
        more.textContent = '…';
        more.title = t('More');
        more.addEventListener('click', () => ntMenuAt(more.getBoundingClientRect(), path.slice(1, hidden + 1).filter(x => x.go)
          .map(x => ({ label: x.name, raw: true, run: () => ntGoKey(x.key) }))));
        box.appendChild(more);
      }
      return;
    }
    if (box.childNodes.length) box.appendChild(_nwSep());
    box.appendChild(_nwCrumbEl(c, i === path.length - 1));
  });
}

// `path` is [{ key, name, go }] from the campaign to the shown node. The middle folds into "…" when the box is
// too narrow, by the widths the crumbs have drawn whole.
function nwDrawCrumbs(path) {
  const box = document.getElementById('nw-crumbs');
  const sig = path.map(c => c.key + '\u0001' + c.name).join('\u0002') + '|' + box.clientWidth;
  if (sig === _nwCrumbsKey && box.childNodes.length) return;
  _nwDrawFolded(path, 0, box);
  const widths = [...box.querySelectorAll('.nw-crumb')].map(c => c.scrollWidth);
  const probe = _nwSep(), ell = document.createElement('span');
  ell.className = 'nw-crumb more';
  ell.textContent = '…';
  box.append(probe, ell);
  const sepW = probe.offsetWidth, ellW = ell.offsetWidth;
  const k = path.length > 2 ? notesCrumbFold(widths, box.clientWidth, sepW, ellW) : 0;
  _nwDrawFolded(path, k, box);
  _nwCrumbsKey = path.map(c => c.key + '\u0001' + c.name).join('\u0002') + '|' + box.clientWidth;
}

// From notesPanelSync with the shown node's key and path.
function nwShown(key, path) {
  _nwRecord(key);
  _nwButtons();
  nwDrawCrumbs(path);
}

// ─── Wiring ──────────────────────────────────────────────────────────────────

function _nwDrag(e) {
  const w = _nwEl(), z = _nwZoom();
  const sx = e.clientX / z - parseFloat(w.style.left || 0), sy = e.clientY / z - parseFloat(w.style.top || 0);
  const move = m => {
    w.style.left = (m.clientX / z - sx) + 'px';
    w.style.top = Math.max(0, m.clientY / z - sy) + 'px';
  };
  const up = () => { window.removeEventListener('mousemove', move); _nwPlace(); _nwSave(); };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up, { once: true });
}

function _nwEdge(e) {
  e.preventDefault();
  e.stopPropagation();
  const edge = e.currentTarget, w = _nwEl(), z = _nwZoom(), x0 = e.clientX / z, w0 = _nwGeo.treeW;
  edge.classList.add('drag');
  const move = m => {
    _nwGeo.treeW = Math.max(NW_TREE_MIN, Math.min(w.offsetWidth - 200, w0 + m.clientX / z - x0));
    _nwApplyTree();
  };
  const up = () => { window.removeEventListener('mousemove', move); edge.classList.remove('drag'); _nwSave(); };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up, { once: true });
}

// The note keeps its width: hiding the tree takes the tree's width off the window, showing it gives it back.
function _nwToggleTree() {
  const w = _nwEl();
  _nwGeo.treeHidden = !_nwGeo.treeHidden;
  w.style.width = Math.max(300, w.offsetWidth + (_nwGeo.treeHidden ? -1 : 1) * (_nwGeo.treeW + 1)) + 'px';
  _nwApplyTree();
  _nwPlace();
  _nwSave();
  _nwCrumbsKey = '';
  refreshRoomPanel();
}

// Esc shuts the window from inside it, or from the map when the map has nothing of its own to put down.
function _nwEscape(e) {
  if (!_nwOpen || e.key !== 'Escape' || e.defaultPrevented) return;
  const a = document.activeElement, inside = _nwEl().contains(a);
  if (nePickerOpen()) return;
  if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable) && inside) return;
  if (document.querySelector('.sm-menu') || ['cd-anchor', 'cl-anchor', 'mt-modal'].some(id => { const el = document.getElementById(id); return el && el.style.display !== 'none' && el.style.display !== ''; })) return;
  if (searchIsOpen() || bsIsOpen() || (worldMapOpen && !inside)) return;
  if (!inside && (activePolygon || shape !== 'select' || shapeOp !== 'new' || selectedPolygonId != null)) return;
  e.stopPropagation();
  nwHide();
}

function nwInit() {
  const w = _nwEl();
  if (!w) return;
  _nwLoad();
  _nwApplyTree();
  w.addEventListener('mousedown', e => {
    e.stopPropagation();
    if (e.target.closest('#nw-head') && !e.target.closest('button, [data-go], .more')) { e.preventDefault(); _nwDrag(e); }
  });
  w.addEventListener('keydown', e => {
    if (e.key !== 'Escape') e.stopPropagation();
    if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); _nwStep(-1); }
    if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); _nwStep(1); }
  });
  document.getElementById('nw-tedge').addEventListener('mousedown', _nwEdge);
  document.getElementById('nw-tree-btn').addEventListener('click', _nwToggleTree);
  document.getElementById('nw-back').addEventListener('click', () => _nwStep(-1));
  document.getElementById('nw-fwd').addEventListener('click', () => _nwStep(1));
  document.getElementById('nw-x').addEventListener('click', nwHide);
  window.addEventListener('keydown', _nwEscape, true);
  new ResizeObserver(() => {
    if (!_nwOpen) return;
    w.style.width = w.offsetWidth + 'px';
    w.style.height = w.offsetHeight + 'px';
    _nwSave();
    refreshRoomPanel();
  }).observe(w);
}
