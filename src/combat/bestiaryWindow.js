'use strict';
// bestiaryWindow.js — the Bestiary's own window shell: open and shut, the header drag, the corner resize, the list's
// toggle and its edge, back and forward, the crumbs. What the window shows is bestiary.js and bestiaryCopy.js; which
// parts show at which width is bestiaryWidths.js.
//
// A viewing setting under its own key. Opened from the fight it takes the popup's remembered size and keeps a new one
// there, so the place the DM keeps for the dock's Bestiary survives a fight.

const BSW_KEY = 'evermist.bestiaryWin';
const BSW_LIST_MIN = 180;

const _bsw = { listW: { wide: 520, medium: 240 }, listHidden: false, fromFight: false, fightListHidden: true,
  cal: false, back: false, hist: [], hi: -1, nav: false, go: null };

const _bswEl = () => document.getElementById('bs-panel');
const _bswM = () => 8 / cbZoom();

function bswListHidden() { return _bsw.fromFight ? _bsw.fightListHidden : _bsw.listHidden; }
function bswListWidth(mode) { return _bsw.listW[mode] || _bsw.listW.medium; }
function bswFromFight() { return _bsw.fromFight; }

// Beside the fight the window's height is the popup's plus its head and strip.
const BSW_FIGHT_HEAD = 96;

function _bswSave() {
  const w = _bswEl();
  if (_bsw.fromFight) { _cbSaveCols({ statW: parseFloat(w.style.width), statH: Math.max(120, parseFloat(w.style.height) - BSW_FIGHT_HEAD) }); return; }
  try {
    localStorage.setItem(BSW_KEY, JSON.stringify({ left: parseFloat(w.style.left), top: parseFloat(w.style.top),
      width: parseFloat(w.style.width), height: parseFloat(w.style.height), listW: _bsw.listW, listHidden: _bsw.listHidden }));
  } catch (_) {}
}

function _bswLoad() {
  let g = null;
  try { g = JSON.parse(localStorage.getItem(BSW_KEY) || 'null'); } catch (_) {}
  return g && typeof g === 'object' ? g : {};
}

// 8px inside the app window, moved and resized alike; the max size keeps the native corner drag inside too.
function bswClamp() {
  const w = _bswEl(), z = cbZoom(), m = _bswM(), iw = dockFreeRight() / z, ih = innerHeight / z;
  const width = Math.min(w.offsetWidth, iw - 2 * m), height = Math.min(w.offsetHeight, ih - 2 * m);
  const left = Math.max(m, Math.min(iw - width - m, parseFloat(w.style.left) || 0));
  const top = Math.max(m, Math.min(ih - height - m, parseFloat(w.style.top) || 0));
  Object.assign(w.style, { left: left + 'px', top: top + 'px', width: width + 'px', height: height + 'px',
    maxWidth: (iw - left - m) + 'px', maxHeight: (ih - top - m) + 'px' });
}

function _bswSize(left, top, width, height) {
  Object.assign(_bswEl().style, { maxWidth: '', maxHeight: '', left: left + 'px', top: top + 'px', width: width + 'px', height: height + 'px' });
  bswClamp();
}

// Beside the fight table, as the stat block popup opened, at the popup's remembered size.
function _bswBesideFight() {
  const z = cbZoom(), cols = cbCols(), f = document.getElementById('cb-fight').getBoundingClientRect();
  const w = (cols.statW || 440) * z, h = cols.statH ? (cols.statH + BSW_FIGHT_HEAD) * z : Math.min(680 * z, innerHeight - 16);
  let left = f.left - w - 10;
  if (left < 8) left = f.right + 10 + w < dockFreeRight() ? f.right + 10 : 8;
  // With no room on either side it opens over the table, on top of it, so the page the DM asked for is whole.
  _bswEl().classList.toggle('over-fight', left === 8 && 8 + w > f.left);
  _bswSize(left / z, f.top / z, w / z, h / z);
}

