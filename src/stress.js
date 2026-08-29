'use strict';

// stress.js — overnight stress rig for reproducing the long-session video-stall bug.
// Activated ONLY when ?stress=1 is present (injected by main.js under `npm run stress`).
// Completely inert under normal `npm start` and in the shipped .exe.
//
// ⚠ It must PACE ITSELF LIKE A PERSON: let the first video settle, THEN open the Player, THEN
// begin slow cycles. Slamming the startup wedges both decoders in the first minute, which `npm
// start` at human pace never does.
//
// The DM branch switches animated scenes on `stressMs` and toggles a saved polygon on
// `stressRevealMs`, through the Select-tool path and never the brush, because the table only uses
// polygons. The Player branch is a read-only stall detector.

async function initStress() {
  var sp = new URLSearchParams(window.location.search);
  if (sp.get('stress') !== '1') return;

  var intervalMs = _stressIntParam(sp.get('stressMs'), 900000);       // scene switch: 15min
  var revealMs   = _stressIntParam(sp.get('stressRevealMs'), 180000); // polygon reveal: 3min

  // Open the diagnostics overlay for both windows so events are visible on screen.
  if (typeof _diagToggle === 'function' && !_diagActive) {
    _diagToggle();
  }

  _diagAppend('stress: initStress mode=' + (isPlayer ? 'player' : 'dm') +
    ' switch=' + intervalMs + 'ms reveal=' + revealMs + 'ms');

  if (isPlayer) {
    _startStallDetector();
    return;
  }

  // ── DM branch ────────────────────────────────────────────────────────────────

  // Auto-sync so switchScene() and polygon toggles push to the Player, as at the table.
  autoSync = true;

  // 1) Let the app's own startup video settle before touching anything. This is the
  //    fragile window; a human waits here too.
  _diagAppend('stress: waiting for initial video to settle…');
  await _waitForStableVideo(20000);

  // 2) Discover animated scenes from lightweight metadata (mapType now included in
  //    listScenes) — NO full-record/blob loads, which is what stormed the disk before.
  var metas = await sceneStore.listScenes();
  var animatedScenes = [];
  for (var i = 0; i < metas.length; i++) {
    if (metas[i].mapType === 'video') animatedScenes.push({ id: metas[i].id, name: metas[i].name });
  }

  if (animatedScenes.length === 0) {
    _showStressBanner('NO ANIMATED MAPS—load some via npm start first', '#c0392b');
    _diagAppend('stress: ABORT — no animated maps found');
    return;
  }
  _diagAppend('stress: found ' + animatedScenes.length + ' animated scene(s)');

  // 3) Make sure an animated scene is active. If the app already loaded one, keep it
  //    (no needless switch); otherwise switch once and let it settle.
  var idx = 0;
  if (currentScene && currentScene.mapType === 'video') {
    var ci = -1;
    for (var j = 0; j < animatedScenes.length; j++) {
      if (currentScene.id === animatedScenes[j].id) { ci = j; break; }
    }
    if (ci >= 0) idx = ci;
    _diagAppend('stress: already on animated scene "' + (currentScene.name || '') + '"');
  } else {
    _diagAppend('stress: switching to first animated scene "' + animatedScenes[0].name + '"');
    await switchScene(animatedScenes[0].id);
    await _waitForStableVideo(20000);
  }

  // 4) Only now bring up the Player — mirrors the table (DM playing smoothly before the
  //    TV window comes up). Then give it time to load its own video and stabilize.
  _diagAppend('stress: opening Player window');
  document.getElementById('btn-player').click();
  await _sleep(10000);
  _diagAppend('stress: begin cycles');

  // 5) Slow cycles.
  if (animatedScenes.length >= 2) {
    _startSceneCycle(animatedScenes, idx, intervalMs);
  } else {
    _diagAppend('stress: single animated scene — not switching');
  }

  if (sp.get('noReveals') === '1') {
    _diagAppend('stress: reveal cycle DISABLED (control run)');
  } else {
    _startPolygonRevealCycle(revealMs);
  }

  _startStallDetector();
}

function _stressIntParam(raw, fallback) {
  if (!raw) return fallback;
  var v = parseInt(raw, 10);
  return (!isNaN(v) && v > 0) ? v : fallback;
}

function _sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

// Resolves once the map video has held readyState 4 (HAVE_ENOUGH) unpaused for ~2s,
// or after timeoutMs regardless. Read-only — just observes; never kicks the video.
function _waitForStableVideo(timeoutMs) {
  return new Promise(function(resolve) {
    var start = Date.now();
    var stableSince = null;
    var iv = setInterval(function() {
      var mv = (typeof mapVideo !== 'undefined') ? mapVideo : null;
      var ok = mv && mv.readyState === 4 && !mv.paused;
      if (ok) {
        if (stableSince == null) stableSince = Date.now();
        if (Date.now() - stableSince >= 2000) {
          clearInterval(iv); _diagAppend('stress: video stable'); resolve(true); return;
        }
      } else {
        stableSince = null;
      }
      if (Date.now() - start >= timeoutMs) {
        clearInterval(iv); _diagAppend('stress: stable-wait timed out — proceeding anyway'); resolve(false);
      }
    }, 500);
  });
}

