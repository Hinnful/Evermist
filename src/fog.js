'use strict';

// ─── Fog constants ────────────────────────────────────────────────────────────
const FOG_SCALE          = 4;
const FOG_BLUR_RADIUS    = 8;   // px at 1/4 scale — tuned for ~6000px-wide maps
const FOG_OPACITY_DM     = 0.55;
const FOG_FEATHER_RADIUS = 12;  // px at FOG_SCALE — tuned for ~6000px-wide maps
const FOG_EDGE_MARGIN    = 2;   // px at FOG_SCALE — thin always-shrouded frame at the map's
                                // outer edge so reveals that reach the boundary fade INTO it
                                // instead of hard-stopping (the sharp horizontal "seam").
const FOG_SIZE_REF       = 1500; // fog canvas max dim at reference map size (6000/FOG_SCALE)
const CLOUD_PASSES = [
  { scale: 1.0,  angle: 0,     alpha: 1.0, driftX:  14, driftY:  7,  alphaFreq: 0.08, alphaPhase: 0   },
  { scale: 1.73, angle: 0.40,  alpha: 0.4, driftX: -9,  driftY:  11, alphaFreq: 0.12, alphaPhase: 1.8 },
  { scale: 0.61, angle: -0.29, alpha: 0.3, driftX:  7,  driftY: -14, alphaFreq: 0.06, alphaPhase: 3.5 },
];
const CLOUD_FRAME_COUNT   = 16;
let   cloudFrameSpeed     = 0.35;  // frames per second → full cycle ~46s
let   cloudWarpRadius     = 0.08;  // small steps → near-identical consecutive frames
let   cloudWarpStrength   = 0.15;  // gentle warp so crossfade looks like smooth morphing
let   driftScale          = 1.0;   // multiplier on all drift speeds
let   alphaPulseAmp       = 0.30;  // ±30% alpha oscillation

// ─── Fog canvases (offscreen, 1/FOG_SCALE) ───────────────────────────────────
let fogDataCanvas = null, fogDataCtx = null; // 1/FOG_SCALE, source of truth
let baseFogCanvas = null, baseFogCtx = null;
let fogBlurCanvas = null, fogBlurCtx = null; // scratch for blur pass
let fogEffectCanvas = null, fogEffectCtx = null; // cached blur+cloud result (map-rect sized; used for transitions)
let cloudCanvas = null, cloudPattern = null;

// ─── Fog animation settings ───────────────────────────────────────────────────
let fogAnimEnabled = false;
let fogAnimSpeed   = 1.0;
// The drift and transition state, and every loop that moves them, live in fogAnim.js.

// ─── Cloud frame cycling ─────────────────────────────────────────────────────
let cloudFrames    = [];   // array of offscreen canvases (domain-warped noise)
let cloudFramePos  = 0;    // float index — fractional part is crossfade blend
let cloudBlendCanvas = null, cloudBlendCtx = null;
let cloudSetWarp = null;   // the warp cloudFrames was built with, never the live numbers

// buildRoundedPolyPath lives in fogGeometry.js (pure geometry kernel, loaded first).

// ─── DPI-adaptive radius helpers ──────────────────────────────────────────────
// Radii scale with fog canvas size, so they cover the same fraction of any map. The pure math
// lives in fogGeometry.js; these wrappers read live state.
function getFogSizeScale() {
  if (!fogDataCanvas) return 1;
  return fogSizeScale(Math.max(fogDataCanvas.width, fogDataCanvas.height), FOG_SIZE_REF);
}
let fogFeatherRadius = FOG_FEATHER_RADIUS; // overridable at runtime via UI slider
// How much fog REMAINS in a half-shrouded room, 0 = revealed, 1 = shrouded. One global value,
// never per-room or per-scene: "half" is one state with one density.
let fogHalfAlpha = 0.5;
const FOG_HALF_ALPHA_KEY = 'evermist.fogHalfAlpha';
function getScaledBlurRadius()    { return scaledRadius(FOG_BLUR_RADIUS,  getFogSizeScale()); }
function getScaledFeatherRadius() { return scaledRadius(fogFeatherRadius, getFogSizeScale()); }

// ─── Fog data operations ──────────────────────────────────────────────────────
// All coordinates are in MAP space; fogDataCanvas is at 1/FOG_SCALE.
// insetPolygon lives in fogGeometry.js (pure geometry kernel, loaded first).

function revealCircle(mx, my, r) {
  const fx = mx / FOG_SCALE, fy = my / FOG_SCALE, fr = r / FOG_SCALE;
  for (const ctx of [fogDataCtx, baseFogCtx]) {
    if (!ctx) continue;
    ctx.save();
    ctx.beginPath();
    ctx.arc(fx, fy, fr, 0, Math.PI * 2);
    ctx.clip();
    ctx.clearRect(fx - fr, fy - fr, fr * 2, fr * 2);
    ctx.restore();
  }
}

