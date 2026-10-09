'use strict';
// worldMapPlan.js — the pure rules of the world map: where scenes start, the polygon of a place and
// which scenes it holds, and the camera. Positions are the CENTRE of a scene's card, in world units.

// A place is built like a room, so the room's own geometry draws and measures it. fogGeometry.js loads
// first in the browser; here it is required, as shapeHit.js does.
var roundEffectRing, flattenRing;
if (typeof module !== 'undefined' && module.exports) ({ roundEffectRing, flattenRing } = require('../fog/fogGeometry'));

const WM_CARD_W = 110, WM_CARD_H = 77;
const WM_PAD = 34, WM_LABEL = 22;
const WM_SPLIT = 0.75;                  // below this zoom the scenes carry no names and the places do
const WM_ZOOM_MIN = 0.06, WM_ZOOM_MAX = 5;
const WM_STEP_X = 132, WM_STEP_Y = 100;

function _wmHas(s) {
  const p = s && s.worldPos;
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

// A stored position as a clean { x, y }, or null for anything else.
function wmCleanPos(raw) {
  return _wmHas({ worldPos: raw }) ? { x: raw.x, y: raw.y } : null;
}

// Where a block of restored positions must move so it sits right of what is already placed.
function wmBesideOffset(existing, incoming) {
  if (!existing || !existing.length || !incoming || !incoming.length) return { dx: 0, dy: 0 };
  const e = _wmBounds(existing), i = _wmBounds(incoming);
  return { dx: Math.round(e.x1 + WM_CARD_W + 400 - i.x0), dy: Math.round(e.y0 - i.y0) };
}

function _wmGroupOf(s) { return String((s && s.group) || ''); }

// The grid a group of n scenes takes, centred on (cx, cy).
function _wmGridAround(ids, cx, cy) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(ids.length * 1.5)));
  const rows = Math.ceil(ids.length / cols);
  const out = {};
  ids.forEach((id, i) => {
    out[id] = {
      x: Math.round(cx + ((i % cols) - (cols - 1) / 2) * WM_STEP_X),
      y: Math.round(cy + (Math.floor(i / cols) - (rows - 1) / 2) * WM_STEP_Y),
    };
  });
  return { out, w: (cols - 1) * WM_STEP_X + WM_CARD_W, h: (rows - 1) * WM_STEP_Y + WM_CARD_H };
}

function _wmBounds(points) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x0, y0, x1, y1 };
}

// Every scene with no position, answered as { id: {x, y} }. With nothing placed yet each group is a
// grid around its own point, the groups sit in a grid of their own, and ungrouped scenes form a row
// below. Once something is placed, a late arrival goes under its group, or under the whole layout.
function wmPlanPositions(scenes) {
  const list = scenes || [];
  const missing = list.filter(s => !_wmHas(s));
  if (!missing.length) return {};
  const placed = list.filter(_wmHas);
  return placed.length ? _wmLateArrivals(list, missing, placed) : _wmFirstLayout(missing);
}

function _wmFirstLayout(scenes) {
  const names = [];
  for (const s of scenes) { const g = _wmGroupOf(s); if (g && !names.includes(g)) names.push(g); }
  const sizes = names.map(n => _wmGridAround(scenes.filter(s => _wmGroupOf(s) === n).map(s => s.id), 0, 0));
  const cellW = Math.max(0, ...sizes.map(g => g.w)) + 2 * WM_PAD + 300;
  const cellH = Math.max(0, ...sizes.map(g => g.h)) + 2 * WM_PAD + 300;
  const gcols = Math.max(1, Math.ceil(Math.sqrt(names.length)));
  const out = {};
  names.forEach((n, i) => {
    const ids = scenes.filter(s => _wmGroupOf(s) === n).map(s => s.id);
    Object.assign(out, _wmGridAround(ids, (i % gcols) * cellW, Math.floor(i / gcols) * cellH).out);
  });
  const loose = scenes.filter(s => !_wmGroupOf(s));
  const below = names.length ? (Math.ceil(names.length / gcols) - 0.5) * cellH + WM_CARD_H : 0;
  loose.forEach((s, i) => { out[s.id] = { x: i * WM_STEP_X, y: Math.round(below) }; });
  return out;
}

