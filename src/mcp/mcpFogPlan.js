'use strict';
// mcpFogPlan.js — pure rules behind Claude setting a map's fog: a room's fog word, rooms found by name, a rectangle
// or circle in percent turned into fog-canvas pixels and clipped at the map's edge, and a drift preset by the name the
// panel shows. No DOM. Tested.

// The words a call uses for a room's fog, as the app stores them (shroud, half, reveal).
const MCP_FOG_ROOM_MODE = { hidden: 'shroud', half: 'half', revealed: 'reveal' };

// The panel's names for the drift presets, each the key of ANIM_PRESETS (fogControls.js).
const MCP_FOG_PRESET_KEY = { slow: 'calm', medium: 'default', fast: 'fast' };

function mcpFogRoomMode(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return MCP_FOG_ROOM_MODE[s] || null;
}

// The ANIM_PRESETS key for a name such as "slow", "Medium drift" or the key itself, else null.
function mcpFogPresetKey(raw) {
  const s = String(raw || '').trim().toLowerCase().replace(/\s+drift$/, '');
  if (MCP_FOG_PRESET_KEY[s]) return MCP_FOG_PRESET_KEY[s];
  return Object.values(MCP_FOG_PRESET_KEY).includes(s) ? s : null;
}

// The animation block with a preset's numbers on it and the movement on, as the panel's preset buttons leave it.
// `preset` is one ANIM_PRESETS entry (speed in percent).
function mcpFogApplyPreset(anim, preset) {
  return { ...anim, enabled: true, speed: preset.speed / 100, drift: preset.drift, morph: preset.morph,
    warpStr: preset.warpStr, warpRad: preset.warpRad, pulse: preset.pulse };
}

// Rooms by name, case and edge spaces ignored. { index: [...polygon indexes], error } where an error says which name
// no room has, or which two rooms share.
function mcpFogFindRooms(polys, names) {
  if (!Array.isArray(names) || !names.length) return { error: 'Give the names of the rooms in rooms.' };
  const key = n => String(n || '').trim().toLowerCase();
  const index = [];
  for (const raw of names) {
    const q = key(raw);
    const hits = q ? polys.map((p, i) => (key(p.name) === q ? i : -1)).filter(i => i >= 0) : [];
    if (!hits.length) return { error: 'No room is called "' + raw + '". read_scene lists the rooms.' };
    if (hits.length > 1) return { error: 'More than one room is called "' + raw + '". Ask the DM to rename one in Evermist.' };
    if (!index.includes(hits[0])) index.push(hits[0]);
  }
  return { index };
}

const _isNum = v => typeof v === 'number' && Number.isFinite(v);

// A call's area read into { shape } in percent of the map, or { error }. A rectangle { x, y, w, h } or a circle
// { x, y, r } with r in percent of the map's width; exactly one.
function mcpFogArea(rect, circle) {
  if (rect && circle) return { error: 'Give a rect or a circle, not both.' };
  if (!rect && !circle) return { error: 'Give a rect { x, y, w, h } or a circle { x, y, r }, in percent of the map.' };
  if (rect) {
    if (![rect.x, rect.y, rect.w, rect.h].every(_isNum)) return { error: 'rect needs numbers x, y, w and h, in percent of the map.' };
    if (rect.w <= 0 || rect.h <= 0) return { error: 'rect needs a width and a height above 0.' };
    return { shape: { kind: 'rect', x: rect.x, y: rect.y, w: rect.w, h: rect.h } };
  }
  if (![circle.x, circle.y, circle.r].every(_isNum)) return { error: 'circle needs numbers x, y and r, in percent of the map (r is a share of the map\'s width).' };
  if (circle.r <= 0) return { error: 'circle needs a radius above 0.' };
  return { shape: { kind: 'circle', x: circle.x, y: circle.y, r: circle.r } };
}

// A shape in percent as fog-canvas pixels (the canvas is the map at 1/scale), a rectangle clipped to the canvas.
// Null when nothing of it lies on the map.
function mcpFogPixels(shape, mapW, mapH, scale) {
  const fw = Math.ceil(mapW / scale), fh = Math.ceil(mapH / scale);
  const px = (pct, size) => pct / 100 * size / scale;
  if (shape.kind === 'circle') {
    const cx = px(shape.x, mapW), cy = px(shape.y, mapH), r = px(shape.r, mapW);
    const nx = Math.max(0, Math.min(fw, cx)), ny = Math.max(0, Math.min(fh, cy));
    if (Math.hypot(cx - nx, cy - ny) >= r) return null;
    return { kind: 'circle', cx, cy, r };
  }
  const x0 = Math.max(0, px(shape.x, mapW)), y0 = Math.max(0, px(shape.y, mapH));
  const x1 = Math.min(fw, px(shape.x + shape.w, mapW)), y1 = Math.min(fh, px(shape.y + shape.h, mapH));
  if (x1 <= x0 || y1 <= y0) return null;
  return { kind: 'rect', x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Rooms whose own fog will still win over the painted area, by name: the painted fog sits under every room,
// so a hidden room keeps hiding after a reveal, and a revealed or half room keeps showing after a hide.
// `box` is the area in map pixels { x0, y0, x1, y1 }.
function mcpFogRoomsOverriding(polys, box, reveal) {
  const names = [];
  for (const p of polys) {
    if (reveal ? p.mode !== 'shroud' : p.mode === 'shroud') continue;
    const v = p.vertices || [];
    if (v.length < 3) continue;
    const xs = v.map(q => q.x), ys = v.map(q => q.y);
    if (Math.min(...xs) < box.x1 && Math.max(...xs) > box.x0 && Math.min(...ys) < box.y1 && Math.max(...ys) > box.y0) names.push(p.name || '(unnamed room)');
  }
  return names;
}

// The area in map pixels, for mcpFogRoomsOverriding, from a shape in percent.
function mcpFogBox(shape, mapW, mapH) {
  const X = p => p / 100 * mapW, Y = p => p / 100 * mapH;
  if (shape.kind === 'circle') {
    const r = X(shape.r), cx = X(shape.x), cy = Y(shape.y);
    return { x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r };
  }
  return { x0: X(shape.x), y0: Y(shape.y), x1: X(shape.x + shape.w), y1: Y(shape.y + shape.h) };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MCP_FOG_ROOM_MODE, MCP_FOG_PRESET_KEY, mcpFogRoomMode, mcpFogPresetKey, mcpFogApplyPreset, mcpFogFindRooms,
    mcpFogArea, mcpFogPixels, mcpFogRoomsOverriding, mcpFogBox };
}
