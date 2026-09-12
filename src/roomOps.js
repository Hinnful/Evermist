'use strict';

// roomOps.js — the pure kernel for "change a room's shape": Join, Trim and Cut. Every entry
// point answers with `pieces`/`groups` or a `reason` string, and never calls a dialog.

// polygon-clipping 0.15.7: the vendored UMD build in the browser, the devDependency under Node.
const clip = typeof polygonClipping !== 'undefined' ? polygonClipping
           : require('polygon-clipping');

// ⚠ THE LIBRARY THROWS, so every call goes through runClip(). Uncaught, a throw lands in a
// mouseup handler after pushUndo() has run: a stray undo entry and a dead tool.
const REASON_FAILED = 'Those shapes could not be combined. Nothing changed.';
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
//
// ⚠ EITHER a record with vertices/holes OR a bare point list: the shape the DM just drew reaches
// joinShapes and trimShapes with no record behind it. A plain array is one ring.
function toRings(src) {
  if (!src) return [];
  const lists = Array.isArray(src) ? [src] : [src.vertices || []].concat(src.holes || []);
  const rings = [];
  for (const verts of lists) {
    if (!verts || verts.length < 3) continue;
    const ring = verts.map(v => [v.x, v.y]);
    ring.push([verts[0].x, verts[0].y]);
    rings.push(ring);
  }
  return rings;
}

function ringToVerts(ring) {
  const verts = ring.map(p => ({ x: p[0], y: p[1] }));
  const n = verts.length;
  if (n > 1 && verts[0].x === verts[n - 1].x && verts[0].y === verts[n - 1].y) verts.pop();
  return verts;
}

function fromRings(poly) {
  return ringToVerts(poly[0]);
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
// Polygons of one ring each; a HOLE as one Polygon of two rings, and the inner ones become the
// piece's `holes`. Every piece is { verts, holes }, holes possibly empty.
// A hole under the sliver floor is dropped, the same way a sliver piece is.
function resultPieces(multi, minArea) {
  if (!Array.isArray(multi)) return { reason: REASON_FAILED };
  const pieces = [];
  for (const poly of multi) {
    if (!Array.isArray(poly) || !poly.length) continue;
    const verts = ringToVerts(poly[0]);
    if (verts.length < 3 || ringArea(verts) < minArea) continue;
    const holes = [];
    for (let i = 1; i < poly.length; i++) {
      const h = ringToVerts(poly[i]);
      if (h.length >= 3 && ringArea(h) >= minArea) holes.push(h);
    }
    pieces.push({ verts, holes });
  }
  return { pieces };
}

// Any area in common with a shape already on the map. Touching along an edge scores zero, which
// is right: neither a union nor a difference there moves a single point.
// ⚠ THE RECORD GOES IN, NOT ITS OUTER RING: a shape sitting inside a courtyard would otherwise
// read as overlapping the keep around it.
function shapesOverlap(a, b) {
  const ra = toRings(a), rb = toRings(b);
  if (!ra.length || !rb.length) return false;
  const r = runClip(() => clip.intersection(ra, rb));
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
// ⚠ ALL OR NOTHING: a throw on any one room refuses the whole operation, so the DM never gets
// half an edit they have to unpick by hand.
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

function pointInRing(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, yi = ring[i].y;
    const xj = ring[j].x, yj = ring[j].y;
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Which piece a hole fell into. A concave hole whose centroid sits outside itself falls back to
// its own vertices.
function ringHomePiece(hole, pieces) {
  let cx = 0, cy = 0;
  for (const v of hole) { cx += v.x; cy += v.y; }
  cx /= hole.length; cy /= hole.length;
  for (let i = 0; i < pieces.length; i++) if (pointInRing(cx, cy, pieces[i].verts)) return i;
  for (const v of hole) {
    for (let i = 0; i < pieces.length; i++) if (pointInRing(v.x, v.y, pieces[i].verts)) return i;
  }
  return -1;
}

// A hole the cut runs THROUGH, clipped to each piece. ⚠ Handed whole to one piece it pokes out
// through that piece's own wall, and the other loses its half of the courtyard. A library throw
// answers false, and the caller falls back to handing it over whole.
function splitHoleAcrossPieces(hole, pieces, minArea) {
  const hr = toRings(hole);
  const parts = pieces.map(p => runClip(() => clip.intersection(toRings(p.verts), hr)));
  if (parts.some(r => r.reason || !Array.isArray(r.multi))) return false;
  parts.forEach((r, i) => {
    for (const poly of r.multi) {
      if (!Array.isArray(poly) || !poly.length) continue;
      const verts = ringToVerts(poly[0]);
      if (verts.length >= 3 && ringArea(verts) >= minArea) pieces[i].holes.push(verts);
    }
  });
  return true;
}

// The path cuts the OUTER ring only; each hole rides onto whichever piece it landed in.
function cutRing(src, path, minArea) {
  const ring = Array.isArray(src) ? src : (src && src.vertices);
  const holes = (Array.isArray(src) ? null : (src && src.holes)) || [];
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
  ].filter(p => p.length >= 3 && ringArea(p) >= minArea)
   .map(verts => ({ verts, holes: [] }));
  if (!pieces.length) return { reason: REASON_CUT };
  for (const hole of holes) {
    if (!hole || hole.length < 3) continue;
    // Only when the path runs through it, so a hole the cut misses keeps its own points.
    if (ringPathCrossings(hole, path).length &&
        splitHoleAcrossPieces(hole, pieces, minArea)) continue;
    const home = ringHomePiece(hole, pieces);
    if (home >= 0) pieces[home].holes.push(hole.map(v => ({ x: v.x, y: v.y })));
  }
  return { pieces };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    toRings, fromRings, ringToVerts, ringArea, resultPieces, shapesOverlap,
    joinShapes, trimShapes, cutRing, mostHiddenMode, roomOpMinArea,
    crossSegments, ringPathCrossings, arcForward, dedupeRing,
    pointInRing, ringHomePiece, splitHoleAcrossPieces,
    ROOM_OP_MIN_AREA, REASON_FAILED, REASON_CUT,
  };
}
