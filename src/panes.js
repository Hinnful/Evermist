'use strict';
// panes.js — two-column mode. What it is and why it is shaped this way: docs/ARCHITECTURE.md.
//
// Single-map mode never enters here. `panesActive` is false, every forward is a no-op, and the
// parent renders its own map exactly as it always has.

let panesActive   = false;
let panesSelected = 'A';
const PANE_IDS = ['A', 'B'];
const panes = {
  A: { frame: null, sceneId: null, mapW: 0, mapH: 0, ready: false },
  B: { frame: null, sceneId: null, mapW: 0, mapH: 0, ready: false },
};

let _paneSplit = null;

// ─── Transport ───────────────────────────────────────────────────────────────

function sendToPane(msg, id) {
  const p = panes[id || panesSelected];
  if (!p || !p.frame || !p.frame.contentWindow) return false;
  p.frame.contentWindow.postMessage(msg, '*');
  return true;
}

function broadcastToPanes(msg) {
  for (const id of PANE_IDS) sendToPane(msg, id);
}

// Returns true when the command went to a column, so the caller skips its own effect.
//
// ⚠ TWO KINDS OF CONTROL, TWO DESTINATIONS. An edit or a scene setting goes to the selected
// column; a standing preference - the tool, the fog direction, snap, Auto - goes to BOTH,
// because a click in the unselected column selects it AND acts in one press.
function paneForward(control, payload) {
  if (!panesActive) return false;
  // ⚠ The name goes on LAST. Several payloads are whole messages already carrying a `type`, and
  // spreading one over the name sends the column a message it has no handler for.
  return sendToPane({ ...(payload || {}), type: 'pane-' + control });
}

function paneBroadcast(control, payload) {
  if (!panesActive) return false;
  broadcastToPanes({ ...(payload || {}), type: 'pane-' + control });
  return true;
}

// ⚠ THE ONE SURFACE THE PARENT READS A COLUMN THROUGH. state.js uses top-level `let`, which is
// NOT a window property, so `frame.contentWindow.mapOffscreen` is undefined.
window.paneView = {
  get mapOffscreen()      { return mapOffscreen; },
  get mapWidth()          { return mapWidth; },
  get mapHeight()         { return mapHeight; },
  get fogBlurCanvas()     { return fogBlurCanvas; },
  get fogBaseColor()      { return fogBaseColor; },
  get fogTintColor()      { return fogTintColor; },
  get gridEnabled()       { return gridEnabled; },
  get playerScreenW()     { return playerScreenW; },
  get playerScreenH()     { return playerScreenH; },
  get playerWindow()      { return playerWindow; },
  get playerIsFullscreen() { return playerIsFullscreen; },
  get minimapView()       { return minimapView; },
  get gridCalArmed()      { return gridCalArmed; },
  get gridConfig()        { return captureGridConfig(); },
  get fogSettings()       {
    return { pickedHex: fogPickedHex, tintAlpha: FOG_TINT_ALPHA,
             anim: { enabled: fogAnimEnabled, speed: fogAnimSpeed, drift: driftScale,
                     morph: cloudFrameSpeed, warpStr: cloudWarpStrength,
                     warpRad: cloudWarpRadius, pulse: alphaPulseAmp } };
  },
  drawGridLines: (ctx, rect) => drawGridLines(ctx, rect),
};

// ⚠ THE CHROME MUST SHOW THE SELECTED COLUMN'S OWN SETTINGS. The grid and the animation set
// each push a WHOLE config, so a stale panel overwrites this column's numbers on the next nudge.
function paneAdoptSelectedSettings() {
  const s = paneScope();
  if (s.gridConfig) applyGridConfig(s.gridConfig);
  const f = s.fogSettings;
  if (!f || !f.anim) return;
  // ⚠ THE ADVANCED PANEL IS AIMED AT ONE COLUMN: left open, the mode row reads "advanced"
  // whichever preset the newly selected column is on.
  const adv = document.getElementById('btn-anim-advanced');
  if (adv && adv.classList.contains('active')) adv.click();
  showFogSettings(f.pickedHex, f.tintAlpha, f.anim);
}

function paneScope() {
  if (!panesActive) return window.paneView;
  const f = panes[panesSelected].frame;
  const view = f && f.contentWindow && f.contentWindow.paneView;
  return view || window.paneView;
}

// ─── Selection ───────────────────────────────────────────────────────────────

