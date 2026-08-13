'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { fitInsideBox } = require('../src/mapConvert.js');

// The real box (state.js MAP_BOX_W/H). Repeated here rather than imported: state.js is
// browser-only globals with no export guard.
const BOX_W = 3840, BOX_H = 2160;

const aspect = r => r.w / r.h;

describe('fitInsideBox', () => {

  // ─── Already inside the box: no re-encode ─────────────────────────────────
  // changed:false is what stops a pointless pass, which would cost a generation of
  // quality and a realtime wait for nothing.

  it('leaves a map smaller than the box completely alone', () => {
    assert.deepEqual(fitInsideBox(1920, 1080, BOX_W, BOX_H), { w: 1920, h: 1080, changed: false });
  });

  it('leaves a map that exactly fills the box alone', () => {
    assert.deepEqual(fitInsideBox(BOX_W, BOX_H, BOX_W, BOX_H), { w: 3840, h: 2160, changed: false });
  });

  it('never upscales a small map to fill the box', () => {
    const r = fitInsideBox(800, 600, BOX_W, BOX_H);
    assert.equal(r.changed, false);
    assert.ok(r.w <= 800 && r.h <= 600);
  });

  it('reports no change for a map that fits on one axis and exactly on the other', () => {
    // 3840 wide, well under on height — inside the box, so untouched.
    assert.deepEqual(fitInsideBox(3840, 1200, BOX_W, BOX_H), { w: 3840, h: 1200, changed: false });
  });

  // ─── Real Dungeon Alchemist exports ──────────────────────────────────────

  it('fits a wide export by its width', () => {
    const r = fitInsideBox(6150, 2850, BOX_W, BOX_H);
    assert.equal(r.changed, true);
    assert.equal(r.w, 3840);
    assert.ok(r.h <= BOX_H);
    assert.ok(Math.abs(aspect(r) - 6150 / 2850) < 0.01, 'aspect ratio preserved');
  });

  it('fits a squarer export by its height, not its width', () => {
    // 4500×4050 scaled to width 3840 would be 3456 tall — over the box. Height binds.
    const r = fitInsideBox(4500, 4050, BOX_W, BOX_H);
    assert.equal(r.changed, true);
    assert.equal(r.h, 2160);
    assert.ok(r.w <= BOX_W, 'width stays inside the box');
    assert.ok(Math.abs(aspect(r) - 4500 / 4050) < 0.01, 'aspect ratio preserved');
  });

  it('never returns a side outside the box, over a spread of real shapes', () => {
    const shapes = [
      [6150, 2850], [4500, 4050], [12900, 11700], [10000, 6000],
      [7681, 4321], [3841, 2161], [5000, 999], [999, 5000],
    ];
    for (const [w, h] of shapes) {
      const r = fitInsideBox(w, h, BOX_W, BOX_H);
      assert.ok(r.w <= BOX_W, `${w}x${h} → w ${r.w} outside box`);
      assert.ok(r.h <= BOX_H, `${w}x${h} → h ${r.h} outside box`);
      assert.ok(r.w <= w && r.h <= h, `${w}x${h} was upscaled`);
    }
  });

  // ─── Even dimensions ─────────────────────────────────────────────────────
  // H.264's chroma planes are half-resolution in both axes, so an odd side is either
  // rejected or silently padded. Rounding is DOWN so it can't push a side back out.

  it('returns even dimensions on every shape it changes', () => {
    const shapes = [
      [6150, 2851], [4501, 4050], [5555, 3333], [9999, 1111],
      [6151, 2853], [7777, 4443], [4097, 4095],
    ];
    for (const [w, h] of shapes) {
      const r = fitInsideBox(w, h, BOX_W, BOX_H);
      assert.equal(r.w % 2, 0, `${w}x${h} → odd width ${r.w}`);
      assert.equal(r.h % 2, 0, `${w}x${h} → odd height ${r.h}`);
      assert.ok(r.w <= BOX_W && r.h <= BOX_H, `${w}x${h} rounded outside the box`);
    }
  });

  it('rounds a fractional fit down rather than up', () => {
    // 4000×2001 → scale 0.96 → 3840×1921 → down to 1920.
    const r = fitInsideBox(4000, 2001, BOX_W, BOX_H);
    assert.equal(r.w, 3840);
    assert.equal(r.h, 1920);
  });

  it('keeps a sliver at least 2px on its short side', () => {
    // Extreme aspect: the short side rounds toward zero, which would be an invalid canvas.
    const r = fitInsideBox(100000, 3, BOX_W, BOX_H);
    assert.ok(r.w >= 2 && r.h >= 2);
    assert.equal(r.w % 2, 0);
    assert.equal(r.h % 2, 0);
  });

  // ─── Absent or nonsense input ────────────────────────────────────────────
  // A video whose dimensions never arrived must report no change, so the caller
  // hands the original file straight through instead of encoding a 0×0 canvas.

  it('reports no change for zero, absent or negative source dimensions', () => {
    for (const args of [[0, 0], [0, 1080], [1920, 0], [-100, 200], [NaN, 1080],
                        [undefined, undefined], [null, null]]) {
      const r = fitInsideBox(args[0], args[1], BOX_W, BOX_H);
      assert.equal(r.changed, false, `${args[0]}x${args[1]} claimed a change`);
    }
  });

  it('reports no change for a missing or nonsense box', () => {
    assert.equal(fitInsideBox(6150, 2850, 0, 0).changed, false);
    assert.equal(fitInsideBox(6150, 2850, undefined, undefined).changed, false);
    // And hands the source back untouched, so a caller that ignores `changed` still works.
    assert.deepEqual(fitInsideBox(6150, 2850, NaN, NaN), { w: 6150, h: 2850, changed: false });
  });
});
