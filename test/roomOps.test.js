'use strict';

const { test, describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  toRings, fromRings, ringArea, resultPieces, shapesOverlap,
  joinShapes, trimShapes, cutRing, mostHiddenMode, roomOpMinArea,
  crossSegments, ringPathCrossings, arcForward, dedupeRing,
  ROOM_OP_MIN_AREA, REASON_HOLE, REASON_CUT,
} = require('../src/roomOps.js');

const { vttDerivePlan } = require('../src/vttPlan.js');

// ⚠ THE SYNTHETIC CASES BELOW PROVE ONLY THE SHAPES ALREADY KNOWN. The real cave export at the
// bottom of this file is what catches a kernel that works on rectangles and not on a floor plan.

const FLOOR = 1;   // sliver floor for the synthetic cases: they are all far above any grid square

const rect = (x1, y1, x2, y2) =>
  [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];

const bbox = (verts) => ({
  x0: Math.min(...verts.map(v => v.x)), x1: Math.max(...verts.map(v => v.x)),
  y0: Math.min(...verts.map(v => v.y)), y1: Math.max(...verts.map(v => v.y)),
});

// No ring the app stores repeats its first point, so a converter that keeps the library's
// closing point shows up here rather than as a zero-length edge on a rendered room.
function assertOpenRing(verts, label) {
  const n = verts.length;
  assert.ok(n >= 3, label + ': ring has ' + n + ' points');
  assert.ok(verts[0].x !== verts[n - 1].x || verts[0].y !== verts[n - 1].y,
            label + ': the ring still carries its closing point');
  for (let i = 0; i < n; i++) {
    const a = verts[i], b = verts[(i + 1) % n];
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 1e-6,
              label + ': zero-length edge at ' + i);
  }
}

describe('roomOps — ring conversion', () => {
  it('closes a ring on the way out and opens it on the way back', () => {
    const r = toRings(rect(0, 0, 10, 10));
    assert.equal(r.length, 1);
    assert.equal(r[0].length, 5);
    assert.deepEqual(r[0][0], r[0][4]);
    assert.deepEqual(fromRings(r), rect(0, 0, 10, 10));
  });

  it('measures area regardless of winding', () => {
    assert.equal(ringArea(rect(0, 0, 10, 20)), 200);
    assert.equal(ringArea(rect(0, 0, 10, 20).reverse()), 200);
  });
});

describe('roomOps — overlap', () => {
  it('sees a shape that lands on a room, and not one that only touches its wall', () => {
    assert.equal(shapesOverlap(rect(0, 0, 10, 10), rect(5, 5, 15, 15)), true);
    assert.equal(shapesOverlap(rect(0, 0, 10, 10), rect(10, 0, 20, 10)), false);
    assert.equal(shapesOverlap(rect(0, 0, 10, 10), rect(30, 0, 40, 10)), false);
  });
});

