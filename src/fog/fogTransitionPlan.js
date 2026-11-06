'use strict';
// fogTransitionPlan.js - pure kernel for how a fog change travels on the TV: which pixels changed,
// the order they change in, and which pixels a change takes over from one still running. No canvas, no GL.

const FOG_ORDER_DIFF_MIN = 6;     // alpha steps (of 255) under which a pixel counts as unchanged
const FOG_ORDER_REVEAL   = 255;   // a region pixel's direction code: the fog thins here
const FOG_ORDER_HIDE     = 128;   // ... or thickens

// Integer hash to [0, 1).
function fogOrderHash(ix, iy) {
  let h = (Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Smooth value noise in [0, 1].
function fogValueNoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = fogOrderHash(ix, iy), b = fogOrderHash(ix + 1, iy);
  const c = fogOrderHash(ix, iy + 1), d = fogOrderHash(ix + 1, iy + 1);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
}

// The order noise at a grid point: blobs about `cell` grid pixels wide, a little fine grain on top.
function fogOrderNoise(x, y, cell) {
  const u = x / cell + 3.7, v = y / cell + 3.7;
  const big = (fogValueNoise(u, v) * .5 + fogValueNoise(u * 2.03 + 3.1, v * 2.03 + 3.1) * .25
    + fogValueNoise(u * 4.01 + 7.7, v * 4.01 + 7.7) * .125) / .875;
  return big * .85 + .15 * fogValueNoise(u * 6.4, v * 6.4);
}

// Fills region (0 = unchanged, else the direction code) from two alpha arrays of one size; returns
// how many pixels changed. Less fog is a reveal.
function fogChangedRegion(oldA, newA, region, min) {
  const lim = min === undefined ? FOG_ORDER_DIFF_MIN : min;
  let count = 0;
  for (let i = 0; i < region.length; i++) {
    const d = oldA[i] - newA[i];
    if (d > lim) { region[i] = FOG_ORDER_REVEAL; count++; }
    else if (d < -lim) { region[i] = FOG_ORDER_HIDE; count++; }
    else region[i] = 0;
  }
  return count;
}

// vals over the region: the order noise on a lattice of every second pixel, bilinear between, so the
// field is smooth per pixel at a quarter of the noise cost (its finest detail is many pixels wide).
function fogOrderField(region, gw, gh, cell, vals) {
  const lw = (gw >> 1) + 2, lat = new Float32Array(lw * ((gh >> 1) + 2)).fill(-1);
  const node = (lx, ly) => {
    const k = ly * lw + lx;
    let v = lat[k];
    if (v < 0) v = lat[k] = fogOrderNoise(lx * 2, ly * 2, cell);
    return v;
  };
  for (let y = 0, i = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++, i++) {
      if (!region[i]) continue;
      const lx = x >> 1, ly = y >> 1, fx = (x & 1) * .5, fy = (y & 1) * .5;
      const top = node(lx, ly) * (1 - fx) + node(lx + 1, ly) * fx;
      const bot = node(lx, ly + 1) * (1 - fx) + node(lx + 1, ly + 1) * fx;
      vals[i] = top * (1 - fy) + bot * fy;
    }
  }
}

// Distance from the region's edge for every region pixel, 0..1: near 0 at the walls, 1 at the deepest
// point (a two-sweep chamfer, 4-connected). Pixels off the region are left alone.
function fogEdgeDistance(region, gw, gh, out) {
  const INF = 1e9;
  for (let i = 0; i < region.length; i++) if (region[i]) out[i] = INF;
  for (let y = 0, i = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++, i++) {
      if (!region[i]) continue;
      let v = out[i];
      if (x > 0) v = Math.min(v, (region[i - 1] ? out[i - 1] : 0) + 1);
      if (y > 0) v = Math.min(v, (region[i - gw] ? out[i - gw] : 0) + 1);
      out[i] = v;
    }
  }
  let max = 1;
  for (let y = gh - 1; y >= 0; y--) {
    for (let x = gw - 1; x >= 0; x--) {
      const i = y * gw + x;
      if (!region[i]) continue;
      let v = out[i];
      if (x < gw - 1) v = Math.min(v, (region[i + 1] ? out[i + 1] : 0) + 1);
      if (y < gh - 1) v = Math.min(v, (region[i + gw] ? out[i + gw] : 0) + 1);
      out[i] = v;
      if (v > max) max = v;
    }
  }
  for (let i = 0; i < region.length; i++) if (region[i]) out[i] /= max;
}

