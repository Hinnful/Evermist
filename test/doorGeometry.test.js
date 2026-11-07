const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { polygonWindingSign } = require('../src/fog/fogGeometry.js');

const rect = (x1, y1, x2, y2) =>
  [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];

// A keep with a courtyard: one outer outline, one hole.
const keep = { vertices: rect(0, 0, 100, 100), holes: [rect(30, 30, 70, 70)] };

// ─── Door notches ─────────────────────────────────────────────────────────────
const {

  edgeOutwardNormal,
  edgeRingRef,
  doorEdgeFrame,
  doorSizeForCell,
  doorCellForGrid,
  doorCellBounds,
  doorCellSnap,
  doorNotchCorners,
  nearestOutlinePoint,
  doorPoint,
  pointInDoorNotch,
  doorClickPlan,
  doorModeRank,
  doorResolvedMode,
  sharedWallSpans,
  remapDoorsForVertexChange,
} = require('../src/shapes/doorGeometry.js');

// Screen space: y grows downward, so a clockwise ring has positive shoelace area.
const SQUARE_CW  = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 12 }, { x: 0, y: 12 }];
const SQUARE_CCW = SQUARE_CW.slice().reverse();
const CELL = 4;
const SZ = doorSizeForCell(CELL, 100, 25);
const SNAP = (verts, edge, mx, my, ox, oy, sq) =>
  doorCellSnap(verts, edge, mx, my, CELL, ox || 0, oy || 0, sq !== false);

describe('polygonWindingSign', () => {
  it('separates the two windings', () => {
    assert.equal(polygonWindingSign(SQUARE_CW), 1);
    assert.equal(polygonWindingSign(SQUARE_CCW), -1);
  });
});

describe('edgeOutwardNormal', () => {
  it('points away from the interior on the top edge, both windings', () => {
    assert.ok(edgeOutwardNormal(SQUARE_CW, 0).y < -0.99, 'top edge of a CW square faces up');
    const i = SQUARE_CCW.findIndex((v, k) => v.y === 0 && SQUARE_CCW[(k + 1) % 4].y === 0);
    assert.ok(edgeOutwardNormal(SQUARE_CCW, i).y < -0.99,
      'the same wall faces the same way whichever winding drew it');
  });

  it('is a unit vector', () => {
    const n = edgeOutwardNormal(SQUARE_CW, 1);
    assert.ok(Math.abs(Math.hypot(n.x, n.y) - 1) < 1e-9);
  });
});

describe('doorCellForGrid', () => {
  it('measures a hex door on the hex width, flat side to flat side', () => {
    assert.ok(Math.abs(doorCellForGrid(10, 'hex-pointy') - 10 * Math.sqrt(3)) < 1e-9);
  });

  it('leaves a square cell as it is', () => {
    assert.equal(doorCellForGrid(10, 'square'), 10);
  });

  it('makes 100 / 25 one hex wide and a quarter hex deep', () => {
    const w = 10 * Math.sqrt(3);
    const s = doorSizeForCell(doorCellForGrid(10, 'hex-pointy'), 100, 25);
    assert.ok(Math.abs(s.width - w) < 1e-9 && Math.abs(s.depth - w / 4) < 1e-9);
  });
});

describe('doorSizeForCell', () => {
  it('reads both dials as a percent of the cell', () => {
    assert.deepEqual(doorSizeForCell(4, 100, 25), { width: 4, depth: 1 });
    assert.deepEqual(doorSizeForCell(4, 200, 50), { width: 8, depth: 2 });
  });

  it('collapses to nothing on an unset grid, so callers can skip', () => {
    assert.deepEqual(doorSizeForCell(0, 100, 25), { width: 0, depth: 0 });
  });
});

