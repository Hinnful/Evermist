const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  vttCollectEdges,
  vttBuildNodes,
  vttSplitAtJunctions,
  vttWalkFaces,
  vttCleanRing,
  vttSignedArea,
  vttDoorlessWalls,
  vttDerivePlan,
  VTT_NODE_SNAP,
  VTT_COLLINEAR_EPS,
  VTT_MIN_FACE_AREA,
  VTT_CLOSE_GAP_MAX,
  VTT_CLOSE_PAIR_MAX,
  VTT_OPEN_WALL_MAX_GAP,
  VTT_ROW_BUCKET,
} = require('../src/vttPlan.js');

// ⚠ THE FIXTURE IS A REAL DUNGEON ALCHEMIST EXPORT, and that is the point. Synthetic
// fixtures let a wrong module-text parser pass 77 green tests here once already
// (docs/DECISIONS.md), so the kernel is pinned against real data first and synthetic
// cases only cover edges the real file happens not to contain.
//
// It is the deliberately awkward map: a plain square room, a quarter-circle room, a
// detached round room, and a fourth room with its walls broken open. 21x14 squares at
// 150 px/grid, so 3150x2100 px, matching its sibling .webm exactly.
const FIXTURE = path.join(__dirname, 'fixtures', 'sample-map.dd2vtt');
const raw = fs.readFileSync(FIXTURE, 'utf8');
const plan = () => JSON.parse(raw);

const area = ring => Math.abs(vttSignedArea(ring));
const bbox = ring => ({
  x0: Math.min(...ring.map(p => p.x)), y0: Math.min(...ring.map(p => p.y)),
  x1: Math.max(...ring.map(p => p.x)), y1: Math.max(...ring.map(p => p.y)),
});

