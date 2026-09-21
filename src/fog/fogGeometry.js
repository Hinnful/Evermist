// fogGeometry.js — pure geometry + math kernel for the fog pipeline. Argument-in / value-out with
// no DOM, canvas, RAF or global state, which is what makes it unit-testable.
//
// Loaded via <script src> BEFORE fog.js and tools.js, and require()-able in tests.

'use strict';

function polygonWindingSign(verts) {
  let area2 = 0;
  for (let i = 0; i < verts.length; i++) {
    const j = (i + 1) % verts.length;
    area2 += verts[i].x * verts[j].y - verts[j].x * verts[i].y;
  }
  return area2 > 0 ? 1 : -1;
}

// ─── Polygon bounding box ──────────────────────────────────────────────────────
function getPolyBBox(verts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const v of verts) {
    if (v.x < minX) minX = v.x; if (v.y < minY) minY = v.y;
    if (v.x > maxX) maxX = v.x; if (v.y > maxY) maxY = v.y;
  }
  return { minX, minY, maxX, maxY };
}

// ─── Rings ────────────────────────────────────────────────────────────────────
// A record's outline is `vertices`; `holes` is an optional flat list of inner rings, one level
// deep, absent when there is none.
// ⚠ EVERY VERTEX AND EDGE INDEX THE EDITING PATHS CARRY IS FLAT: the outer ring first, then each
// hole in order, so selectedVertexIndex and edgeDragIndex stay the plain integers they are.
const NO_HOLES = [];   // shared: a record with no hole allocates nothing on a mousemove

function polyHoleRings(poly) {
  const holes = poly && poly.holes;
  if (!holes || !holes.length) return NO_HOLES;
  return holes.filter(h => h && h.length >= 3);
}

function polyRings(poly) {
  if (!poly) return [];
  const outer = poly.vertices || [];
  const holes = polyHoleRings(poly);
  return holes.length ? [outer].concat(holes) : [outer];
}

function flatVertexCount(poly) {
  let n = (poly && poly.vertices) ? poly.vertices.length : 0;
  for (const ring of polyHoleRings(poly)) n += ring.length;
  return n;
}

// {ring, i} for a flat index, where `ring` indexes polyRings(). null when out of range.
function flatVertexRef(poly, flatIndex) {
  const rings = polyRings(poly);
  let k = flatIndex | 0;
  if (k < 0) return null;
  for (let r = 0; r < rings.length; r++) {
    if (k < rings[r].length) return { ring: r, i: k };
    k -= rings[r].length;
  }
  return null;
}

// A snapshot copy: every ring copied point by point, every other field spread through untouched.
// ⚠ ADDITIVE, never a field whitelist — one drops cornerRadii from every saved scene.
function copyShapeRings(shape) {
  const out = { ...shape, vertices: shape.vertices.map(v => ({ ...v })) };
  if (shape.holes && shape.holes.length) out.holes = shape.holes.map(h => h.map(v => ({ ...v })));
  else delete out.holes;
  return out;
}

// ─── Downgrade safety ─────────────────────────────────────────────────────────
// ⚠ AN OLDER BUILD READS `vertices` AND IGNORES THE REST, so a revealed keep shows its courtyard
// and a wall bent inward reveals ground the curve was cutting away — fog failing OPEN on the TV,
// after a rollback the DM is entitled to. Such a room is written as a SHROUD carrying its real
// mode, so an old build hides ground instead.
// `modeWithHoles` keeps its name: it is the field shipped for holes in 2.11.0, an old build
// ignores it either way, and a second one would mean a second decode branch.
function encodeShapeForSave(shape) {
  const held = shape && ((shape.holes && shape.holes.length) ||
                         (shape.handles && shape.handles.some(h => h)));
  if (!held || !shape.mode || shape.mode === 'shroud') return shape;
  return { ...shape, mode: 'shroud', modeWithHoles: shape.mode };
}

function decodeShapeFromSave(shape) {
  if (!shape || !shape.modeWithHoles) return shape;
  const out = { ...shape };
  if ((shape.holes && shape.holes.length) || (shape.handles && shape.handles.some(h => h))) {
    out.mode = shape.modeWithHoles;
  }
  delete out.modeWithHoles;
  return out;
}

// ─── Bezier handles ───────────────────────────────────────────────────────────
// A curved wall is a cubic. An anchor may carry {ix,iy,ox,oy}: OFFSETS from the anchor to its
// incoming and outgoing control point, so a handle rides its anchor through a move, a rotate and
// a scale. Flat-indexed like cornerRadii — outer ring first, then each hole.
//
// The two handles are INDEPENDENT, which keeps a corner sharp where a curved wall meets a flat
// one. An anchor may carry both a radius and handles — _traceRing fillets against a curved
// side's own tangent rather than the chord to its far vertex; see filletCircle below.