describe('roomOps — trim', () => {
  it('notches one wall and leaves one room', () => {
    const room = rect(0, 0, 100, 100);
    const out = trimShapes([room], rect(40, -10, 60, 30), FLOOR);
    assert.equal(out.reason, undefined);
    assert.equal(out.groups.length, 1);
    assert.equal(out.groups[0].length, 1);
    const piece = out.groups[0][0];
    assertOpenRing(piece, 'notched room');
    assert.equal(Math.round(ringArea(piece)), 10000 - 600);
    // The notch is real geometry, not a bounding-box change: the outline gains corners.
    assert.ok(piece.length > 4, 'the notch left the outline a rectangle');
  });

  it('splits a room into two when the strip goes all the way across', () => {
    const out = trimShapes([rect(0, 0, 100, 100)], rect(45, -10, 55, 110), FLOOR);
    assert.equal(out.reason, undefined);
    assert.equal(out.groups[0].length, 2);
    for (const p of out.groups[0]) {
      assertOpenRing(p, 'split piece');
      assert.equal(Math.round(ringArea(p)), 4500);
    }
  });

  it('removes a room the drawn shape covers whole', () => {
    const out = trimShapes([rect(10, 10, 40, 40)], rect(0, 0, 100, 100), FLOOR);
    assert.equal(out.reason, undefined);
    assert.deepEqual(out.groups, [[]]);
  });

  it('refuses a trim that would leave a hole, and names the hole', () => {
    const out = trimShapes([rect(0, 0, 100, 100)], rect(30, 30, 70, 70), FLOOR);
    assert.equal(out.groups, undefined);
    assert.equal(out.reason, REASON_HOLE);
  });

  it('refuses the whole operation when only the second room would hole', () => {
    const rooms = [rect(0, 0, 100, 100), rect(200, 0, 300, 100)];
    // Overlaps the first room's corner, and sits wholly inside the second.
    const drawn = [{ x: 90, y: 90 }, { x: 110, y: 90 }, { x: 110, y: 110 }, { x: 90, y: 110 }];
    assert.equal(trimShapes(rooms, drawn, FLOOR).reason, undefined);
    const holing = trimShapes(rooms, rect(220, 20, 280, 80), FLOOR);
    assert.equal(holing.reason, REASON_HOLE);
    assert.equal(holing.groups, undefined);
  });

  it('discards a piece below the sliver floor', () => {
    // A strip 1 unit shy of the far wall: the far piece is 100 units², the near one 4,500.
    const out = trimShapes([rect(0, 0, 100, 100)], rect(45, -10, 99, 110), 1000);
    assert.equal(out.groups[0].length, 1);
    assert.equal(Math.round(ringArea(out.groups[0][0])), 4500);
    // With no floor to speak of, the sliver is back — so the filter is what removed it.
    assert.equal(trimShapes([rect(0, 0, 100, 100)], rect(45, -10, 99, 110), 1).groups[0].length, 2);
  });
});

describe('roomOps — join', () => {
  it('makes one room out of two that touch', () => {
    const out = joinShapes([rect(0, 0, 50, 50), rect(50, 0, 100, 50)], rect(40, 10, 60, 40), 1);
    assert.equal(out.reason, undefined);
    assert.equal(out.pieces.length, 1);
    assertOpenRing(out.pieces[0], 'joined room');
    assert.equal(Math.round(ringArea(out.pieces[0])), 5000);
  });

  it('bridges two rooms that do not touch', () => {
    const out = joinShapes([rect(0, 0, 50, 50), rect(70, 0, 120, 50)], rect(45, 10, 75, 40), 1);
    assert.equal(out.pieces.length, 1);
    assert.equal(Math.round(ringArea(out.pieces[0])), 2500 + 2500 + 20 * 30);
  });

  it('hands back two pieces when nothing bridges them', () => {
    // ⚠ TWO POLYGONS IS NOT A HOLE. Refusing "more than one ring" would refuse every split.
    const out = joinShapes([rect(0, 0, 50, 50), rect(200, 0, 250, 50)], rect(0, 0, 50, 50), 1);
    assert.equal(out.reason, undefined);
    assert.equal(out.pieces.length, 2);
    for (const p of out.pieces) assert.equal(Math.round(ringArea(p)), 2500);
  });

  it('takes the most hidden fog mode, never the first', () => {
    assert.equal(mostHiddenMode(['reveal', 'shroud']), 'shroud');
    assert.equal(mostHiddenMode(['reveal', 'half']), 'half');
    assert.equal(mostHiddenMode(['reveal', 'reveal']), 'reveal');
    assert.equal(mostHiddenMode(['half', 'shroud', 'reveal']), 'shroud');
    assert.equal(mostHiddenMode([]), 'shroud');
  });

  it('does nothing when handed no contributor', () => {
    assert.deepEqual(joinShapes([], rect(0, 0, 10, 10), 1).pieces, []);
  });
});

