'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { EFFECT_PRESETS, presetRings, presetLabel, stepPresetIndex } = require('../src/shapes/presetGeometry');

const O = { x: 500, y: 400 };
const bbox = vs => {
  const xs = vs.map(v => v.x), ys = vs.map(v => v.y);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('the size table matches the settled list', () => {
  assert.deepStrictEqual(EFFECT_PRESETS.rect.map(z => z.s), [5, 10, 15, 20, 30]);
  assert.deepStrictEqual(EFFECT_PRESETS.circle.map(z => z.s), [5, 10, 15, 20, 30, 40, 60]);
  assert.deepStrictEqual(EFFECT_PRESETS.cone.map(z => z.s), [15, 30, 60, 90]);
  assert.deepStrictEqual(EFFECT_PRESETS.line.map(z => z.s + 'x' + z.w),
    ['30x5', '60x5', '100x5', '60x10', '90x10', '120x10', '60x1']);
  assert.deepStrictEqual(EFFECT_PRESETS.ring.map(z => z.s + 'x' + z.w), ['20x1', '20x5', '60x5']);
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
  const { vertices } = presetRings('line', 60, 10, O, 0, 14);
  const b = bbox(vertices);
  near(b.w, 60 * 14); near(b.h, 10 * 14);
  near(Math.min(...vertices.map(v => v.x)), O.x);
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

test('the wheel wraps at both ends', () => {
  assert.strictEqual(stepPresetIndex(6, 7, 1), 0);
  assert.strictEqual(stepPresetIndex(0, 7, -1), 6);
  assert.strictEqual(stepPresetIndex(2, 7, 1), 3);
});

test('the cursor label names the unit', () => {
  assert.strictEqual(presetLabel('circle', 20, 0), '20 ft radius');
  assert.strictEqual(presetLabel('line', 60, 5), '60 × 5 ft line');
  assert.strictEqual(presetLabel('rect', 10, 0), '10 × 10 ft');
  assert.strictEqual(presetLabel('ring', 20, 1), '20 × 1 ft ring');
});
