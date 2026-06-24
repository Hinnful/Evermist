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
// Cross-fades between fogEffectCanvas / fogBlurCanvas before and after any fog
// operation. Uses 'lighter' blend so prev*(1-t) + new*t gives proper linear lerp
// without alpha bleed-through in always-fogged regions.
let fogTransPrev        = null; // clone of fogEffectCanvas before op (DM)
let fogTransBlurPrev    = null; // clone of fogBlurCanvas before op (player)
let fogTransBlurNext    = null; // saved new-blur target for Player PixiJS per-frame blend
let fogTransBlendCanvas = null; // pre-allocated scratch for player blend pass
let fogTransT           = 0;   // 0→1 during transition
let fogTransStart       = 0;
// fogTransRafId lives in state.js (fog RAF lifecycle handle)
let fogTransIsShroud    = false;

// ─── Rounded polygon path ─────────────────────────────────────────────────────
// Used by both the fog pipeline (applyPolygonToFog) and the cursor drawing
// (drawPolyOutline in tools.js). Declared here because fog.js loads first.
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

// ─── DPI-adaptive radius helpers ──────────────────────────────────────────────
// Scale blur/feather radii proportionally to fog canvas size so they cover the
// same fraction of the map regardless of image resolution.
function getFogSizeScale() {
  if (!fogDataCanvas) return 1;
  const linear = Math.min(1, Math.max(fogDataCanvas.width, fogDataCanvas.height) / FOG_SIZE_REF);
  return linear * linear;
}
let fogFeatherRadius = FOG_FEATHER_RADIUS; // overridable at runtime via UI slider
function getScaledBlurRadius()    { return Math.max(1, FOG_BLUR_RADIUS  * getFogSizeScale()); }
function getScaledFeatherRadius() { return Math.max(1, fogFeatherRadius * getFogSizeScale()); }

// ─── Fog data operations ──────────────────────────────────────────────────────
// All coordinates are in MAP space; fogDataCanvas is at 1/FOG_SCALE.

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
    // Feathered reveal: draw polygon blurred on scratch, then destination-out onto fog
    const bb = getPolyBBox(verts);
    const feather = getScaledFeatherRadius();
    const pad = Math.ceil(feather) + 2;
    const bx = Math.floor(bb.minX / FOG_SCALE) - pad;
    const by = Math.floor(bb.minY / FOG_SCALE) - pad;
    const bw = Math.ceil((bb.maxX - bb.minX) / FOG_SCALE) + pad * 2;
    const bh = Math.ceil((bb.maxY - bb.minY) / FOG_SCALE) + pad * 2;
    const scratch = document.createElement('canvas');
    scratch.width  = Math.max(1, bw);
    scratch.height = Math.max(1, bh);
    const sCtx = scratch.getContext('2d');
    sCtx.filter = `blur(${feather}px)`;
    sCtx.fillStyle = 'white';
    sCtx.beginPath();
    buildRoundedPolyPath(sCtx, verts.map(v => ({ x: v.x / FOG_SCALE - bx, y: v.y / FOG_SCALE - by })), crFog, pvRFog);
    sCtx.fill();
    sCtx.filter = 'none';

    // Erode edges with cloud noise for organic, non-geometric reveal boundary.
    // destination-out at low alpha removes a fraction of the edge pixels based on
    // cloud density — interior stays well-revealed, edge pixels become ragged wisps.
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

    // Clip the blurred result back to the polygon shape so the soft edge
    // fades inward only — prevents the blur from clearing fog outside the polygon.
    sCtx.save();
    sCtx.globalCompositeOperation = 'destination-in';
    sCtx.fillStyle = 'white';
    sCtx.beginPath();
    buildRoundedPolyPath(sCtx, verts.map(v => ({ x: v.x / FOG_SCALE - bx, y: v.y / FOG_SCALE - by })), crFog, pvRFog);
    sCtx.fill();
    sCtx.restore();

    fogDataCtx.save();
    fogDataCtx.globalCompositeOperation = 'destination-out';
    fogDataCtx.drawImage(scratch, bx, by);
    fogDataCtx.restore();
    // Cloud erosion affects edges but leaves ~17% residue at the interior.
    // Hard-clear the polygon interior so the revealed area is fully transparent.
    fogDataCtx.save();
    fogDataCtx.beginPath();
    buildRoundedPolyPath(fogDataCtx, fogScaledVerts, crFog, pvRFog);
    fogDataCtx.clip();
    fogDataCtx.clearRect(bb.minX / FOG_SCALE - 1, bb.minY / FOG_SCALE - 1,
                         (bb.maxX - bb.minX) / FOG_SCALE + 2, (bb.maxY - bb.minY) / FOG_SCALE + 2);
    fogDataCtx.restore();
  }
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
}