function _wmLateArrivals(all, missing, placed) {
  const out = {};
  const rowBelow = (pts, ids) => {
    const b = _wmBounds(pts);
    ids.forEach((id, i) => { out[id] = { x: Math.round(b.x0 + i * WM_STEP_X), y: Math.round(b.y1 + WM_STEP_Y) }; });
  };
  const byGroup = {};
  for (const s of missing) (byGroup[_wmGroupOf(s)] = byGroup[_wmGroupOf(s)] || []).push(s.id);
  const rest = [];
  for (const g of Object.keys(byGroup)) {
    const mates = g ? placed.filter(s => _wmGroupOf(s) === g).map(s => s.worldPos) : [];
    if (mates.length) rowBelow(mates, byGroup[g]); else rest.push(...byGroup[g]);
  }
  if (rest.length) rowBelow(placed.map(s => s.worldPos), rest);
  return out;
}

// The outline of a place: its scenes' cards, the name above them, and a margin. Null for none.
function wmHullRect(positions) {
  if (!positions || !positions.length) return null;
  const b = _wmBounds(positions);
  const x0 = b.x0 - WM_CARD_W / 2, y0 = b.y0 - WM_CARD_H / 2 - WM_LABEL;
  const x1 = b.x1 + WM_CARD_W / 2, y1 = b.y1 + WM_CARD_H / 2;
  return { x: x0 - WM_PAD, y: y0 - WM_PAD, w: x1 - x0 + 2 * WM_PAD, h: y1 - y0 + 2 * WM_PAD };
}

function wmRectCentre(r) { return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }

// ─── Places are polygons ─────────────────────────────────────────────────────
// A place is a named polygon in world units. A scene belongs to the place whose polygon holds the
// whole of its card, and to none the moment one pixel of the card is outside.

function wmCardRect(pos) {
  return { x: pos.x - WM_CARD_W / 2, y: pos.y - WM_CARD_H / 2, w: WM_CARD_W, h: WM_CARD_H };
}

function _wmOnSegment(p, a, b) {
  return Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) < 1e-9 &&
         p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);
}

// A point on a wall counts as inside, so a card flush with a wall is in.
function wmPointInPoly(p, verts) {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const a = verts[i], b = verts[j];
    if (_wmOnSegment(p, a, b)) return true;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function _wmCross(a, b, c) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }

// Two segments that properly cross, not merely touch.
function _wmSegCross(a, b, c, d) {
  const d1 = _wmCross(a, b, c), d2 = _wmCross(a, b, d), d3 = _wmCross(c, d, a), d4 = _wmCross(c, d, b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// The whole rectangle inside the polygon: its corners, edge middles and centre in, no wall across it, no corner of the polygon
// poking into it. A polygon with a notch cuts a card out even with all four of its corners inside.
function wmRectInPoly(r, verts) {
  if (!verts || verts.length < 3) return false;
  const cs = [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
  const mx = r.x + r.w / 2, my = r.y + r.h / 2;
  const probes = [...cs, { x: mx, y: my }, { x: mx, y: r.y }, { x: r.x + r.w, y: my }, { x: mx, y: r.y + r.h }, { x: r.x, y: my }];
  if (!probes.every(c => wmPointInPoly(c, verts))) return false;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i], b = verts[(i + 1) % verts.length];
    for (let k = 0; k < 4; k++) if (_wmSegCross(a, b, cs[k], cs[(k + 1) % 4])) return false;
    if (a.x > r.x && a.x < r.x + r.w && a.y > r.y && a.y < r.y + r.h) return false;
  }
  return true;
}

function wmPolyArea(verts) {
  let a = 0;
  for (let i = 0; i < verts.length; i++) { const p = verts[i], q = verts[(i + 1) % verts.length]; a += p.x * q.y - q.x * p.y; }
  return Math.abs(a) / 2;
}

function wmPolyBounds(verts) {
  const b = _wmBounds(verts);
  return { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 };
}

// The middle of the area, or of the bounding box for a polygon with none.
function wmPolyCentre(verts) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < verts.length; i++) {
    const p = verts[i], q = verts[(i + 1) % verts.length], f = p.x * q.y - q.x * p.y;
    a += f; cx += (p.x + q.x) * f; cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < 1e-6) return wmRectCentre(wmPolyBounds(verts));
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

