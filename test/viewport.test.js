'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { calcViewportRect } = require('../src/viewport.js');

describe('calcViewportRect', () => {

  // ─── Basic geometry ───────────────────────────────────────────────────────

  it('returns viewport dims as cw/ch', () => {
    const r = calcViewportRect(0, 0, 1, 1000, 600, 800, 500);
    assert.equal(r.cw, 800);
    assert.equal(r.ch, 500);
  });

  it('zoom=1, map fits in viewport, no pan: full map visible', () => {
    const r = calcViewportRect(0, 0, 1, 800, 500, 800, 500);
    assert.equal(r.srcX, 0);
    assert.equal(r.srcY, 0);
    assert.equal(r.srcW, 800);
    assert.equal(r.srcH, 500);
    assert.equal(r.dstX, 0);
    assert.equal(r.dstY, 0);
    assert.equal(r.dstW, 800);
    assert.equal(r.dstH, 500);
  });

  // ─── Zoom-out: map smaller than viewport ──────────────────────────────────

  it('zoom=0.5: srcW/srcH cover full map, dstW/dstH are half viewport', () => {
    // map 1000×600, vp 800×500, zoom 0.5, no pan
    const r = calcViewportRect(0, 0, 0.5, 1000, 600, 800, 500);
    // srcW = min(1000-0, 800/0.5=1600) = 1000 (full map)
    assert.equal(r.srcX, 0);
    assert.equal(r.srcW, 1000);
    assert.equal(r.dstW, 500); // 1000 * 0.5
  });

  // ─── Pan right: map scrolled so left edge is off-screen ──────────────────

  it('pan right (negative panX): srcX > 0, dstX = 0', () => {
    // panX=-200 means map scrolled 200px left, so srcX = 200/zoom
    const r = calcViewportRect(-200, 0, 1, 1000, 600, 800, 500);
    assert.equal(r.srcX, 200);
    assert.equal(r.dstX, 0);
  });

  it('pan left (positive panX): srcX = 0, dstX = panX', () => {
    const r = calcViewportRect(100, 0, 1, 1000, 600, 800, 500);
    assert.equal(r.srcX, 0);
    assert.equal(r.dstX, 100);
  });

  // ─── srcX/srcY clamped to 0 ──────────────────────────────────────────────

  it('srcX never goes negative (large positive panX)', () => {
    const r = calcViewportRect(500, 0, 1, 1000, 600, 800, 500);
    assert.ok(r.srcX >= 0, `srcX=${r.srcX} should be >= 0`);
  });

  it('srcY never goes negative (large positive panY)', () => {
    const r = calcViewportRect(0, 300, 1, 1000, 600, 800, 500);
    assert.ok(r.srcY >= 0, `srcY=${r.srcY} should be >= 0`);
  });

  // ─── Zoom-in: viewport shows less of the map ─────────────────────────────

  it('zoom=2: srcW = vpW/zoom, dstW = vpW', () => {
    const r = calcViewportRect(0, 0, 2, 1000, 600, 800, 500);
    assert.equal(r.srcW, 400); // 800/2
    assert.equal(r.srcH, 250); // 500/2
    assert.equal(r.dstW, 800); // 400 * 2
    assert.equal(r.dstH, 500); // 250 * 2
  });

  // ─── dstW/dstH = srcW/srcH * zoom (invariant) ────────────────────────────

  it('dstW always equals srcW * zoom', () => {
    const r = calcViewportRect(-150, -80, 1.5, 2000, 1200, 1280, 720);
    assert.ok(Math.abs(r.dstW - r.srcW * 1.5) < 0.001);
    assert.ok(Math.abs(r.dstH - r.srcH * 1.5) < 0.001);
  });

});
