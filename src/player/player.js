'use strict';
// Player-mode runtime: the loading card, the PLAYER_READY handshake, resize, and player
// pan/zoom. Called once from index.html in player mode. The DM's messages are
// playerMessages.js's, and a map payload playerMap.js's.

// ⚠ STARTS ON THE DM'S FIRST WORD, NEVER AT INIT. A pre-warmed window sits unheld, and a retry
// through that lands a `need-map` the DM accepts on adoption, blanking the players' fog.
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
// NO MAP: the error paths reveal too, and a map that never decodes would leave the TV reading
// "Loading map…" all session. The card goes only when there IS a map.
function onPlayerMapShown() {
  if (!landing) return;
  if (_loadingFogRaf) { cancelAnimationFrame(_loadingFogRaf); _loadingFogRaf = null; }
  landing.classList.remove('loading');
  if (mapOffscreen) landing.style.display = 'none';
}

function initPlayer() {
  fogAnimEnabled = true; // player view always animates
  if (paneId) document.body.classList.add('stage-half');
  // ⚠ FOG ALONE: the card's text is hidden here (overlays.css), so a mapless Player needs this.
  if (!mapOffscreen) startLoadingFog();

  // Pre-generate the cloud texture while the player sits on the idle screen. The first
  // generateCloudFrames() blocks for a second or two, and doing it lazily inside loadFog shows
  // the players a fully-revealed map until it finishes.
  generateCloudFrames(512, CLOUD_FRAME_COUNT);

  if (playerReplyTarget()) playerReplyTarget().postMessage({
    type: 'PLAYER_READY', screenW: window.innerWidth, screenH: window.innerHeight,
  }, '*');

  // Relay this window's fullscreen state to the DM. It is native window fullscreen, driven
  // from main.js, so this window has nothing to read it from either — main pushes it here.
  if (window.electronAPI && window.electronAPI.onFullscreenState) {
    window.electronAPI.onFullscreenState((data) => {
      if (!playerReplyTarget()) return;
      playerReplyTarget().postMessage({
        type: 'PLAYER_FULLSCREEN', fullScreen: !!(data && data.fullScreen),
      }, '*');
    });
  }

  window.addEventListener('resize', () => {
    syncSize();
    if (playerReplyTarget()) playerReplyTarget().postMessage({
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
      // ⚠ THE MINIMAP CANNOT WORK THIS OUT: its zoom is px-per-map-unit on THIS canvas, so a
      // resize changes it and nothing else reports that. A divider drag resizes both halves.
      if (playerReplyTarget()) playerReplyTarget().postMessage({
        type: 'PLAYER_VIEW', mapCX: (getViewportSize().w / 2 - panX) / zoom,
        mapCY: (getViewportSize().h / 2 - panY) / zoom, zoom,
      }, '*');
    }
  });

  initPlayerMessages();

  // Player pan/zoom (free-look)
  let playerIsPanning = false;
  let playerPanStartX, playerPanStartY, playerPanStartPanX, playerPanStartPanY;
  let _playerViewThrottleTs = 0;
  function _postPlayerView() {
    const now = performance.now();
    if (now - _playerViewThrottleTs < 100) return;
    _playerViewThrottleTs = now;
    if (!playerReplyTarget()) return;
    const { w: vpW, h: vpH } = getViewportSize();
    playerReplyTarget().postMessage({
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
