'use strict';
// mcpRoomsPlan.js — pure rules behind Claude's room tools: percent points turned into map pixels, an outline or a
// cutting line checked, a room found by name and index, an outline replaced with its doors carried, and a room read off
// the floor plan from a point inside it. No DOM. Tested.

const MR = (typeof module !== 'undefined' && module.exports)
  ? Object.assign({}, require('../shapes/shapeDetail.js'), require('../rooms/roomPanel.js'), require('./mcpFogPlan.js'), require('../shapes/roomOps.js'), require('../rooms/vttPlan.js'), require('../shapes/roomPieces.js'))
  : { roomHeads, restoreShapeDetail, sanitizeRoomName, sanitizeRoomDesc, ROOM_DESC_MAX, mcpFogRoomMode, layerInsertIndex, pointInRing, vttDerivePlan, vttProjectToSegment, vttSignedArea };

// read_scene rounds a point to 0.1%, so a wall read back and sent again sits within half of that.
const MCP_ROOM_MATCH_PCT = 0.06;

const _mrR2 = n => Math.round(n * 100) / 100;

// One point, [x, y] or { x, y } in percent of the map, as map pixels; null when it is not one.
function mcpRoomPoint(raw, mapW, mapH) {
  const [x, y] = Array.isArray(raw) ? raw.map(Number) : raw && typeof raw === 'object' ? [Number(raw.x), Number(raw.y)] : [NaN, NaN];
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 100 || y < 0 || y > 100) return null;
  return { x: _mrR2(x / 100 * mapW), y: _mrR2(y / 100 * mapH) };
}

// A list of percent points as map pixels, a point repeating the one before it dropped, or { error }.
function _mrPoints(raw, mapW, mapH, min, what) {
  if (!Array.isArray(raw)) return { error: what + ' must be a list of points [x, y] in percent of the map.' };
  const pts = [];
  for (let i = 0; i < raw.length; i++) {
    const p = mcpRoomPoint(raw[i], mapW, mapH);
    if (!p) return { error: 'Point ' + (i + 1) + ' of ' + what + ' is not [x, y] with both from 0 to 100 (percent of the map).' };
    const last = pts[pts.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) pts.push(p);
  }
  if (pts.length < min) return { error: what + ' needs at least ' + min + ' different points.' };
  return { pts };
}

function _mrCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

// A room's outline as map pixels, or { error }: three points or more, closed on itself, enclosing ground, never crossing.
function mcpRoomOutline(raw, mapW, mapH) {
  const got = _mrPoints(raw, mapW, mapH, 3, 'outline');
  if (got.error) return got;
  const v = got.pts;
  if (v.length > 3 && v[0].x === v[v.length - 1].x && v[0].y === v[v.length - 1].y) v.pop();
  const n = v.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (_mrCross(v[i], v[(i + 1) % n], v[j], v[(j + 1) % n])) return { error: 'The outline crosses itself between points ' + (i + 1) + ' and ' + (j + 1) + '. List the corners in order around the room.' };
    }
  }
  let area = 0;
  for (let i = 0; i < n; i++) { const a = v[i], b = v[(i + 1) % n]; area += a.x * b.y - b.x * a.y; }
  if (Math.abs(area) / 2 < 1) return { error: 'The outline encloses no ground: its points lie on one line.' };
  return { verts: v };
}

// A cutting line of two points or more as map pixels, or { error }.
function mcpRoomLine(raw, mapW, mapH) {
  const got = _mrPoints(raw, mapW, mapH, 2, 'line');
  return got.error ? got : { path: got.pts };
}

// A fog word as a room's mode: hidden by default, as a drawn room starts. null for a word that is not one.
function mcpRoomFog(word) {
  return word === undefined || word === null ? 'shroud' : MR.mcpFogRoomMode(word);
}

const _mrName = s => String(s || '').trim().toLowerCase();

// The room a call names: { index, room } or { error }. The call's index is the room's place in read_scene's rooms list,
// from 1, and picks one of several sharing a name, or a room with none; the `index` returned is its array position.
// Rooms are numbered without their pieces, as read_scene lists them; `index` is the room's head in `polys`.
function mcpRoomFind(polys, name, index, mapName) {
  const all = polys || [], list = MR.roomHeads(all);
  const found = f => (f.room ? { index: all.indexOf(f.room), room: f.room } : f);
  return found(_mrFind(list, name, index, mapName));
}

