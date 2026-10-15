'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { EFFECT_PRESETS, GRID_FT, PRESET_HAS_HAND, presetRings, presetLabel, stepPresetIndex, presetSizeText } = require('../src/shapes/presetGeometry');
const { i18nFill } = require('../src/i18n/i18nPlan');

const O = { x: 500, y: 400 };
const bbox = vs => {
  const xs = vs.map(v => v.x), ys = vs.map(v => v.y);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('every size is one grid square more than the last, from the smallest to the largest', () => {
  const span = { rect: [5, 30], circle: [5, 60], cone: [5, 90], line: [5, 120], wall: [5, 60], ring: [10, 60] };
  assert.deepStrictEqual(Object.keys(EFFECT_PRESETS).sort(), Object.keys(span).sort());
  for (const kind of Object.keys(span)) {
    const sizes = EFFECT_PRESETS[kind].map(z => z.s);
    assert.strictEqual(sizes[0], span[kind][0]);
    assert.strictEqual(sizes[sizes.length - 1], span[kind][1]);
    sizes.slice(1).forEach((s, i) => assert.strictEqual(s - sizes[i], GRID_FT, kind));
  }
});

test('a line is one square wide, a wall and a ring are one foot thick', () => {
  assert.ok(EFFECT_PRESETS.line.every(z => z.w === 5));
  assert.ok(EFFECT_PRESETS.wall.every(z => z.w === 1));
  assert.ok(EFFECT_PRESETS.ring.every(z => z.w === 1));
  assert.ok(EFFECT_PRESETS.rect.every(z => z.w === 0));
});

test('only the shapes with a hand tool can be drawn by hand', () => {
  assert.deepStrictEqual(Object.keys(PRESET_HAS_HAND).sort(), ['circle', 'cone', 'rect']);
});

test('a 20 ft circle is 20 ft of radius at the grid scale', () => {
  for (const cell of [70, 48.5]) {
    const ppf = cell / 5;
    const { vertices, holes } = presetRings('circle', 20, 0, O, 0, ppf);
    assert.strictEqual(holes, undefined);
    for (const v of vertices) near(Math.hypot(v.x - O.x, v.y - O.y), 20 * ppf);
  }
});

test('a square is centred on the click, side by side', () => {
  const { vertices } = presetRings('rect', 15, 0, O, 0, 14);
  const b = bbox(vertices);
  near(b.w, 15 * 14); near(b.h, 15 * 14);
  near(vertices.reduce((s, v) => s + v.x, 0) / 4, O.x);
});

test('a cone starts at the click and reaches its length along the angle', () => {
  const { vertices } = presetRings('cone', 30, 0, O, Math.PI / 2, 14);
  assert.deepStrictEqual(vertices[0], O);
  const far = Math.max(...vertices.map(v => v.y - O.y));
  assert.ok(far >= 30 * 14 && far < 30 * 14 * 1.1, String(far));
});

test('a line starts at the click with its width across it', () => {
  const { vertices } = presetRings('line', 60, 5, O, 0, 14);
  const b = bbox(vertices);
  near(b.w, 60 * 14); near(b.h, 5 * 14);
  near(Math.min(...vertices.map(v => v.x)), O.x);
});

test('a wall is a line one foot thick', () => {
  const { vertices } = presetRings('wall', 30, 1, O, 0, 14);
  const b = bbox(vertices);
  near(b.w, 30 * 14); near(b.h, 14);
});

test('a ring is a band of its own thickness around a real hole', () => {
  const ppf = 14;
  const { vertices, holes } = presetRings('ring', 20, 5, O, 0, ppf);
  assert.strictEqual(holes.length, 1);
  for (const v of vertices) near(Math.hypot(v.x - O.x, v.y - O.y), 10 * ppf);
  for (const v of holes[0]) near(Math.hypot(v.x - O.x, v.y - O.y), (10 - 5) * ppf);
  const thin = presetRings('ring', 20, 1, O, 0, ppf);
  for (const v of thin.holes[0]) near(Math.hypot(v.x - O.x, v.y - O.y), (10 - 1) * ppf);
  assert.ok(vertices.length + holes[0].length <= 64, 'fits the effect shader cap');
});

test('stepping stops at both ends', () => {
  assert.strictEqual(stepPresetIndex(6, 7, 1), 6);
  assert.strictEqual(stepPresetIndex(0, 7, -1), 0);
  assert.strictEqual(stepPresetIndex(2, 7, 1), 3);
});

test('a shape with a hand tool steps down to by hand and stops there', () => {
  assert.strictEqual(stepPresetIndex(0, 6, -1, true), -1);
  assert.strictEqual(stepPresetIndex(-1, 6, -1, true), -1);
  assert.strictEqual(stepPresetIndex(-1, 6, 1, true), 0);
});

test('a size reads in feet and squares', () => {
  const plural = (n, one, other, vars) => i18nFill(n === 1 ? one : other, vars);
  assert.strictEqual(presetSizeText(20, i18nFill, plural), '20 ft · 4 squares');
  assert.strictEqual(presetSizeText(5, i18nFill, plural), '5 ft · 1 square');
});

test('the cursor label names the unit', () => {
  assert.strictEqual(presetLabel('circle', 20, 0, i18nFill), '20 ft radius');
  assert.strictEqual(presetLabel('line', 60, 5, i18nFill), '60 × 5 ft line');
  assert.strictEqual(presetLabel('rect', 10, 0, i18nFill), '10 × 10 ft');
  assert.strictEqual(presetLabel('ring', 20, 1, i18nFill), '20 ft ring');
  assert.strictEqual(presetLabel('wall', 30, 1, i18nFill), '30 ft wall');
});
