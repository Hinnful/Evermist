'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeOptimalTextureSize, coverageFactorFor,
  mapRegionForTexture, clampRegionToMap,
} = require('../src/video.js');

// Helpers
function aspectRatio(w, h) { return w / h; }
const EPSILON = 0.02; // 2% tolerance for aspect-ratio rounding checks

describe('computeOptimalTextureSize', () => {

  // ─── No downscale needed ──────────────────────────────────────────────────

  it('returns source dims when source is already smaller than target', () => {
    // 1920×1080 display, cf=3 → target long = 5760. Source 1024×768 is well under.
    const r = computeOptimalTextureSize(1920, 1080, 1024, 768, 16384, 3);
    assert.deepEqual(r, { w: 1024, h: 768 });
  });

  it('returns source dims when source exactly equals target', () => {
    // 1920×1080, cf=1 → target = 1920. Source 1920×1080.
    const r = computeOptimalTextureSize(1920, 1080, 1920, 1080, 16384, 1);
    assert.deepEqual(r, { w: 1920, h: 1080 });
  });

  // ─── scale >= 1 boundary ─────────────────────────────────────────────────
  // NOTE: the `scale >= 1` vs `scale > 1` mutant is a known-benign survivor.
  // At scale === 1 both branches return source dims, so output is identical —
  // cannot be killed by assertion alone.

  it('scale just above 1: source smaller than target → no downscale', () => {
    // dispW=dispH=1001, cf=1, srcW=srcH=1000 → scale=1.001 → returns source
    const r = computeOptimalTextureSize(1001, 1001, 1000, 1000, 16384, 1);
    assert.deepEqual(r, { w: 1000, h: 1000 });
  });

  it('scale just below 1: source larger than target → downscales', () => {
    // dispW=dispH=999, cf=1, srcW=srcH=1000 → scale=0.999 → downscaled
    const r = computeOptimalTextureSize(999, 999, 1000, 1000, 16384, 1);
    assert.ok(r.w < 1000 && r.h < 1000, `expected downscale, got ${r.w}x${r.h}`);
  });

  // ─── Downscale needed ────────────────────────────────────────────────────

  it('downscales a large landscape map for a 1080p display', () => {
    // 9746×5850 source, 1920×1080 display, cf=3 → target long = 5760
    // scale = 5760/9746 ≈ 0.5910 → 5757×3457 (rounding)
    const r = computeOptimalTextureSize(1920, 1080, 9746, 5850, 16384, 3);
    assert.ok(r.w < 9746, 'width should be reduced');
    assert.ok(r.h < 5850, 'height should be reduced');
    // Long axis should be close to target (within 1px rounding)
    assert.ok(Math.abs(Math.max(r.w, r.h) - 5760) <= 1, `long axis ${Math.max(r.w, r.h)} should be ~5760`);
  });

  it('downscales a large portrait map for a 1080p display', () => {
    // 4000×6000 portrait source, 1920×1080 display, cf=3 → target long = 5760
    // scale = 5760/6000 = 0.96 → 3840×5760
    const r = computeOptimalTextureSize(1920, 1080, 4000, 6000, 16384, 3);
    assert.ok(r.w < 4000);
    assert.ok(Math.abs(Math.max(r.w, r.h) - 5760) <= 1);
  });

  // ─── coverageFactor effect ────────────────────────────────────────────────

  it('higher coverageFactor produces a larger texture (up to source)', () => {
    const r1 = computeOptimalTextureSize(1920, 1080, 9746, 5850, 16384, 2);
    const r2 = computeOptimalTextureSize(1920, 1080, 9746, 5850, 16384, 3);
    const r3 = computeOptimalTextureSize(1920, 1080, 9746, 5850, 16384, 10); // over-large → clamps to source
    assert.ok(r2.w > r1.w, 'cf=3 should produce wider texture than cf=2');
    assert.deepEqual(r3, { w: 9746, h: 5850 }, 'cf=10 should clamp to source');
  });

  // ─── per-view coverage ────────────────────────────────────────────────────
  // The Player gets less zoom headroom than the DM on purpose: it shows the whole map,
  // and on an animated map its texture is re-uploaded to the GPU every frame, so the
  // area is a per-frame cost. The DM zooms in to draw rooms and keeps the full 3×.

  it('the Player gets less zoom headroom than the DM', () => {
    assert.ok(coverageFactorFor(true) < coverageFactorFor(false),
      'Player coverage must stay below DM coverage');
  });

  it('holds the tuned coverage values', () => {
    assert.equal(coverageFactorFor(false), 3);
    assert.equal(coverageFactorFor(true), 2);
  });

  it('leaves an ordinary map at its own resolution on the Player', () => {
    // A 4320×2592 map on a 2560-wide panel sits under the 2× target, so the Player keeps
    // every source pixel. The saving is aimed at the oversized export, not this one.
    const r = computeOptimalTextureSize(2560, 1392, 4320, 2592, 16384, coverageFactorFor(true));
    assert.deepEqual(r, { w: 4320, h: 2592 });
  });

  it('more than halves the texture for an oversized export', () => {
    const dm     = computeOptimalTextureSize(2560, 1392, 12900, 11700, 16384, coverageFactorFor(false));
    const player = computeOptimalTextureSize(2560, 1392, 12900, 11700, 16384, coverageFactorFor(true));
    assert.ok((dm.w * dm.h) / (player.w * player.h) > 2,
      'Player texture must be less than half the DM texture on an oversized map');
  });

  it('Player coverage still resolves the whole map 1:1 at fit-to-screen', () => {
    // Fit-to-screen puts the map's long axis across the display's long axis, so a
    // coverage of 1 is the 1:1 floor. Anything below that is soft before the DM zooms.
    assert.ok(coverageFactorFor(true) >= 1,
      'Player coverage below 1 would blur a map that merely fits the screen');
  });

  it('coverage is the area lever — area scales with its square', () => {
    const a = computeOptimalTextureSize(2560, 1392, 12900, 11700, 16384, 1);
    const b = computeOptimalTextureSize(2560, 1392, 12900, 11700, 16384, 2);
    const ratio = (b.w * b.h) / (a.w * a.h);
    assert.ok(ratio > 3.9 && ratio < 4.1, `expected ~4× area ratio, got ${ratio.toFixed(2)}`);
  });

  it('never upscales a small map to the Player target', () => {
    const r = computeOptimalTextureSize(2560, 1392, 2048, 1536, 16384, coverageFactorFor(true));
    assert.deepEqual(r, { w: 2048, h: 1536 });
  });

  it('missing coverageFactor argument falls back to module default (3)', () => {
    const withDefault   = computeOptimalTextureSize(1920, 1080, 9746, 5850, 16384);
    const withExplicit3 = computeOptimalTextureSize(1920, 1080, 9746, 5850, 16384, 3);
    assert.deepEqual(withDefault, withExplicit3);
  });

  // ─── maxTex clamp ────────────────────────────────────────────────────────

  it('clamps to maxTex when target exceeds it', () => {
    // 4K display, cf=3 → target = 11520. Source 9746×5850 clamps to source (9746).
    // But with a tiny maxTex=2048 it should clamp there.
    const r = computeOptimalTextureSize(1920, 1080, 9746, 5850, 2048, 3);
    assert.ok(r.w <= 2048, `w=${r.w} should be ≤ 2048`);
    assert.ok(r.h <= 2048, `h=${r.h} should be ≤ 2048`);
  });

  it('maxTex clamp preserves aspect ratio', () => {
    const src = { w: 9746, h: 5850 };
    const r = computeOptimalTextureSize(1920, 1080, src.w, src.h, 2048, 3);
    const origRatio = aspectRatio(src.w, src.h);
    const newRatio  = aspectRatio(r.w, r.h);
    assert.ok(Math.abs(newRatio - origRatio) < EPSILON,
      `aspect ratio drift: ${newRatio.toFixed(4)} vs ${origRatio.toFixed(4)}`);
  });

  // ─── Never upscale ───────────────────────────────────────────────────────

  it('never upscales: returns source when display is tiny', () => {
    // 320×240 display, cf=3 → target = 960. Source 640×480 is larger → downscale.
    // But source 200×150 is smaller → no upscale.
    const r = computeOptimalTextureSize(320, 240, 200, 150, 16384, 3);
    assert.deepEqual(r, { w: 200, h: 150 });
  });

  it('never upscales even when coverageFactor is huge', () => {
    const r = computeOptimalTextureSize(1920, 1080, 100, 75, 16384, 100);
    assert.deepEqual(r, { w: 100, h: 75 });
  });

  // ─── Aspect ratio preservation ───────────────────────────────────────────

  it('preserves aspect ratio within rounding tolerance', () => {
    const src = { w: 9746, h: 5850 };
    const r = computeOptimalTextureSize(1920, 1080, src.w, src.h, 16384, 3);
    const origRatio = aspectRatio(src.w, src.h);
    const newRatio  = aspectRatio(r.w, r.h);
    assert.ok(Math.abs(newRatio - origRatio) < EPSILON,
      `aspect ratio drift: ${newRatio.toFixed(4)} vs ${origRatio.toFixed(4)}`);
  });

  // ─── Zero / absent input guards ──────────────────────────────────────────

  it('returns {w:0,h:0} when source is zero', () => {
    const r = computeOptimalTextureSize(1920, 1080, 0, 0, 16384, 3);
    assert.deepEqual(r, { w: 0, h: 0 });
  });

  it('returns source dims when dispW is zero (displayInfo not available yet)', () => {
    const r = computeOptimalTextureSize(0, 0, 9746, 5850, 16384, 3);
    assert.deepEqual(r, { w: 9746, h: 5850 });
  });

  it('returns source dims when dispW is undefined', () => {
    const r = computeOptimalTextureSize(undefined, undefined, 9746, 5850, 16384, 3);
    assert.deepEqual(r, { w: 9746, h: 5850 });
  });

  it('handles null maxTex gracefully (treats as no cap)', () => {
    const r = computeOptimalTextureSize(1920, 1080, 9746, 5850, null, 3);
    const rInf = computeOptimalTextureSize(1920, 1080, 9746, 5850, Infinity, 3);
    assert.deepEqual(r, rInf);
  });

  // ─── One axis zero, not both ─────────────────────────────────────────────
  // ⚠ EVERY GUARD CASE ABOVE ZEROES BOTH AXES AT ONCE, which is the one shape that cannot tell
  // `||` from `&&`: with 0 and 0 both readings of the condition are true. A half-formed record
  // — one dimension read, the other still 0 — is also the real one, since that is what a
  // display push or a decode looks like partway through.

  it('a source with only its height zero returns unchanged, not downscaled', () => {
    // Big enough that falling past the guard would resize the width to 1920.
    const r = computeOptimalTextureSize(1920, 1080, 5000, 0, 16384, 1);
    assert.deepEqual(r, { w: 5000, h: 0 });
  });

  it('a source with only its width zero returns unchanged, not downscaled', () => {
    const r = computeOptimalTextureSize(1920, 1080, 0, 5000, 16384, 1);
    assert.deepEqual(r, { w: 0, h: 5000 });
  });

  it('a display with only its height zero returns source dims', () => {
    const r = computeOptimalTextureSize(1920, 0, 9746, 5850, 16384, 3);
    assert.deepEqual(r, { w: 9746, h: 5850 });
  });

  it('a display with only its width zero returns source dims', () => {
    const r = computeOptimalTextureSize(0, 1080, 9746, 5850, 16384, 3);
    assert.deepEqual(r, { w: 9746, h: 5850 });
  });

  // ─── The two `> 0` guards, at zero and below ─────────────────────────────

  it('a zero coverage factor falls back to the default rather than collapsing the texture', () => {
    // Taking 0 as valid makes targetLong 0, so scale is 0 and the texture comes out 0x0.
    const r = computeOptimalTextureSize(1920, 1080, 9746, 5850, 16384, 0);
    const withDefault = computeOptimalTextureSize(1920, 1080, 9746, 5850, 16384, 3);
    assert.deepEqual(r, withDefault);
    assert.ok(r.w > 0 && r.h > 0, `expected a real texture, got ${r.w}x${r.h}`);
  });

  it('a negative coverage factor falls back to the default', () => {
    const r = computeOptimalTextureSize(1920, 1080, 9746, 5850, 16384, -2);
    assert.deepEqual(r, computeOptimalTextureSize(1920, 1080, 9746, 5850, 16384, 3));
  });

  it('a zero maxTex means no cap, not a cap of zero', () => {
    const r = computeOptimalTextureSize(1920, 1080, 9746, 5850, 0, 3);
    assert.deepEqual(r, computeOptimalTextureSize(1920, 1080, 9746, 5850, Infinity, 3));
    assert.ok(r.w > 0 && r.h > 0, `expected a real texture, got ${r.w}x${r.h}`);
  });

  it('a negative maxTex means no cap', () => {
    const r = computeOptimalTextureSize(1920, 1080, 9746, 5850, -1, 3);
    assert.deepEqual(r, computeOptimalTextureSize(1920, 1080, 9746, 5850, Infinity, 3));
  });

  // Both guards test the TYPE as well as the sign, and a string of digits is the shape that
  // slips past a sign check alone: '5' > 0 is true, and the arithmetic downstream coerces it
  // silently rather than throwing.
  it('a numeric string coverage factor is refused, not coerced', () => {
    const r = computeOptimalTextureSize(1920, 1080, 9746, 5850, 16384, '5');
    assert.deepEqual(r, computeOptimalTextureSize(1920, 1080, 9746, 5850, 16384, 3));
  });

  it('a numeric string maxTex is refused, not coerced', () => {
    const r = computeOptimalTextureSize(1920, 1080, 9746, 5850, '2048', 3);
    assert.deepEqual(r, computeOptimalTextureSize(1920, 1080, 9746, 5850, Infinity, 3));
  });

  // ─── scale exactly 1, where the cap would otherwise bite ─────────────────
  // The note above says `scale >= 1` vs `scale > 1` cannot be told apart. It can, but only
  // where taking the long way round would then hit the clamp: returning source dims skips the
  // cap entirely, which is the behaviour that matters when a map is exactly display-sized.

  it('scale of exactly 1 returns source dims even when they exceed maxTex', () => {
    // 1000x1000 display, cf=1 → target 1000. Source long side 1000 → scale exactly 1.
    const r = computeOptimalTextureSize(1000, 1000, 1000, 500, 800, 1);
    assert.deepEqual(r, { w: 1000, h: 500 });
  });

  // ─── The cap, with one axis over it and one under ────────────────────────
  // Either axis over the cap has to trigger the clamp on its own; a check that needs both
  // lets a wide map through at full width.

  it('clamps when only the width is over maxTex', () => {
    // 1000x1000 display, cf=1, source 4000x1000 → scale 0.25 → 1000x250, cap 500.
    const r = computeOptimalTextureSize(1000, 1000, 4000, 1000, 500, 1);
    assert.deepEqual(r, { w: 500, h: 125 });
  });

  it('clamps when only the height is over maxTex', () => {
    // The same map stood on end: 250x1000 against a cap of 500.
    const r = computeOptimalTextureSize(1000, 1000, 1000, 4000, 500, 1);
    assert.deepEqual(r, { w: 125, h: 500 });
  });

  // ─── 4K display ──────────────────────────────────────────────────────────

  it('does not downscale a 9746×5850 source on a 4K display (source fits within target)', () => {
    // 4K: max(3840,2160)*3 = 11520. Source long = 9746 < 11520 → no downscale.
    const r = computeOptimalTextureSize(3840, 2160, 9746, 5850, 16384, 3);
    assert.deepEqual(r, { w: 9746, h: 5850 });
  });

});


