'use strict';

// video.js — display-aware texture sizing for PixiJS map rendering.
// Loaded after state.js (reads displayInfo) and before the inline blob.
// Extracted from the blob per CLAUDE.md migrate-on-touch policy.

// ─── Design constants ────────────────────────────────────────────────────────
// targetLong = max(dispW, dispH) * coverage → how many real map pixels the texture
// carries along its long axis. Coverage IS zoom headroom: 3 means "1/3 of the map fills
// the screen at 1:1", so the view stays crisp up to 3× the fit-to-screen zoom.
//
// The two views get different headroom because they are used differently:
//   DM     — zooms in to draw rooms, so it keeps the full 3×.
//   Player — shows the whole map at the table, and its texture is redrawn from the video
//            and re-uploaded to the GPU every frame on an animated map, so the area is a
//            per-frame cost and not just a resident one.
//
// 2 rather than a tighter 1.5, deliberately: a map at or under 2× the Player's screen is
// then left at its own resolution and nothing about it changes, which covers the ordinary
// map. The saving is meant to land on the oversized export, where it more than halves both
// the texture and the per-frame upload.
var COVERAGE_FACTOR        = 3;
var PLAYER_COVERAGE_FACTOR = 2;

// Pure: zoom headroom for this view. Exported for tests.
function coverageFactorFor(isPlayerView) {
  return isPlayerView ? PLAYER_COVERAGE_FACTOR : COVERAGE_FACTOR;
}

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
    // ⚠ NOT DEAD, AND NOT A ROLLBACK LEVER. displayInfo is null until main.js pushes it, so a
    // map loaded in the first moments of a session lands here — the old ~2× viewport heuristic
    // is the only sizing available before the Player's screen is known. computeOptimalTextureSize
    // would return the source size untouched in that case, which is a far larger texture.
    // onDisplayInfoUpdated re-sizes it properly the moment the display is reported.
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
// The Player used to hold a texture the size of the whole (display-scaled) map and redraw
// ALL of it from the video every frame — 90.7 MB resident and 90.7 MB of GPU upload thirty
// times a second on the 12900×11700 map. A texture sized to the Player's own screen is
// ~15 MB on a 2560×1392 TV whatever the map's resolution, and it is resolution-correct at
// every zoom by construction, because it carries one texel per screen pixel.
//
// The texture covers the viewport GROWN BY A MARGIN, converted to map units — deliberately
// not visibleMapRegion(), which is the viewport intersected with the map and therefore
// shrinks as you pan to an edge. A shrinking region drawn into a fixed canvas would change
// the texel-per-pixel ratio with the camera. This one holds it constant, and gives a second
// property worth more: the sprite it feeds always lands on exactly the same screen
// rectangle, so pan and zoom introduce no sub-pixel drift between the map and the fog.
//
// The margin is insurance for the screen border — float error and a resize handler that
// runs a frame late — not headroom for panning; the region is recomputed every frame.
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

// Pure: clamp a map-space region to the map and give the matching destination rect inside
// the texture canvas, so drawImage is never handed a source rect outside the video frame.
// `clear` reports that the region overhangs the map, i.e. the canvas has pixels the draw
// will not cover, which would otherwise keep the previous frame's content.
// Returns null when the region misses the map entirely.
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

// Allocate the region canvas from the viewport, once. Called at video load, on window
// resize and on a display change — never per frame, and never on pan or zoom, which is
// the whole point: the allocation is fixed and only its CONTENT follows the camera.
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

// Point PixiJS at the region canvas. pixiSetMap is given the CANVAS dimensions rather than
// the map's, so its MAX_TEXTURE_SIZE clamp can never fire on a viewport-sized canvas and
// rescale it; pixiSetMapRegion then puts the sprite where the region actually is.
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