describe('doorCellBounds', () => {
  it('reports the world grid lines that cross a straight wall', () => {
    assert.deepEqual(doorCellBounds(SQUARE_CW, 0, CELL, 0, 0, true).at, [0, 4, 8, 12]);
  });

  it('follows the grid offset', () => {
    assert.deepEqual(doorCellBounds(SQUARE_CW, 0, CELL, 1, 0, true).at, [0, 1, 5, 9, 12]);
  });

  it('ticks a diagonal where it passes into the next square', () => {
    const diag = [{ x: 0, y: 0 }, { x: 6, y: 8 }, { x: 0, y: 16 }];   // first wall is 10 long
    const at = doorCellBounds(diag, 0, CELL, 0, 0, true).at;
    // y = 4 at 5 along, x = 4 at 20/3 along.
    assert.deepEqual(at.map(a => Math.round(a * 100) / 100), [0, 5, 6.67, 10]);
  });

  it('ticks a hex wall where it passes into the next hex', () => {
    // Hexes 4 wide on the y = 0 row centre at x = 1, 5, 9: their sides fall at 3, 7, 11.
    const at = doorCellBounds(SQUARE_CW, 0, CELL, 1, 0, false).at;
    assert.deepEqual(at.map(a => Math.round(a * 100) / 100), [0, 3, 7, 11, 12]);
  });

  it('always starts at one end of the wall and finishes at the other', () => {
    const b = doorCellBounds(SQUARE_CW, 0, 5, 0, 0, true);
    assert.equal(b.at[0], 0);
    assert.equal(b.at[b.at.length - 1], 12);
  });

  it('returns null when the grid has no size', () => {
    assert.equal(doorCellBounds(SQUARE_CW, 0, 0, 0, 0, true), null);
  });
});

describe('doorCellSnap', () => {
  // The top wall runs x 0..12 at y=0, so a cell-4 world grid puts boundaries at 0, 4, 8, 12.
  it('fills the world cell the click landed in', () => {
    assert.equal(SNAP(SQUARE_CW, 0, 1, 0).t, 2 / 12);
    assert.equal(SNAP(SQUARE_CW, 0, 5, 0).t, 6 / 12);
  });

  it('follows the grid OFFSET, not the room corner', () => {
    assert.equal(SNAP(SQUARE_CW, 0, 2, 0, 1, 0).t, 3 / 12);
  });

  it('stays on the world grid when the room corner sits off it', () => {
    const off = [{ x: 1.5, y: 0 }, { x: 13.5, y: 0 }, { x: 13.5, y: 12 }, { x: 1.5, y: 12 }];
    assert.equal(SNAP(off, 0, 5, 0).t, (6 - 1.5) / 12);
  });

  it('snaps a vertical wall on the same rule', () => {
    assert.equal(SNAP(SQUARE_CW, 1, 12, 5).t, 6 / 12);
  });

  it('gives the same door anywhere inside one cell', () => {
    assert.deepEqual(SNAP(SQUARE_CW, 0, 4.1, 0), SNAP(SQUARE_CW, 0, 7.9, 0));
  });

  it('sends a click on a boundary to the cell after it, never to both', () => {
    assert.deepEqual(SNAP(SQUARE_CW, 0, 8, 0), SNAP(SQUARE_CW, 0, 9, 0));
  });

  it("centres a diagonal wall's door on the square the wall passes through", () => {
    const diag = [{ x: 0, y: 0 }, { x: 6, y: 8 }, { x: 0, y: 16 }];
    // (0.6, 0.8) sits in the square centred (2, 2), which projects 2.8 along the wall.
    assert.ok(Math.abs(SNAP(diag, 0, 0.6, 0.8).t - 0.28) < 1e-9);
    // (3, 4) sits in the square centred (2, 6), which projects 6 along.
    assert.ok(Math.abs(SNAP(diag, 0, 3, 4).t - 0.6) < 1e-9);
  });

  it("keeps one door anywhere along a diagonal's run through one square", () => {
    const diag = [{ x: 0, y: 0 }, { x: 6, y: 8 }, { x: 0, y: 16 }];
    assert.deepEqual(SNAP(diag, 0, 1.2, 1.6), SNAP(diag, 0, 2.7, 3.6));
  });

  it("centres a hex wall's door on the hex the wall passes through", () => {
    // Hexes 4 wide, offset 0: the y = 0 row centres at x = 0, 4, 8, the next row at 2, 6, 10.
    const wall = [{ x: 0, y: 1 }, { x: 20, y: 1 }, { x: 20, y: 9 }, { x: 0, y: 9 }];
    const at = (mx, my) => doorCellSnap(wall, 0, mx, my, CELL, 0, 0, false);
    assert.equal(at(6.2, 1).t, 8 / 20);   // the hex centred (8, 0), not the 4..8 step from the corner
    assert.equal(at(9.9, 1.5).t, 8 / 20);
    assert.equal(at(3.9, 1).t, 4 / 20);
  });

  it('keeps a hex door on its wall at the ends', () => {
    const wall = [{ x: 0, y: 1 }, { x: 20, y: 1 }, { x: 20, y: 9 }, { x: 0, y: 9 }];
    assert.equal(doorCellSnap(wall, 0, 0.5, 1, CELL, 0, 0, false).t, 2 / 20);
  });

  it('keeps the world-grid snap on a straight wall of a square grid', () => {
    assert.equal(SNAP(SQUARE_CW, 0, 6.5, 0, 1, 0).t, 7 / 12);
  });

  it('ignores the world grid on a hex grid', () => {
    assert.equal(SNAP(SQUARE_CW, 0, 2, 0, 1, 0, false).t, 2 / 12);
  });

  it('keeps the door inside the wall at either end', () => {
    assert.equal(SNAP(SQUARE_CW, 0, -50, 0).t, 2 / 12);
    assert.equal(SNAP(SQUARE_CW, 0, 50, 0).t, 10 / 12);
  });

  it('fills a wall shorter than one cell with a single door', () => {
    const tiny = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 9 }, { x: 0, y: 9 }];
    assert.equal(SNAP(tiny, 0, 1, 0).t, 0.5);
  });

  it('returns null when the grid has no size', () => {
    assert.equal(doorCellSnap(SQUARE_CW, 0, 1, 0, 0, 0, 0, true), null);
  });
});

