'use strict';
// lightGeometry.js — pure light kernel: a floor plan's lights in map pixels, and the shapes they
// start as. Tested, dependency-free but for vttPlan.js and polygon-clipping.

var vttScaleRooms;
// Loaded as roomOps.js loads it.
let lightClip;
if (typeof module !== 'undefined' && module.exports) {
  ({ vttScaleRooms } = require('../rooms/vttPlan'));
  lightClip = require('polygon-clipping');
} else {
  lightClip = polygonClipping;
}

const LIGHT_CIRCLE_STEPS = 48;
// A light with no range in the file is a 20 ft light, the size of a torch.
const LIGHT_DEFAULT_RANGE = 4;
// Indoor lights of one room become one polygon when they share this much of the smaller one, or
// when together they fill this much of the room.
const LIGHT_BLOB_SHARE = 0.3;
const LIGHT_ROOM_FILL = 0.9;
// A sliver outside another shape, under this share of the area, counts as covered, so a clip's
// rounding never keeps a ghost.
const LIGHT_COVER_SLIVER = 0.005;

// The plan's lights in the loaded map's pixels, scaled as its rooms are. `plan` is the .dd2vtt text
// or its parsed JSON. Nothing usable gives an empty list, never a throw.
function planLights(plan, mapWidth) {
  let p = plan;
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch (_) { return []; } }
  if (!p || typeof p !== 'object') return [];
  const res = p.resolution || {};
  const ppg = Number(res.pixels_per_grid);
  if (!isFinite(ppg) || ppg <= 0) return [];
  const ox = Number(res.map_origin && res.map_origin.x) || 0;
  const oy = Number(res.map_origin && res.map_origin.y) || 0;
  const sx = Number(res.map_size && res.map_size.x);
  const srcW = isFinite(sx) && sx > 0 ? sx * ppg : 0;
  const rings = [], radii = [];
  for (const l of Array.isArray(p.lights) ? p.lights : []) {
    const pos = l && l.position;
    if (!pos || !isFinite(pos.x) || !isFinite(pos.y)) continue;
    const range = Number(l.range);
    rings.push([{ x: (pos.x - ox) * ppg, y: (pos.y - oy) * ppg }]);
    radii.push((isFinite(range) && range > 0 ? range : LIGHT_DEFAULT_RANGE) * ppg);
  }
  const k = (isFinite(Number(mapWidth)) && Number(mapWidth) > 0 && srcW > 0) ? Number(mapWidth) / srcW : 1;
  return vttScaleRooms(rings, mapWidth, srcW)
    .map((r, i) => ({ x: r[0].x, y: r[0].y, r: radii[i] * k }));
}

function lightCircle(light, steps) {
  const n = steps || LIGHT_CIRCLE_STEPS, out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push({ x: light.x + Math.cos(a) * light.r, y: light.y + Math.sin(a) * light.r });
  }
  return out;
}

function _inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function _area(ring) {
  let s = 0;
  for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; s += a.x * b.y - b.x * a.y; }
  return Math.abs(s) / 2;
}

const _geom = ring => [ring.map(v => [v.x, v.y])];
const _ringOf = pts => pts.slice(0, -1).map(([x, y]) => ({ x, y }));

// Area of a clip result: outer rings less their holes.
function _clipArea(geom) {
  let a = 0;
  for (const poly of geom) {
    a += _area(_ringOf(poly[0]));
    for (let h = 1; h < poly.length; h++) a -= _area(_ringOf(poly[h]));
  }
  return a;
}

// A clip result as shapes: { vertices, holes? }.
function _shapesOf(geom) {
  return geom.map(poly => {
    const s = { vertices: _ringOf(poly[0]) };
    if (poly.length > 1) s.holes = poly.slice(1).map(_ringOf);
    return s;
  });
}

// The smallest room that holds the light, or -1.
function lightRoomIndex(light, rooms) {
  let best = -1;
  (rooms || []).forEach((r, i) => {
    if (_inRing(light.x, light.y, r) && (best < 0 || _area(r) < _area(rooms[best]))) best = i;
  });
  return best;
}

