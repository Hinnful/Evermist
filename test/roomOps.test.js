'use strict';

const { test, describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  toRings, fromRings, ringArea, resultPieces, shapesOverlap,
  joinShapes, mergeShapes, weldTolerance, trimShapes, splitShapes, cutOutShapes, intersectShapes, excludeShapes, cutRing, mostHiddenMode, roomOpMinArea,
  crossSegments, ringPathCrossings, arcForward, dedupeRing,
  ROOM_OP_MIN_AREA, REASON_CUT, pointInRing,
} = require('../src/shapes/roomOps.js');

const { vttDerivePlan } = require('../src/rooms/vttPlan.js');
const { restoreGroupDetail } = require('../src/shapes/shapeDetail.js');

// ⚠ THE SYNTHETIC CASES BELOW PROVE ONLY THE SHAPES ALREADY KNOWN. The real cave export at the
// bottom of this file is what catches a kernel that works on rectangles and not on a floor plan.

const FLOOR = 1;   // sliver floor for the synthetic cases: they are all far above any grid square

const rect = (x1, y1, x2, y2) =>
  [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];

// Every kernel entry point answers with pieces of { verts, holes }. These two read one.
const pv = (piece) => piece.verts;
const ph = (piece) => piece.holes || [];

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

  it('takes a record with holes as well as a bare point list', () => {
    const r = toRings({ vertices: rect(0, 0, 10, 10), holes: [rect(3, 3, 7, 7)] });
    assert.equal(r.length, 2);
    assert.equal(r[1].length, 5);
    assert.deepEqual(r[1][0], r[1][4]);
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

  it('sees no overlap with a shape that sits inside a hole', () => {
    const keep = { vertices: rect(0, 0, 100, 100), holes: [rect(30, 30, 70, 70)] };
    assert.equal(shapesOverlap(keep, rect(40, 40, 60, 60)), false);
    assert.equal(shapesOverlap(keep, rect(10, 10, 20, 20)), true);
    // And one reaching from the courtyard out through the wall does overlap.
    assert.equal(shapesOverlap(keep, rect(40, 40, 90, 60)), true);
  });
});

describe('roomOps — trim', () => {
  it('notches one wall and leaves one room', () => {
    const room = rect(0, 0, 100, 100);
    const out = trimShapes([room], rect(40, -10, 60, 30), FLOOR);
    assert.equal(out.reason, undefined);
    assert.equal(out.groups.length, 1);
    assert.equal(out.groups[0].length, 1);
    const piece = pv(out.groups[0][0]);
    assertOpenRing(piece, 'notched room');
    assert.equal(Math.round(ringArea(piece)), 10000 - 600);
    assert.deepEqual(ph(out.groups[0][0]), []);
    // The notch is real geometry, not a bounding-box change: the outline gains corners.
    assert.ok(piece.length > 4, 'the notch left the outline a rectangle');
  });

  it('splits a room into two when the strip goes all the way across', () => {
    const out = trimShapes([rect(0, 0, 100, 100)], rect(45, -10, 55, 110), FLOOR);
    assert.equal(out.reason, undefined);
    assert.equal(out.groups[0].length, 2);
    for (const p of out.groups[0]) {
      assertOpenRing(pv(p), 'split piece');
      assert.equal(Math.round(ringArea(pv(p))), 4500);
    }
  });

  it('removes a room the drawn shape covers whole', () => {
    const out = trimShapes([rect(10, 10, 40, 40)], rect(0, 0, 100, 100), FLOOR);
    assert.equal(out.reason, undefined);
    assert.deepEqual(out.groups, [[]]);
  });

  it('leaves a hole when the trim lands wholly inside the room', () => {
    const out = trimShapes([rect(0, 0, 100, 100)], rect(30, 30, 70, 70), FLOOR);
    assert.equal(out.reason, undefined);
    assert.equal(out.groups[0].length, 1, 'a hole is one piece, never two rooms');
    const piece = out.groups[0][0];
    assertOpenRing(pv(piece), 'room around a hole');
    assert.equal(Math.round(ringArea(pv(piece))), 10000);
    assert.equal(ph(piece).length, 1);
    assertOpenRing(ph(piece)[0], 'the hole');
    assert.equal(Math.round(ringArea(ph(piece)[0])), 1600);
  });

  it('holes the second room without touching the first', () => {
    const rooms = [rect(0, 0, 100, 100), rect(200, 0, 300, 100)];
    // Overlaps the first room's corner, and sits wholly inside the second.
    const drawn = [{ x: 90, y: 90 }, { x: 110, y: 90 }, { x: 110, y: 110 }, { x: 90, y: 110 }];
    assert.equal(trimShapes(rooms, drawn, FLOOR).reason, undefined);
    const holing = trimShapes(rooms, rect(220, 20, 280, 80), FLOOR);
    assert.equal(holing.reason, undefined);
    assert.deepEqual(ph(holing.groups[0][0]), [], 'the first room gained a hole it never got');
    assert.equal(ph(holing.groups[1][0]).length, 1);
  });

  it('drops a hole below the sliver floor', () => {
    const out = trimShapes([rect(0, 0, 100, 100)], rect(50, 50, 52, 52), 100);
    assert.equal(out.groups[0].length, 1);
    assert.deepEqual(ph(out.groups[0][0]), []);
  });

  it('discards a piece below the sliver floor', () => {
    // A strip 1 unit shy of the far wall: the far piece is 100 units², the near one 4,500.
    const out = trimShapes([rect(0, 0, 100, 100)], rect(45, -10, 99, 110), 1000);
    assert.equal(out.groups[0].length, 1);
    assert.equal(Math.round(ringArea(pv(out.groups[0][0]))), 4500);
    // With no floor to speak of, the sliver is back — so the filter is what removed it.
    assert.equal(trimShapes([rect(0, 0, 100, 100)], rect(45, -10, 99, 110), 1).groups[0].length, 2);
  });
});

