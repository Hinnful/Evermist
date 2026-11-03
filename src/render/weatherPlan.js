'use strict';
// weatherPlan.js - pure weather kernel: the six presets, how hard each falls over time, how the
// puddles and settled snow follow, the fade between two, and a saved id read back. No DOM. Tested.

const WEATHER_FADE_MS = 8000;
const WEATHER_IDS = ['none', 'rain', 'storm', 'snowfall', 'blizzard', 'fair'];

// w: 0 rain, 1 snow, 2 clouds, 3 none. p1/p2 are the shader's two number sets. lo/hi: the range the
// strength wanders in. cell: heavy patches. wet/snow: puddles and settled snow at full strength.
// melt: seconds for settled snow to go, 100 under rain.
const WEATHER_PRESETS = {
  none:     { id: 'none',     label: 'No weather',   w: 3, wind: 0,  p1: [0, 0, 0, 0],            p2: [0, 0, 0],        lo: 0,  hi: 0, cell: 0,  dark: 0,   flash: false, wet: 0,  snow: 0,  lines: 0, melt: 300 },
  rain:     { id: 'rain',     label: 'Rain',         w: 0, wind: 20, p1: [.38, .38, .42, .16],    p2: [.22, .22, 0],    lo: .3, hi: 1, cell: .6, dark: .14, flash: false, wet: .8, snow: 0,  lines: 0, melt: 100 },
  storm:    { id: 'storm',    label: 'Storm',        w: 0, wind: 40, p1: [.6, .55, .5, .3],       p2: [.32, .38, .35],  lo: .55, hi: 1, cell: 1, dark: .28, flash: true,  wet: 1,  snow: 0,  lines: 0, melt: 100 },
  snowfall: { id: 'snowfall', label: 'Snowfall',     w: 1, wind: 15, p1: [.42, .03, 0, .5],       p2: [1, .32, 0],      lo: .4, hi: 1, cell: .5, dark: .06, flash: false, wet: 0,  snow: .8, lines: 0, melt: 300 },
  blizzard: { id: 'blizzard', label: 'Blizzard',     w: 1, wind: 60, p1: [.5, .09, .35, .45],     p2: [.6, .45, 0],     lo: .6, hi: 1, cell: 1,  dark: .18, flash: false, wet: 0,  snow: 1,  lines: 0, melt: 300 },
  fair:     { id: 'fair',     label: 'Fair weather', w: 2, wind: 30, p1: [-.05, .3, .18, 0],      p2: [.03, 0, 0],      lo: 1,  hi: 1, cell: 0,  dark: 0,   flash: false, wet: 0,  snow: 0,  lines: 1, melt: 300 },
};

// An unknown, missing or non-string id is No weather, so a record from anywhere loads.
function weatherNormalize(id) {
  return typeof id === 'string' && WEATHER_IDS.includes(id) ? id : 'none';
}

// The strength wanders between the preset's lo and hi: two slow waves, a lull or a downpour every
// minute or two. t is seconds.
function weatherStrength(p, t) {
  if (p.w === 3) return 0;
  const k = 0.5 + 0.5 * (0.6 * Math.sin(t / 41) + 0.4 * Math.sin(t / 97 + 1.3));
  return p.lo + (p.hi - p.lo) * k;
}

function weatherToward(v, target, dt, up, down) {
  return v < target ? Math.min(target, v + dt / up) : Math.max(target, v - dt / down);
}

// Puddles fill in 60 s and dry in 150; snow settles in 180 and melts in `melt`. `I` is the strength now.
function weatherStepGround(levels, dt, p, I) {
  return {
    wet: weatherToward(levels.wet, p.wet * I, dt, 60, 150),
    snow: weatherToward(levels.snow, p.snow * (0.6 + 0.4 * I), dt, 180, p.melt),
  };
}

// A map that opens with a preset starts at its settled levels; build-up happens only on a change in play.
function weatherStartLevels(p, t) {
  const I = weatherStrength(p, t);
  return { wet: p.wet * I, snow: p.snow * (0.6 + 0.4 * I) };
}

// 0..1 through the 8 s fade, eased.
function weatherFadeCurve(k) {
  const x = Math.max(0, Math.min(1, k));
  return x * x * (3 - 2 * x);
}

// Lightning: k is seconds since the flash began.
function weatherFlashAmp(k) {
  if (k < 0 || k > 1.2) return 0;
  const a = k < 0.06 ? k / 0.06 : k < 0.14 ? 1 - (k - 0.06) / 0.08 * 0.8 : k < 0.2 ? 0.2 + (k - 0.14) / 0.06 * 0.5 : 0.7 * Math.exp(-(k - 0.2) * 4);
  return a * 0.35;
}

// A gust lives 4.5 s and travels about a map height with the wind. `g` is { x, y } where it began (map
// fractions) and k its age as 0..1.
const WEATHER_WIND_DIR = [0.9578, 0.2873];
function weatherGustAt(g, k) {
  if (!g || k < 0 || k > 1) return { a: 0, x: 0, y: 0 };
  return { a: Math.sin(Math.PI * k), x: g.x + WEATHER_WIND_DIR[0] * k * 0.9, y: g.y + WEATHER_WIND_DIR[1] * k * 0.9 };
}

// A cheap stand-in for "the rooms changed": the count and a rolling hash of every outline number.
// The mask is rebuilt only when this differs.
function weatherRoomsKey(polygons) {
  let h = 0, n = 0;
  const mix = v => { h = (Math.imul(h, 31) + Math.round((v || 0) * 8)) | 0; };
  const ring = r => { for (const p of r) { mix(p.x); mix(p.y); } mix(-1); };
  for (const p of polygons || []) {
    n++;
    ring(p.vertices || []);
    for (const hole of p.holes || []) ring(hole);
    mix(p.cornerRadius);
    for (const r of p.cornerRadii || []) mix(r == null ? -2 : r);
    for (const hd of p.handles || []) if (hd) { mix(hd.ix); mix(hd.iy); mix(hd.ox); mix(hd.oy); }
  }
  return n + ':' + h;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WEATHER_FADE_MS, WEATHER_IDS, WEATHER_PRESETS, weatherNormalize, weatherStrength, weatherToward,
    weatherStepGround, weatherStartLevels, weatherFadeCurve, weatherFlashAmp, weatherGustAt, weatherRoomsKey };
}
