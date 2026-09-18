'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { closestPointOnSegment, edgeEndFlat, edgePolyline, distToEdge, closestOnEdge,
        pointInShape, distPointToSegment } = require('../src/shapeHit.js');

// A 100x100 square, walked clockwise from the origin. Flat indices 0..3 are its corners.
const room = () => ({
  vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
});

// The same square with its top wall bowed DOWN into the room by pulling both control points to
// y = 60. The bulge reaches roughly y = 45 at the middle of the wall.
const bowed = () => ({
  vertices: room().vertices,
  handles: [{ ix: 0, iy: 0, ox: 0, oy: 60 }, { ix: 0, iy: 60, ox: 0, oy: 0 }, null, null],
});

describe('closestPointOnSegment', () => {
  test('a point beside the segment lands on its perpendicular foot', () => {
    assert.deepEqual(closestPointOnSegment(5, 3, 0, 0, 10, 0), { x: 5, y: 0 });
  });
  test('a point past an end clamps to that end', () => {
    assert.deepEqual(closestPointOnSegment(-4, 0, 0, 0, 10, 0), { x: 0, y: 0 });
    assert.deepEqual(closestPointOnSegment(99, 0, 0, 0, 10, 0), { x: 10, y: 0 });
  });
  test('a zero-length segment answers with its own point', () => {
    assert.deepEqual(closestPointOnSegment(5, 5, 7, 7, 7, 7), { x: 7, y: 7 });
  });
  test('an oblique segment lands off both axes', () => {
    const q = closestPointOnSegment(0, 10, 0, 0, 10, 10);
    assert.ok(Math.abs(q.x - 5) < 1e-9 && Math.abs(q.y - 5) < 1e-9);
  });
});

describe('edgeEndFlat', () => {
  const ring = room().vertices;
  test('a wall ends at the next corner', () => {
    assert.equal(edgeEndFlat(ring, 0, 0), 1);
    assert.equal(edgeEndFlat(ring, 2, 2), 3);
  });
  // ⚠ The wrap is what puts the last wall back on corner 0 instead of past the end of the ring.
  test('the last wall wraps back to the ring start', () => {
    assert.equal(edgeEndFlat(ring, 3, 3), 0);
  });
  test('a hole ring wraps within its own flat range, not the shape\'s', () => {
    const hole = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
    assert.equal(edgeEndFlat(hole, 2, 6), 4);
  });
});

describe('edgePolyline', () => {
  test('a straight wall is its own two points', () => {
    const p = room();
    assert.deepEqual(edgePolyline(p, p.vertices, 0, 0), [p.vertices[0], p.vertices[1]]);
  });
  test('a bent wall is sampled, and every sample carries a point', () => {
    const p = bowed();
    const pts = edgePolyline(p, p.vertices, 0, 0);
    assert.ok(pts.length > 2);
    assert.deepEqual(pts[0], p.vertices[0]);
    assert.deepEqual(pts[pts.length - 1], p.vertices[1]);
  });
  test('the sampled curve leaves the straight line between the anchors', () => {
    const p = bowed();
    const pts = edgePolyline(p, p.vertices, 0, 0);
    assert.ok(Math.max(...pts.map(q => q.y)) > 40);
  });
});

describe('distToEdge', () => {
  test('a point above a straight wall measures its perpendicular gap', () => {
    const p = room();
    assert.equal(distToEdge(p, p.vertices, 0, 0, 50, -7), 7);
  });
  // A bent wall bows into the room, so a point in the bulge is ON the wall, not 45 away from it.
  test('a bent wall is measured against its curve', () => {
    const straight = distToEdge(room(), room().vertices, 0, 0, 50, 45);
    const bent = distToEdge(bowed(), bowed().vertices, 0, 0, 50, 45);
    assert.equal(straight, 45);
    assert.ok(bent < 5);
  });
});

describe('closestOnEdge', () => {
  test('t is the fraction along a straight wall', () => {
    const p = room();
    const r = closestOnEdge(p, p.vertices, 0, 0, 25, -10);
    assert.ok(Math.abs(r.t - 0.25) < 1e-9);
    assert.deepEqual(r.pt, { x: 25, y: 0 });
  });
  test('t clamps to the wall at either end', () => {
    const p = room();
    assert.equal(closestOnEdge(p, p.vertices, 0, 0, -50, -10).t, 0);
    assert.equal(closestOnEdge(p, p.vertices, 0, 0, 500, -10).t, 1);
  });
  // ⚠ t is a fraction of the wall's own LENGTH, so on a curve it is measured along the arc. A
  // door placed at t = 0.5 sits at the middle of the bow, not below the anchors' midpoint.
  test('t runs along the arc of a bent wall', () => {
    const p = bowed();
    const r = closestOnEdge(p, p.vertices, 0, 0, 50, 90);
    assert.ok(Math.abs(r.t - 0.5) < 0.05);
    assert.ok(r.pt.y > 40);
  });
});

describe('pointInShape — bent walls', () => {
  test('a point under a wall bowed into the room falls outside it', () => {
    assert.equal(pointInShape(50, 20, bowed()), false);
  });
  test('the same point is inside the room with that wall straight', () => {
    assert.equal(pointInShape(50, 20, room()), true);
  });
  test('a point well inside stays inside either way', () => {
    assert.equal(pointInShape(50, 80, bowed()), true);
    assert.equal(pointInShape(50, 80, room()), true);
  });
});

describe('distPointToSegment — a zero-length wall', () => {
  test('answers the straight distance to the point', () => {
    assert.equal(distPointToSegment(3, 4, 0, 0, 0, 0), 5);
  });
});