describe('vttPlan — the real export', () => {
  it('reads the format the way the app assumes', () => {
    const j = plan();
    assert.equal(j.format, 0.2);
    assert.equal(j.resolution.pixels_per_grid, 150);
    assert.deepEqual(j.resolution.map_size, { x: 21, y: 14 });
    // An empty `image` is what a video-file export writes: the map is the sibling .webm.
    assert.equal(j.image, '');
    // Ordinary furniture does not appear in a props list at all — a fully furnished room
    // produced no such field. Confirms the ban costs nothing on real maps.
    assert.equal(j.objects_line_of_sight, undefined);
  });

  it('derives three rooms and refuses the broken one', () => {
    const { rooms, boundaries } = vttDerivePlan(plan());
    assert.equal(rooms.length, 3);
    // Two detached islands: the house and the round room, one boundary each.
    assert.equal(boundaries.length, 2);
  });

  it('closes what it can and still refuses a wall that is simply absent', () => {
    const { rooms, closedGaps, openWalls } = vttDerivePlan(plan());
    // Three bridges get built and NO loose end survives them.
    assert.equal(closedGaps.length, 3);
    assert.deepEqual(openWalls, []);
    // And yet the broken room does not come back, which is correct: it is missing a whole
    // wall rather than a panel, so there is no pair of ends to join. Bridging cannot invent
    // a wall out of nothing, and the two triangles it does chip off a corner are refused by
    // the minimum room size.
    assert.equal(rooms.length, 3);
    for (const r of rooms) assert.ok(area(r) / (150 * 150) > 20, 'no slivers among the rooms');
  });

  it('keeps curves as hand-editable vertex counts', () => {
    const { rooms } = vttDerivePlan(plan());
    // The plain room is exactly four corners; the curved ones arrive at 15-16 vertices,
    // which the existing vertex handles can be dragged. A larger collinear epsilon would
    // flatten the arcs, a smaller one would leave the T-junction splits in.
    assert.deepEqual(rooms.map(r => r.length), [4, 15, 16]);
  });

  it('the plain room is a square in map pixels', () => {
    const { rooms } = vttDerivePlan(plan());
    const b = bbox(rooms[0]);
    assert.equal(Math.round(b.x1 - b.x0), 942);
    assert.equal(Math.round(b.y1 - b.y0), 942);
    // A true rectangle, so its area fills its own bounding box.
    assert.equal(Math.round(area(rooms[0])), 942 * 942);
  });

  it('every room lands inside the map', () => {
    const j = plan();
    const w = j.resolution.map_size.x * j.resolution.pixels_per_grid;
    const h = j.resolution.map_size.y * j.resolution.pixels_per_grid;
    for (const room of vttDerivePlan(j).rooms) {
      for (const p of room) {
        assert.ok(p.x >= 0 && p.x <= w, `x ${p.x} outside 0..${w}`);
        assert.ok(p.y >= 0 && p.y <= h, `y ${p.y} outside 0..${h}`);
      }
    }
  });

  it('classifies by winding, so no boundary is returned as a room', () => {
    const { rooms, boundaries } = vttDerivePlan(plan());
    for (const r of rooms) assert.ok(vttSignedArea(r) > 0, 'rooms wind one way');
    for (const b of boundaries) assert.ok(vttSignedArea(b) < 0, 'boundaries the other');
    // The house boundary is NOT the largest-area face by a comfortable margin — it is
    // 1.44M px2 against a 0.89M room — so an area-based rule would look fine here and
    // still break on a map whose second building is smaller than a first-building room.
    const house = boundaries.find(b => bbox(b).x0 < 1000);
    assert.ok(area(house) > area(rooms[0]));
    // Zero-thickness centrelines, so the boundary encloses its own rooms and nothing extra
    // beyond the corner triangles the gap closing chipped off.
    const inHouse = rooms.filter(r => bbox(r).x0 < 2000);
    assert.ok(area(house) >= inHouse.reduce((s, r) => s + area(r), 0));
    assert.ok(area(house) / inHouse.reduce((s, r) => s + area(r), 0) < 1.05);
  });

  it('reports a gap position as integers a person could go and look at', () => {
    const { closedGaps } = vttDerivePlan(plan());
    for (const w of closedGaps) {
      assert.ok(Number.isInteger(w.x) && Number.isInteger(w.y));
      assert.ok(w.gapPx > 0 && w.gapPx <= VTT_CLOSE_GAP_MAX * 150);
      // All of them sit in the lower-left quarter, where the broken room is.
      assert.ok(w.x < 1200 && w.y > 1000);
    }
  });

  it('orders rooms in rows, then left to right', () => {
    const { rooms } = vttDerivePlan(plan());
    const cy = r => r.reduce((s, p) => s + p.y, 0) / r.length;
    const cx = r => r.reduce((s, p) => s + p.x, 0) / r.length;
    for (let i = 1; i < rooms.length; i++) {
      const dy = cy(rooms[i]) - cy(rooms[i - 1]);
      const sameRow = Math.abs(dy) <= VTT_ROW_BUCKET * 150;
      assert.ok(sameRow ? cx(rooms[i]) > cx(rooms[i - 1]) : dy > 0);
    }
  });

  it('splits T-junctions, or the face walk has nowhere to turn', () => {
    const j = plan();
    const edges = vttCollectEdges(j);
    const { nodes, pairs } = vttBuildNodes(edges, VTT_NODE_SNAP);
    const split = vttSplitAtJunctions(nodes, pairs, VTT_NODE_SNAP);
    assert.ok(split.length > pairs.length, 'a real map always has at least one T-junction');
    // A wall abutting another mid-span is the normal way DA rooms share a wall, and the
    // walk cannot turn at a junction the graph does not know about. Skipping the step
    // costs a real room on this map.
    const roomsFrom = es => vttWalkFaces(nodes, es)
      .map(f => vttCleanRing(f.map(i => nodes[i])))
      .filter(r => r.length >= 3 && vttSignedArea(r) >= VTT_MIN_FACE_AREA).length;
    assert.equal(roomsFrom(pairs), 2);
    assert.equal(roomsFrom(split), 3);
  });

  it('unions the portals in — walls alone are not a closed plan', () => {
    const j = plan();
    assert.ok(j.portals.length > 0);
    const wallsOnly = vttDerivePlan({ ...j, portals: [] });
    assert.ok(wallsOnly.rooms.length < 3, 'every doorway is a hole without its portal');
  });
});

// ⚠ THE SECOND REAL EXPORT, and the one that broke the feature. A cave complex with
// buildings standing inside it: continuous cavern, three freestanding rock formations, and
// rooms that open onto the cave with no wall between. Its `image` is blanked — the export
// embeds a 9MB base64 JPEG that nothing here reads.
const CAVE = path.join(__dirname, 'fixtures', 'cave-map.dd2vtt');
const caveRaw = fs.readFileSync(CAVE, 'utf8');
const cave = () => JSON.parse(caveRaw);

