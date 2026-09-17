'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
// shapeSelect.js reaches these as bare globals, the way the browser's script order provides them.
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
// setShapeHoles lives in tools.js with the shape-commit kernel; editHoles is the only caller here.
global.setShapeHoles = (shape, holes) => {
  if (holes && holes.length) shape.holes = holes; else delete shape.holes;
};

const { pointInPolygon, pointInShape, findHoleAt, ringCentre, holeStaysOnRoom,
        deleteShapeVertex, deleteShapeHole,
        distPointToSegment } = require('../src/shapeSelect.js');

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

// ─── The hole as a grabbable thing ────────────────────────────────────────────
// A 10x10 room with a 2x2 hole centred at (5,5), plus a second at (8,8).
function bagel() {
  return {
    vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
    holes: [
      [{ x: 4, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 6 }, { x: 4, y: 6 }],
      [{ x: 7, y: 7 }, { x: 9, y: 7 }, { x: 9, y: 9 }, { x: 7, y: 9 }],
    ],
  };
}

describe('findHoleAt', () => {
  test('a point in the first hole names it', () => {
    assert.equal(findHoleAt(bagel(), 5, 5), 0);
  });
  test('a point in the second hole names it', () => {
    assert.equal(findHoleAt(bagel(), 8, 8), 1);
  });
  test('a point in the room body belongs to no hole', () => {
    assert.equal(findHoleAt(bagel(), 1, 1), -1);
  });
  test('a point outside the room belongs to no hole', () => {
    assert.equal(findHoleAt(bagel(), 20, 20), -1);
  });
  test('a shape with no holes never answers one', () => {
    assert.equal(findHoleAt({ vertices: square }, 0.5, 0.5), -1);
  });
  test('the LATER of two overlapping holes wins, as the newer room does', () => {
    const poly = {
      vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
      holes: [
        [{ x: 3, y: 3 }, { x: 7, y: 3 }, { x: 7, y: 7 }, { x: 3, y: 7 }],
        [{ x: 4, y: 4 }, { x: 8, y: 4 }, { x: 8, y: 8 }, { x: 4, y: 8 }],
      ],
    };
    assert.equal(findHoleAt(poly, 5, 5), 1);
  });
});

describe('ringCentre', () => {
  test('a square ring centres on its middle', () => {
    const c = ringCentre([{ x: 4, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 6 }, { x: 4, y: 6 }]);
    assert.equal(c.x, 5);
    assert.equal(c.y, 5);
  });
  test('a ring away from the origin centres where it actually is', () => {
    const c = ringCentre([{ x: 100, y: 50 }, { x: 110, y: 50 }, { x: 105, y: 60 }]);
    assert.equal(c.x, 105);
    assert.equal(c.y, 160 / 3);
  });
  // The clamp asks whether the centre is still on the room, so these two ARE the stop rule.
  test('a hole slid half off the wall keeps its centre inside the room', () => {
    const moved = [{ x: 8.5, y: 4 }, { x: 10.5, y: 4 }, { x: 10.5, y: 6 }, { x: 8.5, y: 6 }];
    const c = ringCentre(moved);
    assert.equal(pointInPolygon(c.x, c.y, bagel().vertices), true);
  });
  test('a hole slid clear of the wall puts its centre outside the room', () => {
    const moved = [{ x: 11, y: 4 }, { x: 13, y: 4 }, { x: 13, y: 6 }, { x: 11, y: 6 }];
    const c = ringCentre(moved);
    assert.equal(pointInPolygon(c.x, c.y, bagel().vertices), false);
  });
});

describe('deleteShapeHole', () => {
  test('takes the whole ring and leaves the other hole', () => {
    const poly = bagel();
    assert.equal(deleteShapeHole(poly, 0), true);
    assert.equal(poly.holes.length, 1);
    assert.equal(poly.holes[0][0].x, 7);
  });
  test('the last hole leaves the record with none at all', () => {
    const poly = bagel();
    deleteShapeHole(poly, 0);
    deleteShapeHole(poly, 0);
    assert.equal(poly.holes, undefined);
  });
  test('refuses a hole index that is not there', () => {
    assert.equal(deleteShapeHole(bagel(), 5), false);
  });
  // cornerRadii and doors are keyed by the flat index across the outer ring then each hole, so a
  // dropped ring has to take its own span and pull everything after it back.
  test('takes exactly the radii the ring held and renumbers the rest', () => {
    const poly = bagel();
    poly.cornerRadii = [1, 2, 3, 4, 10, 11, 12, 13, 20, 21, 22, 23];
    deleteShapeHole(poly, 0);
    assert.deepEqual(poly.cornerRadii, [1, 2, 3, 4, 20, 21, 22, 23]);
  });
  test('drops the doors on the ring and pulls later doors back', () => {
    const poly = bagel();
    poly.doors = [{ edge: 1 }, { edge: 5 }, { edge: 9 }];
    deleteShapeHole(poly, 0);
    assert.deepEqual(poly.doors, [{ edge: 1 }, { edge: 5 }]);
  });
  test('spends one undo step per delete, and none on a refusal', () => {
    const before = undoPushes;
    deleteShapeHole(bagel(), 0);
    assert.equal(undoPushes, before + 1);
    deleteShapeHole(bagel(), 9);
    assert.equal(undoPushes, before + 1);
  });
});

describe('deleteShapeHole — indices that are not holes', () => {
  // ⚠ rings[0] is the OUTER ring, so an unguarded -1 would splice the outline's own radii away.
  test('refuses a negative index and leaves the record alone', () => {
    const poly = bagel();
    poly.cornerRadii = [1, 2, 3, 4, 10, 11, 12, 13, 20, 21, 22, 23];
    assert.equal(deleteShapeHole(poly, -1), false);
    assert.equal(poly.holes.length, 2);
    assert.deepEqual(poly.cornerRadii, [1, 2, 3, 4, 10, 11, 12, 13, 20, 21, 22, 23]);
  });
  test('refuses on a shape with no holes at all', () => {
    assert.equal(deleteShapeHole({ vertices: square }, 0), false);
  });
});

describe('holeStaysOnRoom', () => {
  test('a hole in the middle of its room stays', () => {
    const poly = bagel();
    assert.equal(holeStaysOnRoom(poly, poly.holes[0]), true);
  });
  test('a hole hanging over the wall still stays, because it bites rather than leaves', () => {
    const moved = [{ x: 8.5, y: 4 }, { x: 10.5, y: 4 }, { x: 10.5, y: 6 }, { x: 8.5, y: 6 }];
    assert.equal(holeStaysOnRoom(bagel(), moved), true);
  });
  test('a hole clear of the room does not', () => {
    const gone = [{ x: 11, y: 4 }, { x: 13, y: 4 }, { x: 13, y: 6 }, { x: 11, y: 6 }];
    assert.equal(holeStaysOnRoom(bagel(), gone), false);
  });
});
