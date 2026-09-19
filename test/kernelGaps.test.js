'use strict';

// kernelGaps.test.js — the exported kernels nothing called directly.
//
// Every function here was already exported and already reachable from a test file, and no test
// named one. Each is reached INDIRECTLY through a bigger function's cases, so a wrong answer
// surfaced as that bigger function failing, somewhere downstream of the line that caused it.
// What these add is the failure landing on the function that is wrong.
//
// PROVED RED, 2026-09-19, one mutation each: pointInRing's y-straddle test inverted · the corner
// fallback removed from ringHomePiece · every share of a split hole pushed to pieces[0] · the
// closing point kept in ringToVerts · matMul transposed · sampleCubic emitting the start corner ·
// edgeCubic ignoring its handles · the clamp removed from vttProjectToSegment.
//
// ⚠ TWO OF THOSE MUTATIONS SURVIVED THE FIRST VERSION OF THIS FILE. Casting pointInRing's ray
// the other way is an EQUIVALENT mutant - still a correct test, so it proves nothing about the
// check. And ringHomePiece's fallback could be deleted outright while its test passed, because
// the centroid in that case landed inside a piece and the fallback never ran.
//
// ⚠ _hexToHsl AND _hslToHex ARE DELIBERATELY ABSENT. docs/decisions/testing-and-the-rig.md parks
// fog-colour derivation: killing its survivors needs a decided table of expected colours across
// the hue wheel, and a wrong expectation baked in is worse than no test at all.

const { test } = require('node:test');
const assert = require('node:assert');

const {
  pointInRing, ringHomePiece, splitHoleAcrossPieces, ringToVerts,
} = require('../src/shapes/roomOps.js');
const { matMul, matTranslate, matScale, matRotate, applyMat } = require('../src/shapes/shapeBox.js');
const { sampleCubic, edgeCubic } = require('../src/fog/fogGeometry.js');
const { vttProjectToSegment } = require('../src/rooms/vttPlan.js');

const rect = (x1, y1, x2, y2) =>
  [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];
const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1e-9 : eps);

// ─── pointInRing ──────────────────────────────────────────────────────────────

test('pointInRing answers inside, outside and the concave notch', () => {
  const square = rect(0, 0, 100, 100);
  assert.equal(pointInRing(50, 50, square), true, 'the middle of a square reads as outside it');
  assert.equal(pointInRing(150, 50, square), false, 'a point beside a square reads as inside it');
  assert.equal(pointInRing(50, 150, square), false, 'a point below a square reads as inside it');

  // An L. The notch is the case a bounding-box test gets wrong, and every hole this kernel
  // places is judged by it.
  const ell = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 },
               { x: 40, y: 40 }, { x: 40, y: 100 }, { x: 0, y: 100 }];
  assert.equal(pointInRing(20, 20, ell), true, 'a point in the L’s own arm reads as outside');
  assert.equal(pointInRing(80, 80, ell), false,
               'a point in the L’s notch reads as inside, which is the bounding box answering');
});

// ⚠ THE EDGE IS NOT ASSERTED. A ray cast at a vertex is a coin toss by construction, so pinning
// today's answer would pin an implementation detail rather than a promise.

// ─── ringHomePiece ────────────────────────────────────────────────────────────

test('ringHomePiece puts a hole in the piece that holds it', () => {
  const pieces = [{ verts: rect(0, 0, 100, 100) }, { verts: rect(200, 0, 300, 100) }];
  assert.equal(ringHomePiece(rect(20, 20, 40, 40), pieces), 0, 'a hole in the first piece went elsewhere');
  assert.equal(ringHomePiece(rect(220, 20, 240, 40), pieces), 1, 'a hole in the second piece went elsewhere');
  assert.equal(ringHomePiece(rect(500, 500, 520, 520), pieces), -1,
               'a hole inside neither piece was handed to one of them anyway');
});

test('ringHomePiece falls back to the corners when the centroid is inside no piece', () => {
  // ⚠ THE CENTROID HAS TO MISS EVERY PIECE, or the first loop answers and the fallback never
  // runs — which is what an earlier version of this test did, and deleting the fallback outright
  // still passed it. The two pieces leave a corridor down the middle; the hole straddles it and
  // its centroid lands in the gap, so only its own corners can place it.
  const pieces = [{ verts: rect(0, 0, 30, 100) }, { verts: rect(70, 0, 100, 100) }];
  const straddling = rect(10, 40, 90, 60);          // centroid (50,50) is inside neither piece
  const centroid = { x: 50, y: 50 };
  assert.equal(pointInRing(centroid.x, centroid.y, pieces[0].verts), false,
               'the centroid landed in a piece, so the fallback is not being exercised');
  assert.equal(pointInRing(centroid.x, centroid.y, pieces[1].verts), false,
               'the centroid landed in a piece, so the fallback is not being exercised');
  assert.equal(ringHomePiece(straddling, pieces), 0,
               'a hole whose centroid misses every piece was placed nowhere, so it is dropped');
});

