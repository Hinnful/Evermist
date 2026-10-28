'use strict';
// mcpRooms.js — Claude's room tools: draw, edit and delete a room, Merge, Cut out and Split, and a door added or
// taken away, on any map the TV does not show. Points are percent of the map, as read_scene gives them.
// ⚠ EVERY CHANGE GOES THROUGH mcpEditMap (mcpMapEdit.js), on its plain copy of the rooms. The app's own kernels
// do the geometry: roomOps.js, shapeDetail.js, doorGeometry.js and shapePlanApplied (shapeCommit.js).

// The map's grid as the DM's tools read it. mcpEditMap has refused a column, so the map is open here or closed.
async function _mcpRoomsGrid(scene) {
  if (_mcpHolder(scene.id) === 'here') return captureGridConfig();
  const rec = await sceneStore.loadScene(scene.id);
  return (rec && rec.gridConfig) || captureGridConfig();
}

// One room tool's call: the map found, `change(d, scene)` run on its rooms, the step recorded. `change` returns a
// refusal's text, or { label, text } for the step and the reply.
async function _mcpRoomsEdit(args, what, change) {
  const found = _mcpScene(args);
  if (found.error) return _mcpNo(found.error);
  const s = found.scene;
  let said = null;
  const edit = await mcpEditMap(s, what, ['rooms'], async d => {
    const r = await change(d, s);
    if (typeof r === 'string') return r;
    said = r;
    return undefined;
  });
  if (edit.no) return edit.no;
  const open = _mcpHolder(s.id) === 'here' ? ' The DM has it open and sees the change now.' : '';
  return mcpDone(said.label + ' on the map "' + s.name + '"', edit.undo, said.text + open);
}

const _mcpRoomPct = (p, d) => '[' + mcpSeeR1(p.x / d.mapWidth * 100) + ', ' + mcpSeeR1(p.y / d.mapHeight * 100) + ']';
const _mcpDoorsGone = n => (n ? ' ' + n + ' door' + (n === 1 ? ' was' : 's were') + ' removed with the wall they sat on.' : '');

// A repair's pieces put in place of their rooms, the way the DM's Merge, Cut out and Split land. Returns the doors lost.
function _mcpRoomsPlan(d, plan, mode) {
  const out = shapePlanApplied(d.polygons, plan, mode, () => d.nextPolygonId++);
  d.polygons = out.list;
  return out.lostDoors;
}

const _mcpRoomsMinArea = async s => roomOpMinArea((await _mcpRoomsGrid(s)).cellSize);

async function _mcpCreateRoom(args) {
  const mode = mcpRoomFog(args.fog);
  if (!mode) return _mcpNo('fog must be hidden, half or revealed.');
  return _mcpRoomsEdit(args, 'drawing a room on it', d => {
    const out = mcpRoomOutline(args.outline, d.mapWidth, d.mapHeight);
    if (out.error) return 'Not done: ' + out.error;
    const id = d.nextPolygonId++;
    const room = mcpRoomNew(id, out.verts, args.room, args.notes, mode, t('Room {n}', { n: id }));
    d.polygons.push(room);
    return { label: 'drew the room "' + room.name + '"',
      text: 'Drew the room "' + room.name + '" (' + mcpSeeFog(mode) + ', index ' + d.polygons.length + ').' };
  });
}

async function _mcpEditRoom(args) {
  if (args.newName === undefined && args.notes === undefined && args.outline === undefined) return _mcpNo('Nothing to change: give newName, notes or outline.');
  return _mcpRoomsEdit(args, 'changing its rooms', (d, s) => {
    const f = mcpRoomFind(d.polygons, args.room, args.index, s.name);
    if (f.error) return 'Not done: ' + f.error;
    const room = f.room, old = room.name || '', done = [];
    let lost = 0;
    if (args.outline !== undefined) {
      const out = mcpRoomOutline(args.outline, d.mapWidth, d.mapHeight);
      if (out.error) return 'Not done: ' + out.error;
      const re = mcpRoomReshape(room, out.verts, d.mapWidth, d.mapHeight);
      applyPieceToShape(room, re.piece);
      lost = re.lost;
      done.push('outline');
    }
    if (args.notes !== undefined) { room.desc = sanitizeRoomDesc(args.notes); done.push('notes'); }
    if (args.newName !== undefined) { room.name = sanitizeRoomName(args.newName, room.name); done.push('name'); }
    const now = room.name !== old ? ' It is now called "' + room.name + '".' : '';
    return { label: 'changed the room "' + old + '"',
      text: 'Changed the ' + done.join(', ') + ' of the room "' + old + '".' + now + _mcpDoorsGone(lost) };
  });
}

