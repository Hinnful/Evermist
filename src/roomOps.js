'use strict';

// roomOps.js — the pure kernel for "change a room's shape": Join, Trim and Cut. Every entry
// point answers with `pieces`/`groups` or a `reason` string, and never calls a dialog.

// polygon-clipping 0.15.7: the vendored UMD build in the browser, the devDependency under Node.
const clip = typeof polygonClipping !== 'undefined' ? polygonClipping
           : require('polygon-clipping');

// ⚠ THE LIBRARY THROWS, so every call goes through runClip(). Uncaught, a throw lands in a
// mouseup handler after pushUndo() has run: a stray undo entry and a dead tool.
const REASON_FAILED = 'Those shapes could not be combined. Nothing changed.';
const REASON_HOLE   = 'That would leave a hole inside a room, and a room is one outline. ' +
                      'Nothing changed.';
const REASON_CUT    = 'A cut has to enter and leave the room once each. Nothing changed.';

// Sliver floor when gridSize is 0, set far below the smallest room a real floor plan produces —
// test/roomOps.test.js pins it against the cave export.
const ROOM_OP_MIN_AREA = 400;

function roomOpMinArea(gridSize) {
  const g = Number(gridSize);
  return (isFinite(g) && g > 0) ? g * g : ROOM_OP_MIN_AREA;
}

// ⚠ THE LIBRARY'S RINGS ARE CLOSED and the app's `vertices` are not. Feed it an open ring and
// it reads a missing edge; keep its closing point and every edited room gains a zero-length one.
function toRings(verts) {
  const ring = verts.map(v => [v.x, v.y]);
  ring.push([verts[0].x, verts[0].y]);
  return [ring];
}

function fromRings(poly) {
  const ring = poly[0].map(p => ({ x: p[0], y: p[1] }));
  const n = ring.length;
  if (n > 1 && ring[0].x === ring[n - 1].x && ring[0].y === ring[n - 1].y) ring.pop();
  return ring;
}

