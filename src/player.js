'use strict';
// Player-mode runtime: cloud-texture pre-gen, PLAYER_READY handshake, resize handler,
// DM message handler (map/fog/anim/scene-transition/view-snap/fullscreen), and player
// pan/zoom. Called once from index.html (player mode only), at the same point the
// original inline block used to run.

function initPlayer() {
  fogAnimEnabled = true; // player view always animates

  // Pre-generate the cloud texture now, while the player sits on the idle "waiting
  // for DM" screen. The first generateCloudFrames() call blocks for ~1–2s; doing it
  // lazily inside loadFog (on the first fog-update) meant the map had already been
  // shown by PixiJS, so players briefly saw a fully-revealed, fog-less map until the
  // texture finished. Paying the cost up-front closes that gap.
  generateCloudFrames(512, CLOUD_FRAME_COUNT);

  if (window.opener) window.opener.postMessage({ type: 'PLAYER_READY' }, '*');

  initPlayerMapRetry(); // viewport.js: send need-map to DM, retry until map received

  window.addEventListener('resize', () => {
    syncSize();
    if (mapBitmap || mapOffscreen) {
      if (playerFollowDM && lastDMView) applyView(lastDMView);
      else fitToScreen();
      viewportDirty = true;
      scheduleRender();
    }
  });

  window.addEventListener('message', e => {
    const msg = e.data;
    if (!msg) return;

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
      videoFrameIntervalMs  = msg.videoFrameIntervalMs  ?? videoFrameIntervalMs;
      fogDirty = true;
      scheduleRender();
      if (fogAnimEnabled) startFogAnim(); else stopFogAnim();
      return;
    }

    if (msg.type === 'scene-transition') {
      if (msg.phase === 'out') {
        document.getElementById('scene-fade').classList.add('dark');
        _sceneFadeStart = Date.now();
        if (msg.sceneName) {
          const nameEl = document.getElementById('scene-fade-name');
          if (nameEl) nameEl.textContent = msg.sceneName;
        }
      }
      return;
    }

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

    // Don't reveal yet — keep scene-fade dark until map + fog are fully decoded and render is queued.
    // This prevents players from seeing the old scene or a partially-applied fog during the transition.
    // First open has no scene-transition 'out' phase to black out the screen, so the map (painted
    // immediately by PixiJS) would flash fog-less before the Canvas-2D fog is ready. Cover it the same
    // way a scene switch does — instantly (transition disabled) so the map can't peek during a fade-in.
    // revealPlayer() removes .dark with the normal 0.5s ease once map+fog have rendered.
    if (msg.mapUrl) {
      const fade = document.getElementById('scene-fade');
      fade.style.transition = 'none';
      fade.classList.add('dark');
      _sceneFadeStart = Date.now();
      void fade.offsetWidth;        // force reflow so the instant black "sticks"
      fade.style.transition = '';   // restore so revealPlayer's removal animates
    }
    landing.style.display = 'none';

    if (msg.view) lastDMView = msg.view;

    mapWidth  = msg.mapWidth;
    mapHeight = msg.mapHeight;
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

    if (msg.sceneName) {
      const nameEl = document.getElementById('scene-fade-name');
      if (nameEl) nameEl.textContent = msg.sceneName;
    }

    // revealPlayer() is defined in scenes.js — enforces SCENE_FADE_MIN_MS floor then lifts the cover.

    // skipTransition: scene switches must not blend old fog into new — show new state directly.
    const loadFog = (src, skipTransition) => new Promise(resolve => {
      const img = new Image();
      img.onerror = () => resolve();
      img.onload = () => {
        if (!fogDataCanvas || fogDataCanvas.width !== Math.ceil(mapWidth / FOG_SCALE)) {
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
        startFogAnim();
        resolve();
      };
      img.src = src;
    });

    if (msg.mapUrl && msg.mapType === 'video') {
      // Video scene — create a <video> element on Player side
      cleanupVideo();
      mapVideoUrl = msg.mapUrl;
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
          // Size the texture to the detected display (display-aware, TDR-safe).
          // prepareTextureCanvas reads displayInfo from state.js and falls back to
          // the old ~2× viewport heuristic when displayInfo is not yet available.
          playerMapTexCanvas = prepareTextureCanvas(extractCanvas, mapWidth, mapHeight);
          playerMapTexCtx = playerMapTexCanvas.getContext('2d');
          pixiSetMap(playerMapTexCanvas, mapWidth, mapHeight);
          // Refresh the map texture from the video every rendered frame, driven by
          // the PixiJS render ticker so it never freezes between viewport changes.
          var _texVideoTime = -1;
          pixiStartVideoTextureSync(function() {
            if (!mapVideo || !playerMapTexCtx || mapVideo.readyState < 2) return;
            var t = mapVideo.currentTime;
            if (t === _texVideoTime) return; // same frame — skip redundant GPU upload
            _texVideoTime = t;
            playerMapTexCtx.drawImage(mapVideo, 0, 0, playerMapTexCanvas.width, playerMapTexCanvas.height);
            pixiUpdateMapTexture();
          });
          mapVideo = video;
          attachVideoListeners(video);
          fitToScreen();
          if (playerFollowDM && msg.view) applyView(msg.view);
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
      video.src = msg.mapUrl;
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

  container.addEventListener('mousedown', e => {
    if (!mapOffscreen) return;
    playerIsPanning = true;
    playerPanStartX = e.clientX; playerPanStartY = e.clientY;
    playerPanStartPanX = panX;   playerPanStartPanY = panY;
    e.preventDefault();
  });

  container.addEventListener('mousemove', e => {
    if (!playerIsPanning || !mapOffscreen) return;
    const dx = e.clientX - playerPanStartX;
    const dy = e.clientY - playerPanStartY;
    if (playerFollowDM && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
      playerFollowDM = false;
      notifyDMOfMode();
    }
    panX = playerPanStartPanX + dx;
    panY = playerPanStartPanY + dy;
    viewportDirty = true;
    scheduleRender();
  });

  window.addEventListener('mouseup', () => { playerIsPanning = false; });

  container.addEventListener('wheel', e => {
    e.preventDefault();
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
    viewportDirty = true;
    scheduleRender();
  }, { passive: false });
}
