'use strict';
// Room layers: where a new room goes in `polygons` (index 0 wins the fog).

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const clip = require('polygon-clipping');
const { layerInsertIndex } = require('../src/shapes/roomOps.js');

const CELL = 10;   // sliver floor 100
const rect = (x1, y1, x2, y2) => [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];
const room = (id, verts, extra) => ({ id, vertices: verts, mode: 'shroud', ...extra });
const placed = (list, shape) => {
  const out = list.slice();
  out.splice(layerInsertIndex(list, shape, CELL), 0, Array.isArray(shape) ? room('new', shape) : shape);
  return out.map(r => r.id);
};

describe('layerInsertIndex', () => {
  it('appends a room that touches nothing', () => {
    assert.equal(layerInsertIndex([room(1, rect(0, 0, 50, 50))], rect(100, 100, 150, 150), CELL), 1);
    assert.equal(layerInsertIndex([], rect(0, 0, 10, 10), CELL), 0);
  });

  it('puts a room drawn inside a hall above the hall', () => {
    assert.deepEqual(placed([room('hall', rect(0, 0, 200, 200))], rect(50, 50, 80, 80)), ['new', 'hall']);
  });

  it('puts a hall drawn around closets below every closet, each sharing a different wall', () => {
    const closets = [room('n', rect(80, 0, 120, 30)), room('e', rect(170, 80, 200, 120)),
      room('s', rect(80, 170, 120, 200)), room('w', rect(0, 80, 30, 120))];
    assert.deepEqual(placed(closets, rect(0, 0, 200, 200)), ['n', 'e', 's', 'w', 'new']);
  });

  it('reads a closet a hand-drawn wall overshoots by a sliver as inside', () => {
    const list = [room('closet', rect(150, 50, 201, 100)), room('far', rect(500, 500, 600, 600))];
    assert.deepEqual(placed(list, rect(0, 0, 200, 200)), ['closet', 'far', 'new']);
    // and the closet drawn last, with the same sliver, still goes above the hall
    assert.deepEqual(placed([room('hall', rect(0, 0, 200, 200))], rect(150, 50, 201, 100)), ['new', 'hall']);
  });

  it('puts a room that only partly overlaps another on top of it', () => {
    const list = [room('far', rect(500, 500, 600, 600)), room('a', rect(0, 0, 100, 100))];
    assert.deepEqual(placed(list, rect(50, 50, 150, 150)), ['far', 'new', 'a']);
  });

  it('reads a curved wall as drawn: a closet in the bulge is inside', () => {
    const h = { ix: 0, iy: 0, ox: 0, oy: -40 }, h1 = { ix: 0, iy: -40, ox: 0, oy: 0 };
    const hall = room('hall', rect(0, 0, 100, 100), { handles: [h, h1, null, null] });
    assert.deepEqual(placed([hall], rect(40, -20, 60, -5)), ['new', 'hall']);
  });

  it('a room in a courtyard is not inside the holed room around it, and one on its floor is', () => {
    const keep = room('keep', rect(0, 0, 300, 300), { holes: [rect(100, 100, 200, 200)] });
    assert.equal(layerInsertIndex([keep], rect(120, 120, 180, 180), CELL), 1);
    assert.deepEqual(placed([keep], rect(10, 10, 60, 60)), ['new', 'keep']);
    // and a room drawn round the whole keep goes below it
    assert.deepEqual(placed([keep], rect(-10, -10, 310, 310)), ['keep', 'new']);
  });

  it('keeps a chain of three in order, whichever is drawn last', () => {
    const hall = room('hall', rect(0, 0, 300, 300)), mid = room('mid', rect(50, 50, 200, 200));
    const closet = room('closet', rect(80, 80, 120, 120));
    assert.deepEqual(placed([mid, hall], closet.vertices), ['new', 'mid', 'hall']);
    assert.deepEqual(placed([closet, hall], mid.vertices), ['closet', 'new', 'hall']);
    assert.deepEqual(placed([closet, mid], hall.vertices), ['closet', 'mid', 'new']);
  });

  it('on a legacy map in the wrong order, going below what it contains wins', () => {
    const list = [room('hall', rect(0, 0, 300, 300)), room('closet', rect(80, 80, 120, 120))];
    assert.deepEqual(placed(list, rect(50, 50, 200, 200)), ['hall', 'closet', 'new']);
  });

  it('appends, as before, when the clipping library throws', () => {
    const real = clip.difference;
    clip.difference = () => { throw new Error('boom'); };
    try {
      assert.equal(layerInsertIndex([room('hall', rect(0, 0, 200, 200)), room('far', rect(500, 0, 600, 100))], rect(50, 50, 80, 80), CELL), 2);
    } finally { clip.difference = real; }
  });

  it('a map saved in the old order is left as it is: placing reads it and never reorders it', () => {
    const list = [room('a', rect(0, 0, 100, 100)), room('b', rect(50, 50, 150, 150))];
    const before = JSON.stringify(list);
    layerInsertIndex(list, rect(60, 60, 70, 70), CELL);
    assert.equal(JSON.stringify(list), before);
  });
});

