const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { lineWidthForZoom } = require('../src/render/grid.js');

describe('lineWidthForZoom', () => {
  it('scales linearly with zoom above the floor', () => {
    assert.equal(lineWidthForZoom(2, 3), 6);
  });

  it('returns base * zoom at zoom = 1', () => {
    assert.equal(lineWidthForZoom(1, 1), 1);
    assert.equal(lineWidthForZoom(4, 1), 4);
  });

  it('clamps to MIN_SCREEN_PX (0.75) at very low zoom', () => {
    assert.equal(lineWidthForZoom(1, 0.1), 0.75);
    assert.equal(lineWidthForZoom(1, 0), 0.75);
  });

  it('floor does not activate when base * zoom exceeds it', () => {
    // 1 * 0.8 = 0.8 > 0.75 — should not be clamped
    assert.equal(lineWidthForZoom(1, 0.8), 0.8);
  });
});

const { normalizeGridMode } = require('../src/render/grid.js');

describe('normalizeGridMode', () => {
  it('turns a flat-top hex grid into a pointy-top one', () => {
    assert.equal(normalizeGridMode('hex-flat', 'square'), 'hex-pointy');
  });

  it('keeps square and pointy-top as they are', () => {
    assert.equal(normalizeGridMode('square', 'hex-pointy'), 'square');
    assert.equal(normalizeGridMode('hex-pointy', 'square'), 'hex-pointy');
  });

  it('keeps the current mode when the saved one is missing or unknown', () => {
    assert.equal(normalizeGridMode(undefined, 'hex-pointy'), 'hex-pointy');
    assert.equal(normalizeGridMode(null, 'square'), 'square');
    assert.equal(normalizeGridMode('triangle', 'square'), 'square');
  });
});

const { gridDashPattern, normalizeGridLineStyle } = require('../src/render/grid.js');

describe('gridDashPattern', () => {
  it('draws solid lines with no dash', () => {
    assert.deepEqual(gridDashPattern('solid', 2, 1), []);
  });

  it('dashes four units on, three off, a unit being the line width on screen', () => {
    assert.deepEqual(gridDashPattern('dashed', 2, 1), [8, 6]);
    assert.deepEqual(gridDashPattern('dashed', 4, 0.5), [8, 6]);
  });

  it('dots with a near-zero dash, three units apart', () => {
    const [dot, gap] = gridDashPattern('dotted', 2, 2);
    assert.ok(dot > 0 && dot < 0.01);
    assert.equal(gap, 12);
  });

  it('grows with the zoom, so the pattern holds its shape on the map', () => {
    const near = gridDashPattern('dashed', 2, 3), far = gridDashPattern('dashed', 2, 1);
    assert.deepEqual(near, far.map(v => v * 3));
  });

  it('keeps a thin line from collapsing into a solid one', () => {
    assert.deepEqual(gridDashPattern('dashed', 1, 1), [6, 4.5]);
  });

  it('reads an unknown style as solid', () => {
    assert.deepEqual(gridDashPattern('wavy', 2, 1), []);
  });
});

describe('normalizeGridLineStyle', () => {
  it('reads a scene saved before line styles as solid', () => {
    assert.equal(normalizeGridLineStyle(undefined), 'solid');
    assert.equal(normalizeGridLineStyle('wavy'), 'solid');
  });

  it('keeps every style the pane offers', () => {
    for (const s of ['solid', 'dashed', 'dotted']) assert.equal(normalizeGridLineStyle(s), s);
  });
});
