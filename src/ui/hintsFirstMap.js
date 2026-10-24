'use strict';
// hintsFirstMap.js — the first-map hints: reveal (a map opened, over the Brush), and for a room just drawn either
// room-edit (it touches no other room) or repair-keys (it does), beside that room. Built on hints.js.
// Every close but a scene switch is read off the state here, on the next repaint.
// Also the next-map hint, which counts TV time on a one-second tick.

const _HF_IDS = ['reveal', 'room-edit', 'repair-keys', 'room-reveal'];
const _HF_GAP = 10, _HF_MARGIN = 8;

let _hfNewId = null;       // the room whose toast is up
let _hfBrushed = false;    // the map opened with a brushed revealed area; read once per open

// Read once when a map opens (hintsMapOpened): any clear pixel in the brush layer, shrunk to 64px so a 10000px map costs nothing.
function hintsScanBrush() {
  _hfBrushed = false;
  if (!baseFogCanvas) return;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(baseFogCanvas, 0, 0, 64, 64);
  const d = g.getImageData(0, 0, 64, 64).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) { _hfBrushed = true; return; }
}

// The room (no material, no light) whose screen box centre is nearest the centre of the map view.
function _hfCentralRoom() {
  const c = document.getElementById('canvas-container').getBoundingClientRect(), mx = (c.left + c.right) / 2, my = (c.top + c.bottom) / 2;
  let best = null, bestD = Infinity;
  for (const p of polygons) {
    if (p.material || p.light) continue;
    let l = Infinity, r = -Infinity, t = Infinity, b = -Infinity;
    for (const v of p.vertices) {
      const s = toScreen(v.x, v.y), q = viewToClient(s.sx, s.sy);
      l = Math.min(l, q.x); r = Math.max(r, q.x); t = Math.min(t, q.y); b = Math.max(b, q.y);
    }
    const d = Math.hypot((l + r) / 2 - mx, (t + b) / 2 - my);
    if (d < bestD) { best = p; bestD = d; }
  }
  return best;
}

// What the map shows now: the brushed area read at open, and the rooms' fog modes live.
function _hfFacts() {
  const rooms = polygons.filter(p => !p.material && !p.light);
  return { revealed: _hfBrushed || rooms.some(p => p.mode !== 'shroud'), rooms: rooms.length,
    shroudRooms: rooms.filter(p => p.mode === 'shroud').length, tvLive: _tvLive() };
}

// Rooms mode and a scene on screen: the DM window's own map, not the world map or a column.
function _hfLive() { return !isPane && !panesActive && !worldMapOpen && !!currentScene && placeMode === 'rooms'; }

const _hfRect = id => { const el = document.getElementById(id), r = el && el.getBoundingClientRect(); return r && r.width ? r : null; };

// The map's window less the dock and the bar, and the rects a toast must also stay off (the minimap, the room's popup).
function _hfClear() {
  const c = document.getElementById('canvas-container').getBoundingClientRect(), dock = _hfRect('dock'), bar = _hfRect('toolbar-bottom');
  return { l: c.left + _HF_MARGIN, t: c.top + _HF_MARGIN, r: Math.min(c.right, dock ? dock.left : c.right) - _HF_MARGIN,
    b: Math.min(c.bottom, bar ? bar.top : c.bottom) - _HF_MARGIN, off: [_hfRect('minimap-panel'), _hfRect('room-fog'), bar, dock].filter(Boolean) };
}

const _hfHit = (a, b) => a.l < b.right && a.r > b.left && a.t < b.bottom && a.b > b.top;

// The toast beside `T` (a client px box): below if it fits, else above, right, left. Below first, because the room's
// popup lands above the room on the next pick and a toast above would jump. Its arrow is on the side facing T and its
// tip lands `_HF_GAP` from T's edge. Returns false when the map has no layout yet.
function _hfPlace(el, T) {
  const area = _hfClear(), box = el.getBoundingClientRect(), W = box.width, H = box.height;
  if (!W || area.r - area.l < W || area.b - area.t < H) return false;
  const z = parseFloat(getComputedStyle(el).zoom) || 1;
  const cx = (T.l + T.r) / 2, cy = (T.t + T.b) / 2, clampX = x => Math.max(area.l, Math.min(area.r - W, x)), clampY = y => Math.max(area.t, Math.min(area.b - H, y));
  const tries = [
    ['below', clampX(cx - W / 2), T.b + _HF_GAP], ['above', clampX(cx - W / 2), T.t - _HF_GAP - H],
    ['right', T.r + _HF_GAP, clampY(cy - H / 2)], ['left', T.l - _HF_GAP - W, clampY(cy - H / 2)],
  ].map(([side, x, y]) => ({ side, x, y, ok: x >= area.l && y >= area.t && x + W <= area.r && y + H <= area.b &&
    !area.off.some(o => _hfHit({ l: x, t: y, r: x + W, b: y + H }, o)) }));
  const p = tries.find(t => t.ok) || tries[0];
  const x = Math.max(area.l, Math.min(area.r - W, p.x)), y = Math.max(area.t, Math.min(area.b - H, p.y));
  const vert = p.side === 'above' || p.side === 'below';
  el.classList.remove('hc-above', 'hc-below', 'hc-right', 'hc-left');
  el.classList.add('hintcall-at', 'hc-' + p.side);
  el.style.left = x / z + 'px';
  el.style.top = y / z + 'px';
  el.style.setProperty('--a', Math.max(12, Math.min((vert ? W : H) - 12, vert ? cx - x : cy - y)) / z + 'px');
}

