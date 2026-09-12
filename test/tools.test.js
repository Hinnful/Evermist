'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
// tools.js reaches these as bare globals, the way the browser's script order provides them.
// The real implementations are hoisted rather than duplicated; pushUndo is a counter, since what
// matters here is that one delete spends exactly one step.
const _fg = require('../src/fogGeometry.js');
global.polyRings = _fg.polyRings;
global.polyHoleRings = _fg.polyHoleRings;
global.flatVertexRef = _fg.flatVertexRef;
global.flatVertexCount = _fg.flatVertexCount;
global.remapDoorsForVertexChange = _fg.remapDoorsForVertexChange;
let undoPushes = 0;
global.pushUndo = () => { undoPushes++; };

const { pointInPolygon, pointInShape, deleteShapeVertex,
        distPointToSegment, segmentsIntersect } = require('../src/tools.js');

// A simple convex quad (unit square)
const square = [
  { x: 0, y: 0 }, { x: 1, y: 0 },
  { x: 1, y: 1 }, { x: 0, y: 1 },
];

// A concave arrow pointing right: a shape where naive even-odd fails without ray-casting
const arrow = [
  { x: 0, y: 1 }, { x: 2, y: 0 }, { x: 1, y: 1 },
  { x: 2, y: 2 }, { x: 0, y: 1 },
];
// The notch point (1, 1) is inside the bounding box but outside the arrow body

describe('pointInPolygon', () => {
  test('point clearly inside a convex quad', () => {
    assert.equal(pointInPolygon(0.5, 0.5, square), true);
  });
  test('point clearly outside a convex quad', () => {
    assert.equal(pointInPolygon(2, 2, square), false);
  });
  test('point just inside a convex quad edge', () => {
    assert.equal(pointInPolygon(0.5, 0.01, square), true);
  });
  test('point just outside a convex quad edge', () => {
    assert.equal(pointInPolygon(0.5, -0.01, square), false);
  });
  test('point just inside near a vertex', () => {
    assert.equal(pointInPolygon(0.01, 0.01, square), true);
  });
  test('concave polygon — point inside the body', () => {
    // (0.5, 1) is clearly inside the arrow body on the left side
    assert.equal(pointInPolygon(0.5, 1, arrow), true);
  });
  test('concave polygon — point in the notch (outside)', () => {
    // (1, 1) is the indent tip — the notch is outside the arrow polygon
    assert.equal(pointInPolygon(1, 1, arrow), false);
  });
  test('winding independence — CW and CCW quad give the same answer', () => {
    const cw = [...square].reverse();
    assert.equal(pointInPolygon(0.5, 0.5, square), pointInPolygon(0.5, 0.5, cw));
    assert.equal(pointInPolygon(2, 2, square), pointInPolygon(2, 2, cw));
  });
});

describe('distPointToSegment', () => {
  test('perpendicular foot on segment (0 < t < 1)', () => {
    // foot is (0, 0.5) on segment (0,0)-(0,1); distance from (1,0.5) is 1
    const d = distPointToSegment(1, 0.5, 0, 0, 0, 1);
    assert.ok(Math.abs(d - 1) < 1e-9, `expected 1, got ${d}`);
  });
  test('projection past A end (t clamps to 0)', () => {
    // nearest point on segment (1,0)-(2,0) from (0,0) is (1,0), distance=1
    const d = distPointToSegment(0, 0, 1, 0, 2, 0);
    assert.ok(Math.abs(d - 1) < 1e-9, `expected 1, got ${d}`);
  });
  test('projection past B end (t clamps to 1)', () => {
    // nearest point on segment (0,0)-(1,0) from (3,0) is (1,0), distance=2
    const d = distPointToSegment(3, 0, 0, 0, 1, 0);
    assert.ok(Math.abs(d - 2) < 1e-9, `expected 2, got ${d}`);
  });
  test('degenerate zero-length segment returns distance to A', () => {
    const d = distPointToSegment(3, 4, 0, 0, 0, 0);
    assert.ok(Math.abs(d - 5) < 1e-9, `expected 5, got ${d}`);
  });
});

