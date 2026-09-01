// fogGeometry.js — pure geometry + math kernel for the fog pipeline. Argument-in / value-out with
// no DOM, canvas, RAF or global state, which is what makes it unit-testable.
//
// Loaded via <script src> BEFORE fog.js and tools.js, and require()-able in tests.

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
// Used by both the fog pipeline and the cursor drawing. verts must be in target space, and
// perVertR overrides defaultR per vertex. ⚠ Reflex vertices are always sharp, or the arc deforms.
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
// Each vertex moved inward by `dist`, by the edge-bisector formula, so the perpendicular inset is
// exactly `dist` at every edge. Both windings, via the shoelace sign.
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

// ─── Axis alignment snap ──────────────────────────────────────────────────────
// Nudges `pt` onto a reference point's exact x or y when already within `thresh`, straightening a
// nearly-straight wall. An ALIGNMENT snap, never a movement constraint: off-axis points are
// returned untouched. thresh is in the points' own units, so screen-px callers divide by zoom.
// Only the closer of x and y snaps, so a near-45° segment cannot flip between axes.
function snapToAxis(pt, refs, thresh) {
  if (!(thresh > 0) || !refs || !refs.length) return { x: pt.x, y: pt.y };
  let bestDev = thresh, bestAxis = null, bestVal = 0;
  for (const r of refs) {
    if (!r) continue;
    const dx = Math.abs(pt.x - r.x);
    if (dx < bestDev) { bestDev = dx; bestAxis = 'x'; bestVal = r.x; }
    const dy = Math.abs(pt.y - r.y);
    if (dy < bestDev) { bestDev = dy; bestAxis = 'y'; bestVal = r.y; }
  }
  if (bestAxis === 'x') return { x: bestVal, y: pt.y };
  if (bestAxis === 'y') return { x: pt.x, y: bestVal };
  return { x: pt.x, y: pt.y };
}

// ─── Cone ──────────────────────────────────────────────────────────────────────
// A cone is drawn apex-first: press at the origin, drag towards where it points. The drag sets
// DIRECTION and LENGTH; the spread is fixed.
//
// ⚠ THE SPREAD IS NOT A FREE PARAMETER. A D&D cone is as wide at its far end as it is long, which
// fixes the half-angle at atan(0.5). A cone that opened wider would measure a different area than
// the players' own rulers. Never make it a slider unless the DM asks.
//
// The far edge bows outward slightly, because a bare triangle reads as a paper cut-out.
//
// ⚠ THE TWO CORNERS DO NOT MOVE when the bulge changes, so width-equals-length holds however
// CONE_BULGE is set — and every measurement runs between the FIRST and LAST vertex, never v[1] and
// v[2]. The bulge costs reach, so keep it small; 0 gives the exact triangle back.
//
// snapDeg > 0 rounds the direction, which is the straighten-walls toggle.
const CONE_HALF_SPREAD = 0.5;   // half-width at the far end, as a fraction of the length
const CONE_BULGE = 0.08;        // how far the arc's middle stands past the far edge, ditto
const CONE_ARC_SEGS = 8;        // enough for a shallow arc; the whole shape stays hand-editable

function coneVertices(apex, tip, snapDeg) {
  const dx = tip.x - apex.x, dy = tip.y - apex.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return null;
  let ang = Math.atan2(dy, dx);
  if (snapDeg > 0) {
    const step = snapDeg * Math.PI / 180;
    ang = Math.round(ang / step) * step;
  }
  const ux = Math.cos(ang), uy = Math.sin(ang);
  const h = len * CONE_HALF_SPREAD;               // half-width at the far end
  // Local frame: along the axis, then perpendicular. Building the arc here rather than in map
  // coordinates keeps the circle maths one-dimensional.
  const toMap = (a, b) => ({ x: apex.x + ux * a - uy * b, y: apex.y + uy * a + ux * b });
  const s = len * CONE_BULGE;
  if (!(s > 0)) return [toMap(0, 0), toMap(len, h), toMap(len, -h)];

  // The circle through (len, +h), (len + s, 0) and (len, -h). Its centre sits behind the apex for
  // a shallow bulge, which is why the arc reads as a bow and not a pizza slice.
  const cx = len + s / 2 - (h * h) / (2 * s);
  const r = len + s - cx;
  const half = Math.asin(Math.min(1, h / r));     // half the arc's own angle, from the centre
  const out = [toMap(0, 0)];
  // Walked from +h to -h, so the arc runs the same way round as the triangle's corners did and
  // the winding is unchanged. First and last vertex are still the two corners.
  for (let i = 0; i <= CONE_ARC_SEGS; i++) {
    const t = half - (2 * half) * (i / CONE_ARC_SEGS);
    out.push(toMap(cx + Math.cos(t) * r, Math.sin(t) * r));
  }
  return out;
}