function shroudCircle(mx, my, r) {
  for (const ctx of [fogDataCtx, baseFogCtx]) {
    if (!ctx) continue;
    ctx.fillStyle = '#1a1a2e';
    ctx.beginPath();
    ctx.arc(mx / FOG_SCALE, my / FOG_SCALE, r / FOG_SCALE, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ─── Polygon fog application ──────────────────────────────────────────────────
// Scratch canvas reused across calls — resize-on-demand instead of allocating per polygon.
let _fogScratch = null, _fogScratchCtx = null;

function applyPolygonToFog(poly) {
  if (!fogDataCtx || poly.vertices.length < 3) return;
  const verts = poly.vertices;

  const crFog = (poly.cornerRadius || 0) / FOG_SCALE;
  const pvRFog = poly.cornerRadii ? poly.cornerRadii.map(rv => (rv != null ? rv : (poly.cornerRadius || 0)) / FOG_SCALE) : null;
  // Every path below carries the holes, so a courtyard stays shrouded inside a revealed keep.
  const scale = ring => ring.map(v => ({ x: v.x / FOG_SCALE, y: v.y / FOG_SCALE }));
  // The handles are offsets, so they take the same scale as the points they hang off.
  const fogH = scaleHandles(poly.handles, 1 / FOG_SCALE);
  const fogScaledVerts = scale(verts);
  const fogHoles = polyHoleRings(poly).map(scale);

  if (poly.mode === 'shroud') {
    fogDataCtx.save();
    fogDataCtx.beginPath();
    buildRoundedPolyPath(fogDataCtx, fogScaledVerts, crFog, pvRFog, fogHoles, fogH);
    fogDataCtx.fillStyle = '#1a1a2e';
    fogDataCtx.fill();
    fogDataCtx.restore();
  } else {
    // Feathered reveal: draw polygon blurred on scratch, then destination-out onto fog.
    // 'half' rides this same mask and differs in ONE way — the erase runs to completion like a
    // reveal and half-density fog is painted back through the mask, so the state is ABSOLUTE.
    const isHalf = poly.mode === 'half';
    const halfAlpha = Math.max(0, Math.min(1, fogHalfAlpha));
    const bb = shapeBBox(poly);
    const feather = getScaledFeatherRadius();
    const pad = Math.ceil(feather) + 2;
    const bx = Math.floor(bb.minX / FOG_SCALE) - pad;
    const by = Math.floor(bb.minY / FOG_SCALE) - pad;
    const bw = Math.ceil((bb.maxX - bb.minX) / FOG_SCALE) + pad * 2;
    const bh = Math.ceil((bb.maxY - bb.minY) / FOG_SCALE) + pad * 2;
    if (!_fogScratch) { _fogScratch = document.createElement('canvas'); _fogScratchCtx = _fogScratch.getContext('2d'); }
    _fogScratch.width  = Math.max(1, bw);  // resize clears the canvas
    _fogScratch.height = Math.max(1, bh);
    const scratch = _fogScratch, sCtx = _fogScratchCtx;
    sCtx.filter = `blur(${feather}px)`;
    sCtx.fillStyle = 'white';
    sCtx.beginPath();
    const shift = ring => ring.map(v => ({ x: v.x - bx, y: v.y - by }));
    buildRoundedPolyPath(sCtx, shift(fogScaledVerts), crFog, pvRFog, fogHoles.map(shift), fogH);
    sCtx.fill();
    sCtx.filter = 'none';

    // Erode edges with cloud noise so the reveal boundary is ragged rather than geometric.
    if (cloudCanvas) {
      const tileSize = Math.max(8, Math.round(48 * getFogSizeScale()));
      const offX = ((bx % tileSize) + tileSize) % tileSize;
      const offY = ((by % tileSize) + tileSize) % tileSize;
      sCtx.save();
      sCtx.globalCompositeOperation = 'destination-out';
      sCtx.globalAlpha = 0.22;
      for (let cx = -offX; cx < scratch.width; cx += tileSize) {
        for (let cy = -offY; cy < scratch.height; cy += tileSize) {
          sCtx.drawImage(cloudCanvas, cx, cy, tileSize, tileSize);
        }
      }
      sCtx.restore();
    }

    // Clip back to the polygon so the soft edge fades inward only, never clearing fog outside.
    sCtx.save();
    sCtx.globalCompositeOperation = 'destination-in';
    sCtx.fillStyle = 'white';
    sCtx.beginPath();
    buildRoundedPolyPath(sCtx, shift(fogScaledVerts), crFog, pvRFog, fogHoles.map(shift), fogH);
    sCtx.fill();
    sCtx.restore();

    // Cloud erosion leaves residue in the interior. A reveal clears it later with a clearRect;
    // half repaints through this mask, so residue left here reads as blotchy density. Flatten the
    // interior on the mask instead — the inset keeps the feathered edge band untouched.
    // ⚠ THE HOLES ARE OUTSET while the outer ring is inset, or the band along an inner wall clears.
    const stepIn = insetPolyRings({ vertices: fogScaledVerts, holes: fogHoles }, feather);
    const insetVerts = stepIn.vertices;
    const insetHoles = stepIn.holes;
    if (isHalf && insetVerts.length >= 3) {
      sCtx.save();
      sCtx.beginPath();
      buildRoundedPolyPath(sCtx, shift(insetVerts), Math.max(0, crFog - feather), null,
                           insetHoles.map(shift), fogH);
      sCtx.fillStyle = 'white';
      sCtx.fill();
      sCtx.restore();
    }

    flattenSharedWalls(sCtx, poly, fogScaledVerts, fogHoles, feather, bx, by);

    fogDataCtx.save();
    fogDataCtx.globalCompositeOperation = 'destination-out';
    fogDataCtx.globalAlpha = 1;
    fogDataCtx.drawImage(scratch, bx, by);
    fogDataCtx.restore();

    // Half: paint fog back through the same mask at fogHalfAlpha. Erase-then-repaint, never a
    // partial erase — destination-out only multiplies, so it could not touch ground already
    // cleared by a brush stroke. Repainting SETS the density, which is what makes half absolute.
    if (isHalf) {
      sCtx.save();
      sCtx.globalCompositeOperation = 'source-in';   // recolour the mask, keep its alpha
      sCtx.fillStyle = '#1a1a2e';
      sCtx.fillRect(0, 0, scratch.width, scratch.height);
      sCtx.restore();
      fogDataCtx.save();
      fogDataCtx.globalAlpha = halfAlpha;
      fogDataCtx.drawImage(scratch, bx, by);
      fogDataCtx.restore();
    }

    // Clip to the inset polygon so the feathered edge band survives and only the interior clears.
    if (!isHalf && insetVerts.length >= 3) {
      fogDataCtx.save();
      fogDataCtx.beginPath();
      // The clearRect below keeps its OUTER box: the clip path now excludes each hole.
      buildRoundedPolyPath(fogDataCtx, insetVerts, Math.max(0, crFog - feather), null, insetHoles, fogH);
      fogDataCtx.clip();
      fogDataCtx.clearRect(bb.minX / FOG_SCALE - 1, bb.minY / FOG_SCALE - 1,
                           (bb.maxX - bb.minX) / FOG_SCALE + 2, (bb.maxY - bb.minY) / FOG_SCALE + 2);
      fogDataCtx.restore();
    }
  }
}

// A fraction of a cell: two rooms sharing a doorway count, one across a corridor does not.
const DOOR_SHARED_WALL_TOL = 0.35;

// Carves a room's doors, each in the state the rooms around it resolve to. No cloud erosion: it is
// a texture for a long boundary and only makes a tab this small look patchy.
function applyDoorsToFog(poly) {
  if (!fogDataCtx) return;
  const doors = poly.doors;
  if (!doors || !doors.length || poly.vertices.length < 3) return;
  const size = doorSizeForCell(gridSize / FOG_SCALE, doorWidthPct, doorDepthPct);
  if (!(size.width > 0) || !(size.depth > 0)) return;

  const tol = gridSize * DOOR_SHARED_WALL_TOL;
  const open = [], dim = [];
  for (const d of doors) {
    const mode = doorResolvedMode(doorPoint(poly, d), polygons, tol);
    if (mode === 'reveal') open.push(d);
    else if (mode === 'half') dim.push(d);
  }
  if (!open.length && !dim.length) return;

  // Holes included, so a door on an inner wall carves its notch there.
  const scaleRing = ring => ring.map(v => ({ x: v.x / FOG_SCALE, y: v.y / FOG_SCALE }));
  // The handles ride along, or a notch on a bent wall lands on the chord instead of the curve.
  const fogVerts = { vertices: scaleRing(poly.vertices),
                     holes: polyHoleRings(poly).map(scaleRing),
                     handles: scaleHandles(poly.handles, 1 / FOG_SCALE) };
  // ⚠ Capped against the notch's own depth. The fog feather is tuned for a room-sized edge, and
  // against a door it is wider than the shape it softens, which rounds the rectangle into a blob.
  const feather = Math.min(getScaledFeatherRadius(), size.depth * 0.35);
  // ⚠ The overrun goes on the OWNER's side only, and only when that side is already cleared, where
  // it cannot be seen. It exists so the notch meets the reveal's ragged edge rather than leaving a
  // faint band. Applied to both sides it pinned the visible depth of every door whose owner is the
  // shrouded room of a shared wall — and which room owns a door is not something the DM aims at.
  const inward = poly.mode === 'shroud' ? size.depth
                                        : Math.max(size.depth, getScaledFeatherRadius() * 1.5 + 3);
  if (open.length) carveDoorNotches(fogVerts, open, size, inward, feather, false);
  if (dim.length)  carveDoorNotches(fogVerts, dim,  size, inward, feather, true);
}

// Erase-then-repaint for half, for the reason applyPolygonToFog gives where it does the same.
function carveDoorNotches(fogVerts, doors, size, inward, feather, half) {
  const shapes = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of doors) {
    const c = doorNotchCorners(fogVerts, d, size.width, size.depth, inward);
    if (!c) continue;
    shapes.push(c);
    for (const pt of [c.outerL, c.outerR, c.innerL, c.innerR]) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
  }
  if (!shapes.length) return;

  const pad = Math.ceil(feather) + 2;
  const bx = Math.floor(minX) - pad, by = Math.floor(minY) - pad;
  const bw = Math.ceil(maxX - minX) + pad * 2, bh = Math.ceil(maxY - minY) + pad * 2;
  if (!_fogScratch) { _fogScratch = document.createElement('canvas'); _fogScratchCtx = _fogScratch.getContext('2d'); }
  _fogScratch.width  = Math.max(1, bw);   // resize clears the canvas
  _fogScratch.height = Math.max(1, bh);
  const scratch = _fogScratch, sCtx = _fogScratchCtx;
  sCtx.filter = feather > 0 ? `blur(${feather}px)` : 'none';
  sCtx.fillStyle = 'white';
  for (const c of shapes) {
    sCtx.beginPath();
    sCtx.moveTo(c.innerL.x - bx, c.innerL.y - by);
    sCtx.lineTo(c.outerL.x - bx, c.outerL.y - by);
    sCtx.lineTo(c.outerR.x - bx, c.outerR.y - by);
    sCtx.lineTo(c.innerR.x - bx, c.innerR.y - by);
    sCtx.closePath();
    sCtx.fill();
  }
  sCtx.filter = 'none';

  fogDataCtx.save();
  fogDataCtx.globalCompositeOperation = 'destination-out';
  fogDataCtx.globalAlpha = 1;
  fogDataCtx.drawImage(scratch, bx, by);
  fogDataCtx.restore();

  if (!half) return;
  sCtx.save();
  sCtx.globalCompositeOperation = 'source-in';   // recolour the mask, keep its alpha
  sCtx.fillStyle = '#1a1a2e';
  sCtx.fillRect(0, 0, scratch.width, scratch.height);
  sCtx.restore();
  fogDataCtx.save();
  fogDataCtx.globalAlpha = Math.max(0, Math.min(1, fogHalfAlpha));
  fogDataCtx.drawImage(scratch, bx, by);
  fogDataCtx.restore();
}

// How close another room's outline runs to count as the same wall, as a fraction of the feather.
const SHARED_WALL_TOL = 0.5;

// ⚠ Runs AFTER the mask is clipped to the polygon, so it reaches a little OUTSIDE the wall too:
// two rooms that traced the same wall a pixel apart leave a sliver neither covers.
// Only against rooms that are NOT shrouded — a wall facing unexplored space is a real fog
// boundary and keeps its soft edge.
function flattenSharedWalls(sCtx, poly, fogScaledVerts, fogHoles, feather, bx, by) {
  if (typeof polygons === 'undefined' || !(feather > 0)) return;
  const density = p => (p.mode === 'shroud' ? 'shroud' : p.mode === 'half' ? 'half' : 'reveal');
  const mine = density(poly);
  const open = polygons.filter(p => p !== poly && p.vertices.length >= 3 && density(p) !== 'shroud');
  if (!open.length) return;
  const tolMap = feather * FOG_SCALE * SHARED_WALL_TOL;
  const stepMap = feather * FOG_SCALE;
  const into = feather * 1.6;

  sCtx.save();
  sCtx.fillStyle = 'white';
  sCtx.beginPath();
  // ⚠ The band crosses the wall ONLY where the neighbour paints the same density. Crossing bridges
  // two rooms traced a few pixels apart, and costs nothing between two revealed rooms. Between a
  // revealed room and a half one, whichever composites last would win a strip on the wrong side.
  // Scaled here, not handed in: applyPolygonToFog's copy is local to it.
  const scaled = { vertices: fogScaledVerts, holes: fogHoles,
                   handles: scaleHandles(poly.handles, 1 / FOG_SCALE) };
  const edges = flatVertexCount(poly);
  for (const [group, out] of [[open.filter(p => density(p) === mine), feather * 0.25],
                              [open.filter(p => density(p) !== mine), 0]]) {
    if (!group.length) continue;
    for (let e = 0; e < edges; e++) {
      const spans = sharedWallSpans(poly, e, group, tolMap, stepMap);
      if (!spans.length) continue;
      const f = doorEdgeFrame(scaled, e);
      if (!f) continue;
      for (const sp of spans) {
        // Pulled in at both ends by the outward reach: a band that reached outward all the way to
        // a wall junction left a tab of cleared fog sticking out of the room block there.
        const s0 = sp.from / FOG_SCALE + out, s1 = sp.to / FOG_SCALE - out;
        if (!(s1 > s0)) continue;
        // Both ends read off the wall itself, so the band follows a bent one instead of cutting
        // across the chord it bows away from.
        const p0 = doorFramePoint(f, s0 / f.len), p1 = doorFramePoint(f, s1 / f.len);
        sCtx.moveTo(p0.x + p0.nx * out - bx,   p0.y + p0.ny * out - by);
        sCtx.lineTo(p1.x + p1.nx * out - bx,   p1.y + p1.ny * out - by);
        sCtx.lineTo(p1.x - p1.nx * into - bx,  p1.y - p1.ny * into - by);
        sCtx.lineTo(p0.x - p0.nx * into - bx,  p0.y - p0.ny * into - by);
        sCtx.closePath();
      }
    }
  }
  sCtx.fill();
  sCtx.restore();
}

function rebuildFogFromPolygons() {
  if (!fogDataCtx || !fogDataCanvas) return;
  fogDataCtx.clearRect(0, 0, fogDataCanvas.width, fogDataCanvas.height);
  if (baseFogCanvas) {
    fogDataCtx.drawImage(baseFogCanvas, 0, 0);
  } else {
    fogDataCtx.fillStyle = '#1a1a2e';
    fogDataCtx.fillRect(0, 0, fogDataCanvas.width, fogDataCanvas.height);
  }
  for (let i = polygons.length - 1; i >= 0; i--) applyPolygonToFog(polygons[i]);
  // ⚠ Doors are carved AFTER every room is composited, never from inside applyPolygonToFog. A door
  // straddles its wall, so it reaches into whatever is on the other side; carved room by room, a
  // shrouded neighbour applied later in this walk paints over it and the door silently vanishes.
  for (const poly of polygons) applyDoorsToFog(poly);
}

// ─── Fog effect pipeline ──────────────────────────────────────────────────────


// Padded blur source, reused across calls — see the sizing note inside rebuildFogBlur.
let _fogPadded = null, _fogPaddedCtx = null;

function rebuildFogBlur() {
  if (!fogDataCanvas) return;
  const w = fogDataCanvas.width, h = fogDataCanvas.height;

  if (!fogBlurCanvas || fogBlurCanvas.width !== w || fogBlurCanvas.height !== h) {
    fogBlurCanvas = document.createElement('canvas');
    fogBlurCanvas.width = w; fogBlurCanvas.height = h;
    fogBlurCtx = fogBlurCanvas.getContext('2d');
  }
  if (!fogEffectCanvas || fogEffectCanvas.width !== w || fogEffectCanvas.height !== h) {
    fogEffectCanvas = document.createElement('canvas');
    fogEffectCanvas.width = w; fogEffectCanvas.height = h;
    fogEffectCtx = fogEffectCanvas.getContext('2d');
  }

  // Blur on a fog-padded canvas so the map edge samples solid fog, not transparency. pad = 3×
  // blur radius, the full Gaussian tail.
  const blur = getScaledBlurRadius();
  const pad  = blur * 3;
  const pw = w + pad * 2, ph = h + pad * 2;
  // Cached on dimensions: this runs on every reveal, and a fresh map-sized canvas each time is
  // the largest churn on the fog path. ⚠ A reused canvas must be cleared first — the drawImage
  // below is source-over. Never share _fogScratch: applyPolygonToFog resizes that per polygon.
  if (!_fogPadded || _fogPadded.width !== pw || _fogPadded.height !== ph) {
    _fogPadded = document.createElement('canvas');
    _fogPadded.width = pw; _fogPadded.height = ph;
    _fogPaddedCtx = _fogPadded.getContext('2d');
  } else {
    _fogPaddedCtx.clearRect(0, 0, pw, ph);
  }
  const padded = _fogPadded, pCtx = _fogPaddedCtx;
  pCtx.drawImage(fogDataCanvas, pad, pad);                                     // fog data (center)

  // Always-shrouded edge margin: an opaque navy frame over the pad border plus the outer
  // FOG_EDGE_MARGIN px. The blur feathers its inner edge inward, so a reveal reaching the map
  // boundary fades into the margin instead of hard-stopping (the sharp horizontal seam).
  // Display blur mask ONLY — fogDataCanvas, undo and saved scenes are untouched.
  const m = FOG_EDGE_MARGIN;
  pCtx.fillStyle = '#1a1a2e';
  pCtx.fillRect(0,            0,            pw,           pad + m);  // top    (incl. top pad)
  pCtx.fillRect(0,            ph - pad - m, pw,           pad + m);  // bottom
  pCtx.fillRect(0,            0,            pad + m,      ph);       // left
  pCtx.fillRect(pw - pad - m, 0,            pad + m,      ph);       // right

  fogBlurCtx.clearRect(0, 0, w, h);
  fogBlurCtx.filter = `blur(${blur}px)`;
  fogBlurCtx.drawImage(padded, -pad, -pad);
  fogBlurCtx.filter = 'none';
}

// Composites cloud texture over the cached blur result. offsets is the per-pass drift, null for
// none. Pass fogTransBlurPrev as blurSrc during SHROUD transitions, to animate the OLD fog.
function recompositeCloudEffect(offsets, blurSrc) {
  const src = blurSrc || fogBlurCanvas;
  if (!fogEffectCanvas || !src) return;
  const w = fogEffectCanvas.width, h = fogEffectCanvas.height;

  fogEffectCtx.clearRect(0, 0, w, h);
  fogEffectCtx.drawImage(src, 0, 0);

  if (cloudPattern) {
    fogEffectCtx.save();
    fogEffectCtx.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < CLOUD_PASSES.length; i++) {
      const p   = CLOUD_PASSES[i];
      const off = offsets ? offsets[i] : { x: 0, y: 0 };
      fogEffectCtx.save();
      fogEffectCtx.globalAlpha = fogAnimEnabled ? fogAnimAlphas[i] : p.alpha;
      fogEffectCtx.translate(w / 2, h / 2);
      fogEffectCtx.rotate(p.angle);
      fogEffectCtx.scale(p.scale, p.scale);
      fogEffectCtx.translate(-w / 2 + off.x, -h / 2 + off.y);
      fogEffectCtx.fillStyle = cloudPattern;
      const pad = Math.max(w, h);
      fogEffectCtx.fillRect(-pad, -pad, w + pad * 2, h + pad * 2);
      fogEffectCtx.restore();
    }
    fogEffectCtx.restore();
  }

  // Edge luminosity. source-atop draws proportional to existing alpha, so edge pixels glow and
  // the boundary reads as luminous rather than geometric.
  fogEffectCtx.save();
  fogEffectCtx.globalCompositeOperation = 'source-atop';
  fogEffectCtx.globalAlpha = FOG_TINT_ALPHA;
  fogEffectCtx.fillStyle = fogTintColor;
  fogEffectCtx.fillRect(0, 0, w, h);
  fogEffectCtx.restore();
}

function rebuildFogEffect() {
  rebuildFogBlur();
  if (!isPlayer) {
    // DM GPU path: TilingSprites display the clouds, so only the blur canvas is uploaded.
    pixiUpdateFogBlurTexture();
  } else {
    // Player GPU path: the reveal mask is the only thing the full-screen pass reads from the CPU.
    pixiSyncPlayerFog(fogBlurCanvas, cloudBlendCanvas);
    fogDirty = true;
    scheduleRender();
  }
}

// The Player's first map decodes for seconds with no fog canvas to draw over yet, so this paints
// the same clouds against nothing: base colour, the drifting passes, tint. ⚠ NOT a second fog
// implementation - it reads the cloudPattern and drift offsets fogAnimTick already maintains, so
// it morphs and drifts exactly as real fog does. The scale is fixed because there is no camera.
const LOADING_FOG_SCALE = 2;
function drawLoadingFog(ctx, cw, ch) {
  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = fogBaseColor;
  ctx.fillRect(0, 0, cw, ch);
  if (cloudPattern) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    const s = LOADING_FOG_SCALE;
    const half = Math.hypot(cw, ch) / 2;
    for (let i = 0; i < CLOUD_PASSES.length; i++) {
      const p = CLOUD_PASSES[i];
      const off = fogAnimOffsets[i];
      // ⚠ SIZED PER PASS, in its own scaled space, and it must clear the drift: one shared radius
      // left the smallest pass short of a corner, and its rotation drew that as a diagonal.
      const r = half / (s * p.scale) + Math.hypot(off.x, off.y) + 1;
      ctx.save();
      ctx.globalAlpha = fogAnimEnabled ? fogAnimAlphas[i] : p.alpha;
      ctx.translate(cw / 2, ch / 2);
      ctx.rotate(p.angle);
      ctx.scale(s * p.scale, s * p.scale);
      ctx.translate(off.x, off.y);
      ctx.fillStyle = cloudPattern;
      ctx.fillRect(-r, -r, 2 * r, 2 * r);
      ctx.restore();
    }
    ctx.restore();
  }
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.globalAlpha = FOG_TINT_ALPHA;
  ctx.fillStyle = fogTintColor;
  ctx.fillRect(0, 0, cw, ch);
  ctx.restore();
}

