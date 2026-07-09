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
  // DM with active DOM video: pixiSetMap creates a new sprite with visible=true,
  // but the map is shown via CSS-composited <video>, not the PixiJS sprite.
  // Keep the sprite hidden so the static first-frame doesn't flash over the live video.
  if (typeof videoDOMActive !== 'undefined' && videoDOMActive) pixiHideMap();
  if (typeof viewportDirty !== 'undefined') viewportDirty = true;
  if (typeof scheduleRender === 'function') scheduleRender();
}

// ─── Video lifecycle — extracted from inline blob ─────────────────────────────
// All functions below reference inline-blob globals (videoEnabled, mapVideo,
// videoRVFCId, etc.) lazily — names are resolved at call time, not definition
// time, so the load-order constraint is safe.

function onVideoStalled() {
  // Decoder stalled waiting for data — try to re-kick playback.
  if (!videoEnabled || !mapVideo) return;
  _diagAppend('event:stalled rs=' + mapVideo.readyState);
  mapVideo.play().catch(function() {});
}

function onVideoWaiting() {
  // Buffer temporarily drained (rs=2). Explicitly pause so Chromium's presentation
  // clock freezes — prevents a catch-up sync-seek when the buffer refills, which
  // is what causes visible jitter. Poll until rs≥3, then resume.
  if (!videoEnabled || !mapVideo) return;
  _diagAppend('event:waiting rs=' + mapVideo.readyState);
  if (!mapVideo.paused) {
    _bufferingPause = true;
    mapVideo.pause();
    var capturedVideo = mapVideo;
    (function pollBuffer() {
      if (!_bufferingPause || !videoEnabled || mapVideo !== capturedVideo) return;
      if (mapVideo.readyState >= 3) {
        _bufferingPause = false;
        _diagAppend('buffer refilled rs=' + mapVideo.readyState + ' resuming');
        mapVideo.play().catch(function() {});
        return;
      }
      setTimeout(pollBuffer, 100);
    })();
  }
}

function onVideoPause() {
  if (!videoEnabled || !mapVideo) return;
  if (_bufferingPause) return; // our own pause — poll in onVideoWaiting will resume
  _diagAppend('event:pause rs=' + mapVideo.readyState);
  mapVideo.play().catch(function() {});
}

function onVideoPlaying() {
  if (!videoEnabled || !mapVideo) return;
  _diagAppend('event:playing rs=' + mapVideo.readyState);
  if (videoRVFCId == null && videoRAFId == null) scheduleVideoFrame();
}

function attachVideoListeners(video) {
  video.addEventListener('pause',   onVideoPause);
  video.addEventListener('playing', onVideoPlaying);
  video.addEventListener('stalled', onVideoStalled);
  video.addEventListener('waiting', onVideoWaiting);
}

function detachVideoListeners(video) {
  video.removeEventListener('pause',   onVideoPause);
  video.removeEventListener('playing', onVideoPlaying);
  video.removeEventListener('stalled', onVideoStalled);
  video.removeEventListener('waiting', onVideoWaiting);
}

function scheduleVideoFrame() {
  if (!videoEnabled || !mapVideo) return;
  if (mapVideo.requestVideoFrameCallback) {
    videoRVFCId = mapVideo.requestVideoFrameCallback(function() {
      videoRVFCId = null;
      if (!videoEnabled || !mapVideo) return;
      var now = performance.now();
      if (now - videoLastRenderTs >= videoFrameIntervalMs) {
        videoLastRenderTs = now;
        mapDirty = true;
        scheduleRender();
      }
      scheduleVideoFrame();
    });
  } else {
    videoRAFId = requestAnimationFrame(function() {
      videoRAFId = null;
      if (!videoEnabled || !mapVideo) return;
      if (!mapVideo.paused && !mapVideo.ended) {
        var now = performance.now();
        if (now - videoLastRenderTs >= videoFrameIntervalMs) {
          videoLastRenderTs = now;
          mapDirty = true;
          scheduleRender();
        }
      }
      scheduleVideoFrame();
    });
  }
}

var _videoWatchdogId = null;
var _videoLoopStartedAt = 0; // performance.now() timestamp of last startVideoLoop call
var _bufferingPause = false;  // true while we intentionally paused to freeze the presentation clock

function stopVideoWatchdog() {
  if (_videoWatchdogId) { clearInterval(_videoWatchdogId); _videoWatchdogId = null; }
}

