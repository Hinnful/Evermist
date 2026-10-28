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

test('each material has a kind and the label the DM sees', () => {
  const { effectMaterial } = require('../src/render/effectMaterials');
  const got = Object.fromEntries(Object.entries(EFFECT_MATERIALS).map(([k, m]) => [k, [m.kind, m.label]]));
  assert.deepStrictEqual(got, {
    fire: ['flame', 'Fire'], acid: ['flame', 'Acid'], area: ['ward', 'Area'], terrain: ['rough', 'Difficult terrain'],
  });
  assert.strictEqual(effectMaterial('lava').kind, 'flame');
});

test('area and difficult terrain have their own outline colours', () => {
  assert.strictEqual(effectEdgeColor('area'), '#ffd173');
  assert.strictEqual(effectEdgeColor('terrain'), '#b9a58a');
});

test('only a flame relights the grid, and a ward carries its tint', () => {
  assert.ok(EFFECT_MATERIALS.fire.grid && EFFECT_MATERIALS.acid.grid);
  assert.strictEqual(EFFECT_MATERIALS.area.grid, undefined);
  assert.deepStrictEqual(EFFECT_MATERIALS.area.tint, [1, 0.82, 0.45]);
});
