// fogGeometry.js — pure geometry + math kernel for the fog pipeline.
// Extracted from fog.js / tools.js so this logic is argument-in / value-out
// with zero DOM, canvas, RAF, or global-state dependencies — which is what
// makes it unit-testable under node:test (the rest of fog.js is Canvas-2D
// compositing and animation lifecycle, which is not node-testable). See CLAUDE.md.
//
// Loaded via <script src> BEFORE fog.js and tools.js, so these functions exist
// when those modules reference them. Also require()-able in tests via the guard
// at the bottom (same pattern as grid.js:lineWidthForZoom).

'use strict';

// ─── Polygon bounding box ──────────────────────────────────────────────────────
function getPolyBBox(verts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const v of verts) {
    if (v.x < minX) minX = v.x; if (v.y < minY) minY = v.y;
    if (v.x > maxX) maxX = v.x; if (v.y > maxY) maxY = v.y;
  }
  return { minX, minY, maxX, maxY };
}

// ─── Rounded polygon path ─────────────────────────────────────────────────────
// Used by both the fog pipeline (applyPolygonToFog) and the cursor drawing
// (drawPolyOutline in tools.js).
// verts must be in target coordinate space.
// perVertR: optional array of per-vertex radius overrides (null entries fall back to defaultR).
// Concave (reflex) vertices are always sharp — prevents inside-out arc deformation.
function buildRoundedPolyPath(ctx, verts, defaultR, perVertR) {
  const n = verts.length;
  const getR = (i) => (perVertR && perVertR[i] != null) ? perVertR[i] : defaultR;
  if (n < 3) {
    ctx.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < n; i++) ctx.lineTo(verts[i].x, verts[i].y);
    ctx.closePath();
    return;
  }
  for (let i = 0; i < n; i++) {
    const r = getR(i);
    const prev = verts[(i - 1 + n) % n];
    const curr = verts[i];
    const next = verts[(i + 1) % n];
    const dPrev = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const dNext = Math.hypot(next.x - curr.x, next.y - curr.y);
    if (r <= 0 || dPrev === 0 || dNext === 0) {
      if (i === 0) ctx.moveTo(curr.x, curr.y); else ctx.lineTo(curr.x, curr.y);
      continue;
    }
    const maxR = Math.min(r, dPrev / 2, dNext / 2);
    const ex = curr.x + (prev.x - curr.x) / dPrev * maxR;
    const ey = curr.y + (prev.y - curr.y) / dPrev * maxR;
    if (i === 0) ctx.moveTo(ex, ey); else ctx.lineTo(ex, ey);
    ctx.arcTo(curr.x, curr.y, next.x, next.y, maxR);
  }
  ctx.closePath();
}

// ─── Polygon inset ──────────────────────────────────────────────────────────
// Returns a copy of `verts` with each vertex moved inward by `dist` units.
// Uses the edge-bisector formula so the perpendicular inset is exactly `dist`
// at every edge (handles both CW and CCW winding via the shoelace sign).
function insetPolygon(verts, dist) {
  const n = verts.length;
  if (n < 3 || dist <= 0) return verts;
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area2 += verts[i].x * verts[j].y - verts[j].x * verts[i].y;
  }
  const sign = area2 > 0 ? 1 : -1; // CW in screen space = positive area
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = verts[(i + n - 1) % n], b = verts[i], c = verts[(i + 1) % n];
    const e1x = b.x - a.x, e1y = b.y - a.y, l1 = Math.hypot(e1x, e1y) || 1;
    const e2x = c.x - b.x, e2y = c.y - b.y, l2 = Math.hypot(e2x, e2y) || 1;
    const nx1 = sign * -e1y / l1, ny1 = sign * e1x / l1;
    const nx2 = sign * -e2y / l2, ny2 = sign * e2x / l2;
    const bx = nx1 + nx2, by = ny1 + ny2;
    const denom = bx * nx1 + by * ny1;
    if (Math.abs(denom) < 0.01) {
      out.push({ x: b.x + nx2 * dist, y: b.y + ny2 * dist });
    } else {
      const s = dist / denom;
      out.push({ x: b.x + bx * s, y: b.y + by * s });
    }
  }
  return out;
}

// ─── DPI-adaptive radius math ──────────────────────────────────────────────────
// Scale blur/feather radii proportionally to fog canvas size so they cover the
// same fraction of the map regardless of image resolution. `maxDim` is the fog
// canvas's larger dimension; `ref` is the reference size (FOG_SIZE_REF).
function fogSizeScale(maxDim, ref) {
  const linear = Math.min(1, maxDim / ref);
  return linear * linear;
}

