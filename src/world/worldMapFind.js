'use strict';
// worldMapFind.js — Find on the world map: a field above the toolbar and, under what is typed, a list of the
// places, scenes and roads whose names fit it, best first, with a count. Arrow keys walk the list, Enter or a
// click flies to the row and picks it, Esc closes. The scenes and places that do not match dim on the map while
// the field is open. The matching itself is worldFindPlan.js.
//
// ⚠ NAMES REACH THE DOM THROUGH textContent ONLY: a name is the DM's own text.

let _wmFindList = null;          // the results panel, in the field's group
let _wmFindRows = [];            // the rows as shown, in key order
let _wmFindAt = 0;               // the row the keys are on

function worldMapFindInit() {
  const find = document.getElementById('wm-find'), search = document.getElementById('wm-search');
  find.addEventListener('click', () => (document.body.classList.contains('searching') ? worldMapFindClose() : worldMapFindOpen()));
  search.addEventListener('input', _wmFindInput);
  search.addEventListener('keydown', _wmFindKey);
  _wmFindList = document.createElement('div');
  _wmFindList.id = 'wm-find-list';
  _wmFindList.hidden = true;
  // A press on the list must not take the focus from the field, or the keys stop walking it.
  _wmFindList.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
  _wmFindList.addEventListener('mousemove', e => {
    const row = e.target.closest('.wf-row');
    if (row && +row.dataset.i !== _wmFindAt) { _wmFindAt = +row.dataset.i; _wmFindPaintOn(); }
  });
  _wmFindList.addEventListener('click', e => {
    const row = e.target.closest('.wf-row');
    if (row) _wmFindPick(_wmFindRows[+row.dataset.i]);
  });
  document.getElementById('ctx-wm-search').appendChild(_wmFindList);
}

function worldMapFindOpen() {
  document.body.classList.add('searching');
  document.getElementById('wm-find').classList.add('active');
  document.getElementById('wm-search').focus();
}

function worldMapFindClose() {
  document.body.classList.remove('searching');
  document.getElementById('wm-find').classList.remove('active');
  document.getElementById('wm-search').value = '';
  _wmFindList.hidden = true;
  _wmFindRows = [];
  if (_wmQuery) { _wmQuery = ''; worldMapRefresh(); }
}

function _wmFindInput() {
  _wmQuery = document.getElementById('wm-search').value.trim().toLowerCase();
  worldMapRefresh();
  _wmFindShow();
}

// What the field holds, matched against every place, scene and road, never only what is in view.
function _wmFindShow() {
  _wmFindList.textContent = '';
  if (!_wmQuery) { _wmFindList.hidden = true; _wmFindRows = []; return; }
  const found = wfSearch(
    _wmQuery,
    _wmPlaces().map(p => ({ name: p.name, count: p.ids.length })),
    allScenes.map(s => ({ id: s.id, name: s.name, place: sanitizeGroupName(s.group) })),
    worldRoadRecords().map(r => ({ uid: r.uid, name: r.name })),
  );
  _wmFindRows = wfFlat(found);
  _wmFindAt = 0;
  const count = document.createElement('div');
  count.className = 'wf-n';
  count.textContent = found.total ? t.plural(found.total, '{n} match', '{n} matches') : t('No match for “{q}”', { q: _wmQuery });
  _wmFindList.appendChild(count);
  let i = 0;
  for (const [heading, kind] of [['Places', 'place'], ['Scenes', 'scene'], ['Roads', 'road']]) {
    const rows = _wmFindRows.filter(r => r.kind === kind);
    if (!rows.length) continue;
    const h = document.createElement('div');
    h.className = 'wf-h';
    h.textContent = t(heading);
    _wmFindList.appendChild(h);
    for (const r of rows) _wmFindList.appendChild(_wmFindRow(r, i++));
  }
  _wmFindList.hidden = false;
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
  const hit = wfHit(r.name, _wmQuery);
  if (hit) {
    nm.append(r.name.slice(0, hit.at));
    const b = document.createElement('b');
    b.textContent = r.name.slice(hit.at, hit.at + hit.len);
    nm.append(b, r.name.slice(hit.at + hit.len));
  } else nm.textContent = r.name;
  const sub = document.createElement('span');
  sub.className = 'wf-sub';
  sub.textContent = r.kind === 'place' ? t.plural(r.count, '{n} scene', '{n} scenes') : r.kind === 'road' ? t('Road') : (r.place || t('No place'));
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

function _wmFindKey(e) {
  e.stopPropagation();
  if (e.code === 'Escape') { worldMapFindClose(); return; }
  if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
    if (!_wmFindRows.length) return;
    e.preventDefault();
    _wmFindAt = (_wmFindAt + (e.code === 'ArrowDown' ? 1 : -1) + _wmFindRows.length) % _wmFindRows.length;
    _wmFindPaintOn();
  } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
    e.preventDefault();
    _wmFindPick(_wmFindRows[_wmFindAt]);
  }
}