describe('vttPlan — the cave export', () => {
  it('reads a much larger plan than the interior map', () => {
    const j = cave();
    assert.equal(j.format, 0.2);
    assert.deepEqual(j.resolution.map_size, { x: 65, y: 39 });
    assert.equal(j.resolution.pixels_per_grid, 150);
    assert.equal(j.line_of_sight.length, 351);
    assert.equal(j.portals.length, 25);
    assert.equal(j.objects_line_of_sight, undefined);
  });

  it('draws only the buildings, and nothing false', () => {
    const { rooms, refusedSolid } = vttDerivePlan(cave());
    // Thirteen building interiors, hand-checked against the render. The cavern and the
    // three rock formations are gone.
    assert.equal(rooms.length, 13);
    assert.equal(refusedSolid, 4);
  });

  // ⚠ THE TWO ROOMS THAT FRONT ONTO THE CAVE. Both have one whole side open to the cavern —
  // 18 ft and 22 ft — and both were lost until wall stubs stopped bridging into rock. Their
  // ends are 3.7 and 4.3 squares apart, so they also need the wider mutual-pair reach.
  it('closes the rooms whose open side faces the cave', () => {
    const sq = r => area(r) / (150 * 150);
    const rooms = vttDerivePlan(cave()).rooms;
    assert.ok(rooms.some(r => Math.abs(sq(r) - 80.4) < 0.5), 'the crypt');
    assert.ok(rooms.some(r => Math.abs(sq(r) - 61.2) < 0.5), 'the store room');
    // Both arrive chamfered across the mouth rather than as a ragged outline.
    for (const r of rooms) assert.ok(r.length <= 40);
  });

  it('the cavern itself never becomes a room', () => {
    const { rooms } = vttDerivePlan(cave());
    const sq = r => area(r) / (150 * 150);
    // The cavern measured 1636 squares — 64% of the map — and wrapped around every
    // building inside it, so revealing it revealed them too. The largest real room is 103.
    assert.ok(Math.max(...rooms.map(sq)) < 150, 'nothing map-sized survives');
    for (const r of rooms) assert.ok(bbox(r).x1 - bbox(r).x0 < 65 * 150 * 0.5);
  });

  it('the filter is what removes them, not the rest of the kernel', () => {
    // Pins the cost of the rule in both directions: turn it off and the six bad faces are
    // straight back, which is what shipped in 1.7.0 and what "went to hell" on this map.
    const off = vttDerivePlan(cave(), { keepDoorless: true });
    assert.equal(off.rooms.length, 16);
    assert.ok(off.rooms.some(r => area(r) / (150 * 150) > 1000), 'the cavern is one of them');
  });
});