// ─── Fog effect pipeline ──────────────────────────────────────────────────────

function generateCloudFrames(size, numFrames) {
  function makeGrid(n) {
    const g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = Math.random();
    return g;
  }

  function sampleWrapped(grid, n, fx, fy) {
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

  const layers = [
    { grid: makeGrid(7),  n: 7,  scale: 1.0  },
    { grid: makeGrid(13), n: 13, scale: 0.5  },
    { grid: makeGrid(23), n: 23, scale: 0.25 },
    { grid: makeGrid(37), n: 37, scale: 0.12 },
    { grid: makeGrid(53), n: 53, scale: 0.06 },
  ];

  function turbulence(px, py) {
    let val = 0, total = 0;
    for (const L of layers) {
      val += sampleWrapped(L.grid, L.n, px * L.n, py * L.n) * L.scale;
      total += L.scale;
    }
    return val / total;
  }

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
        d[i]     = (8 + 80 * v) | 0;
        d[i + 1] = (8 + 80 * v) | 0;
        d[i + 2] = (20 + 110 * v) | 0;
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

  // Blur on a fog-padded canvas so the blur at the map edge samples solid fog
  // instead of transparency. pad = 3× blur radius to cover the full Gaussian tail (3σ).
  const blur = getScaledBlurRadius();
  const pad  = blur * 3;
  const pw = w + pad * 2, ph = h + pad * 2;
  const padded = document.createElement('canvas');
  padded.width = pw; padded.height = ph;
  const pCtx = padded.getContext('2d');
  pCtx.drawImage(fogDataCanvas, pad, pad);                                     // fog data (center)

  // Always-shrouded edge margin: stamp an opaque navy frame over the whole pad border PLUS
  // the outer FOG_EDGE_MARGIN px of the fog-data center. The blur then feathers the frame's
  // inner edge inward, so a reveal that reaches the map boundary fades into this margin
  // instead of hard-stopping against the solid outside-map fog (the sharp horizontal seam).
  // This frame also serves as the blur's edge padding (fully overwrites the old clamp-to-edge
  // strips). Applied to the display blur mask only — fogDataCanvas, undo, and saved scenes
  // are untouched.
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

// Composites cloud texture over the cached blur result.
// offsets: array of {x, y} per pass for animation drift; null = no drift.
// blurSrc: optional blur canvas to composite over (default: fogBlurCanvas).
// Pass fogTransBlurPrev during SHROUD transitions to animate OLD fog in the effect sprite.
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

  // Subtle purple-blue luminosity at fog edge. source-atop draws proportional to
  // existing alpha: fully-fogged areas get a slight tint, edge pixels get a
  // visible glow that makes the boundary look luminous rather than geometric.
  fogEffectCtx.save();
  fogEffectCtx.globalCompositeOperation = 'source-atop';
  fogEffectCtx.globalAlpha = 0.18;
  fogEffectCtx.fillStyle = '#7050e0';
  fogEffectCtx.fillRect(0, 0, w, h);
  fogEffectCtx.restore();
}

function rebuildFogEffect() {
  rebuildFogBlur();
  if (usePixi && !isPlayer) {
    // DM GPU path: cloud TilingSprites handle cloud display — just upload the new blur canvas
    pixiUpdateFogBlurTexture();
  } else {
    // Canvas-2D path. The Player's renderFog draws clouds itself (from cloudPattern +
    // fogAnimOffsets) and never reads fogEffectCanvas, so skip the costly recomposite for
    // it. A non-PixiJS DM (fallback) does read fogEffectCanvas, so build it there.
    if (!isPlayer) recompositeCloudEffect(fogAnimEnabled ? fogAnimOffsets : null);
    fogDirty = true;
    scheduleRender();
  }
}

function renderFog(vp) {
  // PixiJS handles fog display for the DM only. The Player uses this Canvas-2D path
  // (fog-on-top with holes) — see the HYBRID note in renderer.js pixiInitFog.
  if (usePixi && !isPlayer) return;

  const { srcX, srcY, srcW, srcH, dstX, dstY, dstW, dstH, cw, ch } = vp;
  fogDisplayCtx.clearRect(0, 0, cw, ch);

  if (isPlayer) {
    // Unified single-pass player fog: clouds drawn once over the full display,
    // then reveal holes punched inside the map rect via destination-in masking.
    // Because there is only one cloud pass (no inside/outside split) the seam
    // at the map border is impossible — the same pixels back both regions.

    // 1. Fill entire display with base fog colour.
    fogDisplayCtx.fillStyle = '#1a1a2e';
    fogDisplayCtx.fillRect(0, 0, cw, ch);

    // 2. Overlay cloud texture across the full display in display-space coords.
    if (cloudPattern && fogDataCanvas) {
      fogDisplayCtx.save();
      fogDisplayCtx.globalCompositeOperation = 'source-atop';
      const s   = zoom * FOG_SCALE;
      const cx  = mapWidth  / 2 * zoom + panX;
      const cy  = mapHeight / 2 * zoom + panY;
      const hw  = fogDataCanvas.width  / 2;
      const hh  = fogDataCanvas.height / 2;
      const bigR = Math.ceil(Math.max(cw, ch) / s) + fogDataCanvas.width;
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
        fogDisplayCtx.fillRect(-bigR, -bigR, 2 * bigR + fogDataCanvas.width, 2 * bigR + fogDataCanvas.height);
        fogDisplayCtx.restore();
      }
      fogDisplayCtx.restore();
    }

    // 3. Punch reveal holes inside the map rect.
    // fogBlurCanvas: alpha=1 where fogged, alpha≈0 where revealed (blur gives
    // smooth feathered edges). destination-in keeps existing pixels proportional
    // to source alpha — retains fog over fogged areas, clears over revealed.
    // The clip restricts the operation to the map rect so the outside fog
    // (drawn in steps 1-2) is untouched.
    // Build blended mask if a fog transition is active (lerps prev↔new fogBlurCanvas).
    // 'lighter' (additive) blend gives exact prev*(1-t) + new*t with no alpha bleed.
    let maskCanvas = fogBlurCanvas;
    if (fogTransBlurPrev && fogTransBlendCanvas && fogBlurCanvas) {
      const bctx = fogTransBlendCanvas.getContext('2d');
      bctx.clearRect(0, 0, fogTransBlendCanvas.width, fogTransBlendCanvas.height);
      bctx.globalAlpha = 1 - fogTransT;
      bctx.drawImage(fogTransBlurPrev, 0, 0);
      bctx.globalCompositeOperation = 'lighter';
      bctx.globalAlpha = fogTransT;
      bctx.drawImage(fogBlurCanvas, 0, 0);
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

  // DM view: semi-transparent fog overlay (CSS opacity 0.55) over map rect only.
  // No outside-map fog — DM sees the canvas background beyond the map.
  if (!fogDataCanvas || srcW <= 0 || srcH <= 0) return;
  const sx = srcX / FOG_SCALE, sy = srcY / FOG_SCALE;
  const sw = srcW / FOG_SCALE, sh = srcH / FOG_SCALE;
  if (!isDrawing && fogTransPrev && fogEffectCanvas) {
    // Simple linear crossfade for DM. The noise dissolve can't be used here because
    // the DM bakes live cloud offsets into fogEffectCanvas every anim frame, making
    // fogTransPrev and fogEffectCanvas differ everywhere — causing a screen-wide effect.
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

function fogAnimTick(ts) {
  if (!fogAnimEnabled) { fogAnimRafId = null; return; }
  try {
    const dt = Math.min((ts - fogAnimLastTs) / 1000, 0.1);
    fogAnimLastTs = ts;
    fogAnimTime += dt * fogAnimSpeed;

    // When video is active, throttle expensive fog work to ~15fps
    var skipExpensiveWork = videoEnabled && ts < fogAnimThrottleNext;

    for (let i = 0; i < CLOUD_PASSES.length; i++) {
      const p = CLOUD_PASSES[i];
      const nx = fogAnimOffsets[i].x + p.driftX * driftScale * dt * fogAnimSpeed;
      const ny = fogAnimOffsets[i].y + p.driftY * driftScale * dt * fogAnimSpeed;
      fogAnimOffsets[i].x = nx;
      fogAnimOffsets[i].y = ny;

      fogAnimAlphas[i] = p.alpha * (1 + alphaPulseAmp * Math.sin(fogAnimTime * p.alphaFreq + p.alphaPhase));
    }

    if (!skipExpensiveWork) {
      if (videoEnabled) fogAnimThrottleNext = ts + FOG_ANIM_VIDEO_INTERVAL;

      if (cloudFrames.length > 1 && cloudBlendCtx) {
        cloudFramePos += dt * fogAnimSpeed * cloudFrameSpeed;
        const total = cloudFrames.length;
        const wrapped = cloudFramePos % total;
        const idxA  = Math.floor(wrapped) % total;
        const idxB  = (idxA + 1) % total;
        const blend = wrapped - Math.floor(wrapped);

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

        // cloudPattern is only needed for the Canvas 2D path (!usePixi).
        // Player PixiJS uses TilingSprites for cloud but still needs cloudPattern
        // for transition snapshot recompositing via recompositeCloudEffect.
        if (!usePixi || isPlayer) {
          cloudPattern = cloudFrames[0].getContext('2d').createPattern(cloudBlendCanvas, 'repeat');
        }
      }

      if (!isDrawing) {
        if (usePixi && !isPlayer) {
          // DM GPU path: update TilingSprite drift + upload 512×512 cloud frame
          pixiUpdateFogAnim(fogAnimOffsets, fogAnimAlphas);
        } else {
          // Canvas-2D path. Player draws clouds in renderFog (skip fogEffectCanvas build);
          // non-PixiJS DM fallback needs it.
          if (!isPlayer && fogEffectCanvas) recompositeCloudEffect(fogAnimOffsets);
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
  if (usePixi && !isPlayer) {
    // DM GPU path: freeze TilingSprite alphas at static values; tilePositions stay as-is
    pixiUpdateFogAnim(null, fogAnimAlphas);
    return;
  }
  if (!isPlayer && fogEffectCanvas) recompositeCloudEffect(null); // freeze (non-PixiJS DM)
  fogDirty = true;
  scheduleRender();
}

// ─── Fog transition ───────────────────────────────────────────────────────────
// Clone fogEffectCanvas / fogBlurCanvas before the rebuild, then crossfade to the
// new state over FOG_REVEAL_MS. Works for both reveal (fog disappears) and shroud
// (fog appears) because we interpolate the fog-density canvases, not display pixels.

function startFogTransition(isShroud = false) {
  fogTransIsShroud = isShroud;
  fogTransBlurNext = null; // reset so fogTransTick captures fresh fogBlurCanvas on next tick

  // If a transition is already running, leave it going. rebuildFogEffect() (called by
  // the caller right after this) will update fogBlurCanvas to include the new reveal,
  // and the live RAF naturally picks that up as its new target — no snapshot needed.
  // This avoids the snap (where the first reveal jumped to completion) without
  // requiring a canvas blend that breaks due to source-over compositing on fog alpha.
  if (fogTransRafId !== null) return;

  if (usePixi && !isPlayer) {
    // DM GPU path: snapshot blur canvas for sprite crossfade
    fogTransPrev = fogBlurCanvas ? cloneCanvas(fogBlurCanvas) : null;
    pixiSetFogTransition(fogTransPrev, 0);
  } else if (usePixi && isPlayer) {
    // Player (hybrid): fog is Canvas-2D on top. The transition morphs the reveal-hole
    // shape — renderFog blends fogTransBlurPrev↔fogBlurCanvas via fogTransBlendCanvas each
    // frame. Only fogTransBlurPrev/fogTransBlendCanvas are needed (saved below); no
    // fogEffectCanvas snapshot, since the navy+cloud is redrawn fresh every frame.
  } else {
    if (!fogEffectCanvas) return;
    fogTransPrev = cloneCanvas(fogEffectCanvas);
  }
  if (fogBlurCanvas) {
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

  if (usePixi && !isPlayer) {
    // DM: sprite alpha crossfade (fast 800ms, cloud ramp acceptable)
    pixiSetFogTransition(null, fogTransT);
  } else {
    // Canvas-2D path (Player fog-on-top, and non-PixiJS DM): renderFog blends
    // fogTransPrev↔fogBlurCanvas via fogTransBlendCanvas each frame.
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
    if (usePixi && !isPlayer) {
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
  if (usePixi && !isPlayer) pixiEndFogTransition();
}
