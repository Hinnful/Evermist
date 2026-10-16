'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { EFFECT_MATERIALS, effectEdgeColor, effectEdgeRgb } = require('../src/render/effectMaterials');

test('every material carries its own outline colour', () => {
  for (const name of Object.keys(EFFECT_MATERIALS)) assert.match(effectEdgeColor(name), /^#[0-9a-f]{6}$/i, name);
});

test('acid previews in its own colour, not the fire orange', () => {
  assert.notStrictEqual(effectEdgeColor('acid'), effectEdgeColor('fire'));
  assert.notStrictEqual(effectEdgeRgb('acid'), effectEdgeRgb('fire'));
  assert.strictEqual(effectEdgeRgb('fire'), '255,138,61');
  assert.strictEqual(effectEdgeRgb('acid'), '216,240,64');
});

test('an unknown material previews as fire', () => {
  assert.strictEqual(effectEdgeRgb('lava'), effectEdgeRgb('fire'));
});