function handleAt(handles, flat) {
  const h = handles ? handles[flat] : null;
  return (h && (h.ix || h.iy || h.ox || h.oy)) ? h : null;
}

function scaleHandles(handles, scale) {
  if (!handles) return null;
  return handles.map(h => handleAt([h], 0) &&
    { ix: h.ix * scale, iy: h.iy * scale, ox: h.ox * scale, oy: h.oy * scale });
}

// True when the wall from flat index `a` to flat index `b` is a curve rather than a line.
function edgeIsCurved(handles, a, b) {
  const ha = handleAt(handles, a), hb = handleAt(handles, b);
  return !!((ha && (ha.ox || ha.oy)) || (hb && (hb.ix || hb.iy)));
}

// The four control points of the wall from `a` to `b`, in the space `verts` are given in.
function edgeCubic(pa, pb, ha, hb) {
  return [pa,
          { x: pa.x + (ha ? ha.ox || 0 : 0), y: pa.y + (ha ? ha.oy || 0 : 0) },
          { x: pb.x + (hb ? hb.ix || 0 : 0), y: pb.y + (hb ? hb.iy || 0 : 0) },
          pb];
}

// de Casteljau. Splits one cubic into two that together trace exactly the same curve, which is
// what lets a boolean cut a curved wall without flattening it.
function splitCubic(p0, c1, c2, p3, t) {
  const lerp = (u, v) => ({ x: u.x + (v.x - u.x) * t, y: u.y + (v.y - u.y) * t });
  const a = lerp(p0, c1), b = lerp(c1, c2), c = lerp(c2, p3);
  const d = lerp(a, b), e = lerp(b, c);
  const m = lerp(d, e);
  return { mid: m, left: [p0, a, d, m], right: [m, e, c, p3] };
}

// Points along a cubic, excluding p0 so a caller can append them straight onto a running ring.
function sampleCubic(p0, c1, c2, p3, steps) {
  const out = [];
  const n = Math.max(1, steps | 0);
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
    out.push({ x: w0 * p0.x + w1 * c1.x + w2 * c2.x + w3 * p3.x,
               y: w0 * p0.y + w1 * c1.y + w2 * c2.y + w3 * p3.y });
  }
  return out;
}

// A ring walked as straight points, every curved wall sampled. Used where a consumer cannot take
// a curve at all: the clipping library, the effects shader, and overlap tests.
function flattenRing(ring, handles, offset, steps) {
  const n = ring.length;
  if (n < 2 || !handles) return ring.map(v => ({ ...v }));
  const out = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    out.push({ ...ring[i] });
    const ha = handleAt(handles, offset + i), hb = handleAt(handles, offset + j);
    if (!edgeIsCurved(handles, offset + i, offset + j)) continue;
    const c = edgeCubic(ring[i], ring[j], ha, hb);
    const pts = sampleCubic(c[0], c[1], c[2], c[3], steps || CURVE_SAMPLE_STEPS);
    pts.pop();                       // the last point IS ring[j], which the next turn pushes
    for (const p of pts) out.push(p);
  }
  return out;
}

// The box a shape actually fills, curve bulges included. ⚠ getPolyBBox READS ANCHORS ONLY, so a
// bent wall reaching outside them is clipped by anything sized off it — the fog scratch canvas
// first among them.
function shapeBBox(shape) {
  if (Array.isArray(shape)) return getPolyBBox(shape);
  if (!shape || !shape.handles) return getPolyBBox((shape && shape.vertices) || []);
  const pts = [];
  let off = 0;
  for (const ring of polyRings(shape)) {
    for (const p of flattenRing(ring, shape.handles, off)) pts.push(p);
    off += ring.length;
  }
  return getPolyBBox(pts.length ? pts : (shape.vertices || []));
}

const CURVE_SAMPLE_STEPS = 12;       // points per curved wall when a consumer needs straight lines
const CURVE_FLAT_EPS = 0.02;         // handle length under this share of the wall reads as straight

// The piece of a cubic between two parameters, as its own cubic. Shared by a repair's restore
// path and a fillet's own curve trim.
function subCubic(c, t0, t1) {
  if (!(t1 > t0)) return [c[0], c[0], c[3], c[3]];
  const right = splitCubic(c[0], c[1], c[2], c[3], t0).right;
  const u = (t1 - t0) / (1 - t0);
  if (!(u > 0) || !(u < 1)) return right;
  return splitCubic(right[0], right[1], right[2], right[3], u).left;
}

