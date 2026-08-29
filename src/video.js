'use strict';

// video.js — display-aware texture sizing for PixiJS map rendering.
// Loaded after state.js (reads displayInfo) and before the inline blob.

// ─── Design constants ────────────────────────────────────────────────────────
// targetLong = max(dispW, dispH) * coverage → real map pixels along the texture's long axis.
// Coverage IS zoom headroom: 3 means the view stays crisp to 3× the fit-to-screen zoom.
//
// The DM zooms in to draw rooms and keeps the full 3×. The Player shows the whole map, and on an
// animated map its texture is re-uploaded every frame, so area there is a per-frame cost.
// Player coverage of 2 leaves an ordinary map untouched and halves an oversized export.
var COVERAGE_FACTOR        = 3;
var PLAYER_COVERAGE_FACTOR = 2;

// Pure: zoom headroom for this view. Exported for tests.
function coverageFactorFor(isPlayerView) {
  return isPlayerView ? PLAYER_COVERAGE_FACTOR : COVERAGE_FACTOR;
}

// ─── Pure sizing function ─────────────────────────────────────────────────────
// Optimal texture dimensions for a pixiSetMap call. No zoom parameter: sizing is chosen once at
// load time, before fitToScreen() sets the real zoom, and coverage bakes in the expected zoom.
//
// Never upscales past source, clamps to maxTex, preserves aspect, and returns the source dims
// unchanged when display info is absent.
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
// Returns a NEW canvas sized for the detected display, or the original when no downscale is
// needed. ⚠ Never pass the result to thumbnail or fog logic: mapOffscreen must stay full-res, and
// the caller is responsible for keeping it untouched.
function prepareTextureCanvas(masterCanvas, masterW, masterH) {
  var targetW, targetH;

  if (typeof displayInfo !== 'undefined' && displayInfo
      && displayInfo.w && displayInfo.h) {

    var maxTex = (typeof pixiGetMaxTexSize === 'function')
      ? pixiGetMaxTexSize() : 4096;
    var cf = coverageFactorFor(typeof isPlayer !== 'undefined' && isPlayer);
    var sized = computeOptimalTextureSize(
      displayInfo.w, displayInfo.h, masterW, masterH, maxTex, cf);
    targetW = sized.w;
    targetH = sized.h;

  } else {
    // ⚠ NOT DEAD, AND NOT A ROLLBACK LEVER. displayInfo is null until main.js pushes it, so a map
    // loaded early lands here, and this heuristic is the only sizing available before the Player's
    // screen is known. onDisplayInfoUpdated re-sizes it the moment the display is reported.
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

// ─── Player animated map: a viewport-sized region texture ────────────────────
// The Player's map texture is sized to its own SCREEN, not to the map: one texel per screen pixel,
// so it is resolution-correct at every zoom and costs the same whatever the map's resolution.
//
// ⚠ The region is the viewport GROWN BY A MARGIN, never visibleMapRegion(), which shrinks as you
// pan to an edge. A shrinking region in a fixed canvas changes the texel-per-pixel ratio with the
// camera; this one holds it constant, and the sprite always lands on the same screen rectangle,
// so nothing drifts between the map and the fog.
//
// The margin covers float error and a late resize handler, not panning — the region is recomputed
// every frame.
var PLAYER_REGION_MARGIN = 32;

// Pure: the map-space rectangle a texW×texH texture covers. Exported for tests.
function mapRegionForTexture(panX, panY, zoom, texW, texH, vpW, vpH) {
  var w = texW / zoom, h = texH / zoom;
  return {
    x: (vpW / 2 - panX) / zoom - w / 2,
    y: (vpH / 2 - panY) / zoom - h / 2,
    w: w, h: h,
  };
}

// Pure: clamp a map-space region to the map and give the matching destination rect inside the
// texture canvas, so drawImage never gets a source rect outside the video frame. `clear` reports
// an overhang, where the canvas would otherwise keep the previous frame. Null when it misses.
function clampRegionToMap(r, mapW, mapH, zoom) {
  var sx = Math.max(0, r.x), sy = Math.max(0, r.y);
  var sw = Math.min(mapW, r.x + r.w) - sx;
  var sh = Math.min(mapH, r.y + r.h) - sy;
  if (!(sw > 0) || !(sh > 0)) return null;
  return {
    sx: sx, sy: sy, sw: sw, sh: sh,
    dx: (sx - r.x) * zoom, dy: (sy - r.y) * zoom,
    dw: sw * zoom,         dh: sh * zoom,
    clear: sw < r.w || sh < r.h,
  };
}

// Allocate the region canvas from the viewport, once. ⚠ Never per frame and never on pan or zoom:
// the allocation is fixed and only its CONTENT follows the camera.
function ensurePlayerRegionCanvas() {
  var vp = getViewportSize();
  var texW = Math.max(1, Math.round(vp.w) + PLAYER_REGION_MARGIN * 2);
  var texH = Math.max(1, Math.round(vp.h) + PLAYER_REGION_MARGIN * 2);
  if (playerMapTexCanvas &&
      playerMapTexCanvas.width === texW && playerMapTexCanvas.height === texH) return;
  playerMapTexCanvas = document.createElement('canvas');
  playerMapTexCanvas.width  = texW;
  playerMapTexCanvas.height = texH;
  playerMapTexCtx = playerMapTexCanvas.getContext('2d');
}

var _playerRegionBound = null;   // the canvas pixiSetMap was last handed

// Point PixiJS at the region canvas. pixiSetMap gets the CANVAS dimensions, never the map's, so
// its MAX_TEXTURE_SIZE clamp cannot rescale it; pixiSetMapRegion places the sprite.
function initPlayerMapRegionTexture() {
  if (!mapVideo || !mapWidth || !mapHeight) return;
  ensurePlayerRegionCanvas();
  // pixiSetMap destroys and rebuilds the sprite and its GPU texture, and displayInfo can
  // fire repeatedly for one physical change — only rebind when the canvas is actually new.
  if (_playerRegionBound !== playerMapTexCanvas) {
    pixiSetMap(playerMapTexCanvas, playerMapTexCanvas.width, playerMapTexCanvas.height);
    _playerRegionBound = playerMapTexCanvas;
  }
  refreshPlayerMapRegion();
  viewportDirty = true;
  scheduleRender();
}

// Restore the clamp the region texture gives up. A region texture puts the map edge inside the
// canvas with transparent pixels beyond, and LINEAR sampling fades the outermost pixel toward
// nothing — a dark rim the hybrid fog cannot tolerate. Stretching the edge row and column one
// pixel outward gives the sampler real content, as clamping would.
//
// Only runs when the region overhangs the map. FOG_EDGE_MARGIN hides the band at play zoom but is
// too thin at fit-to-screen to rely on.
//
// ⚠ It reads the VIDEO, not the canvas: drawing a canvas onto itself forces a readback of its
// backing store, which costs more than the draw it protects.
function bleedRegionEdges(ctx, video, c, zoom) {
  if (!(c.dw >= 1) || !(c.dh >= 1) || !(zoom > 0)) return;
  var sp = 1 / zoom;                       // one destination pixel, in map units
  if (!(c.sw > sp) || !(c.sh > sp)) return;
  ctx.drawImage(video, c.sx, c.sy,               c.sw, sp,   c.dx,        c.dy - 1,    c.dw, 1);
  ctx.drawImage(video, c.sx, c.sy + c.sh - sp,   c.sw, sp,   c.dx,        c.dy + c.dh, c.dw, 1);
  ctx.drawImage(video, c.sx, c.sy,               sp,   c.sh, c.dx - 1,    c.dy,        1,    c.dh);
  ctx.drawImage(video, c.sx + c.sw - sp, c.sy,   sp,   c.sh, c.dx + c.dw, c.dy,        1,    c.dh);
}

// One frame: pull the visible region out of the video and place the sprite over it.
function refreshPlayerMapRegion() {
  if (!mapVideo || !playerMapTexCtx || !playerMapTexCanvas) return;
  var texW = playerMapTexCanvas.width, texH = playerMapTexCanvas.height;
  var vp = getViewportSize();
  var r = mapRegionForTexture(panX, panY, zoom, texW, texH, vp.w, vp.h);
  var c = clampRegionToMap(r, mapWidth, mapHeight, zoom);
  if (!c) {
    playerMapTexCtx.clearRect(0, 0, texW, texH);
  } else {
    // Conditional, not unconditional: this is the per-frame TV path, and once the map
    // fills the viewport the draw covers every pixel on its own.
    if (c.clear) playerMapTexCtx.clearRect(0, 0, texW, texH);
    playerMapTexCtx.drawImage(mapVideo, c.sx, c.sy, c.sw, c.sh, c.dx, c.dy, c.dw, c.dh);
    if (c.clear) bleedRegionEdges(playerMapTexCtx, mapVideo, c, zoom);
  }
  pixiSetMapRegion(r.x, r.y, r.w, r.h);
  pixiUpdateMapTexture();
}

// ─── Binding an animated map's frame-0 texture ───────────────────────────────
// The two views need OPPOSITE things here, which is why this is one function.
//
// DM: the map is a CSS-composited DOM <video> and the sprite is hidden at once, so a texture would
// sit on the GPU for the whole scene and never draw. Clear the layer instead.
//
// Player: the sprite IS the map, so it keeps one. ⚠ This first texture is superseded by the
// viewport-sized region texture a moment later, and that ordering matters — see
// initPlayerMapRegionTexture and the warning in onDisplayInfoUpdated.
function bindVideoFrameTexture(frameCanvas, w, h) {
  if (typeof isPlayer !== 'undefined' && !isPlayer) { pixiClearMap(); return; }
  pixiSetMap(prepareTextureCanvas(frameCanvas, w, h), w, h);
  pixiHideMap();
}

// ─── Re-texture on display change ────────────────────────────────────────────
// Called by display.js whenever displayInfo is updated. Re-runs sizing against the full-res
// mapOffscreen master and re-uploads the texture, touching no fog or scene state.
//
// Covers the workflow the app is used by: load a map, connect the TV, open the Player, slide it
// across. The map was loaded before the TV was known.
function onDisplayInfoUpdated() {
  if (typeof mapOffscreen === 'undefined' || !mapOffscreen) return;
  if (typeof mapWidth === 'undefined' || !mapWidth || !mapHeight) return;

  // Player animated map: the texture is sized from the Player's own viewport, so there is no
  // sizing to redo. ⚠ Falling through destroys the region sprite and rebuilds a full-map one at
  // 0,0, on exactly the workflow this function exists for.
  if (typeof isPlayer !== 'undefined' && isPlayer
      && typeof mapVideo !== 'undefined' && mapVideo) {
    initPlayerMapRegionTexture();
    return;
  }

  // DM animated map: the map is the DOM <video> and this view holds no sprite. Clearing rather
  // than falling through stops a display change re-uploading the texture just removed.
  if (typeof mapVideo !== 'undefined' && mapVideo) {
    pixiClearMap();
    if (typeof viewportDirty !== 'undefined') viewportDirty = true;
    if (typeof scheduleRender === 'function') scheduleRender();
    return;
  }

  pixiSetMap(prepareTextureCanvas(mapOffscreen, mapWidth, mapHeight), mapWidth, mapHeight);
  if (typeof viewportDirty !== 'undefined') viewportDirty = true;
  if (typeof scheduleRender === 'function') scheduleRender();
}

// ─── Video lifecycle ──────────────────────────────────────────────────────────
// The functions below reference inline-blob globals lazily — names resolve at call time, so the
// load order is safe.

function onVideoStalled() {
  // Decoder stalled waiting for data — try to re-kick playback.
  if (!videoEnabled || !mapVideo) return;
  _diagAppend('event:stalled rs=' + mapVideo.readyState);
  mapVideo.play().catch(function() {});
}

function onVideoWaiting() {
  // Buffer temporarily drained (rs=2). Pause so Chromium's presentation clock freezes, or the
  // refill triggers a catch-up sync-seek and visible jitter. Poll until rs≥3, then resume.
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
  if (videoRVFCId == null) scheduleVideoFrame();
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

// The per-frame loop. ⚠ NEITHER VIEW DRAWS ITS MAP FROM HERE: the DM's map is the composited DOM
// <video> and the Player's texture rides the PixiJS ticker. The scheduleRender below is for
// syncVideoDomTransform, which videoFrameIntervalMs holds to 24 a second.
//
// The loop is also the watchdog's liveness signal: a null id is how a dead pump is restarted.
//
// No requestAnimationFrame fallback: requestVideoFrameCallback is everywhere this app runs.
function scheduleVideoFrame() {
  if (!videoEnabled || !mapVideo) return;
  videoRVFCId = mapVideo.requestVideoFrameCallback(function() {
    videoRVFCId = null;
    if (!videoEnabled || !mapVideo) return;
    var now = performance.now();
    if (now - videoLastRenderTs >= videoFrameIntervalMs) {
      videoLastRenderTs = now;
      scheduleRender();
    }
    scheduleVideoFrame();
  });
}

var _videoWatchdogId = null;
var _videoLoopStartedAt = 0; // performance.now() timestamp of last startVideoLoop call
var _bufferingPause = false;  // true while we intentionally paused to freeze the presentation clock

function stopVideoWatchdog() {
  if (_videoWatchdogId) { clearInterval(_videoWatchdogId); _videoWatchdogId = null; }
}

// Polls while video is active, because Chromium's background-video optimizer silently pauses a
// muted element it deems invisible. Forces play() and restarts the loop if it died.
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
        // rs=2 while not paused means the buffer drained and the browser is already refilling.
        // ⚠ Never seek here: it interrupts that recovery and causes visible jitter.
        _diagAppend('rs<3 not paused — letting buffer refill (no kick) rs=' + rs);
      }
      _diagAppend('watchdog play() pa=' + pa + ' rs=' + rs);
      _diagAppend('[STALL-FLUSH] best-effort disk sync point');
      mapVideo.play().catch(function() {});
    }
    if (videoRVFCId == null) {
      _diagAppend('watchdog restart frame loop');
      scheduleVideoFrame();
    }
  }, 3000);
}

