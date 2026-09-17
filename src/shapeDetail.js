// shapeDetail.js — carries a room's per-vertex and per-wall detail across a repair: the curve on
// each wall, the radius on each corner, and each door. Pure, and unit-tested.
//
// The clipping library reads plain points, so a curve is flattened going in and rebuilt coming
// out. ⚠ REBUILT EXACTLY — de Casteljau splits a cubic into cubics, so a wall the repair passed
// by keeps its shape to the last decimal and a cut one keeps the half that survived.

'use strict';

// ⚠ THE SAMPLE COUNT IS READ, NEVER REDECLARED. `CURVE_SAMPLE_STEPS` is a const in
// fogGeometry.js, so a `var` of that name in this script is a SyntaxError that kills the page.
const _sdSteps = () => (typeof CURVE_SAMPLE_STEPS !== 'undefined' ? CURVE_SAMPLE_STEPS
  : require('./fogGeometry').CURVE_SAMPLE_STEPS);

var edgeIsCurved, edgeCubic, handleAt, sampleCubic, splitCubic, polyRings, polyHoleRings,
    flatVertexCount;
if (typeof module !== 'undefined' && module.exports) {
  ({ edgeIsCurved, edgeCubic, handleAt, sampleCubic, splitCubic, polyRings, polyHoleRings,
     flatVertexCount } = require('./fogGeometry'));
}

// Matched by coordinate: the library repeats a surviving input point bit for bit, so the
// tolerance only covers an intersection landing on a sample.
const DETAIL_SNAP = 1e-7;

function detailKey(x, y) {
  return Math.round(x / DETAIL_SNAP) + ',' + Math.round(y / DETAIL_SNAP);
}

// One wall: its control points, the polyline it flattened to, and the length along that.
function wallOf(shape, rings, ring, i, flatStart) {
  const verts = rings[ring];
  const n = verts.length;
  const a = verts[i], b = verts[(i + 1) % n];
  const fa = flatStart + i, fb = flatStart + ((i + 1) % n);
  const curved = edgeIsCurved(shape.handles, fa, fb);
  const c = curved ? edgeCubic(a, b, handleAt(shape.handles, fa), handleAt(shape.handles, fb))
                   : [a, a, b, b];
  const pts = curved ? [a].concat(sampleCubic(c[0], c[1], c[2], c[3], _sdSteps())) : [a, b];
  const cum = [0];
  for (let k = 1; k < pts.length; k++) {
    cum.push(cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
  }
  return { fa, fb, curved, c, pts, cum, len: cum[cum.length - 1] || 0, edge: fa };
}

// Where a point falls on a wall, as the cubic's parameter and as a fraction of the wall's length.
// ⚠ NOT THE SAME NUMBER ON A CURVE: geometry cuts by the first, a door places by the second.
function wallParamAt(wall, p) {
  let best = Infinity, bestSeg = 0, bestU = 0, bestRun = 0;
  for (let k = 1; k < wall.pts.length; k++) {
    const p0 = wall.pts[k - 1], p1 = wall.pts[k];
    const dx = p1.x - p0.x, dy = p1.y - p0.y;
    const q = dx * dx + dy * dy;
    const u = q === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - p0.x) * dx + (p.y - p0.y) * dy) / q));
    const cx = p0.x + dx * u, cy = p0.y + dy * u;
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d < best) {
      best = d; bestSeg = k; bestU = u;
      bestRun = wall.cum[k - 1] + Math.hypot(cx - p0.x, cy - p0.y);
    }
  }
  const steps = wall.pts.length - 1;
  return {
    t: (bestSeg - 1 + bestU) / steps,
    s: wall.len > 0 ? bestRun / wall.len : 0,
    dist: best,
  };
}