// ── Scene-switch cycle ────────────────────────────────────────────────────────

function _startSceneCycle(animatedScenes, startIdx, periodMs) {
  var idx = startIdx;
  var timer = setInterval(async function() {
    if (_stressStopped) { clearInterval(timer); return; }
    idx = (idx + 1) % animatedScenes.length;
    var next = animatedScenes[idx];
    _diagAppend('stress: switch → "' + next.name + '"');
    await switchScene(next.id);
  }, periodMs);
  _chainCyclerStop(function() { clearInterval(timer); });
}

// ── Polygon reveal cycle ──────────────────────────────────────────────────────
// Flips one saved polygon reveal↔shroud each tick through toggleSelectedPolygon(), the exact call
// the Select tool makes at the table. No brush.

var _revealTick = 0;

function _startPolygonRevealCycle(periodMs) {
  var timer = setInterval(function() {
    if (_stressStopped) { clearInterval(timer); return; }
    _stressTogglePolygon();
  }, periodMs);
  _chainCyclerStop(function() { clearInterval(timer); });
}

function _stressTogglePolygon() {
  if (typeof polygons === 'undefined' || !polygons || !polygons.length) {
    _diagAppend('stress: reveal — no polygons in current scene, skipping');
    return;
  }
  if (typeof toggleSelectedPolygon !== 'function') return;
  var poly = polygons[_revealTick % polygons.length];
  _revealTick++;
  selectedPolygonId = poly.id;
  var rs = (typeof mapVideo !== 'undefined' && mapVideo) ? mapVideo.readyState : '?';
  toggleSelectedPolygon();
  _diagAppend('stress: reveal — polygon id=' + poly.id + ' → ' + poly.mode + ' (rs before=' + rs + ')');
}

// ── Stall detector ────────────────────────────────────────────────────────────
// ⚠ Read-only: never calls play, pause, seek or reload. Trips after STALL_SUSTAIN_MS of a sustained
// dead state, and guards against video.js's own buffering pause so a refill is not a false trip.

var _stressStopped   = false;
var _stressCyclerStop = null;
var _stressStallSince = null;
var STALL_POLL_MS    = 5000;
var STALL_SUSTAIN_MS = 15000;

// Chains a stop fn onto _stressCyclerStop so a caught stall halts every cycle.
function _chainCyclerStop(stop) {
  var prev = _stressCyclerStop;
  _stressCyclerStop = function() { if (prev) prev(); stop(); };
}

function _startStallDetector() {
  setInterval(function() {
    if (_stressStopped) return;

    var ve  = (typeof videoEnabled !== 'undefined') ? videoEnabled : false;
    var mv  = (typeof mapVideo !== 'undefined') ? mapVideo : null;
    var bp  = (typeof _bufferingPause !== 'undefined') ? _bufferingPause : false;
    var rvc = (typeof videoRVFCId !== 'undefined') ? videoRVFCId : null;

    if (!ve) { _stressStallSince = null; return; } // video not active

    var frameLoopDead = (rvc == null);
    var readyStall    = mv && mv.readyState < 3 && !mv.paused && !bp;

    if (readyStall || frameLoopDead) {
      if (_stressStallSince == null) _stressStallSince = Date.now();
      var sustained = Date.now() - _stressStallSince;
      if (sustained >= STALL_SUSTAIN_MS) {
        var reason = readyStall
          ? ('rs=' + (mv ? mv.readyState : '?') + ' not-paused not-buffering')
          : 'frame-loop-dead';
        var wallClock = new Date().toLocaleTimeString();
        _diagAppend('STALL DETECTED reason=' + reason + ' sustained=' + Math.round(sustained / 1000) + 's');
        _stressStopped = true;
        if (_stressCyclerStop) _stressCyclerStop();
        _showStressBanner('STALL CAUGHT at ' + wallClock + '\n(' + reason + ')', '#c0392b');
      }
    } else {
      _stressStallSince = null;
    }
  }, STALL_POLL_MS);
}

// ── Banner helper ─────────────────────────────────────────────────────────────

function _showStressBanner(text, bg) {
  var el = document.getElementById('stress-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'stress-banner';
    el.style.cssText = [
      'position:fixed', 'top:20px', 'left:50%', 'transform:translateX(-50%)',
      'z-index:99999', 'padding:16px 28px', 'border-radius:8px',
      'font:bold 18px/1.4 monospace', 'color:#fff', 'text-align:center',
      'pointer-events:none', 'white-space:pre-line', 'box-shadow:0 4px 20px rgba(0,0,0,.6)'
    ].join(';');
    document.body.appendChild(el);
  }
  el.style.background = bg || '#c0392b';
  el.textContent = text;
}
