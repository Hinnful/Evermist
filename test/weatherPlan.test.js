'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const W = require('../src/render/weatherPlan.js');

const P = W.WEATHER_PRESETS;

describe('weatherNormalize', () => {
  it('keeps the six ids and turns anything else into none', () => {
    for (const id of W.WEATHER_IDS) assert.equal(W.weatherNormalize(id), id);
    for (const bad of [undefined, null, '', 'mist', 'RAIN', 4, {}, ['rain']]) assert.equal(W.weatherNormalize(bad), 'none');
  });
  it('has a preset record for every id and none besides', () => {
    assert.deepEqual(Object.keys(P), W.WEATHER_IDS);
    assert.equal(W.WEATHER_IDS.length, 6);
  });
});

describe('weatherStrength', () => {
  it('stays inside each preset\'s range and moves over time', () => {
    for (const id of ['rain', 'storm', 'snowfall', 'blizzard']) {
      const seen = [];
      for (let t = 0; t < 600; t += 3) {
        const I = W.weatherStrength(P[id], t);
        assert.ok(I >= P[id].lo - 1e-9 && I <= P[id].hi + 1e-9, id + ' at ' + t);
        seen.push(I);
      }
      assert.ok(Math.max(...seen) - Math.min(...seen) > 0.2, id + ' strengthens and eases off');
    }
  });
  it('is zero for none and flat for Fair weather', () => {
    assert.equal(W.weatherStrength(P.none, 50), 0);
    assert.equal(W.weatherStrength(P.fair, 10), W.weatherStrength(P.fair, 200));
  });
});

describe('weatherStepGround', () => {
  const run = (p, I, from, secs) => {
    let g = from;
    for (let i = 0; i < secs * 10; i++) g = W.weatherStepGround(g, 0.1, p, I);
    return g;
  };
  it('fills puddles in about a minute and dries them in about two and a half', () => {
    const full = run(P.storm, 1, { wet: 0, snow: 0 }, 61);
    assert.ok(Math.abs(full.wet - 1) < 1e-6);
    assert.ok(run(P.storm, 1, { wet: 0, snow: 0 }, 30).wet < 0.55);
    const dried = run(P.none, 0, { wet: 1, snow: 0 }, 151);
    assert.ok(dried.wet < 1e-6);
    assert.ok(run(P.none, 0, { wet: 1, snow: 0 }, 75).wet > 0.4);
  });
  it('settles snow in three minutes and melts it in five, faster under rain', () => {
    const full = run(P.blizzard, 1, { wet: 0, snow: 0 }, 181);
    assert.ok(Math.abs(full.snow - 1) < 1e-6);
    assert.ok(run(P.none, 0, { wet: 0, snow: 1 }, 150).snow > 0.45);
    assert.ok(run(P.none, 0, { wet: 0, snow: 1 }, 301).snow < 1e-6);
    assert.ok(run(P.rain, 0, { wet: 0, snow: 1 }, 101).snow < 1e-6);
  });
  it('never overshoots its target', () => {
    const g = W.weatherStepGround({ wet: 0.79, snow: 0 }, 50, P.rain, 1);
    assert.ok(Math.abs(g.wet - 0.8) < 1e-9);
  });
});

describe('weatherStartLevels', () => {
  it('opens a map at its settled puddle and snow level', () => {
    const s = W.weatherStartLevels(P.storm, 0);
    assert.ok(Math.abs(s.wet - W.weatherStrength(P.storm, 0)) < 1e-9);
    assert.equal(s.snow, 0);
    const b = W.weatherStartLevels(P.blizzard, 0);
    assert.ok(b.snow > 0.6 && b.wet === 0);
    assert.deepEqual(W.weatherStartLevels(P.none, 5), { wet: 0, snow: 0 });
  });
});