describe('vttPlan — doorless walls are solid', () => {
  it('finds them on the cave map and none at all on the interior map', () => {
    assert.equal(vttDoorlessWalls(plan()).length, 0);
    assert.ok(vttDoorlessWalls(cave()).length > 0);
    // Which is why the interior map's result is untouched by the whole rule.
    assert.equal(vttDerivePlan(plan()).rooms.length, 3);
    assert.equal(vttDerivePlan(plan()).refusedSolid, 0);
  });

  // A closed box standing on its own, with no way in. On a cave map this is a rock.
  function sealedBox(x, y) {
    return [
      [{ x: x, y: y }, { x: x + 2, y: y }], [{ x: x + 2, y: y }, { x: x + 2, y: y + 2 }],
      [{ x: x + 2, y: y + 2 }, { x: x, y: y + 2 }], [{ x: x, y: y + 2 }, { x: x, y: y }],
    ];
  }
  const bare = walls => ({
    resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 12, y: 12 }, pixels_per_grid: 100 },
    line_of_sight: walls, portals: [],
  });

  it('a sealed structure touching nothing is refused', () => {
    const r = vttDerivePlan(bare(sealedBox(2, 2)));
    assert.equal(r.rooms.length, 0);
    assert.equal(r.refusedSolid, 1);
  });

  it('one door anywhere on the run spares all of it', () => {
    const p = bare([
      [{ x: 2, y: 2 }, { x: 3, y: 2 }], [{ x: 3.5, y: 2 }, { x: 4, y: 2 }],
      [{ x: 4, y: 2 }, { x: 4, y: 4 }], [{ x: 4, y: 4 }, { x: 2, y: 4 }],
      [{ x: 2, y: 4 }, { x: 2, y: 2 }],
    ]);
    p.portals = [{ bounds: [{ x: 3, y: 2 }, { x: 3.5, y: 2 }] }];
    assert.equal(vttDerivePlan(p).rooms.length, 1);
  });

  // ⚠ THE ATTIC QUESTION. A cellar with a teleport circle, a prison cell, a windowless
  // vault: none of them has a door of its own, and all of them are kept — because the rule
  // judges a whole connected run of walls, and these share their building's walls and so
  // its doors. Only a structure isolated from everything else is refused.
  it('a sealed room built against a doored building is kept', () => {
    const p = bare([
      [{ x: 1, y: 1 }, { x: 6, y: 1 }], [{ x: 6, y: 1 }, { x: 6, y: 6 }],
      [{ x: 6, y: 6 }, { x: 1, y: 6 }], [{ x: 1, y: 6 }, { x: 1, y: 1 }],
      // The vault: three walls, the fourth being the building's own left wall.
      [{ x: 1, y: 2 }, { x: 3, y: 2 }], [{ x: 3, y: 2 }, { x: 3, y: 4 }],
      [{ x: 3, y: 4 }, { x: 1, y: 4 }],
    ]);
    p.portals = [{ bounds: [{ x: 3, y: 1 }, { x: 4, y: 1 }] }];   // the front door
    const { rooms, refusedSolid } = vttDerivePlan(p);
    assert.equal(refusedSolid, 0);
    assert.equal(rooms.length, 2, 'the vault and the rest of the building');
    assert.ok(rooms.some(r => Math.round(area(r)) === 2 * 2 * 100 * 100), 'the vault survives');
  });

  // ⚠ A ROCK MUST NOT STEAL A WALL STUB. A room open on one side, with a rock formation
  // sitting nearer to each stub than the stub's real partner across the opening. Bridging
  // into the rock glues the wall to it, achieves nothing, and consumes the end — so the two
  // ends never find each other and the room is lost into the cave.
  it('a wall stub never bridges into rock', () => {
    const walls = [
      [{ x: 4, y: 2 }, { x: 8, y: 2 }], [{ x: 8, y: 2 }, { x: 8, y: 6 }],
      [{ x: 8, y: 6 }, { x: 4, y: 6 }],
      [{ x: 4, y: 6 }, { x: 4, y: 5 }], [{ x: 4, y: 2 }, { x: 4, y: 3 }],   // a 2-square mouth
      ...sealedBox(1, 2.5),                                                 // rock, 1 square off
    ];
    const p = { ...bare(walls), portals: [{ bounds: [{ x: 6, y: 2 }, { x: 7, y: 2 }] }] };
    const { rooms, refusedSolid } = vttDerivePlan(p);
    assert.equal(refusedSolid, 1, 'the rock is refused');
    assert.equal(rooms.length, 1, 'and the room it would have stolen from survives');
    assert.ok(area(rooms[0]) / (100 * 100) > 14, 'as the whole room, not a fragment');
  });

  it('a mutual pair of ends reaches further than a stub reaching for a wall', () => {
    // 4 squares apart: past VTT_CLOSE_GAP_MAX, inside VTT_CLOSE_PAIR_MAX.
    const p = bare([
      [{ x: 1, y: 1 }, { x: 2, y: 1 }], [{ x: 6, y: 1 }, { x: 7, y: 1 }],
      [{ x: 7, y: 1 }, { x: 7, y: 5 }], [{ x: 7, y: 5 }, { x: 1, y: 5 }],
      [{ x: 1, y: 5 }, { x: 1, y: 1 }],
    ]);
    p.portals = [{ bounds: [{ x: 3, y: 5 }, { x: 4, y: 5 }] }];
    assert.equal(vttDerivePlan(p).rooms.length, 1, 'the pair bridges');
    // Tightening the base ceiling tightens the pair with it, so "closing off" means off.
    assert.equal(vttDerivePlan(p, { closeGapMax: 0 }).rooms.length, 0);
  });

  // The accepted cost, stated as a test so nobody has to rediscover it. A whole floor that
  // is one sealed room comes back empty rather than wrong.
  it('a building with no door at all comes back empty', () => {
    const p = bare([
      [{ x: 1, y: 1 }, { x: 6, y: 1 }], [{ x: 6, y: 1 }, { x: 6, y: 6 }],
      [{ x: 6, y: 6 }, { x: 1, y: 6 }], [{ x: 1, y: 6 }, { x: 1, y: 1 }],
    ]);
    assert.deepEqual(vttDerivePlan(p).rooms, []);
  });
});

