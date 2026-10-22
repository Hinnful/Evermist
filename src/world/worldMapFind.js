'use strict';
// worldMapFind.js — Find on the world map: a large search in the middle of the window over a dimmed map. With nothing
// typed every map shows as a picture; typing turns them into cards for the places, scenes and roads whose names fit,
// best first, with a count. Arrow keys walk the cards, Enter or a click flies to one and picks it, Esc closes. The
// scenes and places that do not match dim on the map behind. The matching itself is worldFindPlan.js.
//
// ⚠ NAMES REACH THE DOM THROUGH textContent ONLY: a name is the DM's own text.

let _wmFindList = null;          // the cards' grid, in the finder
let _wmFindRows = [];            // the cards as shown, in key order
let _wmFindAt = 0;               // the card the keys are on

function worldMapFindInit() {
  const find = document.getElementById('wm-find'), search = document.getElementById('wm-search');
  find.addEventListener('click', () => (document.body.classList.contains('searching') ? worldMapFindClose() : worldMapFindOpen()));
  search.addEventListener('input', _wmFindInput);
  search.addEventListener('keydown', _wmFindKey);
  _wmFindList = document.getElementById('wm-find-list');
  // A press on a card must not take the focus from the field, or the keys stop walking the cards.
  _wmFindList.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
  _wmFindList.addEventListener('mousemove', e => {
    const row = e.target.closest('.wf-row');
    if (row && +row.dataset.i !== _wmFindAt) { _wmFindAt = +row.dataset.i; _wmFindPaintOn(); }
  });
  _wmFindList.addEventListener('click', e => {
    const row = e.target.closest('.wf-row');
    if (row) _wmFindPick(_wmFindRows[+row.dataset.i]);
  });
  // A press on the dimmed map around the window closes the search.
  const finder = document.getElementById('wm-finder');
  finder.addEventListener('mousedown', e => { if (e.target === finder) worldMapFindClose(); });
}

function worldMapFindOpen() {
  document.body.classList.add('searching');
  document.getElementById('wm-find').classList.add('active');
  document.getElementById('wm-search').focus();
  _wmFindShow();
}

function worldMapFindClose() {
  document.body.classList.remove('searching');
  document.getElementById('wm-find').classList.remove('active');
  document.getElementById('wm-search').value = '';
  _wmFindList.textContent = '';
  _wmFindRows = [];
  if (_wmQuery) { _wmQuery = ''; worldMapRefresh(); }
}

function _wmFindInput() {
  _wmQuery = document.getElementById('wm-search').value.trim().toLowerCase();
  worldMapRefresh();
  _wmFindShow();
}

// What the field holds, matched against every place, scene and road, never only what is in view. Nothing typed
// lists every map.
function _wmFindShow() {
  _wmFindList.textContent = '';
  _wmFindAt = 0;
  const count = document.createElement('div');
  count.className = 'wf-n';
  _wmFindList.appendChild(count);
  if (!_wmQuery) {
    _wmFindRows = allScenes.map(s => ({ kind: 'scene', id: s.id, name: s.name, place: sanitizeGroupName(s.group) }));
    count.textContent = t.plural(_wmFindRows.length, '{n} map', '{n} maps');
    _wmFindRows.forEach((r, i) => _wmFindList.appendChild(_wmFindRow(r, i)));
    _wmFindPaintOn();
    return;
  }
  const found = wfSearch(
    _wmQuery,
    _wmPlaces().map(p => ({ name: p.name, count: p.ids.length })),
    allScenes.map(s => ({ id: s.id, name: s.name, place: sanitizeGroupName(s.group) })),
    worldRoadRecords().map(r => ({ uid: r.uid, name: r.name })),
  );
  _wmFindRows = wfFlat(found);
  count.textContent = found.total ? t.plural(found.total, '{n} match', '{n} matches') : t('No match for “{q}”', { q: _wmQuery });
  let i = 0;
  for (const [heading, kind] of [['Groups', 'place'], ['Maps', 'scene'], ['Roads', 'road']]) {
    const rows = _wmFindRows.filter(r => r.kind === kind);
    if (!rows.length) continue;
    const h = document.createElement('div');
    h.className = 'wf-h';
    h.textContent = t(heading);
    _wmFindList.appendChild(h);
    for (const r of rows) _wmFindList.appendChild(_wmFindRow(r, i++));
  }
  _wmFindPaintOn();
}

