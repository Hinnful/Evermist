'use strict';
// worldRoadPlan.js — the pure rules of roads on the world map. A road is an open line of points
// (curved by the same handles a room's wall has), two ends that may stick to a scene or a place, and the
// scenes that sit on it. Positions are world units, as in worldMapPlan.js.

// fogGeometry.js and worldMapPlan.js load first in the browser; here they are required.
var edgeCubic, edgeIsCurved, handleAt, sampleCubic, subCubic, computeFillet, wmPolyCentre, wmPointInPoly;
if (typeof module !== 'undefined' && module.exports) {
  ({ edgeCubic, edgeIsCurved, handleAt, sampleCubic, subCubic, computeFillet } = require('../fog/fogGeometry'));
  ({ wmPolyCentre, wmPointInPoly } = require('./worldMapPlan'));
}

const WR_ID0 = 2000000;          // clear of every room id and every place id
const WR_STEPS = 14;             // samples on one curved segment
const WR_MAX_POINTS = 400;
const WR_NAME_MAX = 120;

const _wrNum = v => typeof v === 'number' && Number.isFinite(v);
const _wrOwn = (map, k) => !!map && Object.prototype.hasOwnProperty.call(map, k);

// ─── Cleaning ────────────────────────────────────────────────────────────────

// An end is open, or sticks to a scene (by id) or a place (by name, with the spot it was drawn at,
// relative to the place's centre).
function wrCleanEnd(raw) {
  if (!raw || typeof raw !== 'object') return { kind: null };
  if (raw.kind === 'scene' && typeof raw.ref === 'string' && raw.ref) return { kind: 'scene', ref: raw.ref };
  if (raw.kind === 'place' && typeof raw.ref === 'string' && raw.ref && _wrNum(raw.dx) && _wrNum(raw.dy)) {
    return { kind: 'place', ref: raw.ref, dx: raw.dx, dy: raw.dy };
  }
  return { kind: null };
}

function _wrCleanHandles(raw, n) {
  const ok = h => h === null || (h && ['ix', 'iy', 'ox', 'oy'].every(k => _wrNum(h[k])));
  if (!Array.isArray(raw) || raw.length !== n || !raw.every(ok)) return null;
  const out = raw.map(h => (h ? { ix: h.ix, iy: h.iy, ox: h.ox, oy: h.oy } : null));
  return out.some(Boolean) ? out : null;
}

// A stored road as a clean record { name, vertices, handles?, ends: [a, b], scenes: [{ id, t }] }, or
// null: at least two points, every one finite.
function wrCleanRoad(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = raw.vertices;
  if (!Array.isArray(src) || src.length < 2 || src.length > WR_MAX_POINTS) return null;
  const vertices = [];
  for (const p of src) {
    if (!p || !_wrNum(p.x) || !_wrNum(p.y)) return null;
    vertices.push({ x: p.x, y: p.y });
  }
  const out = {
    name: typeof raw.name === 'string' ? raw.name.slice(0, WR_NAME_MAX) : '',
    vertices,
    ends: [wrCleanEnd(raw.ends && raw.ends[0]), wrCleanEnd(raw.ends && raw.ends[1])],
    scenes: [],
  };
  const handles = _wrCleanHandles(raw.handles, vertices.length);
  if (handles) out.handles = handles;
  if (_wrNum(raw.cornerRadius) && raw.cornerRadius > 0) out.cornerRadius = raw.cornerRadius;
  if (Array.isArray(raw.cornerRadii) && raw.cornerRadii.length === vertices.length &&
      raw.cornerRadii.every(r => r === null || (_wrNum(r) && r >= 0)) && raw.cornerRadii.some(r => r !== null)) out.cornerRadii = raw.cornerRadii.slice();
  const seen = Object.create(null);
  for (const s of Array.isArray(raw.scenes) ? raw.scenes : []) {
    if (!s || typeof s.id !== 'string' || !s.id || !_wrNum(s.t) || seen[s.id]) continue;
    seen[s.id] = true;
    out.scenes.push({ id: s.id, t: Math.max(0, Math.min(1, s.t)) });
  }
  return out;
}

