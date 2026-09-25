'use strict';
// playerMap.js — a map payload landing on the Player: the cover that hides the swap, the fog mask
// behind it, and the image or video the players end up looking at.

// _playerVideoGen bails a blob read that resolved after a newer switch. _playerPendingVideo is
// the <video> still loading, which ⚠ cleanupVideo() CANNOT SEE: a push overtaking it revokes the
// blob URL under an element still reading it, and Chromium reports net::ERR_FILE_NOT_FOUND while
// the newer push paints its own map. Stop that load first, then let cleanupVideo revoke.
var _playerVideoGen = 0;
var _playerPendingVideo = null;

function dropPendingPlayerVideo() {
  const v = _playerPendingVideo;
  _playerPendingVideo = null;
  if (!v) return;
  v.onerror = null; v.oncanplay = null; v.onseeked = null;
  v.pause();
  // removeAttribute + load(), never src = '': an empty src sends the element after the document.
  v.removeAttribute('src');
  v.load();
  if (v.parentNode) v.parentNode.removeChild(v);
}

function applyFogUpdate(msg) {
  if (msg.pickedHex) handleFogColorMessage({ pickedHex: msg.pickedHex, fogTintAlpha: msg.fogTintAlpha });
  // (retry loop in initPlayerMapRetry stops itself when mapOffscreen is set — no timer to clear)

  // Stay dark until map and fog are decoded and a render is queued, or the players see the old
  // scene or a half-applied fog. A first open has no 'out' phase, so the map would flash fog-less;
  // cover it the way a scene switch does, instantly, and let revealPlayer() ease it back.
  if (msg.mapUrl && fogCoverT < 1) {
    // The DM holds this payload back until the close has had its time, so normally this does
    // nothing. ⚠ If the cover has not landed, finish it NOW: everything below rewrites the map
    // size and camera, and doing that under a half-closed cover shows the swap.
    const fade = document.getElementById('scene-fade');
    fade.style.transition = 'none';
    fade.classList.toggle('blind', !(fogDataCanvas && cloudPattern));
    snapFogCover(1);              // also cancels the close, so the hold is stamped here
    fade.classList.add('dark');
    _sceneFadeStart = Date.now();
    void fade.offsetWidth;        // force reflow so the instant cover "sticks"
    fade.style.transition = '';   // restore so revealPlayer's removal animates
  }
  // ⚠ THE CARD IS THE LOADING STATE and sits ABOVE the cover (overlays.css). It holds through the
  // first map's decode; onPlayerMapShown() takes it down once the map is on screen.
  if (mapOffscreen) landing.style.display = 'none';
  else if (msg.mapUrl) startLoadingFog();

  if (msg.view) lastDMView = msg.view;

  // Freeze the fog BEFORE anything the cloud transform reads changes. mapWidth is the first
  // of them; fitToScreen's camera and the new fogDataCanvas follow further down.
  if (msg.mapUrl && fogCoverT >= 1) freezeCloudTransform();

  mapWidth  = msg.mapWidth;
  mapHeight = msg.mapHeight;
  // Effects arrive as the polygon records themselves, so there is nothing to convert. ⚠ An empty
  // list is meaningful, which is why this checks for undefined rather than truthiness.
  if (msg.effects !== undefined) setEffects(msg.effects);
  if (msg.gridEnabled !== undefined) {
    gridEnabled   = msg.gridEnabled;
    gridSize      = msg.gridSize      || gridSize;
    gridOffsetX   = msg.gridOffsetX   ?? gridOffsetX;
    gridOffsetY   = msg.gridOffsetY   ?? gridOffsetY;
    gridColor     = msg.gridColor     || gridColor;
    gridOpacity   = msg.gridOpacity   ?? gridOpacity;
    gridMode      = msg.gridMode      || gridMode;
    gridLineWidth = msg.gridLineWidth ?? gridLineWidth;
    gridDirty   = true;
  }

  // revealPlayer() is defined in scenes.js — enforces SCENE_FADE_MIN_MS floor then lifts the cover.
  if (msg.mapUrl && msg.mapType === 'video') { startPlayerVideoMap(msg); return; }
  if (msg.mapUrl) { startPlayerImageMap(msg); return; }
  applyPlayerFogOnly(msg);
}