// Where a cubic sits `dist` in a straight line from one of its own ends — `fromEnd` measures
// back from p3, otherwise forward from p0. Found by sampling, not solved exactly.
function cubicPointAtDistance(c, fromEnd, dist) {
  const [p0, c1, c2, p3] = c;
  const anchor = fromEnd ? p3 : p0;
  const steps = CURVE_SAMPLE_STEPS;
  let prevPt = anchor, prevT = fromEnd ? 1 : 0;
  for (let i = 1; i <= steps; i++) {
    const t = fromEnd ? 1 - i / steps : i / steps;
    const u = 1 - t, w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
    const pt = { x: w0 * p0.x + w1 * c1.x + w2 * c2.x + w3 * p3.x,
                 y: w0 * p0.y + w1 * c1.y + w2 * c2.y + w3 * p3.y };
    const d = Math.hypot(pt.x - anchor.x, pt.y - anchor.y);
    if (d >= dist) {
      const dPrev = Math.hypot(prevPt.x - anchor.x, prevPt.y - anchor.y);
      const frac = (dist - dPrev) / ((d - dPrev) || 1);
      return { t: prevT + (t - prevT) * frac,
               point: { x: prevPt.x + (pt.x - prevPt.x) * frac, y: prevPt.y + (pt.y - prevPt.y) * frac } };
    }
    prevPt = pt; prevT = t;
  }
  return { t: fromEnd ? 0 : 1, point: fromEnd ? p0 : p3 };
}

// The cubic's own tangent direction at parameter t, unit length, pointing from p0 toward p3.
function cubicTangentAt(c, t) {
  const [p0, c1, c2, p3] = c;
  const u = 1 - t;
  const dx = 3 * u * u * (c1.x - p0.x) + 6 * u * t * (c2.x - c1.x) + 3 * t * t * (p3.x - c2.x);
  const dy = 3 * u * u * (c1.y - p0.y) + 6 * u * t * (c2.y - c1.y) + 3 * t * t * (p3.y - c2.y);
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

// The cubic's own parameter closest to `pt`, by nearest-sample projection — used to turn a
// fillet circle's tangent point back into a split parameter for subCubic.
function cubicParamAtPoint(c, pt) {
  const [p0, c1, c2, p3] = c;
  const steps = CURVE_SAMPLE_STEPS;
  const pts = [p0].concat(sampleCubic(p0, c1, c2, p3, steps));
  let best = Infinity, bestT = 0;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2));
    const d = Math.hypot(pt.x - (a.x + dx * u), pt.y - (a.y + dy * u));
    if (d < best) { best = d; bestT = (k - 1 + u) / steps; }
  }
  return bestT;
}

// The circle of radius `r` tangent to two lines, each `{point, dir}` with `dir` unit length and
// pointing AWAY from the corner. A straight wall's line passes through the corner; a curved
// wall's is its own tangent at the fillet's start point instead, off the corner. Null on a
// near-straight run, where no corner exists to round.
function filletCircle(lineA, lineB, r) {
  let bx = lineA.dir.x + lineB.dir.x, by = lineA.dir.y + lineB.dir.y;
  const bl = Math.hypot(bx, by);
  if (bl < 1e-4) return null;
  bx /= bl; by /= bl;
  const side = (ln) => {
    const nx = -ln.dir.y, ny = ln.dir.x;
    return (nx * bx + ny * by) >= 0 ? { x: nx, y: ny } : { x: -nx, y: -ny };
  };
  const na = side(lineA), nb = side(lineB);
  const ax = lineA.point.x + na.x * r, ay = lineA.point.y + na.y * r;
  const bx2 = lineB.point.x + nb.x * r, by2 = lineB.point.y + nb.y * r;
  const denom = lineA.dir.x * lineB.dir.y - lineA.dir.y * lineB.dir.x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((bx2 - ax) * lineB.dir.y - (by2 - ay) * lineB.dir.x) / denom;
  const cx = ax + lineA.dir.x * t, cy = ay + lineA.dir.y * t;
  const foot = (ln) => {
    const dx = cx - ln.point.x, dy = cy - ln.point.y;
    const proj = dx * ln.dir.x + dy * ln.dir.y;
    return { x: ln.point.x + ln.dir.x * proj, y: ln.point.y + ln.dir.y * proj };
  };
  return { cx, cy, radius: r, start: foot(lineA), end: foot(lineB) };
}

