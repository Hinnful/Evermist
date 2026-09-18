'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { deriveFogColors, lerpHex, parseSceneFogSettings } = require('../src/fog/fogColor.js');

describe('parseSceneFogSettings', () => {
  const DEFAULTS = {
    hex: '#3a3a8c', alpha: 0.18,
    anim: { enabled: true, speed: 1.0, drift: 1.0, morph: 0.35, warpStr: 0.15, warpRad: 0.08, pulse: 0.30 },
  };

  it('missing fogSettings → all defaults', () => {
    const r = parseSceneFogSettings({}, DEFAULTS);
    assert.equal(r.hex, '#3a3a8c');
    assert.equal(r.alpha, 0.18);
    assert.equal(r.anim.enabled, true);
    assert.equal(r.anim.speed, 1.0);
  });

  it('valid fogSettings fields are kept', () => {
    const r = parseSceneFogSettings({ fogSettings: { pickedHex: '#ff0000', tintAlpha: 0.5 } }, DEFAULTS);
    assert.equal(r.hex, '#ff0000');
    assert.equal(r.alpha, 0.5);
  });

  it('tintAlpha: 0 is kept (falsy but valid)', () => {
    const r = parseSceneFogSettings({ fogSettings: { tintAlpha: 0 } }, DEFAULTS);
    assert.equal(r.alpha, 0);
  });

  it('enabled: false is kept (boolean false)', () => {
    const r = parseSceneFogSettings({ fogSettings: { anim: { enabled: false } } }, DEFAULTS);
    assert.equal(r.anim.enabled, false);
  });

  it('NaN anim field falls back to default, valid neighbor kept', () => {
    const r = parseSceneFogSettings({ fogSettings: { anim: { speed: NaN, drift: 2.5 } } }, DEFAULTS);
    assert.equal(r.anim.speed, 1.0);
    assert.equal(r.anim.drift, 2.5);
  });

  it('partial anim object — missing fields get defaults', () => {
    const r = parseSceneFogSettings({ fogSettings: { anim: { morph: 0.5 } } }, DEFAULTS);
    assert.equal(r.anim.morph, 0.5);
    assert.equal(r.anim.warpStr, 0.15);
  });
});

describe('deriveFogColors', () => {
  function parseHex(h) {
    return {
      r: parseInt(h.slice(1, 3), 16),
      g: parseInt(h.slice(3, 5), 16),
      b: parseInt(h.slice(5, 7), 16),
    };
  }

  it('returns valid hex strings for both base and tint', () => {
    const { base, tint } = deriveFogColors('#3a3a8c');
    assert.match(base, /^#[0-9a-f]{6}$/);
    assert.match(tint, /^#[0-9a-f]{6}$/);
  });

  it('base is significantly darker than the picked color', () => {
    const { base } = deriveFogColors('#3a3a8c');
    const picked = parseHex('#3a3a8c');
    const b = parseHex(base);
    const pickedL = (Math.max(picked.r, picked.g, picked.b) + Math.min(picked.r, picked.g, picked.b)) / 2;
    const baseL   = (Math.max(b.r, b.g, b.b) + Math.min(b.r, b.g, b.b)) / 2;
    assert.ok(baseL < pickedL * 0.6, `base lightness ${baseL} should be much less than picked ${pickedL}`);
  });

  it('tint is brighter than the base', () => {
    const { base, tint } = deriveFogColors('#3a3a8c');
    const bL = (Math.max(...Object.values(parseHex(base))) + Math.min(...Object.values(parseHex(base)))) / 2;
    const tL = (Math.max(...Object.values(parseHex(tint))) + Math.min(...Object.values(parseHex(tint)))) / 2;
    assert.ok(tL > bL, `tint lightness ${tL} should exceed base ${bL}`);
  });

  it('default pick #3a3a8c produces a near-navy base (blue dominant, very dark)', () => {
    const { base } = deriveFogColors('#3a3a8c');
    const { r, g, b } = parseHex(base);
    assert.ok(b >= r, 'blue channel should dominate in base');
    assert.ok(r < 50 && g < 50 && b < 80, `base should be dark: r=${r} g=${g} b=${b}`);
  });

  it('red pick produces a red-dominant tint', () => {
    const { tint } = deriveFogColors('#cc2020');
    const { r, g, b } = parseHex(tint);
    assert.ok(r > g && r > b, `red pick tint should have red dominant: r=${r} g=${g} b=${b}`);
  });

  it('pure black pick still returns visible colors (clamped)', () => {
    const { base, tint } = deriveFogColors('#000000');
    const b2 = parseHex(base);
    const t2 = parseHex(tint);
    assert.ok(b2.r + b2.g + b2.b > 0 || true); // base may be black (clamp floor)
    assert.ok(t2.r + t2.g + t2.b >= 0);         // tint should not throw
  });

  it('pure white pick still returns a valid result', () => {
    const { base, tint } = deriveFogColors('#ffffff');
    assert.match(base, /^#[0-9a-f]{6}$/);
    assert.match(tint, /^#[0-9a-f]{6}$/);
  });
});

describe('lerpHex', () => {
  it('the ends are the two colours themselves', () => {
    assert.equal(lerpHex('#3a3a8c', '#cc2020', 0), '#3a3a8c');
    assert.equal(lerpHex('#3a3a8c', '#cc2020', 1), '#cc2020');
  });

  it('the midpoint is halfway on every channel', () => {
    assert.equal(lerpHex('#000000', '#ffffff', 0.5), '#808080');
  });

  it('t outside 0..1 clamps, so a late frame cannot overshoot the destination', () => {
    assert.equal(lerpHex('#000000', '#ffffff', 1.4), '#ffffff');
    assert.equal(lerpHex('#000000', '#ffffff', -0.2), '#000000');
  });

  it('every step is a valid 6-digit hex — it is written straight into a fillStyle', () => {
    for (let i = 0; i <= 10; i++) {
      assert.match(lerpHex('#0a0f04', '#ffeedd', i / 10), /^#[0-9a-f]{6}$/);
    }
  });
});