describe('roomOps — cut', () => {
  it('splits a convex room along the path, and the pieces touch exactly', () => {
    const room = rect(0, 0, 100, 100);
    const out = cutRing(room, [{ x: -20, y: 50 }, { x: 120, y: 50 }], 1);
    assert.equal(out.reason, undefined);
    assert.equal(out.pieces.length, 2);
    for (const p of out.pieces) {
      assertOpenRing(p, 'cut piece');
      assert.equal(Math.round(ringArea(p)), 5000);
    }
    // Zero width: the two pieces add back up to the room, with no strip missing.
    assert.equal(Math.round(out.pieces.reduce((s, p) => s + ringArea(p), 0)), 10000);
    // And they share the cut, point for point.
    const shared = out.pieces[0].filter(a =>
      out.pieces[1].some(b => Math.hypot(a.x - b.x, a.y - b.y) < 1e-9));
    assert.equal(shared.length, 2);
  });

  it('follows a path with corners in it', () => {
    const out = cutRing(rect(0, 0, 100, 100),
                        [{ x: -20, y: 20 }, { x: 50, y: 20 }, { x: 50, y: 80 },
                         { x: 120, y: 80 }], 1);
    assert.equal(out.pieces.length, 2);
    assert.equal(Math.round(out.pieces.reduce((s, p) => s + ringArea(p), 0)), 10000);
    assert.ok(out.pieces.some(p => p.length >= 5), 'the corner in the path was dropped');
  });

  it('takes an alcove out when the path enters and leaves the same wall', () => {
    const out = cutRing(rect(0, 0, 100, 100),
                        [{ x: 20, y: -10 }, { x: 20, y: 40 }, { x: 60, y: 40 },
                         { x: 60, y: -10 }], 1);
    assert.equal(out.reason, undefined);
    assert.equal(out.pieces.length, 2);
    const areas = out.pieces.map(p => Math.round(ringArea(p))).sort((a, b) => a - b);
    assert.deepEqual(areas, [1600, 8400]);
  });

  it('refuses a path that crosses the outline four times', () => {
    // Down through the room, out of the bottom, back in, and out of the top again.
    const out = cutRing(rect(0, 0, 100, 100),
                        [{ x: 20, y: -10 }, { x: 20, y: 110 }, { x: 60, y: 110 },
                         { x: 60, y: -10 }], 1);
    assert.equal(out.pieces, undefined);
    assert.equal(out.reason, REASON_CUT);
  });

  it('refuses a path that never reaches the room, and one that stops inside it', () => {
    assert.equal(cutRing(rect(0, 0, 100, 100),
                         [{ x: 200, y: 20 }, { x: 300, y: 20 }], 1).reason, REASON_CUT);
    assert.equal(cutRing(rect(0, 0, 100, 100),
                         [{ x: -20, y: 50 }, { x: 50, y: 50 }], 1).reason, REASON_CUT);
  });

  it('refuses a ring or a path too short to be either', () => {
    assert.equal(cutRing([{ x: 0, y: 0 }, { x: 1, y: 1 }], [{ x: 0, y: 0 }], 1).reason, REASON_CUT);
    assert.equal(cutRing(rect(0, 0, 10, 10), [{ x: 0, y: 5 }], 1).reason, REASON_CUT);
  });
});

describe('roomOps — cut internals', () => {
  it('counts a crossing on a shared vertex once, not twice', () => {
    // The path passes exactly through the rectangle's top-left corner and out of the left wall.
    const hits = ringPathCrossings(rect(0, 0, 100, 100),
                                  [{ x: -20, y: -20 }, { x: 20, y: 20 }]);
    assert.equal(hits.length, 1);
  });

  it('reports nothing for parallel segments', () => {
    assert.equal(crossSegments({ x: 0, y: 0 }, { x: 10, y: 0 },
                               { x: 0, y: 5 }, { x: 10, y: 5 }), null);
  });

  it('walks the whole outline when both crossings sit on one edge the wrong way round', () => {
    const ring = rect(0, 0, 100, 100);
    const long = arcForward(ring, { edge: 0, t: 0.6, point: { x: 60, y: 0 } },
                                  { edge: 0, t: 0.2, point: { x: 20, y: 0 } });
    assert.equal(long.length, 6);   // both crossings plus all four corners
    const short = arcForward(ring, { edge: 0, t: 0.2, point: { x: 20, y: 0 } },
                                   { edge: 0, t: 0.6, point: { x: 60, y: 0 } });
    assert.equal(short.length, 2);
  });

  it('drops coincident points and the repeated closing one', () => {
    const out = dedupeRing([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 },
                            { x: 10, y: 10 }, { x: 0, y: 0 }]);
    assert.deepEqual(out, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
  });
});

describe('roomOps — the sliver floor', () => {
  it('follows the grid square when there is one, and falls back when there is not', () => {
    assert.equal(roomOpMinArea(70), 4900);
    assert.equal(roomOpMinArea(0), ROOM_OP_MIN_AREA);
    assert.equal(roomOpMinArea(undefined), ROOM_OP_MIN_AREA);
    assert.equal(roomOpMinArea(-5), ROOM_OP_MIN_AREA);
  });
});