describe('vttPlan — the map_origin term', () => {
  it('subtracts a non-zero origin before scaling', () => {
    const base = vttDerivePlan(plan());
    const shifted = plan();
    shifted.resolution.map_origin = { x: 2, y: 3 };
    const moved = vttDerivePlan(shifted);
    assert.equal(moved.rooms.length, base.rooms.length);
    // Omitting the term leaves every room correctly SHAPED and uniformly displaced,
    // which is silent on a zero-origin export and wrong on any other.
    for (let r = 0; r < base.rooms.length; r++) {
      for (let i = 0; i < base.rooms[r].length; i++) {
        assert.ok(Math.abs((base.rooms[r][i].x - 2 * 150) - moved.rooms[r][i].x) < 1e-6);
        assert.ok(Math.abs((base.rooms[r][i].y - 3 * 150) - moved.rooms[r][i].y) < 1e-6);
      }
    }
  });

  it('applies it to the gap reports as well', () => {
    const base = vttDerivePlan(plan());
    const shifted = plan();
    shifted.resolution.map_origin = { x: 1, y: 1 };
    const moved = vttDerivePlan(shifted);
    assert.ok(base.closedGaps.length > 0);
    assert.equal(moved.closedGaps[0].x, base.closedGaps[0].x - 150);
    assert.equal(moved.closedGaps[0].y, base.closedGaps[0].y - 150);
    // A width is a distance, so the origin must NOT move it.
    assert.equal(moved.closedGaps[0].gapPx, base.closedGaps[0].gapPx);
  });
});

// A square room, split down the middle into two. Grid squares, walls only where a real
// export would put them.
function twoRoomPlan() {
  const seg = (x1, y1, x2, y2) => [{ x: x1, y: y1 }, { x: x2, y: y2 }];
  return {
    format: 0.2,
    resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 8, y: 6 }, pixels_per_grid: 100 },
    line_of_sight: [
      seg(1, 1, 7, 1), seg(7, 1, 7, 5), seg(7, 5, 1, 5), seg(1, 5, 1, 1),  // outer
      seg(4, 1, 4, 5),                                                     // the divider
    ],
    portals: [],
    lights: [],
    image: '',
  };
}

// A 2x1 detached outbuilding with its top-left corner at (x, y), and the door that makes it
// a building rather than a lump of rock. ⚠ THE DOOR IS LOAD-BEARING IN THESE TESTS: a wall
// run that closes on itself with no portal anywhere is refused as solid, so a doorless shed
// would never reach the assertion it is standing in for.
function shedWalls(x, y) {
  return [
    [{ x: x, y: y }, { x: x + 1, y: y }], [{ x: x + 1.5, y: y }, { x: x + 2, y: y }],
    [{ x: x + 2, y: y }, { x: x + 2, y: y + 1 }],
    [{ x: x + 2, y: y + 1 }, { x: x, y: y + 1 }], [{ x: x, y: y + 1 }, { x: x, y: y }],
  ];
}
function shedDoor(x, y) {
  return { bounds: [{ x: x + 1, y: y }, { x: x + 1.5, y: y }] };
}