// ─── Viewport-sized region texture ────────────────────────────────────────────
// The property that matters is not the numbers, it is that the sprite this feeds lands
// on the SAME screen rectangle whatever the camera does. A drift here is the bright or
// dark rim at the map boundary that the hybrid fog architecture exists to avoid.

describe('mapRegionForTexture', () => {
  const TEX_W = 2624, TEX_H = 1456;   // 2560×1392 viewport + 32px margin each side
  const VP_W = 2560, VP_H = 1392;

  // Where the sprite's top-left lands on screen, given the stage transform.
  function screenX(r, panX, zoom) { return r.x * zoom + panX; }
  function screenY(r, panY, zoom) { return r.y * zoom + panY; }

  it('the sprite screen rect is identical under any pan', () => {
    const a = mapRegionForTexture(0,     0,    1, TEX_W, TEX_H, VP_W, VP_H);
    const b = mapRegionForTexture(-4000, 900,  1, TEX_W, TEX_H, VP_W, VP_H);
    assert.ok(Math.abs(screenX(a, 0, 1) - screenX(b, -4000, 1)) < 1e-6);
    assert.ok(Math.abs(screenY(a, 0, 1) - screenY(b, 900, 1)) < 1e-6);
  });

  it('the sprite screen rect is identical under any zoom', () => {
    const a = mapRegionForTexture(-500, -300, 0.25, TEX_W, TEX_H, VP_W, VP_H);
    const b = mapRegionForTexture(-500, -300, 3.5,  TEX_W, TEX_H, VP_W, VP_H);
    assert.ok(Math.abs(screenX(a, -500, 0.25) - screenX(b, -500, 3.5)) < 1e-6);
    assert.ok(Math.abs(screenY(a, -300, 0.25) - screenY(b, -300, 3.5)) < 1e-6);
  });

  it('that screen rect is the viewport grown by the margin', () => {
    const r = mapRegionForTexture(137, -820, 0.83, TEX_W, TEX_H, VP_W, VP_H);
    assert.ok(Math.abs(screenX(r, 137, 0.83) - (VP_W - TEX_W) / 2) < 1e-6);
    assert.ok(Math.abs(r.w * 0.83 - TEX_W) < 1e-6);
  });

  it('one texel per screen pixel at every zoom', () => {
    for (const z of [0.05, 0.274, 1, 2, 7.5]) {
      const r = mapRegionForTexture(0, 0, z, TEX_W, TEX_H, VP_W, VP_H);
      assert.ok(Math.abs(r.w * z - TEX_W) < 1e-6, `zoom ${z} lost the 1:1 ratio`);
    }
  });

  it('is centred on the viewport centre in map space', () => {
    const panX = -1200, panY = -640, zoom = 1.5;
    const r = mapRegionForTexture(panX, panY, zoom, TEX_W, TEX_H, VP_W, VP_H);
    assert.ok(Math.abs((r.x + r.w / 2) - (VP_W / 2 - panX) / zoom) < 1e-9);
    assert.ok(Math.abs((r.y + r.h / 2) - (VP_H / 2 - panY) / zoom) < 1e-9);
  });
});