describe('weatherFadeCurve', () => {
  it('runs 0 to 1 smoothly and clamps', () => {
    assert.equal(W.weatherFadeCurve(-1), 0);
    assert.equal(W.weatherFadeCurve(0), 0);
    assert.equal(W.weatherFadeCurve(0.5), 0.5);
    assert.equal(W.weatherFadeCurve(1), 1);
    assert.equal(W.weatherFadeCurve(7), 1);
    assert.ok(W.weatherFadeCurve(0.25) < 0.25);
    assert.equal(W.WEATHER_FADE_MS, 8000);
  });
});

describe('weatherHandover', () => {
  it('a switch with no fade running fades the shown preset out from full, or the new one in from nothing', () => {
    assert.deepEqual(W.weatherHandover(null, 'rain', 1, 1), { out: 'rain', level: 1 });
    assert.deepEqual(W.weatherHandover(null, 'none', 1, 1), { out: 'none', level: 0 });
    assert.equal(W.weatherInAlpha(1, 0), 1);
    assert.ok(Math.abs(W.weatherInAlpha(0, 0.3) - 0.3) < 1e-9);
  });
  it('a second pick early in a fade-in carries the faint preset out from where it was, not from full', () => {
    const e = 0.1;   // None -> Rain, Rain at 10%
    const h = W.weatherHandover('none', 'rain', 0, e);
    assert.equal(h.out, 'rain');
    assert.ok(Math.abs(h.level - 0.1) < 1e-9);
    assert.ok(Math.abs(W.weatherInAlpha(h.level, 0) - 0.1) < 1e-9, 'the newest starts at what was on screen');
  });
  it('a second pick early in a cross-fade keeps the mostly shown old preset going out from its level', () => {
    const e = 0.1;   // Rain -> Storm, Rain still at 90% over Storm
    const h = W.weatherHandover('rain', 'storm', 1, e);
    assert.equal(h.out, 'rain');
    assert.ok(Math.abs(h.level - 0.9) < 1e-9);
  });
  it('late in a cross-fade the incoming preset is the one carried out', () => {
    const h = W.weatherHandover('rain', 'storm', 1, 0.9);
    assert.equal(h.out, 'storm');
    assert.equal(h.level, 1);
  });
});

describe('lightning and gusts', () => {
  it('flashes within a second and a bit, then is dark', () => {
    assert.equal(W.weatherFlashAmp(-0.1), 0);
    assert.ok(W.weatherFlashAmp(0.06) > 0.3);
    assert.equal(W.weatherFlashAmp(1.3), 0);
  });
  it('a gust fades in and out, moving with the wind, and is nothing outside its life', () => {
    const g = { x: 0.2, y: 0.3 };
    assert.equal(W.weatherGustAt(g, 0).a, 0);
    assert.ok(W.weatherGustAt(g, 0.5).a > 0.99);
    assert.ok(W.weatherGustAt(g, 0.5).x > 0.2);
    assert.equal(W.weatherGustAt(g, 1.2).a, 0);
    assert.equal(W.weatherGustAt(null, 0.5).a, 0);
  });
});

describe('weatherRoomsKey', () => {
  const sq = (x, y, w) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + w }, { x, y: y + w }];
  it('changes when a room is added, moved, rounded or holed, and not otherwise', () => {
    const a = [{ vertices: sq(0, 0, 10) }];
    const key = W.weatherRoomsKey(a);
    assert.equal(W.weatherRoomsKey([{ vertices: sq(0, 0, 10), mode: 'reveal', name: 'x' }]), key);
    assert.notEqual(W.weatherRoomsKey(a.concat([{ vertices: sq(20, 0, 5) }])), key);
    assert.notEqual(W.weatherRoomsKey([{ vertices: sq(1, 0, 10) }]), key);
    assert.notEqual(W.weatherRoomsKey([{ vertices: sq(0, 0, 10), cornerRadius: 3 }]), key);
    assert.notEqual(W.weatherRoomsKey([{ vertices: sq(0, 0, 10), holes: [sq(2, 2, 3)] }]), key);
    assert.equal(W.weatherRoomsKey([]), '0:0');
  });
});