// Both views render fog through PixiJS: the DM's as map-sized sprites (pixiInitFog), the Player's
// as one full-screen pass (pixiInitPlayerFog). This builds the Player's per-frame uniforms.
const _pfogM = new Float32Array(12);
const _pfogO = new Float32Array(6);
const _pfogA = new Float32Array(3);
const _pfogRGB = new Float32Array(3);
const _pfogRGB2 = new Float32Array(3);
const _pfogMaskM = new Float32Array(2);
const _pfogMaskO = new Float32Array(2);
const _pfogMaskLim = new Float32Array(2);

function hexToRGBFloat(hex, out) {
  const n = parseInt(hex.slice(1), 16);
  out[0] = ((n >> 16) & 255) / 255;
  out[1] = ((n >>  8) & 255) / 255;
  out[2] = ( n        & 255) / 255;
  return out;
}

function renderFog(vp) {
  if (!isPlayer) return;
  if (!pixiPlayerFogReady() || !fogDataCanvas || !fogBlurCanvas) return;

  // Every term derives from the map, so a scene swap changes all of them at once. fogCloudAdj
  // re-anchors the incoming scene onto the transform the outgoing one was last drawn at, which is
  // why the swap has no scale change left to travel across.
  let s  = zoom * FOG_SCALE * fogCloudAdj.k;
  let cx = mapWidth  / 2 * zoom + panX + fogCloudAdj.dx;
  let cy = mapHeight / 2 * zoom + panY + fogCloudAdj.dy;
  let hw = fogCloudAdj.hw != null ? fogCloudAdj.hw : fogDataCanvas.width  / 2;
  let hh = fogCloudAdj.hh != null ? fogCloudAdj.hh : fogDataCanvas.height / 2;
  // Pinned for the length of a switch, so the map can change size and camera under the closed
  // cover with the clouds not moving at all.
  if (fogCloudHold) {
    s = fogCloudHold.s; cx = fogCloudHold.cx; cy = fogCloudHold.cy;
    hw = fogCloudHold.hw; hh = fogCloudHold.hh;
  }
  // The transform AS DRAWN, banked so freeze/rebaseCloudTransform have something exact.
  fogCloudLast = { s: s, cx: cx, cy: cy, hw: hw, hh: hh };

  // Screen pixel → cloud UV, per pass: the context's translate/rotate/scale chain, inverted.
  const tile = cloudBlendCanvas ? cloudBlendCanvas.width : 512;
  for (let i = 0; i < CLOUD_PASSES.length; i++) {
    const p = CLOUD_PASSES[i];
    const off = fogAnimOffsets[i];
    const d  = s * p.scale * tile;
    const ct = Math.cos(p.angle) / d, st = Math.sin(p.angle) / d;
    _pfogM[i * 4]     =  ct; _pfogM[i * 4 + 1] = st;
    _pfogM[i * 4 + 2] = -st; _pfogM[i * 4 + 3] = ct;
    _pfogO[i * 2]     =  ct * cx + st * cy + (-hw + off.x) / tile;
    _pfogO[i * 2 + 1] = -st * cx + ct * cy + (-hh + off.y) / tile;
    _pfogA[i] = fogAnimEnabled ? fogAnimAlphas[i] : p.alpha;
  }

  // Screen pixel → reveal-mask UV. ⚠ Scaled by the BLUR CANVAS's own size, not the map's: its
  // dimensions are ceil(map / FOG_SCALE), so a map that does not divide evenly leaves a sliver
  // the map-sized version would sample off by a texel. uMaskLim is where the map itself ends.
  const bw = fogBlurCanvas.width, bh = fogBlurCanvas.height;
  _pfogMaskM[0] = 1 / (zoom * FOG_SCALE * bw);
  _pfogMaskM[1] = 1 / (zoom * FOG_SCALE * bh);
  _pfogMaskO[0] = panX * _pfogMaskM[0];
  _pfogMaskO[1] = panY * _pfogMaskM[1];
  _pfogMaskLim[0] = mapWidth  / (FOG_SCALE * bw);
  _pfogMaskLim[1] = mapHeight / (FOG_SCALE * bh);

  // ⚠ A FULLY CLOSED COVER REVEALS NOTHING, whatever the mask says. That is what makes the cover
  // immune to the map changing size underneath it, which it does mid-switch.
  let hasPrev = 0, transT = 1;
  if (fogCoverT < 1 && fogTransBlurPrev) {
    pixiSetPlayerFogPrevMask(fogTransBlurPrev);
    hasPrev = 1;
    transT  = fogTransT;
  }

  pixiUpdatePlayerFog({
    cloudM: _pfogM, cloudO: _pfogO, cloudA: _pfogA,
    maskM: _pfogMaskM, maskO: _pfogMaskO, maskLim: _pfogMaskLim,
    base: hexToRGBFloat(fogBaseColor, _pfogRGB),
    tint: hexToRGBFloat(fogTintColor, _pfogRGB2),
    tintA: FOG_TINT_ALPHA,
    cover: Math.min(1, fogCoverT),
    transT, hasPrev,
  });
}

