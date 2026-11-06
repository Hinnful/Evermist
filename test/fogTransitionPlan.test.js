'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  FOG_ORDER_REVEAL, FOG_ORDER_HIDE,
  fogValueNoise, fogOrderNoise, fogChangedRegion, fogOrderField, fogEdgeDistance, fogShapeRank, fogNearestRegion, fogRankNormalise, fogChangeOverlaps, fogTakePixels,
} = require('../src/fog/fogTransitionPlan.js');

describe('fogOrderNoise', () => {
  it('stays in 0..1 and repeats for the same point', () => {
    for (let i = 0; i < 400; i++) {
      const x = i * 3.7, y = i * 1.3;
      const v = fogOrderNoise(x, y, 40);
      assert.ok(v >= 0 && v <= 1);
      assert.equal(v, fogOrderNoise(x, y, 40));
    }
  });

  it('is smooth: a step of one pixel moves it a little', () => {
    let worst = 0;
    for (let i = 0; i < 300; i++) worst = Math.max(worst, Math.abs(fogValueNoise(i * .1 + 5, 7) - fogValueNoise(i * .1 + 5.1, 7)));
    assert.ok(worst < .2);
    let big = 0;
    for (let i = 0; i < 300; i++) big = Math.max(big, Math.abs(fogOrderNoise(i, 50, 60) - fogOrderNoise(i + 1, 50, 60)));
    assert.ok(big < .12);
  });
});

describe('fogChangedRegion', () => {
  const rgba = (alphas) => Uint8Array.from(alphas);

  it('marks less fog a reveal, more fog a hide, and ignores a faint difference', () => {
    const region = new Uint8Array(4);
    const n = fogChangedRegion(rgba([255, 0, 100, 100]), rgba([0, 255, 103, 100]), region);
    assert.equal(n, 2);
    assert.deepEqual(Array.from(region), [FOG_ORDER_REVEAL, FOG_ORDER_HIDE, 0, 0]);
  });
});

describe('fogRankNormalise', () => {
  function rank(count) {
    const vals = new Float32Array(count + 50), region = new Uint8Array(count + 50);
    for (let i = 0; i < count; i++) { vals[i] = fogValueNoise(i * .37, 3) * .5 + .25; region[i] = 255; }
    vals.fill(.9, count);
    fogRankNormalise(vals, region, count);
    return { vals, count };
  }

  it('starts the first pixel at 0 and the last at 1 whatever the size', () => {
    for (const count of [30, 600, 9000]) {
      const { vals } = rank(count);
      let lo = 1, hi = 0;
      for (let i = 0; i < count; i++) { lo = Math.min(lo, vals[i]); hi = Math.max(hi, vals[i]); }
      assert.equal(lo, 0);
      assert.equal(hi, 1);
      assert.equal(vals[count + 10], Math.fround(.9), 'outside the region it is left alone');
    }
  });

  it('keeps the order of the pixels', () => {
    const vals = Float32Array.from([.1, .9, .5, .3]), region = Uint8Array.from([1, 1, 1, 1]);
    const before = Array.from(vals);
    fogRankNormalise(vals, region, 4);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (before[i] < before[j]) assert.ok(vals[i] <= vals[j]);
  });

  it('survives a region where every value is equal', () => {
    const vals = new Float32Array(5).fill(.5), region = new Uint8Array(5).fill(1);
    fogRankNormalise(vals, region, 5);
    assert.deepEqual(Array.from(vals), [0, 0, 0, 0, 0]);
  });
});

describe('fogOrderField', () => {
  it('is smooth per pixel and stays in 0..1', () => {
    const gw = 60, gh = 40, region = new Uint8Array(gw * gh).fill(255), vals = new Float32Array(gw * gh);
    fogOrderField(region, gw, gh, 30, vals);
    let worst = 0;
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const v = vals[y * gw + x];
      assert.ok(v >= 0 && v <= 1);
      if (x) worst = Math.max(worst, Math.abs(v - vals[y * gw + x - 1]));
      if (y) worst = Math.max(worst, Math.abs(v - vals[(y - 1) * gw + x]));
    }
    assert.ok(worst < .08);
  });
});

describe('fogEdgeDistance', () => {
  it('is small at the walls and 1 at the deepest point of a region', () => {
    const gw = 21, gh = 11, region = new Uint8Array(gw * gh), out = new Float32Array(gw * gh);
    for (let y = 1; y < 10; y++) for (let x = 1; x < 20; x++) region[y * gw + x] = 255;
    fogEdgeDistance(region, gw, gh, out);
    assert.ok(out[1 * gw + 5] <= 1 / 5 + 1e-6);
    assert.ok(out[5 * gw + 1] <= 1 / 5 + 1e-6);
    assert.equal(Math.max(...out), 1);
    assert.ok(out[5 * gw + 10] > out[5 * gw + 4]);
    assert.equal(out[0], 0);
  });

  it('counts a hole inside the region as a wall', () => {
    const gw = 9, gh = 9, region = new Uint8Array(gw * gh).fill(255), out = new Float32Array(gw * gh);
    region[4 * gw + 4] = 0;
    fogEdgeDistance(region, gw, gh, out);
    assert.ok(out[4 * gw + 5] < out[4 * gw + 7]);
    assert.equal(out[4 * gw + 4], 0);
  });
});

