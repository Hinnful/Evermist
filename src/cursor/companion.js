'use strict';
// companion.js — the crystal companion on screen: one small fixed canvas that follows the pointer, drawn from
// companionLogic.js. It never touches the map canvases or doRender, and its own frame loop runs only while the
// pointer is in this document and the switch is on.
// ⚠ One crystal per screen: a document drops its crystal the moment the pointer goes into an iframe (a two-map
// column), whose own document then shows one.

const CMP_BOX = 96;
const CMP_NAVY = '#0d1a35';
const CMP_LIGHT = [-0.6, -0.8];

let _cmp = null;   // { canvas, ctx, s, raf, last, inside, mx, my, kind, readAt, dpr }
let _cmpOn = true;
const _cmpBusy = new Set();
let _cmpStillMq = null;

const _cmpLerp = (a, b, k) => a + (b - a) * k;
const _cmpPath = pts => { const p = new Path2D(); pts.forEach((q, i) => (i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1]))); p.closePath(); return p; };

function initCompanion() {
  _cmpOn = companionStoredOn();
  _cmpStillMq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const canvas = document.createElement('canvas');
  canvas.id = 'companion';
  canvas.hidden = true;
  document.body.appendChild(canvas);
  _cmp = { canvas, ctx: canvas.getContext('2d'), s: cmpCreate(), raf: 0, last: 0, inside: false, mx: 0, my: 0, kind: 'arrow', readAt: 0, dpr: 0 };
  document.addEventListener('pointermove', _cmpMove, true);
  document.addEventListener('pointerdown', _cmpDown, true);
  document.addEventListener('pointerover', e => { if (e.target.tagName === 'IFRAME') _cmpDepart(); }, true);
  document.addEventListener('pointerout', e => { if (!e.relatedTarget) _cmpDepart(); }, true);
  if (!isPlayer && !isPane) companionSwitchInit();
}

function _cmpMove(e) {
  if (e.target.tagName === 'IFRAME') return;
  _cmp.mx = e.clientX; _cmp.my = e.clientY; _cmp.readAt = 0;
  if (!_cmp.inside) _cmpArrive();
}

function _cmpArrive() {
  _cmp.inside = true;
  if (!_cmpOn) return;
  cmpEnter(_cmp.s);
  _cmpStart();
}

function _cmpDepart() {
  if (!_cmp.inside) return;
  _cmp.inside = false;
  cmpLeave(_cmp.s);
}

function _cmpStart() {
  if (_cmp.raf) return;
  _cmp.last = performance.now();
  _cmp.raf = requestAnimationFrame(_cmpFrame);
}

function _cmpStop() {
  cancelAnimationFrame(_cmp.raf);
  _cmp.raf = 0;
  _cmp.canvas.hidden = true;
}

// The pointer kind under the pointer, off its computed cursor.
function _cmpReadKind() {
  const el = document.elementFromPoint(_cmp.mx, _cmp.my);
  if (!el || el.tagName === 'IFRAME') return 'arrow';
  return cursorKindOf(getComputedStyle(el).cursor) || 'arrow';
}

// Empty space: the map or the Campaign under the plain arrow, with no room, effect or light there.
function _cmpOnEmpty(e) {
  if (_cmpReadKind() !== 'arrow') return false;
  const wm = document.getElementById('wm');
  if (worldMapOpen && wm && wm.contains(e.target)) return true;
  if (!container.contains(e.target) || !mapWidth) return false;
  const p = screenToMap(e.clientX, e.clientY), at = s => pointInShape(p.x, p.y, s);
  return !polygons.some(at) && !effects.some(at) && !lightShapes.some(at);
}

function _cmpDown(e) {
  if (e.button !== 0 || !_cmpOn || !_cmp.inside) return;
  _cmp.mx = e.clientX; _cmp.my = e.clientY;
  cmpClick(_cmp.s, _cmpOnEmpty(e));
}

function _cmpFrame(now) {
  const c = _cmp, s = c.s;
  const dt = Math.max(0.001, Math.min(0.05, (now - c.last) / 1000));
  c.last = now;
  // A tool can change the cursor with no pointer move, as a press does, so the kind is read again on a clock.
  if (now - c.readAt > 100) { c.kind = _cmpReadKind(); c.readAt = now; }
  s.busy = _cmpBusy.size > 0;
  cmpStep(s, dt, { cx: c.mx, cy: c.my, kind: c.kind, w: window.innerWidth, h: window.innerHeight, still: !!(_cmpStillMq && _cmpStillMq.matches) });
  if (cmpGone(s)) { _cmpStop(); return; }
  c.canvas.hidden = s.hidden;
  if (!s.hidden) _cmpPaint(c, s);
  c.raf = requestAnimationFrame(_cmpFrame);
}

function _cmpPaint(c, s) {
  const dpr = window.devicePixelRatio || 1;
  if (dpr !== c.dpr) { c.dpr = dpr; c.canvas.width = c.canvas.height = Math.round(CMP_BOX * dpr); }
  const ctx = c.ctx, half = CMP_BOX / 2;
  c.canvas.style.transform = 'translate(' + (s.x - half) + 'px,' + (s.y - half) + 'px)';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, CMP_BOX, CMP_BOX);
  ctx.translate(half - s.x, half - s.y);
  _cmpDraw(ctx, s);
}