function _wmFindRow(r, i) {
  const row = document.createElement('div');
  row.className = 'wf-row';
  row.dataset.i = i;
  const ic = document.createElement('span');
  ic.className = 'wf-ic' + (r.kind === 'scene' ? ' thumb' : '');
  if (r.kind === 'scene') { const u = thumbURLs.get(r.id); if (u) ic.style.backgroundImage = 'url("' + u + '")'; }
  else ic.innerHTML = r.kind === 'place' ? WM_ICON_PLACE : WM_ICON_ROAD;
  const nm = document.createElement('span');
  nm.className = 'wf-nm';
  const hit = _wmQuery ? wfHit(r.name, _wmQuery) : null;
  if (hit) {
    nm.append(r.name.slice(0, hit.at));
    const b = document.createElement('b');
    b.textContent = r.name.slice(hit.at, hit.at + hit.len);
    nm.append(b, r.name.slice(hit.at + hit.len));
  } else nm.textContent = r.name;
  const sub = document.createElement('span');
  sub.className = 'wf-sub';
  sub.textContent = r.kind === 'place' ? t.plural(r.count, '{n} map', '{n} maps') : r.kind === 'road' ? t('Road') : (r.place || t('No group'));
  row.append(ic, nm, sub);
  return row;
}

function _wmFindPaintOn() {
  for (const el of _wmFindList.querySelectorAll('.wf-row')) el.classList.toggle('on', +el.dataset.i === _wmFindAt);
  const on = _wmFindList.querySelector('.wf-row.on');
  if (on) on.scrollIntoView({ block: 'nearest' });
}

// Flies to the row and picks it, then puts the field away.
function _wmFindPick(row) {
  if (!row || _wmAnim) return;
  if (row.kind === 'place') worldMapFlyToPlace(row.name);
  else if (row.kind === 'scene') {
    const s = allScenes.find(x => x.id === row.id);
    if (s) {
      const p = _wmPos(s);
      worldMapSelect({ sceneId: s.id, place: '' });
      _wmFly({ cx: p.x, cy: p.y, z: Math.max(_wmCam.z, 1.2) }, 650);
    }
  } else {
    const r = worldRoadByUid(row.uid);
    if (r) {
      const xs = r.vertices.map(v => v.x), ys = r.vertices.map(v => v.y);
      const x = Math.min(...xs), y = Math.min(...ys);
      worldMapSelect({ sceneId: null, place: '', road: r.uid });
      _wmFly(wmPlaceCamera({ x, y, w: Math.max(...xs) - x || 1, h: Math.max(...ys) - y || 1 }, _wmView()), 650);
    }
  }
  worldMapFindClose();
}

// How many cards sit on the first line of the grid, so Up and Down move by a line.
function _wmFindColumns() {
  const rows = _wmFindList.querySelectorAll('.wf-row');
  if (!rows.length) return 1;
  let n = 0;
  for (const r of rows) { if (r.offsetTop !== rows[0].offsetTop) break; n++; }
  return Math.max(1, n);
}

function _wmFindKey(e) {
  e.stopPropagation();
  if (e.code === 'Escape') { worldMapFindClose(); return; }
  const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: _wmFindColumns(), ArrowUp: -_wmFindColumns() }[e.code];
  if (step) {
    if (!_wmFindRows.length) return;
    e.preventDefault();
    _wmFindAt = Math.max(0, Math.min(_wmFindRows.length - 1, _wmFindAt + step));
    _wmFindPaintOn();
  } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
    e.preventDefault();
    _wmFindPick(_wmFindRows[_wmFindAt]);
  }
}