// Polls every 3 s while video is active. Catches cases where Chromium's
// background-video optimizer silently pauses or stalls a muted video element
// (typically fires after ~30 s for elements it deems "not visible"). If the
// video is paused or readyState has dropped, force a play() and restart the
// RVFC/RAF loop if it died.
function startVideoWatchdog() {
  stopVideoWatchdog();
  _videoWatchdogId = setInterval(function() {
    if (!videoEnabled || !mapVideo) return;
    var rs = mapVideo.readyState;
    var pa = mapVideo.paused;
    var age = ((performance.now() - _videoLoopStartedAt) / 1000).toFixed(1);
    _diagAppend('watchdog rs=' + rs + ' paused=' + pa + ' age=' + age + 's');
    if (pa || rs < 3) {
      if (!pa && rs < 3) {
        // rs=2 (HAVE_CURRENT_DATA) while not paused = buffer temporarily drained.
        // The browser is already refilling (event:waiting fires alongside this).
        // A seek-kick here interrupts that natural recovery and causes visible jitter —
        // don't seek. play() below is a no-op on a playing element but harmless.
        _diagAppend('rs<3 not paused — letting buffer refill (no kick) rs=' + rs);
      }
      _diagAppend('watchdog play() pa=' + pa + ' rs=' + rs);
      _diagAppend('[STALL-FLUSH] best-effort disk sync point');
      mapVideo.play().catch(function() {});
    }
    if (videoRVFCId == null && videoRAFId == null) {
      _diagAppend('watchdog restart frame loop');
      scheduleVideoFrame();
    }
  }, 3000);
}

function stopVideoLoop() {
  _diagAppend('stopVideoLoop');
  stopVideoWatchdog();
  videoEnabled = false;
  if (videoRAFId) { cancelAnimationFrame(videoRAFId); videoRAFId = null; }
  if (videoRVFCId != null && mapVideo && mapVideo.cancelVideoFrameCallback) {
    mapVideo.cancelVideoFrameCallback(videoRVFCId); videoRVFCId = null;
  }
}

function startVideoLoop() {
  if (!mapVideo) return;
  stopVideoLoop();
  videoEnabled = true;
  videoLastRenderTs = 0;
  _videoLoopStartedAt = performance.now();
  _bufferingPause = false;
  _diagAppend('startVideoLoop');
  if (!isPlayer) activateVideoDom(mapVideo);
  if (mapVideo.paused || mapVideo.ended) {
    mapVideo.play().catch(function() {});
  }
  // Start the RVFC/RAF loop immediately. onVideoPlaying cannot start it because
  // the 'playing' event fires before videoEnabled=true (set above), so the loop
  // would never run without this explicit kick-off.
  scheduleVideoFrame();
  startVideoWatchdog();
}

// ─── FPS ↔ interval converter ────────────────────────────────────────────────
// Pure helper: converts a frames-per-second value to milliseconds per frame.
// Clamps fps to 5–60; falls back to VIDEO_FPS_DEFAULT (24) on invalid input.
// Used by the FPS dial (index.html) and testable in isolation.
function fpsToFrameInterval(fps) {
  var DEFAULT_MS = 1000 / 24; // matches VIDEO_FPS_DEFAULT in state.js
  if (typeof fps !== 'number' || !isFinite(fps) || fps <= 0) return DEFAULT_MS;
  var clamped = Math.max(5, Math.min(60, fps));
  return 1000 / clamped;
}

// ─── Player video element factory ─────────────────────────────────────────────
// Creates the Player's <video> and inserts it as the first child of container so
// all canvas siblings (fog last, opacity:1) paint on top via DOM order.
// Must be a full-container element — a 1×1 px element elsewhere causes Chromium's
// BackgroundVideoTrackOptimizer to treat the video as occluded and throttle decode
// (mitigated at the process level by the disable-features flag in main.js, but
// correct sizing is belt-and-suspenders).
function createPlayerVideoElement(container) {
  var video = document.createElement('video');
  video.muted = true; video.loop = true; video.playsInline = true; video.preload = 'auto';
  video.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
  container.insertBefore(video, container.firstChild);
  return video;
}

// ─── Video DOM compositing + file loading ────────────────────────────────────
// Instead of drawImage(video) to canvas every frame (which forces a GPU→CPU
// readback per frame), we insert the <video> element directly into the DOM
// behind the canvas stack and let the browser's native hardware compositor
// handle it — the same zero-copy path that VLC/media-players use.
let videoDOMActive = false;

function activateVideoDom(video) {
  _diagAppend('activateVideoDom');
  video.style.cssText = 'position:absolute;top:0;left:0;transform-origin:0 0;pointer-events:none;z-index:0;';
  container.insertBefore(video, mapCanvas);
  videoDOMActive = true;
  if (!isPlayer) {
    pixiHideMap();
    mapCtx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
  }
  syncVideoDomTransform();
}

function deactivateVideoDom() {
  _diagAppend('deactivateVideoDom');
  videoDOMActive = false;
  pixiShowMap();
  if (mapVideo && mapVideo.parentNode === container) {
    mapVideo.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;pointer-events:none;';
  }
}