// The piece of a cubic between two parameters, as its own cubic: two de Casteljau splits, so it
// traces exactly the stretch it came from.
function subCubic(c, t0, t1) {
  if (!(t1 > t0)) return [c[0], c[0], c[3], c[3]];
  const right = splitCubic(c[0], c[1], c[2], c[3], t0).right;
  const u = (t1 - t0) / (1 - t0);
  if (!(u > 0) || !(u < 1)) return right;
  return splitCubic(right[0], right[1], right[2], right[3], u).left;
}

// Every wall a repair touches, plus the lookup that maps an answer point back onto one.
// ⚠ ONE COORDINATE CAN BE TWO SHAPES' CORNER, so the key holds every claim and locatePoint picks.
function buildDetailIndex(shapes) {
  const walls = [];
  const byKey = new Map();
  shapes.forEach((shape, s) => {
    const rings = polyRings(shape);
    let flatStart = 0;
    rings.forEach((verts, ring) => {
      if (verts && verts.length >= 3) {
        for (let i = 0; i < verts.length; i++) {
          const w = wallOf(shape, rings, ring, i, flatStart);
          w.s = s;
          w.shape = shape;
          walls.push(w);
          // The wall's START vertex, which is an anchor and carries a radius.
          const push = (k, entry) => {
            if (!byKey.has(k)) byKey.set(k, []);
            byKey.get(k).push(entry);
          };
          push(detailKey(verts[i].x, verts[i].y),
               { wall: w, anchor: true, flat: w.fa, t: 0, s: 0 });
          // ⚠ THE FLATTENING'S OWN SAMPLES ARE KEYED TOO, and they are the ONLY points restoreRing
          // may drop. A Trim's notch puts four new corners exactly ON a wall.
          const steps = w.pts.length - 1;
          for (let k = 1; k < w.pts.length - 1; k++) {
            push(detailKey(w.pts[k].x, w.pts[k].y),
                 { wall: w, anchor: false, sample: true, t: k / steps,
                   s: w.len > 0 ? w.cum[k] / w.len : 0, dist: 0 });
          }
        }
      }
      flatStart += verts ? verts.length : 0;
    });
  });
  return { walls, byKey };
}

// The rings a repair feeds the library, every curve sampled into straight points.
function flattenShapeForClip(shape) {
  const rings = polyRings(shape);
  const out = [];
  let flatStart = 0;
  for (let r = 0; r < rings.length; r++) {
    const verts = rings[r];
    if (!verts || verts.length < 3) { flatStart += verts ? verts.length : 0; continue; }
    const ring = [];
    for (let i = 0; i < verts.length; i++) {
      const w = wallOf(shape, rings, r, i, flatStart);
      ring.push({ x: verts[i].x, y: verts[i].y });
      for (let k = 1; k < w.pts.length - 1; k++) ring.push({ x: w.pts[k].x, y: w.pts[k].y });
    }
    out.push(ring);
    flatStart += verts.length;
  }
  return out;
}

// Which source wall an output point came from, and where on it. An intersection the library
// invented matches no key and is placed by distance.
function locatePoint(index, p, prefer) {
  const hits = index.byKey.get(detailKey(p.x, p.y));
  if (hits && hits.length) {
    // An anchor beats a sample, and `prefer` picks between two shapes' claims on a shared corner.
    const anchors = hits.filter(h => h.anchor);
    const pool = anchors.length ? anchors : hits;
    const hit = (prefer && pool.find(h => h.wall.shape === prefer)) || pool[0];
    return { wall: hit.wall, flat: hit.flat, anchor: !!hit.anchor, sample: !!hit.sample,
             t: hit.t, s: hit.s, dist: 0 };
  }
  let best = null;
  for (const w of index.walls) {
    const at = wallParamAt(w, p);
    if (!best || at.dist < best.dist) best = { wall: w, t: at.t, s: at.s, dist: at.dist, anchor: false };
  }
  return best;
}

// ⚠ DISTANCE DECIDES, NOT NEARNESS. locatePoint always answers with SOME wall, so a point the
// repair invented would take a curve off whichever wall happened to be closest.
function onWall(at, tol) {
  return !!at && (at.anchor || (at.dist != null && at.dist <= tol));
}