function wmRectShape(x0, y0, x1, y1) {
  const l = Math.min(x0, x1), r = Math.max(x0, x1), t = Math.min(y0, y1), b = Math.max(y0, y1);
  return [{ x: l, y: t }, { x: r, y: t }, { x: r, y: b }, { x: l, y: b }].map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }));
}

function wmCircleShape(cx, cy, r, n) {
  const k = n || 40;
  return Array.from({ length: k }, (_, i) => ({
    x: Math.round(cx + r * Math.cos(2 * Math.PI * i / k)), y: Math.round(cy + r * Math.sin(2 * Math.PI * i / k)),
  }));
}

// A stored shape as clean vertices, or null: at least three points, every one finite.
function wmCleanShape(raw) {
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > 400) return null;
  const out = [];
  for (const p of raw) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

const _wmNum = v => typeof v === 'number' && Number.isFinite(v);

// A stored place as a clean record { vertices, cornerRadius?, cornerRadii?, handles? }, the fields a
// room carries for its outline, or null. A bare array of points is a place from before rounding.
function wmCleanPlace(raw) {
  if (Array.isArray(raw)) raw = { vertices: raw };
  if (!raw || typeof raw !== 'object') return null;
  const vertices = wmCleanShape(raw.vertices);
  if (!vertices) return null;
  const out = { vertices };
  if (_wmNum(raw.cornerRadius) && raw.cornerRadius > 0) out.cornerRadius = raw.cornerRadius;
  if (Array.isArray(raw.cornerRadii) && raw.cornerRadii.length === vertices.length &&
      raw.cornerRadii.every(r => r === null || (_wmNum(r) && r >= 0))) out.cornerRadii = raw.cornerRadii.slice();
  const okH = h => h === null || (h && ['ix', 'iy', 'ox', 'oy'].every(k => _wmNum(h[k])));
  if (Array.isArray(raw.handles) && raw.handles.length === vertices.length && raw.handles.every(okH)) {
    out.handles = raw.handles.map(h => (h ? { ix: h.ix, iy: h.iy, ox: h.ox, oy: h.oy } : null));
  }
  return out;
}

// The outline a place really has, as points: corners rounded and walls curved, as a room's is.
function wmOutline(rec) {
  const v = rec.vertices, h = rec.handles || null;
  const rounded = rec.cornerRadius > 0 || (rec.cornerRadii && rec.cornerRadii.some(r => r > 0));
  if (rounded) return roundEffectRing(v, rec.cornerRadius || 0, rec.cornerRadii || null, 0, h);
  return h ? flattenRing(v, h, 0) : v;
}

// `shapes` is { name: outline points }, null-prototype. The place a card belongs to: the smallest polygon that
// holds all of it, the later one on a tie; '' for none.
function wmPlaceOf(rect, shapes) {
  let best = '', area = Infinity;
  for (const name of Object.keys(shapes || {})) {
    if (!wmRectInPoly(rect, shapes[name])) continue;
    const a = wmPolyArea(shapes[name]);
    if (a <= area) { best = name; area = a; }
  }
  return best;
}

// The place notes' twin: the places of a campaign.json, each a clean record, with `broken` set when a
// `placeShapes` is not a plain object or holds a shape that is not one.
function wmParseShapes(raw) {
  const shapes = Object.create(null);
  if (raw == null) return { shapes, broken: false };
  let obj = null;
  try { obj = JSON.parse(raw); } catch (_) { return { shapes, broken: false }; }
  if (!obj || typeof obj !== 'object' || !Object.prototype.hasOwnProperty.call(obj, 'placeShapes')) return { shapes, broken: false };
  const src = obj.placeShapes;
  if (!src || typeof src !== 'object' || Array.isArray(src)) return { shapes, broken: true };
  let broken = false;
  for (const k of Object.keys(src)) {
    const c = wmCleanPlace(src[k]);
    if (c) shapes[k] = c; else broken = true;
  }
  return { shapes, broken };
}