// ─── DPI-adaptive radius math ──────────────────────────────────────────────────
// Radii scale with fog canvas size, so they cover the same fraction of any map. `maxDim` is the
// canvas's larger dimension, `ref` the reference size.
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

// ─── Cloud blend rebuild throttle ─────────────────────────────────────────────
// At display refresh the blend advances a tiny fraction of a frame per tick, so rebuilding every
// tick is invisible work. These two helpers are the gate: when, and how far.

// True once the scheduled rebuild time has arrived.
function shouldRebuildCloudBlend(ts, nextTs) {
  return ts >= nextTs;
}

// Seconds of morph for this rebuild: the time elapsed since the previous one, ⚠ never one tick's
// dt, which would slow the morph in proportion to the throttle. Clamped so a long stall cannot
// jump the morph forward, and 0 on the first rebuild.
function cloudBlendElapsedSec(ts, lastTs, maxSec) {
  if (!lastTs) return 0;
  return Math.min(Math.max(0, (ts - lastTs) / 1000), maxSec);
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

// ─── Animation slider math ────────────────────────────────────────────────────
// Log-scale mapping between a 0-1000 slider position and a parameter value. baseVal is the
// midpoint, and the range reaches 50× either side of it.
function animLogScale(sliderVal, baseVal) {
  return baseVal * Math.exp((sliderVal - 500) / 500 * Math.log(50));
}

// Inverse: physical value → slider position. Returns 0 when either arg is 0.
function animSliderFromVal(currentVal, baseVal) {
  if (baseVal === 0 || currentVal === 0) return 0;
  return 500 + 500 * Math.log(currentVal / baseVal) / Math.log(50);
}

// ─── Cloud noise kernels ──────────────────────────────────────────────────────
// Bilinear interpolation over a tiling n×n Float32Array grid. Wraps on both axes.
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
// ─── Door notches ─────────────────────────────────────────────────────────────
// A door marks an exit on a room's outline, stored as {edge, t}: which wall, and where along it.
// It carries no size — width and depth come from the grid cell at draw time, so correcting a
// scene's grid resizes every door already placed. The notch straddles its wall, reaching the same
// distance either side, which frees it from the outline's winding and from which side was traced.

const DOOR_AXIS_EPS = 0.999;   // above this a wall counts as straight, so it snaps to the world grid

function doorSizeForCell(cell, widthPct, depthPct) {
  const c = cell > 0 ? cell : 0;
  return { width: c * (widthPct / 100), depth: c * (depthPct / 100) };
}

function polygonWindingSign(verts) {
  let area2 = 0;
  for (let i = 0; i < verts.length; i++) {
    const j = (i + 1) % verts.length;
    area2 += verts[i].x * verts[j].y - verts[j].x * verts[i].y;
  }
  return area2 > 0 ? 1 : -1;
}

// Outward unit normal of edge i, i.e. the opposite of the direction insetPolygon moves a vertex.
function edgeOutwardNormal(verts, edge) {
  const a = verts[edge % verts.length], b = verts[(edge + 1) % verts.length];
  const ex = b.x - a.x, ey = b.y - a.y;
  const len = Math.hypot(ex, ey) || 1;
  const sign = polygonWindingSign(verts);
  return { x: sign * ey / len, y: -sign * ex / len };
}

// The wall a door sits on: its endpoints, unit direction, outward normal and length.
function doorEdgeFrame(verts, edge) {
  if (!verts || verts.length < 3) return null;
  const n = verts.length;
  const ei = ((edge | 0) % n + n) % n;
  const a = verts[ei], b = verts[(ei + 1) % n];
  const ex = b.x - a.x, ey = b.y - a.y;
  const len = Math.hypot(ex, ey);
  if (!(len > 0)) return null;
  return { ei, a, b, len, ux: ex / len, uy: ey / len, n: edgeOutwardNormal(verts, ei) };
}

// Where a wall's cell boundaries fall, as distances along it from its start vertex. ONE source for
// both the snap and the ticks the DM sees, so what is drawn is where a door lands.
// A straight wall on a square grid reads the WORLD grid, offsets included, or a room whose corner
// sits off a grid line carries every door off with it. Diagonal and hex walls subdivide themselves.
function doorCellBounds(verts, edge, cell, offsetX, offsetY, squareGrid) {
  const f = doorEdgeFrame(verts, edge);
  if (!f || !(cell > 0)) return null;
  const axis = Math.abs(f.ux) > DOOR_AXIS_EPS || Math.abs(f.uy) > DOOR_AXIS_EPS;
  const at = [0];
  if (squareGrid && axis) {
    // Projecting the grid's origin onto the wall keeps whichever axis the wall runs along and
    // discards the other, so one expression covers horizontal and vertical alike.
    const base = ((offsetX || 0) - f.a.x) * f.ux + ((offsetY || 0) - f.a.y) * f.uy;
    for (let k = Math.ceil(-base / cell); base + k * cell < f.len; k++) {
      const a = base + k * cell;
      if (a > 0) at.push(a);
    }
  } else {
    for (let a = cell; a < f.len; a += cell) at.push(a);
  }
  at.push(f.len);
  return { frame: f, at };
}

// Snaps a click to the cell it landed in, so a door fills that cell.
function doorCellSnap(verts, edge, mx, my, cell, offsetX, offsetY, squareGrid) {
  const b = doorCellBounds(verts, edge, cell, offsetX, offsetY, squareGrid);
  if (!b) return null;
  const f = b.frame;
  const along = Math.max(0, Math.min(f.len, (mx - f.a.x) * f.ux + (my - f.a.y) * f.uy));
  let i = 0;
  while (i < b.at.length - 2 && along >= b.at[i + 1]) i++;
  const centre = (b.at[i] + b.at[i + 1]) / 2;
  const half = Math.min(cell, f.len) / 2;
  return { edge: f.ei, t: Math.max(half, Math.min(f.len - half, centre)) / f.len };
}

// The four corners of one notch, a plain rectangle straddling the wall, in the space of `verts`.
// The caller passes a deeper inward reach than the shape needs: that ground is already clear, and
// the extra is what makes the notch meet the reveal's ragged edge instead of floating free.
function doorNotchCorners(verts, door, width, out, inward) {
  const f = doorEdgeFrame(verts, door && door.edge);
  if (!f || !(width > 0) || !(out > 0)) return null;
  // Capped at the wall: a cell is wider than a short alcove edge, and an uncapped door would carve
  // fog around both its corners rather than mark an opening in it.
  const hw = Math.min(width, f.len) / 2;
  const back = -(inward > 0 ? inward : out);
  const t = Math.max(0, Math.min(1, door.t));
  const px = f.a.x + (f.b.x - f.a.x) * t, py = f.a.y + (f.b.y - f.a.y) * t;
  return {
    outerL: { x: px - f.ux * hw + f.n.x * out,  y: py - f.uy * hw + f.n.y * out },
    outerR: { x: px + f.ux * hw + f.n.x * out,  y: py + f.uy * hw + f.n.y * out },
    innerL: { x: px - f.ux * hw + f.n.x * back, y: py - f.uy * hw + f.n.y * back },
    innerR: { x: px + f.ux * hw + f.n.x * back, y: py + f.uy * hw + f.n.y * back },
  };
}

// Nearest point on the outline to (mx,my). Returns null when nothing is within `maxDist`.
function nearestOutlinePoint(verts, mx, my, maxDist) {
  if (!verts || verts.length < 2) return null;
  let best = null;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i], b = verts[(i + 1) % verts.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((mx - a.x) * dx + (my - a.y) * dy) / lenSq));
    const cx = a.x + dx * t, cy = a.y + dy * t;
    const d = Math.hypot(mx - cx, my - cy);
    if (!best || d < best.dist) best = { edge: i, t, x: cx, y: cy, dist: d };
  }
  if (maxDist != null && best && best.dist > maxDist) return null;
  return best;
}