// Restore the clamp the region texture gives up. The old full-map texture ENDED at the map
// edge, so the GPU clamped there and the boundary was hard. A region texture puts that edge
// inside the canvas with transparent pixels beyond it, and LINEAR sampling fades the
// outermost pixel toward nothing — a dark rim along the map border, which is the one thing
// the hybrid fog architecture cannot tolerate. Stretching the edge row and column one pixel
// outward gives the sampler real content to blend with, the same as clamping would.
//
// Only runs when the region overhangs the map, i.e. zoomed out or panned against an edge.
// FOG_EDGE_MARGIN hides this band at play zoom, but only ~2 screen px at fit-to-screen —
// too thin to rely on.
//
// It reads the VIDEO, not the canvas: drawing a canvas onto itself forces a readback of its
// backing store, measured at 0.185 ms/frame, which is more than the draw it protects. The
// video is already this frame's source, so re-reading a strip of it is nearly free.
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
// The two views need OPPOSITE things here, which is why this is one function and not an
// inlined pair of calls at three call sites.
//
// DM: the map is a CSS-composited DOM <video>, and the PixiJS sprite is hidden the instant it
// is created — `pixiHideMap` only sets visible=false, so the texture stayed on the GPU for the
// whole scene. The only path that could show it again (`deactivateVideoDom`) runs from
// `cleanupVideo`, i.e. during teardown, so it never drew. Clear the layer instead.
//
// Player: the sprite IS how the map is drawn, so it keeps one. This first texture is superseded
// by the viewport-sized region texture a moment later, and that ordering is load-bearing — see
// `initPlayerMapRegionTexture` and the warning in `onDisplayInfoUpdated`.
function bindVideoFrameTexture(frameCanvas, w, h) {
  if (typeof isPlayer !== 'undefined' && !isPlayer) { pixiClearMap(); return; }
  pixiSetMap(prepareTextureCanvas(frameCanvas, w, h), w, h);
  pixiHideMap();
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

  // Player animated map: the texture is sized from the Player's own viewport, so a display
  // change has no sizing to redo. Re-point PixiJS at the region canvas and stop.
  // Falling through would destroy the region sprite and rebuild a full-map one at 0,0 —
  // silently undoing this on the exact workflow this function exists for
  // ("connect TV → open Player → slide Player to TV").
  if (typeof isPlayer !== 'undefined' && isPlayer
      && typeof mapVideo !== 'undefined' && mapVideo) {
    initPlayerMapRegionTexture();
    return;
  }

  // DM animated map: there is no sizing to redo either, because the map is the DOM <video> and
  // this view holds no map sprite at all (bindVideoFrameTexture). Clearing rather than falling
  // through is what stops a display change re-uploading the texture that was just removed.
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

// The per-frame loop. NEITHER VIEW DRAWS ITS MAP FROM HERE: the DM's map is the composited DOM
// <video>, and the Player's texture rides the PixiJS ticker (pixiStartVideoTextureSync). What the
// scheduleRender below is actually for is `syncVideoDomTransform`, which doRender runs whenever
// videoDOMActive — and videoFrameIntervalMs is what keeps that to 24 a second.
//
// The loop is also the watchdog's liveness signal: a null id is how a dead pump is noticed and
// restarted. It is part of the rs=2 stall fix and DECISIONS.md keeps every piece of that.
//
// No requestAnimationFrame fallback: requestVideoFrameCallback has been on HTMLVideoElement in
// every engine this app can run on for years, and the fallback's own guards had drifted out of
// step with this branch's.
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
  // Start the RVFC/RAF loop immediately. onVideoPlaying cannot start it because
  // the 'playing' event fires before videoEnabled=true (set above), so the loop
  // would never run without this explicit kick-off.
  scheduleVideoFrame();
  startVideoWatchdog();
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
  _playerRegionBound = null;
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
    messageDialog({
      title: 'Animated map would not play',
      message: 'Evermist could not read this video. WebM and MP4 are the safe choices.'
             + (reason ? '\n\n' + reason : ''),
    });
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