describe('roomOps — join', () => {
  it('makes one room out of two that touch', () => {
    const out = joinShapes([rect(0, 0, 50, 50), rect(50, 0, 100, 50)], rect(40, 10, 60, 40), 1);
    assert.equal(out.reason, undefined);
    assert.equal(out.pieces.length, 1);
    assertOpenRing(pv(out.pieces[0]), 'joined room');
    assert.equal(Math.round(ringArea(pv(out.pieces[0]))), 5000);
  });

  it('bridges two rooms that do not touch', () => {
    const out = joinShapes([rect(0, 0, 50, 50), rect(70, 0, 120, 50)], rect(45, 10, 75, 40), 1);
    assert.equal(out.pieces.length, 1);
    assert.equal(Math.round(ringArea(pv(out.pieces[0]))), 2500 + 2500 + 20 * 30);
  });

  it('hands back two pieces when nothing bridges them', () => {
    // ⚠ TWO POLYGONS IS NOT A HOLE. Refusing "more than one ring" would refuse every split.
    const out = joinShapes([rect(0, 0, 50, 50), rect(200, 0, 250, 50)], rect(0, 0, 50, 50), 1);
    assert.equal(out.reason, undefined);
    assert.equal(out.pieces.length, 2);
    for (const p of out.pieces) assert.equal(Math.round(ringArea(pv(p))), 2500);
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
      assertOpenRing(pv(p), 'cut piece');
      assert.equal(Math.round(ringArea(pv(p))), 5000);
    }
    // Zero width: the two pieces add back up to the room, with no strip missing.
    assert.equal(Math.round(out.pieces.reduce((s, p) => s + ringArea(pv(p)), 0)), 10000);
    // And they share the cut, point for point.
    const shared = pv(out.pieces[0]).filter(a =>
      pv(out.pieces[1]).some(b => Math.hypot(a.x - b.x, a.y - b.y) < 1e-9));
    assert.equal(shared.length, 2);
  });

  it('follows a path with corners in it', () => {
    const out = cutRing(rect(0, 0, 100, 100),
                        [{ x: -20, y: 20 }, { x: 50, y: 20 }, { x: 50, y: 80 },
                         { x: 120, y: 80 }], 1);
    assert.equal(out.pieces.length, 2);
    assert.equal(Math.round(out.pieces.reduce((s, p) => s + ringArea(pv(p)), 0)), 10000);
    assert.ok(out.pieces.some(p => pv(p).length >= 5), 'the corner in the path was dropped');
  });

  it('takes an alcove out when the path enters and leaves the same wall', () => {
    const out = cutRing(rect(0, 0, 100, 100),
                        [{ x: 20, y: -10 }, { x: 20, y: 40 }, { x: 60, y: 40 },
                         { x: 60, y: -10 }], 1);
    assert.equal(out.reason, undefined);
    assert.equal(out.pieces.length, 2);
    const areas = out.pieces.map(p => Math.round(ringArea(pv(p)))).sort((a, b) => a - b);
    assert.deepEqual(areas, [1600, 8400]);
  });

  it('carries each hole onto the piece it landed in', () => {
    const keep = { vertices: rect(0, 0, 200, 100),
                   holes: [rect(20, 20, 60, 80), rect(140, 20, 180, 80)] };
    const out = cutRing(keep, [{ x: 100, y: -20 }, { x: 100, y: 120 }], 1);
    assert.equal(out.reason, undefined);
    assert.equal(out.pieces.length, 2);
    for (const p of out.pieces) {
      assert.equal(ph(p).length, 1, 'a hole went to the wrong side of the cut');
      const b = bbox(ph(p)[0]), pb = bbox(pv(p));
      assert.ok(b.x0 >= pb.x0 && b.x1 <= pb.x1, 'the hole sits outside its own piece');
    }
  });

  it('splits a hole the path runs through, so neither half loses its courtyard', () => {
    const keep = { vertices: rect(0, 0, 200, 100), holes: [rect(80, 20, 120, 80)] };
    const out = cutRing(keep, [{ x: 100, y: -20 }, { x: 100, y: 120 }], 1);
    assert.equal(out.reason, undefined);
    assert.equal(out.pieces.length, 2);
    for (const p of out.pieces) {
      assert.equal(ph(p).length, 1, 'a half of the cut room lost its share of the courtyard');
      assertOpenRing(ph(p)[0], 'split hole');
      const h = bbox(ph(p)[0]), pb = bbox(pv(p));
      // ⚠ THE HOLE MUST SIT INSIDE ITS OWN PIECE. A whole ring handed to one piece pokes out
      // through that piece's own wall, and the fog then paints on the far side of it.
      assert.ok(h.x0 >= pb.x0 - 1e-9 && h.x1 <= pb.x1 + 1e-9,
                'the hole reaches outside its piece: hole ' + JSON.stringify(h) +
                ' against piece ' + JSON.stringify(pb));
      assert.equal(Math.round(ringArea(ph(p)[0])), 20 * 60);
    }
  });

  it('takes a bare ring as well as a record', () => {
    const bare = cutRing(rect(0, 0, 100, 100), [{ x: -20, y: 50 }, { x: 120, y: 50 }], 1);
    assert.equal(bare.pieces.length, 2);
    for (const p of bare.pieces) assert.deepEqual(ph(p), []);
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
  it('turns a second ring inside one polygon into that piece hole', () => {
    const outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    const inner = [[3, 3], [3, 7], [7, 7], [7, 3], [3, 3]];
    const one = resultPieces([[outer, inner]], 1);
    assert.equal(one.pieces.length, 1);
    assert.equal(ph(one.pieces[0]).length, 1);
    assertOpenRing(ph(one.pieces[0])[0], 'hole from a library ring');
    // A second POLYGON is still a second piece, never a hole.
    const two = resultPieces([[outer], [outer]], 1);
    assert.equal(two.pieces.length, 2);
    for (const p of two.pieces) assert.deepEqual(ph(p), []);
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
    const piece = pv(out.groups[0][0]);
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
    for (const p of out.groups[0]) assertOpenRing(pv(p), 'cave split piece');
  });

  it('joins two real rooms that a bridge crosses', () => {
    const pair = findNeighbours();
    assert.ok(pair, 'the export holds no two rooms close enough to bridge');
    const [a, c] = pair;
    const out = joinShapes([a, c], pair.bridge, CAVE_FLOOR);
    assert.equal(out.reason, undefined);
    assert.equal(out.pieces.length, 1, 'the bridge did not make one room');
    assertOpenRing(pv(out.pieces[0]), 'joined cave rooms');
    assert.ok(ringArea(pv(out.pieces[0])) >= ringArea(a) + ringArea(c),
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
    for (const p of out.pieces) assertOpenRing(pv(p), 'cave cut piece');
    const sum = out.pieces.reduce((s, p) => s + ringArea(pv(p)), 0);
    assert.ok(Math.abs(sum - ringArea(room)) < 1,
              'the cut lost ' + Math.round(ringArea(room) - sum) + ' units of room');
  });

  it('holes a real room without editing the room it was handed', () => {
    const room = caveRooms.filter(isRect).reduce((a, b) => ringArea(a) > ringArea(b) ? a : b);
    const before = JSON.stringify(room);
    const b = bbox(room);
    const out = trimShapes([room], rect(b.x0 + 200, b.y0 + 200, b.x0 + 500, b.y0 + 500),
                           CAVE_FLOOR);
    assert.equal(out.reason, undefined);
    assert.equal(out.groups[0].length, 1);
    assert.equal(ph(out.groups[0][0]).length, 1);
    assertOpenRing(ph(out.groups[0][0])[0], 'cave room hole');
    assert.equal(JSON.stringify(room), before, 'the kernel edited the room it read');
  });

  it('never hands back a ring the app could not store', () => {
    const b0 = bbox(caveRooms[0]);
    const drawn = rect(b0.x0 - 5000, b0.y0 - 5000, b0.x0 + 5000, b0.y0 + 5000);
    const hits = caveRooms.filter(r => shapesOverlap(r, drawn));
    assert.ok(hits.length >= 2, 'the sweep touched only ' + hits.length + ' room(s)');
    const trimmed = trimShapes(hits, drawn, CAVE_FLOOR);
    if (trimmed.groups) {
      for (const g of trimmed.groups) {
        for (const p of g) {
          assertOpenRing(pv(p), 'swept trim piece');
          for (const h of ph(p)) assertOpenRing(h, 'swept trim hole');
        }
      }
    }
    const joined = joinShapes(hits, drawn, CAVE_FLOOR);
    assert.equal(joined.reason, undefined);
    for (const p of joined.pieces) {
      assertOpenRing(pv(p), 'swept join piece');
      for (const h of ph(p)) assertOpenRing(h, 'swept join hole');
    }
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

describe('roomOps — Split along the drawn shape edge', () => {
  const area = verts => ringArea(verts);

  it('splits a room the shape crosses into the part outside and the part inside', () => {
    const room = { vertices: rect(0, 0, 100, 100) };
    const out = splitShapes([room], rect(60, -20, 140, 120), FLOOR);
    assert.equal(out.groups.length, 1);
    const [outside, inside] = out.groups[0];
    assert.equal(area(pv(outside)), 6000);
    assert.equal(area(pv(inside)), 4000);
  });

  it('a shape wholly inside a room leaves the room with a hole and the shape as a room', () => {
    const out = splitShapes([{ vertices: rect(0, 0, 100, 100) }], rect(30, 30, 60, 60), FLOOR);
    const [outside, inside] = out.groups[0];
    assert.equal(ph(outside).length, 1);
    assert.equal(area(pv(inside)), 900);
  });

  it('answers null for a room the shape covers or only touches', () => {
    const out = splitShapes([{ vertices: rect(10, 10, 40, 40) }, { vertices: rect(200, 0, 300, 100) }],
                            rect(0, 0, 100, 100), FLOOR);
    assert.deepEqual(out.groups, [null, null]);
  });

  it('splits every room the shape crosses and leaves the area unchanged', () => {
    const rooms = [{ vertices: rect(0, 0, 100, 100) }, { vertices: rect(0, 120, 100, 220) }];
    const out = splitShapes(rooms, rect(50, -10, 150, 230), FLOOR);
    let total = 0;
    for (const g of out.groups) { assert.equal(g.length, 2); for (const p of g) total += area(pv(p)); }
    assert.equal(total, 20000);
  });

  it('refuses nothing and edits nothing it read', () => {
    const room = { vertices: rect(0, 0, 100, 100), holes: [rect(40, 40, 60, 60)] };
    const before = JSON.stringify(room);
    const out = splitShapes([room], rect(50, -10, 150, 110), FLOOR);
    assert.equal(out.reason, undefined);
    assert.equal(JSON.stringify(room), before);
  });

  it('carries a curved wall, a hole and a door from a real cave room onto its pieces', () => {
    const room0 = caveRooms.reduce((a, b) => ringArea(a) > ringArea(b) ? a : b);
    const b = bbox(room0);
    // A square hole, wider than the sliver floor, wholly inside the room, found by scanning its bounding box.
    const H = 90;
    let spot = null;
    for (let y = b.y0; y < b.y1 && !spot; y += 20) {
      for (let x = b.x0; x < b.x1 && !spot; x += 20) {
        const sq = rect(x - H, y - H, x + H, y + H);
        if (sq.every(v => pointInRing(v.x, v.y, room0)) && shapesOverlap(room0, sq)) spot = { x, y };
      }
    }
    assert.ok(spot, 'no interior spot in the largest cave room');
    const handles = room0.map(() => null);
    handles[0] = { ox: 0, oy: -40, ix: 0, iy: 0 };
    const room = {
      vertices: room0.map(v => ({ ...v })),
      holes: [rect(spot.x - H, spot.y - H, spot.x + H, spot.y + H)],
      handles,
      doors: [{ edge: 1, t: 0.5 }],
    };
    const drawn = rect(spot.x + 200, b.y0 - 200, b.x1 + 200, b.y1 + 200);   // the hole stays wholly outside it
    const split = splitShapes([room], drawn, CAVE_FLOOR);
    assert.equal(split.reason, undefined);
    const pieces = split.groups[0];
    assert.ok(pieces && pieces.length >= 2, 'the real room was not split');
    const kept = restoreGroupDetail([room], pieces);
    assert.equal(kept.pieces.length, pieces.length);
    // The hole sits wholly on one side, so exactly one piece keeps it whole.
    const holeArea = kept.pieces.reduce((s, p) => s + (p.holes || []).reduce((h, r) => h + area(r), 0), 0);
    assert.ok(Math.abs(holeArea - 4 * H * H) < 1, 'hole area ' + holeArea);
    assert.ok(kept.pieces.some(p => p.handles), 'the curved wall was dropped');
    assert.equal(kept.pieces.reduce((n, p) => n + (p.doors ? p.doors.length : 0), 0) + kept.droppedDoors, 1);
  });
});

test('the library is pinned to the version the kernel was written against', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.devDependencies['polygon-clipping'], '0.15.7');
  // The vendored copy is what ships, so a missing build.files entry is a dead tool in the .exe.
  assert.ok(pkg.build.files.indexOf('lib/polygon-clipping.umd.js') >= 0,
            'lib/polygon-clipping.umd.js is not in package.json build.files');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'lib', 'polygon-clipping.umd.js')),
            'the UMD build is not vendored into lib/');
});

// A Ring size placed with a repair armed arrives as a record: the band, not the disc, is the drawn shape.
describe('roomOps — a ring as the drawn shape', () => {
  const ring = { vertices: rect(0, 0, 100, 100), holes: [rect(30, 30, 70, 70)] };

  it('Cut out takes only the band and leaves the middle', () => {
    const out = trimShapes([{ vertices: rect(20, 20, 80, 80) }], ring, FLOOR);
    assert.equal(out.groups[0].length, 1);
    assert.equal(ringArea(pv(out.groups[0][0])), 1600);
  });

  it('Merge adds only the band, and a middle nothing filled stays open', () => {
    const tab = joinShapes([{ vertices: rect(-20, 40, 10, 60) }], ring, FLOOR);
    assert.equal(tab.pieces.length, 1);
    assert.equal(ph(tab.pieces[0]).length, 1, 'the merged ring lost its middle');
    const filled = joinShapes([{ vertices: rect(20, 20, 80, 80) }], ring, FLOOR);
    assert.equal(ph(filled.pieces[0]).length, 0);
  });

  it('a shape sitting in the middle is not touched by the band', () => {
    assert.equal(shapesOverlap({ vertices: rect(40, 40, 60, 60) }, ring), false);
  });

  it('Split divides along both of the band\'s edges', () => {
    const out = splitShapes([{ vertices: rect(20, 20, 80, 80) }], ring, FLOOR);
    const areas = out.groups[0].map(p => ringArea(pv(p)) - ph(p).reduce((s, h) => s + ringArea(h), 0)).sort((a, b) => a - b);
    assert.deepEqual(areas, [1600, 2000]);
  });
});

// The booleans on picked shapes (BACKLOG 297): the first pick is the main.
describe('roomOps — booleans on picked shapes', () => {
  const sq = (x1, y1, x2, y2) => ({ vertices: rect(x1, y1, x2, y2) });
  const net = (pieces) => pieces.reduce((s, p) => s + ringArea(pv(p)) - ph(p).reduce((h, r) => h + ringArea(r), 0), 0);
  const keep = { vertices: rect(0, 0, 100, 100), holes: [rect(30, 30, 70, 70)] };

  it('Intersect keeps only what every pick covers', () => {
    assert.equal(net(intersectShapes([sq(0, 0, 10, 10), sq(5, 5, 15, 15)], FLOOR).pieces), 25);
    assert.equal(net(intersectShapes([sq(0, 0, 10, 10), sq(5, 5, 15, 15), sq(0, 5, 15, 8)], FLOOR).pieces), 15);
  });

  it('Intersect of rooms that do not touch leaves nothing for the caller to refuse', () => {
    const out = intersectShapes([sq(0, 0, 10, 10), sq(20, 0, 30, 10)], FLOOR);
    assert.equal(out.reason, undefined);
    assert.deepEqual(out.pieces, []);
  });

  it('Exclude keeps what an odd number of picks cover', () => {
    const out = excludeShapes([sq(0, 0, 10, 10), sq(5, 5, 15, 15)], FLOOR);
    assert.equal(out.pieces.length, 2);
    assert.equal(net(out.pieces), 150);
    // Covered once, three times, twice, once: the twice-covered strip goes and the rest stays.
    assert.equal(net(excludeShapes([sq(0, 0, 30, 10), sq(10, 0, 40, 10), sq(10, 0, 20, 10)], FLOOR).pieces), 300);
  });

  it('Cut out takes every other pick from the main', () => {
    assert.equal(net(cutOutShapes(sq(0, 0, 10, 10), [sq(5, 0, 15, 10)], FLOOR).pieces), 50);
    assert.equal(net(cutOutShapes(sq(0, 0, 30, 10), [sq(5, 0, 10, 10), sq(20, 0, 25, 10)], FLOOR).pieces), 200);
    assert.deepEqual(cutOutShapes(sq(2, 2, 8, 8), [sq(0, 0, 10, 10)], FLOOR).pieces, []);
  });

  it('a room with a hole: Intersect opens the hole into a notch, Exclude leaves three pieces', () => {
    const half = sq(50, 0, 150, 100);
    const both = intersectShapes([keep, half], FLOOR);
    assert.equal(both.pieces.length, 1);
    assert.equal(net(both.pieces), 50 * 100 - 20 * 40);
    const odd = excludeShapes([keep, half], FLOOR);
    assert.equal(odd.pieces.length, 3);
    assert.equal(net(odd.pieces), 4200 + 800 + 5000);
  });

  // The top wall bulges out as a cubic from (0,0) to (100,0) with one control at (0,-40): 1200 exactly,
  // and the sampled curve the library reads lands within 2% under it.
  it('a curved wall is read where it is drawn, not along its chord', () => {
    const curved = { vertices: rect(0, 0, 100, 100), handles: [{ ox: 0, oy: -40, ix: 0, iy: 0 }, null, null, null] };
    const bulge = net(excludeShapes([curved, sq(0, 0, 100, 100)], FLOOR).pieces);
    assert.ok(bulge > 1200 * 0.98 && bulge <= 1200, 'bulge area ' + bulge);
    assert.equal(net(intersectShapes([curved, sq(-10, -100, 110, 0)], FLOOR).pieces), bulge);
    assert.equal(net(intersectShapes([curved, sq(0, 0, 100, 100)], FLOOR).pieces), 10000);
  });

  it('a real cave room: Intersect with its box is the room, Exclude with it is the rest of the box', () => {
    const room = caveRooms.filter(r => !isRect(r)).reduce((a, b) => ringArea(a) > ringArea(b) ? a : b);
    const b = bbox(room);
    const box = { vertices: rect(b.x0, b.y0, b.x1, b.y1) };
    const both = intersectShapes([{ vertices: room }, box], CAVE_FLOOR);
    assert.ok(Math.abs(net(both.pieces) - ringArea(room)) < 1, 'intersect ' + net(both.pieces) + ' vs ' + ringArea(room));
    const rest = net(excludeShapes([{ vertices: room }, box], CAVE_FLOOR).pieces);
    const boxArea = (b.x1 - b.x0) * (b.y1 - b.y0);
    // Slivers of the box under the floor are dropped, so the rest is at most the exact difference.
    assert.ok(rest <= boxArea - ringArea(room) + 1 && rest > (boxArea - ringArea(room)) * 0.9, 'exclude ' + rest);
    for (const p of both.pieces) assertOpenRing(pv(p), 'cave intersect piece');
  });

  it('two real cave rooms touch nowhere, and a bridge splits into what it shares and what it does not', () => {
    const pair = findNeighbours();
    const [a, c] = pair;
    assert.deepEqual(intersectShapes([{ vertices: a }, { vertices: c }], CAVE_FLOOR).pieces, []);
    const shared = net(intersectShapes([{ vertices: a }, { vertices: pair.bridge }], FLOOR).pieces);
    const left = net(cutOutShapes({ vertices: a }, [{ vertices: pair.bridge }], FLOOR).pieces);
    assert.ok(shared > 0);
    assert.ok(Math.abs(shared + left - ringArea(a)) < 1, 'shared ' + shared + ' + left ' + left + ' vs ' + ringArea(a));
  });
});

// ─── Merge welds a hairline gap ───────────────────────────────────────────────
// A corridor maze with a hole and a crypt drawn beside it, by hand, on a 4050x3900 map with an 86.59px hex grid:
// the crypt's top right corner stops 1.5px short of the corridor's wall, tapering to 0 at its bottom.
const WELD_GRID = 86.59;
const xy = flat => { const v = []; for (let i = 0; i < flat.length; i += 2) v.push({ x: flat[i], y: flat[i + 1] }); return v; };
const WELD_CORRIDOR = {
  vertices: xy([1312.2, 1947.677, 1786.419, 1948.296, 1786.419, 2591.018, 2422.191, 2588.199, 2422.191, 2269.715, 1944.464, 2269.715, 1944.464, 1470.685, 2103.707, 1470.685, 2103.707, 1791.988, 2264.358, 1791.988, 2264.358, 1632.745, 2423.601, 1632.745, 2423.601, 1793.397, 3059.161, 1793.397, 3059.161, 1311.442, 2742.085, 1311.442, 2742.085, 1474.122, 2583.211, 1474.122, 2582.843, 1314.261, 2103.707, 1314.261, 2103.707, 998.594, 2262.949, 998.594, 2262.949, 1157.837, 2582.843, 1157.837, 2582.843, 842.171, 1786.441, 842.171, 1786.499, 678.5, 2579.999, 678.5, 2579.999, 521, 2738.999, 521, 2738.999, 678.5, 2897.999, 678.5, 2897.999, 837.5, 2738.999, 837.5, 2738.999, 1155.5, 3056.999, 1155.5, 3056.999, 521, 3215.999, 521, 3215.999, 837.5, 3532.499, 837.5, 3532.499, 1948.999, 2104.499, 1948.999, 2104.499, 2107.999, 3532.499, 2107.999, 3532.499, 2266.999, 3373.498, 2266.999, 3373.498, 2424.499, 3215.999, 2424.499, 3215.999, 2266.999, 3056.999, 2266.999, 3056.999, 2424.499, 2897.999, 2424.499, 2897.999, 2266.999, 2579.999, 2266.999, 2579.999, 2742.499, 1627.499, 2742.499, 1627.499, 2107.999, 1312.2, 2107.999]),
  holes: [xy([3213.476, 995.768, 3213.476, 1798.899, 3377.172, 1798.899, 3377.172, 995.768])],
};
const WELD_CRYPT = { vertices: xy([518.4, 1950, 1310.712, 1950, 1312.2, 3377.4, 518.4, 3377.4]), holes: [] };

describe('roomOps — Merge welds before the union', () => {
  const minArea = roomOpMinArea(WELD_GRID), tol = weldTolerance(WELD_GRID);
  const area = s => ringArea(s.vertices) - s.holes.reduce((a, h) => a + ringArea(h), 0);
  const net = pieces => pieces.reduce((s, p) => s + ringArea(pv(p)) - ph(p).reduce((h, r) => h + ringArea(r), 0), 0);

  it('the tolerance is a tenth of a cell, never under 2px', () => {
    assert.ok(Math.abs(tol - 8.659) < 1e-9);
    assert.equal(weldTolerance(10), 2);
    assert.equal(weldTolerance(0), 2);
  });

  it('a plain union leaves the crypt and the corridor apart', () => {
    assert.equal(joinShapes([WELD_CRYPT], WELD_CORRIDOR, minArea).pieces.length, 2);
  });

  for (const [name, main, other] of [['corridor first', WELD_CORRIDOR, WELD_CRYPT], ['crypt first', WELD_CRYPT, WELD_CORRIDOR]]) {
    it('the crypt and the corridor merge into one piece, ' + name, () => {
      const out = mergeShapes(main, [other], minArea, tol);
      assert.equal(out.reason, undefined);
      assert.equal(out.pieces.length, 1);
      const want = area(WELD_CORRIDOR) + area(WELD_CRYPT);
      assert.ok(Math.abs(net(out.pieces) - want) / want < 0.01, 'area ' + net(out.pieces) + ' vs ' + want);
      assert.equal(ph(out.pieces[0]).length, 1, 'the corridor keeps its hole');
    });
  }

  it('two rectangles 50px apart stay two pieces, so Merge refuses', () => {
    const out = mergeShapes({ vertices: rect(0, 0, 100, 100) }, [{ vertices: rect(150, 0, 250, 100) }], FLOOR, weldTolerance(50));
    assert.equal(out.pieces.length, 2);
  });

  // A room whose top wall holds a door and whose bottom wall bows down, both walls ending at a corner 1px short of
  // the neighbour's wall: the weld moves those corners, and the door and the curve must ride the merge.
  it('a door and a curved wall on walls ending at a welded corner are kept', () => {
    const room = {
      vertices: rect(0, 0, 100, 100),
      doors: [{ edge: 0, t: 0.5, width: 20 }],
      handles: [null, null, { ix: 0, iy: 0, ox: -30, oy: 40 }, { ix: 30, iy: 40, ox: 0, oy: 0 }],
    };
    const hall = { vertices: rect(101, -50, 200, 150) };
    const out = mergeShapes(room, [hall], FLOOR, weldTolerance(50));
    assert.equal(out.pieces.length, 1);
    const kept = restoreGroupDetail(out.shapes, out.pieces);
    assert.equal(kept.droppedDoors, 0, 'no door dropped');
    const p = kept.pieces[0];
    assert.equal(p.vertices.length, 8, 'the curve is one wall again, not its samples: ' + p.vertices.length);
    assert.equal((p.doors || []).length, 1);
    const d = p.doors[0], a = p.vertices[d.edge], b = p.vertices[(d.edge + 1) % p.vertices.length];
    const at = { x: a.x + (b.x - a.x) * d.t, y: a.y + (b.y - a.y) * d.t };
    assert.ok(Math.abs(at.x - 50.5) < 1e-6 && Math.abs(at.y) < 1e-6, 'door at ' + JSON.stringify(at));
    assert.equal(d.width, 20);
    const curved = (p.handles || []).filter(Boolean);
    assert.equal(curved.length, 2, 'two curve handles, the bowed wall\'s two ends');
    const bow = curved.map(h => Math.max(Math.abs(h.oy), Math.abs(h.iy)));
    assert.ok(bow.every(v => Math.abs(v - 40) < 1e-6), 'the bow keeps its 40px: ' + bow);
  });

  it('two rectangles sharing a wall give one piece of both areas', () => {
    const out = mergeShapes({ vertices: rect(0, 0, 100, 100) }, [{ vertices: rect(100, 0, 250, 100) }], FLOOR, weldTolerance(50));
    assert.equal(out.pieces.length, 1);
    assert.ok(Math.abs(net(out.pieces) - 25000) < 1e-6);
  });
});