function _bswAtLastPlace() {
  const g = _bswLoad(), z = cbZoom(), iw = dockFreeRight() / z, ih = innerHeight / z, n = v => Number.isFinite(v);
  if (g.listW && typeof g.listW === 'object') for (const k of ['wide', 'medium']) if (n(g.listW[k])) _bsw.listW[k] = Math.max(BSW_LIST_MIN, g.listW[k]);
  _bsw.listHidden = g.listHidden === true;
  const width = n(g.width) ? g.width : Math.min(1100, iw - 16), height = n(g.height) ? g.height : Math.min(720, ih - 16);
  _bswSize(n(g.left) ? g.left : (iw - width) / 2, n(g.top) ? g.top : (ih - height) / 2, width, height);
}

function bsIsOpen() { return motionOpen(_bswEl()); }

// Of the Bestiary and the fight table, the one the DM pressed last is in front, as windows are anywhere else.
function bswFront(on) { _bswEl().classList.toggle('over-fight', on); }

// `fromFight` places it beside the table with the list hidden, unless it is open already: then it stays as it is.
function bswShow(fromFight) {
  if (_bsw.cal) return false;
  const w = _bswEl();
  if (bsIsOpen()) return true;
  _bsw.fromFight = !!fromFight;
  _bsw.fightListHidden = true;
  w.hidden = false;
  if (fromFight) _bswBesideFight(); else _bswAtLastPlace();
  motionShow(w, 'window', { from: document.getElementById('btn-bestiary') });
  return true;
}

function bswHide() {
  const w = _bswEl();
  _bsw.fromFight = false;
  motionHide(w, 'window', { from: document.getElementById('btn-bestiary'), glow: true,
    done: () => { w.hidden = true; w.classList.remove('over-fight'); } });
}

// Grid calibration needs the map to itself; the window comes back after unless the DM shut it meanwhile.
function bswHoldForCalibration(on) {
  if (on) { _bsw.back = bsIsOpen(); if (_bsw.back) bestiarySetOpen(false); _bsw.cal = true; return; }
  const back = _bsw.back;
  _bsw.cal = _bsw.back = false;
  if (back) bestiarySetOpen(true);
}

// The page keeps its width: hiding the list takes the list's width off the window, showing it gives it back.
function bswToggleList(mode, listShown) {
  const w = _bswEl(), lw = bswListWidth(mode === 'narrow' ? 'medium' : mode) + 1;
  if (_bsw.fromFight) _bsw.fightListHidden = listShown; else _bsw.listHidden = listShown;
  w.style.maxWidth = '';
  w.style.width = Math.max(320, w.offsetWidth + (listShown ? -lw : lw)) + 'px';
  bswClamp();
  _bswSave();
}

// ─── History ─────────────────────────────────────────────────────────────────

function bswRecord(key) {
  if (_bsw.nav || _bsw.hist[_bsw.hi] === key) return;
  _bsw.hist = _bsw.hist.slice(0, _bsw.hi + 1).concat(key).slice(-40);
  _bsw.hi = _bsw.hist.length - 1;
  _bswButtons();
}

function bswForget(key) {
  const at = _bsw.hist.indexOf(key);
  if (at < 0) return;
  _bsw.hist = _bsw.hist.filter(k => k !== key);
  _bsw.hi = Math.min(_bsw.hist.length - 1, Math.max(0, _bsw.hi - (at <= _bsw.hi ? 1 : 0)));
  _bswButtons();
}

// A step over a page that is gone drops it and goes on.
function _bswStep(d) {
  _bsw.nav = true;
  try {
    for (let i = _bsw.hi + d; i >= 0 && i < _bsw.hist.length; i += d) {
      if (_bsw.go(_bsw.hist[i])) { _bsw.hi = i; break; }
    }
  } finally { _bsw.nav = false; }
  _bswButtons();
}

function _bswButtons() {
  document.getElementById('bs-back').disabled = _bsw.hi <= 0;
  document.getElementById('bs-fwd').disabled = _bsw.hi >= _bsw.hist.length - 1;
}