describe('vttPlan — synthetic edge cases', () => {
  it('two rooms sharing a wall, ordered left to right', () => {
    const { rooms, boundaries, openWalls } = vttDerivePlan(twoRoomPlan());
    assert.equal(rooms.length, 2);
    assert.equal(boundaries.length, 1);
    assert.deepEqual(openWalls, []);
    assert.equal(Math.round(area(rooms[0])), 3 * 4 * 100 * 100);
    assert.ok(bbox(rooms[0]).x0 < bbox(rooms[1]).x0);
  });

  // A one-square hole in an otherwise closed wall: the missing panel, or the archway with no
  // door. This is the case gap closing exists for, and the common one on a real map.
  function brokenPanelPlan() {
    const p = twoRoomPlan();
    p.line_of_sight[0] = [{ x: 1, y: 1 }, { x: 5, y: 1 }];
    p.line_of_sight.push([{ x: 6, y: 1 }, { x: 7, y: 1 }]);
    return p;
  }

  it('a broken wall gets bridged and the room comes back', () => {
    const { rooms, closedGaps, openWalls } = vttDerivePlan(brokenPanelPlan());
    assert.equal(rooms.length, 2, 'the room is drawable again');
    assert.deepEqual(openWalls, []);
    assert.equal(closedGaps.length, 1);
    assert.equal(closedGaps[0].gapPx, 100);
    // Recorded at the middle of the bridge, in map pixels.
    assert.equal(closedGaps[0].x, 550);
    assert.equal(closedGaps[0].y, 100);
    // The bridged room is the full room, not a room minus the gap.
    assert.equal(Math.round(area(rooms[1])), 3 * 4 * 100 * 100);
  });

  it('without closing, the same break still costs the room', () => {
    // Pins WHAT the closing buys: turn it off and the old behaviour is back.
    const off = vttDerivePlan(brokenPanelPlan(), { closeGapMax: 0 });
    assert.equal(off.rooms.length, 1);
    assert.deepEqual(off.closedGaps, []);
    assert.equal(off.openWalls.length, 1);
  });

  it('a gap too wide to bridge is left alone', () => {
    const p = twoRoomPlan();
    p.line_of_sight.splice(4, 1);              // no divider, so nothing else to bridge to
    // Deepened, so the far wall is not the nearest thing to either end and the two ends are
    // each other's partner — the case the pair ceiling governs.
    p.line_of_sight[1] = [{ x: 7, y: 1 }, { x: 7, y: 9 }];
    p.line_of_sight[2] = [{ x: 7, y: 9 }, { x: 1, y: 9 }];
    p.line_of_sight[3] = [{ x: 1, y: 9 }, { x: 1, y: 1 }];
    p.line_of_sight[0] = [{ x: 1, y: 1 }, { x: 1.2, y: 1 }];
    // A 5.6-square hole: past even the reach a mutual pair of ends is allowed.
    p.line_of_sight.push([{ x: 6.8, y: 1 }, { x: 7, y: 1 }]);
    const { rooms, closedGaps, openWalls } = vttDerivePlan(p);
    assert.deepEqual(closedGaps, []);
    assert.equal(rooms.length, 0, 'refusing the room is the right failure');
    assert.equal(openWalls.length, 1);
    assert.equal(openWalls[0].gapPx, 560);
  });

  it('a corner short of its join is chamfered, not slivered', () => {
    const p = twoRoomPlan();
    p.line_of_sight[1] = [{ x: 7, y: 1.8 }, { x: 7, y: 5 }];   // right wall starts low
    const { rooms, closedGaps } = vttDerivePlan(p);
    assert.equal(closedGaps.length, 1);
    assert.equal(rooms.length, 2);
    // The chamfer costs a corner, not a room: still essentially the full 3x4 area.
    assert.ok(area(rooms[1]) / (3 * 4 * 100 * 100) > 0.97);
  });

  it('a portal closes a doorway that walls leave open', () => {
    const p = twoRoomPlan();
    p.line_of_sight[4] = [{ x: 4, y: 1 }, { x: 4, y: 2.5 }];
    p.line_of_sight.push([{ x: 4, y: 3.5 }, { x: 4, y: 5 }]);
    // Judged with gap closing OFF, so this pins the PORTALS rather than the bridging: a
    // doorway with no portal is a hole in the divider and the two rooms merge into one.
    assert.equal(vttDerivePlan(p, { closeGapMax: 0 }).rooms.length, 1);
    p.portals = [{ bounds: [{ x: 4, y: 2.5 }, { x: 4, y: 3.5 }] }];
    const withPortal = vttDerivePlan(p, { closeGapMax: 0 });
    assert.equal(withPortal.rooms.length, 2, 'the portal fills it exactly');
    assert.deepEqual(withPortal.closedGaps, [], 'and nothing had to be invented');
  });

  it('never reads objects_line_of_sight', () => {
    const p = twoRoomPlan();
    // A pillar standing in the middle of the left room. Unioning it in would turn the
    // room into a ring plus a fake little room.
    p.objects_line_of_sight = [[
      { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 3 }, { x: 2, y: 3 }, { x: 2, y: 2 },
    ]];
    const withProp = vttDerivePlan(p);
    assert.equal(withProp.rooms.length, 2);
    assert.deepEqual(withProp, vttDerivePlan(twoRoomPlan()));
  });

  it('a detached second building keeps its own boundary', () => {
    const p = twoRoomPlan();
    p.line_of_sight.push(...shedWalls(10, 1));
    p.portals.push(shedDoor(10, 1));
    const { rooms, boundaries } = vttDerivePlan(p);
    assert.equal(rooms.length, 3);
    assert.equal(boundaries.length, 2);
    // The shed's own boundary is SMALLER than a room in the first building, which is
    // exactly the arrangement that breaks an area-based classifier.
    const shed = boundaries.find(b => bbox(b).x0 >= 1000);
    assert.ok(area(shed) < area(rooms[0]));
  });
});