function syncVideoDomTransform() {
  if (!videoDOMActive || !mapVideo) return;
  mapVideo.style.width  = mapWidth  + 'px';
  mapVideo.style.height = mapHeight + 'px';
  mapVideo.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')';
}

function cleanupVideo() {
  _diagAppend('cleanupVideo');
  deactivateVideoDom();
  stopVideoLoop();
  if (mapVideo) {
    detachVideoListeners(mapVideo);
    mapVideo.pause(); mapVideo.src = '';
    if (mapVideo.parentNode) mapVideo.parentNode.removeChild(mapVideo);
    mapVideo = null;
  }
  if (mapVideoUrl) {
    if (mapVideoUrl.startsWith('blob:')) URL.revokeObjectURL(mapVideoUrl);
    mapVideoUrl = null;
  }
  mapVideoBlob = null;
  pixiStopVideoTextureSync();
  playerMapTexCanvas = null;
  playerMapTexCtx = null;
}


function loadVideoFromFile(file, onVideoLoaded) {
  if (!file) return;
  cleanupVideo();
  const url = URL.createObjectURL(file);
  mapVideoUrl = url;
  const video = document.createElement('video');
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;pointer-events:none;';
  document.body.appendChild(video);
  let settled = false;
  function failLoad(reason) {
    if (settled) return;
    settled = true;
    video.onerror = null; video.oncanplay = null;
    video.pause(); video.src = '';
    if (video.parentNode) video.parentNode.removeChild(video);
    cleanupVideo();
    alert('Failed to load video map.' + (reason ? ' ' + reason : ''));
  }
  video.onerror = () => failLoad();
  video.oncanplay = function() {
    if (settled) return;
    settled = true;
    video.onerror = null; video.oncanplay = null;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    mapWidth  = vw;
    mapHeight = vh;

    function finishLoad() {
      // Extract frame 0 as static fallback + thumbnail source
      const extractCanvas = document.createElement('canvas');
      extractCanvas.width = vw; extractCanvas.height = vh;
      extractCanvas.getContext('2d').drawImage(video, 0, 0, vw, vh);

      if (mapBitmap) { mapBitmap.close(); mapBitmap = null; }
      mapOffscreen = extractCanvas;
      pixiSetMap(prepareTextureCanvas(extractCanvas, vw, vh), vw, vh);
      pixiHideMap();
      mapVideo = video;
      attachVideoListeners(video);
      mapVideoBlob = file;

      fogDataCanvas = document.createElement('canvas');
      fogDataCanvas.width  = Math.ceil(mapWidth  / FOG_SCALE);
      fogDataCanvas.height = Math.ceil(mapHeight / FOG_SCALE);
      fogDataCtx = fogDataCanvas.getContext('2d');
      fogDataCtx.fillStyle = '#1a1a2e';
      fogDataCtx.fillRect(0, 0, fogDataCanvas.width, fogDataCanvas.height);

      baseFogCanvas = document.createElement('canvas');
      baseFogCanvas.width = fogDataCanvas.width;
      baseFogCanvas.height = fogDataCanvas.height;
      baseFogCtx = baseFogCanvas.getContext('2d');
      baseFogCtx.fillStyle = '#1a1a2e';
      baseFogCtx.fillRect(0, 0, baseFogCanvas.width, baseFogCanvas.height);

      polygons = []; activePolygon = null; selectedPolygonId = null;
      nextPolygonId = 1;
      playerMapSent = false;

      if (!cloudPattern) generateCloudFrames(512, CLOUD_FRAME_COUNT);
      rebuildFogEffect();
      if (!isPlayer) { pixiInitFog(fogDataCanvas, fogBlurCanvas, cloudBlendCanvas, mapWidth, mapHeight); pixiFlushTexturePool(); pixiUpdateFogBlurTexture(); }

      fitToScreen();
      if (!isPlayer) container.style.cursor = 'crosshair';
      landing.style.display = 'none';
      viewportDirty = true;
      scheduleRender();

      video.play().then(() => startVideoLoop()).catch(() => {});
      if (onVideoLoaded) onVideoLoaded(extractCanvas, file);
    }

    // Seek to near-zero and wait for decoded frame before extracting
    video.onseeked = function() {
      video.onseeked = null;
      finishLoad();
    };
    video.currentTime = 0.001;
    // Fallback if seeked never fires (already at target position)
    setTimeout(() => { if (video.onseeked) { video.onseeked = null; finishLoad(); } }, 2000);
  };
  video.src = url;
}

function isVideoFile(file) {
  if (file.type && (file.type.startsWith('video/') || file.type === 'video/mp4' || file.type === 'video/webm')) return true;
  return /\.(mp4|webm)$/i.test(file.name);
}

