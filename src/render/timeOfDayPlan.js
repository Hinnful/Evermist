'use strict';
// timeOfDayPlan.js - pure time-of-day kernel: the four ids, a saved id read back, each filter's numbers
// and the filter itself per pixel, the lamp mask, and the blend a fade walks. No DOM. Tested.
// All maths is in LINEAR light. weatherShader.js carries the same numbers into GLSL.

const TIME_OF_DAY_IDS = ['none', 'day', 'dusk', 'night'];
const TIME_OF_DAY_LABELS = { none: 'None', day: 'Day', dusk: 'Dusk', night: 'Night' };

// Every filter is fixed: the same numbers on every map, never measured from one.
const TOD = {
  pivot: 0.06,                      // contrast() turns about this linear luminance
  shoulder: [0.7, 0.3],             // knee and headroom of the soft roll-off to white
  warm: [1, 0.62, 0.3],             // window glow on the ground just outside a room
  roomWarm: [1, 0.88, 0.74],        // a dark interior's lamp-lit cast
  day: { lift: 1.9, white: 0.7, sun: [1.04, 1, 0.9], lampGrey: 0.9, lampPull: 0.6, sat: 1.04 },
  dusk: {
    sun: [1.22, 0.5], sunDir: [0.7, 0.3], relTop: 0.12, satEdge: [0.55, 0.75],
    hiFull: [1.45, 0.94, 0.55], hiSoft: [1.12, 0.9, 1.16], lo: [0.7, 0.72, 1.3], sat: 1.02,
    contrast: 1.15, gain: 0.42, bright: 0.2, brightEdge: [0.25, 0.7], spill: 0.8, cap: 0.35,
  },
  night: { desat: 0.55, tint: [0.5, 0.72, 1.3], contrast: 1.15, gain: 0.16, floor: [0.001, 0.0018, 0.0045], spill: 1.2, cap: 0.6 },
  // Blur radii as fractions of the map's width (the board was drawn 1400px wide).
  glowBlur: 40 / 1400,
  lamp: { width: 700, near: 10.5 / 1400, far: 61.25 / 1400, spread: 19.25 / 1400, gain: 1.8, lift: [0.3, 0.9], warm: [0.5, 1.2] },
};

function timeOfDayNormalize(id) {
  return typeof id === 'string' && TIME_OF_DAY_IDS.includes(id) ? id : 'none';
}

// A save writes the pick onto the scene record. None is no field at all, so a map never given a time of day
// keeps the record the previous release wrote, and an id this build cannot read (a newer release's, after
// /rollback) stays until the DM picks another.
function timeOfDayWrite(rec, id) {
  if (id === timeOfDayNormalize(rec.timeOfDay)) return;
  if (id !== 'none') rec.timeOfDay = id; else delete rec.timeOfDay;
}

const LW = [0.2126, 0.7152, 0.0722];
const todLum = c => c[0] * LW[0] + c[1] * LW[1] + c[2] * LW[2];
const _norm = c => { const l = todLum(c); return c.map(v => v / l); };
const todSmooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const todShoulder = x => (x < TOD.shoulder[0] ? x : TOD.shoulder[0] + TOD.shoulder[1] * (1 - Math.exp(-(x - TOD.shoulder[0]) / TOD.shoulder[1])));
const todToLinear = s => (s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4));
const todToSrgb = l => { const c = Math.max(0, Math.min(1, l)); return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; };

function _contrast(c, p) {
  const L = todLum(c), Lc = TOD.pivot * Math.pow((L + 1e-4) / TOD.pivot, p);
  return c.map(v => v * Lc / (L + 1e-4));
}
const _resat = (c, k) => { const L = todLum(c); return c.map(v => L + (v - L) * k); };

// Each filter of the board, before rooms: `a` is linear RGB.
function todNight(a) {
  const n = TOD.night, L = todLum(a), t = _norm(n.tint);
  const c = a.map((v, i) => (v + (L - v) * n.desat) * t[i]);
  return _contrast(c, n.contrast).map((v, i) => v * n.gain + n.floor[i]);
}

// u, v: the pixel's place on the map, 0..1 from the top left; the low sun is on the left.
function todDusk(a, u, v) {
  const d = TOD.dusk, L = todLum(a);
  const sun = d.sun[0] - d.sun[1] * todSmooth(0, 1, u * d.sunDir[0] + v * d.sunDir[1]);
  const rel = todSmooth(0, d.relTop, L);
  const mx = Math.max(a[0], a[1], a[2]), mn = Math.min(a[0], a[1], a[2]);
  const k = todSmooth(d.satEdge[0], d.satEdge[1], (mx - mn) / (mx + 1e-4));
  const hf = _norm(d.hiFull), hs = _norm(d.hiSoft), lo = _norm(d.lo);
  const c = _resat(a.map((x, i) => x * (lo[i] + (hs[i] + (hf[i] - hs[i]) * k - lo[i]) * rel)), d.sat);
  const g = (d.gain + d.bright * todSmooth(d.brightEdge[0], d.brightEdge[1], L)) * sun;
  return _contrast(c, d.contrast).map(x => x * g);
}

