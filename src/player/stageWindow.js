'use strict';
// stageWindow.js — the DM's half of the Player screen in two-map mode: opening it, warming it,
// binding each column to its half, and closing it. stage.js is what runs inside that window.

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