// A fillet's arc as its start angle and its signed sweep, always the shorter way round — shared
// by the ctx-drawn arc and the effect's own sampled points, so the two sweep identically.
function filletArcSweep(f) {
  const a1 = Math.atan2(f.start.y - f.cy, f.start.x - f.cx);
  const a2 = Math.atan2(f.end.y - f.cy, f.end.x - f.cx);
  let da = a2 - a1;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  return { a1, da };
}

// Corner `i`'s own fillet, walking a ring through `at`/`curvedWall`/`wallCubic`/`getR` — shared by
// the ctx-drawn fog outline and an effect's own point list, so both round a curved corner the
// same way. `tIn`/`tOut` are the incoming/outgoing wall's own split parameters, reprojected from
// the fillet circle's true tangent point onto the NEAREST sampled point on the curve — the two
// meet within CURVE_SAMPLE_STEPS' resolution, not exactly, same as every other approximate lookup
// in this file.
function computeFillet(at, curvedWall, wallCubic, getR, i) {
  const r = getR(i);
  const curr = at(i), prev = at(i - 1), next = at(i + 1);
  const dPrev = Math.hypot(curr.x - prev.x, curr.y - prev.y);
  const dNext = Math.hypot(next.x - curr.x, next.y - curr.y);
  if (r <= 0 || dPrev === 0 || dNext === 0) return null;
  const maxR = Math.min(r, dPrev / 2, dNext / 2);
  let lineA, wIn = null;
  if (curvedWall(i - 1)) {
    wIn = wallCubic(i - 1);
    const guess = cubicPointAtDistance(wIn, true, maxR);
    const tan = cubicTangentAt(wIn, guess.t);
    lineA = { point: guess.point, dir: { x: -tan.x, y: -tan.y } };
  } else {
    lineA = { point: curr, dir: { x: (prev.x - curr.x) / dPrev, y: (prev.y - curr.y) / dPrev } };
  }
  let lineB, wOut = null;
  if (curvedWall(i)) {
    wOut = wallCubic(i);
    const guess = cubicPointAtDistance(wOut, false, maxR);
    lineB = { point: guess.point, dir: cubicTangentAt(wOut, guess.t) };
  } else {
    lineB = { point: curr, dir: { x: (next.x - curr.x) / dNext, y: (next.y - curr.y) / dNext } };
  }
  const circle = filletCircle(lineA, lineB, maxR);
  if (!circle) return null;
  // ⚠ REFUSE RATHER THAN GUESS: a curved side's tangent can end up nearly parallel to the other
  // side's line, which is a well-defined intersection but an arbitrarily distant one — a real
  // circle, drawn nowhere near the corner. A tangent point this far from `curr` is not a fillet
  // anyone asked for, so the corner stays sharp instead of drawing a wild arc.
  if (Math.hypot(circle.start.x - curr.x, circle.start.y - curr.y) > maxR * 4 ||
      Math.hypot(circle.end.x - curr.x, circle.end.y - curr.y) > maxR * 4) return null;
  return {
    start: circle.start, end: circle.end, cx: circle.cx, cy: circle.cy, radius: maxR,
    tIn: wIn ? cubicParamAtPoint(wIn, circle.start) : 1,
    tOut: wOut ? cubicParamAtPoint(wOut, circle.end) : 0,
    // Neither side curved: the classic case, drawn exactly as ctx.arcTo already drew it.
    arcTo: (!wIn && !wOut) ? [curr.x, curr.y, next.x, next.y, maxR] : null,
  };
}