function stopVideoLoop() {
  _diagAppend('stopVideoLoop');
  stopVideoWatchdog();
  videoEnabled = false;
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
  // Start the loop here: 'playing' fires before videoEnabled=true, so onVideoPlaying cannot.
  scheduleVideoFrame();
  startVideoWatchdog();
}

// ─── Player video element factory ─────────────────────────────────────────────
// Creates the Player's <video> as the container's first child, so every canvas sibling paints on
// top by DOM order. ⚠ Must be a full-container element: Chromium's BackgroundVideoTrackOptimizer
// treats a tiny one as occluded and throttles decode.
function createPlayerVideoElement(container) {
  var video = document.createElement('video');
  video.muted = true; video.loop = true; video.playsInline = true; video.preload = 'auto';
  video.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
  container.insertBefore(video, container.firstChild);
  return video;
}

// ─── Video DOM compositing + file loading ────────────────────────────────────
// The <video> element goes into the DOM behind the canvas stack, so the browser's hardware
// compositor handles it. drawImage(video) every frame would force a GPU→CPU readback.
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
  _playerRegionBound = null;
}


// ⚠ EVERY EXIT ANSWERS — the same rule as loadMapFromFile. onFail covers the silent falsy-file
// return as well as a decode failure, and taking it means the CALLER reports the failure.
function loadVideoFromFile(file, onVideoLoaded, onFail) {
  const bail = reason => {
    if (onFail) onFail(reason);
    else messageDialog({
      title: 'Animated map would not play',
      message: 'Evermist could not read this video. WebM and MP4 are the safe choices.',
    });
  };
  if (!file) { bail('is not a file Evermist can read.'); return; }
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
    bail('could not be played. WebM and MP4 are the safe choices.' + (reason ? ' ' + reason : ''));
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
      bindVideoFrameTexture(extractCanvas, vw, vh);
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

// ─── Diagnostics (DM toggles with backtick `; the Player's is opened by the rig) ──
// Kept for video-stall investigation. The overlay only appears on backtick and the stress rig only
// runs under ?stress=1; disk logging is always on during playback, rotated and capped.
var _diagActive   = false;
var _diagEl       = null;
var _diagInterval = null;
var _diagLog      = [];   // ring buffer, newest appended last; disk log is unbounded
var _diagT0       = null; // perf timestamp of first event
var _diagPrevRS   = -1;   // detect readyState changes between polls

// Resolved once on first use. 'dm' or 'player' — the mode tag for disk log filenames.
// ⚠ _diagT0 resets on toggle, so the +Ns stamp is not monotonic; order by the wall-clock field.
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
    'loopAge=' + loopAge + '  RVFC=' + rvfc,
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
    // The same field guard input.js carries: a backtick typed into a room name or
    // description belongs in the field, not on the diagnostics overlay.
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.key === '`') _diagToggle();
  });
}

// ─── Export guard (Node require for tests; no-op in browser) ─────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    computeOptimalTextureSize, coverageFactorFor,
    mapRegionForTexture, clampRegionToMap,
  };
}