// shapeCommit.js reaches these as bare globals, the way the browser's script order provides them.
global.t = (s, v) => String(s).replace(/\{(\w+)\}/g, (_, k) => v[k]);
global.EFFECT_MATERIALS = {};
global.restoreGroupDetail = require('../src/shapes/shapeDetail.js').restoreGroupDetail;
const { cutRing, trimShapes, joinShapes } = require('../src/shapes/roomOps.js');
const { shapePlanApplied } = require('../src/shapes/shapeCommit.js');

describe('repair pieces keep their parent\'s layer', () => {
  const map = () => [room(1, rect(40, 40, 60, 60)), room(2, rect(0, 0, 200, 100)), room(3, rect(300, 0, 400, 100))];
  const ids = () => { let n = 10; return () => n++; };

  it('a split room\'s other half goes right after it, above what the room was above', () => {
    const list = map();
    const out = cutRing(list[1], [{ x: 100, y: -10 }, { x: 100, y: 110 }], 100);
    assert.equal(out.pieces.length, 2);
    const res = shapePlanApplied(list, [{ shapes: [list[1]], pieces: out.pieces }], null, ids());
    assert.deepEqual(res.list.map(r => r.id), [1, 2, 10, 3]);
  });

  it('a Cut out that leaves two pieces keeps both at the parent\'s layer', () => {
    const list = map();
    const out = trimShapes([list[1]], rect(90, -10, 110, 110), 100);
    const res = shapePlanApplied(list, [{ shapes: [list[1]], pieces: out.groups[0] }], null, ids());
    assert.deepEqual(res.list.map(r => r.id), [1, 2, 10, 3]);
  });

  it('a merge keeps the earliest member\'s slot and drops the others', () => {
    const list = map();
    const hits = [list[1], list[2]];
    const out = joinShapes(hits, rect(150, 20, 350, 80), 100);
    const res = shapePlanApplied(list, [{ shapes: hits, pieces: out.pieces }], 'shroud', ids());
    assert.deepEqual(res.list.map(r => r.id), [1, 2]);
  });
});

const { roomsAt, roomAfter, shapeArea } = require('../src/shapes/shapeHit.js');

describe('a click picks the smallest room, a second click the next one out', () => {
  // the legacy order: the hall first, so it wins the fog, and the closet newest
  const list = [room('hall', rect(0, 0, 300, 300)), room('mid', rect(50, 50, 200, 200)), room('closet', rect(80, 80, 120, 120))];

  it('picks the smallest room under the point, whatever the list order', () => {
    assert.equal(roomsAt(list, 100, 100)[0].id, 'closet');
    assert.equal(roomsAt(list.slice().reverse(), 100, 100)[0].id, 'closet');
    assert.equal(roomsAt(list, 150, 150)[0].id, 'mid');
    assert.deepEqual(roomsAt(list, 400, 400), []);
  });

  it('cycles outward and wraps to the smallest', () => {
    assert.equal(roomAfter(list, 100, 100, 'closet').id, 'mid');
    assert.equal(roomAfter(list, 100, 100, 'mid').id, 'hall');
    assert.equal(roomAfter(list, 100, 100, 'hall').id, 'closet');
    assert.equal(roomAfter(list, 150, 150, 'mid').id, 'hall');
  });

  it('measures floor without holes, and a point in a courtyard is not in the room', () => {
    const keep = room('keep', rect(0, 0, 300, 300), { holes: [rect(10, 10, 290, 290)] });
    assert.equal(shapeArea(keep), 300 * 300 - 280 * 280);
    assert.deepEqual(roomsAt([keep], 150, 150), []);
    // its band is smaller floor than a room filling the courtyard
    assert.equal(roomsAt([room('yard', rect(0, 0, 300, 300)), keep], 5, 5)[0].id, 'keep');
  });

  it('two rooms of one size: the one that wins the fog takes the click', () => {
    assert.equal(roomsAt([room('a', rect(0, 0, 10, 10)), room('b', rect(0, 0, 10, 10))], 5, 5)[0].id, 'a');
  });
});