// ─── Rounded polygon path ─────────────────────────────────────────────────────
// Used by both the fog pipeline and the cursor drawing. verts must be in target space, and
// perVertR overrides defaultR per vertex. ⚠ Reflex vertices are always sharp, or the arc deforms.
//
// Each hole is its own subpath, wound against the outer ring so a `nonzero` fill cuts it out.
// ⚠ Reversal walks the ring backwards rather than copying it reversed, which keeps every
// per-vertex radius on the vertex it was written for.
function _traceRing(ctx, verts, defaultR, perVertR, offset, reverse, handles) {
  const n = verts.length;
  const src = (k) => reverse ? (n - 1 - k) : k;
  const idx = (k) => src(((k % n) + n) % n);
  const at = (k) => verts[idx(k)];
  const hnd = (k) => handleAt(handles, offset + idx(k));
  // ⚠ Walking a ring backwards SWAPS each anchor's two handles: the control point that pointed at
  // the next vertex now points at the previous one.
  const outH = (k) => { const h = hnd(k); if (!h) return null;
                        return reverse ? { x: h.ix || 0, y: h.iy || 0 }
                                       : { x: h.ox || 0, y: h.oy || 0 }; };
  const inH  = (k) => { const h = hnd(k); if (!h) return null;
                        return reverse ? { x: h.ox || 0, y: h.oy || 0 }
                                       : { x: h.ix || 0, y: h.iy || 0 }; };
  const getR = (k) => {
    const v = perVertR ? perVertR[offset + idx(k)] : null;
    return v != null ? v : defaultR;
  };
  // A wall is named by its LOOP-space start index: wall(k) runs from k to k+1.
  const curvedWall = (k) => {
    const o = outH(k), q = inH(k + 1);
    return !!((o && (o.x || o.y)) || (q && (q.x || q.y)));
  };
  const wallCubic = (k) => {
    const a = at(k), b = at(k + 1), o = outH(k), q = inH(k + 1);
    return [a, { x: a.x + (o ? o.x : 0), y: a.y + (o ? o.y : 0) },
               { x: b.x + (q ? q.x : 0), y: b.y + (q ? q.y : 0) }, b];
  };
  if (n < 3) {
    if (!n) return;
    ctx.moveTo(at(0).x, at(0).y);
    for (let i = 1; i < n; i++) ctx.lineTo(at(i).x, at(i).y);
    ctx.closePath();
    return;
  }

  // The wall from k to k+1, trimmed to [tFrom, tTo], drawn from wherever the path sits to `to`.
  // A straight wall needs no split: any two of its own points join by a plain line.
  const drawWall = (k, tFrom, tTo, to) => {
    if (!curvedWall(k)) { ctx.lineTo(to.x, to.y); return; }
    const sub = subCubic(wallCubic(k), tFrom, tTo);
    ctx.bezierCurveTo(sub[1].x, sub[1].y, sub[2].x, sub[2].y, sub[3].x, sub[3].y);
  };
  const drawArc = (f) => {
    if (f.arcTo) { ctx.arcTo(...f.arcTo); return; }   // neither side curved: unchanged from before
    const { a1, da } = filletArcSweep(f);
    ctx.arc(f.cx, f.cy, f.radius, a1, a1 + da, da < 0);
  };

  const fillets = [];
  for (let i = 0; i < n; i++) fillets.push(computeFillet(at, curvedWall, wallCubic, getR, i));

  let prevOutT = null;             // where the previous corner's own fillet left this wall
  for (let i = 0; i < n; i++) {
    const f = fillets[i];
    const to = f ? f.start : at(i);
    const tTo = f ? f.tIn : 1;
    if (i === 0) ctx.moveTo(to.x, to.y);
    else drawWall(i - 1, prevOutT != null ? prevOutT : 0, tTo, to);
    if (f) { drawArc(f); prevOutT = f.tOut; } else { prevOutT = null; }
  }
  // The closing wall runs from the last vertex back to the first, ending at whichever point
  // opened the subpath — corner 0's own fillet start, or corner 0 itself with no rounding. A
  // STRAIGHT closing wall is left to closePath, exactly as it always drew it; only a curve has
  // to be spelled out.
  if (curvedWall(n - 1)) {
    const f0 = fillets[0];
    drawWall(n - 1, prevOutT != null ? prevOutT : 0, f0 ? f0.tIn : 1, f0 ? f0.start : at(0));
  }
  ctx.closePath();
}

function buildRoundedPolyPath(ctx, verts, defaultR, perVertR, holes, handles) {
  _traceRing(ctx, verts, defaultR, perVertR, 0, false, handles);
  if (!holes || !holes.length) return;
  const outerSign = polygonWindingSign(verts);
  let offset = verts.length;
  for (const hole of holes) {
    if (!hole || hole.length < 3) continue;
    _traceRing(ctx, hole, defaultR, perVertR, offset,
               polygonWindingSign(hole) === outerSign, handles);
    offset += hole.length;
  }
}