// skipTransition: scene switches must not blend old fog into new — show new state directly.
function loadPlayerFog(msg, skipTransition) {
  return new Promise(resolve => {
    const img = new Image();
    img.onerror = () => resolve();
    img.onload = () => {
      // BOTH dimensions, never the width alone: two maps can share a width and differ in
      // height, and the kept canvas then squashes the incoming mask into the old aspect.
      if (!fogDataCanvas ||
          fogDataCanvas.width  !== Math.ceil(mapWidth  / FOG_SCALE) ||
          fogDataCanvas.height !== Math.ceil(mapHeight / FOG_SCALE)) {
        fogDataCanvas = document.createElement('canvas');
        fogDataCanvas.width  = Math.ceil(mapWidth  / FOG_SCALE);
        fogDataCanvas.height = Math.ceil(mapHeight / FOG_SCALE);
        fogDataCtx = fogDataCanvas.getContext('2d');
      }
      fogDataCtx.clearRect(0, 0, fogDataCanvas.width, fogDataCanvas.height);
      fogDataCtx.drawImage(img, 0, 0, fogDataCanvas.width, fogDataCanvas.height);
      if (!cloudPattern) generateCloudFrames(512, CLOUD_FRAME_COUNT);
      if (!skipTransition && msg.fogChanged) startFogTransition(!!msg.isShroud);
      rebuildFogEffect();
      // Now this scene has a cloud pattern, the flat blind hands over to real fog, which is what
      // gets the session's first map onto fog instead of navy. The cover is already at 1, so only
      // what draws it changes.
      // ⚠ GATED ON A TRANSITION BEING UP: every ordinary fog update lands here too, and touching
      // the cover on those blanks the players' screen mid-game.
      const fadeEl = document.getElementById('scene-fade');
      if (fadeEl.classList.contains('dark') && fogDataCanvas && cloudPattern) {
        fadeEl.classList.remove('blind');
      }
      startFogAnim();
      // The cloud transform stays PINNED here. It is re-anchored onto the new scene at the
      // end of the hold at full fog, one frame before the reveal — see openFogFromCover().
      resolve();
    };
    img.src = msg.fogDataUrl;
  });
}

