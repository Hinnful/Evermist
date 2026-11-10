'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/render/timeOfDayPlan.js');

const lin = s => s.map(T.todToLinear);
const srgb = l => l.map(T.todToSrgb);
const grey = s => lin([s, s, s]);

describe('timeOfDayNormalize', () => {
  it('keeps the four ids and turns anything else into none', () => {
    assert.deepEqual(T.TIME_OF_DAY_IDS, ['none', 'day', 'dusk', 'night']);
    for (const id of T.TIME_OF_DAY_IDS) assert.equal(T.timeOfDayNormalize(id), id);
    for (const bad of [undefined, null, '', 'noon', 'NIGHT', 3, {}, ['day']]) assert.equal(T.timeOfDayNormalize(bad), 'none');
  });
  it('names every id', () => {
    assert.deepEqual(Object.keys(T.TIME_OF_DAY_LABELS), T.TIME_OF_DAY_IDS);
  });
});

describe('the scene field', () => {
  it('loads a scene without the field as None', () => {
    assert.equal(T.timeOfDayNormalize({}.timeOfDay), 'none');
  });
  it('writes no field for None, and drops one set back to None', () => {
    const rec = { id: 's' };
    T.timeOfDayWrite(rec, 'none');
    assert.equal('timeOfDay' in rec, false);
    T.timeOfDayWrite(rec, 'night');
    assert.equal(rec.timeOfDay, 'night');
    T.timeOfDayWrite(rec, 'none');
    assert.equal('timeOfDay' in rec, false);
  });
  it('keeps an id a newer release wrote until the DM picks another', () => {
    const rec = { timeOfDay: 'eclipse' };
    T.timeOfDayWrite(rec, 'none');
    assert.equal(rec.timeOfDay, 'eclipse');
    T.timeOfDayWrite(rec, 'dusk');
    assert.equal(rec.timeOfDay, 'dusk');
  });
});

describe('Night', () => {
  it('darkens a mid grey outside a room and shifts it blue', () => {
    const a = grey(0.5), out = T.todGrade('night', a, {});
    assert.ok(T.todLum(out) < T.todLum(a) * 0.5, 'darker');
    assert.ok(out[2] > out[1] && out[1] > out[0], 'blue above green above red');
  });
  it('leaves a dark pixel inside a room as drawn, but for its warm lamp-lit cast', () => {
    const a = grey(0.2), out = T.todGrade('night', a, { inside: 1 });
    assert.ok(Math.abs(out[0] - a[0]) < 1e-9, 'red unchanged');
    const s0 = srgb(a), s1 = srgb(out);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(s1[i] - s0[i]) < 0.06, 'channel ' + i + ' within tolerance');
  });
  it('dims bright ground inside a room, keeping most of it', () => {
    const a = grey(0.9), out = T.todGrade('night', a, { inside: 1 });
    assert.ok(T.todLum(out) < T.todLum(a) && T.todLum(out) > T.todLum(a) * 0.35);
  });
  it('lights the ground just outside a room warm', () => {
    const a = grey(0.5), dark = T.todGrade('night', a, {}), lit = T.todGrade('night', a, { glow: 0.5 });
    assert.ok(lit[0] - dark[0] > lit[2] - dark[2] && lit[0] > dark[0]);
  });
});

describe('Day', () => {
  it('lifts a dark pixel about 1.9x and moves a bright one under 5%', () => {
    const dark = grey(0.1), dOut = T.todGrade('day', dark, {});
    const k = T.todLum(dOut) / T.todLum(dark);
    assert.ok(k > 1.75 && k < 2, 'dark lift ' + k);
    const bright = grey(0.9), bOut = T.todGrade('day', bright, {});
    const moved = Math.abs(T.todToSrgb(T.todLum(bOut)) - T.todToSrgb(T.todLum(bright))) / T.todToSrgb(T.todLum(bright));
    assert.ok(moved < 0.05, 'bright moved ' + moved);
  });
  it('treats a room the same as the ground around it', () => {
    const a = grey(0.2);
    assert.deepEqual(T.todGrade('day', a, { inside: 1 }), T.todGrade('day', a, {}));
  });
  it('takes the lamps\' orange off the ground', () => {
    const a = lin([0.8, 0.5, 0.25]);
    const plain = T.todGrade('day', a, {}), lamp = T.todGrade('day', a, { lamp: 1 });
    assert.ok(lamp[0] - lamp[2] < plain[0] - plain[2]);
  });
});

describe('Dusk', () => {
  it('warms a saturated pixel', () => {
    const a = lin([0.3, 0.6, 0.2]), out = T.todGrade('dusk', a, {});
    assert.ok(out[0] / out[1] > a[0] / a[1] && out[2] / out[1] < a[2] / a[1]);
  });
  it('turns a white pixel lavender', () => {
    const out = T.todGrade('dusk', grey(1), {});
    assert.ok(out[2] > out[1] && out[0] > out[1], 'red and blue above green');
  });
  it('is lit from the left', () => {
    const a = grey(0.5);
    assert.ok(T.todLum(T.todGrade('dusk', a, { u: 0, v: 0 })) > T.todLum(T.todGrade('dusk', a, { u: 1, v: 1 })));
  });
});

describe('the fixed pivot', () => {
  it('grades one pixel the same whatever map it sits on', () => {
    const a = grey(0.4);
    assert.deepEqual(T.todGrade('night', a, {}), T.todGrade('night', a.slice(), {}));
    assert.equal(T.TOD.pivot, 0.06);
  });
});

describe('None and the fade', () => {
  it('leaves None as drawn', () => {
    const a = lin([0.3, 0.4, 0.5]);
    assert.deepEqual(T.todGrade('none', a, { inside: 1, glow: 1, lamp: 1 }), a);
  });
  it('blends weights from where the screen is', () => {
    assert.deepEqual(T.todWeights('night'), [0, 0, 1]);
    assert.deepEqual(T.todWeights('bogus'), [0, 0, 0]);
    const mid = T.todWeightsMix(T.todWeights('day'), T.todWeights('night'), 0.25);
    assert.deepEqual(mid, [0.75, 0, 0.25]);
    assert.deepEqual(T.todWeightsMix(mid, T.todWeights('none'), 1), [0, 0, 0]);
  });
});

describe('todLampMask', () => {
  it('finds a warm bright spot and nothing on flat ground', () => {
    const w = 140, h = 100, rgb = new Float32Array(w * h * 3).fill(0.03);
    assert.ok(Math.max(...T.todLampMask(rgb, w, h)) < 1e-6, 'flat ground has no lamps');
    for (let y = 45; y < 55; y++) for (let x = 65; x < 75; x++) { const i = (y * w + x) * 3; rgb[i] = 0.9; rgb[i + 1] = 0.45; rgb[i + 2] = 0.1; }
    const m = T.todLampMask(rgb, w, h);
    assert.ok(m[50 * w + 70] > 0.05, 'the lamp ' + m[50 * w + 70]);
    assert.ok(m[5 * w + 5] < 0.01, 'far from it');
  });
  it('reads 8-bit RGBA', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4).fill(40);
    assert.equal(T.todLampMaskRgba(data, 4, 4).length, 16);
  });
});