function ringArea(verts) {
  let s = 0;
  for (let i = 0, n = verts.length; i < n; i++) {
    const a = verts[i], b = verts[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

function runClip(fn) {
  try {
    return { multi: fn() };
  } catch (_) {
    return { reason: REASON_FAILED };
  }
}

// A result is a MultiPolygon: Polygons, each an array of rings. A SPLIT comes back as two
// Polygons of one ring each; a HOLE as one Polygon of two rings.
// ⚠ The refusal is "more than one ring inside ONE Polygon", never "more than one ring" — the
// latter refuses exactly the split this feature exists to produce.
function resultPieces(multi, minArea) {
  if (!Array.isArray(multi)) return { reason: REASON_FAILED };
  const pieces = [];
  for (const poly of multi) {
    if (!Array.isArray(poly) || !poly.length) continue;
    if (poly.length > 1) return { reason: REASON_HOLE };
    const verts = fromRings(poly);
    if (verts.length < 3 || ringArea(verts) < minArea) continue;
    pieces.push(verts);
  }
  return { pieces };
}

// Any area in common with a shape already on the map. Touching along an edge scores zero, which
// is right: neither a union nor a difference there moves a single point.
function shapesOverlap(a, b) {
  if (!a || !b || a.length < 3 || b.length < 3) return false;
  const r = runClip(() => clip.intersection(toRings(a), toRings(b)));
  if (r.reason || !Array.isArray(r.multi)) return false;
  for (const poly of r.multi) {
    if (Array.isArray(poly) && poly.length && ringArea(fromRings(poly)) > 0) return true;
  }
  return false;
}

// Every contributor unioned with the drawn shape, so one drag over two rooms leaves one room.
function joinShapes(rooms, drawn, minArea) {
  if (!rooms.length) return { pieces: [] };
  const r = runClip(() => clip.union(toRings(drawn), ...rooms.map(toRings)));
  if (r.reason) return { reason: r.reason };
  return resultPieces(r.multi, minArea);
}

// Never the earliest contributor's: a join must not reveal TV ground shrouded a moment earlier.
const ROOM_OP_MODE_ORDER = ['shroud', 'half', 'reveal'];

function mostHiddenMode(modes) {
  for (const m of ROOM_OP_MODE_ORDER) if (modes.indexOf(m) >= 0) return m;
  return 'shroud';
}

// The drawn shape subtracted from each contributor, `groups` aligned to `rooms` by index.
// ⚠ ALL OR NOTHING: a hole or a throw on any one room refuses the whole operation, so the DM
// never gets half an edit they have to unpick by hand.
function trimShapes(rooms, drawn, minArea) {
  const groups = [];
  for (const room of rooms) {
    const r = runClip(() => clip.difference(toRings(room), toRings(drawn)));
    if (r.reason) return { reason: r.reason };
    const out = resultPieces(r.multi, minArea);
    if (out.reason) return { reason: out.reason };
    groups.push(out.pieces);
  }
  return { groups };
}

// ─── Cut ──────────────────────────────────────────────────────────────────────
// Its own geometry, not the library's, because a cut is ZERO WIDTH: both pieces carry the same
// path points, so their edges touch exactly.

const CUT_PARALLEL_EPS = 1e-9;
const CUT_DEDUPE       = 0.01;   // map units

// ⚠ HALF-OPEN IN BOTH PARAMETERS. A crossing that lands exactly on a vertex belongs to the edge
// or segment that starts there, so it is counted once rather than twice or not at all.
function crossSegments(a1, a2, b1, b2) {
  const dax = a2.x - a1.x, day = a2.y - a1.y;
  const dbx = b2.x - b1.x, dby = b2.y - b1.y;
  const den = dax * dby - day * dbx;
  if (Math.abs(den) < CUT_PARALLEL_EPS) return null;
  const wx = b1.x - a1.x, wy = b1.y - a1.y;
  const u = (wx * dby - wy * dbx) / den;
  const t = (wx * day - wy * dax) / den;
  if (u < 0 || u >= 1 || t < 0 || t >= 1) return null;
  return { u, t, point: { x: a1.x + u * dax, y: a1.y + u * day } };
}

function ringPathCrossings(ring, path) {
  const hits = [];
  for (let s = 0; s < path.length - 1; s++) {
    for (let e = 0; e < ring.length; e++) {
      const x = crossSegments(path[s], path[s + 1], ring[e], ring[(e + 1) % ring.length]);
      if (x) hits.push({ seg: s, u: x.u, edge: e, t: x.t, point: x.point });
    }
  }
  hits.sort((p, q) => p.seg - q.seg || p.u - q.u);
  return hits;
}

// The outline walked forwards from one crossing to the other. Same edge, far one ahead, is the
// "enters and leaves one wall" case and takes no vertices; far one behind wraps the whole ring.
function arcForward(ring, from, to) {
  const n = ring.length;
  const pts = [from.point];
  if (from.edge === to.edge && to.t > from.t) { pts.push(to.point); return pts; }
  let i = (from.edge + 1) % n;
  for (let k = 0; k < n; k++) {
    pts.push({ x: ring[i].x, y: ring[i].y });
    if (i === to.edge) break;
    i = (i + 1) % n;
  }
  pts.push(to.point);
  return pts;
}

function dedupeRing(pts) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < CUT_DEDUPE) continue;
    out.push({ x: p.x, y: p.y });
  }
  while (out.length > 1 &&
         Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) < CUT_DEDUPE) {
    out.pop();
  }
  return out;
}

function cutRing(ring, path, minArea) {
  if (!Array.isArray(ring) || ring.length < 3) return { reason: REASON_CUT };
  if (!Array.isArray(path) || path.length < 2) return { reason: REASON_CUT };
  const hits = ringPathCrossings(ring, path);
  if (hits.length !== 2) return { reason: REASON_CUT };
  const c0 = hits[0], c1 = hits[1];
  const inner = path.slice(c0.seg + 1, c1.seg + 1);
  const back  = inner.slice().reverse();
  const pieces = [
    dedupeRing(arcForward(ring, c0, c1).concat(back)),
    dedupeRing(arcForward(ring, c1, c0).concat(inner)),
  ].filter(p => p.length >= 3 && ringArea(p) >= minArea);
  if (!pieces.length) return { reason: REASON_CUT };
  return { pieces };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    toRings, fromRings, ringArea, resultPieces, shapesOverlap,
    joinShapes, trimShapes, cutRing, mostHiddenMode, roomOpMinArea,
    crossSegments, ringPathCrossings, arcForward, dedupeRing,
    ROOM_OP_MIN_AREA, REASON_FAILED, REASON_HOLE, REASON_CUT,
  };
}