function restoreRing(index, ring, tol) {
  const kept = [];
  // TWO PASSES: place every point, then re-place a shared corner against its neighbours' shape.
  const first = ring.map(p => locatePoint(index, p));
  const located = ring.map((p, i) => {
    const at = first[i];
    if (!at || !at.anchor) return at;
    const prev = first[(i - 1 + ring.length) % ring.length];
    const next = first[(i + 1) % ring.length];
    const prefer = (prev && !prev.anchor && prev.wall.shape) ||
                   (next && !next.anchor && next.wall.shape) || null;
    return prefer ? locatePoint(index, p, prefer) : at;
  });
  for (let i = 0; i < ring.length; i++) {
    const at = located[i];
    // A sampled point that is not an anchor is scaffolding, and only survives when it is the only
    // thing holding a stretch of wall the repair cut on both sides.
    // ⚠ ONLY A SAMPLE THIS INDEX PUT THERE. A point the repair invented sits on a wall at distance
    // zero and looks identical, and dropping one deletes a corner of the cut.
    const sampled = !!at && at.sample === true;
    if (at && at.anchor) { kept.push({ p: ring[i], at }); continue; }
    if (!sampled) { kept.push({ p: ring[i], at }); continue; }
    const prev = located[(i - 1 + ring.length) % ring.length];
    const next = located[(i + 1) % ring.length];
    // ⚠ AN ANCHOR BELONGS TO TWO WALLS. The one ENDING a run is keyed to the next wall along, so
    // comparing wall objects alone keeps the last sample of every run and leaves a stray point.
    const same = (x) => !!x && (x.wall === at.wall ||
                                (x.anchor && (x.flat === at.wall.fa || x.flat === at.wall.fb)));
    if (same(prev) && same(next)) continue;         // mid-run scaffolding
    kept.push({ p: ring[i], at });
  }
  // ⚠ NEVER FEWER POINTS THAN THE REPAIR PRODUCED. A piece lying wholly along one curved wall is
  // all sampling, and answering null deletes a room the repair meant to keep.
  if (kept.length < 3) {
    return {
      verts: ring.map(p => ({ x: p.x, y: p.y })),
      radii: ring.map(() => null),
      handles: ring.map(() => null),
      spans: ring.map(() => null),
    };
  }

  const verts = kept.map(k => ({ x: k.p.x, y: k.p.y }));
  const radii = kept.map(k => (k.at && k.at.anchor && k.at.wall.shape.cornerRadii)
                               ? (k.at.wall.shape.cornerRadii[k.at.wall.fa] != null
                                  ? k.at.wall.shape.cornerRadii[k.at.wall.fa] : null)
                               : null);
  const handles = kept.map(() => null);
  const spans = [];                                 // one per output wall, for the doors

  for (let i = 0; i < kept.length; i++) {
    const A = kept[i], B = kept[(i + 1) % kept.length];
    const wall = onWall(A.at, tol) ? A.at.wall : null;
    // Both ends must sit on the SAME source wall, or this output wall is new and stays straight.
    const ends = onWall(B.at, tol) && (B.at.wall === wall ||
                                       (B.at.anchor && wall && B.at.flat === wall.fb));
    if (!wall || !ends) { spans.push(null); continue; }
    const t0 = A.at.anchor ? 0 : A.at.t;
    const t1 = B.at.anchor ? 1 : B.at.t;
    const s0 = A.at.anchor ? 0 : A.at.s;
    const s1 = B.at.anchor ? 1 : B.at.s;
    spans.push({ wall, t0, t1, s0, s1 });
    if (!wall.curved || !(t1 > t0)) continue;
    const sub = subCubic(wall.c, t0, t1);
    const j = (i + 1) % kept.length;
    handles[i] = setPart(handles[i], 'out', sub[1].x - verts[i].x, sub[1].y - verts[i].y);
    handles[j] = setPart(handles[j], 'in', sub[2].x - verts[j].x, sub[2].y - verts[j].y);
    // An anchor carries a radius OR handles, the rule setShapeHandle keeps.
    if (handles[i]) radii[i] = null;
    if (handles[j]) radii[j] = null;
  }
  return { verts, radii, handles, spans };
}

