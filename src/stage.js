'use strict';
// stage.js — the Player window in two-map mode. What it is: docs/ARCHITECTURE.md.
//
// ⚠ ONE WINDOW, NOT TWO. Windows gives one fullscreen window per display, so two on one TV
// could never both be fullscreen and the players would see two title bars.

// The chasm's numbers, fixed here with no UI over them, as the fire effect's are in effects.js.
// Width is quoted against a 1920-wide screen and scales from there.
const CHASM_REF_W   = 1920;
const CHASM_WIDTH   = 46;    // px at 1920 wide
const CHASM_MOTES   = 34;
const CHASM_SPLIT   = 0.5;   // until the DM's divider says otherwise

let _stageSplit  = CHASM_SPLIT;
let _stageCanvas = null;
let _stageMotes  = [];
let _stageRaf    = null;
let _stageLoaded = 0;

// The two halves, by column; the DM window wires each to its column through stageFrameWindow().
const _stageFrames = { A: null, B: null };

function stageFrameWindow(id) {
  const f = _stageFrames[id];
  return (f && f.contentWindow) || null;
}

function initStage() {
  document.title = 'Evermist - Player View';
  window.addEventListener('wheel',       e => e.preventDefault(), { passive: false });
  window.addEventListener('touchmove',   e => e.preventDefault(), { passive: false });
  window.addEventListener('contextmenu', e => e.preventDefault());

  const row = document.createElement('div');
  row.id = 'stage-row';
  // ⚠ The halves are index.html, not this page: each one is a whole Player runtime.
  const base = window.location.href.split('?')[0].replace(/stage\.html$/, 'index.html');
  for (const id of ['A', 'B']) {
    const col = document.createElement('div');
    col.className = 'stage-col';
    col.dataset.pane = id;
    const frame = document.createElement('iframe');
    frame.className = 'stage-frame';
    frame.src = base + '?mode=player&pane=' + id;
    _stageFrames[id] = frame;
    // ⚠ ANNOUNCED ONLY ONCE BOTH HALVES HAVE LOADED. The DM window binds each half to its column
    // by calling a function inside it, and those do not exist until the frame's scripts have run.
    frame.addEventListener('load', () => {
      if (++_stageLoaded === 2 && window.opener) window.opener.postMessage({ type: 'stage-ready' }, '*');
    });
    col.appendChild(frame);
    row.appendChild(col);
  }
  _stageCanvas = document.createElement('canvas');
  _stageCanvas.id = 'stage-chasm';
  row.appendChild(_stageCanvas);
  document.body.appendChild(row);

  applyStageSplit();
  seedChasmMotes();
  _stageRaf = requestAnimationFrame(drawChasm);

  window.addEventListener('resize', applyStageSplit);
  window.addEventListener('message', e => {
    const msg = e.data;
    if (!msg) return;
    if (msg.type === 'stage-split' && typeof msg.frac === 'number') {
      _stageSplit = Math.max(0.15, Math.min(0.85, msg.frac));
      applyStageSplit();
      return;
    }
    // Native window fullscreen has no DOM event, so the shell relays main's push the way a
    // single Player window does.
    if (msg.type === 'fullscreen' && window.electronAPI) window.electronAPI.toggleFullscreen();
  });

  if (window.electronAPI && window.electronAPI.onFullscreenState) {
    window.electronAPI.onFullscreenState(data => {
      if (!window.opener) return;
      window.opener.postMessage({ type: 'PLAYER_FULLSCREEN', fullScreen: !!(data && data.fullScreen) }, '*');
    });
  }

}

// ⚠ THE GAP IS REAL, not painted over the frames: a band on top would cover map.
function chasmWidthPx() {
  return Math.max(6, Math.round(CHASM_WIDTH * (window.innerWidth / CHASM_REF_W)));
}

function applyStageSplit() {
  const row = document.getElementById('stage-row');
  if (!row) return;
  const gap = chasmWidthPx();
  row.style.gap = gap + 'px';
  const cols = row.querySelectorAll('.stage-col');
  if (cols[0]) cols[0].style.flex = _stageSplit + ' 1 0';
  if (cols[1]) cols[1].style.flex = (1 - _stageSplit) + ' 1 0';
}

function seedChasmMotes() {
  _stageMotes = [];
  for (let i = 0; i < CHASM_MOTES; i++) {
    _stageMotes.push({
      u: Math.random(), y: Math.random(),
      r: 0.6 + Math.random() * 1.9,
      v: 0.012 + Math.random() * 0.03,
      a: 0.25 + Math.random() * 0.5,
      warm: Math.random() < 0.4,
    });
  }
}

let _chasmLast = 0;

function drawChasm(now) {
  _stageRaf = requestAnimationFrame(drawChasm);
  const cv = _stageCanvas;
  if (!cv) return;
  const dt = Math.min(0.05, (now - _chasmLast) / 1000);
  _chasmLast = now;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(cv.clientWidth * dpr);
  const h = Math.round(cv.clientHeight * dpr);
  if (!w || !h) return;
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const g = cv.getContext('2d');

  const bw = chasmWidthPx() * dpr;
  const bx = Math.round(w * _stageSplit - bw / 2);

  g.clearRect(0, 0, w, h);

  // Dark to nothing at the centre, the fog colour bleeding in over each frame's edge.
  const grad = g.createLinearGradient(bx - bw * 0.28, 0, bx + bw * 1.28, 0);
  grad.addColorStop(0.00, 'rgba(58, 58, 140, 0.00)');
  grad.addColorStop(0.16, 'rgba(58, 58, 140, 0.55)');
  grad.addColorStop(0.40, '#07080e');
  grad.addColorStop(0.60, '#07080e');
  grad.addColorStop(0.84, 'rgba(58, 58, 140, 0.55)');
  grad.addColorStop(1.00, 'rgba(58, 58, 140, 0.00)');
  g.fillStyle = grad;
  g.fillRect(bx - bw * 0.28, 0, bw * 1.56, h);
  g.fillStyle = '#05060b';
  g.fillRect(bx + bw * 0.30, 0, bw * 0.40, h);

  g.save();
  g.globalCompositeOperation = 'lighter';
  for (const m of _stageMotes) {
    m.y -= m.v * dt;
    if (m.y < -0.04) { m.y = 1.04; m.u = Math.random(); }
    const fade = Math.min(1, Math.min(m.y, 1 - m.y) * 6);
    g.fillStyle = m.warm
      ? 'rgba(255, 186, 120, ' + (m.a * fade).toFixed(3) + ')'
      : 'rgba(160, 190, 255, ' + (m.a * fade).toFixed(3) + ')';
    g.beginPath();
    g.arc(bx + m.u * bw, m.y * h, m.r * dpr, 0, Math.PI * 2);
    g.fill();
  }

  const breathe = 0.34 + 0.22 * Math.sin(now / 2600);
  g.strokeStyle = 'rgba(150, 178, 255, ' + breathe.toFixed(3) + ')';
  g.lineWidth = Math.max(1, bw * 0.045);
  g.beginPath();
  const cx = bx + bw / 2;
  for (let y = 0; y <= h; y += 6) {
    const wob = Math.sin(y / 90 + now / 3400) * bw * 0.13 + Math.sin(y / 31 - now / 5200) * bw * 0.05;
    if (y === 0) g.moveTo(cx + wob, y); else g.lineTo(cx + wob, y);
  }
  g.stroke();
  g.restore();
}
