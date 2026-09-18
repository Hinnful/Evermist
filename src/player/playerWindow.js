'use strict';
// playerWindow.js — the DM side of the Player window: opening it, warming one ready, what it is
// sent and when. viewport.js owns the camera the pushes carry.

// ⚠ PRE-WARMED, AND `playerWindow` STAYS NULL UNTIL THE BUTTON IS PRESSED. Adopting the warm
// window early would send every fog push, and pull every map, into a window nobody opened.
let _playerPrewarm = null;

// ⚠ ONE NAME PER COLUMN. window.open reuses a browsing context BY NAME, so two columns sharing
// the fixed name would hand the second one the first's window and the first TV would go dark.
// ⚠ Keyed on `paneId` alone, not on the mode: a column's Player carries the same `?pane=` and
// has to answer to the same name, or main.js's display push never reaches it.
// ⚠ ONE NAME, because one window serves both columns. A per-column name made a column reject
// the display push describing its own half, so its map texture was never sized to the screen.
function playerWindowName() {
  // A Player FRAME sits inside the shell, and the shell is the window main.js knows about.
  if (isPlayer && parent !== window) { try { return parent.name || 'evermist-player'; } catch (_) {} }
  return 'evermist-player';
}

function playerWindowUrl() {
  const sp = new URLSearchParams(window.location.search);
  let url = window.location.href.split('?')[0] + '?mode=player';
  if (sp.get('stress') === '1') url += '&stress=1';
  const stressMs = sp.get('stressMs');
  if (stressMs) url += '&stressMs=' + encodeURIComponent(stressMs);
  // A second process with its own copy of every canvas, so the probe has to run there too.
  if (sp.get('memprobe') === '1') url += '&memprobe=1';
  return url;
}

function openPlayerWindow() {
  return window.open(playerWindowUrl(), playerWindowName(), 'toolbar=no,menubar=no,scrollbars=no');
}

// ⚠ NEVER WHILE A PLAYER IS OPEN. window.open reuses a browsing context by NAME, so warming one
// over a live Player re-navigates it and the TV reloads mid-session.
function prewarmPlayer() {
  if (isPlayer || isPane || panesActive) return;   // two-map mode has one shell, opened by the DM
  if (_playerPrewarm && !_playerPrewarm.closed) return;
  if (playerWindow && !playerWindow.closed) return;
  _playerPrewarm = openPlayerWindow();
}

// Same name reuse, the other way round: a window still closing can answer to the name, so the
// warm handle lands on a corpse. Bounded, or a window that never closes stops the warming.
function prewarmPlayerAfter(dying) {
  if (!dying || dying.closed) { prewarmPlayer(); return; }
  let tries = 0;
  const poll = () => {
    if (dying.closed || ++tries > 40) prewarmPlayer();
    else setTimeout(poll, 50);
  };
  setTimeout(poll, 50);
}

// A whole hidden renderer, so a parent handing its map to the columns drops it.
function closePrewarmedPlayer() {
  if (_playerPrewarm && !_playerPrewarm.closed) _playerPrewarm.close();
  _playerPrewarm = null;
}

// The button's "open": main.js keeps every Player window hidden until this.
function revealPlayerWindow() {
  playerWindow = (_playerPrewarm && !_playerPrewarm.closed) ? _playerPrewarm : openPlayerWindow();
  _playerPrewarm = null;
  if (!playerWindow) return;   // window.open can answer null; a throw here kills the button
  if (window.electronAPI && window.electronAPI.playerReveal) {
    window.electronAPI.playerReveal(playerWindowName());
  }
  // ⚠ A pre-warmed window announced itself while playerWindow was still null, so its PLAYER_READY
  // was dropped by the handler's source check. Ask again or nothing is ever sent to it.
  playerWindow.postMessage({ type: 'player-hello' }, '*');
}

// The Player button is a toggle: window.open on an already-open named window only re-navigates
// it, so without the close branch the second press looks dead.
function togglePlayerWindow() {
  if (playerWindow && !playerWindow.closed) {
    const dying = playerWindow;
    playerWindow.close();
    playerWindow = null;
    if (typeof refreshPlayerControlUI === 'function') refreshPlayerControlUI();
    prewarmPlayerAfter(dying);   // the next press should be as fast as this one was
    return;
  }
  revealPlayerWindow();
}

// ─── Player map-request protocol ─────────────────────────────────────────────

// Deferred player resync: set when the Player asks for the map but the DM has no scene loaded yet.
// onSceneLoaded() flushes the pending request.
let _playerResyncPending = false;

// Retries need-map every 5s, up to 6 attempts, until mapOffscreen is populated.
function initPlayerMapRetry() {
  let attempts = 0;
  function tryNeedMap() {
    if (mapOffscreen || !playerReplyTarget() || attempts >= 6) return;
    attempts++;
    playerReplyTarget().postMessage({ type: 'need-map' }, '*');
    setTimeout(tryNeedMap, 5000);
  }
  setTimeout(tryNeedMap, 4000);
}

// The one condition under which a push can go out at all. Shared with sendToPlayer's own guard.
function canSendToPlayer() {
  return !!(mapOffscreen && fogDataCanvas && playerWindow && !playerWindow.closed);
}