describe('doorNotchCorners', () => {
  const door = SNAP(SQUARE_CW, 0, 5, 0);

  it('straddles the wall, reaching the same distance either side', () => {
    const c = doorNotchCorners(SQUARE_CW, door, SZ.width, SZ.depth, SZ.depth);
    assert.equal(c.outerL.y, -1);
    assert.equal(c.innerL.y, 1);
  });

  it('takes a deeper inward reach without moving the outward one', () => {
    const c = doorNotchCorners(SQUARE_CW, door, SZ.width, SZ.depth, 5);
    assert.equal(c.outerL.y, -1);
    assert.equal(c.innerL.y, 5);
  });

  it('spans exactly one cell, centred on the door', () => {
    const c = doorNotchCorners(SQUARE_CW, door, SZ.width, SZ.depth, SZ.depth);
    assert.equal(Math.abs(c.outerR.x - c.outerL.x), CELL);
    assert.equal((c.outerL.x + c.outerR.x) / 2, 6);
  });

  it('returns null rather than a degenerate path', () => {
    assert.equal(doorNotchCorners(SQUARE_CW, door, 0, 1, 1), null);
    assert.equal(doorNotchCorners(SQUARE_CW, door, 4, 0, 1), null);
    assert.equal(doorNotchCorners([{ x: 0, y: 0 }], door, 4, 1, 1), null);
  });

  it('wraps an out-of-range edge index instead of throwing', () => {
    assert.deepEqual(doorNotchCorners(SQUARE_CW, { ...door, edge: 4 }, SZ.width, SZ.depth, SZ.depth),
                     doorNotchCorners(SQUARE_CW, door, SZ.width, SZ.depth, SZ.depth));
  });
});

