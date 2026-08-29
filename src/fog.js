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
const FOG_REVEAL_MS      = 2500; // player view: dramatic reveal
const FOG_SHROUD_MS      = 1200; // player view: ~half of reveal — curtain closes noticeably faster
const FOG_DM_REVEAL_MS   =  800; // DM view: very quick either direction
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

// ─── Fog Animation ────────────────────────────────────────────────────────────
let fogAnimEnabled = false;
let fogAnimSpeed   = 1.0;
// fogAnimRafId lives in state.js (fog RAF lifecycle handle)
let fogAnimOffsets = CLOUD_PASSES.map(() => ({ x: 0, y: 0 }));
let fogAnimAlphas  = CLOUD_PASSES.map(p => p.alpha);
let fogAnimTime    = 0;
let fogAnimLastTs  = 0;

// ─── Cloud frame cycling ─────────────────────────────────────────────────────
let cloudFrames    = [];   // array of offscreen canvases (domain-warped noise)
let cloudFramePos  = 0;    // float index — fractional part is crossfade blend
let cloudBlendCanvas = null, cloudBlendCtx = null;

// ─── Fog Transition (reveal & shroud) ────────────────────────────────────────
// Cross-fades fogEffectCanvas / fogBlurCanvas before and after any fog operation. 'lighter'
// blend, so prev*(1-t) + new*t is a true lerp with no alpha bleed in always-fogged regions.
let fogTransPrev        = null; // clone of fogEffectCanvas before op (DM)
let fogTransBlurPrev    = null; // clone of fogBlurCanvas before op (player)
let fogTransBlurNext    = null; // saved new-blur target for Player PixiJS per-frame blend
let fogTransBlendCanvas = null; // pre-allocated scratch for player blend pass
let fogTransT           = 0;   // 0→1 during transition
let fogTransStart       = 0;
// fogTransRafId lives in state.js (fog RAF lifecycle handle)
let fogTransIsShroud    = false;

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
  const fogScaledVerts = verts.map(v => ({ x: v.x / FOG_SCALE, y: v.y / FOG_SCALE }));

  if (poly.mode === 'shroud') {
    fogDataCtx.save();
    fogDataCtx.beginPath();
    buildRoundedPolyPath(fogDataCtx, fogScaledVerts, crFog, pvRFog);
    fogDataCtx.fillStyle = '#1a1a2e';
    fogDataCtx.fill();
    fogDataCtx.restore();
  } else {
    // Feathered reveal: draw polygon blurred on scratch, then destination-out onto fog.
    // 'half' rides this same mask and differs in ONE way — the erase runs to completion like a
    // reveal and half-density fog is painted back through the mask, so the state is ABSOLUTE.
    const isHalf = poly.mode === 'half';
    const halfAlpha = Math.max(0, Math.min(1, fogHalfAlpha));
    const bb = getPolyBBox(verts);
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
    buildRoundedPolyPath(sCtx, verts.map(v => ({ x: v.x / FOG_SCALE - bx, y: v.y / FOG_SCALE - by })), crFog, pvRFog);
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
    buildRoundedPolyPath(sCtx, verts.map(v => ({ x: v.x / FOG_SCALE - bx, y: v.y / FOG_SCALE - by })), crFog, pvRFog);
    sCtx.fill();
    sCtx.restore();

    // Cloud erosion leaves residue in the interior. A reveal clears it later with a clearRect;
    // half repaints through this mask, so residue left here reads as blotchy density. Flatten the
    // interior on the mask instead — the inset keeps the feathered edge band untouched.
    const insetVerts = insetPolygon(fogScaledVerts, feather);
    if (isHalf && insetVerts.length >= 3) {
      sCtx.save();
      sCtx.beginPath();
      buildRoundedPolyPath(sCtx, insetVerts.map(v => ({ x: v.x - bx, y: v.y - by })),
                           Math.max(0, crFog - feather), null);
      sCtx.fillStyle = 'white';
      sCtx.fill();
      sCtx.restore();
    }

    flattenSharedWalls(sCtx, poly, fogScaledVerts, feather, bx, by);

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
      buildRoundedPolyPath(fogDataCtx, insetVerts, Math.max(0, crFog - feather), null);
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
    const mode = doorResolvedMode(doorPoint(poly.vertices, d), polygons, tol);
    if (mode === 'reveal') open.push(d);
    else if (mode === 'half') dim.push(d);
  }
  if (!open.length && !dim.length) return;

  const fogVerts = poly.vertices.map(v => ({ x: v.x / FOG_SCALE, y: v.y / FOG_SCALE }));
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
function flattenSharedWalls(sCtx, poly, fogScaledVerts, feather, bx, by) {
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
  for (const [group, out] of [[open.filter(p => density(p) === mine), feather * 0.25],
                              [open.filter(p => density(p) !== mine), 0]]) {
    if (!group.length) continue;
    for (let e = 0; e < poly.vertices.length; e++) {
      const spans = sharedWallSpans(poly.vertices, e, group, tolMap, stepMap);
      if (!spans.length) continue;
      const f = doorEdgeFrame(fogScaledVerts, e);
      if (!f) continue;
      for (const sp of spans) {
        // Pulled in at both ends by the outward reach: a band that reached outward all the way to
        // a wall junction left a tab of cleared fog sticking out of the room block there.
        const s0 = sp.from / FOG_SCALE + out, s1 = sp.to / FOG_SCALE - out;
        if (!(s1 > s0)) continue;
        const ax = f.a.x + f.ux * s0, ay = f.a.y + f.uy * s0;
        const cx = f.a.x + f.ux * s1, cy = f.a.y + f.uy * s1;
        sCtx.moveTo(ax + f.n.x * out - bx,   ay + f.n.y * out - by);
        sCtx.lineTo(cx + f.n.x * out - bx,   cy + f.n.y * out - by);
        sCtx.lineTo(cx - f.n.x * into - bx,  cy - f.n.y * into - by);
        sCtx.lineTo(ax - f.n.x * into - bx,  ay - f.n.y * into - by);
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

function generateCloudFrames(size, numFrames) {
  function makeGrid(n) {
    const g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = Math.random();
    return g;
  }

  const layers = [
    { grid: makeGrid(7),  n: 7,  scale: 1.0  },
    { grid: makeGrid(13), n: 13, scale: 0.5  },
    { grid: makeGrid(23), n: 23, scale: 0.25 },
    { grid: makeGrid(37), n: 37, scale: 0.12 },
    { grid: makeGrid(53), n: 53, scale: 0.06 },
  ];

  function turbulence(px, py) { return fogTurbulence(layers, px, py); }

  function renderFrame(cvs, tNorm) {
    const ctx = cvs.getContext('2d');
    const img = ctx.createImageData(size, size);
    const d   = img.data;
    const tA  = tNorm * 2 * Math.PI;
    const tC  = Math.cos(tA) * cloudWarpRadius;
    const tS  = Math.sin(tA) * cloudWarpRadius;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = x / size, ny = y / size;
        const w1 = turbulence(nx + tC, ny + tS);
        const w2 = turbulence(nx + tS + 5.2, ny - tC + 1.3);
        const v  = turbulence(nx + w1 * cloudWarpStrength, ny + w2 * cloudWarpStrength);

        const i = (y * size + x) * 4;
        // Neutral grey: R=G=B so the cloud adds brightness texture without
        // baking in a hue. Fog color comes entirely from fogBaseColor/fogTintColor.
        const grey = (20 + 110 * v) | 0;
        d[i] = d[i + 1] = d[i + 2] = grey;
        d[i + 3] = (140 + 115 * v) | 0;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // Synchronous path: generate all frames at once (used at startup)
  if (!generateCloudFrames._initialized) {
    cloudFrames = [];
    for (let f = 0; f < numFrames; f++) {
      const cvs = document.createElement('canvas');
      cvs.width = size; cvs.height = size;
      renderFrame(cvs, f / numFrames);
      cloudFrames.push(cvs);
    }
    generateCloudFrames._initialized = true;
  } else {
    // Async path: regenerate frames one-at-a-time to avoid blocking UI
    const genId = ++generateCloudFrames._genId;
    const newFrames = [];
    let idx = 0;
    function genNext() {
      if (genId !== generateCloudFrames._genId) return; // superseded
      if (idx >= numFrames) {
        cloudFrames = newFrames;
        cloudCanvas = cloudFrames[0];
        cloudBlendCtx.drawImage(cloudFrames[0], 0, 0);
        cloudPattern = cloudFrames[0].getContext('2d').createPattern(cloudBlendCanvas, 'repeat');
        return;
      }
      const cvs = document.createElement('canvas');
      cvs.width = size; cvs.height = size;
      renderFrame(cvs, idx / numFrames);
      newFrames.push(cvs);
      idx++;
      setTimeout(genNext, 0);
    }
    genNext();
    return;
  }

  cloudCanvas = cloudFrames[0];

  cloudBlendCanvas = document.createElement('canvas');
  cloudBlendCanvas.width = size; cloudBlendCanvas.height = size;
  cloudBlendCtx = cloudBlendCanvas.getContext('2d');
  cloudBlendCtx.drawImage(cloudFrames[0], 0, 0);
  cloudPattern = cloudFrames[0].getContext('2d').createPattern(cloudBlendCanvas, 'repeat');
}
generateCloudFrames._initialized = false;
generateCloudFrames._genId = 0;

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
    // Player: renderFog draws its own clouds.
    fogDirty = true;
    scheduleRender();
  }
}

function renderFog(vp) {
  // PixiJS handles DM fog. The Player uses this Canvas-2D fog-on-top path — see the HYBRID note
  // in renderer.js pixiInitFog.
  if (!isPlayer) return;

  const { srcX, srcY, srcW, srcH, dstX, dstY, dstW, dstH, cw, ch } = vp;
  fogDisplayCtx.clearRect(0, 0, cw, ch);

  if (isPlayer) {
    // ⚠ ONE cloud pass over the whole display, then reveal holes punched inside the map rect.
    // Never split it into inside/outside passes: one pass is what makes the border seam
    // impossible, because the same pixels back both regions.

    // 1. Base fog colour.
    fogDisplayCtx.fillStyle = fogBaseColor;
    fogDisplayCtx.fillRect(0, 0, cw, ch);

    // 2. Cloud texture across the full display, in display space.
    if (cloudPattern && fogDataCanvas) {
      fogDisplayCtx.save();
      fogDisplayCtx.globalCompositeOperation = 'source-atop';
      // Every term derives from the map, so a scene swap changes all of them at once.
      // fogCloudAdj re-anchors the incoming scene onto the transform the outgoing one was last
      // drawn at, which is why the swap has no scale change left to travel across.
      let s   = zoom * FOG_SCALE * fogCloudAdj.k;
      let cx  = mapWidth  / 2 * zoom + panX + fogCloudAdj.dx;
      let cy  = mapHeight / 2 * zoom + panY + fogCloudAdj.dy;
      let hw  = fogCloudAdj.hw != null ? fogCloudAdj.hw : fogDataCanvas.width  / 2;
      let hh  = fogCloudAdj.hh != null ? fogCloudAdj.hh : fogDataCanvas.height / 2;
      // Pinned for the length of a switch, so the map can change size and camera under the
      // closed cover with the clouds not moving at all.
      if (fogCloudHold) {
        s = fogCloudHold.s; cx = fogCloudHold.cx; cy = fogCloudHold.cy;
        hw = fogCloudHold.hw; hh = fogCloudHold.hh;
      }
      // The transform AS DRAWN, banked so freeze/rebaseCloudTransform have something exact.
      fogCloudLast = { s: s, cx: cx, cy: cy, hw: hw, hh: hh };
      const bigR = Math.ceil(Math.max(cw, ch) / s) + hw * 2;
      for (let i = 0; i < CLOUD_PASSES.length; i++) {
        const p   = CLOUD_PASSES[i];
        const off = fogAnimOffsets[i];
        fogDisplayCtx.save();
        fogDisplayCtx.globalAlpha = fogAnimEnabled ? fogAnimAlphas[i] : p.alpha;
        fogDisplayCtx.translate(cx, cy);
        fogDisplayCtx.rotate(p.angle);
        fogDisplayCtx.scale(s * p.scale, s * p.scale);
        fogDisplayCtx.translate(-hw + off.x, -hh + off.y);
        fogDisplayCtx.fillStyle = cloudPattern;
        fogDisplayCtx.fillRect(-bigR, -bigR, 2 * bigR + hw * 2, 2 * bigR + hh * 2);
        fogDisplayCtx.restore();
      }
      fogDisplayCtx.restore();
    }

    // 3. Tint glow — source-atop so it only lands on fog pixels, not revealed areas.
    fogDisplayCtx.save();
    fogDisplayCtx.globalCompositeOperation = 'source-atop';
    fogDisplayCtx.globalAlpha = FOG_TINT_ALPHA;
    fogDisplayCtx.fillStyle = fogTintColor;
    fogDisplayCtx.fillRect(0, 0, cw, ch);
    fogDisplayCtx.restore();

    // 4. Punch reveal holes inside the map rect. fogBlurCanvas is opaque where fogged and clear
    // where revealed, so destination-in keeps fog in proportion. The clip leaves the outside fog
    // from steps 1-2 untouched. A live transition lerps prev↔new with 'lighter'.
    // ⚠ Scene-switch cover (fogCoverT): FULLY covered punches NOTHING. Skipping the step is what
    // makes the cover immune to the map changing size underneath it, which it does mid-switch.
    let maskCanvas = fogBlurCanvas;
    if (fogCoverT >= 1) {
      maskCanvas = null;
    } else if ((fogTransBlurPrev || fogCoverT > 0) && fogBlurCanvas) {
      if (!fogTransBlendCanvas ||
          fogTransBlendCanvas.width  !== fogBlurCanvas.width ||
          fogTransBlendCanvas.height !== fogBlurCanvas.height) {
        fogTransBlendCanvas = document.createElement('canvas');
        fogTransBlendCanvas.width  = fogBlurCanvas.width;
        fogTransBlendCanvas.height = fogBlurCanvas.height;
      }
      const bctx = fogTransBlendCanvas.getContext('2d');
      const bw = fogTransBlendCanvas.width, bh = fogTransBlendCanvas.height;
      bctx.clearRect(0, 0, bw, bh);
      if (fogTransBlurPrev) {
        bctx.globalAlpha = 1 - fogTransT;
        bctx.drawImage(fogTransBlurPrev, 0, 0);
        bctx.globalCompositeOperation = 'lighter';
        bctx.globalAlpha = fogTransT;
        bctx.drawImage(fogBlurCanvas, 0, 0);
      } else {
        bctx.globalAlpha = 1;
        bctx.drawImage(fogBlurCanvas, 0, 0);
        bctx.globalCompositeOperation = 'lighter';
      }
      if (fogCoverT > 0) {
        // 'lighter' adds alpha, so this raises every pixel toward fully fogged.
        bctx.globalAlpha = fogCoverT;
        bctx.fillStyle = '#000';
        bctx.fillRect(0, 0, bw, bh);
      }
      bctx.globalCompositeOperation = 'source-over';
      bctx.globalAlpha = 1;
      maskCanvas = fogTransBlendCanvas;
    }
    if (maskCanvas && srcW > 0 && srcH > 0) {
      fogDisplayCtx.save();
      const ix = Math.floor(dstX), iy = Math.floor(dstY);
      const iw = Math.ceil(dstX + dstW) - ix, ih = Math.ceil(dstY + dstH) - iy;
      fogDisplayCtx.beginPath();
      fogDisplayCtx.rect(ix, iy, iw, ih);
      fogDisplayCtx.clip();
      fogDisplayCtx.globalCompositeOperation = 'destination-in';
      fogDisplayCtx.drawImage(maskCanvas,
        srcX / FOG_SCALE, srcY / FOG_SCALE,
        srcW / FOG_SCALE, srcH / FOG_SCALE,
        ix, iy, iw, ih);
      fogDisplayCtx.restore();
    }

    return;
  }

  // DM view: semi-transparent overlay over the map rect only, so the DM sees the canvas
  // background beyond the map.
  if (!fogDataCanvas || srcW <= 0 || srcH <= 0) return;
  const sx = srcX / FOG_SCALE, sy = srcY / FOG_SCALE;
  const sw = srcW / FOG_SCALE, sh = srcH / FOG_SCALE;
  if (!isDrawing && fogTransPrev && fogEffectCanvas) {
    // Linear crossfade, never the noise dissolve: the DM bakes live cloud offsets into
    // fogEffectCanvas every frame, so the two canvases differ everywhere and it goes screen-wide.
    fogDisplayCtx.globalAlpha = 1 - fogTransT;
    fogDisplayCtx.drawImage(fogTransPrev, sx, sy, sw, sh, dstX, dstY, dstW, dstH);
    fogDisplayCtx.globalCompositeOperation = 'lighter';
    fogDisplayCtx.globalAlpha = fogTransT;
    fogDisplayCtx.drawImage(fogEffectCanvas, sx, sy, sw, sh, dstX, dstY, dstW, dstH);
    fogDisplayCtx.globalCompositeOperation = 'source-over';
    fogDisplayCtx.globalAlpha = 1;
  } else {
    const fogSrc = isDrawing ? fogDataCanvas : (fogEffectCanvas || fogDataCanvas);
    fogDisplayCtx.drawImage(fogSrc, sx, sy, sw, sh, dstX, dstY, dstW, dstH);
  }
}

// ─── Fog animation loop ───────────────────────────────────────────────────────

let fogAnimThrottleNext = 0;
const FOG_ANIM_VIDEO_INTERVAL = 66; // ~15fps fog updates when video is active

// Cloud crossfade rebuild rate. The blend advances a few thousandths of a frame per tick, so an
// every-tick rebuild repaints the same picture. Lower the number if the morph reads as steppy.
const FOG_CLOUD_BLEND_INTERVAL = 100; // ms → ~10Hz
// Stall clamp for the morph step. MUST stay above the longest ordinary gap between
// rebuilds, or it silently slows the morph instead of only catching stalls: with video
// active the 66ms frame throttle pushes the next eligible tick past 100ms, so a clamp at
// the interval itself would dock every single step.
const FOG_CLOUD_BLEND_MAX_STEP = 0.25; // seconds
let cloudBlendNext   = 0;
let cloudBlendLastTs = 0;

function fogAnimTick(ts) {
  if (!fogAnimEnabled) { fogAnimRafId = null; return; }
  try {
    const dt = Math.min((ts - fogAnimLastTs) / 1000, 0.1);
    fogAnimLastTs = ts;
    fogAnimTime += dt * fogAnimSpeed;

    // When video is active, throttle expensive fog work to ~15fps
    var skipExpensiveWork = videoEnabled && ts < fogAnimThrottleNext;

    const tile = cloudBlendCanvas ? cloudBlendCanvas.width : 512;
    for (let i = 0; i < CLOUD_PASSES.length; i++) {
      const p = CLOUD_PASSES[i];
      const nx = fogAnimOffsets[i].x + p.driftX * driftScale * dt * fogAnimSpeed;
      const ny = fogAnimOffsets[i].y + p.driftY * driftScale * dt * fogAnimSpeed;
      fogAnimOffsets[i].x = wrapOffset(nx, tile);
      fogAnimOffsets[i].y = wrapOffset(ny, tile);

      fogAnimAlphas[i] = pulseAlpha(p.alpha, alphaPulseAmp, fogAnimTime, p.alphaFreq, p.alphaPhase);
    }

    if (!skipExpensiveWork) {
      if (videoEnabled) fogAnimThrottleNext = ts + FOG_ANIM_VIDEO_INTERVAL;

      // ⚠ One gate and one clock for both paths. The video throttle decides WHICH ticks get
      // here; how far the morph advances comes from real elapsed time below. Feed this the
      // per-tick dt instead and the morph crawls whenever the throttle skips ticks.
      const rebuildBlend = shouldRebuildCloudBlend(ts, cloudBlendNext);
      // Set only where the blend canvas is repainted, so the DM's GPU upload can be skipped.
      let blendChanged = false;

      if (rebuildBlend && cloudFrames.length > 1 && cloudBlendCtx) {
        // Real elapsed time, so a throttled rebuild morphs at the every-tick rate.
        const morphSec = cloudBlendElapsedSec(ts, cloudBlendLastTs, FOG_CLOUD_BLEND_MAX_STEP);
        cloudBlendLastTs = ts;
        cloudBlendNext   = ts + FOG_CLOUD_BLEND_INTERVAL;
        cloudFramePos += morphSec * fogAnimSpeed * cloudFrameSpeed;
        const { idxA, idxB, blend } = cloudBlendIndices(cloudFramePos, cloudFrames.length);

        if (cloudFrames[idxA] && cloudFrames[idxB]) {
          blendChanged = true;
          const sz = cloudBlendCanvas.width;
          cloudBlendCtx.globalAlpha = 1;
          cloudBlendCtx.globalCompositeOperation = 'source-over';
          cloudBlendCtx.clearRect(0, 0, sz, sz);
          cloudBlendCtx.globalAlpha = 1 - blend;
          cloudBlendCtx.drawImage(cloudFrames[idxA], 0, 0);
          cloudBlendCtx.globalCompositeOperation = 'lighter';
          cloudBlendCtx.globalAlpha = blend;
          cloudBlendCtx.drawImage(cloudFrames[idxB], 0, 0);
          cloudBlendCtx.globalCompositeOperation = 'source-over';
          cloudBlendCtx.globalAlpha = 1;

          // cloudPattern is what the Player's Canvas-2D renderFog draws with.
          if (isPlayer) {
            cloudPattern = cloudFrames[0].getContext('2d').createPattern(cloudBlendCanvas, 'repeat');
          }
        }
      }

      if (!isDrawing) {
        if (!isPlayer) {
          // DM GPU path: drift every tick, but re-upload the cloud texture only on the ticks
          // where the blend canvas was repainted.
          pixiUpdateFogAnim(fogAnimOffsets, fogAnimAlphas, blendChanged);
        } else {
          // Player draws clouds in renderFog.
          fogDirty = true;
          scheduleRender();
        }
      }
    }
  } catch (err) {
    console.error('[fogAnimTick]', err);
  }

  fogAnimRafId = requestAnimationFrame(fogAnimTick);
}

function startFogAnim() {
  if (fogAnimRafId) return;
  fogAnimLastTs = performance.now();
  fogAnimRafId = requestAnimationFrame(fogAnimTick);
}

function stopFogAnim() {
  if (fogAnimRafId) { cancelAnimationFrame(fogAnimRafId); fogAnimRafId = null; }
  for (let i = 0; i < CLOUD_PASSES.length; i++) fogAnimAlphas[i] = CLOUD_PASSES[i].alpha;
  if (!isPlayer) {
    // DM GPU path: freeze sprite alphas; tilePositions stay as they are.
    pixiUpdateFogAnim(null, fogAnimAlphas);
    return;
  }
  fogDirty = true;
  scheduleRender();
}

// ─── Fog transition ───────────────────────────────────────────────────────────
// Clone fogEffectCanvas / fogBlurCanvas before the rebuild, then crossfade to the new state.
// Reveal and shroud both work, because the interpolation is on fog-density canvases.

function startFogTransition(isShroud = false) {
  fogTransIsShroud = isShroud;
  fogTransBlurNext = null; // reset so fogTransTick captures fresh fogBlurCanvas on next tick

  // A transition already running is LEFT going: the caller's rebuildFogEffect() updates
  // fogBlurCanvas and the live RAF picks that up as its new target. Snapshotting here instead
  // makes the first reveal jump to completion.
  if (fogTransRafId !== null) return;

  if (!isPlayer) {
    // DM GPU path: snapshot the blur canvas for the sprite crossfade.
    fogTransPrev = fogBlurCanvas ? cloneCanvas(fogBlurCanvas) : null;
    pixiSetFogTransition(fogTransPrev, 0);
  } else if (fogBlurCanvas) {
    // Player (hybrid): fog is Canvas-2D on top, and the transition morphs the reveal-hole shape.
    // No fogEffectCanvas snapshot — the navy and cloud are redrawn every frame. Player-only:
    // renderFog returns early for the DM, so on that path these would be dead allocations.
    fogTransBlurPrev = cloneCanvas(fogBlurCanvas);
    if (!fogTransBlendCanvas ||
        fogTransBlendCanvas.width  !== fogBlurCanvas.width ||
        fogTransBlendCanvas.height !== fogBlurCanvas.height) {
      fogTransBlendCanvas = document.createElement('canvas');
      fogTransBlendCanvas.width  = fogBlurCanvas.width;
      fogTransBlendCanvas.height = fogBlurCanvas.height;
    }
  }
  fogTransT     = 0;
  fogTransStart = performance.now();
  if (!fogTransRafId) fogTransRafId = requestAnimationFrame(fogTransTick);
}

function fogTransTick(ts) {
  const duration = isPlayer
    ? (fogTransIsShroud ? FOG_SHROUD_MS : FOG_REVEAL_MS)
    : FOG_DM_REVEAL_MS;
  const t = Math.min((ts - fogTransStart) / duration, 1);
  fogTransT = t * t * (3 - 2 * t); // smoothstep 0→1

  if (!isPlayer) {
    pixiSetFogTransition(null, fogTransT);
  } else {
    // Player fog-on-top: renderFog does the blend.
    fogDirty = true;
    scheduleRender();
  }

  if (t < 1) {
    fogTransRafId = requestAnimationFrame(fogTransTick);
  } else {
    fogTransRafId    = null;
    fogTransPrev     = null;
    fogTransBlurPrev = null;
    fogTransT        = 0;
    if (!isPlayer) {
      pixiEndFogTransition();
    } else {
      fogDirty = true;
      scheduleRender();
    }
  }
}

// Abort an in-flight transition and release its snapshot canvases. Mirrors
// stopFogAnim. Called on scene switch / window close so a crossfade from the
// outgoing scene can't keep ticking against orphaned snapshots.
function stopFogTransition() {
  if (fogTransRafId) { cancelAnimationFrame(fogTransRafId); fogTransRafId = null; }
  fogTransPrev     = null;
  fogTransBlurPrev = null;
  fogTransBlurNext = null;
  fogTransT        = 0;
  if (!isPlayer) pixiEndFogTransition();
}

// ─── Scene-switch cover ───────────────────────────────────────────────────────
// A scene switch is covered by THE FOG ITSELF, never by a DOM layer: the fog closes over the old
// map, the new one is swapped in behind it, and the ordinary reveal clears it. Two calls, because
// the fog must sit at full shroud for however long the map takes to decode.
// ⚠ COVER EARLY, at the transition's 'out' phase, not when the new fog finishes loading. Waiting
// puts a flat navy blindfold on screen for the whole decode.
// Player only; the DM's fog is a PixiJS sprite crossfade and is not covered.
//
// Both work by feeding the ordinary transition a "previous" mask that is opaque everywhere.
// renderFog reads it for ALPHA ONLY, so lerping it into the scene's real fogBlurCanvas IS the
// reveal.

// Close + name hold + clear is the whole switch. Slow on purpose: this is the one beat the
// players watch instead of a map.
const FOG_SCENE_COVER_MS   = 2250; // fog closes over the outgoing map
const FOG_SCENE_UNCOVER_MS = 3350; // fog clears off the incoming one

// THE CLOUD TEXTURE IS ANCHORED TO THE MAP — scale and origin come from mapWidth, zoom and pan.
// A scene swap changes all of those in one frame, and under an opaque cover that jump is the only
// thing on screen.
// ⚠ THE JUMP IS REMOVED, NEVER ANIMATED ACROSS. Two maps fitted to one screen can sit several-fold
// apart in zoom, so easing it reads as the whole fog zooming. The texture is PINNED for the length
// of the switch and the incoming scene re-anchored onto that transform.
// Cloud size therefore carries forward rather than tracking each map's fit-zoom. Pan and zoom
// inside a scene still scale the clouds, because the adjustment is a multiplier.
function freezeCloudTransform() {
  if (!isPlayer || !fogCloudLast) return;
  fogCloudHold = fogCloudLast;
}

// Adopt the pinned transform as the new scene's own, so releasing the pin changes nothing.
function rebaseCloudTransform() {
  if (!fogCloudHold) return;
  const held = fogCloudHold;
  fogCloudHold = null;
  const rawS = zoom * FOG_SCALE;
  if (!(rawS > 0)) return;   // no camera yet — leave the previous anchor in place
  fogCloudAdj = {
    k:  held.s / rawS,
    dx: held.cx - (mapWidth  / 2 * zoom + panX),
    dy: held.cy - (mapHeight / 2 * zoom + panY),
    hw: held.hw,
    hh: held.hh,
  };
  fogDirty = true;
  scheduleRender();
}

function animateFogCover(to, durationMs, onDone) {
  fogCoverFrom  = fogCoverT;
  fogCoverTo    = to;
  fogCoverDur   = durationMs;
  fogCoverStart = performance.now();
  fogCoverDone  = onDone || null;
  if (!fogCoverRafId) fogCoverRafId = requestAnimationFrame(fogCoverTick);
}

function fogCoverTick(ts) {
  const raw = fogCoverDur > 0 ? Math.min((ts - fogCoverStart) / fogCoverDur, 1) : 1;
  const e   = raw * raw * (3 - 2 * raw);   // smoothstep, same easing as fogTransTick
  fogCoverT = fogCoverFrom + (fogCoverTo - fogCoverFrom) * e;
  fogDirty  = true;
  scheduleRender();
  if (raw < 1) { fogCoverRafId = requestAnimationFrame(fogCoverTick); return; }
  fogCoverRafId = null;
  fogCoverT     = fogCoverTo;
  const cb = fogCoverDone; fogCoverDone = null;
  if (cb) cb();
}

// Close the fog over the outgoing map. Returns false when there is nothing to draw fog WITH (the
// session's first map), and only then may the caller fall back to the flat blind. onCovered fires
// when the map is hidden, which is when the scene name may appear.
function closeFogOverMap(onCovered) {
  if (!isPlayer || !fogDataCanvas || !cloudPattern) return false;
  // The cover has to keep drifting to read as fog rather than a navy fill.
  startFogAnim();
  animateFogCover(1, FOG_SCENE_COVER_MS, onCovered);
  return true;
}

// Skip straight to fully covered — the safety net for a payload arriving while the fog is still
// closing. Finishing early is a small ugliness; a swap seen through a half-closed cover is not.
function snapFogCover(v) {
  if (fogCoverRafId) { cancelAnimationFrame(fogCoverRafId); fogCoverRafId = null; }
  fogCoverDone = null;
  fogCoverT = v;
  fogDirty = true;
  scheduleRender();
}

// Clear the fog off the new map. Mirrors the close, so the switch is one movement.
function openFogFromCover() {
  if (!isPlayer || fogCoverT <= 0) return;
  // Every path that ends a switch reaches here, so the pin is never left held.
  rebaseCloudTransform();
  animateFogCover(0, FOG_SCENE_UNCOVER_MS, null);
}

// ─── Fog colour across a switch ───────────────────────────────────────────────
// Fog colour is per scene, and the incoming scene lands while the cover is fully closed, which is
// exactly when the colour IS the entire picture.
// ⚠ EASED OVER THE CLOSE, NOT THE REVEAL. The fog reaches the new colour while thickening, so the
// hold and the reveal are already in it. A late destination eases over whatever is left, floored
// so it is never a snap.
let fogColorFromHex = null, fogColorToHex = null;
let fogColorStart = 0, fogColorDur = 0, fogColorRafId = null;
const FOG_COLOR_EASE_MIN_MS = 700;

// How much of the close is still to run. 0 once the cover has landed.
function fogCloseRemainingMs() {
  if (fogCoverRafId === null || fogCoverTo < 1) return 0;
  return Math.max(0, fogCoverStart + fogCoverDur - performance.now());
}

function startFogColorEase(toHex) {
  if (!isPlayer || !toHex || toHex === fogPickedHex) return;
  fogColorFromHex = fogPickedHex;
  fogColorToHex   = toHex;
  fogColorStart   = performance.now();
  fogColorDur     = Math.max(FOG_COLOR_EASE_MIN_MS, fogCloseRemainingMs());
  if (!fogColorRafId) fogColorRafId = requestAnimationFrame(fogColorTick);
}

function fogColorTick(ts) {
  const raw = Math.min((ts - fogColorStart) / fogColorDur, 1);
  const e   = raw * raw * (3 - 2 * raw);   // smoothstep, same easing as the cover
  applyFogColor(lerpHex(fogColorFromHex, fogColorToHex, e));
  if (raw < 1) { fogColorRafId = requestAnimationFrame(fogColorTick); return; }
  fogColorRafId = null;
  endFogColorEase();
}

// Land on the destination exactly, and give up ownership of the colour.
function endFogColorEase() {
  if (fogColorRafId) { cancelAnimationFrame(fogColorRafId); fogColorRafId = null; }
  if (fogColorToHex) applyFogColor(fogColorToHex);
  fogColorFromHex = fogColorToHex = null;
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

// ─── Live fog color ───────────────────────────────────────────────────────────

// Derives base+tint from the raw picked colour and repaints both render paths.
function applyFogColor(pickedHex) {
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
  const colorEl  = document.getElementById('fog-color');
  const sliderEl = document.getElementById('fog-tint-alpha');
  const numEl    = document.getElementById('fog-tint-alpha-num');
  if (colorEl)  colorEl.value  = hex;
  if (sliderEl) sliderEl.value = Math.round(alpha * 100);
  if (numEl)    numEl.value    = Math.round(alpha * 100);
  // ⚠ Never call syncFogColorToPlayer here. The colour rides the sendToPlayer fog-update message;
  // sending it early paints the new colour over the old scene's fog, which flickers.

  const prevWarpStr = cloudWarpStrength;
  const prevWarpRad = cloudWarpRadius;

  fogAnimEnabled    = an.enabled;
  fogAnimSpeed      = an.speed;
  driftScale        = an.drift;
  cloudFrameSpeed   = an.morph;
  cloudWarpStrength = an.warpStr;
  cloudWarpRadius   = an.warpRad;
  alphaPulseAmp     = an.pulse;

  updateAnimSliders();

  if (cloudWarpStrength !== prevWarpStr || cloudWarpRadius !== prevWarpRad) {
    regenCloudFrames();
  } else {
    syncAnimToPlayer(false);
  }

  const btnAnim = document.getElementById('btn-anim');
  if (fogAnimEnabled) {
    startFogAnim();
    if (btnAnim) btnAnim.classList.add('active');
  } else {
    stopFogAnim();
    if (btnAnim) btnAnim.classList.remove('active');
  }

  // Reflect the restored fog settings into the redesigned control panel.
  if (typeof refreshFogControlUI === 'function') refreshFogControlUI();
}

// ─── Anim-panel DOM helpers ───────────────────────────────────────────────────

// Midpoint reference values for the log-scale sliders (slider=500 ↔ these values).
const ANIM_DEFAULTS = {
  drift: 0.5, morphSpeed: 0.20, warpStr: 0.10, warpRad: 0.06, pulse: 0.15
};

function updateAnimSliders() {
  document.getElementById('anim-speed').value = Math.round(fogAnimSpeed * 100);
  document.getElementById('anim-speed-num').value = Math.round(fogAnimSpeed * 100);

  const logSliders = [
    ['anim-drift',       'anim-drift-num',    driftScale,        ANIM_DEFAULTS.drift],
    ['anim-morph-speed', 'anim-morph-num',    cloudFrameSpeed,   ANIM_DEFAULTS.morphSpeed],
    ['anim-warp-str',    'anim-warp-num',     cloudWarpStrength, ANIM_DEFAULTS.warpStr],
    ['anim-warp-rad',    'anim-warp-rad-num', cloudWarpRadius,   ANIM_DEFAULTS.warpRad],
    ['anim-alpha-amp',   'anim-alpha-amp-num', alphaPulseAmp,    ANIM_DEFAULTS.pulse],
  ];
  for (const [sliderId, numId, val, base] of logSliders) {
    document.getElementById(sliderId).value = Math.round(animSliderFromVal(val, base));
    document.getElementById(numId).value = val.toFixed(2);
  }
}

// Regenerates cloud frames (call after warp params change) and syncs Player.
function regenCloudFrames() {
  generateCloudFrames(512, CLOUD_FRAME_COUNT);
  cloudFramePos = 0;
  if (fogEffectCanvas) { recompositeCloudEffect(fogAnimEnabled ? fogAnimOffsets : null); fogDirty = true; scheduleRender(); }
  syncAnimToPlayer(true);
}

// ─── Fog controls UI ─────────────────────────────────────────────────────────

function initFogControls() {
  const featherSlider = document.getElementById('fog-feather');
  const featherNum    = document.getElementById('fog-feather-num');
  featherSlider.oninput = function() {
    fogFeatherRadius = +this.value;
    featherNum.value = this.value;
    rebuildFogFromPolygons();
    rebuildFogEffect();
    fogDirty = true;
    scheduleRender();
    scheduleAutoSync();
  };
  featherNum.onchange = function() {
    const v = Math.max(0, Math.min(24, Math.round(+this.value)));
    this.value = v;
    featherSlider.value = v;
    fogFeatherRadius = v;
    rebuildFogFromPolygons();
    rebuildFogEffect();
    fogDirty = true;
    scheduleRender();
    scheduleAutoSync();
  };

  // Half-shroud density. Persisted, unlike Feather above, because it is dialled in across
  // sittings. Global preference, so localStorage — never a scene or a backup.
  const halfSlider = document.getElementById('fog-half-alpha');
  const halfNum    = document.getElementById('fog-half-alpha-num');
  const applyHalf = pct => {
    fogHalfAlpha = pct / 100;
    try { localStorage.setItem(FOG_HALF_ALPHA_KEY, String(pct)); } catch (_) {}
    // Rebuild every time, including mid-drag: watching half rooms change IS the point.
    rebuildFogFromPolygons();
    rebuildFogEffect();
    fogDirty = true;
    scheduleRender();
    scheduleAutoSync();
  };
  halfSlider.oninput = function() { halfNum.value = this.value; applyHalf(+this.value); };
  halfNum.onchange = function() {
    const v = Math.max(0, Math.min(100, Math.round(+this.value) || 0));
    this.value = v;
    halfSlider.value = v;
    applyHalf(v);
  };
  // A garbage entry parses to NaN and is skipped, leaving the markup's default.
  try {
    const stored = parseInt(localStorage.getItem(FOG_HALF_ALPHA_KEY), 10);
    if (!isNaN(stored)) {
      const v = Math.max(0, Math.min(100, stored));
      halfSlider.value = v;
      halfNum.value = v;
      fogHalfAlpha = v / 100;
    }
  } catch (_) {}

  // Door size, in percent of a grid cell. A preference the DM sets once, like Half above, so it
  // lives in localStorage and never in a scene or a backup.
  const applyDoorSize = () => {
    try { localStorage.setItem(DOOR_SIZE_KEY, doorWidthPct + ',' + doorDepthPct); } catch (_) {}
    rebuildFogFromPolygons();
    rebuildFogEffect();
    fogDirty = true;
    scheduleRender();
    scheduleAutoSync();
  };
  const doorFields = [['door-width-num', v => { doorWidthPct = v; }],
                      ['door-depth-num', v => { doorDepthPct = v; }]];
  doorFields.forEach(([id, set]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.onchange = function() {
      const v = Math.max(0, Math.min(300, Math.round(+this.value) || 0));
      this.value = v;
      set(v);
      applyDoorSize();
    };
  });
  // A garbage entry parses to NaN and is skipped, leaving the markup's defaults.
  try {
    const parts = String(localStorage.getItem(DOOR_SIZE_KEY) || '').split(',');
    [doorFields[0], doorFields[1]].forEach(([id, set], i) => {
      const v = parseInt(parts[i], 10);
      if (isNaN(v)) return;
      const clamped = Math.max(0, Math.min(300, v));
      set(clamped);
      const el = document.getElementById(id);
      if (el) el.value = clamped;
    });
  } catch (_) {}

  const fogColorPicker   = document.getElementById('fog-color');
  const tintAlphaSlider  = document.getElementById('fog-tint-alpha');
  const tintAlphaNum     = document.getElementById('fog-tint-alpha-num');

  fogColorPicker.oninput = function() {
    applyFogColor(this.value);
    syncFogColorToPlayer(this.value);
  };
  tintAlphaSlider.oninput = function() {
    const v = parseInt(this.value);
    tintAlphaNum.value = v;
    applyFogTintAlpha(v / 100);
    syncFogColorToPlayer(fogColorPicker.value);
  };
  tintAlphaNum.oninput = function() {
    const v = Math.max(0, Math.min(100, parseInt(this.value) || 0));
    tintAlphaSlider.value = v;
    applyFogTintAlpha(v / 100);
    syncFogColorToPlayer(fogColorPicker.value);
  };
}