describe('segmentsIntersect', () => {
  test('clean X crossing — returns intersection point', () => {
    // (0,0)-(2,2) crosses (0,2)-(2,0) at (1,1)
    const p = segmentsIntersect({ x: 0, y: 0 }, { x: 2, y: 2 },
                                 { x: 0, y: 2 }, { x: 2, y: 0 });
    assert.ok(p !== null, 'expected intersection');
    assert.ok(Math.abs(p.x - 1) < 1e-9, `x: expected 1, got ${p.x}`);
    assert.ok(Math.abs(p.y - 1) < 1e-9, `y: expected 1, got ${p.y}`);
  });
  test('parallel segments — returns null', () => {
    const p = segmentsIntersect({ x: 0, y: 0 }, { x: 1, y: 0 },
                                 { x: 0, y: 1 }, { x: 1, y: 1 });
    assert.equal(p, null);
  });
  test('collinear segments — returns null', () => {
    const p = segmentsIntersect({ x: 0, y: 0 }, { x: 2, y: 0 },
                                 { x: 1, y: 0 }, { x: 3, y: 0 });
    assert.equal(p, null);
  });
  test('crossing only at endpoint (t just outside 0.001–0.999 open interval) — returns null', () => {
    // Make segments that would meet exactly at t=0/u=0 (endpoint intersection)
    // p1 at (0,0), p2 at (1,0); p3 at (0,0), p4 at (0,1) — they share p1=p3
    // t=0 at p1, u=0 at p3 — both outside the (0.001, 0.999) open interval
    const p = segmentsIntersect({ x: 0, y: 0 }, { x: 1, y: 0 },
                                 { x: 0, y: 0 }, { x: 0, y: 1 });
    assert.equal(p, null);
  });
});

// ⚠ EVERY CASE ABOVE STARTS A SEGMENT AT THE ORIGIN AND IS GEOMETRICALLY SYMMETRIC, which is why
// the arithmetic inside this function was unprotected: with p1 at (0,0), `p2.x - p1.x` and
// `p2.x + p1.x` are the same number, and on a symmetric crossing t and u are both 0.5, so the two
// parameters can be computed from each other's formula and nothing notices. The cases below are
// off-origin, oblique, and deliberately have t ≠ u.
describe('segmentsIntersect — off-origin, asymmetric, and at the thresholds', () => {
  test('axis-aligned crossing away from the origin, t ≠ u', () => {
    // horizontal (10,10)-(20,10) crossed by vertical (12,4)-(12,24): meet at (12,10)
    // t = 2/10 = 0.2 along the first, u = 6/20 = 0.3 along the second
    const p = segmentsIntersect({ x: 10, y: 10 }, { x: 20, y: 10 },
                                 { x: 12, y: 4 },  { x: 12, y: 24 });
    assert.ok(p !== null, 'expected intersection');
    assert.ok(Math.abs(p.x - 12) < 1e-9, `x: expected 12, got ${p.x}`);
    assert.ok(Math.abs(p.y - 10) < 1e-9, `y: expected 10, got ${p.y}`);
  });

  test('oblique crossing, neither segment axis-aligned, t = 0.25 and u = 0.75', () => {
    // (2,3)-(10,7) crossed by (1,10)-(5,2): meet at (4,4), a quarter along one and
    // three quarters along the other — so the two parameters cannot be swapped unnoticed.
    const p = segmentsIntersect({ x: 2, y: 3 },  { x: 10, y: 7 },
                                 { x: 1, y: 10 }, { x: 5,  y: 2 });
    assert.ok(p !== null, 'expected intersection');
    assert.ok(Math.abs(p.x - 4) < 1e-9, `x: expected 4, got ${p.x}`);
    assert.ok(Math.abs(p.y - 4) < 1e-9, `y: expected 4, got ${p.y}`);
  });

  // A long segment crossed by a short one placed at a chosen fraction along it. The first
  // helper varies t and holds u at 0.5; the second varies u and holds t at 0.5. Both are
  // off-origin, so neither doubles as an accidental origin case.
  const atT = x => segmentsIntersect({ x: 100, y: 50 }, { x: 1100, y: 50 },
                                      { x: 100 + x, y: 49 }, { x: 100 + x, y: 51 });
  const atU = x => segmentsIntersect({ x: 100 + x, y: 49 }, { x: 100 + x, y: 51 },
                                      { x: 100, y: 50 }, { x: 1100, y: 50 });

  test('t just below the 0.001 floor is refused', () => {
    assert.equal(atT(0.5), null);        // t = 0.0005
  });
  test('t just above the 0.001 floor crosses', () => {
    const p = atT(2);                   // t = 0.002
    assert.ok(p !== null && Math.abs(p.x - 102) < 1e-9, `expected x 102, got ${p && p.x}`);
  });
  test('t just below the 0.999 ceiling crosses', () => {
    const p = atT(998);                 // t = 0.998
    assert.ok(p !== null && Math.abs(p.x - 1098) < 1e-9, `expected x 1098, got ${p && p.x}`);
  });
  test('t just above the 0.999 ceiling is refused', () => {
    assert.equal(atT(999.5), null);     // t = 0.9995
  });
  test('u just below the 0.001 floor is refused', () => {
    assert.equal(atU(0.5), null);       // u = 0.0005
  });
  test('u just above the 0.001 floor crosses', () => {
    const p = atU(2);                   // u = 0.002
    assert.ok(p !== null && Math.abs(p.y - 50) < 1e-9, `expected y 50, got ${p && p.y}`);
  });
  test('u just below the 0.999 ceiling crosses', () => {
    const p = atU(998);                 // u = 0.998
    assert.ok(p !== null && Math.abs(p.y - 50) < 1e-9, `expected y 50, got ${p && p.y}`);
  });
  test('u just above the 0.999 ceiling is refused', () => {
    assert.equal(atU(999.5), null);     // u = 0.9995
  });

  // The interval is OPEN at both ends, and these land on the bounds exactly: 2/2000 and
  // 1998/2000 are bit-identical to the literals 0.001 and 0.999, so this is the difference
  // between `>` and `>=` rather than a rounding accident.
  test('exactly at the bounds the crossing is refused, not accepted', () => {
    assert.equal(atT(1), null);        // t === 0.001
    assert.equal(atT(999), null);      // t === 0.999
    assert.equal(atU(1), null);        // u === 0.001
    assert.equal(atU(999), null);      // u === 0.999
  });
});