// The roads of a campaign.json: uid → clean road, null-prototype, with `broken` set when `roads` is not
// a plain object or holds a road that is not one.
function wrParseRoads(raw) {
  const roads = Object.create(null);
  if (raw == null) return { roads, broken: false };
  let obj = null;
  try { obj = JSON.parse(raw); } catch (_) { return { roads, broken: false }; }
  if (!obj || typeof obj !== 'object' || !_wrOwn(obj, 'roads')) return { roads, broken: false };
  const src = obj.roads;
  if (!src || typeof src !== 'object' || Array.isArray(src)) return { roads, broken: true };
  let broken = false;
  for (const k of Object.keys(src)) {
    const c = k && k.length <= 80 ? wrCleanRoad(src[k]) : null;
    if (c) roads[k] = c; else broken = true;
  }
  return { roads, broken };
}

// A key no road in `taken` wears.
function wrNewUid(taken, rand) {
  const r = rand || Math.random;
  for (;;) {
    const uid = 'rd' + Math.floor(r() * 0xffffffff).toString(36) + Date.now().toString(36).slice(-3);
    if (!_wrOwn(taken, uid)) return uid;
  }
}

// ─── Geometry ────────────────────────────────────────────────────────────────

// The radius a road's corner has: its own, else the road's. Only a corner with a segment each side rounds.
function wrCornerRadius(road, i) {
  if (i <= 0 || i >= road.vertices.length - 1) return 0;
  const r = road.cornerRadii ? road.cornerRadii[i] : null;
  return r != null ? r : (road.cornerRadius || 0);
}

function wrRounded(road) {
  return road.vertices.some((_, i) => wrCornerRadius(road, i) > 0);
}

// The road as straight points, every curved segment sampled and every rounded corner cut by its fillet. The
// fillet is the room's own (computeFillet), so a corner rounds the same way on a road as on a place.
function wrSamples(road) {
  const v = road.vertices, n = v.length, h = road.handles || null;
  const at = k => v[Math.max(0, Math.min(n - 1, k))];
  const curvedWall = k => !!h && k >= 0 && k < n - 1 && edgeIsCurved(h, k, k + 1);
  const wallCubic = k => edgeCubic(v[k], v[k + 1], handleAt(h, k), handleAt(h, k + 1));
  const round = wrRounded(road);
  const fillets = v.map((_, i) => (round ? computeFillet(at, curvedWall, wallCubic, k => wrCornerRadius(road, k), i) : null));
  const out = [{ x: v[0].x, y: v[0].y }];
  let from = 0;
  for (let i = 0; i + 1 < n; i++) {
    const f = fillets[i + 1], to = f ? f.start : v[i + 1], tTo = f ? f.tIn : 1;
    if (curvedWall(i)) {
      const c = subCubic(wallCubic(i), from, tTo);
      out.push(...sampleCubic(c[0], c[1], c[2], c[3], WR_STEPS));
    } else {
      out.push({ x: to.x, y: to.y });
    }
    if (f) {
      const a1 = Math.atan2(f.start.y - f.cy, f.start.x - f.cx);
      let da = Math.atan2(f.end.y - f.cy, f.end.x - f.cx) - a1;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      const steps = Math.max(3, Math.ceil(Math.abs(da) / 0.12));
      for (let s = 1; s <= steps; s++) out.push({ x: f.cx + Math.cos(a1 + da * s / steps) * f.radius, y: f.cy + Math.sin(a1 + da * s / steps) * f.radius });
    }
    from = f ? f.tOut : 0;
  }
  return out;
}

function wrLength(pts) {
  let len = 0;
  for (let i = 0; i + 1 < pts.length; i++) len += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  return len;
}

