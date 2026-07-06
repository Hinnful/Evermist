const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { lineWidthForZoom } = require('../grid.js');

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