// One ring's outline as POINTS with the corners rounded — the same fillet computeFillet gives
// the ctx-drawn fog outline, sampled into vertices the effects shader can walk. Moved here from
// effects.js (item 108): a pure geometry kernel belongs beside its sibling, not in the render file.
function roundEffectRing(verts, defaultR, perVertR, offset, handles) {
  const n = verts.length;
  if (n < 3) return verts.map(v => ({ x: v.x, y: v.y }));
  const wrap = (k) => ((k % n) + n) % n;
  const at = (k) => verts[wrap(k)];
  const curvedWall = (k) => edgeIsCurved(handles, offset + wrap(k), offset + wrap(k + 1));
  const wallCubic = (k) => edgeCubic(at(k), at(k + 1), handleAt(handles, offset + wrap(k)),
                                      handleAt(handles, offset + wrap(k + 1)));
  const getR = (i) => (perVertR && perVertR[offset + i] != null) ? perVertR[offset + i] : defaultR;

  const fillets = [];
  for (let i = 0; i < n; i++) fillets.push(computeFillet(at, curvedWall, wallCubic, getR, i));

  const out = [];
  // A curved wall's interior samples, excluding both ends — the corner at each end pushes its
  // own point (sharp, or the fillet arc's own start/end), so the wall never duplicates it.
  const pushWall = (k, tFrom, tTo) => {
    if (!curvedWall(k)) return;
    const sub = subCubic(wallCubic(k), tFrom, tTo);
    const pts = sampleCubic(sub[0], sub[1], sub[2], sub[3], CURVE_SAMPLE_STEPS);
    pts.pop();
    for (const p of pts) out.push(p);
  };
  const pushArc = (f) => {
    const { a1, da } = filletArcSweep(f);
    const steps = Math.max(2, Math.round(Math.abs(da) / 0.4));
    for (let s = 1; s <= steps; s++) {           // s=0 is `f.start`, already pushed as the corner
      const a = a1 + da * (s / steps);
      out.push({ x: f.cx + Math.cos(a) * f.radius, y: f.cy + Math.sin(a) * f.radius });
    }
  };

  let prevOutT = null;
  for (let i = 0; i < n; i++) {
    const f = fillets[i];
    const to = f ? f.start : at(i);
    if (i > 0) pushWall(i - 1, prevOutT != null ? prevOutT : 0, f ? f.tIn : 1);
    out.push({ x: to.x, y: to.y });
    if (f) { pushArc(f); prevOutT = f.tOut; } else { prevOutT = null; }
  }
  const f0 = fillets[0];
  pushWall(n - 1, prevOutT != null ? prevOutT : 0, f0 ? f0.tIn : 1);
  return out;
}

// ─── Polygon inset ──────────────────────────────────────────────────────────
// Each vertex moved inward by `dist`, by the edge-bisector formula, so the perpendicular inset is
// exactly `dist` at every edge. Both windings, via the shoelace sign.
// ⚠ WINDING-AGNOSTIC: reversing a ring flips its normals AND its traversal order, so a reversed
// ring shrinks by the same points. A hole has to GROW, which is what `way` is for.
function offsetPolygon(verts, dist, way) {
  const n = verts.length;
  if (n < 3 || dist <= 0) return verts;
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area2 += verts[i].x * verts[j].y - verts[j].x * verts[i].y;
  }
  const sign = (area2 > 0 ? 1 : -1) * (way < 0 ? -1 : 1); // CW in screen space = positive area
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = verts[(i + n - 1) % n], b = verts[i], c = verts[(i + 1) % n];
    const e1x = b.x - a.x, e1y = b.y - a.y, l1 = Math.hypot(e1x, e1y) || 1;
    const e2x = c.x - b.x, e2y = c.y - b.y, l2 = Math.hypot(e2x, e2y) || 1;
    const nx1 = sign * -e1y / l1, ny1 = sign * e1x / l1;
    const nx2 = sign * -e2y / l2, ny2 = sign * e2x / l2;
    const bx = nx1 + nx2, by = ny1 + ny2;
    const denom = bx * nx1 + by * ny1;
    if (Math.abs(denom) < 0.01) {
      out.push({ x: b.x + nx2 * dist, y: b.y + ny2 * dist });
    } else {
      const s = dist / denom;
      out.push({ x: b.x + bx * s, y: b.y + by * s });
    }
  }
  return out;
}

function insetPolygon(verts, dist) { return offsetPolygon(verts, dist, 1); }
function outsetPolygon(verts, dist) { return offsetPolygon(verts, dist, -1); }

// Both sides of an outline moved in by `dist`: the outer ring shrunk, each hole grown. A hole that
// collapses below three points is dropped rather than folded inside out.
function insetPolyRings(poly, dist) {
  const rings = polyRings(poly);
  const outer = insetPolygon(rings[0] || [], dist);
  const holes = [];
  for (let r = 1; r < rings.length; r++) {
    const h = outsetPolygon(rings[r], dist);
    if (h && h.length >= 3) holes.push(h);
  }
  return { vertices: outer, holes };
}