// The point a fraction t of the way along the line's length.
function wrPointAt(pts, t) {
  const total = wrLength(pts);
  if (!(total > 0)) return { x: pts[0].x, y: pts[0].y };
  let want = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (want <= seg && seg > 0) return { x: a.x + (b.x - a.x) * want / seg, y: a.y + (b.y - a.y) * want / seg };
    want -= seg;
  }
  const last = pts[pts.length - 1];
  return { x: last.x, y: last.y };
}

function _wrClosest(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const k = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return { x: a.x + dx * k, y: a.y + dy * k };
}

// The nearest point on a line: { x, y, t, d }, t as a fraction of the length.
function wrNearest(pts, p) {
  const total = wrLength(pts);
  let best = { x: pts[0].x, y: pts[0].y, t: 0, d: Infinity }, run = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], q = _wrClosest(p, a, b), d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < best.d) best = { x: q.x, y: q.y, t: total > 0 ? (run + Math.hypot(q.x - a.x, q.y - a.y)) / total : 0, d };
    run += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return best;
}

// The nearest point on a closed outline.
function wrNearestOnRing(ring, p) {
  return wrNearest(ring.concat([ring[0]]), p);
}

// The road nearest p within maxD, from [{ uid, pts }]: { uid, t, x, y, d }, or null.
function wrSnap(lines, p, maxD) {
  let best = null;
  for (const l of lines) {
    const n = wrNearest(l.pts, p);
    if (n.d <= maxD && (!best || n.d < best.d)) best = { uid: l.uid, t: n.t, x: n.x, y: n.y, d: n.d };
  }
  return best;
}

// The road as an SVG path: lines, and one cubic for each curved segment.
function wrSvgPath(road) {
  if (wrRounded(road)) return wrPolylinePath(wrSamples(road));
  const v = road.vertices, h = road.handles || null, f = n => Math.round(n * 100) / 100;
  let d = 'M' + f(v[0].x) + ' ' + f(v[0].y);
  for (let i = 0; i + 1 < v.length; i++) {
    if (!h || !edgeIsCurved(h, i, i + 1)) { d += 'L' + f(v[i + 1].x) + ' ' + f(v[i + 1].y); continue; }
    const c = edgeCubic(v[i], v[i + 1], handleAt(h, i), handleAt(h, i + 1));
    d += 'C' + f(c[1].x) + ' ' + f(c[1].y) + ' ' + f(c[2].x) + ' ' + f(c[2].y) + ' ' + f(c[3].x) + ' ' + f(c[3].y);
  }
  return d;
}

// ─── Entering a place ────────────────────────────────────────────────────────
// A road that ends in a place is shown only as far as the place's outline, so it enters the place and does not
// run across it. The stored line is whole; only the drawing is cut.

function _wrSegCross(a, b, c, d) {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y, den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den, u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

// How far along `pts` (from pts[0], which is taken as inside the ring) the line first leaves the ring, or null
// when it never does.
function wrLeaves(pts, ring) {
  let run = 0;
  for (let j = 1; j < pts.length; j++) {
    const a = pts[j - 1], b = pts[j], seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (!wmPointInPoly(b, ring)) {
      let t = 0;
      for (let i = 0; i < ring.length; i++) {
        const x = _wrSegCross(a, b, ring[i], ring[(i + 1) % ring.length]);
        if (x !== null && (t === 0 || x < t)) t = x;
      }
      return run + seg * t;
    }
    run += seg;
  }
  return null;
}

// The part of the line from distance d0 to d1 along it.
function wrSlice(pts, d0, d1) {
  const out = [];
  let run = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], seg = Math.hypot(b.x - a.x, b.y - a.y), at = k => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
    if (run + seg > d0 && run < d1 && seg > 0) {
      if (!out.length) out.push(at(Math.max(0, (d0 - run) / seg)));
      out.push(at(Math.min(1, (d1 - run) / seg)));
    }
    run += seg;
  }
  return out;
}

