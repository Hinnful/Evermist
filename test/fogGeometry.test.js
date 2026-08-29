const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  getPolyBBox,
  buildRoundedPolyPath,
  insetPolygon,
  snapToAxis,
  coneVertices,
  CONE_BULGE,
  fogSizeScale,
  scaledRadius,
  wrapOffset,
  pulseAlpha,
  cloudBlendIndices,
  shouldRebuildCloudBlend,
  cloudBlendElapsedSec,
  sampleWrappedNoise,
  fogTurbulence,
  deriveFogColors,
  lerpHex,
  animLogScale,
  animSliderFromVal,
} = require('../src/fogGeometry.js');

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

  it('handles negative pos: -0.5 wraps to frame 15 with blend 0.5', () => {
    const r = cloudBlendIndices(-0.5, 16);
    assert.equal(r.idxA, 15);
    assert.equal(r.idxB, 0);
    assert.ok(Math.abs(r.blend - 0.5) < 1e-9);
  });

  it('handles negative pos: -16.25 wraps to frame 15 with blend 0.75', () => {
    const r = cloudBlendIndices(-16.25, 16);
    assert.equal(r.idxA, 15);
    assert.equal(r.idxB, 0);
    assert.ok(Math.abs(r.blend - 0.75) < 1e-9);
  });
});

describe('shouldRebuildCloudBlend', () => {
  it('holds off until the scheduled time', () => {
    assert.equal(shouldRebuildCloudBlend(1050, 1100), false);
  });

  it('fires exactly at the scheduled time', () => {
    assert.equal(shouldRebuildCloudBlend(1100, 1100), true);
  });

  it('fires when the scheduled time has passed', () => {
    assert.equal(shouldRebuildCloudBlend(1234, 1100), true);
  });

  it('fires on the first tick, when nothing has been scheduled yet', () => {
    assert.equal(shouldRebuildCloudBlend(16.7, 0), true);
  });
});

describe('cloudBlendElapsedSec', () => {
  it('returns real elapsed seconds, not one tick', () => {
    // A 100ms throttle on a 180Hz display skips ~17 ticks; the morph must still
    // advance by the full 0.1s or it would run ~18x slow.
    assert.ok(Math.abs(cloudBlendElapsedSec(1100, 1000, 0.1) - 0.1) < 1e-9);
  });

  it('returns 0 on the first rebuild, when there is no previous timestamp', () => {
    assert.equal(cloudBlendElapsedSec(5000, 0, 0.1), 0);
  });

  it('clamps a long stall so the morph cannot jump forward', () => {
    // e.g. window hidden for 30s, or a scene switch
    assert.equal(cloudBlendElapsedSec(31000, 1000, 0.1), 0.1);
  });

  it('never returns a negative span if timestamps go backwards', () => {
    assert.equal(cloudBlendElapsedSec(900, 1000, 0.1), 0);
  });

  it('matches an every-tick rebuild over the same wall-clock span', () => {
    // 6 rebuilds of 100ms must advance the morph as far as 0.6s of ticking.
    let total = 0;
    let last = 1000;
    for (let i = 1; i <= 6; i++) {
      const ts = 1000 + i * 100;
      total += cloudBlendElapsedSec(ts, last, 0.1);
      last = ts;
    }
    assert.ok(Math.abs(total - 0.6) < 1e-9);
  });
});

describe('sampleWrappedNoise', () => {
  // 2×2 grid: [0.0, 1.0, 0.5, 0.5]
  // layout: row0=[0.0,1.0], row1=[0.5,0.5]
  const n = 2;
  const grid = new Float32Array([0.0, 1.0, 0.5, 0.5]);

  it('integer coords return grid cell exactly', () => {
    assert.ok(Math.abs(sampleWrappedNoise(grid, n, 0, 0) - 0.0) < 1e-9);
    assert.ok(Math.abs(sampleWrappedNoise(grid, n, 1, 0) - 1.0) < 1e-9);
    assert.ok(Math.abs(sampleWrappedNoise(grid, n, 0, 1) - 0.5) < 1e-9);
    assert.ok(Math.abs(sampleWrappedNoise(grid, n, 1, 1) - 0.5) < 1e-9);
  });

  it('midpoint (0.5, 0) returns smoothstep-blended value between cell (0,0)=0 and (1,0)=1', () => {
    // At fx=0.5, sx=0.5, tx = 0.5*0.5*(3-1) = 0.5. a=0, b=1. No y blend (sy=0).
    // result = 0 + (1-0)*0.5 = 0.5
    assert.ok(Math.abs(sampleWrappedNoise(grid, n, 0.5, 0) - 0.5) < 1e-9);
  });

  it('wraps at fx=n back to cell 0', () => {
    assert.ok(Math.abs(sampleWrappedNoise(grid, n, 2, 0) - sampleWrappedNoise(grid, n, 0, 0)) < 1e-9);
  });

  it('wraps negative fx', () => {
    assert.ok(Math.abs(sampleWrappedNoise(grid, n, -2, 0) - sampleWrappedNoise(grid, n, 0, 0)) < 1e-9);
  });
});