// ─── Drawing: the Morphing core with the Orb eye ─────────────────────────────

function _cmpShade(nx, ny, red, lift, alpha) {
  const b = nx * CMP_LIGHT[0] + ny * CMP_LIGHT[1];
  const hue = _cmpLerp(212 + 22 * Math.sin(Math.atan2(ny, nx) * 2), 352, red);
  const light = Math.max(22, Math.min(95, 56 + 32 * b + lift * 10));
  return `hsla(${hue.toFixed(0)},${(80 - lift * 10).toFixed(0)}%,${light.toFixed(0)}%,${alpha})`;
}

function _cmpDraw(ctx, s) {
  const x = s.x, y = s.y;
  ctx.save();
  ctx.globalAlpha *= (s.present ? 1 : s.vis) * s.fade;
  if (s.flash > 0) {
    const fr = 6 + (1 - s.flash) * 14, fg = ctx.createRadialGradient(x, y, 0, x, y, fr);
    fg.addColorStop(0, `rgba(200,240,255,${0.7 * s.flash})`); fg.addColorStop(1, 'rgba(200,240,255,0)');
    ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(x, y, fr, 0, CMP_TAU); ctx.fill();
  }
  const gr = 11 + s.glow * 7, gc = s.red > 0.5 ? '255,100,120' : '120,180,255';
  const g0 = ctx.createRadialGradient(x, y, 0, x, y, gr);
  g0.addColorStop(0, `rgba(${gc},${s.glow * 0.6})`); g0.addColorStop(1, `rgba(${gc},0)`);
  ctx.fillStyle = g0; ctx.beginPath(); ctx.arc(x, y, gr, 0, CMP_TAU); ctx.fill();
  _cmpDrawMorph(ctx, s);
  for (const z of s.zs) {
    const k = z.age / 2.2, a = k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.6) / 0.4);
    ctx.save(); ctx.globalAlpha *= a;
    ctx.font = `800 ${(4 + k * 2.5).toFixed(1)}px system-ui, sans-serif`; ctx.textAlign = 'center';
    const zx = z.x + k * 6 + Math.sin(z.age * 2), zy = z.y - k * 9;
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(13,26,53,0.9)'; ctx.strokeText('z', zx, zy);
    ctx.fillStyle = '#e4eeff'; ctx.fillText('z', zx, zy); ctx.restore();
  }
  ctx.restore();
}

function _cmpDrawMorph(ctx, s) {
  const P = s.verts, inner = P.map(p => [p[0] * 0.45, p[1] * 0.45]), red = s.red > 0.4;
  const minR = Math.min(...P.map(p => Math.hypot(p[0], p[1])));
  ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.mAng + s.tilt * 0.5);
  const sc = 1 + s.sq * 0.5; ctx.scale(sc, sc);
  const out = _cmpPath(P);
  ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2.2; ctx.stroke(out);
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1.3;
  const bg = ctx.createLinearGradient(0, -10, 0, 10);
  bg.addColorStop(0, red ? '#5a1a34' : '#1d3a78'); bg.addColorStop(1, red ? '#2a0816' : '#0b1736');
  ctx.fillStyle = bg; ctx.fill(out); ctx.restore();
  let area = 0;
  P.forEach((p, i) => { const q = P[(i + 1) % CMP_N]; area += p[0] * q[1] - q[0] * p[1]; });
  const sg = area > 0 ? 1 : -1;
  for (let i = 0; i < CMP_N; i++) {
    const p = P[i], q = P[(i + 1) % CMP_N], ex = q[0] - p[0], ey = q[1] - p[1], l = Math.hypot(ex, ey) || 1;
    const n = _cmpRot([sg * ey / l, -sg * ex / l], s.mAng);
    ctx.fillStyle = _cmpShade(n[0], n[1], s.red, s.glow > 0.5 ? 1 : 0, 0.93);
    ctx.fill(_cmpPath([p, q, inner[(i + 1) % CMP_N], inner[i]]));
  }
  const g = ctx.createLinearGradient(-2, -8, 2, 8);
  g.addColorStop(0, 'rgba(248,252,255,0.22)'); g.addColorStop(1, `hsla(${_cmpLerp(218, 345, s.red).toFixed(0)},72%,40%,0.25)`);
  ctx.fillStyle = g; ctx.fill(_cmpPath(inner));
  ctx.strokeStyle = 'rgba(220,242,255,0.6)'; ctx.lineWidth = 0.3; ctx.stroke(_cmpPath(inner));
  ctx.save(); ctx.rotate(-s.mAng);
  const cs = Math.max(0.45, Math.min(1.05, minR / 4.2)); ctx.scale(cs, cs);
  _cmpDrawEye(ctx, s);
  ctx.restore();
  ctx.strokeStyle = 'rgba(220,242,255,0.6)'; ctx.lineWidth = 0.3;
  for (let i = 0; i < CMP_N; i++) { ctx.beginPath(); ctx.moveTo(P[i][0], P[i][1]); ctx.lineTo(inner[i][0], inner[i][1]); ctx.stroke(); }
  ctx.lineJoin = 'round';
  ctx.strokeStyle = red ? 'rgba(45,10,25,0.95)' : 'rgba(13,26,53,0.95)'; ctx.lineWidth = 0.85; ctx.stroke(out);
  ctx.strokeStyle = red ? 'rgba(255,170,190,0.9)' : 'rgba(170,225,255,0.9)'; ctx.lineWidth = 0.3;
  ctx.stroke(_cmpPath(P.map(p => [p[0] * 0.9, p[1] * 0.9])));
  ctx.restore();
}

