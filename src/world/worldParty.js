'use strict';
// worldParty.js — the party marker: the one flag on the Campaign that says where the party is. It rides on a map
// (and follows it) or stands on the ground, is dragged by hand, and thins the mist around it. DM-only: the TV never
// shows it. The record is { x, y, scene? } (worldPartyPlan.js), kept in its own key, so no scene gains a field and
// the previous release ignores it.

const WPT_KEY = 'evermist.worldParty';
const WPT_STAR = '<svg width="36" height="44" viewBox="0 0 36 44">' +
  '<path d="M18 2 L21.5 15.5 L34 19 L21.5 22.5 L18 36 L14.5 22.5 L2 19 L14.5 15.5Z" fill="var(--b-solid, #3b82f6)" stroke="#0b1020" stroke-width="1.6" stroke-linejoin="round"/>' +
  '<path d="M18 9 L18 29 M8 19 L28 19" stroke="#fff" stroke-width="1.1" opacity=".7"/>' +
  '<circle cx="18" cy="19" r="3.2" fill="#fff"/><circle cx="18" cy="19" r="8.5" fill="none" stroke="#fff" stroke-width="1" opacity=".55"/></svg>';

let _wpt = null;                 // the record, or null for none
let _wptLoaded = false;
let _wptHost = null;             // #wm-party, inside the world layer
let _wptEl = null;               // the marker's element
let _wptDrag = null;             // { sx, sy, moved, over, pushed }

function _wptLoad() {
  if (_wptLoaded) return;
  _wptLoaded = true;
  try { _wpt = wptClean(JSON.parse(localStorage.getItem(WPT_KEY) || 'null')); } catch (_) { _wpt = null; }
}

function _wptSave() {
  try {
    if (_wpt) localStorage.setItem(WPT_KEY, JSON.stringify(_wpt)); else localStorage.removeItem(WPT_KEY);
  } catch (_) { /* full or blocked */ }
}

// The marker as a backup carries it, or null.
function worldPartyExport() { _wptLoad(); return _wpt ? { ..._wpt } : null; }

// Undo takes the marker with the places and roads: a step holds it as one string.
function worldPartySnapshot() { _wptLoad(); return JSON.stringify(_wpt); }

function worldPartyRestore(snap) {
  _wptLoad();
  let rec = null;
  try { rec = wptClean(JSON.parse(snap)); } catch (_) { /* a step from before the marker held none */ }
  _wpt = rec;
  _wptSave();
}

// The spot the marker stands on. A marker on a map follows it, and keeps its last spot as its own: when the map is
// gone it stands there, free. ⚠ NEVER SAVED WHILE A DRAG IS UNDER WAY: the live spot is not a final one.
function _wptPoint() {
  _wptLoad();
  if (!_wpt) return null;
  let dirty = false, at = { x: _wpt.x, y: _wpt.y };
  if (_wpt.scene) {
    const s = allScenes.find(x => x.id === _wpt.scene), pos = s && wmCleanPos(_wmPos(s));
    if (pos) {
      at = wptAnchor(pos, WM_CARD_H);
      if (_wpt.x !== at.x || _wpt.y !== at.y) { _wpt.x = at.x; _wpt.y = at.y; dirty = true; }
    } else { delete _wpt.scene; dirty = true; }
  }
  if (dirty && !Object.keys(_wmLive).length) _wptSave();
  return at;
}

// Whether the marker already sits on this map.
function worldPartyOn(id) { _wptLoad(); return !!_wpt && _wpt.scene === id; }

function worldPartyDraw() {
  if (!_wptHost) return;
  const p = _wptPoint();
  worldMistParty(p);
  if (!p) { _wptHost.textContent = ''; _wptEl = null; return; }
  if (!_wptEl) {
    _wptEl = document.createElement('div');
    _wptEl.className = 'wp-here';
    _wptEl.innerHTML = '<div class="wp-fix"><div class="wp-shadow"></div><div class="wp-body">' + WPT_STAR + '</div></div>';
    _wptHost.appendChild(_wptEl);
  }
  if (!_wptDrag || !_wptDrag.moved) _wptPlaceEl(p);
}

// A card carried by hand: the marker riding on it goes along, live.
function worldPartyFollow(id, pos) {
  if (!_wpt || _wpt.scene !== id || !_wptEl) return;
  const at = wptAnchor(pos, WM_CARD_H);
  _wptPlaceEl(at);
  worldMistParty(at);
}

function _wptPlaceEl(p) {
  _wptEl.style.left = p.x + 'px';
  _wptEl.style.top = p.y + 'px';
}

// "Put the marker here": on a map (`scene`) at the top edge of its card, or at a point on the ground. The one marker moves.
function worldPartyPlace(where) {
  worldUndoPush();
  _wptLoad();
  if (where.scene) {
    const s = allScenes.find(x => x.id === where.scene), pos = s && wmCleanPos(_wmPos(s));
    if (!pos) return;
    _wpt = { ...wptAnchor(pos, WM_CARD_H), scene: where.scene };
  } else {
    _wpt = wptClean({ x: where.x, y: where.y });
  }
  _wptSave();
  worldPartyDraw();
}