// What a light starts as: { room, shapes }, the shapes being { vertices, holes? } and room the one
// it lights, or -1. Inside a room it lights the whole room when the radius reaches every corner,
// and the part of the room the radius covers when it does not. A light outside every room shines
// round it, stopped by the rooms' walls: its circle less every room. Doors and windows are not
// asked about. `rooms` are rings of {x, y} in the light's own units.
function lightShapeFor(light, rooms) {
  const ri = lightRoomIndex(light, rooms);
  if (ri < 0) {
    if (!rooms || !rooms.length) return { room: -1, shapes: [{ vertices: lightCircle(light) }] };
    const out = lightClip.difference(_geom(lightCircle(light)), ..._allRooms(rooms));
    return { room: -1, shapes: out.length ? _shapesOf(out) : [{ vertices: lightCircle(light) }] };
  }
  const room = rooms[ri];
  if (room.every(v => Math.hypot(v.x - light.x, v.y - light.y) <= light.r)) {
    return { room: ri, shapes: [{ vertices: room.map(v => ({ x: v.x, y: v.y })) }] };
  }
  // The piece the light stands in; a room pinched by the circle can leave several.
  let best = null;
  for (const s of _shapesOf(lightClip.intersection(_geom(room), _geom(lightCircle(light, 96))))) {
    if (_inRing(light.x, light.y, s.vertices)) { best = s; break; }
    if (!best || _area(s.vertices) > _area(best.vertices)) best = s;
  }
  return { room: ri, shapes: [best || { vertices: lightCircle(light) }] };
}

function _allRooms(rooms) { return rooms.map(_geom); }

function _coveredFlags(rings) {
  const covers = (outer, inner) =>
    _clipArea(lightClip.difference(_geom(inner), _geom(outer))) <= _area(inner) * LIGHT_COVER_SLIVER;
  const keep = rings.map(() => true);
  for (let i = 0; i < rings.length; i++) {
    for (let j = 0; j < rings.length; j++) {
      if (i === j || !keep[j] || !covers(rings[j], rings[i])) continue;
      if (covers(rings[i], rings[j]) && i < j) continue;
      keep[i] = false;
      break;
    }
  }
  return keep;
}

// Which of these rings survive once any ring lying wholly inside another is dropped. Of two rings
// covering each other, the first stays.
function dropCoveredLights(rings) {
  const keep = _coveredFlags(rings);
  return rings.filter((_, i) => keep[i]);
}

function _sharesEnough(a, b) {
  const shared = _clipArea(lightClip.intersection(_geom(a), _geom(b)));
  return shared >= LIGHT_BLOB_SHARE * Math.min(_area(a), _area(b));
}

// The shapes a floor plan starts with, as { vertices, holes? }. Indoor lights of one room blob
// together; the rest keep their own shapes. The rules are in ARCHITECTURE.md, "Lights".
function seedLightShapes(lights, rooms) {
  const byRoom = new Map(), outdoor = [];
  for (const l of lights) {
    const { room, shapes } = lightShapeFor(l, rooms);
    if (room < 0) { outdoor.push(...shapes); continue; }
    if (!byRoom.has(room)) byRoom.set(room, []);
    byRoom.get(room).push(shapes[0].vertices);
  }
  const indoor = [];
  for (const [ri, rings] of byRoom) {
    const root = rings.map((_, i) => i);
    const find = i => (root[i] === i ? i : (root[i] = find(root[i])));
    const fills = rings.length > 1 &&
      _clipArea(lightClip.union(...rings.map(_geom))) >= LIGHT_ROOM_FILL * _area(rooms[ri]);
    for (let i = 0; i < rings.length; i++) {
      for (let j = i + 1; j < rings.length; j++) {
        if (fills || _sharesEnough(rings[i], rings[j])) root[find(j)] = find(i);
      }
    }
    const groups = new Map();
    rings.forEach((r, i) => { const g = find(i); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); });
    for (const group of groups.values()) {
      if (group.length === 1) { indoor.push(group[0]); continue; }
      for (const s of _shapesOf(lightClip.union(...group.map(_geom)))) indoor.push(s.vertices);
    }
  }
  const keepIn = _coveredFlags(indoor), keepOut = _coveredFlags(outdoor.map(s => s.vertices));
  return indoor.filter((_, i) => keepIn[i]).map(vertices => ({ vertices }))
    .concat(outdoor.filter((_, i) => keepOut[i]));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    planLights, lightShapeFor, lightRoomIndex, seedLightShapes, lightCircle, dropCoveredLights,
    LIGHT_CIRCLE_STEPS, LIGHT_DEFAULT_RANGE, LIGHT_BLOB_SHARE, LIGHT_ROOM_FILL, LIGHT_COVER_SLIVER,
  };
}