// Sends immediately if mapOffscreen is ready, and defers to onSceneLoaded() if not.
//
// ⚠ THE FLAG MEANS "ASKED AND NOT YET SERVED", AND ONLY A REAL DELIVERY CLEARS IT, in sendMap()
// at the moment the payload goes out. Clearing it in onSceneLoaded leaves it clear after a flush
// that delivered nothing, and never clearing it leaves it set after a send that went out — which
// makes the next scene switch push a second payload mid-cover.
//
// Clearing it up front on "a send is possible" loses the deferred retry: the first send is
// ASYNCHRONOUS for a video scene, and its callback returns without sending when the clip is
// missing.
function onPlayerResyncRequest() {
  _playerResyncPending = true;
  playerMapSent = false;
  sendToPlayer();
}

// Called at the end of a successful switchScene load: if the Player asked for the map while the
// scene was loading, send it now.
// ⚠ DOES NOT CLEAR THE FLAG. sendMap() clears it when the payload goes out, so a flush that
// delivers nothing leaves the request standing for the next scene load.
function onSceneLoaded() {
  if (!_playerResyncPending) return;
  sendToPlayer();
}

function sendToPlayer(fogOnly = false, sceneChange = false) {
  if (!canSendToPlayer()) return;

  // Fog sent at 1/4 scale (native fogDataCanvas size) — much smaller than upscaling.
  const fogDataUrl = fogDataCanvas.toDataURL('image/png');

  // fogOnly=true (Auto-sync): omit view so player keeps its pan/zoom.
  // fogOnly=false (manual Send/Sync): include view so player follows DM viewport.
  let view;
  if (!fogOnly) view = dmVisibleRegion();

  const isShroud   = fogTransIsShroud;
  // Only trigger a Player transition when fog actually changed.
  // Grid toggles / manual Send leave fogTransRafId null → fogChanged=false → no flash.
  const fogChanged = fogTransRafId !== null;

  if (!playerMapSent) {
    const sendMap = (mapUrl, mapType) => {
      playerWindow.postMessage({
        type: 'fog-update',
        mapUrl, mapType, mapWidth, mapHeight, fogDataUrl, view, isShroud, sceneChange, fogChanged,
        mapSceneId: currentScene ? currentScene.id : null,
        effects,
        gridEnabled, gridSize, gridOffsetX, gridOffsetY, gridColor, gridOpacity, gridMode, gridLineWidth,
        pickedHex: fogPickedHex, fogTintAlpha: FOG_TINT_ALPHA,
      }, '*');
      playerMapSent = true;
      // THE ONE PLACE A FIRST DELIVERY ACTUALLY HAPPENS, so it is the one place the Player's
      // outstanding request is answered. Every branch above this can bail without sending.
      _playerResyncPending = false;
    };
    if (currentScene && currentScene.mapPath && window.electronAPI) {
      window.electronAPI.getVideoFilePath(currentScene.id).then(absPath => {
        if (!absPath || !playerWindow || playerWindow.closed) return;
        sendMap('file:///' + absPath.replace(/\\/g, '/'), 'video');
      }).catch(() => {});   // the request stays pending, so the Player asks again
    } else if (mapVideoBlob) {
      sendMap(URL.createObjectURL(mapVideoBlob), 'video');
    } else if (currentScene && currentScene.mapBlob) {
      sendMap(URL.createObjectURL(currentScene.mapBlob), 'image');
    } else if (mapOffscreen) {
      mapOffscreen.toBlob(blob => {
        if (!playerWindow || playerWindow.closed) return;
        sendMap(URL.createObjectURL(blob), 'image');
      }, 'image/jpeg', 0.9);
    }
  } else {
    // Effects ride along as SHAPE DESCRIPTORS PLUS A MATERIAL NAME, never as pixels. The Player
    // paints the material itself from the same seeded masks.
    playerWindow.postMessage({
      type: 'fog-update',
      mapWidth, mapHeight, fogDataUrl, view, isShroud, sceneChange, fogChanged, effects,
      gridEnabled, gridSize, gridOffsetX, gridOffsetY, gridColor, gridOpacity, gridMode, gridLineWidth,
    }, '*');
  }
}

// Syncs fog-animation and video-frame-rate params to the Player window.
// pass includeWarp=true when cloud warp params changed (triggers regen on Player).
function syncAnimToPlayer(includeWarp) {
  const msg = { type: 'anim-params', fogAnimEnabled, fogAnimSpeed, driftScale, cloudFrameSpeed, alphaPulseAmp };
  if (includeWarp) { msg.cloudWarpStrength = cloudWarpStrength; msg.cloudWarpRadius = cloudWarpRadius; }
  // The same parameter set every animation control ends in, so one forward covers the presets,
  // the advanced sliders and the on/off button together.
  if (paneForward('anim', msg)) return;
  if (!playerWindow || playerWindow.closed) return;
  playerWindow.postMessage(msg, '*');
}

// Sends the current fog color to the Player window without a full fog re-send.
// pickedHex: the raw value from the DM's fog-color input (Player derives base+tint itself).
function syncFogColorToPlayer(pickedHex) {
  if (!playerWindow || playerWindow.closed) return;
  playerWindow.postMessage({ type: 'fog-color', pickedHex, fogTintAlpha: FOG_TINT_ALPHA }, '*');
}

// ─── Auto-Sync helper ─────────────────────────────────────────────────────────
// Debounces an auto-save + Player fog push after every fog-changing operation.
function scheduleAutoSync() {
  scheduleAutoSave();
  if (!autoSync) return;
  clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(() => sendToPlayer(true), 300);
}