describe('clampRegionToMap', () => {
  const MAP_W = 4320, MAP_H = 2592;

  it('region fully inside the map → drawn whole, no clear needed', () => {
    const r = { x: 500, y: 400, w: 1000, h: 600 };
    const c = clampRegionToMap(r, MAP_W, MAP_H, 1);
    assert.deepEqual(
      { sx: c.sx, sy: c.sy, sw: c.sw, sh: c.sh }, { sx: 500, sy: 400, sw: 1000, sh: 600 });
    assert.deepEqual({ dx: c.dx, dy: c.dy }, { dx: 0, dy: 0 });
    assert.equal(c.clear, false);
  });

  it('overhanging the top-left → source clamped, destination offset to match', () => {
    const zoom = 2;
    const r = { x: -100, y: -50, w: 1000, h: 600 };
    const c = clampRegionToMap(r, MAP_W, MAP_H, zoom);
    assert.equal(c.sx, 0);
    assert.equal(c.sy, 0);
    assert.equal(c.dx, 200);   // the 100 map-px gap, in texture pixels
    assert.equal(c.dy, 100);
    assert.equal(c.clear, true);
  });

  it('overhanging the bottom-right → source trimmed to the map edge', () => {
    const r = { x: MAP_W - 200, y: MAP_H - 100, w: 1000, h: 600 };
    const c = clampRegionToMap(r, MAP_W, MAP_H, 1);
    assert.equal(c.sw, 200);
    assert.equal(c.sh, 100);
    assert.equal(c.dx, 0);
    assert.equal(c.clear, true);
  });

  it('map smaller than the region → the whole map, centred by dx/dy', () => {
    const zoom = 0.25;
    const r = { x: -2000, y: -1000, w: 20000, h: 12000 };
    const c = clampRegionToMap(r, MAP_W, MAP_H, zoom);
    assert.equal(c.sx, 0); assert.equal(c.sy, 0);
    assert.equal(c.sw, MAP_W); assert.equal(c.sh, MAP_H);
    assert.equal(c.dx, 500); assert.equal(c.dy, 250);
    assert.equal(c.dw, MAP_W * zoom);
    assert.equal(c.clear, true);
  });

  it('region entirely off the map → null, so the caller clears instead of drawing', () => {
    assert.equal(clampRegionToMap({ x: -5000, y: 0, w: 1000, h: 600 }, MAP_W, MAP_H, 1), null);
    assert.equal(clampRegionToMap({ x: 0, y: MAP_H + 10, w: 100, h: 50 }, MAP_W, MAP_H, 1), null);
  });

  it('destination scale always equals the source size times zoom', () => {
    const zoom = 1.75;
    const c = clampRegionToMap({ x: -300, y: -300, w: 5000, h: 3000 }, MAP_W, MAP_H, zoom);
    assert.ok(Math.abs(c.dw - c.sw * zoom) < 1e-9);
    assert.ok(Math.abs(c.dh - c.sh * zoom) < 1e-9);
  });

  it('the clamped source rect never leaves the video frame', () => {
    for (const r of [
      { x: -9999, y: -9999, w: 20000, h: 20000 },
      { x: MAP_W - 1, y: MAP_H - 1, w: 5000, h: 5000 },
      { x: 10, y: 10, w: 1, h: 1 },
    ]) {
      const c = clampRegionToMap(r, MAP_W, MAP_H, 1);
      if (!c) continue;
      assert.ok(c.sx >= 0 && c.sy >= 0, 'source origin went negative');
      assert.ok(c.sx + c.sw <= MAP_W + 1e-9, 'source ran past the map width');
      assert.ok(c.sy + c.sh <= MAP_H + 1e-9, 'source ran past the map height');
    }
  });
});