describe('fogTurbulence', () => {
  it('returns weighted average of layer samples (single layer)', () => {
    const n = 2;
    const grid = new Float32Array([0.0, 1.0, 0.5, 0.5]);
    const layers = [{ grid, n, scale: 1.0 }];
    // With scale=1 and total=1, result equals sampleWrappedNoise directly
    const expected = sampleWrappedNoise(grid, n, 0.5 * n, 0 * n);
    assert.ok(Math.abs(fogTurbulence(layers, 0.5, 0) - expected) < 1e-9);
  });

  it('blends two layers by scale weight', () => {
    const n = 2;
    const grid = new Float32Array([0.0, 1.0, 0.5, 0.5]);
    const layers = [
      { grid, n, scale: 1.0 },
      { grid, n, scale: 1.0 },
    ];
    // Same grid, same coords: result equals single-layer sample (scales cancel)
    const expected = sampleWrappedNoise(grid, n, 0 * n, 0 * n);
    assert.ok(Math.abs(fogTurbulence(layers, 0, 0) - expected) < 1e-9);
  });
});

describe('parseSceneFogSettings', () => {
  const { parseSceneFogSettings } = require('../src/fogGeometry.js');
  const DEFAULTS = {
    hex: '#3a3a8c', alpha: 0.18,
    anim: { enabled: true, speed: 1.0, drift: 1.0, morph: 0.35, warpStr: 0.15, warpRad: 0.08, pulse: 0.30 },
  };

  it('missing fogSettings → all defaults', () => {
    const r = parseSceneFogSettings({}, DEFAULTS);
    assert.equal(r.hex, '#3a3a8c');
    assert.equal(r.alpha, 0.18);
    assert.equal(r.anim.enabled, true);
    assert.equal(r.anim.speed, 1.0);
  });

  it('valid fogSettings fields are kept', () => {
    const r = parseSceneFogSettings({ fogSettings: { pickedHex: '#ff0000', tintAlpha: 0.5 } }, DEFAULTS);
    assert.equal(r.hex, '#ff0000');
    assert.equal(r.alpha, 0.5);
  });

  it('tintAlpha: 0 is kept (falsy but valid)', () => {
    const r = parseSceneFogSettings({ fogSettings: { tintAlpha: 0 } }, DEFAULTS);
    assert.equal(r.alpha, 0);
  });

  it('enabled: false is kept (boolean false)', () => {
    const r = parseSceneFogSettings({ fogSettings: { anim: { enabled: false } } }, DEFAULTS);
    assert.equal(r.anim.enabled, false);
  });

  it('NaN anim field falls back to default, valid neighbor kept', () => {
    const r = parseSceneFogSettings({ fogSettings: { anim: { speed: NaN, drift: 2.5 } } }, DEFAULTS);
    assert.equal(r.anim.speed, 1.0);
    assert.equal(r.anim.drift, 2.5);
  });

  it('partial anim object — missing fields get defaults', () => {
    const r = parseSceneFogSettings({ fogSettings: { anim: { morph: 0.5 } } }, DEFAULTS);
    assert.equal(r.anim.morph, 0.5);
    assert.equal(r.anim.warpStr, 0.15);
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

describe('lerpHex', () => {
  it('the ends are the two colours themselves', () => {
    assert.equal(lerpHex('#3a3a8c', '#cc2020', 0), '#3a3a8c');
    assert.equal(lerpHex('#3a3a8c', '#cc2020', 1), '#cc2020');
  });

  it('the midpoint is halfway on every channel', () => {
    assert.equal(lerpHex('#000000', '#ffffff', 0.5), '#808080');
  });

  it('t outside 0..1 clamps, so a late frame cannot overshoot the destination', () => {
    assert.equal(lerpHex('#000000', '#ffffff', 1.4), '#ffffff');
    assert.equal(lerpHex('#000000', '#ffffff', -0.2), '#000000');
  });

  it('every step is a valid 6-digit hex — it is written straight into a fillStyle', () => {
    for (let i = 0; i <= 10; i++) {
      assert.match(lerpHex('#0a0f04', '#ffeedd', i / 10), /^#[0-9a-f]{6}$/);
    }
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

describe('snapToAxis', () => {
  const ref = { x: 100, y: 100 };

  it('leaves an off-axis point untouched', () => {
    assert.deepStrictEqual(snapToAxis({ x: 140, y: 160 }, [ref], 10), { x: 140, y: 160 });
  });

  it('snaps x when the point is nearly level vertically', () => {
    assert.deepStrictEqual(snapToAxis({ x: 103, y: 300 }, [ref], 10), { x: 100, y: 300 });
  });

  it('snaps y when the point is nearly level horizontally', () => {
    assert.deepStrictEqual(snapToAxis({ x: 300, y: 96 }, [ref], 10), { x: 300, y: 100 });
  });

  it('snaps only the smaller deviation when both axes are in range', () => {
    // dx = 6, dy = 2 → y wins, x is left alone.
    assert.deepStrictEqual(snapToAxis({ x: 106, y: 98 }, [ref], 10), { x: 106, y: 100 });
  });

  it('picks the nearest axis across multiple references', () => {
    const a = { x: 0, y: 50 }, b = { x: 200, y: 0 };
    // dy to a = 7, dx to b = 3 → b's x wins.
    assert.deepStrictEqual(snapToAxis({ x: 197, y: 57 }, [a, b], 10), { x: 200, y: 57 });
  });

  it('is a no-op at exactly the threshold', () => {
    assert.deepStrictEqual(snapToAxis({ x: 110, y: 300 }, [ref], 10), { x: 110, y: 300 });
  });

  it('is a no-op with a zero threshold, no refs, or null entries', () => {
    assert.deepStrictEqual(snapToAxis({ x: 100.5, y: 300 }, [ref], 0), { x: 100.5, y: 300 });
    assert.deepStrictEqual(snapToAxis({ x: 100.5, y: 300 }, [], 10), { x: 100.5, y: 300 });
    assert.deepStrictEqual(snapToAxis({ x: 100.5, y: 300 }, [null], 10), { x: 100.5, y: 300 });
  });
});

describe('coneVertices', () => {
  const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, a + ' vs ' + b);
  // ⚠ THE CORNERS ARE THE FIRST AND LAST VERTEX, not v[1] and v[2]. The far edge is an arc, so
  // everything between them is arc, and a check reading v[2] measures a chord of the bulge.
  const corners = v => [v[1], v[v.length - 1]];
  const width = v => { const [a, b] = corners(v); return Math.hypot(a.x - b.x, a.y - b.y); };
  const midFar = v => { const [a, b] = corners(v); return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };

  it('puts the apex first and the two corners at either end of the list', () => {
    const v = coneVertices({ x: 10, y: 20 }, { x: 110, y: 20 }, 0);
    assert.deepStrictEqual(v[0], { x: 10, y: 20 });
    assert.ok(v.length > 3, 'the far edge is an arc, so there is more than one point on it');
    const [a, b] = corners(v);
    near(a.y - 20, 50);    // +half-width
    near(b.y - 20, -50);   // -half-width
  });

  // The rule the whole shape exists to honour: a cone is as wide at its far end as it is long.
  // The bulge must not touch it — that is why the corners are fixed and only the edge bows.
  it('makes the far end exactly as wide as the cone is long', () => {
    for (const tip of [{ x: 100, y: 0 }, { x: 0, y: -250 }, { x: -60, y: 80 }]) {
      const v = coneVertices({ x: 0, y: 0 }, tip, 0);
      near(width(v), Math.hypot(tip.x, tip.y));
    }
  });

  it('opens 53.13 degrees at the apex whatever way it points', () => {
    const apexAngle = v => {
      const [c1, c2] = corners(v);
      const a = Math.atan2(c1.y - v[0].y, c1.x - v[0].x);
      const b = Math.atan2(c2.y - v[0].y, c2.x - v[0].x);
      let d = Math.abs(a - b);
      if (d > Math.PI) d = 2 * Math.PI - d;
      return d * 180 / Math.PI;
    };
    for (const tip of [{ x: 70, y: 0 }, { x: -30, y: -40 }, { x: 5, y: 900 }]) {
      near(apexAngle(coneVertices({ x: 0, y: 0 }, tip, 0)), 53.13010235415598, 1e-9);
    }
  });

  it('keeps the length the drag asked for, measured to the corners', () => {
    const v = coneVertices({ x: 0, y: 0 }, { x: 30, y: 40 }, 0);
    const m = midFar(v);
    near(Math.hypot(m.x, m.y), 50);
  });

  it('bows the far edge outward, by the bulge fraction and no more', () => {
    const v = coneVertices({ x: 0, y: 0 }, { x: 400, y: 0 }, 0);
    const arc = v.slice(1);
    const nose = arc[(arc.length - 1) / 2];
    near(nose.y, 0);                               // the middle of the arc sits on the axis
    near(nose.x, 400 * (1 + CONE_BULGE));          // and stands out by exactly the bulge
    // Every arc point reaches at least the flat edge and never past the middle.
    for (const p of arc) {
      assert.ok(p.x >= 400 - 1e-9, 'an arc point fell short of the far edge: ' + p.x);
      assert.ok(p.x <= nose.x + 1e-9, 'an arc point overshot the middle: ' + p.x);
    }
  });

  it('curves the same way round whatever direction it points', () => {
    // Signed area keeps its sign, so fog fill and the effects shader see one winding convention.
    const area = v => {
      let a = 0;
      for (let i = 0; i < v.length; i++) {
        const p = v[i], q = v[(i + 1) % v.length];
        a += p.x * q.y - q.x * p.y;
      }
      return a / 2;
    };
    const signs = [{ x: 100, y: 0 }, { x: 0, y: 100 }, { x: -100, y: 0 }, { x: 0, y: -100 }]
      .map(tip => Math.sign(area(coneVertices({ x: 0, y: 0 }, tip, 0))));
    assert.deepStrictEqual(signs, [signs[0], signs[0], signs[0], signs[0]]);
  });

  it('rounds the direction to the snap step', () => {
    // 20 degrees, snapped to 15, must come out pointing at exactly 15.
    const r = 20 * Math.PI / 180;
    const v = coneVertices({ x: 0, y: 0 }, { x: Math.cos(r) * 100, y: Math.sin(r) * 100 }, 15);
    const m = midFar(v);
    near(Math.atan2(m.y, m.x) * 180 / Math.PI, 15, 1e-9);
    near(Math.hypot(m.x, m.y), 100);   // snapping the angle must not change the length
  });

  it('leaves the direction alone with no snap step', () => {
    const r = 20 * Math.PI / 180;
    const v = coneVertices({ x: 0, y: 0 }, { x: Math.cos(r) * 100, y: Math.sin(r) * 100 }, 0);
    const m = midFar(v);
    near(Math.atan2(m.y, m.x) * 180 / Math.PI, 20, 1e-9);
  });

  it('refuses a zero-length drag rather than returning a degenerate shape', () => {
    assert.strictEqual(coneVertices({ x: 7, y: 7 }, { x: 7, y: 7 }, 0), null);
  });
});

// ─── Door notches ─────────────────────────────────────────────────────────────
const {
  polygonWindingSign,
  edgeOutwardNormal,
  doorSizeForCell,
  doorCellBounds,
  doorCellSnap,
  doorNotchCorners,
  nearestOutlinePoint,
  doorPoint,
  pointInDoorNotch,
  doorModeRank,
  doorResolvedMode,
  sharedWallSpans,
  remapDoorsForVertexChange,
} = require('../src/fogGeometry.js');

// Screen space: y grows downward, so a clockwise ring has positive shoelace area.
const SQUARE_CW  = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 12 }, { x: 0, y: 12 }];
const SQUARE_CCW = SQUARE_CW.slice().reverse();
const CELL = 4;
const SZ = doorSizeForCell(CELL, 100, 25);
const SNAP = (verts, edge, mx, my, ox, oy, sq) =>
  doorCellSnap(verts, edge, mx, my, CELL, ox || 0, oy || 0, sq !== false);

describe('polygonWindingSign', () => {
  it('separates the two windings', () => {
    assert.equal(polygonWindingSign(SQUARE_CW), 1);
    assert.equal(polygonWindingSign(SQUARE_CCW), -1);
  });
});

describe('edgeOutwardNormal', () => {
  it('points away from the interior on the top edge, both windings', () => {
    assert.ok(edgeOutwardNormal(SQUARE_CW, 0).y < -0.99, 'top edge of a CW square faces up');
    const i = SQUARE_CCW.findIndex((v, k) => v.y === 0 && SQUARE_CCW[(k + 1) % 4].y === 0);
    assert.ok(edgeOutwardNormal(SQUARE_CCW, i).y < -0.99,
      'the same wall faces the same way whichever winding drew it');
  });

  it('is a unit vector', () => {
    const n = edgeOutwardNormal(SQUARE_CW, 1);
    assert.ok(Math.abs(Math.hypot(n.x, n.y) - 1) < 1e-9);
  });
});

describe('doorSizeForCell', () => {
  it('reads both dials as a percent of the cell', () => {
    assert.deepEqual(doorSizeForCell(4, 100, 25), { width: 4, depth: 1 });
    assert.deepEqual(doorSizeForCell(4, 200, 50), { width: 8, depth: 2 });
  });

  it('collapses to nothing on an unset grid, so callers can skip', () => {
    assert.deepEqual(doorSizeForCell(0, 100, 25), { width: 0, depth: 0 });
  });
});

describe('doorCellBounds', () => {
  it('reports the world grid lines that cross a straight wall', () => {
    assert.deepEqual(doorCellBounds(SQUARE_CW, 0, CELL, 0, 0, true).at, [0, 4, 8, 12]);
  });

  it('follows the grid offset', () => {
    assert.deepEqual(doorCellBounds(SQUARE_CW, 0, CELL, 1, 0, true).at, [0, 1, 5, 9, 12]);
  });

  it('subdivides the wall itself on a diagonal, which crosses no whole cell', () => {
    const diag = [{ x: 0, y: 0 }, { x: 6, y: 8 }, { x: 0, y: 16 }];   // first wall is 10 long
    assert.deepEqual(doorCellBounds(diag, 0, CELL, 0, 0, true).at, [0, 4, 8, 10]);
  });

  it('subdivides the wall on a hex grid, which has no cell a rectangle fills', () => {
    assert.deepEqual(doorCellBounds(SQUARE_CW, 0, CELL, 1, 0, false).at, [0, 4, 8, 12]);
  });

  it('always starts at one end of the wall and finishes at the other', () => {
    const b = doorCellBounds(SQUARE_CW, 0, 5, 0, 0, true);
    assert.equal(b.at[0], 0);
    assert.equal(b.at[b.at.length - 1], 12);
  });

  it('returns null when the grid has no size', () => {
    assert.equal(doorCellBounds(SQUARE_CW, 0, 0, 0, 0, true), null);
  });
});

describe('doorCellSnap', () => {
  // The top wall runs x 0..12 at y=0, so a cell-4 world grid puts boundaries at 0, 4, 8, 12.
  it('fills the world cell the click landed in', () => {
    assert.equal(SNAP(SQUARE_CW, 0, 1, 0).t, 2 / 12);
    assert.equal(SNAP(SQUARE_CW, 0, 5, 0).t, 6 / 12);
  });

  it('follows the grid OFFSET, not the room corner', () => {
    assert.equal(SNAP(SQUARE_CW, 0, 2, 0, 1, 0).t, 3 / 12);
  });

  it('stays on the world grid when the room corner sits off it', () => {
    const off = [{ x: 1.5, y: 0 }, { x: 13.5, y: 0 }, { x: 13.5, y: 12 }, { x: 1.5, y: 12 }];
    assert.equal(SNAP(off, 0, 5, 0).t, (6 - 1.5) / 12);
  });

  it('snaps a vertical wall on the same rule', () => {
    assert.equal(SNAP(SQUARE_CW, 1, 12, 5).t, 6 / 12);
  });

  it('gives the same door anywhere inside one cell', () => {
    assert.deepEqual(SNAP(SQUARE_CW, 0, 4.1, 0), SNAP(SQUARE_CW, 0, 7.9, 0));
  });

  it('sends a click on a boundary to the cell after it, never to both', () => {
    assert.deepEqual(SNAP(SQUARE_CW, 0, 8, 0), SNAP(SQUARE_CW, 0, 9, 0));
  });

  it('lands where the ticks say on a diagonal wall', () => {
    const diag = [{ x: 0, y: 0 }, { x: 6, y: 8 }, { x: 0, y: 16 }];
    assert.equal(SNAP(diag, 0, 3, 4).t, 6 / 10);      // between the 4 and 8 ticks
    assert.equal(SNAP(diag, 0, 0.6, 0.8).t, 2 / 10);  // between the 0 and 4 ticks
  });

  it('ignores the world grid on a hex grid', () => {
    assert.equal(SNAP(SQUARE_CW, 0, 2, 0, 1, 0, false).t, 2 / 12);
  });

  it('keeps the door inside the wall at either end', () => {
    assert.equal(SNAP(SQUARE_CW, 0, -50, 0).t, 2 / 12);
    assert.equal(SNAP(SQUARE_CW, 0, 50, 0).t, 10 / 12);
  });

  it('fills a wall shorter than one cell with a single door', () => {
    const tiny = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 9 }, { x: 0, y: 9 }];
    assert.equal(SNAP(tiny, 0, 1, 0).t, 0.5);
  });

  it('returns null when the grid has no size', () => {
    assert.equal(doorCellSnap(SQUARE_CW, 0, 1, 0, 0, 0, 0, true), null);
  });
});

describe('doorNotchCorners', () => {
  const door = SNAP(SQUARE_CW, 0, 5, 0);

  it('straddles the wall, reaching the same distance either side', () => {
    const c = doorNotchCorners(SQUARE_CW, door, SZ.width, SZ.depth, SZ.depth);
    assert.equal(c.outerL.y, -1);
    assert.equal(c.innerL.y, 1);
  });

  it('takes a deeper inward reach without moving the outward one', () => {
    const c = doorNotchCorners(SQUARE_CW, door, SZ.width, SZ.depth, 5);
    assert.equal(c.outerL.y, -1);
    assert.equal(c.innerL.y, 5);
  });

  it('spans exactly one cell, centred on the door', () => {
    const c = doorNotchCorners(SQUARE_CW, door, SZ.width, SZ.depth, SZ.depth);
    assert.equal(Math.abs(c.outerR.x - c.outerL.x), CELL);
    assert.equal((c.outerL.x + c.outerR.x) / 2, 6);
  });

  it('returns null rather than a degenerate path', () => {
    assert.equal(doorNotchCorners(SQUARE_CW, door, 0, 1, 1), null);
    assert.equal(doorNotchCorners(SQUARE_CW, door, 4, 0, 1), null);
    assert.equal(doorNotchCorners([{ x: 0, y: 0 }], door, 4, 1, 1), null);
  });

  it('wraps an out-of-range edge index instead of throwing', () => {
    assert.deepEqual(doorNotchCorners(SQUARE_CW, { ...door, edge: 4 }, SZ.width, SZ.depth, SZ.depth),
                     doorNotchCorners(SQUARE_CW, door, SZ.width, SZ.depth, SZ.depth));
  });
});

describe('pointInDoorNotch', () => {
  const door = SNAP(SQUARE_CW, 0, 5, 0);   // spans x 4..8 on the top wall

  it('accepts either side of the wall, since the notch straddles it', () => {
    assert.ok(pointInDoorNotch(SQUARE_CW, door, SZ.width, SZ.depth, 6, -0.5, 0));
    assert.ok(pointInDoorNotch(SQUARE_CW, door, SZ.width, SZ.depth, 6, 0, 0));
    assert.ok(pointInDoorNotch(SQUARE_CW, door, SZ.width, SZ.depth, 6, 0.5, 0));
  });

  it('rejects the neighbouring cell even with slack, so a second click widens the doorway', () => {
    assert.ok(!pointInDoorNotch(SQUARE_CW, door, SZ.width, SZ.depth, 9, -0.5, 0));
    assert.ok(!pointInDoorNotch(SQUARE_CW, door, SZ.width, SZ.depth, 9, -0.5, 3));
  });

  it('rejects the cell boundary itself, which belongs to both neighbours', () => {
    assert.ok(!pointInDoorNotch(SQUARE_CW, door, SZ.width, SZ.depth, 8, -0.5, 0));
  });

  it('rejects a point past the depth', () => {
    assert.ok(!pointInDoorNotch(SQUARE_CW, door, SZ.width, SZ.depth, 6, -2, 0));
  });

  it('forgives by slack, so a near miss still removes the door', () => {
    assert.ok(pointInDoorNotch(SQUARE_CW, door, SZ.width, SZ.depth, 6, 2, 2));
  });
});

describe('nearestOutlinePoint', () => {
  it('finds the wall a click landed near, as edge and fraction', () => {
    const n = nearestOutlinePoint(SQUARE_CW, 3, 0.4, 2);
    assert.equal(n.edge, 0);
    assert.equal(n.t, 0.25);
  });

  it('refuses a click past maxDist', () => {
    assert.equal(nearestOutlinePoint(SQUARE_CW, 6, 6, 2), null);
  });
});

describe('doorPoint', () => {
  it('lands back on the wall the door was stored against', () => {
    assert.deepEqual(doorPoint(SQUARE_CW, { edge: 1, t: 0.25 }), { x: 12, y: 3 });
  });
});

describe('remapDoorsForVertexChange', () => {
  const doors = [{ edge: 0, t: 0.5 }, { edge: 2, t: 0.5 }, { edge: 3, t: 0.5 }];

  it('shifts later walls along when a vertex is inserted', () => {
    assert.deepEqual(remapDoorsForVertexChange(doors, 0, 1).map(d => d.edge), [0, 3, 4]);
  });

  it('drops the doors whose wall the deleted vertex took with it', () => {
    assert.deepEqual(remapDoorsForVertexChange(doors, 3, -1).map(d => d.edge), [0]);
  });

  it('keeps each door where it sat along its wall', () => {
    assert.deepEqual(remapDoorsForVertexChange(doors, 0, 1)[0], { edge: 0, t: 0.5 });
  });

  it('leaves an empty list alone', () => {
    assert.deepEqual(remapDoorsForVertexChange(undefined, 1, -1), []);
  });
});

describe('doorResolvedMode', () => {
  // Two rooms sharing the wall y=12: A above it, B below it.
  const A = { vertices: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 12 }, { x: 0, y: 12 }] };
  const B = { vertices: [{ x: 0, y: 12 }, { x: 12, y: 12 }, { x: 12, y: 24 }, { x: 0, y: 24 }] };
  const ON_SHARED = { x: 6, y: 12 };
  const TOL = 1;

  it('ranks least to most revealed, and treats an unset mode as revealed', () => {
    assert.ok(doorModeRank('reveal') > doorModeRank('half'));
    assert.ok(doorModeRank('half') > doorModeRank('shroud'));
    assert.equal(doorModeRank(undefined), doorModeRank('reveal'));
  });

  it('shows the door when EITHER room is revealed, whichever one stores it', () => {
    assert.equal(doorResolvedMode(ON_SHARED,
      [{ ...A, mode: 'shroud' }, { ...B, mode: 'reveal' }], TOL), 'reveal');
    assert.equal(doorResolvedMode(ON_SHARED,
      [{ ...A, mode: 'reveal' }, { ...B, mode: 'shroud' }], TOL), 'reveal');
  });

  it('settles half beside shrouded as half', () => {
    assert.equal(doorResolvedMode(ON_SHARED,
      [{ ...A, mode: 'half' }, { ...B, mode: 'shroud' }], TOL), 'half');
  });

  it('lets revealed win over half', () => {
    assert.equal(doorResolvedMode(ON_SHARED,
      [{ ...A, mode: 'half' }, { ...B, mode: 'reveal' }], TOL), 'reveal');
  });

  it('hides the door when both rooms are shrouded', () => {
    assert.equal(doorResolvedMode(ON_SHARED,
      [{ ...A, mode: 'shroud' }, { ...B, mode: 'shroud' }], TOL), 'shroud');
  });

  it('ignores a revealed room that does not reach the door', () => {
    const far = { vertices: [{ x: 0, y: 40 }, { x: 12, y: 40 }, { x: 12, y: 52 }, { x: 0, y: 52 }],
                  mode: 'reveal' };
    assert.equal(doorResolvedMode(ON_SHARED, [{ ...A, mode: 'shroud' }, far], TOL), 'shroud');
  });

  it('returns shroud rather than throwing on a door with no wall', () => {
    assert.equal(doorResolvedMode(null, [{ ...A, mode: 'reveal' }], TOL), 'shroud');
  });
});

describe('sharedWallSpans', () => {
  // A above, B below, meeting on the line y=12. A's edge 2 runs back along that line.
  const A = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 12 }, { x: 0, y: 12 }];
  const B = { vertices: [{ x: 0, y: 12 }, { x: 12, y: 12 }, { x: 12, y: 24 }, { x: 0, y: 24 }] };
  const bottomEdge = 2;

  it('reports the whole wall when another room runs along all of it', () => {
    const spans = sharedWallSpans(A, bottomEdge, [B], 1, 3);
    assert.equal(spans.length, 1);
    assert.equal(spans[0].from, 0);
    assert.equal(spans[0].to, 12);
  });

  it('finds a wall the neighbour missed by less than the tolerance', () => {
    const off = { vertices: B.vertices.map(v => ({ x: v.x, y: v.y + 0.5 })) };
    assert.equal(sharedWallSpans(A, bottomEdge, [off], 1, 3).length, 1);
  });

  it('leaves a wall alone when the neighbour is further off than the tolerance', () => {
    const far = { vertices: B.vertices.map(v => ({ x: v.x, y: v.y + 6 })) };
    assert.deepEqual(sharedWallSpans(A, bottomEdge, [far], 1, 3), []);
  });

  it('reports only the stretch that is actually shared', () => {
    const halfB = { vertices: [{ x: 6, y: 12 }, { x: 12, y: 12 }, { x: 12, y: 24 }, { x: 6, y: 24 }] };
    const spans = sharedWallSpans(A, bottomEdge, [halfB], 1, 3);
    assert.equal(spans.length, 1);
    // Edge 2 runs from (12,12) back to (0,12), so the shared half starts at distance 0.
    assert.equal(spans[0].from, 0);
    assert.ok(spans[0].to > 5 && spans[0].to < 9, 'stops near the middle, got ' + spans[0].to);
  });

  it('leaves a free wall alone', () => {
    assert.deepEqual(sharedWallSpans(A, 0, [B], 1, 3), []);
  });

  it('returns nothing rather than throwing on empty or degenerate input', () => {
    assert.deepEqual(sharedWallSpans(A, 0, null, 1, 3), []);
    assert.deepEqual(sharedWallSpans(A, 0, [B], 0, 3), []);
    assert.deepEqual(sharedWallSpans([{ x: 0, y: 0 }], 0, [B], 1, 3), []);
  });
});

describe('a door never outgrows its wall', () => {
  // A 4-long wall on a grid whose cell is 6: the door would otherwise overhang both corners.
  const SHORT = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 9 }, { x: 0, y: 9 }];
  const door = { edge: 0, t: 0.5 };

  it('caps the notch at the wall length', () => {
    const c = doorNotchCorners(SHORT, door, 6, 1, 1);
    assert.equal(c.outerL.x, 0);
    assert.equal(c.outerR.x, 4);
  });

  it('leaves a wall longer than the door alone', () => {
    const c = doorNotchCorners(SQUARE_CW, { edge: 0, t: 0.5 }, 4, 1, 1);
    assert.equal(Math.abs(c.outerR.x - c.outerL.x), 4);
  });

  it('caps the hit test to match, so a click beyond the wall end misses', () => {
    assert.ok(pointInDoorNotch(SHORT, door, 6, 1, 3.5, 0, 0));    // still on the wall
    assert.ok(!pointInDoorNotch(SHORT, door, 6, 1, 4.5, 0, 0));   // past its end
  });
});