describe('fogShapeRank', () => {
  it('hands the theme each pixel\'s place in the region\'s box, its direction and its edge distance', () => {
    const gw = 12, gh = 8, region = new Uint8Array(gw * gh), vals = new Float32Array(gw * gh).fill(.25);
    const fine = new Float32Array(gw * gh), dist = new Float32Array(gw * gh), seen = [];
    for (let y = 2; y <= 5; y++) for (let x = 3; x <= 8; x++) region[y * gw + x] = (x < 6 ? FOG_ORDER_REVEAL : FOG_ORDER_HIDE);
    fogShapeRank(region, gw, gh, 10, (u, v, n, f, dir, w, vn) => { seen.push({ u, v, n, f, dir, w, vn }); return u; }, vals, fine, dist);
    assert.equal(seen.length, 24);
    assert.equal(Math.min(...seen.map(o => o.u)), 0);
    assert.equal(Math.max(...seen.map(o => o.u)), 1);
    assert.equal(Math.max(...seen.map(o => o.v)), 1);
    assert.deepEqual([...new Set(seen.map(o => o.dir))].sort(), [-1, 1]);
    assert.ok(seen.every(o => o.n === .25 && o.f >= 0 && o.f <= 1 && o.w >= 0 && o.w <= 1 && typeof o.vn === 'function'));
    assert.equal(vals[3 * gw + 3], 0);
    assert.equal(vals[3 * gw + 8], 1);
    assert.equal(vals[0], .25);
  });

  it('leaves everything alone when nothing changed', () => {
    const vals = new Float32Array(16).fill(.5);
    fogShapeRank(new Uint8Array(16), 4, 4, 10, () => 0, vals, new Float32Array(16), new Float32Array(16));
    assert.ok(vals.every(v => v === .5));
  });
});

describe('fogNearestRegion', () => {
  it('points each pixel within reach at its nearest region pixel, and the rest at nothing', () => {
    const gw = 20, gh = 5, region = new Uint8Array(gw * gh), near = new Int32Array(gw * gh);
    region[2 * gw + 3] = 255; region[2 * gw + 14] = 255;
    fogNearestRegion(region, gw, gh, 4, near);
    assert.equal(near[2 * gw + 3], 2 * gw + 3);
    assert.equal(near[2 * gw + 5], 2 * gw + 3);
    assert.equal(near[2 * gw + 7], 2 * gw + 3);
    assert.equal(near[2 * gw + 12], 2 * gw + 14);
    assert.equal(near[0 * gw + 3], 2 * gw + 3);
    assert.equal(near[2 * gw + 9], -1);
    assert.equal(near[2 * gw + 19], -1);
  });

  it('reaches the full radius around a single pixel', () => {
    const gw = 21, gh = 21, region = new Uint8Array(gw * gh), near = new Int32Array(gw * gh), c = 10 * gw + 10;
    region[c] = 255;
    fogNearestRegion(region, gw, gh, 6, near);
    assert.equal(near[c + 6], c);
    assert.equal(near[10 * gw + 4], c);
    assert.equal(near[c + 7], -1);
  });
});

describe('fogTakePixels', () => {
  it('takes every pixel of a change no other change is moving, from the outgoing mask', () => {
    const prev = Uint8Array.from([10, 10, 10]), old = Uint8Array.from([200, 100, 50]), take = new Uint8Array(3);
    const region = Uint8Array.from([255, 0, 0]), ext = Uint8Array.from([255, 255, 0]);
    assert.equal(fogTakePixels(prev, old, region, ext, new Uint8Array(3), new Uint8Array(3), null, take), 0);
    assert.deepEqual(Array.from(prev), [200, 100, 10]);
    assert.deepEqual(Array.from(take), [1, 1, 0]);
  });

  it('starts a changed pixel another change is moving from what the TV shows there now', () => {
    const prev = Uint8Array.from([255]), take = new Uint8Array(1);
    assert.equal(fogTakePixels(prev, Uint8Array.from([0]), Uint8Array.from([FOG_ORDER_HIDE]), Uint8Array.from([FOG_ORDER_HIDE]),
      Uint8Array.from([3]), Uint8Array.from([1]), Uint8Array.from([90]), take), 1);
    assert.equal(prev[0], 90);
    assert.equal(take[0], 1);
  });

  it('leaves a ring pixel to a change still moving it as its own changed pixel', () => {
    const prev = Uint8Array.from([255]), take = Uint8Array.from([1]);
    assert.equal(fogTakePixels(prev, Uint8Array.from([0]), new Uint8Array(1), Uint8Array.from([FOG_ORDER_REVEAL]),
      Uint8Array.from([3]), Uint8Array.from([1]), Uint8Array.from([90]), take), 0);
    assert.equal(prev[0], 255);
    assert.equal(take[0], 0);
  });

  it('takes a ring pixel that is only in the ring of a running change, from the outgoing mask', () => {
    const prev = Uint8Array.from([255]), take = new Uint8Array(1);
    assert.equal(fogTakePixels(prev, Uint8Array.from([40]), new Uint8Array(1), Uint8Array.from([FOG_ORDER_REVEAL]),
      Uint8Array.from([3]), new Uint8Array(1), null, take), 0);
    assert.equal(prev[0], 40);
    assert.equal(take[0], 1);
  });
});

describe('fogChangeOverlaps', () => {
  it('is true only where a changed pixel is still moving', () => {
    assert.equal(fogChangeOverlaps(Uint8Array.from([255, 0]), Uint8Array.from([0, 2])), false);
    assert.equal(fogChangeOverlaps(Uint8Array.from([255, 128]), Uint8Array.from([0, 2])), true);
  });
});