describe('vttPlan — refusing rather than guessing', () => {
  const empties = {
    'no plan at all': null,
    'a string': 'not an object',
    'an empty object': {},
    'no resolution': { line_of_sight: [[{ x: 0, y: 0 }, { x: 1, y: 1 }]] },
    'no pixels_per_grid': { resolution: {}, line_of_sight: [[{ x: 0, y: 0 }, { x: 1, y: 0 }]] },
    'no walls': { resolution: { pixels_per_grid: 100 }, line_of_sight: [], portals: [] },
    'one lone wall': {
      resolution: { pixels_per_grid: 100 },
      line_of_sight: [[{ x: 0, y: 0 }, { x: 3, y: 0 }]],
    },
  };
  for (const [label, input] of Object.entries(empties)) {
    it(`returns empty arrays for ${label}`, () => {
      const r = vttDerivePlan(input);
      assert.deepEqual(r.rooms, []);
      assert.deepEqual(r.boundaries, []);
      assert.deepEqual(r.openWalls, []);
    });
  }

  it('survives coordinates that are not numbers', () => {
    const p = twoRoomPlan();
    p.line_of_sight.push([{ x: NaN, y: 2 }, { x: 3, y: undefined }], null, [{ x: 1 }]);
    p.portals.push(null, { bounds: null });
    assert.equal(vttDerivePlan(p).rooms.length, 2);
  });

  it('a lone freestanding wall is neither bridged nor reported', () => {
    const p = twoRoomPlan();
    // Out in the open, so both its ends are loose and neither broke a room. Bridging one to
    // the house would invent a wall across open ground.
    p.line_of_sight.push([{ x: 14, y: 3 }, { x: 16, y: 3 }]);
    const r = vttDerivePlan(p);
    assert.deepEqual(r.closedGaps, []);
    assert.deepEqual(r.openWalls, []);
    assert.equal(r.rooms.length, 2, 'and it does not disturb the real rooms');
  });

  // Parsing is the CALLER's job — floorPlan.js wraps JSON.parse so a truncated file
  // behaves exactly like no plan at all. The kernel never sees text.
  it('takes a parsed object, never JSON text', () => {
    assert.deepEqual(vttDerivePlan('{"resolution":{"pixels_per_grid":100}}').rooms, []);
  });
});