// ─── splitHoleAcrossPieces ────────────────────────────────────────────────────

test('splitHoleAcrossPieces gives each piece its own share of a hole the cut ran through', () => {
  // ⚠ IT WRITES INTO THE PIECES AND ANSWERS true/false. Handed whole to one piece, the hole
  // pokes out through that piece own wall and the other loses its half of the courtyard.
  // One square hole, two pieces meeting at x=50. The hole straddles the join.
  const pieces = [{ verts: rect(0, 0, 50, 100), holes: [] },
                  { verts: rect(50, 0, 100, 100), holes: [] }];
  assert.equal(splitHoleAcrossPieces(rect(30, 30, 70, 70), pieces, 1), true,
               'the split refused a hole the cut ran straight through');
  assert.equal(pieces[0].holes.length, 1,
               'the left piece got ' + pieces[0].holes.length + ' shares of the hole, not one');
  assert.equal(pieces[1].holes.length, 1,
               'the right piece got ' + pieces[1].holes.length + ' shares of the hole, not one');
  // Each share stays on its own side of the cut, or a piece carries a hole outside itself.
  assert.ok(pieces[0].holes[0].every(v => v.x <= 50.001),
            'the left piece was handed part of the hole that lies past the cut');
  assert.ok(pieces[1].holes[0].every(v => v.x >= 49.999),
            'the right piece was handed part of the hole that lies before the cut');
});

test('splitHoleAcrossPieces leaves a hole wholly inside one piece to that piece alone', () => {
  const pieces = [{ verts: rect(0, 0, 50, 100), holes: [] },
                  { verts: rect(50, 0, 100, 100), holes: [] }];
  assert.equal(splitHoleAcrossPieces(rect(10, 10, 40, 40), pieces, 1), true,
               'the split refused a hole that needed no splitting');
  assert.equal(pieces[1].holes.length, 0,
               'a hole entirely on the left was also given to the right piece');
});

// ─── ringToVerts ──────────────────────────────────────────────────────────────

test('ringToVerts drops the closing point a clipping library repeats', () => {
  // polygon-clipping returns rings whose last point repeats the first. Left on, every ring the
  // app stores carries a duplicate corner, and every vertex count downstream is one too high.
  const closed = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const verts = ringToVerts(closed);
  assert.equal(verts.length, 4, 'the repeated closing point was kept: ' + verts.length + ' corners');
  assert.deepEqual(verts[0], { x: 0, y: 0 });
  assert.deepEqual(verts[3], { x: 0, y: 10 });

  const open = [[0, 0], [10, 0], [10, 10]];
  assert.equal(ringToVerts(open).length, 3, 'a ring that was not closed lost a corner anyway');
});

// ─── matMul ───────────────────────────────────────────────────────────────────

test('matMul applies the right-hand matrix first', () => {
  // The order IS the promise, and the two orders differ: scale-then-move lands somewhere a
  // move-then-scale does not. A transposed multiply passes every symmetric case.
  const scaleThenMove = matMul(matTranslate(100, 0), matScale(2, 2));
  assert.deepEqual(applyMat(scaleThenMove, { x: 10, y: 5 }), { x: 120, y: 10 },
                   'scale then move landed somewhere else');
  const moveThenScale = matMul(matScale(2, 2), matTranslate(100, 0));
  assert.deepEqual(applyMat(moveThenScale, { x: 10, y: 5 }), { x: 220, y: 10 },
                   'move then scale landed somewhere else');
});

test('matMul leaves a point alone when either side is the identity', () => {
  const id = [1, 0, 0, 1, 0, 0];
  const r = matRotate(Math.PI / 3);
  const p = { x: 17, y: -4 };
  const viaLeft = applyMat(matMul(id, r), p), viaRight = applyMat(matMul(r, id), p), direct = applyMat(r, p);
  assert.ok(near(viaLeft.x, direct.x) && near(viaLeft.y, direct.y), 'identity on the left changed the point');
  assert.ok(near(viaRight.x, direct.x) && near(viaRight.y, direct.y), 'identity on the right changed the point');
});

