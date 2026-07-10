'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { pointInPolygon, distPointToSegment, segmentsIntersect } = require('../src/tools.js');

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