// The ray cast is only exercised above against axis-aligned edges and one arrow, which leaves the
// edge-crossing arithmetic — the divide by (yj - yi) in particular — free to be anything.
describe('pointInPolygon — oblique edges', () => {
  // A parallelogram leaning right: no edge is axis-aligned on the sloped sides.
  const lean = [
    { x: 2, y: 0 }, { x: 6, y: 0 }, { x: 8, y: 4 }, { x: 4, y: 4 },
  ];
  test('inside near the leaning left edge', () => {
    assert.equal(pointInPolygon(3.2, 2, lean), true);
  });
  test('outside just past the leaning left edge', () => {
    assert.equal(pointInPolygon(2.8, 2, lean), false);
  });
  test('inside near the leaning right edge', () => {
    assert.equal(pointInPolygon(6.8, 2, lean), true);
  });
  test('outside just past the leaning right edge', () => {
    assert.equal(pointInPolygon(7.2, 2, lean), false);
  });
  test('a triangle with three oblique edges', () => {
    const tri = [{ x: 0, y: 0 }, { x: 10, y: 3 }, { x: 4, y: 9 }];
    assert.equal(pointInPolygon(4, 4, tri), true);
    assert.equal(pointInPolygon(9, 8, tri), false);
    assert.equal(pointInPolygon(1, 6, tri), false);
  });
});

// ⚠ ALL FOUR CASES ABOVE PUT THE SEGMENT ON AN AXIS, so the projection arithmetic was never held
// to anything: with dy = 0 the dot product loses a term and the foot of the perpendicular is the
// point's own x. These are oblique and off-origin, with distances that come out exact.
describe('distPointToSegment — oblique segments', () => {
  test('perpendicular foot partway along an oblique segment', () => {
    // (1,1)-(4,5), point (1,5): foot at (2.92, 3.56), distance 2.4
    const d = distPointToSegment(1, 5, 1, 1, 4, 5);
    assert.ok(Math.abs(d - 2.4) < 1e-9, `expected 2.4, got ${d}`);
  });
  test('perpendicular foot on an oblique segment away from the origin', () => {
    // (2,1)-(6,4), point (5,-1): foot at (2.96, 1.72), distance 3.4
    const d = distPointToSegment(5, -1, 2, 1, 6, 4);
    assert.ok(Math.abs(d - 3.4) < 1e-9, `expected 3.4, got ${d}`);
  });
  test('projection lands exactly on the A end of an oblique segment', () => {
    // (0,0)-(3,4), point (4,-3): the dot product is zero, so t clamps to 0 and the
    // distance is |(4,-3)| = 5
    const d = distPointToSegment(4, -3, 0, 0, 3, 4);
    assert.ok(Math.abs(d - 5) < 1e-9, `expected 5, got ${d}`);
  });
  test('projection past the B end of an oblique segment', () => {
    // (0,0)-(3,4) with the point beyond B along the same line: distance from B
    const d = distPointToSegment(6, 8, 0, 0, 3, 4);
    assert.ok(Math.abs(d - 5) < 1e-9, `expected 5, got ${d}`);
  });

  // The degenerate case above collapses the segment onto the ORIGIN, where `px - ax` and
  // `px + ax` are the same number. A zero-length segment is a room whose two vertices landed on
  // each other, which can be anywhere.
  test('a zero-length segment away from the origin measures from where it actually is', () => {
    // both ends at (10, 20); the point is a 3-4-5 away from it
    const d = distPointToSegment(13, 24, 10, 20, 10, 20);
    assert.ok(Math.abs(d - 5) < 1e-9, `expected 5, got ${d}`);
  });
});