async function _mcpDeleteRoom(args) {
  let asked = null;
  const r = await _mcpRoomsEdit(args, 'deleting a room', (d, s) => {
    const f = mcpRoomFind(d.polygons, args.room, args.index, s.name);
    if (f.error) return 'Not done: ' + f.error;
    if (args.confirmed !== true) { asked = mcpRoomWouldDelete(f.room); return asked; }
    d.polygons.splice(f.index, 1);
    return { label: 'deleted the room "' + (f.room.name || '') + '"', text: 'Deleted the room "' + (f.room.name || '') + '" with its notes and doors.' };
  });
  return asked ? _mcpOk(asked) : r;
}

// The rooms a merge names, each a name or { room, index }, in their order in the map: { rooms } or { error }.
function _mcpRoomsNamed(d, s, list) {
  if (!Array.isArray(list) || list.length < 2) return { error: 'Name at least two rooms in rooms.' };
  const at = new Set();
  for (const ref of list) {
    const q = ref && typeof ref === 'object' ? ref : { room: ref };
    const f = mcpRoomFind(d.polygons, q.room, q.index, s.name);
    if (f.error) return f;
    at.add(f.index);
  }
  if (at.size < 2) return { error: 'Those names point at one room. Name at least two different rooms.' };
  return { rooms: [...at].sort((a, b) => a - b).map(i => d.polygons[i]) };
}

async function _mcpMergeRooms(args) {
  return _mcpRoomsEdit(args, 'merging its rooms', async (d, s) => {
    const named = _mcpRoomsNamed(d, s, args.rooms);
    if (named.error) return 'Not done: ' + named.error;
    const hits = named.rooms;
    const out = joinShapes(hits, hits[0], await _mcpRoomsMinArea(s));
    if (out.reason) return out.reason;
    if (out.pieces.length !== 1) return 'Not done: those rooms do not touch or overlap, so they cannot become one room. Move an outline with edit_room until they meet.';
    const names = hits.map(h => '"' + (h.name || '') + '"').join(', ');
    const lost = _mcpRoomsPlan(d, [{ shapes: hits, pieces: out.pieces }], mostHiddenMode(hits.map(h => h.mode)));
    return { label: 'merged the rooms ' + names, text: 'Merged the rooms ' + names + ' into one room, "' + (hits[0].name || '') + '", '
      + mcpSeeFog(hits[0].mode) + '. The others\' notes went with them.' + _mcpDoorsGone(lost) };
  });
}

async function _mcpCutRoom(args) {
  return _mcpRoomsEdit(args, 'cutting one of its rooms', async (d, s) => {
    const f = mcpRoomFind(d.polygons, args.room, args.index, s.name);
    if (f.error) return 'Not done: ' + f.error;
    const shape = mcpRoomOutline(args.outline, d.mapWidth, d.mapHeight);
    if (shape.error) return 'Not done: ' + shape.error;
    if (!shapesOverlap(f.room, shape.verts)) return 'Not done: the shape does not overlap the room "' + (f.room.name || '') + '".';
    const out = trimShapes([f.room], shape.verts, await _mcpRoomsMinArea(s));
    if (out.reason) return out.reason;
    if (!out.groups[0].length) return 'Not done: the shape covers the whole room "' + (f.room.name || '') + '". Use delete_room to remove it.';
    const n = out.groups[0].length;
    const lost = _mcpRoomsPlan(d, [{ shapes: [f.room], pieces: out.groups[0] }], null);
    return { label: 'cut a shape out of the room "' + (f.room.name || '') + '"', text: 'Cut the shape out of the room "' + (f.room.name || '') + '"'
      + (n > 1 ? ', which fell into ' + n + ' rooms; the new ones have plain names.' : '.') + _mcpDoorsGone(lost) };
  });
}