// A spot inside the polygon where a card fits and touches no card in `taken` (rects), scanned
// row by row, or null when there is none.
function wmSlotInPoly(verts, taken) {
  const b = wmPolyBounds(verts);
  for (let y = b.y + WM_CARD_H / 2; y <= b.y + b.h; y += 40) {
    for (let x = b.x + WM_CARD_W / 2; x <= b.x + b.w; x += 40) {
      const r = wmCardRect({ x, y });
      if (!wmRectInPoly(r, verts)) continue;
      const hit = (taken || []).some(t => r.x < t.x + t.w + 16 && t.x < r.x + r.w + 16 && r.y < t.y + t.h + 16 && t.y < r.y + r.h + 16);
      if (!hit) return { x: Math.round(x), y: Math.round(y) };
    }
  }
  return null;
}

// Where a picked place's name goes: just inside its highest corner.
function wmLabelSpot(verts) {
  let top = verts[0];
  for (const v of verts) if (v.y < top.y || (v.y === top.y && v.x < top.x)) top = v;
  return top;
}

// ─── The name plate ──────────────────────────────────────────────────────────
// A place's plate sits at the top left, a fixed gap from the walls: of every spot the whole plate fits in, the one
// nearest the top-left corner of the place's bounds (smallest x + y), the higher one on a tie. Answers { x, y, w }
// with the top-left of the plate and the width it can have, or null. `minW` is the narrowest plate worth showing.
function wmPlateSpot(outline, w, h, gap, minW) {
  if (!outline || outline.length < 3) return null;
  const b = wmPolyBounds(outline), step = Math.max(3, Math.min(h / 4, gap / 2));
  const room = (x, y, ww) => wmRectInPoly({ x: x - gap, y: y - gap, w: ww + 2 * gap, h: h + 2 * gap }, outline);
  for (const ww of minW && minW < w ? [w, minW] : [w]) {
    for (let d = 0; d <= b.w + b.h; d += step) {
      for (let i = d; i >= 0; i -= step) {
        const x = b.x + gap + i, y = b.y + gap + (d - i);
        if (x + ww + gap > b.x + b.w || y + h + gap > b.y + b.h || !room(x, y, ww)) continue;
        let grown = ww;
        while (grown + step <= w && room(x, y, grown + step)) grown += step;
        return { x, y, w: Math.min(grown, w) };
      }
    }
  }
  return null;
}

// ─── How far the map reaches ─────────────────────────────────────────────────
// What the camera may show: the picture with the layout and a fifth of its larger side beyond, or the layout with
// a margin. Zoomed out no further than the extent fills the window.
const WM_EXTENT_MARGIN = 450, WM_EXTENT_OVER = 0.2;

function wmExtent(points, pic) {
  const b = points && points.length ? _wmBounds(points) : { x0: -1000, y0: -1000, x1: 1000, y1: 1000 };
  if (pic) {
    const u = { x0: Math.min(b.x0, pic.x), y0: Math.min(b.y0, pic.y), x1: Math.max(b.x1, pic.x + pic.w), y1: Math.max(b.y1, pic.y + pic.h) };
    const o = Math.max(u.x1 - u.x0, u.y1 - u.y0) * WM_EXTENT_OVER;
    return { x0: u.x0 - o, y0: u.y0 - o, x1: u.x1 + o, y1: u.y1 + o };
  }
  return { x0: b.x0 - WM_EXTENT_MARGIN, y0: b.y0 - WM_EXTENT_MARGIN, x1: b.x1 + WM_EXTENT_MARGIN, y1: b.y1 + WM_EXTENT_MARGIN };
}

// The smallest zoom: the extent fills the window. A small map stops at the zoom where the places level opens.
function wmZoomFloor(ext, view) {
  return Math.max(WM_ZOOM_MIN, Math.min(Math.max(view.w / (ext.x1 - ext.x0), view.h / (ext.y1 - ext.y0)), WM_SPLIT * 0.85));
}

// The camera moved the least that puts the window inside the extent.
function wmClampCamera(cam, view, ext) {
  const z = Math.max(cam.z, wmZoomFloor(ext, view)), hw = view.w / 2 / z, hh = view.h / 2 / z;
  const fit = (c, lo, hi, half) => (hi - lo <= 2 * half ? (lo + hi) / 2 : Math.min(hi - half, Math.max(lo + half, c)));
  return { cx: fit(cam.cx, ext.x0, ext.x1, hw), cy: fit(cam.cy, ext.y0, ext.y1, hh), z };
}