describe('vttPlan — the tolerances', () => {
  // Every one of these is resolution-independent because it is in GRID SQUARES. Pinned so
  // a change is a deliberate edit with a failing test, not a silent retune.
  it('holds the tuned values', () => {
    assert.equal(VTT_NODE_SNAP, 0.02);
    assert.equal(VTT_COLLINEAR_EPS, 0.002);
    assert.equal(VTT_MIN_FACE_AREA, 0.9);
    assert.equal(VTT_CLOSE_GAP_MAX, 2.5);
    assert.equal(VTT_CLOSE_PAIR_MAX, 5);
    assert.equal(VTT_OPEN_WALL_MAX_GAP, 6);
    assert.equal(VTT_ROW_BUCKET, 2);
    // A mutual pair of ends is better evidence than a stub reaching for a wall, so it is
    // allowed to reach further — never less far.
    assert.ok(VTT_CLOSE_PAIR_MAX > VTT_CLOSE_GAP_MAX);
    // The report ceiling must stay above the WIDEST thing closing bridges, or there is
    // never anything left for it to describe.
    assert.ok(VTT_OPEN_WALL_MAX_GAP > VTT_CLOSE_PAIR_MAX);
  });

  it('the node snap closes endpoints that miss each other', () => {
    // HONEST NOTE: on this export the shared wall/portal endpoints are bit-identical, so
    // the snap is insurance rather than load-bearing here. It is pinned against jitter
    // instead of against the fixture, because one export is not evidence that every
    // export is exact — and a snap of zero would turn a rounding difference in the last
    // decimal into a lost room with no error.
    // Judged with gap closing OFF: bridging would paper over a failed snap, and then this
    // would be testing the bridge instead of the snap.
    const jitter = d => {
      const p = twoRoomPlan();
      p.line_of_sight[1] = [{ x: 7 + d, y: 1 + d }, { x: 7, y: 5 }];   // corner misses by d
      return vttDerivePlan(p, { closeGapMax: 0 }).rooms.length;
    };
    assert.equal(jitter(0), 2);
    assert.equal(jitter(VTT_NODE_SNAP / 4), 2, 'a near miss still closes the room');
    assert.equal(jitter(0.5), 1, 'a real gap is still a real gap');
    // Wide enough to be well clear of float noise, thin enough not to merge two distinct
    // corners of the same wall.
    assert.ok(VTT_NODE_SNAP > 1e-5 && VTT_NODE_SNAP < 0.15);
    // Loosened far enough it deforms the rooms rather than losing them: distinct corners
    // collapse into one, so a curve arrives with fewer vertices than it has.
    const coarse = vttDerivePlan(plan(), { nodeSnap: 1 }).rooms.map(r => r.length);
    assert.notDeepEqual(coarse, [4, 15, 16]);
  });

  it('the collinear epsilon keeps arcs curved', () => {
    const j = plan();
    const counts = e => vttDerivePlan(j, { collinearEps: e }).rooms.map(r => r.length);
    // The T-junction splits it has to remove are EXACTLY collinear, so only float noise
    // sets the floor; the sagitta of DA's arc tessellation sets the ceiling. Measured on
    // this map the safe band is 0.0005 to 0.05 squares, and the tuned value sits inside it
    // with two orders of magnitude of clearance below.
    for (const e of [0.0005, VTT_COLLINEAR_EPS, 0.05]) assert.deepEqual(counts(e), [4, 15, 16]);
    // Past the ceiling, arcs flatten into straight lines and the rooms lose their shape.
    const coarse = counts(0.2);
    assert.ok(coarse[1] < 15 && coarse[2] < 16);
  });

  it('the minimum face area discards slivers, not closets', () => {
    // A real 5ft closet measures slightly OVER one square, because the polygon follows wall
    // centrelines and carries half a wall on each side. So the threshold sits just under 1.
    assert.ok(VTT_MIN_FACE_AREA < 1);
    const j = plan();
    // At the tuned value the corner triangles gap closing chips off are gone; drop it and
    // they come back as two 0.55-square "rooms".
    assert.equal(vttDerivePlan(j).rooms.length, 3);
    assert.equal(vttDerivePlan(j, { minFaceArea: 0.1 }).rooms.length, 5);
    // Raising it past a real room's size starts refusing real rooms, which is the direction
    // this dial fails in.
    assert.ok(vttDerivePlan(j, { minFaceArea: 100 }).rooms.length < 3);
  });

  it('the close-gap ceiling is what decides a break from a coincidence', () => {
    const p = twoRoomPlan();
    p.line_of_sight.splice(4, 1);
    p.line_of_sight[0] = [{ x: 1, y: 1 }, { x: 3, y: 1 }];
    p.line_of_sight.push([{ x: 5, y: 1 }, { x: 7, y: 1 }]);   // a 2-square hole
    assert.equal(vttDerivePlan(p).rooms.length, 1, 'under the ceiling, so it closes');
    // Tightened below the hole, the room is refused rather than guessed at.
    const tight = vttDerivePlan(p, { closeGapMax: 1 });
    assert.equal(tight.rooms.length, 0);
    assert.equal(tight.openWalls.length, 1);
  });

  it('the row bucket groups rooms into rows', () => {
    const p = twoRoomPlan();
    // A third room below and to the left of the other two.
    p.line_of_sight.push(...shedWalls(1, 8));
    p.portals.push(shedDoor(1, 8));
    const first = r => bbox(r).y0;
    const rooms = vttDerivePlan(p).rooms;
    assert.equal(rooms.length, 3);
    assert.ok(first(rooms[2]) > first(rooms[0]), 'the lower room comes last');
    // A bucket tall enough to swallow the whole map degrades to one row, left to right.
    const oneRow = vttDerivePlan(p, { rowBucket: 100 }).rooms;
    for (let i = 1; i < oneRow.length; i++) assert.ok(bbox(oneRow[i]).x0 >= bbox(oneRow[i - 1]).x0);
  });
});