async function _mcpSplitRoom(args) {
  return _mcpRoomsEdit(args, 'splitting one of its rooms', async (d, s) => {
    const f = mcpRoomFind(d.polygons, args.room, args.index, s.name);
    if (f.error) return 'Not done: ' + f.error;
    const line = mcpRoomLine(args.line, d.mapWidth, d.mapHeight);
    if (line.error) return 'Not done: ' + line.error;
    if (!ringPathCrossings(f.room.vertices, line.path).length) return 'Not done: the line does not cross the room "' + (f.room.name || '') + '"\'s walls.';
    const out = cutRing(f.room, line.path, await _mcpRoomsMinArea(s));
    if (out.reason) return out.reason;
    const first = d.polygons.length;
    const lost = _mcpRoomsPlan(d, [{ shapes: [f.room], pieces: out.pieces }], null);
    const made = d.polygons.slice(first).map(p => '"' + p.name + '"');
    return { label: 'split the room "' + (f.room.name || '') + '"', text: 'Split the room "' + (f.room.name || '') + '"'
      + (made.length ? '; the other part is the new room ' + made.join(', ') + ', with the same fog.' : '; the other part was too small to keep.') + _mcpDoorsGone(lost) };
  });
}

// What a Door tool click at the point would do on the map's rooms, or a refusal's text.
async function _mcpDoorAt(d, s, raw) {
  const p = mcpRoomPoint(raw, d.mapWidth, d.mapHeight);
  if (!p) return 'Not done: at must be [x, y] with both from 0 to 100 (percent of the map).';
  const g = await _mcpRoomsGrid(s), cell = Number(g.cellSize) || 0;
  if (!(cell > 0)) return 'Not done: the map has no grid size, and a door is one grid square wide. Set one with set_scene first.';
  const plan = doorClickPlan(d.polygons, p.x, p.y, { cell, slack: cell / 4, size: doorSizeForCell(cell, doorWidthPct, doorDepthPct),
    offsetX: g.offsetX || 0, offsetY: g.offsetY || 0, square: !String(g.mode || '').startsWith('hex') });
  if (plan) return plan;
  let best = Infinity;
  for (const poly of d.polygons) {
    const near = (poly.vertices || []).length >= 3 && nearestOutlinePoint(poly, p.x, p.y);
    if (near && near.dist < best) best = near.dist;
  }
  return mcpRoomDoorMiss(best, d.mapWidth, cell);
}

async function _mcpAddDoor(args) {
  return _mcpRoomsEdit(args, 'adding a door', async (d, s) => {
    const plan = await _mcpDoorAt(d, s, args.at);
    if (typeof plan === 'string') return plan;
    const name = plan.poly.name || '';
    if (plan.action === 'remove') return 'Not done: the room "' + name + '" already has a door there. remove_door takes it away.';
    plan.poly.doors = (plan.poly.doors || []).concat([plan.door]);
    const at = mcpSeeDoorAt(plan.poly, plan.door);
    return { label: 'added a door to the room "' + name + '"', text: 'Added a door to the room "' + name + '", snapped to the grid at ' + _mcpRoomPct(at, d) + '.' };
  });
}

async function _mcpRemoveDoor(args) {
  return _mcpRoomsEdit(args, 'removing a door', async (d, s) => {
    const plan = await _mcpDoorAt(d, s, args.at);
    if (typeof plan === 'string') return plan;
    if (plan.action !== 'remove') return 'Not done: no door is there. read_scene lists each room\'s doors.';
    const name = plan.poly.name || '';
    plan.poly.doors = plan.poly.doors.filter((_, k) => k !== plan.index);
    return { label: 'removed a door from the room "' + name + '"', text: 'Removed a door from the room "' + name + '".' };
  });
}

const MCP_ROOMS_TOOLS = { create_room: _mcpCreateRoom, edit_room: _mcpEditRoom, delete_room: _mcpDeleteRoom, merge_rooms: _mcpMergeRooms,
  cut_room: _mcpCutRoom, split_room: _mcpSplitRoom, add_door: _mcpAddDoor, remove_door: _mcpRemoveDoor };
