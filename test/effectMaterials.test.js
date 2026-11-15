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
    ice: ['frost', 'Ice'], web: ['orbweb', 'Web'], grease: ['tar', 'Grease'], darkness: ['billows', 'Darkness'],
    fogcloud: ['fogbank', 'Fog cloud'],
  });
  assert.strictEqual(effectMaterial('lava').kind, 'flame');
});

test('area and difficult terrain have their own outline colours', () => {
  assert.strictEqual(effectEdgeColor('area'), '#ffd173');
  assert.strictEqual(effectEdgeColor('terrain'), '#e0bf8a');
});

test('every material has a kind, a label, one colour for edge and grid, and a palette group', () => {
  for (const [name, m] of Object.entries(EFFECT_MATERIALS)) {
    assert.ok(m.kind && m.label, name);
    assert.match(m.edge, /^#[0-9a-f]{6}$/i, name);
    assert.strictEqual(m.grid, m.edge, name);
    assert.ok(['ground', 'cloud', 'marks'].includes(m.group), name);
  }
  assert.deepStrictEqual(EFFECT_MATERIALS.area.tint, [1, 0.82, 0.45]);
});

test('the four round 4 materials carry the colours picked for them', () => {
  assert.strictEqual(effectEdgeColor('darkness'), '#a57cff');
  assert.strictEqual(effectEdgeColor('ice'), '#4d9ef5');
  assert.strictEqual(effectEdgeColor('web'), '#ece8dc');
  assert.strictEqual(effectEdgeColor('grease'), '#dca04a');
  assert.strictEqual(EFFECT_MATERIALS.darkness.group, 'cloud');
});

test('fog cloud is a pale blue cloud after darkness', () => {
  assert.strictEqual(effectEdgeColor('fogcloud'), '#d8e6f6');
  assert.strictEqual(EFFECT_MATERIALS.fogcloud.grid, '#d8e6f6');
  assert.strictEqual(EFFECT_MATERIALS.fogcloud.group, 'cloud');
  const keys = Object.keys(EFFECT_MATERIALS);
  assert.strictEqual(keys.indexOf('fogcloud'), keys.indexOf('darkness') + 1);
});

test('a material this release does not know, as the previous release reads ice, burns as fire', () => {
  const { effectMaterial } = require('../src/render/effectMaterials');
  assert.strictEqual(effectMaterial('poison'), EFFECT_MATERIALS.fire);
  assert.strictEqual(effectMaterial(undefined), EFFECT_MATERIALS.fire);
});
