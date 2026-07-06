'use strict';

// video.js — display-aware texture sizing for PixiJS map rendering.
// Loaded after state.js (reads displayInfo) and before the inline blob.
// Extracted from the blob per CLAUDE.md migrate-on-touch policy.

// ─── Rollback lever ──────────────────────────────────────────────────────────
// Set false to revert every call site to the old ~2× viewport heuristic in one
// line — no need to touch six call sites.
var USE_DISPLAY_SIZING = true;

// ─── Design constant ─────────────────────────────────────────────────────────
// "~1/3 of the map fills the screen at normal play zoom."
// targetLong = max(dispW, dispH) * COVERAGE_FACTOR → enough real map pixels so
// that 1/3 of the map displayed at 1:1 exactly fills the panel's long axis.
// e.g. 1080p: 1920 × 3 = 5760 px; 4K: 3840 × 3 = 11520 px.
var COVERAGE_FACTOR = 3;

// ─── Pure sizing function ─────────────────────────────────────────────────────
// Returns { w, h } — optimal texture dimensions for a pixiSetMap call.
// No zoom parameter: sizing is chosen once at load time, before fitToScreen()
// sets the real zoom. The coverage factor bakes in the expected play zoom.
//
// Params:
//   dispW, dispH  — Player display resolution (from displayInfo)
//   srcW,  srcH   — master map pixel dimensions
//   maxTex        — GPU max texture size (from pixiGetMaxTexSize, or fallback)
//   coverageFactor — override; defaults to COVERAGE_FACTOR when absent/invalid
//
// Guarantees:
//   - Never upscales past source resolution
//   - Clamps to maxTex (belt-and-suspenders before GPU upload)
//   - Preserves aspect ratio
//   - Returns source dims unchanged on zero/absent display info
function computeOptimalTextureSize(dispW, dispH, srcW, srcH, maxTex, coverageFactor) {
  if (!srcW || !srcH) return { w: srcW || 0, h: srcH || 0 };

  // Zero/absent display → caller has no display info yet; use source as-is
  if (!dispW || !dispH) return { w: srcW, h: srcH };

  var cf = (typeof coverageFactor === 'number' && coverageFactor > 0)
    ? coverageFactor : COVERAGE_FACTOR;
  var cap = (typeof maxTex === 'number' && maxTex > 0) ? maxTex : Infinity;

  // Target: long display axis × coverage factor = map pixels we need along the
  // source's long axis to stay crisp at 1/coverageFactor-map zoom.
  var targetLong = Math.max(dispW, dispH) * cf;
  var srcLong    = Math.max(srcW, srcH);
  var scale      = targetLong / srcLong;

  // Already at or below target — no downscale needed
  if (scale >= 1) return { w: srcW, h: srcH };

  var w = Math.round(srcW * scale);
  var h = Math.round(srcH * scale);

  // Clamp to maxTex (preserving aspect ratio)
  if (w > cap || h > cap) {
    var clampScale = cap / Math.max(w, h);
    w = Math.round(w * clampScale);
    h = Math.round(h * clampScale);
  }

  // Hard ceiling: never exceed source (rounding can push fractionally over)
  w = Math.min(w, srcW);
  h = Math.min(h, srcH);

  return { w: w, h: h };
}

// ─── Downscale helper (browser only) ─────────────────────────────────────────
// Takes the master canvas and its declared dims. Returns a NEW canvas sized for
// the detected display, or the original canvas if no downscale is needed.
//
// CRITICAL: never pass the returned canvas to thumbnail/fog logic.
// mapOffscreen must stay full-res — only the GPU texture gets downscaled.
// The caller is responsible for keeping mapOffscreen untouched.
function prepareTextureCanvas(masterCanvas, masterW, masterH) {
  var targetW, targetH;

  if (USE_DISPLAY_SIZING
      && typeof displayInfo !== 'undefined' && displayInfo
      && displayInfo.w && displayInfo.h) {

    var maxTex = (typeof pixiGetMaxTexSize === 'function')
      ? pixiGetMaxTexSize() : 4096;
    var sized = computeOptimalTextureSize(
      displayInfo.w, displayInfo.h, masterW, masterH, maxTex, COVERAGE_FACTOR);
    targetW = sized.w;
    targetH = sized.h;

  } else {
    // Fallback: reproduce old ~2× viewport heuristic so USE_DISPLAY_SIZING=false
    // reverts each call site exactly to its prior behaviour.
    var _maxSide = Math.max(
      (typeof innerWidth  !== 'undefined' ? innerWidth  : 1920),
      (typeof innerHeight !== 'undefined' ? innerHeight : 1080)
    ) * 2;
    var _scale = Math.min(1, _maxSide / Math.max(masterW, masterH));
    targetW = Math.round(masterW * _scale);
    targetH = Math.round(masterH * _scale);
  }

  // No downscale needed — hand back original so caller avoids an extra canvas
  if (targetW >= masterW && targetH >= masterH) return masterCanvas;

  var tex = document.createElement('canvas');
  tex.width  = targetW;
  tex.height = targetH;
  tex.getContext('2d').drawImage(masterCanvas, 0, 0, targetW, targetH);
  return tex;
}

// ─── Re-texture on display change ────────────────────────────────────────────
// Called by display.js whenever displayInfo is updated (Player window opened,
// moved to a different screen, or display config changed). Re-runs sizing against
// the full-res mapOffscreen master — which is always preserved — and re-uploads
// the correctly-sized texture to PixiJS without touching fog or scene state.
//
// Covers the workflow: Open app → load map → connect TV → open Player → slide
// Player to TV. The map was loaded before the TV was known; this re-sizes it
// the moment the TV's resolution is detected.
function onDisplayInfoUpdated() {
  if (typeof usePixi === 'undefined' || !usePixi) return;
  if (typeof mapOffscreen === 'undefined' || !mapOffscreen) return;
  if (typeof mapWidth === 'undefined' || !mapWidth || !mapHeight) return;

  var newTex = prepareTextureCanvas(mapOffscreen, mapWidth, mapHeight);

  // Player video: also update the per-frame texture canvas so the PixiJS ticker
  // sync loop draws at the new dimensions on its next tick.
  if (typeof isPlayer !== 'undefined' && isPlayer
      && typeof mapVideo !== 'undefined' && mapVideo) {
    playerMapTexCanvas = newTex;
    playerMapTexCtx = newTex.getContext('2d');
  }

  pixiSetMap(newTex, mapWidth, mapHeight);
  if (typeof viewportDirty !== 'undefined') viewportDirty = true;
  if (typeof scheduleRender === 'function') scheduleRender();
}

// ─── Export guard (Node require for tests; no-op in browser) ─────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeOptimalTextureSize };
}
