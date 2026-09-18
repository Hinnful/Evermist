'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  matTranslate, matRotate, applyMat, applyMatVec,
  boxFromPoints, boxSidePoint, boxSidePoints, boxCentre, boxScaleFactors,
  boxScaleMatrix, boxRotateMatrix, snapAngle, transformRing, transformHandle,
  BOX_SIDES, BOX_MIN_SPAN,
} = require('../src/shapes/shapeBox.js');

const rect = (x1, y1, x2, y2) =>
  [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const ptNear = (p, x, y, eps = 1e-9) =>
  assert.ok(near(p.x, x, eps) && near(p.y, y, eps),
            'expected (' + x + ',' + y + '), got (' + p.x + ',' + p.y + ')');

describe('the box', () => {
  it('wraps the points it is given', () => {
    const b = boxFromPoints(rect(10, 20, 50, 80));
    assert.deepEqual(b, { minX: 10, minY: 20, maxX: 50, maxY: 80 });
  });

  it('refuses fewer than three points, because two make no shape', () => {
    assert.equal(boxFromPoints([{ x: 0, y: 0 }, { x: 4, y: 4 }]), null);
    assert.equal(boxFromPoints(null), null);
  });

  it('puts eight handles on the corners and the side middles', () => {
    const b = boxFromPoints(rect(0, 0, 100, 60));
    assert.deepEqual(boxSidePoints(b).map(p => p.name), BOX_SIDES);
    // y grows downward, so 'n' is the low edge.
    ptNear(boxSidePoint(b, 'nw'), 0, 0);
    ptNear(boxSidePoint(b, 'n'), 50, 0);
    ptNear(boxSidePoint(b, 'ne'), 100, 0);
    ptNear(boxSidePoint(b, 'e'), 100, 30);
    ptNear(boxSidePoint(b, 'se'), 100, 60);
    ptNear(boxSidePoint(b, 's'), 50, 60);
    ptNear(boxSidePoint(b, 'sw'), 0, 60);
    ptNear(boxSidePoint(b, 'w'), 0, 30);
    ptNear(boxCentre(b), 50, 30);
  });
});

describe('scaling', () => {
  const b = boxFromPoints(rect(0, 0, 100, 100));

  it('pins the opposite corner', () => {
    const f = boxScaleFactors(b, 'se', { x: 200, y: 150 }, false);
    assert.equal(f.ax, 0);
    assert.equal(f.ay, 0);
    assert.ok(near(f.sx, 2));
    assert.ok(near(f.sy, 1.5));
  });

  it('pins the opposite side, and a side handle moves one axis alone', () => {
    const f = boxScaleFactors(b, 'e', { x: 50, y: 999 }, false);
    assert.equal(f.ax, 0);
    assert.ok(near(f.sx, 0.5));
    assert.equal(f.sy, 1);   // the cursor's y is ignored on an east handle
  });

  it('holds proportion when Shift is down, taking the larger factor', () => {
    const f = boxScaleFactors(b, 'se', { x: 200, y: 150 }, true);
    assert.ok(near(f.sx, 2));
    assert.ok(near(f.sy, 2));
  });

  it('leaves a side handle alone under Shift, having only one axis to hold', () => {
    const f = boxScaleFactors(b, 's', { x: 0, y: 300 }, true);
    assert.equal(f.sx, 1);
    assert.ok(near(f.sy, 3));
  });

  // Dragging past the anchor would mirror the shape, and a mirrored ring reverses its winding.
  it('never goes negative, whatever the cursor does', () => {
    const f = boxScaleFactors(b, 'se', { x: -400, y: -400 }, false);
    assert.ok(f.sx > 0 && f.sy > 0);
    assert.ok(near(f.sx, BOX_MIN_SPAN / 100));
    assert.ok(near(f.sy, BOX_MIN_SPAN / 100));
  });

  it('moves the ring and holds the anchor still', () => {
    const f = boxScaleFactors(b, 'se', { x: 200, y: 200 }, false);
    const out = transformRing(rect(0, 0, 100, 100), boxScaleMatrix(f));
    ptNear(out[0], 0, 0);        // nw, the anchor
    ptNear(out[2], 200, 200);    // se, now under the cursor
  });
});

describe('rotating', () => {
  it('turns a ring a quarter turn about the box centre', () => {
    const b = boxFromPoints(rect(0, 0, 100, 100));
    const out = transformRing(rect(0, 0, 100, 100),
                              boxRotateMatrix(boxCentre(b), Math.PI / 2));
    // The corners walk round one place; the box is unchanged, which is what makes a square square.
    ptNear(out[0], 100, 0, 1e-9);
    ptNear(out[1], 100, 100, 1e-9);
    assert.deepEqual(boxFromPoints(out).minX, 0);
  });

  it('snaps to fifteen degrees', () => {
    const step = Math.PI / 12;
    assert.ok(near(snapAngle(0.30, 15), step));       // 17.2 deg -> 15
    assert.ok(near(snapAngle(-0.30, 15), -step));
    assert.equal(snapAngle(0.02, 15), 0);
  });
});

describe('a curve handle through a transform', () => {
  const h = { ix: -10, iy: 0, ox: 10, oy: 0 };

  // It is an offset from its anchor, so the anchor's own move must not be added to it twice.
  it('ignores a pure translation', () => {
    const out = transformHandle(h, matTranslate(500, -300));
    assert.deepEqual(out, { ix: -10, iy: 0, ox: 10, oy: 0 });
  });

  it('turns with a rotation', () => {
    const out = transformHandle(h, matRotate(Math.PI / 2));
    ptNear({ x: out.ox, y: out.oy }, 0, 10, 1e-9);
    ptNear({ x: out.ix, y: out.iy }, 0, -10, 1e-9);
  });

  it('stays on its wall through a scale', () => {
    const b = boxFromPoints(rect(0, 0, 100, 100));
    const m = boxScaleMatrix(boxScaleFactors(b, 'se', { x: 200, y: 100 }, false));
    const anchor = applyMat(m, { x: 50, y: 0 });
    const out = transformHandle(h, m);
    ptNear(anchor, 100, 0);
    ptNear({ x: anchor.x + out.ox, y: anchor.y + out.oy }, 120, 0);
  });

  it('reads an empty handle as no handle at all', () => {
    assert.equal(transformHandle({ ix: 0, iy: 0, ox: 0, oy: 0 }, matRotate(1)), null);
    assert.equal(transformHandle(null, matRotate(1)), null);
  });

  it('applies the linear part alone', () => {
    ptNear(applyMatVec(matTranslate(7, 9), { x: 1, y: 2 }), 1, 2);
    ptNear(applyMat(matTranslate(7, 9), { x: 1, y: 2 }), 8, 11);
  });
});