function selectPane(id) {
  if (!panes[id] || panesSelected === id) return;
  panesSelected = id;
  refreshPaneSelection();
  paneAdoptSelectedSettings();
  // The one minimap follows the selection, so it takes over the newly selected column's view.
  const v = paneScope().minimapView;
  if (v) minimapSetView(v);
  if (typeof refreshPlayerControlUI === 'function') refreshPlayerControlUI();
}

function refreshPaneSelection() {
  for (const id of PANE_IDS) {
    const col = panes[id].frame && panes[id].frame.parentNode;
    if (col) col.classList.toggle('pane-selected', panesActive && id === panesSelected);
  }
}

// ─── The column layout ───────────────────────────────────────────────────────

function paneUrl(id, sceneId) {
  return window.location.href.split('?')[0] + '?mode=pane&pane=' + id +
         (sceneId ? '&scene=' + encodeURIComponent(sceneId) : '');
}

function buildPaneRow() {
  const row = document.createElement('div');
  row.id = 'panes-row';
  for (const id of PANE_IDS) {
    if (id === 'B') {
      const div = document.createElement('div');
      div.id = 'panes-divider';
      div.addEventListener('mousedown', startDividerDrag);
      row.appendChild(div);
    }
    const col = document.createElement('div');
    col.className = 'pane-col';
    col.dataset.pane = id;
    const frame = document.createElement('iframe');
    frame.className = 'pane-frame';
    frame.src = paneUrl(id, panes[id].sceneId);
    panes[id].frame = frame;
    col.appendChild(frame);
    const close = document.createElement('button');
    close.className = 'pane-close';
    close.title = 'Close this map and keep the other';
    close.textContent = '×';
    close.addEventListener('click', () => closePaneColumn(id));
    col.appendChild(close);
    row.appendChild(col);
  }
  document.body.appendChild(row);
  applyPaneSplit();
  refreshPaneSelection();
}

// Both maps fill their column at one height, so a column's width is its map's aspect ratio.
function applyPaneSplit() {
  const row = document.getElementById('panes-row');
  if (!row) return;
  let frac = _paneSplit;
  if (frac == null) {
    const a = panes.A.mapH > 0 ? panes.A.mapW / panes.A.mapH : 0;
    const b = panes.B.mapH > 0 ? panes.B.mapW / panes.B.mapH : 0;
    frac = (a > 0 && b > 0) ? a / (a + b) : 0.5;
  }
  frac = Math.max(0.15, Math.min(0.85, frac));
  const cols = row.querySelectorAll('.pane-col');
  if (cols.length < 2) return;
  cols[0].style.flex = frac + ' 1 0';
  cols[1].style.flex = (1 - frac) + ' 1 0';
}