describe('pointInDoorNotch', () => {
  const door = SNAP(SQUARE_CW, 0, 5, 0);   // spans x 4..8 on the top wall

  it('accepts either side of the wall, since the notch straddles it', () => {
    assert.ok(pointInDoorNotch(SQUARE_CW, door, SZ.width, SZ.depth, 6, -0.5, 0));
    assert.ok(pointInDoorNotch(SQUARE_CW, door, SZ.width, SZ.depth, 6, 0, 0));
    assert.ok(pointInDoorNotch(SQUARE_CW, door, SZ.width, SZ.depth, 6, 0.5, 0));
  });

  it('rejects the neighbouring cell even with slack, so a second click widens the doorway', () => {
    assert.ok(!pointInDoorNotch(SQUARE_CW, door, SZ.width, SZ.depth, 9, -0.5, 0));
    assert.ok(!pointInDoorNotch(SQUARE_CW, door, SZ.width, SZ.depth, 9, -0.5, 3));
  });

  it('rejects the cell boundary itself, which belongs to both neighbours', () => {
    assert.ok(!pointInDoorNotch(SQUARE_CW, door, SZ.width, SZ.depth, 8, -0.5, 0));
  });

  it('rejects a point past the depth', () => {
    assert.ok(!pointInDoorNotch(SQUARE_CW, door, SZ.width, SZ.depth, 6, -2, 0));
  });

  it('forgives by slack, so a near miss still removes the door', () => {
    assert.ok(pointInDoorNotch(SQUARE_CW, door, SZ.width, SZ.depth, 6, 2, 2));
  });
});

describe('nearestOutlinePoint', () => {
  it('finds the wall a click landed near, as edge and fraction', () => {
    const n = nearestOutlinePoint(SQUARE_CW, 3, 0.4, 2);
    assert.equal(n.edge, 0);
    assert.equal(n.t, 0.25);
  });

  it('refuses a click past maxDist', () => {
    assert.equal(nearestOutlinePoint(SQUARE_CW, 6, 6, 2), null);
  });
});

describe('doorPoint', () => {
  it('lands back on the wall the door was stored against', () => {
    assert.deepEqual(doorPoint(SQUARE_CW, { edge: 1, t: 0.25 }), { x: 12, y: 3 });
  });
});

describe('remapDoorsForVertexChange', () => {
  const doors = [{ edge: 0, t: 0.5 }, { edge: 2, t: 0.5 }, { edge: 3, t: 0.5 }];
  // The square's edge 0 runs x=0..12 along y=0. Inserting at splitT s puts a vertex at x=12s,
  // so a door past that point belongs on the new edge 1 and everything after it shifts by one.
  const split = (ds, at, s) => remapDoorsForVertexChange(ds, at, 1, s);

  it('shifts later walls along when a vertex is inserted', () => {
    assert.deepEqual(split(doors, 0, 0.25).map(d => d.edge), [1, 3, 4]);
  });

  it('drops the doors whose wall the deleted vertex took with it', () => {
    assert.deepEqual(remapDoorsForVertexChange(doors, 3, -1, undefined, 0, 4).map(d => d.edge), [0]);
  });

  it('drops the closing wall, not a wall of another ring, when a first corner goes', () => {
    // Outer ring flats 0-3, hole flats 4-7: corner 0 joins edges 0 and 3, corner 4 joins 4 and 7.
    assert.deepEqual(remapDoorsForVertexChange(doors, 0, -1, undefined, 0, 4).map(d => d.edge), [1]);
    const ringDoors = [{ edge: 3, t: 0.5 }, { edge: 5, t: 0.5 }, { edge: 7, t: 0.5 }];
    assert.deepEqual(remapDoorsForVertexChange(ringDoors, 4, -1, undefined, 4, 4).map(d => d.edge), [3, 4]);
  });

  it('holds a door on the same map point when its own wall is split', () => {
    const before = doorPoint(SQUARE_CW, doors[0]);
    const after = split(doors, 0, 0.25)[0];
    const verts = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 12 }, { x: 0, y: 12 }];
    assert.deepEqual(doorPoint(verts, after), before);
  });

  it('keeps a door on the first half when the split lands past it', () => {
    const after = split([{ edge: 0, t: 0.25 }], 0, 0.5)[0];
    assert.deepEqual(after, { edge: 0, t: 0.5 });
  });

  it('leaves an empty list alone', () => {
    assert.deepEqual(remapDoorsForVertexChange(undefined, 1, -1), []);
  });
});