// What of the road to draw: its line, minus the stretch inside a place at either end that sticks to one. Null
// when nothing is cut, and when the line never leaves the place, which is drawn whole so it can still be found.
function wrVisible(road, ctx) {
  const pts = wrSamples(road), total = wrLength(pts);
  const far = (line, end) => {
    const ring = end.kind === 'place' ? ctx.place(end.ref) : null;
    return ring && ring.length >= 3 ? wrLeaves(line, ring) : null;
  };
  const lo = far(pts, road.ends[0]), back = far(pts.slice().reverse(), road.ends[1]);
  const hi = back === null ? total : total - back;
  const from = lo === null ? 0 : lo;
  if ((lo === null && back === null) || from >= hi) return null;
  return wrSlice(pts, from, hi);
}

function wrPolylinePath(pts) {
  const f = n => Math.round(n * 100) / 100;
  return pts.map((p, i) => (i ? 'L' : 'M') + f(p.x) + ' ' + f(p.y)).join('');
}

// ─── Ends ────────────────────────────────────────────────────────────────────
// `ctx` answers for the world: scene(id) → { x, y } or null, place(name) → outline points or null.

// Where an end sits: on its scene, or at its spot in its place, pulled to the nearest point of the outline
// when a reshape put the spot outside it. Null for an open end or a thing that is gone.
function wrEndPos(end, ctx) {
  if (end.kind === 'scene') { const p = ctx.scene(end.ref); return p ? { x: p.x, y: p.y } : null; }
  if (end.kind !== 'place') return null;
  const outline = ctx.place(end.ref);
  if (!outline || outline.length < 3) return null;
  const c = wmPolyCentre(outline), p = { x: c.x + end.dx, y: c.y + end.dy };
  if (wmPointInPoly(p, outline)) return p;
  const n = wrNearestOnRing(outline, p);
  return { x: n.x, y: n.y };
}

// The road's points with each stuck end laid on what it sticks to. An end whose thing is gone keeps its
// last spot. Returns the same array when nothing moved.
function wrFollow(road, ctx) {
  const v = road.vertices, last = v.length - 1;
  let out = v;
  [0, last].forEach((at, k) => {
    const p = wrEndPos(road.ends[k], ctx);
    if (!p || (Math.abs(p.x - v[at].x) < 1e-6 && Math.abs(p.y - v[at].y) < 1e-6)) return;
    if (out === v) out = v.map(q => ({ x: q.x, y: q.y }));
    out[at] = p;
  });
  return out;
}

// What an end drawn or dropped at p sticks to. `ctx.sceneAt(p)` answers a scene id (or ''), and
// `ctx.placeAt(p)` a { name, outline } (or null). A scene with no place wins over the place around it.
function wrAttachAt(p, ctx) {
  const id = ctx.sceneAt(p);
  if (id) return { kind: 'scene', ref: id };
  const place = ctx.placeAt(p);
  if (!place) return { kind: null };
  const c = wmPolyCentre(place.outline);
  return { kind: 'place', ref: place.name, dx: p.x - c.x, dy: p.y - c.y };
}

// An end that was dragged off its anchor by hand: the anchor's own spot and the stored point differ.
function wrEndMoved(road, k, ctx) {
  const p = wrEndPos(road.ends[k], ctx), q = road.vertices[k ? road.vertices.length - 1 : 0];
  return road.ends[k].kind === null ? false : !!p && Math.hypot(p.x - q.x, p.y - q.y) > 2;
}

// ─── Drawing ─────────────────────────────────────────────────────────────────

// p pulled to the nearest 45 degrees from `from`, at the same distance: Shift while drawing.
function wrLockAngle(from, p) {
  const dx = p.x - from.x, dy = p.y - from.y, len = Math.hypot(dx, dy);
  if (!(len > 0)) return { x: p.x, y: p.y };
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: from.x + Math.cos(a) * len, y: from.y + Math.sin(a) * len };
}