// Where a door's centre sits, for the DM's outline.
function doorPoint(verts, door) {
  const f = doorEdgeFrame(verts, door && door.edge);
  if (!f) return null;
  const t = Math.max(0, Math.min(1, door.t));
  return { x: f.a.x + (f.b.x - f.a.x) * t, y: f.a.y + (f.b.y - f.a.y) * t };
}

// Whether a click landed on a door — the fallback for one placed before the grid changed, which no
// longer sits on a cell centre. ⚠ `slack` forgives DEPTH ONLY: along the wall it would reach into
// the next cell, so a click beside a door would delete it instead of opening a second one.
function pointInDoorNotch(verts, door, width, depth, mx, my, slack) {
  const f = doorEdgeFrame(verts, door && door.edge);
  if (!f) return false;
  const t = Math.max(0, Math.min(1, door.t));
  const px = f.a.x + (f.b.x - f.a.x) * t, py = f.a.y + (f.b.y - f.a.y) * t;
  const relX = mx - px, relY = my - py;
  const along = relX * f.ux + relY * f.uy;
  const perp  = relX * f.n.x + relY * f.n.y;
  const s = slack || 0;
  return Math.abs(along) < Math.min(width, f.len) / 2 && perp >= -depth - s && perp <= depth + s;
}

// ─── Shared walls ─────────────────────────────────────────────────────────────
// Which stretches of a wall another room's outline runs along, as {from, to} distances from the
// wall's start vertex. Two rooms sharing a wall each feather INWARD from it, so neither reaches a
// full erase on the line and a band of fog is left standing over the wall.
// `tol` is what counts as the same wall; spans are widened by half a step, to cover the gaps
// between the points actually sampled.
function sharedWallSpans(verts, edge, others, tol, step) {
  const f = doorEdgeFrame(verts, edge);
  if (!f || !others || !(tol > 0) || !(step > 0)) return [];

  // Bounding-box reject first: on a real map almost no room is anywhere near a given wall.
  const loX = Math.min(f.a.x, f.b.x) - tol, hiX = Math.max(f.a.x, f.b.x) + tol;
  const loY = Math.min(f.a.y, f.b.y) - tol, hiY = Math.max(f.a.y, f.b.y) + tol;
  const near = [];
  for (const o of others) {
    if (!o || !o.vertices || o.vertices.length < 3) continue;
    const b = getPolyBBox(o.vertices);
    if (b.maxX < loX || b.minX > hiX || b.maxY < loY || b.minY > hiY) continue;
    near.push(o);
  }
  if (!near.length) return [];

  const n = Math.max(1, Math.ceil(f.len / step));
  const half = f.len / n / 2;
  const spans = [];
  let open = -1, last = -1;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * f.len;
    const px = f.a.x + f.ux * a, py = f.a.y + f.uy * a;
    let hit = false;
    for (const o of near) {
      if (nearestOutlinePoint(o.vertices, px, py, tol)) { hit = true; break; }
    }
    // Closed at the last point that HIT, not at the first that missed, or a span that ends
    // mid-wall runs a whole step past the neighbour it was following.
    if (hit) { if (open < 0) open = a; last = a; }
    else if (open >= 0) { spans.push({ from: open, to: last }); open = -1; }
  }
  if (open >= 0) spans.push({ from: open, to: last });
  return spans.map(sp => ({
    from: Math.max(0, sp.from - half),
    to: Math.min(f.len, sp.to + half),
  }));
}

