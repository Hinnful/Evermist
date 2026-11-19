'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { presetRings, effectPresetOf, presetResized } = require('../src/shapes/presetGeometry');

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const nearPt = (p, x, y) => { near(p.x, x); near(p.y, y); };
// A record as placing makes it: 10 px a foot.
function placed(kind, s, w, origin, angle) {
  const r = presetRings(kind, s, w, origin, angle, 10);
  return { id: 1, vertices: r.vertices, ...(r.holes ? { holes: r.holes } : {}),
           preset: { kind, s, origin, angle, n: r.vertices.length } };
}

test('a 10 ft square resized to 20 ft grows about its centre', () => {
  const rec = placed('rect', 10, 0, { x: 500, y: 400 }, 0);
  nearPt(rec.vertices[0], 450, 350);
  const out = presetResized(rec, 20);
  nearPt(out.vertices[0], 400, 300);
  nearPt(out.vertices[1], 600, 300);
  nearPt(out.vertices[2], 600, 500);
  nearPt(out.vertices[3], 400, 500);
  assert.deepStrictEqual(out.preset, { kind: 'rect', s: 20, origin: { x: 500, y: 400 }, angle: 0, n: 4 });
});

test('a moved square resizes where it now stands, not where it was placed', () => {
  const rec = placed('rect', 10, 0, { x: 500, y: 400 }, 0);
  rec.vertices = rec.vertices.map(v => ({ x: v.x + 100, y: v.y - 50 }));
  const out = presetResized(rec, 20);
  nearPt(out.vertices[0], 500, 250);
  nearPt(out.vertices[2], 700, 450);
});

test('a ring resized keeps its centre and its 1 ft band', () => {
  const rec = placed('ring', 20, 1, { x: 300, y: 300 }, 0);
  const out = presetResized(rec, 40);
  // Outer radius 20 ft = 200 px, inner 190 px; vertex 0 sits at angle 0.
  nearPt(out.vertices[0], 500, 300);
  assert.strictEqual(out.holes.length, 1);
  const inner = out.holes[0].map(v => Math.hypot(v.x - 300, v.y - 300));
  inner.forEach(r => near(r, 190));
  assert.strictEqual(out.preset.n, 32);
});

test('a cone resized grows along its length from its apex, at its own angle', () => {
  const rec = placed('cone', 15, 0, { x: 100, y: 200 }, Math.PI / 2);
  const out = presetResized(rec, 30);
  nearPt(out.vertices[0], 100, 200);
  const far = out.vertices.reduce((m, v) => Math.max(m, Math.hypot(v.x - 100, v.y - 200)), 0);
  const farOld = rec.vertices.reduce((m, v) => Math.max(m, Math.hypot(v.x - 100, v.y - 200)), 0);
  near(far / farOld, 2);
  // Points down the map: every vertex at or below the apex.
  out.vertices.forEach(v => assert.ok(v.y >= 200 - 1e-6));
});

test('a line resized keeps its start and its width', () => {
  const rec = placed('line', 30, 5, { x: 0, y: 100 }, 0);
  const out = presetResized(rec, 60);
  nearPt(out.vertices[0], 0, 75);
  nearPt(out.vertices[1], 600, 75);
  nearPt(out.vertices[2], 600, 125);
  nearPt(out.vertices[3], 0, 125);
});

test('a record whose vertex count no longer matches n reads as By hand', () => {
  const rec = placed('rect', 10, 0, { x: 500, y: 400 }, 0);
  assert.ok(effectPresetOf(rec));
  rec.vertices.splice(1, 0, { x: 500, y: 340 });
  assert.strictEqual(effectPresetOf(rec), null);
  assert.strictEqual(presetResized(rec, 20), null);
});

test('a corner dragged by a build that kept the field reads as By hand', () => {
  const rec = placed('rect', 10, 0, { x: 500, y: 400 }, 0);
  rec.vertices[2] = { x: 580, y: 470 };
  assert.strictEqual(effectPresetOf(rec), null);
});

test('no preset, a bent wall, a size the shape lacks, or junk in the field: By hand', () => {
  const rec = placed('circle', 10, 0, { x: 0, y: 0 }, 0);
  assert.strictEqual(effectPresetOf({ vertices: rec.vertices }), null);
  assert.strictEqual(effectPresetOf({ ...rec, handles: [{ ix: 0, iy: 0, ox: 5, oy: 5 }] }), null);
  assert.strictEqual(presetResized(rec, 12), null);
  assert.strictEqual(effectPresetOf({ ...rec, preset: { ...rec.preset, kind: 'blob' } }), null);
  assert.strictEqual(effectPresetOf({ ...rec, preset: { ...rec.preset, s: 'x' } }), null);
  const str = effectPresetOf({ ...rec, preset: { ...rec.preset, s: '10', n: '32' } });
  assert.strictEqual(str.s, 10);
});
