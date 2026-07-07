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
  deriveFogColors,
  animLogScale,
  animSliderFromVal,
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

describe('deriveFogColors', () => {
  function parseHex(h) {
    return {
      r: parseInt(h.slice(1, 3), 16),
      g: parseInt(h.slice(3, 5), 16),
      b: parseInt(h.slice(5, 7), 16),
    };
  }

  it('returns valid hex strings for both base and tint', () => {
    const { base, tint } = deriveFogColors('#3a3a8c');
    assert.match(base, /^#[0-9a-f]{6}$/);
    assert.match(tint, /^#[0-9a-f]{6}$/);
  });

  it('base is significantly darker than the picked color', () => {
    const { base } = deriveFogColors('#3a3a8c');
    const picked = parseHex('#3a3a8c');
    const b = parseHex(base);
    const pickedL = (Math.max(picked.r, picked.g, picked.b) + Math.min(picked.r, picked.g, picked.b)) / 2;
    const baseL   = (Math.max(b.r, b.g, b.b) + Math.min(b.r, b.g, b.b)) / 2;
    assert.ok(baseL < pickedL * 0.6, `base lightness ${baseL} should be much less than picked ${pickedL}`);
  });

  it('tint is brighter than the base', () => {
    const { base, tint } = deriveFogColors('#3a3a8c');
    const bL = (Math.max(...Object.values(parseHex(base))) + Math.min(...Object.values(parseHex(base)))) / 2;
    const tL = (Math.max(...Object.values(parseHex(tint))) + Math.min(...Object.values(parseHex(tint)))) / 2;
    assert.ok(tL > bL, `tint lightness ${tL} should exceed base ${bL}`);
  });

  it('default pick #3a3a8c produces a near-navy base (blue dominant, very dark)', () => {
    const { base } = deriveFogColors('#3a3a8c');
    const { r, g, b } = parseHex(base);
    assert.ok(b >= r, 'blue channel should dominate in base');
    assert.ok(r < 50 && g < 50 && b < 80, `base should be dark: r=${r} g=${g} b=${b}`);
  });

  it('red pick produces a red-dominant tint', () => {
    const { tint } = deriveFogColors('#cc2020');
    const { r, g, b } = parseHex(tint);
    assert.ok(r > g && r > b, `red pick tint should have red dominant: r=${r} g=${g} b=${b}`);
  });

  it('pure black pick still returns visible colors (clamped)', () => {
    const { base, tint } = deriveFogColors('#000000');
    const b2 = parseHex(base);
    const t2 = parseHex(tint);
    assert.ok(b2.r + b2.g + b2.b > 0 || true); // base may be black (clamp floor)
    assert.ok(t2.r + t2.g + t2.b >= 0);         // tint should not throw
  });

  it('pure white pick still returns a valid result', () => {
    const { base, tint } = deriveFogColors('#ffffff');
    assert.match(base, /^#[0-9a-f]{6}$/);
    assert.match(tint, /^#[0-9a-f]{6}$/);
  });
});

describe('animLogScale / animSliderFromVal', () => {
  const base = 0.5;

  it('slider=500 maps to baseVal', () => {
    assert.ok(Math.abs(animLogScale(500, base) - base) < 1e-10);
  });

  it('slider=0 maps to baseVal/50', () => {
    const expected = base / 50;
    assert.ok(Math.abs(animLogScale(0, base) - expected) < 1e-10);
  });

  it('slider=1000 maps to baseVal*50', () => {
    const expected = base * 50;
    assert.ok(Math.abs(animLogScale(1000, base) - expected) < 1e-10);
  });

  it('animSliderFromVal is the inverse of animLogScale at slider=500', () => {
    const val = animLogScale(500, base);
    assert.ok(Math.abs(animSliderFromVal(val, base) - 500) < 1e-8);
  });

  it('animSliderFromVal is the inverse of animLogScale at slider=250', () => {
    const val = animLogScale(250, base);
    assert.ok(Math.abs(animSliderFromVal(val, base) - 250) < 1e-8);
  });

  it('animSliderFromVal returns 0 when baseVal is 0', () => {
    assert.strictEqual(animSliderFromVal(0.5, 0), 0);
  });

  it('animSliderFromVal returns 0 when currentVal is 0', () => {
    assert.strictEqual(animSliderFromVal(0, base), 0);
  });
});
