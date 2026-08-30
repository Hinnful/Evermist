'use strict';
// Player-mode runtime: cloud-texture pre-gen, the PLAYER_READY handshake, resize, the DM message
// handler and player pan/zoom. Called once from index.html in player mode.

// Bumped on every video-scene load so an async blob read that resolves after a
// newer scene switch can detect it was superseded and bail out (no orphan <video>).
var _playerVideoGen = 0;

// ⚠ STARTS ON THE DM'S FIRST WORD, NEVER AT INIT. A pre-warmed window sits unheld until the button
// is pressed; a retry running through that lands a `need-map` the DM accepts on adoption, which
// re-sends the whole map mid-session and blanks the fog the players are looking at.
var _playerRetryStarted = false;
function startPlayerMapRetryOnce() {
  if (_playerRetryStarted) return;
  _playerRetryStarted = true;
  initPlayerMapRetry();   // viewport.js: need-map to the DM until a map arrives
}

// The card's backdrop while the first map decodes: the app's own fog, drifting. Its own loop,
// because the render pipeline has no map to draw and does nothing on these frames.
var _loadingFogRaf = null;
function startLoadingFog() {
  if (_loadingFogRaf || !landing) return;
  landing.classList.add('loading');
  startFogAnim();   // fog.js: what advances the drift and morph this reads
  const cv = document.getElementById('landing-fog');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const tick = () => {
    const w = landing.clientWidth, h = landing.clientHeight;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    drawLoadingFog(ctx, w, h);
    _loadingFogRaf = requestAnimationFrame(tick);
  };
  _loadingFogRaf = requestAnimationFrame(tick);
}

// Called from revealPlayer() when the cover lifts. ⚠ THE LOOP AND THE LOADING LINE STOP EVEN WITH
// NO MAP: the error paths reveal too, and a first map that never decodes would otherwise leave the
// TV reading "Loading map…" for the session with a full-screen repaint running behind it. The card
// itself only goes when there IS a map, because with none it is the correct empty state.
function onPlayerMapShown() {
  if (!landing) return;
  if (_loadingFogRaf) { cancelAnimationFrame(_loadingFogRaf); _loadingFogRaf = null; }
  landing.classList.remove('loading');
  if (mapOffscreen) landing.style.display = 'none';
}

