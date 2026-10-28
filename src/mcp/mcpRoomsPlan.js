'use strict';
// mcpRoomsPlan.js — pure rules behind Claude's room tools: percent points turned into map pixels, an outline or a
// cutting line checked, a room found by name and index, and an outline replaced with its doors carried. No DOM. Tested.

const MR = (typeof module !== 'undefined' && module.exports)
  ? Object.assign({}, require('../shapes/shapeDetail.js'), require('../rooms/roomPanel.js'), require('./mcpFogPlan.js'))
  : { restoreShapeDetail, sanitizeRoomName, sanitizeRoomDesc, mcpFogRoomMode };

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
function mcpRoomFind(polys, name, index, mapName) {
  const list = polys || [];
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

// A new room's record, the fields a drawn room has, with its notes when there are any. `fallback` names a room
// given no name, as a drawn room is named.
function mcpRoomNew(id, verts, name, notes, mode, fallback) {
  const room = { id, vertices: verts, mode, cornerRadius: 0, name: MR.sanitizeRoomName(name, fallback) };
  const desc = MR.sanitizeRoomDesc(notes);
  if (desc) room.desc = desc;
  return room;
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MCP_ROOM_MATCH_PCT, mcpRoomPoint, mcpRoomOutline, mcpRoomLine, mcpRoomFog, mcpRoomFind,
    mcpRoomNew, mcpRoomReshape, mcpRoomWouldDelete, mcpRoomDoorMiss };
}
