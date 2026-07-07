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
  const wrapped = pos % total;
  const idxA = Math.floor(wrapped) % total;
  const idxB = (idxA + 1) % total;
  const blend = wrapped - Math.floor(wrapped);
  return { idxA, idxB, blend };
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
  };
}