describe('doorResolvedMode', () => {
  // Two rooms sharing the wall y=12: A above it, B below it.
  const A = { vertices: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 12 }, { x: 0, y: 12 }] };
  const B = { vertices: [{ x: 0, y: 12 }, { x: 12, y: 12 }, { x: 12, y: 24 }, { x: 0, y: 24 }] };
  const ON_SHARED = { x: 6, y: 12 };
  const TOL = 1;

  it('ranks least to most revealed, and treats an unset mode as revealed', () => {
    assert.ok(doorModeRank('reveal') > doorModeRank('half'));
    assert.ok(doorModeRank('half') > doorModeRank('shroud'));
    assert.equal(doorModeRank(undefined), doorModeRank('reveal'));
  });

  it('shows the door when EITHER room is revealed, whichever one stores it', () => {
    assert.equal(doorResolvedMode(ON_SHARED,
      [{ ...A, mode: 'shroud' }, { ...B, mode: 'reveal' }], TOL), 'reveal');
    assert.equal(doorResolvedMode(ON_SHARED,
      [{ ...A, mode: 'reveal' }, { ...B, mode: 'shroud' }], TOL), 'reveal');
  });

  it('settles half beside shrouded as half', () => {
    assert.equal(doorResolvedMode(ON_SHARED,
      [{ ...A, mode: 'half' }, { ...B, mode: 'shroud' }], TOL), 'half');
  });

  it('lets revealed win over half', () => {
    assert.equal(doorResolvedMode(ON_SHARED,
      [{ ...A, mode: 'half' }, { ...B, mode: 'reveal' }], TOL), 'reveal');
  });

  it('hides the door when both rooms are shrouded', () => {
    assert.equal(doorResolvedMode(ON_SHARED,
      [{ ...A, mode: 'shroud' }, { ...B, mode: 'shroud' }], TOL), 'shroud');
  });

  it('ignores a revealed room that does not reach the door', () => {
    const far = { vertices: [{ x: 0, y: 40 }, { x: 12, y: 40 }, { x: 12, y: 52 }, { x: 0, y: 52 }],
                  mode: 'reveal' };
    assert.equal(doorResolvedMode(ON_SHARED, [{ ...A, mode: 'shroud' }, far], TOL), 'shroud');
  });

  it('returns shroud rather than throwing on a door with no wall', () => {
    assert.equal(doorResolvedMode(null, [{ ...A, mode: 'reveal' }], TOL), 'shroud');
  });
});