function bswCrumbs(names) {
  const box = document.getElementById('bs-crumbs');
  box.textContent = '';
  names.forEach((n, i) => {
    if (i) { const s = document.createElement('span'); s.className = 'nw-sep'; s.innerHTML = uiIcon('chev', 12, 2); box.appendChild(s); }
    const c = document.createElement('span');
    c.className = 'nw-crumb' + (i === names.length - 1 ? ' last' : '');
    c.textContent = c.title = n;
    c.dataset.noI18n = '';
    box.appendChild(c);
  });
}

// ─── Wiring ──────────────────────────────────────────────────────────────────

function _bswDrag(e) {
  const w = _bswEl(), z = cbZoom();
  const sx = e.clientX / z - parseFloat(w.style.left || 0), sy = e.clientY / z - parseFloat(w.style.top || 0);
  const move = m => { w.style.maxWidth = w.style.maxHeight = ''; w.style.left = (m.clientX / z - sx) + 'px'; w.style.top = (m.clientY / z - sy) + 'px'; bswClamp(); };
  const up = () => { window.removeEventListener('mousemove', move); _bswSave(); };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up, { once: true });
}

function _bswEdge(e, mode, redraw) {
  e.preventDefault();
  e.stopPropagation();
  const edge = e.currentTarget, w = _bswEl(), z = cbZoom(), x0 = e.clientX / z, w0 = bswListWidth(mode);
  edge.classList.add('drag');
  const move = m => {
    _bsw.listW[mode] = Math.max(BSW_LIST_MIN, Math.min(w.offsetWidth - 300, w0 + m.clientX / z - x0));
    redraw();
  };
  const up = () => { window.removeEventListener('mousemove', move); edge.classList.remove('drag'); _bswSave(); };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up, { once: true });
}

const BSW_SVG = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

// The shell's markup around the parts bestiary.js puts in its slots.
function bswHtml(tools, top, list, page) {
  return `<div class="bsw-head" id="bs-head">
      <button class="nw-ib" id="bs-list-btn">${BSW_SVG('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>')}</button>
      <button class="nw-ib" id="bs-back" title="Back (Alt+Left)" disabled>${BSW_SVG('<path d="M15 6l-6 6 6 6"/>')}</button>
      <button class="nw-ib" id="bs-fwd" title="Forward (Alt+Right)" disabled>${BSW_SVG('<path d="M9 6l6 6-6 6"/>')}</button>
      <div class="nw-crumbs" id="bs-crumbs"></div>${tools}
      <button class="nw-ib" data-a="close" title="Close (Esc)">${BSW_SVG('<path d="M6 6l12 12M18 6L6 18"/>')}</button>
    </div>${top}
    <div class="bsw-body"><div class="bsw-list" id="bs-list">${list}<div class="bsw-edge" id="bs-edge" title="Drag to resize"></div></div>${page}</div>`;
}

// `go(key)` shows a history entry and answers whether it still exists; `mode()` is the width the window is at.
function bswInit(go, mode, redraw) {
  const w = _bswEl();
  _bsw.go = go;
  w.addEventListener('mousedown', () => bswFront(true), true);
  w.addEventListener('mousedown', e => {
    if (e.target.closest('#bs-head') && !e.target.closest('button, input, label, .sm-field')) { e.preventDefault(); _bswDrag(e); }
  });
  w.addEventListener('keydown', e => {
    if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); _bswStep(-1); }
    if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); _bswStep(1); }
  });
  document.getElementById('bs-edge').addEventListener('mousedown', e => _bswEdge(e, mode(), redraw));
  document.getElementById('bs-back').addEventListener('click', () => _bswStep(-1));
  document.getElementById('bs-fwd').addEventListener('click', () => _bswStep(1));
  window.addEventListener('resize', () => { if (bsIsOpen()) bswClamp(); });
  // The native corner drag writes the size; it is kept inside, the width class follows, and the size is saved once it settles.
  let saveSoon = 0;
  new ResizeObserver(() => {
    if (!bsIsOpen()) return;
    w.style.width = w.offsetWidth + 'px';
    w.style.height = w.offsetHeight + 'px';
    bswClamp();
    if (redraw()) bestiaryRender();
    clearTimeout(saveSoon);
    saveSoon = setTimeout(_bswSave, 300);
  }).observe(w);
}
