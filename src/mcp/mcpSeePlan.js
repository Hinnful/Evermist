'use strict';
// mcpSeePlan.js — pure rules behind Claude looking at a map: an area in percent turned into pixels, the picture's
// size, the percent grid's step and labels, and a scene's contents read as percent. No DOM. Tested.

const MCP_SEE_MAX_SIDE = 1568;
const MCP_SEE_MIN_SIDE = 800;
// A reply's JPEG stays under this, so the call is far from any limit on the way back to Claude.
const MCP_SEE_MAX_BYTES = 750000;
const MCP_SEE_QUALITY = [0.85, 0.75, 0.65, 0.55, 0.45, 0.35];
const MCP_SEE_MIN_SPAN = 1;
const MCP_SEE_STEPS = [0.1, 0.2, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50];

const mcpSeeR1 = n => Math.round(n * 10) / 10;
const _msR2 = n => Math.round(n * 100) / 100;

// The area asked for as { x, y, w, h } in percent of the map, clipped to it. Nothing given is the whole map.
function mcpSeeArea(raw) {
  if (raw === undefined || raw === null) return { area: { x: 0, y: 0, w: 100, h: 100 } };
  if (typeof raw !== 'object') return { error: 'area must be an object { x, y, w, h } in percent of the map.' };
  const [x, y, w, h] = [raw.x, raw.y, raw.w, raw.h].map(Number);
  if (![x, y, w, h].every(Number.isFinite)) return { error: 'area needs the numbers x, y, w and h, in percent of the map.' };
  const x0 = Math.max(0, x), x1 = Math.min(100, x + w), y0 = Math.max(0, y), y1 = Math.min(100, y + h);
  if (x1 - x0 < MCP_SEE_MIN_SPAN || y1 - y0 < MCP_SEE_MIN_SPAN) {
    return { error: 'area must hold at least ' + MCP_SEE_MIN_SPAN + '% of the map each way inside 0 to 100.' };
  }
  return { area: { x: _msR2(x0), y: _msR2(y0), w: _msR2(x1 - x0), h: _msR2(y1 - y0) } };
}

// The area as whole map pixels: where to crop. Rounded outward, so the edge is never cut short.
function mcpSeePixels(area, mapW, mapH) {
  const sx = Math.min(mapW - 1, Math.floor(area.x / 100 * mapW)), sy = Math.min(mapH - 1, Math.floor(area.y / 100 * mapH));
  const ex = Math.min(mapW, Math.ceil((area.x + area.w) / 100 * mapW)), ey = Math.min(mapH, Math.ceil((area.y + area.h) / 100 * mapH));
  return { sx, sy, sw: Math.max(1, ex - sx), sh: Math.max(1, ey - sy) };
}

// The picture's size: the crop's own size, with its long side held to 1568 and a small crop enlarged to 800 so
// the grid's labels have room.
function mcpSeeOutSize(sw, sh) {
  const long = Math.max(sw, sh), target = Math.min(MCP_SEE_MAX_SIDE, Math.max(MCP_SEE_MIN_SIDE, long));
  return { w: Math.max(1, Math.round(sw * target / long)), h: Math.max(1, Math.round(sh * target / long)) };
}

function mcpSeeShrink(out, k) {
  return { w: Math.max(1, Math.round(out.w * k)), h: Math.max(1, Math.round(out.h * k)) };
}

// The round step, in percent, that puts about ten lines across the area's longer side (in pixels).
function mcpSeeStep(area, mapW, mapH) {
  const span = area.w * mapW >= area.h * mapH ? area.w : area.h;
  let best = MCP_SEE_STEPS[0];
  for (const s of MCP_SEE_STEPS) if (Math.abs(span / s - 10) <= Math.abs(span / best - 10)) best = s;
  return best;
}

// The multiples of `step` inside [from, from + span], as map percent.
function mcpSeeLines(from, span, step) {
  const out = [];
  const a = Math.ceil(from / step - 1e-9), b = Math.floor((from + span) / step + 1e-9);
  for (let k = a; k <= b; k++) out.push(Math.round(k * step * 1000) / 1000);
  return out;
}

const mcpSeeLabel = v => mcpSeeR1(v) + '%';

// Which of the labels at `posPx` fit: left to right, one is kept when it clears the last kept by its width and a gap.
function mcpSeeLabelKeep(posPx, widthPx, gap) {
  let last = -Infinity;
  return posPx.map(p => {
    if (p - last < widthPx + gap) return false;
    last = p;
    return true;
  });
}

// A ring (points in map pixels) as percent points, rounded to 0.1.
function mcpSeeRing(ring, mapW, mapH) {
  return (ring || []).map(v => [mcpSeeR1(v.x / mapW * 100), mcpSeeR1(v.y / mapH * 100)]);
}

// Where a room's name goes: the ring's area centre, or its vertex mean when it has no area.
function mcpSeeAnchor(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length], f = p.x * q.y - q.x * p.y;
    a += f; cx += (p.x + q.x) * f; cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < 1e-6) return { x: ring.reduce((s, p) => s + p.x, 0) / ring.length, y: ring.reduce((s, p) => s + p.y, 0) / ring.length };
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