// The open end of a road within maxD of p: { uid, k } with k 0 for the first end and 1 for the last. An end
// that sticks to a scene or a place is not offered, since a click there starts a new road from that thing.
function wrEndNear(roads, p, maxD) {
  let best = null;
  for (const r of roads) {
    r.ends.forEach((e, k) => {
      if (e.kind !== null) return;
      const v = r.vertices[k ? r.vertices.length - 1 : 0], d = Math.hypot(p.x - v.x, p.y - v.y);
      if (d <= maxD && (!best || d < best.d)) best = { uid: r.uid, k, d };
    });
  }
  return best && { uid: best.uid, k: best.k };
}

// The same road walked the other way: points, curve handles (in and out swap), ends and the scenes' places.
function wrReverse(road) {
  const out = _wrCopy(road), swap = h => (h ? { ix: h.ox, iy: h.oy, ox: h.ix, oy: h.iy } : null);
  out.vertices.reverse();
  out.ends.reverse();
  out.scenes = out.scenes.map(s => ({ id: s.id, t: 1 - s.t }));
  if (road.handles) out.handles = road.handles.map(swap).reverse();
  if (road.cornerRadii) out.cornerRadii.reverse();
  return out;
}

// ─── What deleting, renaming and restoring do to a road ──────────────────────

function _wrCopy(road) {
  const out = { ...road, vertices: road.vertices.map(v => ({ ...v })), ends: road.ends.map(e => ({ ...e })), scenes: road.scenes.map(s => ({ ...s })) };
  if (road.cornerRadii) out.cornerRadii = road.cornerRadii.slice();
  if (road.handles) out.handles = road.handles.map(h => (h ? { ...h } : null));
  return out;
}

// A scene or a place that is gone leaves its roads with an open end where it was. A gone scene also
// leaves the road's list.
function wrOpenEnds(road, kind, refs) {
  const gone = r => refs.indexOf(r) >= 0;
  const out = _wrCopy(road);
  out.ends = out.ends.map(e => (e.kind === kind && gone(e.ref) ? { kind: null } : e));
  if (kind === 'scene') out.scenes = out.scenes.filter(s => !gone(s.id));
  return out;
}

// A place renamed (or merged into another): its ends follow the name.
function wrRenamePlace(road, from, to) {
  const out = _wrCopy(road);
  out.ends = out.ends.map(e => (e.kind === 'place' && e.ref === from ? { ...e, ref: to } : e));
  return out;
}

// A road out of a backup, moved by (dx, dy) with the restored scenes. `scenes` is { oldId: newId } for the
// scenes that came back; `places` is { name: true } for the places that came back as the backup's own.
// An end on a scene that did not come back, or on a place the DM already had under that name, is open.
function wrRemap(road, scenes, places, dx, dy) {
  const out = _wrCopy(road);
  out.vertices = out.vertices.map(v => ({ x: v.x + dx, y: v.y + dy }));
  out.ends = out.ends.map(e => {
    if (e.kind === 'scene') return _wrOwn(scenes, e.ref) ? { kind: 'scene', ref: scenes[e.ref] } : { kind: null };
    if (e.kind === 'place') return _wrOwn(places, e.ref) ? e : { kind: null };
    return e;
  });
  out.scenes = out.scenes.filter(s => _wrOwn(scenes, s.id)).map(s => ({ id: scenes[s.id], t: s.t }));
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    WR_ID0, wrCornerRadius, wrRounded, wrCleanEnd, wrCleanRoad, wrParseRoads, wrNewUid, wrSamples, wrLength, wrPointAt, wrNearest,
    wrNearestOnRing, wrSnap, wrSvgPath, wrEndPos, wrFollow, wrAttachAt, wrEndMoved, wrOpenEnds,
    wrRenamePlace, wrRemap, wrLockAngle, wrEndNear, wrReverse, wrLeaves, wrSlice, wrVisible, wrPolylinePath,
  };
}
