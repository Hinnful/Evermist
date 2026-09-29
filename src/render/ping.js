'use strict';
// ping.js — a short-lived mark at a map point, drawn the same in the DM window and on the TV.
// Stored nowhere. Its size follows the window, never the map, so a zoomed-out TV still shows it.

const PING_LIFE = 2.6;
let _pingCanvas = null, _pingCtx = null, _pingRaf = null;
const _pings = [];

const _pingEase = t => 1 - Math.pow(1 - t, 3);
const _pingClamp = v => Math.max(0, Math.min(1, v));
// Gold at the core, paling toward white-gold as it spreads.
const _pingCol = (a, k = 0) => `rgba(255,${Math.round(200 + 40 * k)},${Math.round(110 + 120 * k)},${a})`;

function showPing(mx, my) {
  if (!mapWidth) return;
  if (!_pingCanvas) {
    _pingCanvas = document.createElement('canvas');
    _pingCanvas.id = 'ping-canvas';
    container.appendChild(_pingCanvas);
    _pingCtx = _pingCanvas.getContext('2d');
  }
  const sparks = [];
  for (let i = 0; i < 26; i++) {
    sparks.push({ ang: Math.random() * Math.PI * 2, spin: (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.9),
      dist: 0.35 + Math.random() * 0.75, rise: 0.01 + Math.random() * 0.04, delay: Math.random() * 0.45,
      life: 0.9 + Math.random() * 0.9, size: 0.0022 + Math.random() * 0.003, tw: Math.random() * 6 });
  }
  _pings.push({ mx, my, sparks, t0: performance.now() });
  _pingTick();
  _pingStart();
}

// ⚠ Rides the PixiJS ticker while a ping lives, and leaves it once none does: a loop of its own
// would run off the frame cap the map is held to.
function _pingStart() {
  if (pixiApp) { pixiApp.ticker.remove(_pingTick); pixiApp.ticker.add(_pingTick); }
  else if (!_pingRaf) _pingRaf = requestAnimationFrame(function loop() { _pingRaf = _pingTick() ? requestAnimationFrame(loop) : null; });
}

function _pingTick() {
  const { w, h } = mapAreaSize(), dpr = window.devicePixelRatio || 1;
  if (_pingCanvas.width !== Math.round(w * dpr) || _pingCanvas.height !== Math.round(h * dpr)) {
    _pingCanvas.width = Math.round(w * dpr); _pingCanvas.height = Math.round(h * dpr);
  }
  const ctx = _pingCtx, now = performance.now();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, _pingCanvas.width, _pingCanvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (let i = _pings.length - 1; i >= 0; i--) {
    const t = (now - _pings[i].t0) / 1000;
    if (t > PING_LIFE) { _pings.splice(i, 1); continue; }
    _drawPing(ctx, _pings[i], t, h);
  }
  if (!_pings.length && pixiApp) pixiApp.ticker.remove(_pingTick);
  return _pings.length > 0;
}

function _drawPing(ctx, p, t, H) {
  const x = p.mx * zoom + panX, y = p.my * zoom + panY, R = H * 0.095;
  const ease = _pingEase, clamp = _pingClamp, col = _pingCol, TAU = Math.PI * 2;
  ctx.globalCompositeOperation = 'lighter';

  const bloom = clamp(t / 0.15) * (1 - clamp((t - 0.3) / 1.6));
  if (bloom > 0) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, R * 0.7);
    g.addColorStop(0, col(0.55 * bloom)); g.addColorStop(0.35, col(0.18 * bloom)); g.addColorStop(1, col(0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R * 0.7, 0, TAU); ctx.fill();
  }

  // The bezel: two circles with ticks between them and a diamond at each quarter, turning slowly.
  const rIn = clamp(t / 0.45), ra = ease(rIn) * (1 - clamp((t - 1.5) / 0.9));
  if (ra > 0) {
    const rr = R * (0.45 + 0.13 * ease(rIn)), rot = t * 0.5, drawn = TAU * ease(rIn);
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.shadowColor = col(0.9); ctx.shadowBlur = H * 0.01;
    ctx.strokeStyle = col(0.75 * ra); ctx.lineWidth = H * 0.0022;
    ctx.beginPath(); ctx.arc(0, 0, rr, 0, drawn); ctx.stroke();
    ctx.strokeStyle = col(0.5 * ra, 0.4); ctx.lineWidth = H * 0.0014;
    ctx.beginPath(); ctx.arc(0, 0, rr * 0.8, 0, drawn); ctx.stroke();
    ctx.strokeStyle = col(0.8 * ra, 0.2); ctx.lineCap = 'round';
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU;
      if (a > drawn) break;
      const long = i % 4 === 0, r0 = rr * (long ? 0.83 : 0.88), r1 = rr * 0.96;
      ctx.lineWidth = H * (long ? 0.0018 : 0.0011);
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); ctx.stroke();
    }
    ctx.fillStyle = col(0.9 * ra, 0.3);
    const d = rr * 0.075;
    for (let i = 0; i < 4; i++) {
      ctx.save(); ctx.rotate(i * Math.PI / 2); ctx.translate(rr, 0);
      ctx.beginPath(); ctx.moveTo(d * 1.4, 0); ctx.lineTo(0, d * 0.6); ctx.lineTo(-d * 1.4, 0); ctx.lineTo(0, -d * 0.6); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.rotate(-rot * 2.4);
    ctx.strokeStyle = col(0.55 * ra, 0.6); ctx.lineWidth = H * 0.0016;
    for (const off of [0, Math.PI]) { ctx.beginPath(); ctx.arc(0, 0, rr * 0.62, off + 0.3, off + Math.PI - 0.3); ctx.stroke(); }
    ctx.restore();
  }

  for (let i = 0; i < 3; i++) {
    const k = (t * 1.5 - i * 0.3) / 1.3; if (k <= 0 || k >= 1) continue;
    const a = (1 - k) * 0.8;
    ctx.shadowColor = col(a); ctx.shadowBlur = H * 0.016;
    ctx.lineWidth = H * 0.004 * (1 - k * 0.7);
    ctx.strokeStyle = col(a, k); ctx.beginPath(); ctx.arc(x, y, R * (0.2 + ease(k) * 0.95), 0, TAU); ctx.stroke();
  }
  ctx.shadowBlur = 0;

  for (const s of p.sparks) {
    const k = (t - s.delay) / s.life; if (k <= 0 || k >= 1) continue;
    const a = s.ang + s.spin * ease(k) * 1.2, dd = R * s.dist * ease(k);
    const sx = x + Math.cos(a) * dd, sy = y + Math.sin(a) * dd * 0.8 - H * s.rise * k;
    const al = (1 - k) * (0.55 + 0.45 * Math.sin(t * 14 + s.tw)), sz = H * s.size * (1 - k * 0.5);
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, sz * 4);
    g.addColorStop(0, col(al, 0.7)); g.addColorStop(0.3, col(al * 0.5)); g.addColorStop(1, col(0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, sz * 4, 0, TAU); ctx.fill();
  }

  const dot = 1 - clamp(t / 1.4);
  if (dot > 0) { ctx.fillStyle = col(dot, 0.8); ctx.beginPath(); ctx.arc(x, y, H * 0.005, 0, TAU); ctx.fill(); }
  ctx.globalCompositeOperation = 'source-over';
}