// The room's box on screen, so the toast follows a pan or a zoom.
function _hfAtRoom(id) {
  return el => {
    const room = polygons.find(p => p.id === id);
    if (!room) return false;
    let l = Infinity, r = -Infinity, t = Infinity, b = -Infinity;
    for (const v of room.vertices) {
      const s = toScreen(v.x, v.y), c = viewToClient(s.sx, s.sy);
      l = Math.min(l, c.x); r = Math.max(r, c.x); t = Math.min(t, c.y); b = Math.max(b, c.y);
    }
    return _hfPlace(el, { l, t, r, b });
  };
}

// The repair icon blinks only where it can be seen: it has a size and its row is not hidden.
function _hfRepairShown() {
  const row = document.getElementById('context-row');
  return !!_hfRect('op-sw') && !!row && getComputedStyle(row).visibility === 'visible';
}

// A room was just committed (commitDrawnShape); the drawing tool stays in hand. `touches`: it overlaps another room.
function hintsRoomDrawn(room, touches) {
  hintClose('room-edit');
  hintClose('repair-keys');
  _hfNewId = null;
  if (touches) {
    _hintShow('repair-keys', 'Merge, cut out or split rooms',
      'Hold Shift while you draw to merge a shape into the rooms it touches, Alt to cut it out, or Ctrl to split them.',
      _hfRepairShown() ? 'op-sw' : 'btn-shape', _hfAtRoom(room.id));
  } else {
    _hintShow('room-edit', 'Edit this room',
      'Pick Select, then double-click the room to move its corners. In there, double-click a wall to add one.',
      'btn-select', _hfAtRoom(room.id));
  }
  if (_hintCur && (_hintCur.id === 'room-edit' || _hintCur.id === 'repair-keys')) _hfNewId = room.id;
}

// From refreshRoomPanel on every repaint, with the selected room or null. An anchor not laid out
// yet leaves its hint unspent, so the next repaint tries again.
function hintsFirstSync(room) {
  const live = _hfLive();
  const select = live && shape === 'select';
  if (!select) hintClose('reveal');
  const cur = _hintCur && _hintCur.id;
  if ((cur === 'room-edit' || cur === 'repair-keys') &&
      (!live || !polygons.some(p => p.id === _hfNewId) ||
       (cur === 'room-edit' && shapeEditMode && selectedPolygonId === _hfNewId) ||
       (cur === 'repair-keys' && SHAPE_FAMILY.indexOf(shape) < 0))) hintClose(cur);
  const f = _hfFacts(), roomReveal = hintRoomRevealDue(f);
  if (cur === 'room-reveal' && (!live || !roomReveal)) hintClose('room-reveal');
  hintsFirstPlace();
  hintsCuesSync();
  if (live && roomReveal && !_hintCur && _hintQuiet()) {
    _hintShow('room-reveal', 'Show a room', 'Click a room, then its clouds to show it to the players.', null, _hfAtRoom(_hfCentralRoom().id));
  }
  if (live && !_hintCur && _hintQuiet() && hintShowOnTvOpenDue(f)) hintsShowOnTvShow();
  if (select && !room && hintRevealDue(f) && !roomReveal && _hintQuiet() && !_hintsSeen().includes('reveal')) {
    _hintShow('reveal', 'Reveal part of the map',
      'Pick the Brush and paint over the map to reveal that part to the players.', 'btn-brush', _hintPlaceOver('btn-brush'));
  }
}

// ⚠ ALSO RUN WHERE THE ROOM'S POPUP IS LAID OUT (refreshRoomSwitcher): it can land after the toast that dodges it.
function hintsFirstPlace() { if (_hintCur && _HF_IDS.includes(_hintCur.id)) _hintReplace(); }

// A scene opened under the toast.
function hintsScreenChanged() { _HF_IDS.forEach(hintClose); _hnmHeld = 0; hintClose('next-map'); }

// ─── Next map: one map on the TV for ten minutes, others waiting ─────────────

let _hintNextMapMs = 10 * 60 * 1000;
let _hnmHeld = 0, _hnmAt = 0;   // ms of unbroken TV time on this map

// The count only runs while the TV is live, a scene is open, the world map is shut and the library holds another map.
function _hnmTick() {
  const now = Date.now(), dt = now - _hnmAt;
  _hnmAt = now;
  if (worldMapOpen || panesActive || !currentScene || !_tvLive()) { _hnmHeld = 0; hintClose('next-map'); return; }
  if (allScenes.length < 2) { _hnmHeld = 0; return; }
  _hnmHeld += Math.min(dt, 5000);   // a sleeping laptop is not time on the TV
  if (_hnmHeld >= _hintNextMapMs && _hintQuiet()) {
    _hintShow('next-map', 'Ready for the next map?', 'Your other maps are in the Campaign. Press M or click here.',
      'btn-world', _hintPlaceBeside('btn-world', true));
  }
}

function hintsNextMapInit() { _hnmAt = Date.now(); setInterval(_hnmTick, 1000); }