function _mrFind(list, name, index, mapName) {
  const where = ' on the map "' + mapName + '"';
  if (index !== undefined && index !== null) {
    const i = Number(index) - 1;
    if (!Number.isInteger(i) || i < 0 || i >= list.length) return { error: 'No room has index ' + index + where + '. It has ' + list.length + ' room' + (list.length === 1 ? '' : 's') + (list.length ? ', index 1 to ' + list.length : '') + '.' };
    if (name && _mrName(list[i].name) !== _mrName(name)) return { error: 'The room at index ' + index + ' is called "' + (list[i].name || '') + '", not "' + name + '". read_scene lists the rooms in index order.' };
    return { index: i, room: list[i] };
  }
  if (!_mrName(name)) return { error: 'Name the room, or give its index from read_scene.' };
  const hits = [];
  list.forEach((p, i) => { if (_mrName(p.name) === _mrName(name)) hits.push(i); });
  if (hits.length === 1) return { index: hits[0], room: list[hits[0]] };
  if (!hits.length) return { error: 'No room is called "' + name + '"' + where + '. read_scene lists its rooms.' };
  return { error: 'More than one room is called "' + name + '"' + where + ': index ' + hits.map(h => h + 1).join(', ') + '. Give index too (the room\'s place in read_scene\'s rooms list, from 1).' };
}

// ⚠ A ROOM'S NOTES ARE CUT SILENTLY AT ROOM_DESC_MAX (sanitizeRoomDesc), so Claude's text past it is refused first.
const mcpRoomNotesOver = text => String(text == null ? '' : text).trimEnd().length > MR.ROOM_DESC_MAX;

// A new room's record, the fields a drawn room has, with its notes when there are any. `fallback` names a room
// given no name, as a drawn room is named.
function mcpRoomNew(id, verts, name, notes, mode, fallback) {
  const room = { id, vertices: verts, mode, cornerRadius: 0, name: MR.sanitizeRoomName(name, fallback) };
  const desc = MR.sanitizeRoomDesc(notes);
  if (desc) room.desc = desc;
  return room;
}

// A new room put in the map's rooms where a drawn one would go (layerInsertIndex), edited in place. Answers its
// index from 1, read_scene's numbering, which an insert shifts for every room after it.
function mcpRoomInsert(polys, room, cellSize) {
  const at = MR.layerInsertIndex(polys, room, cellSize);
  polys.splice(at, 0, room);
  return MR.roomHeads(polys).indexOf(room) + 1;
}

// A room's outer ring replaced: { piece, lost }, the piece in the shape applyPieceToShape takes. The same number of
// corners is a DM's drag, every door and curve kept on its wall; any other is matched wall by wall the way a
// repair is, and `lost` counts the doors whose wall went.
function mcpRoomReshape(room, verts, mapW, mapH) {
  const doors = room.doors || [];
  if (verts.length === (room.vertices || []).length) {
    const piece = { vertices: verts, holes: room.holes };
    for (const k of ['cornerRadii', 'handles', 'doors']) if (room[k]) piece[k] = room[k];
    return { piece, lost: 0 };
  }
  const tol = MCP_ROOM_MATCH_PCT / 100 * Math.max(mapW, mapH);
  const out = MR.restoreShapeDetail([room], [verts].concat(room.holes || []), tol);
  const piece = out.pieces[0] || { vertices: verts, holes: room.holes };
  return { piece, lost: doors.length - (piece.doors || []).length };
}

// What a delete would take, and how to go on.
function mcpRoomWouldDelete(room) {
  const doors = (room.doors || []).length, notes = String(room.desc || '').length;
  return 'Would delete the room "' + (room.name || '') + '"' + (notes ? ' with its notes (' + notes + ' character' + (notes === 1 ? '' : 's') + ')' : '')
    + (doors ? ' and its ' + doors + ' door' + (doors === 1 ? '' : 's') : '') + '. Nothing was deleted. Tell the DM what goes and, on their yes, call again with confirmed: true.';
}

// Why a door point found no wall: how far the nearest wall is, in percent of the map's width and in grid squares.
function mcpRoomDoorMiss(distPx, mapW, cell) {
  if (!Number.isFinite(distPx)) return 'Not done: the map has no room with a wall to put a door on.';
  return 'Not done: no wall is near that point. The nearest wall is ' + _mrR2(distPx / mapW * 100) + '% of the map\'s width away ('
    + _mrR2(distPx / cell) + ' grid squares). Give a point on the wall itself.';
}

// How far, in grid squares, a closer's end may sit from the plan's walls before it is refused.
const MCP_CLOSE_SNAP = 0.75;

// A closer's end moved onto the plan: the nearest wall corner within reach, else the nearest point on a wall. Grid squares.
function _mrSnap(q, plan) {
  const lines = (plan.line_of_sight || []).concat((plan.portals || []).map(p => p && p.bounds)).filter(Array.isArray);
  let best = null, bd = Infinity;
  for (const l of lines) for (const n of l) { const d = Math.hypot(n.x - q.x, n.y - q.y); if (d < bd) { bd = d; best = { x: n.x, y: n.y }; } }
  if (bd <= MCP_CLOSE_SNAP) return { at: best };
  for (const l of lines) for (let i = 0; i + 1 < l.length; i++) {
    const pr = MR.vttProjectToSegment(q, l[i], l[i + 1]);
    if (pr.dist < bd) { bd = pr.dist; best = { x: l[i].x + pr.t * (l[i + 1].x - l[i].x), y: l[i].y + pr.t * (l[i + 1].y - l[i].y) }; }
  }
  return bd <= MCP_CLOSE_SNAP ? { at: best } : { miss: bd };
}