// ─── sampleCubic and edgeCubic ────────────────────────────────────────────────

test('sampleCubic walks a curve from just past the start to exactly the end', () => {
  const p0 = { x: 0, y: 0 }, p3 = { x: 90, y: 0 };
  const c1 = { x: 30, y: 60 }, c2 = { x: 60, y: 60 };
  const pts = sampleCubic(p0, c1, c2, p3, 6);
  assert.equal(pts.length, 6, 'asked for six steps and got ' + pts.length);
  // ⚠ THE START IS NOT INCLUDED, by design: a ring walk already holds it, and emitting it again
  // puts a duplicate corner at every wall join.
  assert.ok(pts[0].x > p0.x, 'the first sample repeats the corner the curve starts at');
  assert.ok(near(pts[5].x, p3.x) && near(pts[5].y, p3.y), 'the last sample is not the far corner');
  // A bulge, not a straight line. Every sample of a curve with handles must leave the chord.
  assert.ok(pts.slice(0, 5).some(p => Math.abs(p.y) > 1),
            'every sample landed on the straight line between the corners, so the curve came out flat');
});

test('sampleCubic on a cubic with no handles is the straight line', () => {
  const pts = sampleCubic({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 0 }, 4);
  for (const p of pts) assert.ok(near(p.y, 0, 1e-9), 'a handle-less cubic bent away from its chord');
});

test('sampleCubic never answers with nothing', () => {
  // Every consumer walks the result, so an empty answer drops a whole wall from the outline.
  for (const steps of [0, -3, NaN]) {
    const pts = sampleCubic({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 0 }, steps);
    assert.ok(pts.length >= 1, 'steps=' + steps + ' produced an empty curve, so the wall vanishes');
  }
});

test('edgeCubic offsets each control point by its own handle', () => {
  const pa = { x: 0, y: 0 }, pb = { x: 100, y: 0 };
  const cub = edgeCubic(pa, pb, { ox: 10, oy: -20 }, { ix: -15, iy: -25 });
  assert.deepEqual(cub[0], pa, 'the curve does not start at the corner it was given');
  assert.deepEqual(cub[3], pb, 'the curve does not end at the corner it was given');
  assert.deepEqual(cub[1], { x: 10, y: -20 }, 'the outgoing handle was not added to the first corner');
  assert.deepEqual(cub[2], { x: 85, y: -25 }, 'the incoming handle was not added to the last corner');
});

test('edgeCubic with no handles is a straight cubic', () => {
  // A wall with no handles has to come back flat, or every straight wall in the app bows.
  const pa = { x: 0, y: 0 }, pb = { x: 100, y: 0 };
  const cub = edgeCubic(pa, pb, null, null);
  assert.deepEqual(cub, [pa, { x: 0, y: 0 }, { x: 100, y: 0 }, pb]);
});

// ─── vttProjectToSegment ──────────────────────────────────────────────────────

test('vttProjectToSegment clamps to the ends rather than running past them', () => {
  const a = { x: 0, y: 0 }, b = { x: 100, y: 0 };
  const mid = vttProjectToSegment({ x: 50, y: 30 }, a, b);
  assert.ok(near(mid.dist, 30) && near(mid.t, 0.5), 'a point above the middle projected elsewhere');

  // ⚠ UNCLAMPED, A POINT PAST THE END READS AS CLOSE TO A WALL IT IS NOWHERE NEAR, and the
  // junction splitter then cuts a wall that has no junction on it.
  const past = vttProjectToSegment({ x: 500, y: 0 }, a, b);
  assert.ok(near(past.t, 1), 'a point past the far end was not clamped to it: t=' + past.t);
  assert.ok(near(past.dist, 400), 'the distance past the end was measured to the line, not the end');

  const before = vttProjectToSegment({ x: -60, y: 0 }, a, b);
  assert.ok(near(before.t, 0), 'a point before the near end was not clamped to it: t=' + before.t);
  assert.ok(near(before.dist, 60), 'the distance before the start was measured to the line, not the end');
});

test('vttProjectToSegment survives a segment of zero length', () => {
  // Two nodes snapped onto each other. Without the guard this divides by zero and every distance
  // downstream reads NaN, which compares false against every threshold and silently drops a wall.
  const at = vttProjectToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 });
  assert.ok(near(at.dist, 5), 'a zero-length segment measured ' + at.dist + ' rather than 5');
  assert.equal(at.t, 0, 'a zero-length segment answered with a position along itself');
});