function initPlayer() {
  fogAnimEnabled = true; // player view always animates

  // Pre-generate the cloud texture while the player sits on the idle screen. The first
  // generateCloudFrames() blocks for a second or two, and doing it lazily inside loadFog shows
  // the players a fully-revealed map until it finishes.
  generateCloudFrames(512, CLOUD_FRAME_COUNT);

  if (window.opener) window.opener.postMessage({
    type: 'PLAYER_READY', screenW: window.innerWidth, screenH: window.innerHeight,
  }, '*');


  // Relay this window's fullscreen state to the DM. It is native window fullscreen, driven
  // from main.js, so this window has nothing to read it from either — main pushes it here.
  if (window.electronAPI && window.electronAPI.onFullscreenState) {
    window.electronAPI.onFullscreenState((data) => {
      if (!window.opener) return;
      window.opener.postMessage({
        type: 'PLAYER_FULLSCREEN', fullScreen: !!(data && data.fullScreen),
      }, '*');
    });
  }

  window.addEventListener('resize', () => {
    syncSize();
    if (window.opener) window.opener.postMessage({
      type: 'PLAYER_SCREEN', screenW: window.innerWidth, screenH: window.innerHeight,
    }, '*');
    if (mapBitmap || mapOffscreen) {
      if (playerFollowDM && lastDMView) applyView(lastDMView);
      else fitToScreen();
      // The animated-map texture is sized from the viewport, so this is the one event
      // that has to reallocate it. Pan and zoom must not, and do not.
      if (mapVideo) initPlayerMapRegionTexture();
      viewportDirty = true;
      scheduleRender();
    }
  });

  window.addEventListener('message', e => {
    const msg = e.data;
    if (!msg) return;
    startPlayerMapRetryOnce();   // anything from the DM means it is holding this window

    if (msg.type === 'fog-color') { handleFogColorMessage(msg); return; }

    if (msg.type === 'anim-params') {
      fogAnimSpeed      = msg.fogAnimSpeed      ?? fogAnimSpeed;
      driftScale        = msg.driftScale        ?? driftScale;
      cloudFrameSpeed   = msg.cloudFrameSpeed   ?? cloudFrameSpeed;
      alphaPulseAmp     = msg.alphaPulseAmp     ?? alphaPulseAmp;
      if (msg.cloudWarpStrength != null || msg.cloudWarpRadius != null) {
        cloudWarpStrength = msg.cloudWarpStrength ?? cloudWarpStrength;
        cloudWarpRadius   = msg.cloudWarpRadius  ?? cloudWarpRadius;
        generateCloudFrames(512, CLOUD_FRAME_COUNT);
        cloudFramePos = 0;
        rebuildFogEffect();
      }
      fogAnimEnabled        = msg.fogAnimEnabled        ?? fogAnimEnabled;
      fogDirty = true;
      scheduleRender();
      if (fogAnimEnabled) startFogAnim(); else stopFogAnim();
      return;
    }

    if (msg.type === 'scene-transition') {
      if (msg.phase === 'out') {
        const fade = document.getElementById('scene-fade');
        // Marks the switch as landed: .dark tells an ordinary fog update from a switch in
        // progress, and the stamp starts the hold at full fog. Both belong to the moment the
        // cover completes, never to the start of the close.
        const covered = () => {
          fade.classList.add('dark');
          _sceneFadeStart = Date.now();
        };
        // Close the fog over the outgoing map. Only when there is no fog to close (nothing
        // loaded yet) does the flat blind stand in, and then there is nothing to wait for.
        if (closeFogOverMap(covered)) {
          fade.classList.remove('blind');
        } else {
          fade.classList.add('blind');
          snapFogCover(1);
          covered();
        }
      } else if (msg.phase === 'tint') {
        // The incoming scene's fog colour, sent ahead of its map. Eased into over what is
        // left of the close, so the colour change happens inside thickening fog.
        startFogColorEase(msg.pickedHex);
      }
      return;
    }

    // ⚠ A pre-warmed window's PLAYER_READY was dropped — the DM was not holding it yet.
    if (msg.type === 'player-hello') {
      if (window.opener) window.opener.postMessage({
        type: 'PLAYER_READY', screenW: window.innerWidth, screenH: window.innerHeight,
      }, '*');
      return;
    }

    if (msg.type === 'player-lock') { playerInputLocked = msg.locked; return; }


    if (msg.type === 'view-snap') {
      playerFollowDM = true;
      notifyDMOfMode();
      if (mapOffscreen) startViewLerp(resolveView(msg));
      return;
    }

    if (msg.type === 'fullscreen') {
      if (window.electronAPI) window.electronAPI.toggleFullscreen();
      else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else document.documentElement.requestFullscreen().catch(() => {});
      return;
    }

    if (msg.type !== 'fog-update') return;
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

    // skipTransition: scene switches must not blend old fog into new — show new state directly.
    const loadFog = (src, skipTransition) => new Promise(resolve => {
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
      img.src = src;
    });

    if (msg.mapUrl && msg.mapType === 'video') {
      // Video scene — create a <video> element on Player side.
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
        let settled = false;
        video.onerror = () => {
          if (settled) return;
          settled = true;
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
            // After the camera is settled, so the first texture holds the region the players will
            // see. Viewport-sized, never map-sized — the same cost on any map, and that figure is
            // also the per-frame GPU upload.
            initPlayerMapRegionTexture();
            loadFog(msg.fogDataUrl, !!msg.sceneChange).then(() => {
              // Hybrid: Player fog is Canvas-2D (renderFog) on top of the PixiJS map — no
              // PixiJS fog init. loadFog already ran rebuildFogEffect()+startFogAnim().
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
    } else if (msg.mapUrl) {
      // Image scene
      cleanupVideo();
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
        loadFog(msg.fogDataUrl, !!msg.sceneChange).then(() => {
          // Hybrid: Player fog is Canvas-2D (renderFog) on top of the PixiJS map — no
          // PixiJS fog init. loadFog already ran rebuildFogEffect()+startFogAnim().
          viewportDirty = true;
          scheduleRender();
          revealPlayer();
        });
      };
      img.src = msg.mapUrl;
    } else {
      if (playerFollowDM && msg.view) applyView(msg.view);
      loadFog(msg.fogDataUrl, !!msg.sceneChange).then(() => {
        viewportDirty = true;
        scheduleRender();
        revealPlayer();
      });
    }
  });

  // Player pan/zoom (free-look)
  let playerIsPanning = false;
  let playerPanStartX, playerPanStartY, playerPanStartPanX, playerPanStartPanY;
  let _playerViewThrottleTs = 0;
  function _postPlayerView() {
    const now = performance.now();
    if (now - _playerViewThrottleTs < 100) return;
    _playerViewThrottleTs = now;
    if (!window.opener) return;
    const { w: vpW, h: vpH } = getViewportSize();
    window.opener.postMessage({
      type: 'PLAYER_VIEW',
      mapCX: (vpW / 2 - panX) / zoom,
      mapCY: (vpH / 2 - panY) / zoom,
      zoom,
    }, '*');
  }

  container.addEventListener('mousedown', e => {
    if (playerInputLocked) return;
    if (!mapOffscreen) return;
    playerIsPanning = true;
    playerPanStartX = e.clientX; playerPanStartY = e.clientY;
    playerPanStartPanX = panX;   playerPanStartPanY = panY;
    e.preventDefault();
  });

  container.addEventListener('mousemove', e => {
    if (playerInputLocked) return;
    if (!playerIsPanning || !mapOffscreen) return;
    const dx = e.clientX - playerPanStartX;
    const dy = e.clientY - playerPanStartY;
    if (playerFollowDM && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
      playerFollowDM = false;
      notifyDMOfMode();
    }
    panX = playerPanStartPanX + dx;
    panY = playerPanStartPanY + dy;
    if (!playerFollowDM) _postPlayerView();
    viewportDirty = true;
    scheduleRender();
  });

  window.addEventListener('mouseup', () => { playerIsPanning = false; });

  container.addEventListener('wheel', e => {
    e.preventDefault();
    if (playerInputLocked) return;
    if (!mapOffscreen) return;
    const factor  = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
    const newZoom = Math.max(0.02, Math.min(20, zoom * factor));
    const rect    = container.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    panX = mx - (mx - panX) * (newZoom / zoom);
    panY = my - (my - panY) * (newZoom / zoom);
    zoom = newZoom;
    if (playerFollowDM) {
      playerFollowDM = false;
      notifyDMOfMode();
    }
    _postPlayerView();
    viewportDirty = true;
    scheduleRender();
  }, { passive: false });

  initStress();
  initMemProbe();
}
