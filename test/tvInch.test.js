'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  tvWidthInches, tvInchZoom, tvInchCellPx, tvInchMatchScreen, tvSizeValid, tvBelievable, tvSizePick, tvSizeKey, tvSizesRead,
} = require('../src/player/tvInch.js');

const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1e-9 : eps);

// One 55-inch 4K TV as Windows reports it at 100%, 150% and 200% display scaling.
const tvAt = sf => ({ label: 'LG TV', scaleFactor: sf, size: { width: 3840 / sf, height: 2160 / sf } });
const GLASS_W = 55 * 16 / Math.hypot(16, 9);   // inches across the 16:9 glass
const PHYS_PER_INCH = 3840 / GLASS_W;

describe('tvWidthInches', () => {
  it('takes the width from the diagonal and the pixel shape', () => {
    assert.ok(near(tvWidthInches(55, 3840, 2160), GLASS_W));
    assert.ok(near(tvWidthInches(50, 1600, 1200), 40));
  });
  it('answers null for no diagonal or no pixels', () => {
    assert.equal(tvWidthInches(0, 1920, 1080), null);
    assert.equal(tvWidthInches(55, 0, 1080), null);
  });
});

describe('tvInchZoom', () => {
  for (const sf of [1, 1.5, 2]) {
    it('makes one cell 1.1 inches of glass at scaleFactor ' + sf, () => {
      const z = tvInchZoom(55, tvAt(sf), 70);
      const cellPhysPx = z * 70 * sf;
      assert.ok(near(cellPhysPx / PHYS_PER_INCH, 1.1, 1e-9), 'a cell came out ' + cellPhysPx / PHYS_PER_INCH + ' inches');
    });
  }
  it('gives the CSS zoom the Player draws with at 100%', () => {
    assert.ok(near(tvInchZoom(55, tvAt(1), 70), 1.1 * PHYS_PER_INCH / 70));
  });
  it('halves for a cell twice as wide', () => {
    assert.ok(near(tvInchZoom(55, tvAt(1.5), 140) * 2, tvInchZoom(55, tvAt(1.5), 70)));
  });
  it('reads a display with no scaleFactor as 100%', () => {
    const d = { size: { width: 1920, height: 1080 } };
    assert.ok(near(tvInchZoom(55, d, 70), tvInchZoom(55, { ...d, scaleFactor: 1 }, 70)));
  });
  it('answers null with no size, no display or no cell', () => {
    assert.equal(tvInchZoom(0, tvAt(1), 70), null);
    assert.equal(tvInchZoom(55, null, 70), null);
    assert.equal(tvInchZoom(55, tvAt(1), 0), null);
  });
});

describe('tvInchCellPx', () => {
  it('fits a base to a square side', () => {
    assert.equal(tvInchCellPx({ mode: 'square', cellSize: 100 }), 100);
  });
  it('fits a base across a hex flat to flat, not its grid size', () => {
    assert.ok(near(tvInchCellPx({ mode: 'hex-pointy', cellSize: 100 }), 100 * Math.sqrt(3)));
  });
  it('gives 0 for no grid', () => {
    assert.equal(tvInchCellPx(null), 0);
    assert.equal(tvInchCellPx({ mode: 'square', cellSize: 0 }), 0);
  });
});

describe('tvInchMatchScreen', () => {
  // The DM's own desk: a 27-inch monitor at 100% and an 11-inch screen at 160%, as Electron lists them.
  const big = { id: 66, label: 'P27A2R', scaleFactor: 1, size: { width: 2560, height: 1440 } };
  const small = { id: 65, label: 'RTK HDMI', scaleFactor: 1.600000023841858, size: { width: 1200, height: 800 } };
  it('finds the screen the Player says it is on, whichever screen main took for the DM', () => {
    assert.equal(tvInchMatchScreen([small, big], { w: 2560, h: 1440, dpr: 1 }), big);
    assert.equal(tvInchMatchScreen([small, big], { w: 1200, h: 800, dpr: 1.6 }), small);
  });
  it('falls back to the one screen at the reported scale', () => {
    assert.equal(tvInchMatchScreen([small, big], { w: 1280, h: 800, dpr: 1.6 }), small);
  });
  it('gives nothing for no report, or two screens it cannot tell apart', () => {
    assert.equal(tvInchMatchScreen([small, big], null), null);
    assert.equal(tvInchMatchScreen([big, { ...big, id: 67 }], { w: 2560, h: 1440, dpr: 1 }), null);
    assert.equal(tvInchMatchScreen([small, big], { w: 1920, h: 1080, dpr: 2 }), null);
  });
});

describe('tvBelievable', () => {
  it('turns a real size in cm into whole inches', () => {
    assert.equal(tvBelievable(60, 34, 'cm'), 27);
    assert.equal(tvBelievable(121, 68, 'cm'), 55);
  });
  it('reads mm', () => {
    assert.equal(tvBelievable(1210, 680, 'mm'), 55);
  });
  it('refuses 0', () => {
    assert.equal(tvBelievable(0, 0, 'cm'), null);
    assert.equal(tvBelievable(60, 0, 'cm'), null);
  });
  it('refuses an aspect ratio standing in for a size', () => {
    for (const [w, h] of [[16, 9], [160, 90], [16, 10], [160, 100], [4, 3]]) {
      assert.equal(tvBelievable(w, h, 'cm'), null, w + 'x' + h + ' cm was taken');
    }
    assert.equal(tvBelievable(1600, 900, 'mm'), null);
    assert.equal(tvBelievable(9, 16, 'cm'), null);
  });
  it('refuses anything outside 10 to 120 inches', () => {
    assert.equal(tvBelievable(15, 10, 'cm'), null);       // 7 inches
    assert.equal(tvBelievable(300, 170, 'cm'), null);     // 136 inches
    assert.equal(tvBelievable(22, 15, 'cm'), 10);
  });
});

describe('tvSizePick and tvSizeValid', () => {
  it('shows a picker size as itself and any other as Other', () => {
    assert.equal(tvSizePick(55), 55);
    assert.equal(tvSizePick(58), 'other');
    assert.equal(tvSizePick(9), null);
  });
  it('takes whole inches from 10 to 120', () => {
    assert.ok(tvSizeValid(10) && tvSizeValid(120));
    assert.ok(!tvSizeValid(121) && !tvSizeValid(9) && !tvSizeValid(55.5) && !tvSizeValid('55'));
  });
});

describe('the store', () => {
  it('keys a TV by its name and size', () => {
    assert.equal(tvSizeKey(tvAt(1)), 'LG TV|3840x2160');
    assert.equal(tvSizeKey({ label: '', size: { width: 1920, height: 1080 } }), '|1920x1080');
  });
  it('reads bad JSON and bad entries as nothing', () => {
    assert.deepEqual(tvSizesRead('{oops'), {});
    assert.deepEqual(tvSizesRead(null), {});
    assert.deepEqual(tvSizesRead('[55]'), {});
    assert.deepEqual(tvSizesRead('{"a|1x1":55,"b|1x1":"55","c|1x1":500}'), { 'a|1x1': 55 });
  });
});
