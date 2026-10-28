'use strict';
// mcpFog.js — Claude's fog tools: a room's fog, a rectangle or circle of fog, the whole map, and the fog's look.
// ⚠ NOTHING HERE REACHES THE TV. Every change goes through mcpEditMap (mcpMapEdit.js), which refuses the TV's map.

const _MCP_FOG_COLOR = '#1a1a2e';

function _mcpFogSay(s) {
  return _mcpHolder(s.id) === 'here' ? ' The DM has it open and sees the change now.' : '';
}

// A shape in fog-canvas pixels painted the way the brush paints: a reveal clears it, a hide fills it, hard-edged
// (the fog's blur is the soft edge, as under the brush).
function _mcpFogPaint(canvas, px, reveal) {
  const ctx = canvas.getContext('2d');
  ctx.save();
  if (px.kind === 'circle') {
    ctx.beginPath();
    ctx.arc(px.cx, px.cy, px.r, 0, Math.PI * 2);
    if (reveal) { ctx.clip(); ctx.clearRect(px.cx - px.r, px.cy - px.r, px.r * 2, px.r * 2); } else { ctx.fillStyle = _MCP_FOG_COLOR; ctx.fill(); }
  } else if (reveal) {
    ctx.clearRect(px.x, px.y, px.w, px.h);
  } else {
    ctx.fillStyle = _MCP_FOG_COLOR;
    ctx.fillRect(px.x, px.y, px.w, px.h);
  }
  ctx.restore();
}

async function _mcpSetRoomFog(args) {
  const found = _mcpScene(args);
  if (found.error) return _mcpNo(found.error);
  const s = found.scene;
  const mode = mcpFogRoomMode(args.fog);
  if (!mode) return _mcpNo('fog must be hidden, half or revealed.');
  let said = '';
  const edit = await mcpEditMap(s, 'changing its rooms\' fog', ['rooms'], d => {
    const hit = mcpFogFindRooms(d.polygons, args.rooms);
    if (hit.error) return hit.error;
    for (const i of hit.index) d.polygons[i].mode = mode;
    said = hit.index.map(i => '"' + d.polygons[i].name + '"').join(', ');
  });
  if (edit.no) return edit.no;
  return mcpDone('set the fog of ' + said + ' in the map "' + s.name + '"', edit.undo,
    'Set ' + said + ' to ' + args.fog.trim().toLowerCase() + ' in the map "' + s.name + '".' + _mcpFogSay(s));
}

async function _mcpSetFogArea(args) {
  const found = _mcpScene(args);
  if (found.error) return _mcpNo(found.error);
  const s = found.scene;
  const dir = args.action === 'reveal' ? true : args.action === 'hide' ? false : null;
  if (dir === null) return _mcpNo('action must be reveal or hide.');
  const area = mcpFogArea(args.rect, args.circle);
  if (area.error) return _mcpNo(area.error);
  const rooms = (await _mcpSceneRecord(s.id)).polygons || [];
  let over = [];
  const edit = await mcpEditMap(s, 'changing its fog', ['fog'], d => {
    const px = mcpFogPixels(area.shape, d.mapWidth, d.mapHeight, FOG_SCALE);
    if (!px) return 'That area lies outside the map. Positions are percent of the map, 0 to 100.';
    _mcpFogPaint(d.fog, px, dir);
    over = mcpFogRoomsOverriding(rooms, mcpFogBox(area.shape, d.mapWidth, d.mapHeight), dir);
  });
  if (edit.no) return edit.no;
  const word = dir ? 'revealed' : 'hidden';
  const keep = over.length ? ' A room keeps its own fog over its ground, so ' + over.map(n => '"' + n + '"').join(', ') +
    ' still shows its own state there; use set_room_fog to change a room.' : '';
  return mcpDone(word + ' part of the map "' + s.name + '"', edit.undo,
    'The ' + (area.shape.kind === 'rect' ? 'rectangle' : 'circle') + ' is ' + word + ' in the map "' + s.name + '".' + keep + _mcpFogSay(s));
}

async function _mcpSetFogAll(args) {
  const found = _mcpScene(args);
  if (found.error) return _mcpNo(found.error);
  const s = found.scene;
  const dir = args.action === 'reveal' ? true : args.action === 'hide' ? false : null;
  if (dir === null) return _mcpNo('action must be reveal or hide.');
  const edit = await mcpEditMap(s, 'changing its fog', ['fog', 'rooms'], d => {
    const ctx = d.fog.getContext('2d');
    if (dir) ctx.clearRect(0, 0, d.fog.width, d.fog.height);
    else { ctx.fillStyle = _MCP_FOG_COLOR; ctx.fillRect(0, 0, d.fog.width, d.fog.height); }
    d.polygons.forEach(p => { p.mode = dir ? 'reveal' : 'shroud'; });
  });
  if (edit.no) return edit.no;
  const word = dir ? 'revealed' : 'hidden';
  return mcpDone(word + ' the whole map "' + s.name + '"', edit.undo,
    'The whole map "' + s.name + '" is ' + word + ', every room included.' + _mcpFogSay(s));
}

async function _mcpSetFogLook(args) {
  const found = _mcpScene(args);
  if (found.error) return _mcpNo(found.error);
  const s = found.scene;
  const key = args.preset === undefined ? undefined : mcpFogPresetKey(args.preset);
  const hex = args.tint === undefined ? undefined : mcpCleanHex(args.tint);
  if (key === null) return _mcpNo('preset must be slow, medium or fast, the drift names in Scene control.');
  if (hex === null) return _mcpNo('tint must be a hex colour such as #8899aa.');
  if (key === undefined && hex === undefined) return _mcpNo('Nothing to change: give preset or tint.');
  const edit = await mcpEditMap(s, 'changing its fog look', ['fogSettings'], d => {
    if (key) d.fogSettings.anim = mcpFogApplyPreset(d.fogSettings.anim, ANIM_PRESETS[key]);
    if (hex) d.fogSettings.pickedHex = hex;
  });
  if (edit.no) return edit.no;
  const said = [key && Object.keys(MCP_FOG_PRESET_KEY).find(k => MCP_FOG_PRESET_KEY[k] === key) + ' drift', hex && 'tint ' + hex].filter(Boolean).join(' and ');
  return mcpDone('set the fog look of the map "' + s.name + '"', edit.undo, 'Set the fog of the map "' + s.name + '" to ' + said + '.' + _mcpFogSay(s));
}

const MCP_FOG_TOOLS = { set_room_fog: _mcpSetRoomFog, set_fog_area: _mcpSetFogArea, set_fog_all: _mcpSetFogAll, set_fog_look: _mcpSetFogLook };