// ─── Reveal All / Shroud All ──────────────────────────────────────────────────
// Resets only the hand-painted brush layer; polygons are preserved and re-applied.

function revealAllFog() {
  if (!baseFogCtx) return;
  baseFogCtx.clearRect(0, 0, baseFogCanvas.width, baseFogCanvas.height);
  if (typeof polygons !== 'undefined') polygons.forEach(p => { p.mode = 'reveal'; });
  rebuildFogFromPolygons();
  // Otherwise the room card's fog pill lies about the fog until the next repaint.
  if (typeof refreshRoomPanel === 'function') refreshRoomPanel();
}

function shroudAllFog() {
  if (!baseFogCtx) return;
  baseFogCtx.fillStyle = '#1a1a2e';
  baseFogCtx.fillRect(0, 0, baseFogCanvas.width, baseFogCanvas.height);
  if (typeof polygons !== 'undefined') polygons.forEach(p => { p.mode = 'shroud'; });
  rebuildFogFromPolygons();
  if (typeof refreshRoomPanel === 'function') refreshRoomPanel();
}

// Reveal All and Shroud All as the DM presses them: the whole edit, not just the canvas fill.
function revealAllRooms() { _wholeMapFog(revealAllFog, false); }
function shroudAllRooms() { _wholeMapFog(shroudAllFog, true); }

