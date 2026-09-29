'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { turnVec, containerToView, viewToContainer, turnShape, turnCursor, seatSideways } =
  require('../src/render/mapTurn.js');

const TURNS = [0, 90, 180, 270];
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !== ${b}`);

describe('turnVec', () => {
  it('turns clockwise on a y-down screen, as CSS rotate() does', () => {
    assert.deepEqual(turnVec(1, 0, 90), { x: -0, y: 1 });    // right points down
    assert.deepEqual(turnVec(0, 1, 90), { x: -1, y: 0 });    // down points left
    assert.deepEqual(turnVec(1, 2, 180), { x: -1, y: -2 });
    assert.deepEqual(turnVec(1, 0, 270), { x: 0, y: -1 });   // right points up
  });

  it('leaves a vector alone at 0°', () => {
    assert.deepEqual(turnVec(3, -4, 0), { x: 3, y: -4 });
  });

  it('two turns that add to 360 cancel', () => {
    for (const d of TURNS) {
      const t = turnVec(3, 7, d);
      const back = turnVec(t.x, t.y, (360 - d) % 360);
      near(back.x, 3); near(back.y, 7);
    }
  });
});

describe('containerToView / viewToContainer', () => {
  const CW = 1000, CH = 600;
  const view = d => (seatSideways(d) ? { w: CH, h: CW } : { w: CW, h: CH });

  it('are inverses at every seat', () => {
    for (const d of TURNS) {
      const { w, h } = view(d);
      for (const [px, py] of [[0, 0], [123, 456], [CW, CH], [500, 300]]) {
        const v = containerToView(px, py, d, w, h, CW, CH);
        const c = viewToContainer(v.x, v.y, d, w, h, CW, CH);
        near(c.x, px); near(c.y, py);
      }
    }
  });

  it('keep the centre fixed', () => {
    for (const d of TURNS) {
      const { w, h } = view(d);
      const v = containerToView(CW / 2, CH / 2, d, w, h, CW, CH);
      near(v.x, w / 2); near(v.y, h / 2);
    }
  });

  it('fill the container exactly when sideways', () => {
    // The view's top-left corner lands on the container's top-right at 90°, as rotate(90deg) puts it.
    const v = viewToContainer(0, 0, 90, CH, CW, CW, CH);
    near(v.x, CW); near(v.y, 0);
    const u = viewToContainer(CH, CW, 90, CH, CW, CW, CH);
    near(u.x, 0); near(u.y, CH);
  });

  it('are the identity at 0°', () => {
    assert.deepEqual(containerToView(12, 34, 0, CW, CH, CW, CH), { x: 12, y: 34 });
  });
});

describe('turnShape', () => {
  const room = {
    id: 7, name: 'Hall', cornerRadius: 4, cornerRadii: [1, null, 2],
    vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }],
    holes: [[{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }]],
    handles: [{ ix: 1, iy: 0, ox: 0, oy: 2 }, null, null, null, null, null],
  };

  it('turns vertices, holes and handle offsets alike', () => {
    const t = turnShape(room, 90);
    assert.deepEqual(t.vertices[1], { x: -0, y: 10 });
    assert.deepEqual(t.holes[0][2], { x: -2, y: 2 });
    assert.deepEqual(t.handles[0], { ix: -0, iy: 1, ox: -2, oy: 0 });
    assert.equal(t.handles[1], null);
  });

  it('keeps every other field and leaves the room untouched', () => {
    const t = turnShape(room, 270);
    assert.equal(t.id, 7);
    assert.equal(t.name, 'Hall');
    assert.deepEqual(t.cornerRadii, [1, null, 2]);
    assert.deepEqual(room.vertices[1], { x: 10, y: 0 });
  });
});

describe('turnCursor', () => {
  it('swaps the diagonals only when sideways', () => {
    assert.equal(turnCursor('nwse-resize', 90), 'nesw-resize');
    assert.equal(turnCursor('nesw-resize', 270), 'nwse-resize');
    assert.equal(turnCursor('nwse-resize', 180), 'nwse-resize');
    assert.equal(turnCursor('move', 90), 'move');
  });
});