describe('roomOps — resultPieces', () => {
  it('refuses a second ring inside one polygon and keeps a second polygon', () => {
    const outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    const inner = [[3, 3], [3, 7], [7, 7], [7, 3], [3, 3]];
    assert.equal(resultPieces([[outer, inner]], 1).reason, REASON_HOLE);
    assert.equal(resultPieces([[outer], [outer]], 1).pieces.length, 2);
  });

  it('treats anything that is not a list as a failure', () => {
    assert.ok(resultPieces(null, 1).reason);
    assert.ok(resultPieces(undefined, 1).reason);
  });
});

// ─── The real floor plan ──────────────────────────────────────────────────────
// ⚠ THE SAME CAVE EXPORT vttPlan.test.js RUNS ON. Rectangles prove the shapes already known,
// and a wrong kernel here has passed on synthetic input before.

const CAVE = path.join(__dirname, 'fixtures', 'cave-map.dd2vtt');
const caveJson = JSON.parse(fs.readFileSync(CAVE, 'utf8'));
const caveRooms = vttDerivePlan(caveJson).rooms.map(r => r.map(v => ({ x: v.x, y: v.y })));

// The cell this export declares, which is the floor a scene of it would use.
const CAVE_CELL = caveJson.resolution.pixels_per_grid;
const CAVE_FLOOR = roomOpMinArea(CAVE_CELL);

// A room the kernel can be aimed at from its bounding box alone.
const isRect = (r) => r.length === 4 &&
  Math.abs(ringArea(r) - (bbox(r).x1 - bbox(r).x0) * (bbox(r).y1 - bbox(r).y0)) < 1;