describe('sharedWallSpans', () => {
  // A above, B below, meeting on the line y=12. A's edge 2 runs back along that line.
  const A = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 12 }, { x: 0, y: 12 }];
  const B = { vertices: [{ x: 0, y: 12 }, { x: 12, y: 12 }, { x: 12, y: 24 }, { x: 0, y: 24 }] };
  const bottomEdge = 2;

  it('reports the whole wall when another room runs along all of it', () => {
    const spans = sharedWallSpans(A, bottomEdge, [B], 1, 3);
    assert.equal(spans.length, 1);
    assert.equal(spans[0].from, 0);
    assert.equal(spans[0].to, 12);
  });

  it('finds a wall the neighbour missed by less than the tolerance', () => {
    const off = { vertices: B.vertices.map(v => ({ x: v.x, y: v.y + 0.5 })) };
    assert.equal(sharedWallSpans(A, bottomEdge, [off], 1, 3).length, 1);
  });

  it('leaves a wall alone when the neighbour is further off than the tolerance', () => {
    const far = { vertices: B.vertices.map(v => ({ x: v.x, y: v.y + 6 })) };
    assert.deepEqual(sharedWallSpans(A, bottomEdge, [far], 1, 3), []);
  });

  it('reports only the stretch that is actually shared', () => {
    const halfB = { vertices: [{ x: 6, y: 12 }, { x: 12, y: 12 }, { x: 12, y: 24 }, { x: 6, y: 24 }] };
    const spans = sharedWallSpans(A, bottomEdge, [halfB], 1, 3);
    assert.equal(spans.length, 1);
    // Edge 2 runs from (12,12) back to (0,12), so the shared half starts at distance 0.
    assert.equal(spans[0].from, 0);
    assert.ok(spans[0].to > 5 && spans[0].to < 9, 'stops near the middle, got ' + spans[0].to);
  });

  it('leaves a free wall alone', () => {
    assert.deepEqual(sharedWallSpans(A, 0, [B], 1, 3), []);
  });

  it('ignores a room nested on the same side of the wall, either way round', () => {
    // An alcove inside A against its top wall: no room lies beyond that wall.
    const alcove = { vertices: [{ x: 3, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 4 }, { x: 3, y: 4 }] };
    assert.deepEqual(sharedWallSpans(A, 0, [alcove], 1, 3), []);
    assert.deepEqual(sharedWallSpans(alcove.vertices, 0, [{ vertices: A }], 1, 3), []);
  });

  it('still finds a neighbour across the wall from a room drawn the other way round', () => {
    const ccwB = { vertices: B.vertices.slice().reverse() };
    assert.equal(sharedWallSpans(A, bottomEdge, [ccwB], 1, 3).length, 1);
  });

  it('returns nothing rather than throwing on empty or degenerate input', () => {
    assert.deepEqual(sharedWallSpans(A, 0, null, 1, 3), []);
    assert.deepEqual(sharedWallSpans(A, 0, [B], 0, 3), []);
    assert.deepEqual(sharedWallSpans([{ x: 0, y: 0 }], 0, [B], 1, 3), []);
  });
});

describe('a door never outgrows its wall', () => {
  // A 4-long wall on a grid whose cell is 6: the door would otherwise overhang both corners.
  const SHORT = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 9 }, { x: 0, y: 9 }];
  const door = { edge: 0, t: 0.5 };

  it('caps the notch at the wall length', () => {
    const c = doorNotchCorners(SHORT, door, 6, 1, 1);
    assert.equal(c.outerL.x, 0);
    assert.equal(c.outerR.x, 4);
  });

  it('leaves a wall longer than the door alone', () => {
    const c = doorNotchCorners(SQUARE_CW, { edge: 0, t: 0.5 }, 4, 1, 1);
    assert.equal(Math.abs(c.outerR.x - c.outerL.x), 4);
  });

  it('caps the hit test to match, so a click beyond the wall end misses', () => {
    assert.ok(pointInDoorNotch(SHORT, door, 6, 1, 3.5, 0, 0));    // still on the wall
    assert.ok(!pointInDoorNotch(SHORT, door, 6, 1, 4.5, 0, 0));   // past its end
  });
});

// ─── Doors derived from a floor plan ──────────────────────────────────────────
const { planDoorPlacements } = require('../src/shapes/doorGeometry.js');
const { vttDerivePlan } = require('../src/rooms/vttPlan.js');
const fpFs = require('node:fs');
const fpPath = require('node:path');

// ⚠ THE SAME TWO REAL EXPORTS the kernel is pinned against. The counts below are what the
// shared-wall rule picks out of them, and a change to either the rule or the tolerance moves them.
const derivePlan = (name) => vttDerivePlan(JSON.parse(
  fpFs.readFileSync(fpPath.join(__dirname, 'fixtures', name), 'utf8')));
const placeFor = (name, cell) => {
  const d = derivePlan(name);
  return planDoorPlacements(d.rooms, d.portals, cell == null ? 150 : cell, 0, 0, true);
};