function _wholeMapFog(fill, isShroud) {
  if (!fogDataCtx) return;
  pushUndo();
  activePolygon = null; clearShapeSelection();
  fill();
  startFogTransition(isShroud);
  rebuildFogEffect();
  fogDirty = true;
  scheduleRender();
  scheduleAutoSync();
}

// ─── Live fog color ───────────────────────────────────────────────────────────

// Derives base+tint from the raw picked colour and repaints both render paths.
function applyFogColor(pickedHex) {
  if (paneForward('fog-color', { pickedHex })) return;
  fogPickedHex = pickedHex;
  const { base, tint } = deriveFogColors(pickedHex);
  fogBaseColor = base;
  fogTintColor = tint;

  if (!isPlayer) {
    // DM: re-fill base rect and tint overlay, and recomposite fogEffectCanvas so the
    // brush-stroke preview uses the new colours.
    if (typeof pixiUpdateFogBaseColor === 'function') pixiUpdateFogBaseColor(base);
    if (typeof pixiUpdateFogTintColor === 'function') pixiUpdateFogTintColor(tint);
    recompositeCloudEffect(fogAnimOffsets.length ? fogAnimOffsets : null);
    viewportDirty = true;
    scheduleRender();
  } else {
    // Player: renderFog reads the colours itself; the container background is the outside-map
    // area.
    const container = document.getElementById('canvas-container');
    if (container) container.style.background = base;
    fogDirty = true;
    scheduleRender();
  }
}