function wmFillZoom(view) { return Math.max(view.w / WM_CARD_W, view.h / WM_CARD_H); }

// Every scene in view, zoomed out far enough that the places level shows. An empty library sits on
// the origin at the same zoom.
function wmOverviewCamera(positions, view) {
  const zMax = WM_SPLIT * 0.85;
  if (!positions || !positions.length) return { cx: 0, cy: 0, z: zMax };
  const b = _wmBounds(positions);
  const w = b.x1 - b.x0 + 900, h = b.y1 - b.y0 + 900;
  return { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, z: Math.min(view.w / w, view.h / h, zMax) };
}

function wmPlaceCamera(rect, view) {
  const c = wmRectCentre(rect);
  return { cx: c.x, cy: c.y, z: Math.max(WM_SPLIT * 1.15, Math.min(view.w * 0.6 / rect.w, view.h * 0.6 / rect.h)) };
}

function wmLevelFor(z) { return z < WM_SPLIT ? 'places' : 'scenes'; }

// The wheel: zoom by the delta, holding the world point under (px, py) still. `view` is the layer's
// size, and (px, py) is relative to its top-left.
function wmZoomAround(cam, view, px, py, deltaY, zMin) {
  const z = Math.min(WM_ZOOM_MAX, Math.max(zMin || WM_ZOOM_MIN, cam.z * Math.exp(-deltaY * 0.0015)));
  const wx = cam.cx + (px - view.w / 2) / cam.z, wy = cam.cy + (py - view.h / 2) / cam.z;
  return { cx: wx - (px - view.w / 2) / z, cy: wy - (py - view.h / 2) / z, z };
}

// n new scenes side by side, centred on (cx, cy).
function wmSideBySide(cx, cy, n) {
  return Array.from({ length: n }, (_, i) => ({
    x: Math.round(cx + (i - (n - 1) / 2) * WM_STEP_X), y: Math.round(cy),
  }));
}

// Where a new scene lands: the clear grid spot nearest `anchor`, 16 clear of every card in `taken`, the same row and
// the right side first. `beside` keeps it off the anchor itself, which is the last scene's own spot.
function wmFreeSpot(anchor, taken, beside) {
  const clear = p => { const r = wmCardRect(p); return !taken.some(t => r.x < t.x + t.w + 16 && t.x < r.x + r.w + 16 && r.y < t.y + t.h + 16 && t.y < r.y + r.h + 16); };
  let best = null;
  for (let row = -8; row <= 8; row++) {
    for (let col = -12; col <= 12; col++) {
      if (beside && !row && !col) continue;
      const dx = col * WM_STEP_X, dy = row * WM_STEP_Y, cost = Math.hypot(dx, dy * 2) + (col < 0 ? WM_STEP_X / 2 : 0) + (row < 0 ? WM_STEP_Y / 2 : 0);
      const p = { x: Math.round(anchor.x + dx), y: Math.round(anchor.y + dy) };
      if ((!best || cost < best.cost) && clear(p)) best = { cost, p };
    }
  }
  return best ? best.p : { x: Math.round(anchor.x + 13 * WM_STEP_X), y: Math.round(anchor.y) };
}

function wmMatches(query, sceneName, groupName) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return String(sceneName || '').toLowerCase().includes(q) || String(groupName || '').toLowerCase().includes(q);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    WM_CARD_W, WM_CARD_H, WM_PAD, WM_LABEL, WM_SPLIT, WM_STEP_X, WM_STEP_Y,
    wmCleanPos, wmBesideOffset, wmPlanPositions, wmHullRect, wmRectCentre, wmFillZoom,
    wmCardRect, wmPointInPoly, wmRectInPoly, wmPolyArea, wmPolyBounds, wmPolyCentre, wmRectShape, wmCircleShape,
    wmCleanShape, wmCleanPlace, wmOutline, wmPlaceOf, wmParseShapes, wmSlotInPoly, wmLabelSpot,
    wmPlateSpot, wmExtent, wmZoomFloor, wmClampCamera,
    wmOverviewCamera, wmPlaceCamera, wmLevelFor, wmZoomAround, wmSideBySide, wmFreeSpot, wmMatches,
  };
}