const _mrArea = r => Math.abs(MR.vttSignedArea(r));
const _mrIn = (p, r) => MR.pointInRing(p.x, p.y, r);
const _mrMid = r => { const xs = r.map(v => v.x), ys = r.map(v => v.y); return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }; };
// One ring from two derivations: a doorless loop is a room only in the derivation that keeps them.
const _mrSame = (a, b) => { const m = _mrMid(a), n = _mrMid(b); return Math.abs(_mrArea(a) - _mrArea(b)) < 1 && Math.hypot(m.x - n.x, m.y - n.y) < 1; };

// The room under `at` read off a stored floor plan (text). `close` is short lines across openings, each two percent
// points, snapped onto the walls and added to the plan as closers, so the plan's own face walk (vttPlan.js) closes the
// room. Answers { verts, holes, plan, closed } in map pixels, `plan` the text with the closers when any were added, or
// { error }. Every closed wall loop inside the room becomes a hole.
function mcpRoomFromPoint(planText, at, close, mapW, mapH) {
  let plan = null;
  try { plan = JSON.parse(planText); } catch (_) { plan = null; }
  const res = plan && plan.resolution, ppg = Number(res && res.pixels_per_grid);
  if (!(ppg > 0)) return { error: 'this map has no floor plan stored with it, so at cannot find a room. Give outline instead.' };
  const ox = Number(res.map_origin && res.map_origin.x) || 0, oy = Number(res.map_origin && res.map_origin.y) || 0;
  const k = mapW / ((Number(res.map_size && res.map_size.x) * ppg) || mapW);
  const grid = p => ({ x: p.x / k / ppg + ox, y: p.y / k / ppg + oy });
  const pt = mcpRoomPoint(at, mapW, mapH);
  if (!pt) return { error: 'at must be [x, y] with both from 0 to 100 (percent of the map).' };
  const lines = close === undefined ? [] : close;
  if (!Array.isArray(lines)) return { error: 'close must be a list of lines, each two points [x, y] in percent of the map.' };
  const added = [];
  for (let i = 0; i < lines.length; i++) {
    const ends = Array.isArray(lines[i]) && lines[i].length === 2 ? lines[i].map(q => mcpRoomPoint(q, mapW, mapH)) : [null];
    if (ends.some(q => !q)) return { error: 'close line ' + (i + 1) + ' is not two points [x, y] in percent of the map.' };
    const snapped = ends.map(q => _mrSnap(grid(q), plan));
    const miss = snapped.findIndex(q => !q.at);
    if (miss >= 0) return { error: 'end ' + (miss + 1) + ' of close line ' + (i + 1) + ' is ' + _mrR2(snapped[miss].miss) + ' grid squares from the nearest wall; each end must be within ' + MCP_CLOSE_SNAP + ' of a square of one. view_scene shows the walls.' };
    const [a, b] = snapped.map(q => q.at);
    if (Math.hypot(a.x - b.x, a.y - b.y) < 0.05) return { error: 'both ends of close line ' + (i + 1) + ' land on the same spot of a wall.' };
    added.push({ position: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, bounds: [a, b], evermistCloser: true });
  }
  const p2 = Object.assign({}, plan, { portals: (plan.portals || []).concat(added) });
  const d = MR.vttDerivePlan(p2), all = MR.vttDerivePlan(p2, { keepDoorless: true });
  const P = { x: pt.x / k, y: pt.y / k };
  const face = d.rooms.filter(r => _mrIn(P, r)).sort((x, y) => _mrArea(x) - _mrArea(y))[0];
  if (!face) return { error: 'no closed floor area of the plan holds that point. Close each opening around it with close: a short line across it, both ends on its walls.' };
  const solid = all.rooms.filter(r => !d.rooms.some(q => _mrSame(q, r)));
  const loops = solid.concat(d.boundaries).filter(h => _mrArea(h) < _mrArea(face) && !_mrIn(P, h) && h.every(v => _mrIn(v, face) || face.some(f => Math.hypot(f.x - v.x, f.y - v.y) < 0.5)));
  const holes = loops.filter(h => !loops.some(o => o !== h && _mrArea(o) > _mrArea(h) && h.every(v => _mrIn(v, o))));
  const px = r => r.map(v => ({ x: _mrR2(v.x * k), y: _mrR2(v.y * k) }));
  return { verts: px(face), holes: holes.map(px), plan: added.length ? JSON.stringify(p2) : null, closed: added.length };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MCP_ROOM_MATCH_PCT, mcpRoomPoint, mcpRoomOutline, mcpRoomLine, mcpRoomFog, mcpRoomFind,
    mcpRoomNotesOver, mcpRoomNew, mcpRoomInsert, mcpRoomReshape, mcpRoomWouldDelete, mcpRoomDoorMiss, mcpRoomFromPoint, MCP_CLOSE_SNAP };
}