// Updates the tint alpha strength on both render paths.
function applyFogTintAlpha(alpha) {
  if (paneForward('fog-tint', { alpha })) return;
  FOG_TINT_ALPHA = alpha;
  if (!isPlayer) {
    if (typeof pixiUpdateFogTintColor === 'function') pixiUpdateFogTintColor(fogTintColor);
    recompositeCloudEffect(fogAnimOffsets.length ? fogAnimOffsets : null);
    viewportDirty = true;
    scheduleRender();
  } else {
    fogDirty = true;
    scheduleRender();
  }
}

// Handles the Player-side fog-color postMessage.
function handleFogColorMessage(msg) {
  if (msg.fogTintAlpha != null) FOG_TINT_ALPHA = msg.fogTintAlpha;
  // ⚠ A switch's colour ease OWNS the colour until it lands, or the DM's mid-close push snaps to
  // the destination in one frame. Retarget rather than ignore, so a colour picked DURING a switch
  // still arrives.
  if (fogColorToHex) { fogColorToHex = msg.pickedHex; return; }
  applyFogColor(msg.pickedHex);
}

// Restores fog colour + tint from a scene record on the DM side, syncing the Fog-panel DOM.
// Defaults cover scenes that predate fog persistence.
const ANIM_RUNTIME_DEFAULTS = {
  enabled: true, speed: 1.0, drift: 1.0, morph: 0.35,
  warpStr: 0.15, warpRad: 0.08, pulse: 0.30,
};

function restoreSceneFogSettings(scene) {
  const parsed = parseSceneFogSettings(scene, {
    hex: '#3a3a8c', alpha: 0.18, anim: ANIM_RUNTIME_DEFAULTS,
  });
  const { hex, alpha, anim: an } = parsed;
  applyFogColor(hex);
  applyFogTintAlpha(alpha);
  // ⚠ Never call syncFogColorToPlayer here: the colour rides the sendToPlayer fog-update, and
  // sending it early paints the new colour over the old scene's fog.

  const prevWarpStr = cloudWarpStrength;
  const prevWarpRad = cloudWarpRadius;
  showFogSettings(hex, alpha, an);

  if (cloudWarpStrength !== prevWarpStr || cloudWarpRadius !== prevWarpRad) {
    regenCloudFrames();
  } else {
    syncAnimToPlayer(false);
  }
  if (fogAnimEnabled) startFogAnim(); else stopFogAnim();
}

function regenCloudFrames() {
  generateCloudFrames(512, CLOUD_FRAME_COUNT);
  cloudFramePos = 0;
  if (fogEffectCanvas) { recompositeCloudEffect(fogAnimEnabled ? fogAnimOffsets : null); fogDirty = true; scheduleRender(); }
  syncAnimToPlayer(true);
}