// lamp: the lamp mask's value here, which takes the lamps' orange off the ground.
function todDay(a, lamp) {
  const d = TOD.day;
  let b = a.map((v, i) => v * d.sun[i]);
  const Lb = todLum(b);
  b = b.map(v => v + (Lb * d.lampGrey - v) * lamp * d.lampPull);
  return _resat(b.map(v => d.lift * v / (1 + (d.lift - 1) * v / d.white)), d.sat);
}

// Dusk and Night outside rooms; inside, a dark interior stays as drawn and bright ground dims.
// inside: the room mask, glow: the blurred mask less the room.
function _withRooms(a, out, inside, glow, spill, cap) {
  const L = todLum(a), dim = 1 - cap * todSmooth(0.05, 0.5, L), cast = 1 - todSmooth(0.12, 0.35, L);
  return out.map((o, i) => {
    const lit = o + a[i] * TOD.warm[i] * glow * spill;
    const room = a[i] * dim * (1 + (TOD.roomWarm[i] - 1) * cast);
    return todShoulder(lit * (1 - inside) + room * inside);
  });
}

// One pixel through one time of day. px: { inside, glow, lamp, u, v }, each 0..1.
function todGrade(id, a, px) {
  const p = Object.assign({ inside: 0, glow: 0, lamp: 0, u: 0.5, v: 0.5 }, px);
  if (id === 'day') return todDay(a, p.lamp).map(todShoulder);
  if (id === 'dusk') return _withRooms(a, todDusk(a, p.u, p.v), p.inside, p.glow, TOD.dusk.spill, TOD.dusk.cap);
  if (id === 'night') return _withRooms(a, todNight(a), p.inside, p.glow, TOD.night.spill, TOD.night.cap);
  return a.slice();
}

// A fade blends the grades by weight: [day, dusk, night], None being what is left. A change picked mid-fade
// starts from the weights on screen, so it never jumps.
function todWeights(id) {
  const n = timeOfDayNormalize(id);
  return [n === 'day' ? 1 : 0, n === 'dusk' ? 1 : 0, n === 'night' ? 1 : 0];
}
function todWeightsMix(from, to, e) {
  return from.map((f, i) => f + (to[i] - f) * e);
}

// ─── The lamp mask ────────────────────────────────────────────────────────────
// Where the map's own lamps sit: warm and brighter than their surroundings. Built once per map from a
// still TOD.lamp.width wide; Day takes their orange off the ground.

function _box1(src, w, h, r, horiz) {
  const out = new Float32Array(src.length), n = horiz ? w : h, m = horiz ? h : w;
  for (let j = 0; j < m; j++) {
    let acc = 0;
    const at = i => src[horiz ? j * w + i : i * w + j];
    for (let i = 0; i <= Math.min(r, n - 1); i++) acc += at(i);
    for (let i = 0; i < n; i++) {
      const lo = i - r - 1, hi = i + r;
      if (i > 0) { if (hi < n) acc += at(hi); if (lo >= 0) acc -= at(lo); }
      out[horiz ? j * w + i : i * w + j] = acc / (Math.min(hi, n - 1) - Math.max(lo, -1));
    }
  }
  return out;
}

// Three box passes, close to a gaussian of radius `r` px, as the board blurred.
function todBlur(src, w, h, r) {
  const k = Math.max(1, Math.floor(r / 1.7));
  let a = src;
  for (let p = 0; p < 3; p++) a = _box1(_box1(a, w, h, k, true), w, h, k, false);
  return a;
}

// rgb: linear RGB, three floats a pixel. Answers one float a pixel, 0..1.
function todLampMask(rgb, w, h) {
  const m = TOD.lamp, L = new Float32Array(w * h), warm = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const c = [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]], l = todLum(c), s = Math.max(l, 1e-5);
    L[i] = l; warm[i] = (c[0] - c[2]) / s;
  }
  const near = todBlur(L, w, h, m.near * w), far = todBlur(L, w, h, m.far * w);
  const raw = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const lift = Math.log((near[i] + 1e-4) / (far[i] + 1e-4));
    raw[i] = todSmooth(m.lift[0], m.lift[1], lift) * todSmooth(m.warm[0], m.warm[1], warm[i]);
  }
  const out = todBlur(raw, w, h, m.spread * w);
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1, out[i] * m.gain);
  return out;
}

// The same from 8-bit sRGB RGBA, as a canvas reads back.
function todLampMaskRgba(data, w, h) {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = todToLinear(i / 255);
  const rgb = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = lut[data[i * 4 + c]];
  return todLampMask(rgb, w, h);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TIME_OF_DAY_IDS, TIME_OF_DAY_LABELS, TOD, timeOfDayNormalize, timeOfDayWrite, todLum, todSmooth, todShoulder,
    todToLinear, todToSrgb, todNight, todDusk, todDay, todGrade, todWeights, todWeightsMix, todBlur, todLampMask,
    todLampMaskRgba };
}