// Least to most revealed. Anything unset paints like a reveal, matching applyPolygonToFog.
const DOOR_MODE_ORDER = ['shroud', 'half', 'reveal'];

function doorModeRank(mode) {
  const i = DOOR_MODE_ORDER.indexOf(mode);
  return i < 0 ? DOOR_MODE_ORDER.length - 1 : i;
}

// The state a door shows in: the most revealed of EVERY room whose wall runs through it, never the
// state of the one room that stores it. Two rooms share a doorway's wall and a click attaches to
// only one, which the DM cannot aim at. It also settles half-shroud, which has no answer while a
// door belongs to one room: half beside shrouded is half, revealed beside anything is revealed.
function doorResolvedMode(centre, rooms, tol) {
  if (!centre || !rooms) return 'shroud';
  let best = 0;
  for (const r of rooms) {
    if (!r || !r.vertices || r.vertices.length < 3) continue;
    if (!nearestOutlinePoint(r.vertices, centre.x, centre.y, tol)) continue;
    const rank = doorModeRank(r.mode);
    if (rank > best) best = rank;
  }
  return DOOR_MODE_ORDER[best];
}

// Which of a floor plan's openings are doorways, and where each notch goes. `rooms` is one vertex
// array per room, `portals` the plan's opening centres, both in map pixels.
//
// ⚠ AN OPENING BECOMES A DOOR ONLY WHERE TWO ROOMS SHARE THE WALL. One room means a window or an
// outside entrance, and the DM places those by hand — guessing them fills a map with wrong notches.
// The tolerance matches doorMouseDown's; widen it past half a cell and one portal starts claiming
// three rooms.
function planDoorPlacements(rooms, portals, cell, offsetX, offsetY, squareGrid) {
  if (!(cell > 0) || !Array.isArray(rooms) || !Array.isArray(portals)) return [];
  const tol = cell * 0.25;
  const out = [];
  for (const p of portals) {
    if (!p || !isFinite(p.x) || !isFinite(p.y)) continue;
    let hits = 0, best = null, bestIndex = -1;
    for (let i = 0; i < rooms.length; i++) {
      const verts = rooms[i];
      if (!verts || verts.length < 3) continue;
      const near = nearestOutlinePoint(verts, p.x, p.y, tol);
      if (!near) continue;
      hits++;
      if (!best || near.dist < best.dist) { best = near; bestIndex = i; }
    }
    if (hits < 2) continue;
    // Stored on ONE room, whichever is nearest: a door on a shared wall shows from either side.
    const verts = rooms[bestIndex];
    const door = doorCellSnap(verts, best.edge, p.x, p.y, cell, offsetX, offsetY, squareGrid);
    if (!door) continue;
    const centre = doorPoint(verts, door);
    if (!centre) continue;
    // Two portals can snap to the same cell — a double doorway is two entries in the file.
    if (out.some(o => Math.hypot(o.centre.x - centre.x, o.centre.y - centre.y) < tol)) continue;
    out.push({ roomIndex: bestIndex, door, centre });
  }
  return out.map(o => ({ roomIndex: o.roomIndex, door: o.door }));
}

