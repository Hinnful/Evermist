'use strict';
// search.js — the search box: one field over a veil, from any view, that finds maps, rooms, groups, roads, notes,
// monsters, fights, music and pictures. Empty it lists what was opened lately; typing lists groups by their strongest
// result, five each. Arrow keys move, Enter picks, Esc or a click outside closes. The matching is searchPlan.js,
// what it can find searchIndex.js, what a pick does searchPick.js.
//
// ⚠ NAMES AND NOTES REACH THE DOM THROUGH textContent ONLY: they are the DM's own text.

const SR_SVG = d => '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
const SR_ICON = {
  room: SR_SVG('<path d="M4 4h16v16H4z"/><path d="M4 12h7v8"/>'),
  place: SR_SVG('<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
  road: SR_SVG('<path d="M5 21C8 14 9 9 7 3M19 21c-3-7-4-12-2-18"/><path d="M12 4v3M12 11v3M12 18v2"/>'),
  campaign: SR_SVG('<path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h5"/>'),
  monster: SR_SVG('<path d="M5 9c0-4 3-6 7-6s7 2 7 6v5l-3 3H8l-3-3z"/><circle cx="9.5" cy="10" r="1"/><circle cx="14.5" cy="10" r="1"/>'),
  fight: SR_SVG('<path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/>'),
  music: SR_SVG('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
  faction: SR_SVG('<path d="M5 21V4h11l-2 4 2 4H5"/>'),
  lore: SR_SVG('<path d="M6 3h10l4 4v14H6z"/><path d="M9 11h8M9 15h8"/>'),
  picture: SR_SVG('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>'),
  warn: SR_SVG('<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>'),
};

let _srList = null, _srInput = null;
let _srRows = [];                 // the picks on screen, in key order: { entry, rank }
let _srAt = 0;
let _srOpenGroups = new Set();    // groups shown whole
let _srProgress = null;           // { done, total } while the scenes are read
let _srFailedIds = [];

function searchInit() {
  _srList = document.getElementById('sr-list');
  _srInput = document.getElementById('sr-input');
  const veil = document.getElementById('sr-veil');
  for (const id of ['tb-find', 'wm-find']) {
    document.getElementById(id).addEventListener('click', () => (searchIsOpen() ? searchClose() : searchOpen()));
  }
  document.getElementById('sr-x').addEventListener('click', searchClose);
  _srInput.addEventListener('input', _srTyped);
  _srInput.addEventListener('keydown', _srKey);
  veil.addEventListener('mousedown', e => { if (e.target === veil) searchClose(); });
  // A press on a row must not take the focus from the field, or the keys stop walking the rows.
  _srList.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
  _srList.addEventListener('mousemove', e => {
    const row = e.target.closest('.sr-row');
    if (row && +row.dataset.i !== _srAt) { _srAt = +row.dataset.i; _srPaintOn(); }
  });
  _srList.addEventListener('click', e => {
    if (e.target.closest('[data-retry]')) { _srLoad(); return; }
    const more = e.target.closest('[data-more]');
    if (more) { _srOpenGroups.add(more.dataset.more); _srShow(); return; }
    const row = e.target.closest('.sr-row');
    if (row) _srPick(_srRows[+row.dataset.i]);
  });
}

function searchIsOpen() { return document.body.classList.contains('searching'); }

function searchOpen() {
  if (isPlayer || isPane || searchIsOpen()) return;
  document.body.classList.add('searching');
  for (const id of ['tb-find', 'wm-find']) document.getElementById(id).classList.add('active');
  _srInput.value = '';
  _srOpenGroups = new Set();
  _srShow();
  _srInput.focus();
  _srLoad();
}

function searchClose() {
  if (!searchIsOpen()) return;
  document.body.classList.remove('searching');
  for (const id of ['tb-find', 'wm-find']) document.getElementById(id).classList.remove('active');
  _srInput.value = '';
  _srList.textContent = '';
  _srRows = [];
  if (_wmQuery) { _wmQuery = ''; worldMapRefresh(); }
}

// Reads the scenes' rooms and notes in the background; what is found meanwhile already shows.
async function _srLoad() {
  if (_srProgress) return;
  _srProgress = { done: 0, total: 0 };
  document.getElementById('sr-bar').classList.add('load');
  _srFailedIds = await searchReadScenes((done, total) => { _srProgress = { done, total }; if (searchIsOpen()) _srShow(true); });
  _srProgress = null;
  document.getElementById('sr-bar').classList.remove('load');
  if (searchIsOpen()) _srShow(true);
}

function _srQuery() { return _srInput.value.trim().toLowerCase(); }

function _srTyped() {
  _srOpenGroups = new Set();
  _srAt = 0;
  if (worldMapOpen) { _wmQuery = _srQuery(); worldMapRefresh(); }
  _srShow();
}

function _srEl(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

// `text` with the query in bold, in its own line's colour.
function _srBold(parent, text, q) {
  const hit = q ? wfHit(text, q) : null;
  if (!hit) { parent.textContent = text; return; }
  const b = _srEl('b', '', text.slice(hit.at, hit.at + hit.len));
  parent.append(text.slice(0, hit.at), b, text.slice(hit.at + hit.len));
}

function _srRow(row, q, i) {
  const e = row.entry, el = _srEl('div', 'sr-row');
  el.dataset.i = i;
  const pic = _srEl('span', e.kind === 'map' ? 'sr-thumb' : 'sr-ti');
  if (e.kind === 'map') { const u = thumbURLs.get(e.id); if (u) pic.style.backgroundImage = 'url("' + u + '")'; }
  else pic.innerHTML = SR_ICON[e.kind === 'road' ? 'road' : e.kind];
  const tx = _srEl('span', 'sr-tx'), l1 = _srEl('span', 'sr-l1'), nm = _srEl('span', 'sr-nm');
  _srBold(nm, e.label || e.name, q && wfRank(e.name, q) >= 0 ? q : '');
  l1.append(nm);
  if (e.kind === 'map' && searchSceneOnTv(e.id)) { const lv = _srEl('span', 'sr-live', t('Live')); lv.prepend(_srEl('i')); l1.append(lv); }
  if (e.where) l1.append(_srEl('span', 'sr-wh', e.where));
  tx.append(l1);
  const snip = q && row.rank === SP_NOTE ? spSnippet(e.text, q) : null;
  if (snip) {
    const sn = _srEl('span', 'sr-sn');
    sn.append(snip.pre, _srEl('b', '', snip.hit), snip.post);
    tx.append(sn);
    el.classList.add('two');
  }
  el.append(pic, tx, _srEl('span', 'sr-act', searchActionWord(row)));
  return el;
}

function _srWarn(cls, text, retry) {
  const w = _srEl('div', 'sr-warn ' + cls);
  const ic = _srEl('span', 'sr-wi');
  if (cls === 'y') ic.innerHTML = SR_ICON.warn;
  w.append(ic, _srEl('span', '', text));
  if (retry) { const r = _srEl('span', 'sr-lnk', t('Try again')); r.dataset.retry = '1'; w.append(r); }
  return w;
}

// `keep` repaints with the keys where they were: a read finishing must not move the pick.
function _srShow(keep) {
  const q = _srQuery(), all = searchEntries(), at = keep ? _srAt : 0;
  _srList.textContent = '';
  _srRows = [];
  if (_srProgress && _srProgress.total) _srList.append(_srWarn('b', t('Reading maps, {done} of {total}', _srProgress), false));
  else if (_srFailedIds.length) _srList.append(_srWarn('y', t.plural(_srFailedIds.length, '{n} map could not be read', '{n} maps could not be read'), true));
  const add = row => { const el = _srRow(row, q, _srRows.length); _srRows.push(row); return el; };
  if (!q) {
    const rec = spRecentRows(searchRecentKeys(), all);
    if (!rec.length) _srList.append(_srEl('div', 'sr-msg', t('Type a name or words from a note')));
    else { _srList.append(_srEl('div', 'sr-gh', t('Recent'))); rec.forEach(en => _srList.append(add({ entry: en, rank: 0 }))); }
  } else {
    const found = spSearch(q, all, _srOpenGroups);
    if (!found.total) _srList.append(_srEl('div', 'sr-msg', t('No results')));
    found.groups.forEach((g, n) => {
      if (n) _srList.append(_srEl('div', 'sr-sep'));
      const h = _srEl('div', 'sr-gh', t(g.label));
      if (g.more) { const m = _srEl('span', 'sr-more', t('{n} more', { n: g.more })); m.dataset.more = g.id; h.append(m); }
      _srList.append(h);
      g.rows.forEach(r => _srList.append(add(r)));
    });
  }
  _srAt = Math.min(at, Math.max(0, _srRows.length - 1));
  _srPaintOn();
}

function _srPaintOn() {
  for (const el of _srList.querySelectorAll('.sr-row')) el.classList.toggle('on', +el.dataset.i === _srAt);
  const on = _srList.querySelector('.sr-row.on');
  if (on) on.scrollIntoView({ block: 'nearest' });
}

function _srPick(row) {
  if (!row) return;
  searchClose();
  searchPick(row);
}

function _srKey(e) {
  e.stopPropagation();
  if (e.code === 'Escape') { searchClose(); return; }
  const step = { ArrowDown: 1, ArrowUp: -1 }[e.code];
  if (step) {
    e.preventDefault();
    if (_srRows.length) { _srAt = Math.max(0, Math.min(_srRows.length - 1, _srAt + step)); _srPaintOn(); }
  } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
    e.preventDefault();
    _srPick(_srRows[_srAt]);
  }
}