function startPlayerVideoMap(msg) {
  dropPendingPlayerVideo();
  cleanupVideo();

  // ⚠ Play from a PRIVATE in-memory copy of the clip, never the file:// path the DM is already
  // streaming. Two <video> elements on one file starve Chromium's media pipeline and both
  // windows stall. Falls back to the shared URL if the in-memory read fails.
  const _gen = ++_playerVideoGen;

  const beginPlayerVideo = (srcUrl) => {
    if (_gen !== _playerVideoGen) {          // a newer scene switch superseded this
      if (srcUrl && srcUrl.startsWith('blob:')) URL.revokeObjectURL(srcUrl);
      return;
    }
    mapVideoUrl = srcUrl;
    const video = createPlayerVideoElement(container);
    _playerPendingVideo = video;
    let settled = false;
    video.onerror = () => {
      if (settled) return;
      settled = true;
      if (_playerPendingVideo === video) _playerPendingVideo = null;
      video.onerror = null; video.oncanplay = null;
      video.pause(); video.src = '';
      if (video.parentNode) video.parentNode.removeChild(video);
      cleanupVideo(); revealPlayer();
    };
    video.oncanplay = function() {
      if (settled) return;
      settled = true;
      video.onerror = null; video.oncanplay = null;

      function finishPlayerVideo() {
        const extractCanvas = document.createElement('canvas');
        extractCanvas.width = mapWidth; extractCanvas.height = mapHeight;
        extractCanvas.getContext('2d').drawImage(video, 0, 0, mapWidth, mapHeight);
        if (mapBitmap) { mapBitmap.close(); mapBitmap = null; }
        mapOffscreen = extractCanvas;
        // mapVideo has to be live before the texture is built: both
        // initPlayerMapRegionTexture and the sync tick read it.
        // ⚠ Pending ends HERE, not at oncanplay: the seek above still reads the source.
        if (_playerPendingVideo === video) _playerPendingVideo = null;
        mapVideo = video;
        // Refresh from the video every rendered frame, driven by the PixiJS render
        // ticker so it never freezes between viewport changes.
        var _texVideoTime = -1, _texPanX = NaN, _texPanY = NaN, _texZoom = NaN;
        pixiStartVideoTextureSync(function() {
          if (!mapVideo || !playerMapTexCtx || mapVideo.readyState < 2) return;
          var t = mapVideo.currentTime;
          // Pan and zoom join the dedup key, because the texture holds a region: on a paused
          // video the frame never advances and the map would go stale under a moving camera.
          if (t === _texVideoTime && panX === _texPanX && panY === _texPanY && zoom === _texZoom) return;
          _texVideoTime = t; _texPanX = panX; _texPanY = panY; _texZoom = zoom;
          refreshPlayerMapRegion();
        });
        attachVideoListeners(video);
        fitToScreen();
        if (playerFollowDM && msg.view) applyView(msg.view);
        reportPlayerView();
        // After the camera is settled, so the first texture holds the region the players will
        // see. Viewport-sized, never map-sized — the same cost on any map, and that figure is
        // also the per-frame GPU upload.
        initPlayerMapRegionTexture();
        loadPlayerFog(msg, !!msg.sceneChange).then(() => {
          // loadFog already ran rebuildFogEffect(), which syncs the fog pass to the GPU.
          viewportDirty = true;
          scheduleRender();
          video.play().then(() => startVideoLoop()).catch(() => {});
          revealPlayer();
        });
      }

      video.onseeked = function() { video.onseeked = null; finishPlayerVideo(); };
      video.currentTime = 0.001;
      setTimeout(() => { if (video.onseeked) { video.onseeked = null; finishPlayerVideo(); } }, 2000);
    };
    video.src = srcUrl;
  };

  if (window.electronAPI && window.electronAPI.readVideoFile && msg.mapSceneId) {
    const _mime = /\.mp4(\?|$)/i.test(msg.mapUrl) ? 'video/mp4' : 'video/webm';
    window.electronAPI.readVideoFile(msg.mapSceneId).then(function(buf) {
      if (buf) {
        // The DM's own URL goes UNUSED here, and for a legacy scene it is a blob: URL holding
        // the whole video. Nothing else releases it, so it is released at this one moment the
        // Player knows it will not be read.
        if (/^blob:/.test(msg.mapUrl)) URL.revokeObjectURL(msg.mapUrl);
        beginPlayerVideo(URL.createObjectURL(new Blob([buf], { type: _mime })));
      } else {
        beginPlayerVideo(msg.mapUrl);   // read failed — fall back to the shared file
      }
    }).catch(function() { beginPlayerVideo(msg.mapUrl); });
  } else {
    beginPlayerVideo(msg.mapUrl);
  }
}

function startPlayerImageMap(msg) {
  dropPendingPlayerVideo();
  cleanupVideo();
  // ⚠ THE FOG WAITS FOR THE MAP. Starting both decodes together saves a few tens of ms and
  // costs correctness: a map that fails to decode leaves the previous one on screen, and the
  // incoming scene's reveals would be punched into it - ground the players must not see.
  const img = new Image();
  img.onerror = () => { URL.revokeObjectURL(msg.mapUrl); revealPlayer(); };
  img.onload = () => {
    mapOffscreen = document.createElement('canvas');
    mapOffscreen.width  = mapWidth;
    mapOffscreen.height = mapHeight;
    mapOffscreen.getContext('2d').drawImage(img, 0, 0);
    URL.revokeObjectURL(msg.mapUrl);
    if (mapBitmap) { mapBitmap.close(); mapBitmap = null; }
    pixiSetMap(prepareTextureCanvas(mapOffscreen, mapWidth, mapHeight), mapWidth, mapHeight);
    fitToScreen();
    if (playerFollowDM && msg.view) applyView(msg.view);
    reportPlayerView();
    loadPlayerFog(msg, !!msg.sceneChange).then(() => {
      viewportDirty = true;
      scheduleRender();
      revealPlayer();
    });
  };
  img.src = msg.mapUrl;
}

function applyPlayerFogOnly(msg) {
  if (playerFollowDM && msg.view) { applyView(msg.view); reportPlayerView(); }
  loadPlayerFog(msg, !!msg.sceneChange).then(() => {
    viewportDirty = true;
    scheduleRender();
    revealPlayer();
  });
}
