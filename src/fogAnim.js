'use strict';

// fogAnim.js — every fog animation on a clock: the drift, the reveal crossfade, the scene cover
// and the colour ease across it. fog.js owns the canvases they paint; the RAF handles are state.js's.

// ─── Durations and state ──────────────────────────────────────────────────────
const FOG_REVEAL_MS      = 2500; // player view: dramatic reveal
const FOG_SHROUD_MS      = 1200; // player view: ~half of reveal — curtain closes noticeably faster
const FOG_DM_REVEAL_MS   =  800; // DM view: very quick either direction

let fogAnimOffsets = CLOUD_PASSES.map(() => ({ x: 0, y: 0 }));
let fogAnimAlphas  = CLOUD_PASSES.map(p => p.alpha);
let fogAnimTime    = 0;
let fogAnimLastTs  = 0;

// Cross-fades fogEffectCanvas / fogBlurCanvas before and after any fog operation. 'lighter'
// blend, so prev*(1-t) + new*t is a true lerp with no alpha bleed in always-fogged regions.
let fogTransPrev        = null; // clone of fogEffectCanvas before op (DM)
let fogTransBlurPrev    = null; // clone of fogBlurCanvas before op (player)
let fogTransT           = 0;   // 0→1 during transition
let fogTransStart       = 0;
// fogTransRafId lives in state.js (fog RAF lifecycle handle)
let fogTransIsShroud    = false;



let fogAnimThrottleNext = 0;
const FOG_ANIM_VIDEO_INTERVAL = 66; // ~15fps fog updates when video is active

// Cloud crossfade rebuild rate: an every-tick rebuild repaints the same picture, because the
// blend advances a few thousandths of a frame. Lower it if the morph reads as steppy.
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

          // The Player's fog samples this canvas on the GPU; the loading card still fills with
          // the pattern, so both are kept in step here.
          if (isPlayer) {
            cloudPattern = cloudFrames[0].getContext('2d').createPattern(cloudBlendCanvas, 'repeat');
            pixiUploadPlayerFogCloud();
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

  // A transition already running is LEFT going: the caller's rebuildFogEffect() updates
  // fogBlurCanvas and the live RAF picks that up as its new target. Snapshotting here instead
  // makes the first reveal jump to completion.
  if (fogTransRafId !== null) return;

  if (!isPlayer) {
    // DM GPU path: snapshot the blur canvas for the sprite crossfade.
    fogTransPrev = fogBlurCanvas ? cloneCanvas(fogBlurCanvas) : null;
    pixiSetFogTransition(fogTransPrev, 0);
  } else if (fogBlurCanvas) {
    // Player: the full-screen pass crossfades the two reveal masks in the shader, so the only
    // thing to keep is the outgoing mask itself.
    fogTransBlurPrev = cloneCanvas(fogBlurCanvas);
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
    // Player: the shader crossfades the two masks, so only the flag is needed here.
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
    if (isPlayer) pixiSetPlayerFogPrevMask(null);   // releases that snapshot's GPU texture
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
// Both feed the ordinary transition a "previous" mask that is opaque everywhere.

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
