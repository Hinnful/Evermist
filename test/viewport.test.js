'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { calcViewportRect, zoomToFitRegion, visibleMapRegion } = require('../src/viewport.js');

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

describe('zoomToFitRegion', () => {

  // The region the DM can see, in map units, for a viewport of vpW×vpH at `zoom`.
  const region = (vpW, vpH, zoom) => ({ viewW: vpW / zoom, viewH: vpH / zoom });

  // ─── Matching aspect: the region lands exactly, whatever the pixel size ────

  it('same viewport size and aspect: returns the same zoom back', () => {
    const r = region(1280, 720, 2);
    assert.equal(zoomToFitRegion(r.viewW, r.viewH, 1280, 720), 2);
  });

  it('bigger Player canvas, same aspect: zoom scales up by the size ratio', () => {
    // DM 1536×864 @ zoom 1 → 1536×864 map units. TV 1920×1080 must zoom 1.25×
    // to cover the same region, NOT stay at 1 (which is the shipped bug).
    const r = region(1536, 864, 1);
    assert.equal(zoomToFitRegion(r.viewW, r.viewH, 1920, 1080), 1.25);
  });

  it('smaller Player canvas, same aspect: zoom scales down by the size ratio', () => {
    const r = region(1920, 1080, 1);
    assert.equal(zoomToFitRegion(r.viewW, r.viewH, 1536, 864), 0.8);
  });

  // ─── Mismatched aspect: fit, never crop ───────────────────────────────────

  it('DM region wider than the Player: width is the binding constraint', () => {
    // Region 1600×900 (16:9) onto a 1000×1000 square canvas.
    // min(1000/1600, 1000/900) = 0.625 — the width limit.
    assert.equal(zoomToFitRegion(1600, 900, 1000, 1000), 0.625);
  });

  it('DM region taller than the Player: height is the binding constraint', () => {
    // Region 900×1600 onto a 1000×1000 square canvas → min(1.111.., 0.625).
    assert.equal(zoomToFitRegion(900, 1600, 1000, 1000), 0.625);
  });

  it('never crops: the fitted region always covers the DM region on both axes', () => {
    const cases = [
      [1600, 900, 1000, 1000],   // Player squarer than the DM
      [900, 1600, 1000, 1000],   // Player wider than the DM
      [1536, 864, 1920, 1080],   // same aspect, bigger
      [1920, 1080, 1280, 1024],  // 16:9 region onto a 5:4 screen
    ];
    for (const [viewW, viewH, vpW, vpH] of cases) {
      const z = zoomToFitRegion(viewW, viewH, vpW, vpH);
      // What the Player ends up seeing, in map units.
      const shownW = vpW / z, shownH = vpH / z;
      assert.ok(shownW >= viewW - 1e-9, `shownW=${shownW} < viewW=${viewW}`);
      assert.ok(shownH >= viewH - 1e-9, `shownH=${shownH} < viewH=${viewH}`);
    }
  });

  // ─── End-to-end property: matching aspect ⇒ identical region ──────────────

  it('matching aspect, different pixel size: Player region equals DM region', () => {
    // DM 1536×864 @ zoom 1.7, TV 1920×1080. Same 16:9 aspect, 1.25× the pixels.
    const dmVpW = 1536, dmVpH = 864, dmZoom = 1.7;
    const viewW = dmVpW / dmZoom, viewH = dmVpH / dmZoom;
    const playerZoom = zoomToFitRegion(viewW, viewH, 1920, 1080);
    const shownW = 1920 / playerZoom, shownH = 1080 / playerZoom;
    assert.ok(Math.abs(shownW - viewW) < 1e-9, `shownW=${shownW} viewW=${viewW}`);
    assert.ok(Math.abs(shownH - viewH) < 1e-9, `shownH=${shownH} viewH=${viewH}`);
  });

  // ─── Invalid inputs: null, so callers fall back to the raw zoom ───────────

  it('returns null for each non-positive or missing argument', () => {
    assert.equal(zoomToFitRegion(0, 900, 1920, 1080), null);
    assert.equal(zoomToFitRegion(1600, 0, 1920, 1080), null);
    assert.equal(zoomToFitRegion(1600, 900, 0, 1080), null);
    assert.equal(zoomToFitRegion(1600, 900, 1920, 0), null);
    assert.equal(zoomToFitRegion(-1600, 900, 1920, 1080), null);
    assert.equal(zoomToFitRegion(undefined, undefined, 1920, 1080), null);
    assert.equal(zoomToFitRegion(1600, 900, undefined, undefined), null);
    assert.equal(zoomToFitRegion(NaN, 900, 1920, 1080), null);
  });

});