// Keeps doors pointing at the same wall when a vertex is added or removed. `at` is the index
// passed to the matching vertices.splice; delta is +1 for an insert, -1 for a delete. A door on
// a deleted edge has no wall left to sit on, so it goes.
function remapDoorsForVertexChange(doors, at, delta) {
  if (!doors || !doors.length) return doors || [];
  const out = [];
  for (const d of doors) {
    if (delta < 0) {
      if (d.edge === at || d.edge === at - 1) continue;
      out.push({ ...d, edge: d.edge > at ? d.edge - 1 : d.edge });
    } else {
      out.push({ ...d, edge: d.edge > at ? d.edge + 1 : d.edge });
    }
  }
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getPolyBBox,
    buildRoundedPolyPath,
    insetPolygon,
    polygonWindingSign,
    edgeOutwardNormal,
    doorEdgeFrame,
    doorSizeForCell,
    doorCellBounds,
    doorCellSnap,
    doorNotchCorners,
    nearestOutlinePoint,
    doorPoint,
    pointInDoorNotch,
    doorModeRank,
    doorResolvedMode,
    sharedWallSpans,
    DOOR_MODE_ORDER,
    remapDoorsForVertexChange,
    planDoorPlacements,
    DOOR_AXIS_EPS,
    snapToAxis,
    coneVertices,
    CONE_HALF_SPREAD,
    CONE_BULGE,
    fogSizeScale,
    scaledRadius,
    wrapOffset,
    pulseAlpha,
    cloudBlendIndices,
    shouldRebuildCloudBlend,
    cloudBlendElapsedSec,
    sampleWrappedNoise,
    fogTurbulence,
    parseSceneFogSettings,
    deriveFogColors,
    lerpHex,
    animLogScale,
    animSliderFromVal,
  };
}