// A room's rings, outer first, as polyRings has them.
function _msRings(poly) {
  const holes = (poly.holes || []).filter(h => h && h.length >= 3);
  return [poly.vertices || []].concat(holes);
}

// A door's place in map pixels: its fraction along its wall, `edge` counting across every ring in turn.
// A curved wall is read as its chord.
function mcpSeeDoorAt(poly, door) {
  let offset = 0;
  for (const ring of _msRings(poly)) {
    const i = door.edge - offset;
    if (i >= 0 && i < ring.length) {
      const a = ring[i], b = ring[(i + 1) % ring.length], t = Number(door.t) || 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    offset += ring.length;
  }
  return null;
}

// A room's fog as the DM's words for it.
const mcpSeeFog = mode => (mode === 'shroud' ? 'hidden' : mode === 'half' ? 'half' : 'revealed');

function mcpSeeGrid(cfg, mapW) {
  if (!cfg) return { on: false, type: 'square', cellPx: null, cellPercentOfWidth: null };
  const cell = Number(cfg.cellSize) || null;
  return { on: !!cfg.enabled, type: String(cfg.mode || '').startsWith('hex') ? 'hex' : 'square', cellPx: cell,
    cellPercentOfWidth: cell ? _msR2(cell / mapW * 100) : null };
}

// A .dd2vtt's counts, or loaded: false for no plan or text that is not one.
function mcpSeePlanCounts(text) {
  const none = { loaded: false, walls: 0, doors: 0, lights: 0 };
  let plan;
  try { plan = typeof text === 'string' && text.trim() ? JSON.parse(text) : null; } catch { return none; }
  if (!plan || typeof plan !== 'object') return none;
  const n = v => (Array.isArray(v) ? v.length : 0);
  return { loaded: true, walls: n(plan.line_of_sight), doors: n(plan.portals), lights: n(plan.lights) };
}

// Everything read_scene tells, from `i`: { name, group, mapW, mapH, mapType, onTv, gridConfig, polygons, effects, floorPlan }.
function mcpSeeRead(i) {
  const W = i.mapW, H = i.mapH;
  const rooms = (i.polygons || []).map(p => {
    const [outer, ...holes] = _msRings(p);
    const room = { name: p.name || null, notes: p.desc || '', fog: mcpSeeFog(p.mode), outline: mcpSeeRing(outer, W, H) };
    if (holes.length) room.holes = holes.map(h => mcpSeeRing(h, W, H));
    room.doors = (p.doors || []).map(d => mcpSeeDoorAt(p, d)).filter(Boolean).map(pt => [mcpSeeR1(pt.x / W * 100), mcpSeeR1(pt.y / H * 100)]);
    return room;
  });
  const effects = (i.effects || []).map(e => ({ name: e.name || null, material: e.material || null, outline: mcpSeeRing(e.vertices, W, H) }));
  return { name: i.name, group: i.group || null, map: { widthPx: W, heightPx: H, type: i.mapType === 'video' ? 'video' : 'image' },
    onTv: !!i.onTv, grid: mcpSeeGrid(i.gridConfig, W), rooms, effects, floorPlan: mcpSeePlanCounts(i.floorPlan) };
}

// JSON with each point pair on one line, so a room of forty points is not eighty lines.
function mcpSeeJson(obj) {
  return JSON.stringify(obj, null, 2).replace(/\[\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s*\]/g, '[$1, $2]');
}

// The words that go with the picture.
function mcpSeeViewText(v) {
  const names = v.rooms.filter(Boolean);
  return 'Map "' + v.name + '" is ' + v.mapW + ' x ' + v.mapH + ' px. This picture shows x ' + v.area.x + '% to ' + mcpSeeR1(v.area.x + v.area.w) + '% and y '
    + v.area.y + '% to ' + mcpSeeR1(v.area.y + v.area.h) + '% of it (' + v.px.sw + ' x ' + v.px.sh + ' map px), drawn at ' + v.out.w + ' x ' + v.out.h + ' px. '
    + 'The map has no fog here. A percent grid is drawn every ' + v.step + '%, each line labelled with its map percent (x along the top, y down the left). '
    + (v.roomCount ? 'The ' + v.roomCount + ' existing room' + (v.roomCount === 1 ? ' is' : 's are') + ' drawn as thin outlines'
      + (names.length ? ', named: ' + names.join(', ') : '') + '. Corners are drawn as stored, without their rounding.' : 'The map has no rooms yet.')
    + ' Read positions off the grid labels, and zoom in with area to place anything precisely.';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MCP_SEE_MAX_SIDE, MCP_SEE_MIN_SIDE, MCP_SEE_MAX_BYTES, MCP_SEE_QUALITY, MCP_SEE_MIN_SPAN, MCP_SEE_STEPS, mcpSeeR1,
    mcpSeeArea, mcpSeePixels, mcpSeeOutSize, mcpSeeShrink, mcpSeeStep, mcpSeeLines, mcpSeeLabel, mcpSeeLabelKeep, mcpSeeRing, mcpSeeAnchor,
    mcpSeeDoorAt, mcpSeeFog, mcpSeeGrid, mcpSeePlanCounts, mcpSeeRead, mcpSeeJson, mcpSeeViewText };
}