describe('visibleMapRegion', () => {

  const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

  // ─── Zoomed in: viewport wholly inside the map — nothing to clip ───────────

  it('viewport entirely inside the map: returns the viewport rect unchanged', () => {
    // map 2000×1200, vp 800×600 at zoom 1, panned to show map x 300..1100, y 200..800
    const r = visibleMapRegion(-300, -200, 1, 2000, 1200, 800, 600);
    near(r.w, 800, 'w'); near(r.h, 600, 'h');
    near(r.cx, 700, 'cx'); near(r.cy, 500, 'cy');
  });

  it('zoomed in at 2×: region is vp/zoom, still unclipped', () => {
    const r = visibleMapRegion(-600, -400, 2, 2000, 1200, 800, 600);
    near(r.w, 400, 'w'); near(r.h, 300, 'h');
    near(r.cx, 500, 'cx'); near(r.cy, 350, 'cy');
  });

  // ─── Zoomed out: the map sits inside the viewport, margins get trimmed ─────

  it('map entirely inside the viewport: returns the map, not the viewport', () => {
    // map 2000×1200 at zoom 0.25 draws 500×300, centred in an 800×600 canvas.
    const r = visibleMapRegion(150, 150, 0.25, 2000, 1200, 800, 600);
    near(r.w, 2000, 'w'); near(r.h, 1200, 'h');
    near(r.cx, 1000, 'cx'); near(r.cy, 600, 'cy');
  });

  it('the DM case: map fits the height, slack left and right, only width is trimmed', () => {
    // map 2000×1200 at zoom 0.5 draws 1000×600 into a 1400×600 canvas: 200px slack
    // each side, none vertically.
    const r = visibleMapRegion(200, 0, 0.5, 2000, 1200, 1400, 600);
    near(r.w, 2000, 'w');   // clipped from 2800 map-units of viewport
    near(r.h, 1200, 'h');   // vertical was already exact
    near(r.cx, 1000, 'cx'); near(r.cy, 600, 'cy');
  });

  // ─── Partial overlap: the map edge crosses the viewport ───────────────────

  it('map edge inside the viewport: clips that side and shifts the centre', () => {
    // vp covers map x -200..600 — the left 200 units are off-map.
    const r = visibleMapRegion(200, 0, 1, 2000, 1200, 800, 600);
    near(r.w, 600, 'w');    // 0..600, not -200..600
    near(r.cx, 300, 'cx');  // centre moved off the viewport centre, by design
    near(r.h, 600, 'h');
  });

  it('clips the far edge too (viewport running past the map bottom-right)', () => {
    // vp covers map x 1600..2400, y 800..1400 against a 2000×1200 map.
    const r = visibleMapRegion(-1600, -800, 1, 2000, 1200, 800, 600);
    near(r.w, 400, 'w');  near(r.cx, 1800, 'cx');
    near(r.h, 400, 'h');  near(r.cy, 1000, 'cy');
  });

  // ─── The property that makes clipping safe ────────────────────────────────

  it('never drops map the viewport shows: clipped region contains the overlap', () => {
    const cases = [
      [-300, -200, 1, 800, 600],
      [200, 0, 0.5, 1400, 600],
      [200, 0, 1, 800, 600],
      [-1600, -800, 1, 800, 600],
      [150, 150, 0.25, 800, 600],
    ];
    for (const [px, py, z, vpW, vpH] of cases) {
      const r = visibleMapRegion(px, py, z, 2000, 1200, vpW, vpH);
      // The viewport's own map-space rect, and the map, and the returned region.
      const vx0 = -px / z, vx1 = (vpW - px) / z, vy0 = -py / z, vy1 = (vpH - py) / z;
      const ox0 = Math.max(0, vx0), ox1 = Math.min(2000, vx1);
      const oy0 = Math.max(0, vy0), oy1 = Math.min(1200, vy1);
      const rx0 = r.cx - r.w / 2, rx1 = r.cx + r.w / 2;
      const ry0 = r.cy - r.h / 2, ry1 = r.cy + r.h / 2;
      assert.ok(rx0 <= ox0 + 1e-9 && rx1 >= ox1 - 1e-9, `x overlap not covered: ${JSON.stringify(r)}`);
      assert.ok(ry0 <= oy0 + 1e-9 && ry1 >= oy1 - 1e-9, `y overlap not covered: ${JSON.stringify(r)}`);
      // And it never grows past the viewport itself.
      assert.ok(r.w <= vx1 - vx0 + 1e-9 && r.h <= vy1 - vy0 + 1e-9, 'region exceeds viewport');
    }
  });

  // ─── Degenerate: nothing to clip to ───────────────────────────────────────

  it('viewport entirely off the map: falls back to the raw viewport rect', () => {
    // Map pushed 3000px right of an 800-wide canvas — no map on screen at all.
    const r = visibleMapRegion(3000, 0, 1, 2000, 1200, 800, 600);
    near(r.w, 800, 'w'); near(r.h, 600, 'h');
    near(r.cx, -2600, 'cx');
  });

  it('zero-size map: falls back rather than returning a degenerate region', () => {
    const r = visibleMapRegion(0, 0, 1, 0, 0, 800, 600);
    near(r.w, 800, 'w'); near(r.h, 600, 'h');
  });

  // ─── End to end with zoomToFitRegion: the DM case lands tight ─────────────

  it('zoomed out: clipping fills the TV vertically where the raw rect letterboxed', () => {
    // The reported case. DM canvas 2000×1050 (1.90:1). Map 2000×1400 (1.43:1) fitted to
    // the DM's height at zoom 0.75, so it draws 1500 wide with 250px slack each side.
    // TV 1281×806 (1.589:1).
    const panX = 250, panY = 0, z = 0.75, vpW = 2000, vpH = 1050, mapW = 2000, mapH = 1400;
    const tvW = 1281, tvH = 806;

    const rawZoom  = zoomToFitRegion(vpW / z, vpH / z, tvW, tvH);
    const clipped  = visibleMapRegion(panX, panY, z, mapW, mapH, vpW, vpH);
    const clipZoom = zoomToFitRegion(clipped.w, clipped.h, tvW, tvH);

    // Raw: the TV shows more height than the map even has — dead bands top and bottom.
    assert.ok(tvH / rawZoom > mapH, `expected vertical slack, got ${tvH / rawZoom}`);
    // Clipped: the map fills the TV's height exactly, slack only on the other axis.
    near(tvH / clipZoom, mapH, 'clipped shown height');
    assert.ok(tvW / clipZoom > clipped.w, 'horizontal slack is the irreducible remainder');
    // And the map lands materially bigger on the TV.
    assert.ok(clipZoom / rawZoom > 1.15, `expected >15% bigger, got ${clipZoom / rawZoom}`);
  });

  it('zoomed in with map on every edge: clipping changes nothing at all', () => {
    // The case that matters most — this is how the map is framed during play. Clipping
    // must be a no-op here, so Sync View behaves exactly as it did before.
    const z = 2, vpW = 2000, vpH = 1050;
    const panX = -4000, panY = -2000, mapW = 9000, mapH = 6000;

    const r = visibleMapRegion(panX, panY, z, mapW, mapH, vpW, vpH);
    near(r.w, vpW / z, 'width');
    near(r.h, vpH / z, 'height');
    near(r.cx, (vpW / 2 - panX) / z, 'cx');
    near(r.cy, (vpH / 2 - panY) / z, 'cy');
  });

});