function setPart(h, part, dx, dy) {
  const out = h ? { ...h } : { ix: 0, iy: 0, ox: 0, oy: 0 };
  if (part === 'out') { out.ox = dx; out.oy = dy; } else { out.ix = dx; out.iy = dy; }
  return (out.ix || out.iy || out.ox || out.oy) ? out : null;
}

// Each door onto whichever output wall now carries the stretch it sat on. ⚠ One whose wall the
// repair removed has nowhere to go, and is COUNTED so the DM can be told.
function restoreDoors(index, pieces) {
  const doors = [];
  let dropped = 0;
  for (const w of index.walls) {
    const src = w.shape.doors;
    if (!src || !src.length) continue;
    for (const d of src) {
      if (d.edge !== w.edge) continue;
      let placed = false;
      for (let pi = 0; pi < pieces.length && !placed; pi++) {
        const spans = pieces[pi].spans;
        for (let e = 0; e < spans.length; e++) {
          const sp = spans[e];
          if (!sp || sp.wall !== w) continue;
          const lo = Math.min(sp.s0, sp.s1), hi = Math.max(sp.s0, sp.s1);
          if (d.t < lo || d.t > hi || hi <= lo) continue;
          doors.push({ ...d, piece: pi, edge: e, t: (d.t - lo) / (hi - lo) });
          placed = true;
          break;
        }
      }
      if (!placed) dropped++;
    }
  }
  return { doors, dropped };
}

// The one call a repair makes: shapes in, {verts, holes} pieces in, a record per piece out.
function restoreGroupDetail(shapes, pieces, tol) {
  const index = buildDetailIndex(shapes);
  const limit = tol != null ? tol : 1e-6;
  const built = [];
  for (const piece of pieces) {
    const rings = [piece.verts].concat(piece.holes || []);
    const parts = rings.map(r => restoreRing(index, r, limit));
    if (!parts[0]) continue;
    // Flat across the outer ring then each hole, as every other per-vertex array is.
    const kept = parts.filter(Boolean);
    const radii = [], handles = [], spans = [];
    for (const part of kept) {
      for (const r of part.radii) radii.push(r);
      for (const h of part.handles) handles.push(h);
      for (const sp of part.spans) spans.push(sp);
    }
    built.push({
      vertices: kept[0].verts,
      holes: kept.slice(1).map(k => k.verts),
      radii, handles, spans,
    });
  }
  const doorPlan = restoreDoors(index, built);
  const out = built.map((b, i) => {
    const shape = { vertices: b.vertices };
    if (b.holes.length) shape.holes = b.holes;
    if (b.radii.some(r => r != null)) shape.cornerRadii = b.radii;
    if (b.handles.some(h => h)) shape.handles = b.handles;
    const doors = doorPlan.doors.filter(d => d.piece === i)
                                .map(d => ({ edge: d.edge, t: d.t, ...strip(d) }));
    if (doors.length) shape.doors = doors;
    return shape;
  });
  return { pieces: out, droppedDoors: doorPlan.dropped };
}

// One shape's own rings: flatten a room, hand them straight back, and nothing may have changed.
function restoreShapeDetail(shapes, outRings, tol) {
  return restoreGroupDetail(shapes, [{ verts: outRings[0], holes: outRings.slice(1) }], tol);
}

function strip(d) {
  const out = { ...d };
  delete out.piece;
  delete out.edge;
  delete out.t;
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    detailKey,
    wallOf,
    wallParamAt,
    subCubic,
    buildDetailIndex,
    flattenShapeForClip,
    restoreRing,
    restoreDoors,
    restoreShapeDetail,
    restoreGroupDetail,
  };
}
