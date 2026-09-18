'use strict';
// fogColor.js — the fog's colour maths: one picked hex into the base fill and the tint over it,
// the step between two of them, and the settings a scene record carries. Pure. Unit-tested.

// A { base, tint } hex pair from one picked hex. base is the solid fill behind Player fog, tint the
// source-atop glow on both paths.
function _hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r)      h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else                h = (r - g) / d + 4;
    h *= 60;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

function _hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r, g, b;
  if      (h < 60)  { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  const to2 = v => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return '#' + to2(r) + to2(g) + to2(b);
}

// base: same hue, saturation halved, lightness a third of the pick.
// tint: hue nudged +8°, saturation and lightness boosted.
// Clamped so pure-black and pure-white picks still produce visible fog.
function deriveFogColors(pickedHex) {
  const { h, s, l } = _hexToHsl(pickedHex);
  const baseS = Math.max(0.10, s * 0.55);
  const baseL = Math.max(0.08, Math.min(0.22, l * 0.38));
  const tintH = (h + 8) % 360;
  const tintS = Math.min(0.85, Math.max(0.40, s * 1.55));
  const tintL = Math.min(0.68, Math.max(0.35, l * 1.55));
  return {
    base: _hslToHex(h, baseS, baseL),
    tint: _hslToHex(tintH, tintS, tintL),
  };
}

// t of the way between two picked colours, ⚠ interpolated in RGB. HSL swings the hue the long way
// round the wheel on some pairs, which is a rainbow wipe rather than one fog colour becoming
// another. deriveFogColors makes base+tint from each step.
function lerpHex(fromHex, toHex, t) {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  const to2 = v => Math.round(v).toString(16).padStart(2, '0');
  let out = '#';
  for (let i = 1; i < 7; i += 2) {
    const a = parseInt(fromHex.slice(i, i + 2), 16);
    const b = parseInt(toHex.slice(i, i + 2), 16);
    out += to2(a + (b - a) * k);
  }
  return out;
}

// A raw scene record plus caller-supplied defaults into a typed settings object. No DOM, no
// globals, no side effects.
function parseSceneFogSettings(scene, defaults) {
  const fs  = scene && scene.fogSettings;
  const hex   = (fs && fs.pickedHex)        ? fs.pickedHex  : defaults.hex;
  const alpha = (fs && fs.tintAlpha != null) ? fs.tintAlpha  : defaults.alpha;
  const a  = (fs && fs.anim) ? fs.anim : {};
  const D  = defaults.anim;
  const num = (v, def) => (typeof v === 'number' && isFinite(v)) ? v : def;
  return {
    hex,
    alpha,
    anim: {
      enabled: (typeof a.enabled === 'boolean') ? a.enabled : D.enabled,
      speed:   num(a.speed,   D.speed),
      drift:   num(a.drift,   D.drift),
      morph:   num(a.morph,   D.morph),
      warpStr: num(a.warpStr, D.warpStr),
      warpRad: num(a.warpRad, D.warpRad),
      pulse:   num(a.pulse,   D.pulse),
    },
  };
}

// ─── Node.js export guard (unit tests only) ──────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { _hexToHsl, _hslToHex, deriveFogColors, lerpHex, parseSceneFogSettings };
}