// The Marker tool, Road's twin: armed, the next click on the map puts the marker there (on a map's card, on that map)
// and the bar goes back to Select. Esc and any other tool put it down (worldMapToolKey, setShape).
function worldMapMarkerToolToggle() {
  const was = _wmTool === 'marker';
  setShape('select');
  if (was) return;
  _wmTool = 'marker';
  _wm.classList.add('drawing');
  worldMapRoadButtonSync();
}

function worldMapMarkerDown(e) {
  const g = _wmGrab(e);
  worldPartyPlace(g.kind === 'card' || g.kind === 'lm' ? { scene: g.id } : _wmToWorld(e.clientX, e.clientY));
  setShape('select');
}

function worldPartyRemove() {
  _wptLoad();
  if (!_wpt) return;
  worldUndoPush();
  _wpt = null;
  _wptSave();
  worldPartyDraw();
}

// ─── Dragging ────────────────────────────────────────────────────────────────

// Every map the pointer could land on at this zoom: prints close in, and the diamonds of maps in no group far out.
function _wptCards() {
  const far = _wmCam.z < WM_SPLIT, out = [];
  for (const s of allScenes) {
    const pos = wmCleanPos(_wmPos(s));
    if (!pos) continue;
    if (far && !_wmRoadPos[s.id] && sanitizeGroupName(s.group)) continue;
    out.push(far ? { id: s.id, x: pos.x, y: pos.y, hw: 11 * _wmUz / _wmCam.z, hh: 11 * _wmUz / _wmCam.z }
                 : { id: s.id, x: pos.x, y: pos.y, hw: WM_CARD_W / 2, hh: WM_CARD_H / 2 });
  }
  return out;
}

function _wptLight(id) {
  if (_wptDrag.over === id) return;
  const el = k => _wmEls.get(k + _wptDrag.over);
  if (_wptDrag.over) for (const k of ['c', 'l']) { const e = el(k); if (e) e.classList.remove('drop'); }
  _wptDrag.over = id;
  const e = _wmEls.get((_wmCam.z < WM_SPLIT ? 'l' : 'c') + id);
  if (id && e) e.classList.add('drop');
}

function _wptDown(e) {
  if (e.button !== 0 || _wmTool !== 'select' || worldBackgroundMoving()) return;
  e.stopPropagation();
  e.preventDefault();
  if (_wmAnim) return;
  _wptDrag = { sx: e.clientX, sy: e.clientY, moved: false, over: '', pushed: false };
}

function _wptMove(e) {
  const d = _wptDrag;
  if (!d) return;
  if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
  if (!d.pushed) { worldUndoPush(); d.pushed = true; }
  d.moved = true;
  _wm.classList.add('moving');
  _wptEl.classList.add('drag');
  const w = _wmToWorld(e.clientX, e.clientY);
  d.at = w;
  _wptPlaceEl(w);
  worldMistParty(w);
  _wptLight(wptSceneAt(w, _wptCards(), WPT_HIT_PX / _wmCam.z));
}

function _wptUp() {
  const d = _wptDrag;
  if (!d) return;
  if (!d.moved) { _wptDrag = null; return; }
  const id = d.over;
  _wptLight('');
  _wptDrag = null;
  _wm.classList.remove('moving');
  _wptEl.classList.remove('drag');
  const s = id && allScenes.find(x => x.id === id), pos = s && wmCleanPos(_wmPos(s));
  _wpt = pos ? { ...wptAnchor(pos, WM_CARD_H), scene: id } : wptClean({ x: d.at.x, y: d.at.y });
  _wptSave();
  worldPartyDraw();
}

// ─── An import ───────────────────────────────────────────────────────────────

// A backup's marker, taken only when the library holds none. A map it rode on keeps it when that map came in,
// and a marker on bare ground moves with the layout the way an import's places do.
function worldPartyImport(rec, sceneMap, dx, dy) {
  _wptLoad();
  if (_wpt || !rec) return;
  const out = { x: rec.x + dx, y: rec.y + dy };
  if (rec.scene && sceneMap[rec.scene]) out.scene = sceneMap[rec.scene];
  _wpt = wptClean(out);
  _wptSave();
  if (worldMapOpen) worldPartyDraw();
}

function worldPartyInit() {
  document.getElementById('wm-marker').addEventListener('click', worldMapMarkerToolToggle);
  _wptHost = document.createElement('div');
  _wptHost.id = 'wm-party';
  _wmWorld.insertBefore(_wptHost, document.getElementById('wm-edit'));
  _wptHost.addEventListener('mousedown', e => { if (e.target.closest('.wp-body')) _wptDown(e); });
  _wptHost.addEventListener('contextmenu', e => { if (e.target.closest('.wp-body')) worldMapPartyMenuOpen(e); });
  window.addEventListener('mousemove', _wptMove);
  window.addEventListener('mouseup', _wptUp);
}