// ─── Rooms with holes ─────────────────────────────────────────────────────────
const rect = (x1, y1, x2, y2) =>
  [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];

describe('pointInShape', () => {
  const keep = { vertices: rect(0, 0, 100, 100), holes: [rect(30, 30, 70, 70)] };

  test('inside the room but outside its courtyard', () => {
    assert.equal(pointInShape(10, 10, keep), true);
  });
  test('inside the courtyard reads as outside the room', () => {
    assert.equal(pointInShape(50, 50, keep), false);
  });
  test('outside the room entirely', () => {
    assert.equal(pointInShape(200, 200, keep), false);
  });
  test('a record with no hole answers exactly as pointInPolygon does', () => {
    const plain = { vertices: rect(0, 0, 100, 100) };
    assert.equal(pointInShape(50, 50, plain), true);
    assert.equal(pointInShape(150, 50, plain), false);
  });
  test('two holes each cut their own void', () => {
    const two = { vertices: rect(0, 0, 100, 100),
                  holes: [rect(10, 10, 30, 30), rect(60, 60, 90, 90)] };
    assert.equal(pointInShape(20, 20, two), false);
    assert.equal(pointInShape(70, 70, two), false);
    assert.equal(pointInShape(45, 45, two), true);
  });
});

describe('deleteShapeVertex', () => {
  test('takes one point off the outer outline and renumbers nothing else', () => {
    const p = { vertices: rect(0, 0, 100, 100).concat([{ x: 50, y: 120 }]),
                holes: [rect(30, 30, 70, 70)],
                cornerRadii: [1, 2, 3, 4, 5, 6, 7, 8, 9] };
    assert.equal(deleteShapeVertex(p, 4), true);
    assert.equal(p.vertices.length, 4);
    assert.equal(p.holes.length, 1);
    assert.deepEqual(p.cornerRadii, [1, 2, 3, 4, 6, 7, 8, 9]);
  });

  test('refuses to take the outer outline below three points', () => {
    const p = { vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }] };
    assert.equal(deleteShapeVertex(p, 1), false);
    assert.equal(p.vertices.length, 3);
  });

  // ⚠ THE WHOLE RING'S FLAT INDICES GO. Splicing one entry for a ring that took three away shifts
  // every later ring's radii and moves its doors onto other walls.
  test('drops a hole that falls below three points, and every index it held', () => {
    const p = {
      vertices: rect(0, 0, 100, 100),
      holes: [[{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 10, y: 20 }], rect(60, 60, 90, 90)],
      cornerRadii: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      doors: [{ edge: 1, t: 0.5 }, { edge: 5, t: 0.5 }, { edge: 8, t: 0.5 }],
    };
    assert.equal(deleteShapeVertex(p, 5), true);   // the first hole's second point
    assert.equal(p.holes.length, 1);
    assert.deepEqual(p.holes[0], rect(60, 60, 90, 90));
    // Flat indices 4, 5 and 6 went with the ring.
    assert.deepEqual(p.cornerRadii, [1, 2, 3, 4, 8, 9, 10, 11]);
    // The door on the dropped ring is gone; the one past it moves down by three, not by one.
    assert.deepEqual(p.doors, [{ edge: 1, t: 0.5 }, { edge: 5, t: 0.5 }]);
  });

  test('takes one point off a hole that can spare it', () => {
    const p = { vertices: rect(0, 0, 100, 100), holes: [rect(30, 30, 70, 70)],
                cornerRadii: [1, 2, 3, 4, 5, 6, 7, 8] };
    assert.equal(deleteShapeVertex(p, 6), true);
    assert.equal(p.holes[0].length, 3);
    assert.deepEqual(p.cornerRadii, [1, 2, 3, 4, 5, 6, 8]);
  });

  test('spends one undo step per delete, and none on a refusal', () => {
    const before = undoPushes;
    const p = { vertices: rect(0, 0, 100, 100) };
    deleteShapeVertex(p, 0);
    assert.equal(undoPushes, before + 1);
    deleteShapeVertex(p, 0);          // now at three points, refused
    assert.equal(undoPushes, before + 1);
  });
});