describe('planDoorPlacements', () => {
  it('takes only the openings two rooms share', () => {
    // 19 portals, 3 rooms: two doorways run between rooms, the rest are windows and outside doors.
    assert.equal(placeFor('sample-map.dd2vtt').length, 2);
    // 25 portals, 13 rooms.
    assert.equal(placeFor('cave-map.dd2vtt').length, 16);
  });

  it('places nothing without a grid to snap to', () => {
    assert.deepEqual(placeFor('cave-map.dd2vtt', 0), []);
    assert.deepEqual(planDoorPlacements(null, null, 150, 0, 0, true), []);
  });

  it('never stacks two doors on one cell', () => {
    for (const name of ['sample-map.dd2vtt', 'cave-map.dd2vtt']) {
      const d = derivePlan(name);
      const placed = planDoorPlacements(d.rooms, d.portals, 150, 0, 0, true);
      const pts = placed.map(p => ({
        room: p.roomIndex, c: doorPoint(d.rooms[p.roomIndex], p.door),
      }));
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const same = pts[i].room === pts[j].room &&
            Math.hypot(pts[i].c.x - pts[j].c.x, pts[i].c.y - pts[j].c.y) < 150 * 0.25;
          assert.ok(!same, name + ': doors ' + i + ' and ' + j + ' share a cell');
        }
      }
    }
  });

  it('names a room that exists, and a wall it owns', () => {
    const d = derivePlan('cave-map.dd2vtt');
    for (const p of planDoorPlacements(d.rooms, d.portals, 150, 0, 0, true)) {
      const verts = d.rooms[p.roomIndex];
      assert.ok(verts, 'roomIndex points at a room');
      assert.ok(p.door.edge >= 0 && p.door.edge < verts.length);
      assert.ok(p.door.t >= 0 && p.door.t <= 1);
    }
  });
});

describe('flat edge numbers', () => {
  it('finds the nearest point on a hole wall and numbers it past the outline', () => {
    const near = nearestOutlinePoint(keep, 50, 32, 10);
    assert.ok(near);
    assert.ok(near.edge >= 4, 'the hit was numbered as an outer wall');
    assert.deepEqual(edgeRingRef(keep, near.edge).ring, 1);
  });

  it('gives a hole wall a normal pointing into the void, not into the room', () => {
    // The courtyard's top wall runs left to right at y=30. The keep's ground is above it, the
    // courtyard below, so out of the ROOM there is downward.
    const f = doorEdgeFrame(keep, 4);
    assert.ok(f);
    assert.equal(f.ei, 4, 'the frame lost the flat edge number');
    assert.ok(f.n.y > 0, 'the notch would carve into the keep instead of the courtyard');
    // The outer outline keeps the sign it always had: its top wall faces up and out.
    assert.ok(doorEdgeFrame(keep, 0).n.y < 0);
  });

  it('keeps a bare point list working unchanged', () => {
    const near = nearestOutlinePoint(rect(0, 0, 100, 100), 50, 2, 10);
    assert.equal(near.edge, 0);
    assert.equal(doorEdgeFrame(rect(0, 0, 100, 100), 0).ei, 0);
  });
});

describe('doorClickPlan', () => {
  const room = () => ({ mode: 'reveal', vertices: rect(0, 0, 100, 100) });
  const opts = { cell: 20, slack: 8, size: { width: 20, depth: 10 }, offsetX: 0, offsetY: 0, square: true };
  it('plans an add snapped to the cell on a wall, and nothing away from walls', () => {
    const r = room();
    const plan = doorClickPlan([r], 33, 2, opts);
    assert.equal(plan.action, 'add');
    assert.equal(plan.poly, r);
    assert.equal(doorClickPlan([r], 50, 50, opts), null);
  });
  it('plans a remove when a door already sits in that cell', () => {
    const r = room();
    r.doors = [doorClickPlan([r], 33, 2, opts).door];
    const plan = doorClickPlan([r], 31, 1, opts);
    assert.equal(plan.action, 'remove');
    assert.equal(plan.index, 0);
  });
  it('prefers a revealed room over a shrouded one sharing the wall', () => {
    const shroud = { mode: 'shroud', vertices: rect(0, 0, 100, 100) };
    const open = { mode: 'reveal', vertices: rect(0, 0, 100, 100) };
    assert.equal(doorClickPlan([shroud, open], 33, 2, opts).poly, open);
  });
  it('plans nothing without a grid cell', () => {
    assert.equal(doorClickPlan([room()], 33, 2, { ...opts, cell: 0 }), null);
  });
});
