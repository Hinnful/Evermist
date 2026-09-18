// shapeHit.js — what the cursor is over: is a point inside a room, how far is it from a wall,
// where on that wall does it land. Pure. The selection and the zoom stay in shapeSelect.js.
//
// ⚠ A BENT WALL is tested against its sampled curve, never the straight line between its
// anchors, or the room has a dead strip along every bow.

'use strict';

// ⚠ `CURVE_SAMPLE_STEPS` is read, never redeclared — see doorGeometry.js.
const _shSteps = () => (typeof CURVE_SAMPLE_STEPS !== 'undefined' ? CURVE_SAMPLE_STEPS
  : require('./fogGeometry').CURVE_SAMPLE_STEPS);

var polyHoleRings, flattenRing, edgeIsCurved, edgeCubic, handleAt, sampleCubic;
if (typeof module !== 'undefined' && module.exports) {
  ({ polyHoleRings, flattenRing, edgeIsCurved, edgeCubic, handleAt,
     sampleCubic } = require('./fogGeometry'));
}

function distPointToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function closestPointOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { x: ax, y: ay };
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return { x: ax + t * dx, y: ay + t * dy };
}

function pointInPolygon(px, py, verts) {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const xi = verts[i].x, yi = verts[i].y;
    const xj = verts[j].x, yj = verts[j].y;
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ⚠ ONE CROSSING TEST PER RING, XORed. Concatenating the rings and testing once wraps j past the
// end of each ring: the closing edges vanish, two bridge edges appear, and the room grows dead
// patches where a click selects nothing.
function pointInShape(px, py, poly) {
  const verts = poly && poly.vertices;
  if (!verts || verts.length < 3) return false;
  const holes = polyHoleRings(poly);
  // A BENT WALL bows away from the straight line between its anchors, so a click in the bulge has
  // to be tested against the curve or the room has a dead strip along it.
  const h = poly.handles;
  const flat = (ring, off) => (h ? flattenRing(ring, h, off) : ring);
  if (!holes.length) return pointInPolygon(px, py, flat(verts, 0));
  let inside = pointInPolygon(px, py, flat(verts, 0));
  let off = verts.length;
  for (const ring of holes) {
    if (pointInPolygon(px, py, flat(ring, off))) inside = !inside;
    off += ring.length;
  }
  return inside;
}

// A hole's empty middle is its only grab target: pointInShape XORs it out. Reversed, so the newer
// of two overlapping holes takes the click.
function findHoleAt(poly, mapX, mapY) {
  const holes = polyHoleRings(poly);
  for (let i = holes.length - 1; i >= 0; i--) {
    if (pointInPolygon(mapX, mapY, holes[i])) return i;
  }
  return -1;
}

// The flat index of the wall's far anchor. A ring wraps, so the last wall ends back at its first.
function edgeEndFlat(ring, i, flat) {
  return flat - i + ((i + 1) % ring.length);
}

// What a wall is hit-tested against: itself when straight, its sampled curve when bent.
function edgePolyline(poly, ring, i, flat) {
  const a = ring[i], b = ring[(i + 1) % ring.length];
  const fb = edgeEndFlat(ring, i, flat);
  if (!edgeIsCurved(poly.handles, flat, fb)) return [a, b];
  const c = edgeCubic(a, b, handleAt(poly.handles, flat), handleAt(poly.handles, fb));
  return [a].concat(sampleCubic(c[0], c[1], c[2], c[3], _shSteps()));
}

function distToEdge(poly, ring, i, flat, mapX, mapY) {
  const pts = edgePolyline(poly, ring, i, flat);
  let best = Infinity;
  for (let k = 0; k + 1 < pts.length; k++) {
    const d = distPointToSegment(mapX, mapY, pts[k].x, pts[k].y, pts[k + 1].x, pts[k + 1].y);
    if (d < best) best = d;
  }
  return best;
}

// The point on a wall nearest the cursor, with `t` the fraction of the wall's own LENGTH — what a
// door and a vertex insert both key off.
function closestOnEdge(poly, ring, i, flat, mapX, mapY) {
  const pts = edgePolyline(poly, ring, i, flat);
  let best = Infinity, bestPt = pts[0], bestRun = 0, run = 0, total = 0;
  for (let k = 0; k + 1 < pts.length; k++) {
    const seg = Math.hypot(pts[k + 1].x - pts[k].x, pts[k + 1].y - pts[k].y);
    const q = closestPointOnSegment(mapX, mapY, pts[k].x, pts[k].y, pts[k + 1].x, pts[k + 1].y);
    const d = Math.hypot(mapX - q.x, mapY - q.y);
    if (d < best) { best = d; bestPt = q; bestRun = total + Math.hypot(q.x - pts[k].x, q.y - pts[k].y); }
    total += seg;
  }
  run = total > 0 ? bestRun / total : 0.5;
  return { pt: bestPt, t: Math.max(0, Math.min(1, run)) };
}

// A dragged hole STOPS DEAD where it would leave its room: one off its room cuts nothing and reads
// as vanished. The test is the ring's average point; docs/decisions/ui-and-control-panel.md says why.
function ringCentre(ring) {
  let x = 0, y = 0;
  for (const v of ring) { x += v.x; y += v.y; }
  return { x: x / ring.length, y: y / ring.length };
}

function holeStaysOnRoom(poly, movedRing) {
  const c = ringCentre(movedRing);
  return pointInPolygon(c.x, c.y,
    poly.handles ? flattenRing(poly.vertices, poly.handles, 0) : poly.vertices);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    pointInPolygon, pointInShape, findHoleAt,
    distPointToSegment, closestPointOnSegment,
    edgeEndFlat, edgePolyline, distToEdge, closestOnEdge,
    ringCentre, holeStaysOnRoom,
  };
}

