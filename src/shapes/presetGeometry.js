// presetGeometry.js — pure kernel for effect presets: the sizes each shape offers, and the outline
// a size makes. Its two shape helpers come from fogGeometry.js; under Node, by require.

'use strict';

var circleVertices, coneVertices;
if (typeof module !== 'undefined' && module.exports) {
  ({ circleVertices, coneVertices } = require('../fog/fogGeometry'));
}

// In feet. `s` is a square's side, a circle's radius, a cone's or line's length and a ring's width
// across; `w` is a line's width or a ring's thickness. Shape and size only, never a spell (PRODUCT.md).
const EFFECT_PRESETS = {
  rect:   [5, 10, 15, 20, 30].map(s => ({ s, w: 0 })),
  circle: [5, 10, 15, 20, 30, 40, 60].map(s => ({ s, w: 0 })),
  cone:   [15, 30, 60, 90].map(s => ({ s, w: 0 })),
  line:   [[30, 5], [60, 5], [100, 5], [60, 10], [90, 10], [120, 10], [60, 1]].map(([s, w]) => ({ s, w })),
  ring:   [[20, 1], [20, 5], [60, 5]].map(([s, w]) => ({ s, w })),
};

// A preset's outline in map px. A circle, square or ring is centred on `origin`; a cone or line
// starts at it and points along `angle`. `pxPerFt` is read once, at placement, so a later grid
// change leaves a placed effect alone.
function presetRings(kind, s, w, origin, angle, pxPerFt) {
  const S = s * pxPerFt, ux = Math.cos(angle || 0), uy = Math.sin(angle || 0);
  const at = (a, b) => ({ x: origin.x + ux * a - uy * b, y: origin.y + uy * a + ux * b });
  if (kind === 'circle') return { vertices: circleVertices(origin, { x: origin.x + S, y: origin.y }) };
  if (kind === 'rect') return { vertices: [at(-S / 2, -S / 2), at(S / 2, -S / 2), at(S / 2, S / 2), at(-S / 2, S / 2)] };
  if (kind === 'cone') return { vertices: coneVertices(origin, at(S, 0)) };
  if (kind === 'line') {
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

function presetLabel(kind, s, w) {
  if (kind === 'circle') return s + ' ft radius';
  if (kind === 'rect')   return s + ' × ' + s + ' ft';
  if (kind === 'cone')   return s + ' ft cone';
  if (kind === 'line')   return s + ' × ' + w + ' ft line';
  if (kind === 'ring')   return s + ' × ' + w + ' ft ring';
  return '';
}

// The next size along a list, wrapping at both ends.
function stepPresetIndex(i, n, dir) {
  return ((i + dir) % n + n) % n;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { EFFECT_PRESETS, presetRings, presetLabel, stepPresetIndex };
}