// The Orb: a glowing light whose shape is the mood; a spinner while busy.
function _cmpDrawEye(ctx, s) {
  const m = s.mood, t = s.anim;
  if (m === 'busy') {
    ctx.save(); ctx.translate(0, 0.2); ctx.shadowColor = 'rgba(130,225,255,1)'; ctx.shadowBlur = 3; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(160,220,255,0.3)'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.arc(0, 0, 2.3, 0, CMP_TAU); ctx.stroke();
    const a0 = t * 7;
    ctx.strokeStyle = '#e6fbff'; ctx.lineWidth = 1.05; ctx.beginPath(); ctx.arc(0, 0, 2.3, a0, a0 + 2.2); ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, 0.55 + 0.15 * Math.sin(t * 9), 0, CMP_TAU); ctx.fill();
    ctx.restore();
    return;
  }
  ctx.save(); ctx.translate(0, 0.4);
  const pulse = 1 + 0.08 * Math.sin(t * (m === 'asleep' ? 1.4 : 3.2)) + s.pop * 0.25;
  if (m === 'happy') {
    const hp = new Path2D();
    hp.moveTo(0, 2.4); hp.bezierCurveTo(-3.6, -0.2, -2.4, -3.6, 0, -1.6); hp.bezierCurveTo(2.4, -3.6, 3.6, -0.2, 0, 2.4); hp.closePath();
    ctx.scale(pulse, pulse); ctx.shadowColor = 'rgba(255,140,190,1)'; ctx.shadowBlur = 4;
    const g = ctx.createRadialGradient(0, -0.5, 0, 0, 0, 3); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#ff7aa8');
    ctx.fillStyle = g; ctx.fill(hp);
  } else if (m === 'angry' || (m === 'dizzy' && s.dizzy <= 0.3)) {
    if (m === 'dizzy') ctx.scale(0.6, 0.6);
    ctx.rotate(t * 3); ctx.shadowColor = 'rgba(255,60,80,1)'; ctx.shadowBlur = 4;
    const pts = [];
    for (let i = 0; i < 12; i++) { const r = (i % 2 ? 1.2 : 3) * (1 + 0.15 * Math.sin(t * 30 + i)); pts.push([Math.cos(i * Math.PI / 6) * r, Math.sin(i * Math.PI / 6) * r]); }
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 3); g.addColorStop(0, '#fff0f0'); g.addColorStop(1, '#ff3050');
    ctx.fillStyle = g; ctx.fill(_cmpPath(pts));
  } else if (m === 'dizzy') {
    ctx.rotate(t * 30); ctx.shadowColor = 'rgba(140,230,255,1)'; ctx.shadowBlur = 3; ctx.fillStyle = '#dff8ff';
    for (let i = 0; i < 3; i++) {
      ctx.rotate(CMP_TAU / 3); ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(2.4, -0.6, 2.6, -2.4); ctx.quadraticCurveTo(1.2, -1.2, 0, 0); ctx.fill();
    }
  } else {
    const r = (m === 'asleep' ? 1.5 : 2.4) * pulse;
    ctx.shadowColor = 'rgba(140,230,255,1)'; ctx.shadowBlur = m === 'asleep' ? 2 : 4;
    const g = ctx.createRadialGradient(0, -0.4, 0, 0, 0, r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(1, m === 'asleep' ? 'rgba(110,170,230,0.8)' : '#7fd8ff');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, CMP_TAU); ctx.fill();
  }
  ctx.restore();
}

// ─── What other modules call ─────────────────────────────────────────────────

// A long job the crystal works through: the owner calls this once at its start and once at its end.
function companionBusy(job, on) {
  if (on) _cmpBusy.add(job); else _cmpBusy.delete(job);
}

// The Settings switch, applied here and passed on to every window this one drives.
function companionSetOn(on) {
  _cmpOn = !!on;
  if (_cmp) {
    if (!_cmpOn) { _cmpStop(); cmpLeave(_cmp.s); _cmp.s.vis = 0; } else if (_cmp.inside) { cmpEnter(_cmp.s); _cmpStart(); }
  }
  if (isPlayer) return;
  if (playerWindow && !playerWindow.closed) playerWindow.postMessage({ type: 'companion', on: _cmpOn }, '*');
  if (!isPane && panesActive) broadcastToPanes({ type: 'pane-companion', on: _cmpOn });
}
