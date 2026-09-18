// videoDiag.js — the video diagnostics overlay and the disk log behind it. The DM opens it
// with backtick; the rig opens the Player's.

// Kept for video-stall investigation. Disk logging is always on during playback.
var _diagActive   = false;
var _diagEl       = null;
var _diagInterval = null;
var _diagLog      = [];   // ring buffer, newest appended last; disk log is unbounded
var _diagT0       = null; // perf timestamp of first event
var _diagPrevRS   = -1;   // detect readyState changes between polls

// Frame rate from the browser's own paint clock, not the app's render loop, so a window that has
// stopped painting reads as stopped. Always on: a sag has to reach the disk log on its own.
var _diagFps = 0, _diagFpsCount = 0, _diagFpsSince = 0, _diagFpsLoggedAt = 0;
function _diagStartFps() {
  if (_diagFpsSince) return;
  _diagFpsSince = performance.now();
  (function tick() {
    requestAnimationFrame(tick);
    _diagFpsCount++;
    var now = performance.now(), span = now - _diagFpsSince;
    if (span < 1000) return;
    _diagFps = Math.round(_diagFpsCount * 1000 / span);
    _diagFpsCount = 0; _diagFpsSince = now;
    // ⚠ Only the bad seconds, and at most one line a second: this runs for the whole session.
    if (_diagFps < 20 && now - _diagFpsLoggedAt > 900) {
      _diagFpsLoggedAt = now;
      _diagAppend('fps=' + _diagFps + ' ⚠');
    }
  })();
}

// Resolved once on first use. 'dm' or 'player' — the mode tag for disk log filenames.
// ⚠ _diagT0 resets on toggle, so the +Ns stamp is not monotonic; order by the wall-clock field.
function _diagMode() {
  return (typeof isPlayer !== 'undefined' && isPlayer) ? 'player' : 'dm';
}

// ⚠ WHICH WINDOW WROTE THE LINE. Two-map mode's columns share one file and its Player halves
// share another, each timestamping from its own start, so untagged lines interleave and no
// duration in either file can be read.
function _diagSource() {
  var mode = _diagMode() === 'player' ? 'PLAYER' : 'DM';
  var id = (typeof paneId !== 'undefined' && paneId) ? ':' + paneId : '';
  return mode + id;
}

// Written once per loop start, so every tagged source says which map its stalls belong to.
function _diagWhat() {
  var w = (typeof mapWidth !== 'undefined' && mapWidth) ? mapWidth : 0;
  var h = (typeof mapHeight !== 'undefined' && mapHeight) ? mapHeight : 0;
  var scene = (typeof currentScene !== 'undefined' && currentScene) ? currentScene.id : 'none';
  var dur = (typeof mapVideo !== 'undefined' && mapVideo && isFinite(mapVideo.duration))
    ? mapVideo.duration.toFixed(1) + 's' : '?';
  return 'scene=' + scene + ' map=' + w + 'x' + h + ' clip=' + dur;
}

function _diagWriteDisk(relStamp, msg) {
  if (typeof window === 'undefined' || !window.electronAPI || !window.electronAPI.diagAppendLine) return;
  var wallMs = Date.now();
  var line = '[' + wallMs + '] [' + _diagSource() + '] [' + relStamp + '] ' + msg;
  try { window.electronAPI.diagAppendLine(_diagMode(), line); } catch (_) {}
}

function _diagAppend(msg) {
  if (!_diagT0) _diagT0 = performance.now();
  var t = ((performance.now() - _diagT0) / 1000).toFixed(2);
  var relStamp = '+' + t + 's';
  _diagLog.push('[' + relStamp + '] ' + msg);
  if (_diagLog.length > 50) _diagLog.shift();
  _diagWriteDisk(relStamp, msg);
}

function _diagRender() {
  if (!_diagEl) return;
  var mode = (typeof isPlayer !== 'undefined' && isPlayer) ? 'PLAYER' : 'DM';
  var ve   = (typeof videoEnabled   !== 'undefined') ? videoEnabled   : '?';
  var vda  = (typeof videoDOMActive !== 'undefined') ? videoDOMActive : '?';
  var mv   = (typeof mapVideo !== 'undefined') ? mapVideo : null;
  var rs   = mv ? mv.readyState   : '—';
  var pa   = mv ? mv.paused       : '—';
  var ct   = mv ? mv.currentTime.toFixed(3) : '—';
  var loopAge = _videoLoopStartedAt
    ? ((performance.now() - _videoLoopStartedAt) / 1000).toFixed(1) + 's' : '—';
  var rvfc = (typeof videoRVFCId !== 'undefined') ? videoRVFCId : '?';
  var wdog = _videoWatchdogId ? 'ON' : 'off';

  // Detect readyState changes between renders
  if (mv && rs !== _diagPrevRS) {
    if (_diagPrevRS !== -1) _diagAppend('rs changed ' + _diagPrevRS + '→' + rs);
    _diagPrevRS = rs;
  }

  var lines = [
    '── VIDEO DIAG [' + mode + '] (` to close) ──',
    've=' + ve + '  vda=' + vda + '  wdog=' + wdog,
    'rs=' + rs + (rs < 4 && rs !== '—' ? ' ⚠' : '') +
      '  paused=' + pa + '  ct=' + ct,
    'loopAge=' + loopAge + '  RVFC=' + rvfc,
    'fps=' + _diagFps + (_diagFps && _diagFps < 20 ? ' ⚠' : ''),
    '── Events (newest first) ──',
  ].concat(_diagLog.slice().reverse());

  _diagEl.textContent = lines.join('\n');
}

function _diagToggle() {
  _diagActive = !_diagActive;
  if (_diagActive) {
    if (!_diagEl) {
      _diagEl = document.createElement('div');
      _diagEl.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;' +
        'background:rgba(0,0,0,0.88);color:#0f0;font-family:monospace;font-size:11px;' +
        'line-height:1.5;padding:8px 10px;max-height:82vh;overflow-y:auto;' +
        'pointer-events:none;white-space:pre;border:1px solid #0f0;min-width:280px;';
      document.body.appendChild(_diagEl);
    }
    _diagT0 = null; _diagLog = []; _diagPrevRS = -1;
    _diagAppend('diag opened');
    _diagRender();
    _diagInterval = setInterval(_diagRender, 250);
  } else {
    if (_diagInterval) { clearInterval(_diagInterval); _diagInterval = null; }
    if (_diagEl) { _diagEl.remove(); _diagEl = null; }
  }
}

// ⚠ EVERY WINDOW. A sag shows on the Player and the two-map halves, and none of them has a
// keyboard to open an overlay with.
if (typeof document !== 'undefined') _diagStartFps();

if (typeof document !== 'undefined' && !(typeof isPlayer !== 'undefined' && isPlayer)) {
  document.addEventListener('keydown', function(e) {
    // The same field guard input.js carries: a backtick typed into a room name belongs there.
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.code === 'Backquote') _diagToggle();
  });
}