// ─── Diagnostics (toggle with backtick ` — works in both DM and Player) ──────
// Kept intentionally for future video-stall investigation. Gated: the on-screen
// overlay only appears on backtick, and the stress rig only runs under ?stress=1.
// Disk logging (main.js) is always-on during playback but rotated/capped to 3 files.
var _diagActive   = false;
var _diagEl       = null;
var _diagInterval = null;
var _diagLog      = [];   // ring buffer, newest appended last; disk log is unbounded
var _diagT0       = null; // perf timestamp of first event
var _diagPrevRS   = -1;   // detect readyState changes between polls

// Resolved once on first use. 'dm' or 'player' — used as the mode tag for disk log filenames.
// Note: _diagT0 resets when the overlay is toggled, so the relative +Ns stamp is NOT monotonic
// across toggles. The wall-clock field (Date.now) is the reliable ordering key in the disk log.
function _diagMode() {
  return (typeof isPlayer !== 'undefined' && isPlayer) ? 'player' : 'dm';
}

function _diagWriteDisk(relStamp, msg) {
  if (typeof window === 'undefined' || !window.electronAPI || !window.electronAPI.diagAppendLine) return;
  var wallMs = Date.now();
  var line = '[' + wallMs + '] [' + relStamp + '] ' + msg;
  try { window.electronAPI.diagAppendLine(_diagMode(), line); } catch (_) {}
}

function _diagAppend(msg) {
  if (!_diagT0) _diagT0 = performance.now();
  var t = ((performance.now() - _diagT0) / 1000).toFixed(2);
  var relStamp = '+' + t + 's';
  _diagLog.push('[' + relStamp + '] ' + msg);
  if (_diagLog.length > 50) _diagLog.shift();
  _diagWriteDisk(relStamp, msg);
}

function _diagRender() {
  if (!_diagEl) return;
  var mode = (typeof isPlayer !== 'undefined' && isPlayer) ? 'PLAYER' : 'DM';
  var ve   = (typeof videoEnabled   !== 'undefined') ? videoEnabled   : '?';
  var vda  = (typeof videoDOMActive !== 'undefined') ? videoDOMActive : '?';
  var mv   = (typeof mapVideo !== 'undefined') ? mapVideo : null;
  var rs   = mv ? mv.readyState   : '—';
  var pa   = mv ? mv.paused       : '—';
  var ct   = mv ? mv.currentTime.toFixed(3) : '—';
  var loopAge = _videoLoopStartedAt
    ? ((performance.now() - _videoLoopStartedAt) / 1000).toFixed(1) + 's' : '—';
  var rvfc = (typeof videoRVFCId !== 'undefined') ? videoRVFCId : '?';
  var raf  = (typeof videoRAFId  !== 'undefined') ? videoRAFId  : '?';
  var wdog = _videoWatchdogId ? 'ON' : 'off';

  // Detect readyState changes between renders
  if (mv && rs !== _diagPrevRS) {
    if (_diagPrevRS !== -1) _diagAppend('rs changed ' + _diagPrevRS + '→' + rs);
    _diagPrevRS = rs;
  }

  var lines = [
    '── VIDEO DIAG [' + mode + '] (` to close) ──',
    've=' + ve + '  vda=' + vda + '  wdog=' + wdog,
    'rs=' + rs + (rs < 4 && rs !== '—' ? ' ⚠' : '') +
      '  paused=' + pa + '  ct=' + ct,
    'loopAge=' + loopAge + '  RVFC=' + rvfc + '  RAF=' + raf,
    '── Events (newest first) ──',
  ].concat(_diagLog.slice().reverse());

  _diagEl.textContent = lines.join('\n');
}

function _diagToggle() {
  _diagActive = !_diagActive;
  if (_diagActive) {
    if (!_diagEl) {
      _diagEl = document.createElement('div');
      _diagEl.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;' +
        'background:rgba(0,0,0,0.88);color:#0f0;font-family:monospace;font-size:11px;' +
        'line-height:1.5;padding:8px 10px;max-height:82vh;overflow-y:auto;' +
        'pointer-events:none;white-space:pre;border:1px solid #0f0;min-width:280px;';
      document.body.appendChild(_diagEl);
    }
    _diagT0 = null; _diagLog = []; _diagPrevRS = -1;
    _diagAppend('diag opened');
    _diagRender();
    _diagInterval = setInterval(_diagRender, 250);
  } else {
    if (_diagInterval) { clearInterval(_diagInterval); _diagInterval = null; }
    if (_diagEl) { _diagEl.remove(); _diagEl = null; }
  }
}

if (typeof document !== 'undefined' && !(typeof isPlayer !== 'undefined' && isPlayer)) {
  document.addEventListener('keydown', function(e) {
    if (e.key === '`') _diagToggle();
  });
}

// ─── Export guard (Node require for tests; no-op in browser) ─────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeOptimalTextureSize, fpsToFrameInterval };
}
