// presetGeometry.js — pure kernel for effect presets: the sizes each shape offers, and the outline
// a size makes. Its two shape helpers come from fogGeometry.js; under Node, by require.

'use strict';

var circleVertices, coneVertices;
if (typeof module !== 'undefined' && module.exports) {
  ({ circleVertices, coneVertices } = require('../fog/fogGeometry'));
}

// Sizes follow the grid: one step is one square, 5 ft, from each shape's smallest to its largest.
// `s` is a square's side, a circle's radius, a cone's, line's or wall's length and a ring's width
// across; `w` is the line's width (one square), the wall's and the ring's thickness (1 ft). Shape and
// size only, never a spell (PRODUCT.md).
const GRID_FT = 5;
const PRESET_RANGE = { rect: [5, 30], circle: [5, 60], cone: [5, 90], line: [5, 120], wall: [5, 60], ring: [10, 60] };
const PRESET_WIDTH = { line: 5, wall: 1, ring: 1 };
// A shape with a hand tool can be drawn by drag at any size; line, wall and ring take a length alone.
const PRESET_HAS_HAND = { rect: true, circle: true, cone: true };

const EFFECT_PRESETS = {};
for (const kind of Object.keys(PRESET_RANGE)) {
  EFFECT_PRESETS[kind] = [];
  for (let s = PRESET_RANGE[kind][0]; s <= PRESET_RANGE[kind][1]; s += GRID_FT) {
    EFFECT_PRESETS[kind].push({ s, w: PRESET_WIDTH[kind] || 0 });
  }
}

// A preset's outline in map px. A circle, square or ring is centred on `origin`; a cone, line or wall
// starts at it and points along `angle`. `pxPerFt` is read once, at placement, so a later grid
// change leaves a placed effect alone.
function presetRings(kind, s, w, origin, angle, pxPerFt) {
  const S = s * pxPerFt, ux = Math.cos(angle || 0), uy = Math.sin(angle || 0);
  const at = (a, b) => ({ x: origin.x + ux * a - uy * b, y: origin.y + uy * a + ux * b });
  if (kind === 'circle') return { vertices: circleVertices(origin, { x: origin.x + S, y: origin.y }) };
  if (kind === 'rect') return { vertices: [at(-S / 2, -S / 2), at(S / 2, -S / 2), at(S / 2, S / 2), at(-S / 2, S / 2)] };
  if (kind === 'cone') return { vertices: coneVertices(origin, at(S, 0)) };
  if (kind === 'line' || kind === 'wall') {
    const h = w * pxPerFt / 2;
    return { vertices: [at(0, -h), at(S, -h), at(S, h), at(0, h)] };
  }
  if (kind === 'ring') {
    const outer = circleVertices(origin, { x: origin.x + S / 2, y: origin.y });
    const inner = circleVertices(origin, { x: origin.x + S / 2 - w * pxPerFt, y: origin.y });
    return { vertices: outer, holes: [inner.reverse()] };
  }
  return null;
}

const PRESET_LABELS = { circle: '{s} ft radius', rect: '{s} × {s} ft', cone: '{s} ft cone',
  line: '{s} × {w} ft line', wall: '{s} ft wall', ring: '{s} ft ring' };

// `word(template, values)` fills it in the interface language: t() in the window.
function presetLabel(kind, s, w, word) {
  return PRESET_LABELS[kind] ? word(PRESET_LABELS[kind], { s: s, w: w }) : '';
}

// A size as the list names it: "20 ft · 4 squares". `plural(n, one, other)` is t.plural in the window.
function presetSizeText(s, word, plural) {
  const n = s / GRID_FT;
  return word('{s} ft', { s: s }) + ' · ' + plural(n, '{n} square', '{n} squares', { n: n });
}

// The next index along a list, stopping at both ends. A shape with a hand tool has one step below the
// smallest size, index -1, which means "by hand".
function stepPresetIndex(i, n, dir, hasHand) {
  return Math.max(hasHand ? -1 : 0, Math.min(n - 1, i + dir));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { EFFECT_PRESETS, GRID_FT, PRESET_HAS_HAND, presetRings, presetLabel, presetSizeText, stepPresetIndex };
}