describe('roomOps — the cave export', () => {
  it('starts from the rooms vttPlan actually derives', () => {
    assert.equal(caveRooms.length, 13);
    assert.equal(CAVE_CELL, 150);
  });

  // ⚠ THE FLOOR IS SET FROM THIS NUMBER, not guessed. A floor at or above it would silently
  // delete the smallest real room the import produces.
  it('leaves the smallest real room far above the sliver floor', () => {
    const smallest = Math.min(...caveRooms.map(ringArea));
    assert.ok(smallest > 23000 && smallest < 24000,
              'the smallest derived room measured ' + Math.round(smallest));
    assert.ok(ROOM_OP_MIN_AREA < smallest / 20,
              'the fallback floor is within reach of a real room');
    assert.ok(CAVE_FLOOR < smallest, 'a grid-square floor would delete the smallest room');
  });

  it('notches a real room without breaking its outline', () => {
    const room = caveRooms.reduce((a, b) => ringArea(a) > ringArea(b) ? a : b);
    const b = bbox(room);
    const drawn = rect(b.x0 - 100, b.y0 - 100, b.x0 + 300, b.y0 + 300);
    assert.equal(shapesOverlap(room, drawn), true);
    const out = trimShapes([room], drawn, CAVE_FLOOR);
    assert.equal(out.reason, undefined);
    assert.equal(out.groups[0].length, 1);
    const piece = out.groups[0][0];
    assertOpenRing(piece, 'notched cave room');
    assert.ok(ringArea(piece) < ringArea(room), 'the trim took nothing away');
    assert.ok(ringArea(piece) > ringArea(room) * 0.8, 'the trim took far too much');
  });

  it('splits a real room in two with a strip across it', () => {
    const room = caveRooms.filter(isRect).reduce((a, b) => ringArea(a) > ringArea(b) ? a : b);
    const b = bbox(room);
    const midY = (b.y0 + b.y1) / 2;
    const out = trimShapes([room], rect(b.x0 - 100, midY - 40, b.x1 + 100, midY + 40),
                           CAVE_FLOOR);
    assert.equal(out.reason, undefined);
    assert.equal(out.groups[0].length, 2);
    for (const p of out.groups[0]) assertOpenRing(p, 'cave split piece');
  });

  it('joins two real rooms that a bridge crosses', () => {
    const pair = findNeighbours();
    assert.ok(pair, 'the export holds no two rooms close enough to bridge');
    const [a, c] = pair;
    const out = joinShapes([a, c], pair.bridge, CAVE_FLOOR);
    assert.equal(out.reason, undefined);
    assert.equal(out.pieces.length, 1, 'the bridge did not make one room');
    assertOpenRing(out.pieces[0], 'joined cave rooms');
    assert.ok(ringArea(out.pieces[0]) >= ringArea(a) + ringArea(c),
              'the joined room is smaller than the rooms it was made of');
  });

  it('cuts a real room in two whose edges touch exactly', () => {
    const room = caveRooms.filter(isRect).reduce((a, b) => ringArea(a) > ringArea(b) ? a : b);
    const b = bbox(room);
    const midY = (b.y0 + b.y1) / 2;
    const out = cutRing(room, [{ x: b.x0 - 200, y: midY }, { x: b.x1 + 200, y: midY }],
                        CAVE_FLOOR);
    assert.equal(out.reason, undefined);
    assert.equal(out.pieces.length, 2);
    for (const p of out.pieces) assertOpenRing(p, 'cave cut piece');
    const sum = out.pieces.reduce((s, p) => s + ringArea(p), 0);
    assert.ok(Math.abs(sum - ringArea(room)) < 1,
              'the cut lost ' + Math.round(ringArea(room) - sum) + ' units of room');
  });

  it('refuses a hole in a real room and changes nothing', () => {
    const room = caveRooms.filter(isRect).reduce((a, b) => ringArea(a) > ringArea(b) ? a : b);
    const before = JSON.stringify(room);
    const b = bbox(room);
    const out = trimShapes([room], rect(b.x0 + 200, b.y0 + 200, b.x0 + 500, b.y0 + 500),
                           CAVE_FLOOR);
    assert.equal(out.reason, REASON_HOLE);
    assert.equal(JSON.stringify(room), before, 'the kernel edited the room it refused');
  });

  it('never hands back a ring the app could not store', () => {
    const b0 = bbox(caveRooms[0]);
    const drawn = rect(b0.x0 - 5000, b0.y0 - 5000, b0.x0 + 5000, b0.y0 + 5000);
    const hits = caveRooms.filter(r => shapesOverlap(r, drawn));
    assert.ok(hits.length >= 2, 'the sweep touched only ' + hits.length + ' room(s)');
    const trimmed = trimShapes(hits, drawn, CAVE_FLOOR);
    if (trimmed.groups) {
      for (const g of trimmed.groups) for (const p of g) assertOpenRing(p, 'swept trim piece');
    }
    const joined = joinShapes(hits, drawn, CAVE_FLOOR);
    assert.equal(joined.reason, undefined);
    for (const p of joined.pieces) assertOpenRing(p, 'swept join piece');
  });
});

// Two derived rooms near enough for one rectangle to reach both, plus that rectangle.
function findNeighbours() {
  for (let i = 0; i < caveRooms.length; i++) {
    for (let j = i + 1; j < caveRooms.length; j++) {
      const a = bbox(caveRooms[i]), b = bbox(caveRooms[j]);
      const ox0 = Math.max(a.x0, b.x0), ox1 = Math.min(a.x1, b.x1);
      if (ox1 - ox0 < 200) continue;
      const gap = a.y1 < b.y1 ? b.y0 - a.y1 : a.y0 - b.y1;
      if (gap > 400) continue;
      const lo = Math.min(a.y1, b.y1), hi = Math.max(a.y0, b.y0);
      const bridge = rect(ox0 + 40, Math.min(lo, hi) - 60, ox0 + 180, Math.max(lo, hi) + 60);
      if (!shapesOverlap(caveRooms[i], bridge) || !shapesOverlap(caveRooms[j], bridge)) continue;
      const pair = [caveRooms[i], caveRooms[j]];
      pair.bridge = bridge;
      return pair;
    }
  }
  return null;
}

test('the library is pinned to the version the kernel was written against', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.devDependencies['polygon-clipping'], '0.15.7');
  // The vendored copy is what ships, so a missing build.files entry is a dead tool in the .exe.
  assert.ok(pkg.build.files.indexOf('lib/polygon-clipping.umd.js') >= 0,
            'lib/polygon-clipping.umd.js is not in package.json build.files');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'lib', 'polygon-clipping.umd.js')),
            'the UMD build is not vendored into lib/');
});