// ─── Axis alignment snap ──────────────────────────────────────────────────────
// Nudges `pt` onto a reference point's exact x or y when already within `thresh`, straightening a
// nearly-straight wall. An ALIGNMENT snap, never a movement constraint: off-axis points are
// returned untouched. thresh is in the points' own units, so screen-px callers divide by zoom.
// Only the closer of x and y snaps, so a near-45° segment cannot flip between axes.
function snapToAxis(pt, refs, thresh) {
  if (!(thresh > 0) || !refs || !refs.length) return { x: pt.x, y: pt.y };
  let bestDev = thresh, bestAxis = null, bestVal = 0;
  for (const r of refs) {
    if (!r) continue;
    const dx = Math.abs(pt.x - r.x);
    if (dx < bestDev) { bestDev = dx; bestAxis = 'x'; bestVal = r.x; }
    const dy = Math.abs(pt.y - r.y);
    if (dy < bestDev) { bestDev = dy; bestAxis = 'y'; bestVal = r.y; }
  }
  if (bestAxis === 'x') return { x: bestVal, y: pt.y };
  if (bestAxis === 'y') return { x: pt.x, y: bestVal };
  return { x: pt.x, y: pt.y };
}

// ─── Cone ──────────────────────────────────────────────────────────────────────
// A cone is drawn apex-first: press at the origin, drag towards where it points. The drag sets
// DIRECTION and LENGTH; the spread is fixed.
//
// ⚠ THE SPREAD IS NOT A FREE PARAMETER. A D&D cone is as wide at its far end as it is long, which
// fixes the half-angle at atan(0.5). A cone that opened wider would measure a different area than
// the players' own rulers. Never make it a slider unless the DM asks.
//
// The far edge bows outward slightly, because a bare triangle reads as a paper cut-out.
//
// ⚠ THE TWO CORNERS DO NOT MOVE when the bulge changes, so width-equals-length holds however
// CONE_BULGE is set — and every measurement runs between the FIRST and LAST vertex, never v[1] and
// v[2]. The bulge costs reach, so keep it small; 0 gives the exact triangle back.
//
// snapDeg > 0 rounds the direction, which is the straighten-walls toggle.
const CONE_HALF_SPREAD = 0.5;   // half-width at the far end, as a fraction of the length
const CONE_BULGE = 0.08;        // how far the arc's middle stands past the far edge, ditto
const CONE_ARC_SEGS = 8;        // enough for a shallow arc; the whole shape stays hand-editable

function coneVertices(apex, tip, snapDeg) {
  const dx = tip.x - apex.x, dy = tip.y - apex.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return null;
  let ang = Math.atan2(dy, dx);
  if (snapDeg > 0) {
    const step = snapDeg * Math.PI / 180;
    ang = Math.round(ang / step) * step;
  }
  const ux = Math.cos(ang), uy = Math.sin(ang);
  const h = len * CONE_HALF_SPREAD;               // half-width at the far end
  // Local frame: along the axis, then perpendicular. Building the arc here rather than in map
  // coordinates keeps the circle maths one-dimensional.
  const toMap = (a, b) => ({ x: apex.x + ux * a - uy * b, y: apex.y + uy * a + ux * b });
  const s = len * CONE_BULGE;
  if (!(s > 0)) return [toMap(0, 0), toMap(len, h), toMap(len, -h)];

  // The circle through (len, +h), (len + s, 0) and (len, -h). Its centre sits behind the apex for
  // a shallow bulge, which is why the arc reads as a bow and not a pizza slice.
  const cx = len + s / 2 - (h * h) / (2 * s);
  const r = len + s - cx;
  const half = Math.asin(Math.min(1, h / r));     // half the arc's own angle, from the centre
  const out = [toMap(0, 0)];
  // Walked from +h to -h, so the arc runs the same way round as the triangle's corners did and
  // the winding is unchanged. First and last vertex are still the two corners.
  for (let i = 0; i <= CONE_ARC_SEGS; i++) {
    const t = half - (2 * half) * (i / CONE_ARC_SEGS);
    out.push(toMap(cx + Math.cos(t) * r, Math.sin(t) * r));
  }
  return out;
}

// ─── DPI-adaptive radius math ──────────────────────────────────────────────────
// Radii scale with fog canvas size, so they cover the same fraction of any map. `maxDim` is the
// canvas's larger dimension, `ref` the reference size.
function fogSizeScale(maxDim, ref) {
  const linear = Math.min(1, maxDim / ref);
  return linear * linear;
}

// A scaled radius never drops below 1px so thin blur/feather stays visible.
function scaledRadius(base, sizeScale) {
  return Math.max(1, base * sizeScale);
}