// A scaled radius never drops below 1px so thin blur/feather stays visible.
function scaledRadius(base, sizeScale) {
  return Math.max(1, base * sizeScale);
}

// ─── Fog animation math ────────────────────────────────────────────────────────
// Wrap a drift offset into [0, tile) so cloud tiling repeats seamlessly.
function wrapOffset(v, tile) {
  return ((v % tile) + tile) % tile;
}

// Oscillate a base alpha by ±amp using a sine driven by (time*freq + phase).
function pulseAlpha(base, amp, time, freq, phase) {
  return base * (1 + amp * Math.sin(time * freq + phase));
}

// Given a fractional frame position and frame count, return the two frame
// indices to crossfade and the [0,1) blend factor between them.
function cloudBlendIndices(pos, total) {
  const wrapped = ((pos % total) + total) % total;
  const idxA = Math.floor(wrapped) % total;
  const idxB = (idxA + 1) % total;
  const blend = wrapped - Math.floor(wrapped);
  return { idxA, idxB, blend };
}

// ─── Fog color derivation ──────────────────────────────────────────────────────
// Derives a { base, tint } hex pair from a single picked hex color.
// base: dark version of the hue — used as the solid fill behind Player fog.
// tint: vivid/bright version — used as the source-atop glow overlay on both paths.
// Both inputs and outputs are '#rrggbb' hex strings.
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

// deriveFogColors(pickedHex) → { base: '#rrggbb', tint: '#rrggbb' }
// base: same hue, saturation halved, lightness ~33% of picked (dark, desaturated).
// tint: hue nudged +8° (toward purple for warm picks), saturation boosted, lightness boosted.
// Clamped so pure-black/white picks still produce visible fog.
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

// ─── Animation slider math ────────────────────────────────────────────────────
// Log-scale mapping between a 0-1000 slider position and a physical parameter
// value. baseVal is the midpoint (slider=500 → baseVal). Range is baseVal/50 …
// baseVal×50 (50× either direction), matching the fog anim panel sliders.
function animLogScale(sliderVal, baseVal) {
  return baseVal * Math.exp((sliderVal - 500) / 500 * Math.log(50));
}

// Inverse: physical value → slider position. Returns 0 when either arg is 0.
function animSliderFromVal(currentVal, baseVal) {
  if (baseVal === 0 || currentVal === 0) return 0;
  return 500 + 500 * Math.log(currentVal / baseVal) / Math.log(50);
}

// ─── Cloud noise kernels ──────────────────────────────────────────────────────
// Bilinear interpolation over a tiling Float32Array grid of size n×n.
// Wraps on both axes so the texture tiles seamlessly.
function sampleWrappedNoise(grid, n, fx, fy) {
  const x = ((fx % n) + n) % n;
  const y = ((fy % n) + n) % n;
  const x0 = x | 0, y0 = y | 0;
  const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
  const sx = x - x0, sy = y - y0;
  const tx = sx * sx * (3 - 2 * sx), ty = sy * sy * (3 - 2 * sy);
  const a = grid[y0 * n + x0], b = grid[y0 * n + x1];
  const c = grid[y1 * n + x0], d = grid[y1 * n + x1];
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

// Multi-octave turbulence over a stack of { grid, n, scale } layers.
// Pure: layers passed in, no global reads.
function fogTurbulence(layers, px, py) {
  let val = 0, total = 0;
  for (const L of layers) {
    val += sampleWrappedNoise(L.grid, L.n, px * L.n, py * L.n) * L.scale;
    total += L.scale;
  }
  return val / total;
}

// ─── Scene fog-settings parser ───────────────────────────────────────────────
// Pure value-resolution: maps a raw scene record + caller-supplied defaults into
// a typed settings object. No DOM reads, no global reads, no side effects.
// defaults shape: { hex, alpha, anim: { enabled, speed, drift, morph, warpStr, warpRad, pulse } }
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
  module.exports = {
    getPolyBBox,
    buildRoundedPolyPath,
    insetPolygon,
    fogSizeScale,
    scaledRadius,
    wrapOffset,
    pulseAlpha,
    cloudBlendIndices,
    sampleWrappedNoise,
    fogTurbulence,
    parseSceneFogSettings,
    deriveFogColors,
    animLogScale,
    animSliderFromVal,
  };
}
