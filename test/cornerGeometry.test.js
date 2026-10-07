'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
// cornerGeometry.js reaches the fillet kernel as bare globals, the way the browser's script order provides them.
const _fg = require('../src/fog/fogGeometry.js');
for (const k of ['computeFillet', 'edgeIsCurved', 'edgeCubic', 'handleAt', 'polygonWindingSign']) global[k] = _fg[k];
const { cornerRadiusAt, cornerMaxRadius, cornerHandle, cornerDragRadius, setAllCornerRadii } =
  require('../src/shapes/cornerGeometry.js');

const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
// An L: corner 3 (60,60) is the reflex one.
const ell = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 60, y: 60 },
             { x: 60, y: 100 }, { x: 0, y: 100 }];
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

describe('cornerRadiusAt', () => {
  test('a per-corner value wins, null falls back to the shape radius', () => {
    const poly = { cornerRadius: 8, cornerRadii: [null, 20] };
    assert.equal(cornerRadiusAt(poly, 0), 8);
    assert.equal(cornerRadiusAt(poly, 1), 20);
    assert.equal(cornerRadiusAt({}, 0), 0);
  });
});

describe('cornerMaxRadius', () => {
  test('half the shorter wall', () => {
    assert.equal(cornerMaxRadius(square, 0), 50);
    assert.equal(cornerMaxRadius(ell, 3), 20);
  });
});

describe('cornerHandle', () => {
  test('an unrounded convex corner sits the inset along the bisector, into the shape', () => {
    const h = cornerHandle(square, null, 0, 0, 0, 10);
    assert.ok(near(h.x, 10 / Math.SQRT2, 1e-3) && near(h.y, 10 / Math.SQRT2, 1e-3));
    assert.ok(near(h.sinH, Math.SQRT1_2, 1e-3));
  });

  test('a rounded corner moves the circle out to the fillet centre once that passes the inset', () => {
    const h = cornerHandle(square, null, 0, 0, 30, 10);
    assert.ok(near(h.x, 30, 1e-3) && near(h.y, 30, 1e-3));
  });

  test('a reflex corner keeps its circle inside the shape', () => {
    const h = cornerHandle(ell, null, 0, 3, 0, 10);
    assert.ok(h.x < 60 && h.y < 60, `circle at ${h.x},${h.y} left the L`);
    assert.ok(h.dir.x < 0 && h.dir.y < 0);
  });

  test('a corner that barely turns gets no circle', () => {
    const almost = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 10 }, { x: 100, y: 100 }];
    assert.equal(cornerHandle(almost, null, 0, 1, 0, 10), null);
  });

  test('a corner whose bent wall leaves it in line with the other wall still gets a circle', () => {
    const rect = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 300 }];
    const bent = [{ ix: 0, iy: 0, ox: 0, oy: -133 }, { ix: 0, iy: -133, ox: 0, oy: 0 }, null, null];
    assert.ok(cornerHandle(rect, bent, 0, 0, 30, 20));
  });

  test('a corner meeting a curved wall still gets a circle', () => {
    const handles = [{ ix: 0, iy: 0, ox: 40, oy: -30 }, null, null, null];
    assert.ok(cornerHandle(square, handles, 0, 0, 0, 10));
  });
});

describe('cornerDragRadius', () => {
  const h = { sinH: 0.5, maxR: 40 };
  test('a drag along the circle adds radius at sinH per unit', () => {
    assert.equal(cornerDragRadius(h, 10, 20), 20);
  });
  test('held between zero and the corner maximum', () => {
    assert.equal(cornerDragRadius(h, 10, -100), 0);
    assert.equal(cornerDragRadius(h, 10, 500), 40);
  });
});

describe('setAllCornerRadii', () => {
  test('one radius everywhere, the per-corner ones gone', () => {
    const poly = { cornerRadius: 4, cornerRadii: [10, null, 30] };
    setAllCornerRadii(poly, 12);
    assert.equal(poly.cornerRadius, 12);
    assert.equal(poly.cornerRadii, undefined);
  });
});
