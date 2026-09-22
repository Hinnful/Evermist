'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
// shapeClipboard.js reaches these as bare globals, the way the browser's script order provides
// them. clipAddHole is the one function here with no DOM/state coupling — see its own comment.
const _fg = require('../src/fog/fogGeometry.js');
global.polyRings = _fg.polyRings;
global.polyHoleRings = _fg.polyHoleRings;
global.flatVertexCount = _fg.flatVertexCount;
const { editCornerRadii, editHandles, editHoles } = require('../src/shapes/shapeSelect.js');
global.editCornerRadii = editCornerRadii;
global.editHandles = editHandles;
global.editHoles = editHoles;
global.setShapeHoles = (shape, holes) => {
  if (holes && holes.length) shape.holes = holes; else delete shape.holes;
};
const { boxFlatRange } = require('../src/shapes/shapeBox.js');
global.boxFlatRange = boxFlatRange;

const { clipAddHole } = require('../src/shapes/shapeClipboard.js');

function room() {
  return { vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] };
}
const ring = [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }];

describe('clipAddHole', () => {
  test('appends the ring as a new hole and returns its index', () => {
    const poly = room();
    const hi = clipAddHole(poly, ring, {});
    assert.equal(hi, 0);
    assert.deepEqual(poly.holes[0], ring);
  });

  test('appends past an existing hole rather than displacing it', () => {
    const poly = room();
    poly.holes = [[{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 6 }, { x: 5, y: 6 }]];
    const hi = clipAddHole(poly, ring, {});
    assert.equal(hi, 1);
    assert.equal(poly.holes.length, 2);
  });

  test('carries the clipped cornerRadii onto the new hole\'s own flat range', () => {
    const poly = room();
    const hi = clipAddHole(poly, ring, { cornerRadii: [1, 2, 3, 4] });
    const { from, count } = boxFlatRange(poly, hi);
    assert.deepEqual(poly.cornerRadii.slice(from, from + count), [1, 2, 3, 4]);
  });

  test('pads a shorter clipped cornerRadii with null rather than reusing the outer ring\'s', () => {
    const poly = room();
    poly.cornerRadii = [9, 9, 9, 9];
    const hi = clipAddHole(poly, ring, {});
    const { from, count } = boxFlatRange(poly, hi);
    assert.deepEqual(poly.cornerRadii.slice(from, from + count), [null, null, null, null]);
    assert.equal(hi, 0);
  });

  test('rebases the clipped doors onto the new hole\'s own edge numbers', () => {
    const poly = room();
    const hi = clipAddHole(poly, ring, { doors: [{ edge: 0 }, { edge: 2 }] });
    const { from } = boxFlatRange(poly, hi);
    assert.deepEqual(poly.doors, [{ edge: from }, { edge: from + 2 }]);
  });

  test('leaves cornerRadii and doors untouched when the clip carries neither', () => {
    const poly = room();
    clipAddHole(poly, ring, {});
    assert.equal(poly.cornerRadii, undefined);
    assert.equal(poly.doors, undefined);
  });
});