// Reshapes vals over the region with a theme's rank(u, v, n, f, dir, w, vn): u, v the pixel's place in the
// region's box (0..1, v 0 at the top), n the soft blob value already in vals, f fine (a grain a fifth of
// the blobs' size), dir 1 for a reveal pixel and -1 for a hide, w the edge distance (fogEdgeDistance), vn fogValueNoise.
// fine and dist are scratch arrays of the grid's size.
function fogShapeRank(region, gw, gh, cell, rank, vals, fine, dist) {
  let x0 = gw, x1 = -1, y0 = gh, y1 = -1;
  for (let y = 0, i = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++, i++) {
      if (!region[i]) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return;
  fogEdgeDistance(region, gw, gh, dist);
  const sf = Math.max(1, cell * .225), sx = Math.max(1, x1 - x0), sy = Math.max(1, y1 - y0);
  for (let y = y0, i0 = y0 * gw; y <= y1; y++, i0 += gw) {
    for (let x = x0; x <= x1; x++) {
      const i = i0 + x;
      if (!region[i]) continue;
      fine[i] = fogValueNoise(x / sf + 40, y / sf);
      vals[i] = rank((x - x0) / sx, (y - y0) / sy, vals[i], fine[i], region[i] === FOG_ORDER_REVEAL ? 1 : -1, dist[i], fogValueNoise);
    }
  }
}

// For every pixel within R of the region, the index of its nearest region pixel (a region pixel's own
// index for itself), else -1. Two sweeps that carry the nearest source along; close enough to Euclid.
function fogNearestRegion(region, gw, gh, R, near) {
  near.fill(-1);
  let x0 = gw, x1 = -1, y0 = gh, y1 = -1;
  for (let y = 0, i = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++, i++) {
      if (!region[i]) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      near[i] = i;
    }
  }
  if (x1 < 0) return;
  x0 = Math.max(0, x0 - R); y0 = Math.max(0, y0 - R); x1 = Math.min(gw - 1, x1 + R); y1 = Math.min(gh - 1, y1 + R);
  const r2 = R * R;
  const d2 = (x, y, s) => { const sy = (s / gw) | 0, sx = s - sy * gw; return (x - sx) * (x - sx) + (y - sy) * (y - sy); };
  const sweep = (xa, xb, dx, ya, yb, dy, nb) => {
    for (let y = ya; y !== yb + dy; y += dy) {
      for (let x = xa; x !== xb + dx; x += dx) {
        const i = y * gw + x;
        if (near[i] === i) continue;
        let best = near[i], bd = best >= 0 ? d2(x, y, best) : Infinity;
        for (let k = 0; k < nb.length; k++) {
          const nx = x + nb[k][0], ny = y + nb[k][1];
          if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue;
          const s = near[ny * gw + nx];
          if (s < 0) continue;
          const d = d2(x, y, s);
          if (d < bd) { bd = d; best = s; }
        }
        near[i] = bd <= r2 ? best : -1;
      }
    }
  };
  sweep(x0, x1, 1, y0, y1, 1, [[-1, 0], [-1, -1], [0, -1], [1, -1]]);
  sweep(x1, x0, -1, y1, y0, -1, [[1, 0], [1, 1], [0, 1], [-1, 1]]);
}

// Rewrites vals (in [0, 1]) over the region as their rank in it: the first pixel to go sits at 0 and
// the last at 1, whatever the region's size, so a small room moves at once.
function fogRankNormalise(vals, region, count) {
  const BINS = 256, hist = new Uint32Array(BINS);
  const bin = (v) => Math.min(BINS - 1, Math.max(0, Math.floor(v * BINS)));
  for (let i = 0; i < vals.length; i++) if (region[i]) hist[bin(vals[i])]++;
  const before = new Float64Array(BINS);
  let run = 0, last = -1;
  for (let b = 0; b < BINS; b++) { before[b] = run; run += hist[b]; if (hist[b]) last = b; }
  const span = count - (last >= 0 ? hist[last] : 0);
  for (let i = 0; i < vals.length; i++) {
    if (region[i]) vals[i] = span > 0 ? Math.min(1, before[bin(vals[i])] / span) : 0;
  }
}

// Whether a new change lands on pixels another change is still moving, which is when it needs the bake.
function fogChangeOverlaps(region, owner) {
  for (let i = 0; i < region.length; i++) if (region[i] && owner[i]) return true;
  return false;
}

// Which pixels a new change takes (take[i] = 1) and what the TV shows there as it starts (prevA). A
// changed pixel is always taken: where another change still moves it, from what the TV shows right now
// (shown, the bake), else from the outgoing mask. A pixel only in the ring round the change stays with a
// change whose own changed pixel it is (core), or that change's room would finish on the new one's clock;
// a pixel only in that change's ring is taken, or its edge would show the new mask at once.
// Returns how many taken pixels were mid-travel.
function fogTakePixels(prevA, oldA, region, ext, owner, core, shown, take) {
  let mid = 0;
  for (let i = 0; i < ext.length; i++) {
    take[i] = 0;
    if (!ext[i]) continue;
    if (owner[i] && region[i]) { prevA[i] = shown[i]; mid++; }
    else if (owner[i] && core[i]) continue;
    else prevA[i] = oldA[i];
    take[i] = 1;
  }
  return mid;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FOG_ORDER_DIFF_MIN, FOG_ORDER_REVEAL, FOG_ORDER_HIDE,
    fogOrderHash, fogValueNoise, fogOrderNoise, fogChangedRegion, fogOrderField, fogEdgeDistance, fogShapeRank, fogNearestRegion, fogRankNormalise,
    fogChangeOverlaps, fogTakePixels,
  };
}
