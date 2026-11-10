'use strict';
// playerMessages.js — one handler per message the DM sends; a map payload goes to playerMap.js.

function initPlayerMessages() {
  window.addEventListener('message', e => {
    const msg = e.data;
    if (!msg) return;
    startPlayerMapRetryOnce();   // anything from the DM means it is holding this window

    if (msg.type === 'fog-theme') { receivePlayerFogTheme(msg.theme, false); return; }
    if (msg.type === 'scene-clear') { applyPlayerSceneClear(); return; }
    if (msg.type === 'scene-transition') { applyPlayerSceneTransition(msg); return; }
    // ⚠ A pre-warmed window's PLAYER_READY was dropped — the DM was not holding it yet.
    if (msg.type === 'player-hello') {
      if (playerReplyTarget()) playerReplyTarget().postMessage({ type: 'PLAYER_READY', ...playerScreenReport() }, '*');
      return;
    }

    if (msg.type === 'ping') { showPing(msg.x, msg.y); return; }
    if (msg.type === 'tv-fit') { setPlayerTurn(msg.turn); return; }
    if (msg.type === 'weather') { applyWeatherMessage(msg); return; }
    if (msg.type === 'tv-picture') { applyTvPicture(msg.blob); return; }
    if (msg.type === 'companion') { companionSetOn(msg.on); return; }

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
  }
  // phase 'tint' (the incoming theme, sent ahead of the map) is left to the map's own payload: the
  // outgoing theme keeps its colour through the close, and the swap under the cover is the change.
}
