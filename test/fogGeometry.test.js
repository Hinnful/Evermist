const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  getPolyBBox,
  buildRoundedPolyPath,
  insetPolygon,
  fogSizeScale,
  scaledRadius,
  wrapOffset,
  pulseAlpha,
  cloudBlendIndices,
} = require('../fogGeometry.js');

// Records path commands so buildRoundedPolyPath can be tested without a real canvas.
function recordingCtx() {
  const calls = [];
  return {
    calls,
    moveTo: (x, y) => calls.push(['moveTo', x, y]),
    lineTo: (x, y) => calls.push(['lineTo', x, y]),
    arcTo: (x1, y1, x2, y2, r) => calls.push(['arcTo', x1, y1, x2, y2, r]),
    closePath: () => calls.push(['closePath']),
  };
}

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe('getPolyBBox', () => {
  it('returns the tight bounds of a polygon', () => {
    assert.deepEqual(getPolyBBox(square), { minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });

  it('handles negative coordinates', () => {
    const bb = getPolyBBox([{ x: -5, y: 3 }, { x: 2, y: -8 }, { x: 7, y: 1 }]);
    assert.deepEqual(bb, { minX: -5, minY: -8, maxX: 7, maxY: 3 });
  });

  it('collapses to a point for a single vertex', () => {
    assert.deepEqual(getPolyBBox([{ x: 4, y: 9 }]), { minX: 4, minY: 9, maxX: 4, maxY: 9 });
  });
});

describe('buildRoundedPolyPath', () => {
  it('draws straight segments for degenerate (<3 vertex) input', () => {
    const ctx = recordingCtx();
    buildRoundedPolyPath(ctx, [{ x: 1, y: 2 }, { x: 3, y: 4 }], 5, null);
    assert.deepEqual(ctx.calls, [
      ['moveTo', 1, 2],
      ['lineTo', 3, 4],
      ['closePath'],
    ]);
  });

  it('emits only straight lines when defaultR is 0 (sharp corners)', () => {
    const ctx = recordingCtx();
    buildRoundedPolyPath(ctx, square, 0, null);
    const ops = ctx.calls.map(c => c[0]);
    assert.deepEqual(ops, ['moveTo', 'lineTo', 'lineTo', 'lineTo', 'closePath']);
    assert.equal(ctx.calls.filter(c => c[0] === 'arcTo').length, 0);
  });

  it('emits one arcTo per vertex when a radius is given', () => {
    const ctx = recordingCtx();
    buildRoundedPolyPath(ctx, square, 2, null);
    assert.equal(ctx.calls.filter(c => c[0] === 'arcTo').length, 4);
  });

  it('clamps the radius to half the shorter adjacent edge', () => {
    const ctx = recordingCtx();
    // Radius 100 far exceeds the 10px edges → clamped to min(100, 5, 5) = 5.
    buildRoundedPolyPath(ctx, square, 100, null);
    const firstArc = ctx.calls.find(c => c[0] === 'arcTo');
    assert.equal(firstArc[5], 5);
  });

  it('honors per-vertex radius overrides, falling back to defaultR on null', () => {
    const ctx = recordingCtx();
    buildRoundedPolyPath(ctx, square, 3, [0, null, 4, 4]);
    const arcs = ctx.calls.filter(c => c[0] === 'arcTo');
    // vertex 0 has r=0 → sharp (no arc); vertices 1,2,3 are rounded → 3 arcs.
    assert.equal(arcs.length, 3);
  });
});

describe('insetPolygon', () => {
  it('returns the input unchanged for dist <= 0 or <3 vertices', () => {
    assert.equal(insetPolygon(square, 0), square);
    assert.equal(insetPolygon(square, -2), square);
    const line = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    assert.equal(insetPolygon(line, 5), line);
  });

  it('shrinks a square inward by exactly dist on every edge', () => {
    const out = insetPolygon(square, 2);
    assert.deepEqual(out, [
      { x: 2, y: 2 },
      { x: 8, y: 2 },
      { x: 8, y: 8 },
      { x: 2, y: 8 },
    ]);
  });

  it('produces the same inset regardless of winding direction', () => {
    const ccw = [...square].reverse();
    const inCW = insetPolygon(square, 2);
    const inCCW = insetPolygon(ccw, 2);
    // CCW result is the reversed CW result — same shape, opposite order.
    assert.deepEqual(inCCW, [...inCW].reverse());
  });
});

describe('fogSizeScale', () => {
  it('is 1 at or above the reference size', () => {
    assert.equal(fogSizeScale(1500, 1500), 1);
    assert.equal(fogSizeScale(3000, 1500), 1);
  });

  it('scales quadratically below the reference size', () => {
    assert.equal(fogSizeScale(750, 1500), 0.25); // (0.5)^2
    assert.equal(fogSizeScale(375, 1500), 0.0625); // (0.25)^2
  });
});

describe('scaledRadius', () => {
  it('scales the base radius by the size scale', () => {
    assert.equal(scaledRadius(8, 0.5), 4);
  });

  it('never returns below 1px', () => {
    assert.equal(scaledRadius(8, 0.0625), 1); // 0.5 → floored to 1
    assert.equal(scaledRadius(0, 1), 1);
  });
});

describe('wrapOffset', () => {
  it('leaves in-range values untouched', () => {
    assert.equal(wrapOffset(3, 10), 3);
  });

  it('wraps values above the tile', () => {
    assert.equal(wrapOffset(13, 10), 3);
  });

  it('wraps negative values into [0, tile)', () => {
    assert.equal(wrapOffset(-1, 10), 9);
    assert.equal(wrapOffset(-13, 10), 7);
  });
});

describe('pulseAlpha', () => {
  it('returns the base value at sin = 0', () => {
    assert.equal(pulseAlpha(0.4, 0.3, 0, 0.08, 0), 0.4);
  });

  it('applies +amp at the sine peak', () => {
    // sin(pi/2) = 1 → base * (1 + amp)
    const v = pulseAlpha(0.4, 0.3, Math.PI / 2, 1, 0);
    assert.ok(Math.abs(v - 0.4 * 1.3) < 1e-9);
  });

  it('applies -amp at the sine trough', () => {
    const v = pulseAlpha(0.4, 0.3, (3 * Math.PI) / 2, 1, 0);
    assert.ok(Math.abs(v - 0.4 * 0.7) < 1e-9);
  });
});

describe('cloudBlendIndices', () => {
  it('gives adjacent indices and the fractional blend', () => {
    assert.deepEqual(cloudBlendIndices(2.25, 16), { idxA: 2, idxB: 3, blend: 0.25 });
  });

  it('wraps idxB around the last frame', () => {
    const r = cloudBlendIndices(15.5, 16);
    assert.equal(r.idxA, 15);
    assert.equal(r.idxB, 0);
    assert.ok(Math.abs(r.blend - 0.5) < 1e-9);
  });

  it('wraps positions beyond the frame count', () => {
    // 18.5 % 16 = 2.5
    assert.deepEqual(cloudBlendIndices(18.5, 16), { idxA: 2, idxB: 3, blend: 0.5 });
  });
});
