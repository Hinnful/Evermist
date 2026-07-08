'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { computeOptimalTextureSize, fpsToFrameInterval } = require('../src/video.js');

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

  // ─── 4K display ──────────────────────────────────────────────────────────

  it('does not downscale a 9746×5850 source on a 4K display (source fits within target)', () => {
    // 4K: max(3840,2160)*3 = 11520. Source long = 9746 < 11520 → no downscale.
    const r = computeOptimalTextureSize(3840, 2160, 9746, 5850, 16384, 3);
    assert.deepEqual(r, { w: 9746, h: 5850 });
  });

});

describe('fpsToFrameInterval', () => {

  it('converts 24 fps to ~41.67 ms', () => {
    assert.ok(Math.abs(fpsToFrameInterval(24) - 1000 / 24) < 0.01);
  });

  it('converts 60 fps to ~16.67 ms', () => {
    assert.ok(Math.abs(fpsToFrameInterval(60) - 1000 / 60) < 0.01);
  });

  it('clamps below minimum: fps=2 → interval for fps=5', () => {
    assert.ok(Math.abs(fpsToFrameInterval(2) - 1000 / 5) < 0.01);
  });

  it('clamps above maximum: fps=120 → interval for fps=60', () => {
    assert.ok(Math.abs(fpsToFrameInterval(120) - 1000 / 60) < 0.01);
  });

  it('returns 24-fps interval for undefined input', () => {
    assert.ok(Math.abs(fpsToFrameInterval(undefined) - 1000 / 24) < 0.01);
  });

  it('returns 24-fps interval for NaN input', () => {
    assert.ok(Math.abs(fpsToFrameInterval(NaN) - 1000 / 24) < 0.01);
  });

  it('returns 24-fps interval for zero input', () => {
    assert.ok(Math.abs(fpsToFrameInterval(0) - 1000 / 24) < 0.01);
  });

});