// ⚠ The frames are covered for the length of the drag: a mousemove over an <iframe> belongs to
// that frame's document, so without the shield the drag dies where the pointer crosses one.
function startDividerDrag(e) {
  e.preventDefault();
  const row = document.getElementById('panes-row');
  if (!row) return;
  row.classList.add('panes-dragging');
  const onMove = ev => {
    const r = row.getBoundingClientRect();
    if (!(r.width > 0)) return;
    _paneSplit = (ev.clientX - r.left) / r.width;
    applyPaneSplit();
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    row.classList.remove('panes-dragging');
    broadcastToPanes({ type: 'pane-refit' });
    sendStageSplit();
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ─── Entering and leaving ────────────────────────────────────────────────────

async function enterPanes(sceneIdA, sceneIdB) {
  if (panesActive) return;
  // ⚠ Read before the teardown below, which drops the handle without closing the window.
  const hadPlayer = !!(playerWindow && !playerWindow.closed);
  panes.A.sceneId = sceneIdA;
  panes.B.sceneId = sceneIdB;
  for (const id of PANE_IDS) { panes[id].ready = false; panes[id].mapW = 0; panes[id].mapH = 0; }
  _paneSplit = null;
  // ⚠ THE EMPTY COLUMN IS SELECTED, because the library's next click is what fills it.
  panesSelected = sceneIdB ? 'A' : 'B';

  // ⚠ The pending autosave is cancelled, not left to fire: it would write the parent's snapshot
  // over a scene a column now owns.
  await doAutoSave();
  clearTimeout(autoSaveTimer);
  teardownParentMap();

  panesActive = true;
  document.body.classList.add('panes-on');
  buildPaneRow();
  // The DM's own Player window held a map that no longer exists, so the shell takes its place.
  // With no Player up, the shell is warmed hidden instead, so the button has nothing left to boot.
  if (hadPlayer) toggleStageWindow(); else prewarmStage();
  renderSceneManager();   // the toggle lights and the trigger starts naming two maps
}

function livePanes() {
  return PANE_IDS.filter(id => panes[id].frame);
}

// ⚠ A column autosaves on a timer; removing its frame at once loses the last few seconds.
function flushPaneScene(id) {
  const w = panes[id].frame && panes[id].frame.contentWindow;
  if (!w || typeof w.doAutoSave !== 'function') return Promise.resolve();
  try { return Promise.resolve(w.doAutoSave()); } catch (_) { return Promise.resolve(); }
}

async function exitPanes(keepSceneId) {
  if (!panesActive) return;
  // ⚠ THE PLAYER'S WINDOW IS KEPT, not closed: navigating it back carries its fullscreen.
  const hadPlayer = stageIsOpen();
  unbindStageHalves();
  // ⚠ A warm shell left running answers to the Player's window name, so the single-map warming
  // below would navigate it instead of opening its own.
  closePrewarmedStage();
  _stageWindow = null;
  await Promise.all(livePanes().map(flushPaneScene));
  panesActive = false;
  document.body.classList.remove('panes-on');
    if (typeof refreshTwoMapsButton === 'function') refreshTwoMapsButton();
  const row = document.getElementById('panes-row');
  if (row) row.remove();
  for (const id of PANE_IDS) {
    panes[id].frame = null;
    panes[id].ready = false;
    panes[id].sceneId = null;
  }
  syncSize();
  if (!hadPlayer) prewarmPlayer();   // warming would navigate the live window away
  // The map comes back out of the store, which is where the column has been saving it all along.
  if (keepSceneId) await switchScene(keepSceneId).catch(console.error);
  if (hadPlayer) { playerWindow = null; revealPlayerWindow(); }
}

// ⚠ CLOSING A COLUMN ENDS TWO-MAP MODE. One column full width looked exactly like one map, was
// not one, and offered no way back.
async function closePaneColumn(id) {
  if (!panesActive || !panes[id].frame) return;
  const other = PANE_IDS.find(x => x !== id && panes[x].frame);
  await exitPanes(panes[other || id].sceneId);
}

// ⚠ Hiding the map frees no decoder and no GPU texture, which is why entering tears it down.
function teardownParentMap() {
  // ⚠ THE PLAYER'S WINDOW IS LEFT ALONE: entering navigates it to the shell instead.
  playerWindow = null;
  closePrewarmedPlayer();
  cleanupVideo();
  stopFogTransition();
  stopFogAnim();
  if (mapBitmap) { mapBitmap.close(); mapBitmap = null; }
  mapOffscreen  = null;
  fogDataCanvas = null; fogDataCtx = null;
  baseFogCanvas = null; baseFogCtx = null;
  polygons = [];
  setEffects([]);
  undoStack = []; redoStack = [];
  currentScene = null;
  playerMapSent = false;
  pixiClearMap();
  pixiDestroyFog();
  pixiFlushTexturePool();
  if (typeof refreshRoomPanel === 'function') refreshRoomPanel();
  renderSceneManager();
}

// ─── The Player screen ───────────────────────────────────────────────────────
// ⚠ ONE WINDOW FOR BOTH COLUMNS - see stage.js for why two cannot work.

let _stageWindow = null;

// ⚠ WARMED HIDDEN, AND THE HALVES STAY UNBOUND until the button is pressed. A column bound to a
// window nobody opened pushes every map into it, and the Player control reads as open. Warming
// buys the boot alone - two app instances, their PixiJS contexts and their cloud frames.
let _stagePrewarm = null;

function stageIsOpen() { return !!(_stageWindow && !_stageWindow.closed); }

function stageWindowUrl() {
  return window.location.href.split('?')[0].replace(/index\.html$/, 'stage.html');
}

function openStageWindow() {
  return window.open(stageWindowUrl(), playerWindowName(),
                     'toolbar=no,menubar=no,scrollbars=no');
}

// The name-reuse rules are prewarmPlayer's in viewport.js; this is the shell's copy of them.
function prewarmStage() {
  if (!panesActive || stageIsOpen()) return;
  if (_stagePrewarm && !_stagePrewarm.closed) return;
  _stagePrewarm = openStageWindow();
}

function prewarmStageAfter(dying) {
  if (!dying || dying.closed) { prewarmStage(); return; }
  let tries = 0;
  const poll = () => {
    if (dying.closed || ++tries > 40) prewarmStage();
    else setTimeout(poll, 50);
  };
  setTimeout(poll, 50);
}

function closePrewarmedStage() {
  if (_stagePrewarm && !_stagePrewarm.closed) _stagePrewarm.close();
  _stagePrewarm = null;
}

// ⚠ THE SHELL OPENS INTO THE PLAYER'S OWN WINDOW, under the same name: window.open on an
// existing name NAVIGATES it, leaving the OS window - and its fullscreen - alone.
function toggleStageWindow() {
  if (stageIsOpen()) { closeStageWindow(); return; }
  _stageWindow = (_stagePrewarm && !_stagePrewarm.closed) ? _stagePrewarm : openStageWindow();
  _stagePrewarm = null;
  if (!_stageWindow) return;
  if (window.electronAPI && window.electronAPI.playerReveal) {
    window.electronAPI.playerReveal(playerWindowName());
  }
  // ⚠ A warm shell announced itself while _stageWindow was still null, so its `stage-ready` was
  // dropped by the handler's source check and nothing sends a second one. A shell opened cold
  // finds no halves here and is bound by that message instead.
  bindStageHalves();
}

function closeStageWindow() {
  unbindStageHalves();
  const dying = _stageWindow;
  if (stageIsOpen()) _stageWindow.close();
  _stageWindow = null;
  if (typeof refreshPlayerControlUI === 'function') refreshPlayerControlUI();
  prewarmStageAfter(dying);   // the next press should be as fast as this one was
}

function unbindStageHalves() {
  for (const id of PANE_IDS) {
    _stageBound[id] = null;
    const col = panes[id].frame && panes[id].frame.contentWindow;
    if (col && typeof col.bindPlayerWindow === 'function') col.bindPlayerWindow(null);
  }
}

// ⚠ CALLED FROM THREE PLACES - the shell reporting ready, and each column saying hello - so it
// must be idempotent: a `player-hello` costs a PLAYER_READY and a whole re-sent map. A half is
// recorded as joined only once BOTH directions took.
const _stageBound = { A: null, B: null };

function bindStageHalves() {
  if (!stageIsOpen() || typeof _stageWindow.stageFrameWindow !== 'function') return;
  for (const id of PANE_IDS) {
    const half = _stageWindow.stageFrameWindow(id);
    const col  = panes[id].frame && panes[id].frame.contentWindow;
    if (!half || !col || typeof col.bindPlayerWindow !== 'function') continue;
    if (typeof half.bindReplyTarget !== 'function') continue;   // that half is not up yet
    if (_stageBound[id] === half) continue;
    _stageBound[id] = half;
    col.bindPlayerWindow(half);
    half.bindReplyTarget(col);
    half.postMessage({ type: 'player-hello' }, '*');
  }
  sendStageSplit();
  if (typeof refreshPlayerControlUI === 'function') refreshPlayerControlUI();
}

function sendStageSplit() {
  if (!stageIsOpen()) return;
  const row = document.getElementById('panes-row');
  const colA = row && row.querySelector('.pane-col[data-pane="A"]');
  if (!colA) return;
  const frac = colA.getBoundingClientRect().width / row.getBoundingClientRect().width;
  if (frac > 0) _stageWindow.postMessage({ type: 'stage-split', frac }, '*');
}

function stageFullscreen() {
  if (stageIsOpen()) _stageWindow.postMessage({ type: 'fullscreen' }, '*');
}

// ─── What the columns say back ───────────────────────────────────────────────

function initPanes() {
  window.addEventListener('message', e => {
    const msg = e.data;
    if (msg && msg.type === 'stage-ready' && e.source === _stageWindow) { bindStageHalves(); return; }
    if (msg && msg.type === 'PLAYER_FULLSCREEN' && e.source === _stageWindow) {
      playerIsFullscreen = !!msg.fullScreen;
      if (typeof refreshPlayerControlUI === 'function') refreshPlayerControlUI();
      return;
    }
    if (!msg || !msg.pane || !panes[msg.pane]) return;
    const p = panes[msg.pane];
    if (e.source !== (p.frame && p.frame.contentWindow)) return;

    if (msg.type === 'pane-hello') {
      p.ready = true;
      bindStageHalves();
      // ⚠ Or the chrome keeps the torn-down scene's settings and pushes them into this column.
      if (msg.pane === panesSelected) paneAdoptSelectedSettings();
      renderSceneManager();
      return;
    }
    if (msg.type === 'pane-clicked') { selectPane(msg.pane); return; }
    if (msg.type === 'pane-scene-result') {
      p.sceneId = msg.sceneId || null;
      renderSceneManager();
      return;
    }
    if (msg.type === 'pane-repaint') {
      if (msg.pane === panesSelected) { minimapDirty = true; scheduleRender(); }
      return;
    }
    // A column's Player looking elsewhere on its own; only the selected one's report counts.
    if (msg.type === 'pane-player-view') {
      if (msg.pane === panesSelected && msg.view) minimapSetView(msg.view);
      return;
    }
    if (msg.type === 'pane-map-size') {
      p.mapW = msg.mapWidth; p.mapH = msg.mapHeight; p.ready = true;
      p.sceneId = msg.sceneId || p.sceneId;
      applyPaneSplit();
      sendStageSplit();
      renderSceneManager();
      if (msg.pane === panesSelected) { paneAdoptSelectedSettings(); minimapSeedView(); }
    }
  });
}

function paneColumnOf(sceneId) {
  return PANE_IDS.find(id => panes[id].sceneId === sceneId) || null;
}

// ⚠ Two columns on one scene record autosave over each other, so the library refuses.
function paneHoldingScene(sceneId, exceptId) {
  for (const id of PANE_IDS) {
    if (id !== exceptId && panes[id].sceneId === sceneId) return id;
  }
  return null;
}

// The library's click while two-column mode is on: the scene lands in the selected column.
function loadSceneIntoSelectedPane(sceneId) {
  if (paneHoldingScene(sceneId, panesSelected)) {
    messageDialog({
      title: 'That map is already open',
      message: 'It is in the other column, and two columns editing one map would save over each ' +
               'other. Pick a different map for this one.',
    });
    return false;
  }
  // Recorded up front so the other column cannot be given it meanwhile; the column's own
  // `pane-scene-result` then says what it really ended up holding.
  panes[panesSelected].sceneId = sceneId;
  panes[panesSelected].mapW = 0;
  panes[panesSelected].mapH = 0;
  sendToPane({ type: 'pane-load-scene', sceneId });
  return true;
}

// ─── Pane side ───────────────────────────────────────────────────────────────

// ⚠ ELECTRON INJECTS NO PRELOAD INTO A SUBFRAME, so neither a column nor a half of the Player
// screen has an `electronAPI`; the frame borrows the window above's. Without it both halves
// stream one video file and stall each other.
// ⚠ An `on*` registration lands in the OUTER window's ipcRenderer and outlives this frame, so
// the removers run when it closes - otherwise the next push calls into a dead context.
(function installFrameBridge() {
  if (parent === window) return;
  let real = null;
  try { real = parent.electronAPI || null; } catch (_) { real = null; }
  if (!real) return;
  const removers = [];
  const api = {};
  for (const key of Object.keys(real)) {
    const fn = real[key];
    if (typeof fn !== 'function') { api[key] = fn; continue; }
    api[key] = /^on[A-Z]/.test(key)
      ? ((...args) => { const off = fn(...args); if (typeof off === 'function') removers.push(off); return off; })
      : ((...args) => fn(...args));
  }
  window.electronAPI = api;
  window.addEventListener('pagehide', () => {
    while (removers.length) { try { removers.pop()(); } catch (_) {} }
  });
})();

// A click anywhere in a column selects it, in the same click that acts. Capture phase, so the
// parent knows which column is live before this app's handlers finish with the event.
function reportPaneClicks() {
  window.addEventListener('mousedown', () => {
    if (parent !== window) parent.postMessage({ type: 'pane-clicked', pane: paneId }, '*');
  }, true);
}

// What the parent needs back from a column: the shape of its map, for the default split.
function reportPaneMapSize() {
  if (parent === window || !isPane) return;
  parent.postMessage({
    type: 'pane-map-size', pane: paneId, mapWidth, mapHeight,
    sceneId: currentScene ? currentScene.id : null,
  }, '*');
}