// ─── Fog animation math ────────────────────────────────────────────────────────
// Wrap a drift offset into [0, tile) so cloud tiling repeats seamlessly.
function wrapOffset(v, tile) {
  return ((v % tile) + tile) % tile;
}

// Oscillate a base alpha by ±amp using a sine driven by (time*freq + phase).
function pulseAlpha(base, amp, time, freq, phase) {
  return base * (1 + amp * Math.sin(time * freq + phase));
}

// ─── Cloud blend rebuild throttle ─────────────────────────────────────────────
// At display refresh the blend advances a tiny fraction of a frame per tick, so rebuilding every
// tick is invisible work. These two helpers are the gate: when, and how far.

// True once the scheduled rebuild time has arrived.
function shouldRebuildCloudBlend(ts, nextTs) {
  return ts >= nextTs;
}

// Seconds of morph for this rebuild: the time elapsed since the previous one, ⚠ never one tick's
// dt, which would slow the morph in proportion to the throttle. Clamped so a long stall cannot
// jump the morph forward, and 0 on the first rebuild.
function cloudBlendElapsedSec(ts, lastTs, maxSec) {
  if (!lastTs) return 0;
  return Math.min(Math.max(0, (ts - lastTs) / 1000), maxSec);
}

// Given a fractional frame position and frame count, return the two frame
// indices to crossfade and the [0,1) blend factor between them.
function cloudBlendIndices(pos, total) {
  const wrapped = ((pos % total) + total) % total;
  const idxA = Math.floor(wrapped) % total;
  const idxB = (idxA + 1) % total;
  const blend = wrapped - Math.floor(wrapped);
  return { idxA, idxB, blend };
}

// ─── Animation slider math ────────────────────────────────────────────────────
// Log-scale mapping between a 0-1000 slider position and a parameter value. baseVal is the
// midpoint, and the range reaches 50× either side of it.
function animLogScale(sliderVal, baseVal) {
  return baseVal * Math.exp((sliderVal - 500) / 500 * Math.log(50));
}

// Inverse: physical value → slider position. Returns 0 when either arg is 0.
function animSliderFromVal(currentVal, baseVal) {
  if (baseVal === 0 || currentVal === 0) return 0;
  return 500 + 500 * Math.log(currentVal / baseVal) / Math.log(50);
}

// ─── Cloud noise kernels ──────────────────────────────────────────────────────
// Bilinear interpolation over a tiling n×n Float32Array grid. Wraps on both axes.
function sampleWrappedNoise(grid, n, fx, fy) {
  const x = ((fx % n) + n) % n;
  const y = ((fy % n) + n) % n;
  const x0 = x | 0, y0 = y | 0;
  const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
  const sx = x - x0, sy = y - y0;
  const tx = sx * sx * (3 - 2 * sx), ty = sy * sy * (3 - 2 * sy);
  const a = grid[y0 * n + x0], b = grid[y0 * n + x1];
  const c = grid[y1 * n + x0], d = grid[y1 * n + x1];
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

// Multi-octave turbulence over a stack of { grid, n, scale } layers.
// Pure: layers passed in, no global reads.
function fogTurbulence(layers, px, py) {
  let val = 0, total = 0;
  for (const L of layers) {
    val += sampleWrappedNoise(L.grid, L.n, px * L.n, py * L.n) * L.scale;
    total += L.scale;
  }
  return val / total;
}

// ─── Node.js export guard (unit tests only) ──────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getPolyBBox,
    polyRings,
    polyHoleRings,
    copyShapeRings,
    encodeShapeForSave,
    decodeShapeFromSave,
    flatVertexCount,
    flatVertexRef,
    buildRoundedPolyPath,
    roundEffectRing,
    CURVE_FLAT_EPS,
    CURVE_SAMPLE_STEPS,
    flattenRing,
    shapeBBox,
    sampleCubic,
    splitCubic,
    subCubic,
    cubicPointAtDistance,
    cubicTangentAt,
    cubicParamAtPoint,
    filletCircle,
    computeFillet,
    edgeCubic,
    edgeIsCurved,
    scaleHandles,
    handleAt,
    polygonWindingSign,
    insetPolygon,
    outsetPolygon,
    insetPolyRings,
    snapToAxis,
    coneVertices,
    CONE_HALF_SPREAD,
    CONE_BULGE,
    fogSizeScale,
    scaledRadius,
    wrapOffset,
    pulseAlpha,
    cloudBlendIndices,
    shouldRebuildCloudBlend,
    cloudBlendElapsedSec,
    sampleWrappedNoise,
    fogTurbulence,
    animLogScale,
    animSliderFromVal,
  };
}
