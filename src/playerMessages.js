'use strict';
// playerMessages.js — one handler per message the DM sends; a map payload goes to playerMap.js.

function initPlayerMessages() {
  window.addEventListener('message', e => {
    const msg = e.data;
    if (!msg) return;
    startPlayerMapRetryOnce();   // anything from the DM means it is holding this window

    if (msg.type === 'fog-color') { handleFogColorMessage(msg); return; }
    if (msg.type === 'anim-params') { applyPlayerAnimParams(msg); return; }
    if (msg.type === 'scene-transition') { applyPlayerSceneTransition(msg); return; }
    // ⚠ A pre-warmed window's PLAYER_READY was dropped — the DM was not holding it yet.
    if (msg.type === 'player-hello') {
      if (playerReplyTarget()) playerReplyTarget().postMessage({
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

    if (msg.type === 'fog-update') applyFogUpdate(msg);
  });
}

function applyPlayerAnimParams(msg) {
  fogAnimSpeed      = msg.fogAnimSpeed      ?? fogAnimSpeed;
  driftScale        = msg.driftScale        ?? driftScale;
  cloudFrameSpeed   = msg.cloudFrameSpeed   ?? cloudFrameSpeed;
  alphaPulseAmp     = msg.alphaPulseAmp     ?? alphaPulseAmp;
  // ⚠ COMPARE, NEVER JUST CHECK THE FIELDS ARE PRESENT. Every scene load carries warp numbers the
  // Player already has, and rebuilding all sixteen cloud frames on each one is the freeze on
  // opening the Player and on every switch. A column applies the same set in paneRuntime.js.
  const warpChanged = (msg.cloudWarpStrength != null && msg.cloudWarpStrength !== cloudWarpStrength)
                   || (msg.cloudWarpRadius   != null && msg.cloudWarpRadius   !== cloudWarpRadius);
  if (warpChanged) {
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
}

function applyPlayerSceneTransition(msg) {
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
}
