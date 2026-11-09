'use strict';
// tvInch.js — pure kernel: 1 inch. The zoom that makes one map square 1.1 inches wide on the TV, the
// sizes TV setup offers, and which size a TV reports is believable. electron/tvSize.js reads the
// report; tvControl.js and tvOneInch.js act on the answers.

const TV_INCH_CELL = 1.1;                    // inches: fits a 25 mm base
const TV_INCH_SIZES = [43, 50, 55, 65, 75];  // the picker; anything else is Other
const TV_INCH_MIN = 10;
const TV_INCH_MAX = 120;
const CM_PER_INCH = 2.54;
// Sizes in cm a screen reports when it does not know its own: an aspect ratio, sometimes times ten.
const TV_FAKE_CM = [[16, 9], [160, 90], [16, 10], [160, 100], [4, 3], [40, 30], [5, 4], [50, 40],
  [21, 9], [210, 90], [64, 27], [32, 9], [320, 90]];

// The screen's width in inches from its diagonal and its pixel shape.
function tvWidthInches(diagonal, pxW, pxH) {
  if (!(diagonal > 0) || !(pxW > 0) || !(pxH > 0)) return null;
  return diagonal * pxW / Math.hypot(pxW, pxH);
}

// Player-canvas CSS px per map px for 1.1-inch cells. `width`/`height` are the display's size in CSS px
// (Electron's `size`), never `workAreaSize`, which a taskbar shrinks; `cellPx` is the scene's grid size.
function tvInchZoom(diagonal, display, cellPx) {
  const sf = display && display.scaleFactor > 0 ? display.scaleFactor : 1;
  const pxW = display && display.size ? display.size.width * sf : 0;
  const pxH = display && display.size ? display.size.height * sf : 0;
  const inchesW = tvWidthInches(diagonal, pxW, pxH);
  if (!inchesW || !(cellPx > 0)) return null;
  const cssPerInch = pxW / inchesW / sf;
  return TV_INCH_CELL * cssPerInch / cellPx;
}

// The width a mini's base must fit, in map px: a square's side, or a hex's width flat to flat, which
// is √3 times the grid size grid.js draws it from.
function tvInchCellPx(grid) {
  if (!grid || !(grid.cellSize > 0)) return 0;
  return grid.mode === 'hex-pointy' ? grid.cellSize * Math.sqrt(3) : grid.cellSize;
}

// The display the Player's own report names: same size and scale, or failing that the only one at its
// scale. Null when the report fits none or several.
function tvInchMatchScreen(displays, scr) {
  if (!scr || !(scr.w > 0) || !(scr.dpr > 0) || !Array.isArray(displays)) return null;
  const sameScale = displays.filter(d => d && d.size && Math.abs((d.scaleFactor || 1) - scr.dpr) < 0.01);
  const exact = sameScale.filter(d => Math.abs(d.size.width - scr.w) <= 1 && Math.abs(d.size.height - scr.h) <= 1);
  if (exact.length === 1) return exact[0];
  return exact.length === 0 && sameScale.length === 1 ? sameScale[0] : null;
}

function tvSizeValid(n) {
  return Number.isInteger(n) && n >= TV_INCH_MIN && n <= TV_INCH_MAX;
}

// A reported width x height to a whole-inch diagonal, or null when it is not a real size.
function tvBelievable(w, h, unit) {
  const k = unit === 'mm' ? 0.1 : 1;
  const cw = w * k, ch = h * k;
  if (!(cw > 0) || !(ch > 0)) return null;
  if (TV_FAKE_CM.some(([a, b]) => (cw === a && ch === b) || (cw === b && ch === a))) return null;
  const inches = Math.round(Math.hypot(cw, ch) / CM_PER_INCH);
  return tvSizeValid(inches) ? inches : null;
}

// How a size shows on the picker: one of its sizes, or Other with the number.
function tvSizePick(inches) {
  if (!tvSizeValid(inches)) return null;
  return TV_INCH_SIZES.includes(inches) ? inches : 'other';
}

// The store's key for one TV: its name and its size, so a second screen never takes the first's size.
function tvSizeKey(display) {
  return (display.label || '').trim() + '|' + display.size.width + 'x' + display.size.height;
}

// The stored sizes, read safely: bad JSON or a bad entry is nothing.
function tvSizesRead(text) {
  let raw;
  try { raw = JSON.parse(text); } catch (_) { return {}; }
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) if (tvSizeValid(v)) out[k] = v;
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TV_INCH_CELL, TV_INCH_SIZES, TV_INCH_MIN, TV_INCH_MAX,
    tvWidthInches, tvInchZoom, tvInchCellPx, tvInchMatchScreen, tvSizeValid, tvBelievable, tvSizePick, tvSizeKey, tvSizesRead };
}
