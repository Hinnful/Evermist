'use strict';
// companionLogic.js — the crystal companion with no DOM: its moods, where it hovers, the shape it morphs to and
// the springs that carry it there. companion.js draws what this computes. Tested.

const CMP_N = 12;
const CMP_TAU = Math.PI * 2;
const _cmpDeg = d => d * Math.PI / 180;
const _cmpRot = (q, a) => [q[0] * Math.cos(a) - q[1] * Math.sin(a), q[0] * Math.sin(a) + q[1] * Math.cos(a)];
const _cmpClamp = (v, a, b) => Math.max(a, Math.min(b, v));
const CMP_ANG = Array.from({ length: CMP_N }, (_, i) => _cmpDeg(-90 + i * 30));

// Twelve outline points cast from the centre onto a polygon, so every shape morphs point for point.
function _cmpFromPoly(P) {
  return CMP_ANG.map(a => {
    const d = [Math.cos(a), Math.sin(a)];
    let best = 0;
    for (let i = 0; i < P.length; i++) {
      const p = P[i], q = P[(i + 1) % P.length], e = [q[0] - p[0], q[1] - p[1]], det = -d[0] * e[1] + e[0] * d[1];
      if (Math.abs(det) < 1e-9) continue;
      const t = (-p[0] * e[1] + e[0] * p[1]) / det, u = (d[0] * p[1] - d[1] * p[0]) / det;
      if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6) best = Math.max(best, t);
    }
    return [d[0] * best, d[1] * best];
  });
}
const _cmpFromR = f => CMP_ANG.map((a, i) => { const r = f(a, i); return [Math.cos(a) * r, Math.sin(a) * r]; });
const _cmpEllR = (rx, ry) => a => 1 / Math.sqrt((Math.cos(a) / rx) ** 2 + (Math.sin(a) / ry) ** 2);
const _cmpEll = rotA => _cmpFromR(_cmpEllR(10.5, 4)).map(p => _cmpRot(p, rotA));
const _cmpHex = (r, sx = 1, sy = 1) => Array.from({ length: 6 }, (_, i) => { const a = _cmpDeg(-90 + i * 60); return [Math.cos(a) * r * sx, Math.sin(a) * r * sy]; });

const CMP_SHAPES = {
  rest: _cmpFromPoly([[0, -10], [5.2, -3], [3.6, 6], [0, 9.6], [-3.6, 6], [-5.2, -3]]),
  moving: _cmpFromPoly([[0, -11.5], [3.7, -1], [0, 8.5], [-3.7, -1]]),
  happy: _cmpFromR((a, i) => 7 + (i % 2 ? -0.7 : 0.7)),
  click: _cmpFromPoly([[0, -6.6], [6.6, 0], [0, 6.6], [-6.6, 0]]),
  angry: _cmpFromR((a, i) => (i % 2 ? 3.6 + (i % 4 === 1 ? 0.8 : 0) : [10.6, 7.2, 9.6, 6.8, 10.2, 7.8][i / 2])),
  asleep: _cmpFromR(_cmpEllR(7.8, 4.5)),
  text: _cmpFromPoly([[-2.5, -9.5], [2.5, -9.5], [2.5, 9.5], [-2.5, 9.5]]),
  crosshair: _cmpFromR((a, i) => (i % 3 === 0 ? 9.5 : 3.6)),
  move: _cmpFromPoly([[-6.2, -6.2], [6.2, -6.2], [6.2, 6.2], [-6.2, 6.2]]),
  ew: _cmpEll(0), ns: _cmpEll(Math.PI / 2), nwse: _cmpEll(Math.PI / 4), nesw: _cmpEll(-Math.PI / 4), col: _cmpEll(0),
  rotate: _cmpFromPoly([[0, -8.5], [7.4, 4.3], [-7.4, 4.3]]),
  grab: _cmpFromPoly(_cmpHex(7.2)),
  grabbing: _cmpFromPoly(_cmpHex(7.4, 1.3, 0.7)),
  busy: _cmpFromPoly(_cmpHex(7.2)),
  collapse: _cmpFromR(() => 0.6),
};
CMP_SHAPES.dizzy = CMP_SHAPES.rest.map((p, i) => _cmpRot(p, 0.55 * Math.sin(i * 1.7)));

// Kinds that sit centred on the pointer, and the precise ones it backs off from and fades a little for.
const CMP_CENTRED = new Set(['text', 'crosshair', 'ew', 'ns', 'nwse', 'nesw', 'col']);
const CMP_PRECISE = new Set(['crosshair', 'ew', 'ns', 'nwse', 'nesw', 'col', 'rotate', 'grabbing']);

const CMP_ANGER_CLICKS = 6, CMP_ANGER_WINDOW = 1.5, CMP_ANGER_COOL = 8, CMP_ANGER_FOR = 1.7;
const CMP_DIZZY_REVS = 5, CMP_DIZZY_WINDOW = 1.2, CMP_DIZZY_COOL = 6, CMP_DIZZY_FOR = 1.0;
const CMP_HAPPY_COOL = 1.5, CMP_NAP_AFTER = 25;

function cmpCreate(rnd) {
  const r = rnd || Math.random, rand = (a, b) => a + r() * (b - a);
  return {
    rand, ready: false, t: 0, anim: rand(0, 10), idle: 0, blink: rand(1, 3), clicks: [], revs: [], lastSign: 0,
    anger: 0, dizzy: 0, pop: 0, red: 0, glow: 0.3, spin: 0, tilt: 0, zs: [], zClock: 1,
    dartClock: rand(5, 9), dart: null, mood: 'idle', open: true, sq: 0, verts: null, vv: null, mAng: 0, turn: 0,
    shape: 'rest', present: true, hidden: false, vis: 1, flash: 0, busy: false, fade: 1,
    lastAnger: -99, lastDizzy: -99, lastHappy: -99, x: 0, y: 0, vx: 0, vy: 0, pcx: 0, pcy: 0, cvx: 0, kind: 'arrow',
  };
}

function cmpEnter(s) {
  s.present = true; s.vis = 0; s.flash = 1;
  if (s.verts) s.verts.forEach(p => { p[0] *= 0.1; p[1] *= 0.1; });
}

function cmpLeave(s) { s.present = false; s.flash = 0.6; }

// Gone: left, and faded out. The frame loop stops here.
function cmpGone(s) { return !s.present && s.vis < 0.01; }

// ⚠ Only fast clicks on empty space count: a DM clicking fast to place points is working, not pestering.
function cmpClick(s, onEmpty) {
  if (!s.ready) return;
  if (onEmpty) { s.clicks = s.clicks.filter(c => s.t - c < CMP_ANGER_WINDOW); s.clicks.push(s.t); } else s.clicks = [];
  if (s.clicks.length >= CMP_ANGER_CLICKS && s.anger <= 0 && s.t - s.lastAnger > CMP_ANGER_COOL) {
    s.anger = CMP_ANGER_FOR; s.lastAnger = s.t; s.clicks = [];
  } else s.pop = 0.22;
  s.idle = 0;
}

function cmpMoodOf(s, kind, sp) {
  if (s.anger > 0) return 'angry';
  if (s.dizzy > 0) return 'dizzy';
  if (s.busy) return 'busy';
  if (s.idle > CMP_NAP_AFTER) return 'asleep';
  if (kind === 'pointer') return 'happy';
  if (sp > 30) return 'moving';
  return 'idle';
}

function cmpShapeFor(s, kind, sp) {
  if (!s.present) return 'collapse';
  if (s.mood === 'angry') return 'angry';
  if (s.mood === 'dizzy') return 'rest';
  if (s.mood === 'asleep') return 'asleep';
  if (s.mood === 'busy') return 'busy';
  if (s.pop > 0.1) return 'click';
  if (kind && kind !== 'arrow' && kind !== 'pointer' && CMP_SHAPES[kind]) return kind;
  if (kind === 'pointer') return 'happy';
  if (sp > 120) return 'moving';
  return 'rest';
}

// Where it hovers from the pointer; near the window's edge it hops to the other side.
function cmpOffset(kind, cx, cy, w, h) {
  const centred = CMP_CENTRED.has(kind), precise = CMP_PRECISE.has(kind);
  let ox = centred ? (precise ? 16 : 12) : 17, oy = centred ? (precise ? -16 : -12) : -3;
  if (cx + ox + 12 > w) ox = -Math.abs(ox) - 6;
  if (cy + oy - 12 < 0) oy = Math.abs(oy) + 20;
  if (cy + oy + 12 > h) oy = -Math.abs(oy) - 10;
  return [ox, oy];
}

// One frame. `inp`: { cx, cy, kind, w, h, still } - `kind` 'none' hides it; `still` is reduced motion.
function cmpStep(s, dt, inp) {
  const { cx, cy, kind, still } = inp;
  const ease = (v, tgt, rate) => v + (tgt - v) * (1 - Math.exp(-dt * rate));
  s.hidden = kind === 'none';
  if (!s.ready) { s.x = cx + 17; s.y = cy - 3; s.vx = 0; s.vy = 0; s.pcx = cx; s.pcy = cy; s.cvx = 0; s.ready = true; }
  s.t += dt; s.kind = kind;
  if (!still) s.anim += dt;
  const rvx = (cx - s.pcx) / dt, rvy = (cy - s.pcy) / dt;
  s.pcx = cx; s.pcy = cy;
  s.cvx += (rvx - s.cvx) * 0.5;
  const sp = Math.hypot(rvx, rvy);
  if (sp > 30) s.idle = 0; else if (kind === 'arrow' || kind === 'pointer') s.idle += dt;
  const sign = Math.abs(s.cvx) > 400 ? Math.sign(s.cvx) : 0;
  if (sign && s.lastSign && sign !== s.lastSign) s.revs.push(s.t);
  if (sign) s.lastSign = sign;
  s.revs = s.revs.filter(r => s.t - r < CMP_DIZZY_WINDOW);
  if (s.revs.length >= CMP_DIZZY_REVS && s.dizzy <= 0 && s.anger <= 0 && s.t - s.lastDizzy > CMP_DIZZY_COOL) {
    s.dizzy = CMP_DIZZY_FOR; s.lastDizzy = s.t; s.revs = [];
  }
  s.anger = Math.max(0, s.anger - dt); s.dizzy = Math.max(0, s.dizzy - dt); s.pop = Math.max(0, s.pop - dt);

  const m = cmpMoodOf(s, kind, sp);
  if (m === 'happy' && s.mood !== 'happy' && s.t - s.lastHappy > CMP_HAPPY_COOL) { s.pop = 0.18; s.lastHappy = s.t; }
  s.mood = m;

  let [ox, oy] = cmpOffset(kind, cx, cy, inp.w, inp.h);
  if (!still) {
    // A fly hovers: a small wobble, and now and then a quick dart away and back.
    ox += Math.sin(s.anim * 2.3) * 0.7 + Math.sin(s.anim * 5.9) * 0.35;
    oy += Math.sin(s.anim * 1.9 + 1) * 0.9 + Math.sin(s.anim * 6.7) * 0.3;
    if (m === 'idle' && s.idle > 3) {
      s.dartClock -= dt;
      if (s.dartClock <= 0 && !s.dart) { s.dart = { t: 0, dx: s.rand(-9, 9), dy: s.rand(-9, 5) }; s.dartClock = s.rand(6, 11); }
    }
    if (s.dart) {
      s.dart.t += dt;
      const k = s.dart.t / 0.55;
      if (k >= 1) s.dart = null; else { const b = Math.sin(Math.PI * k); ox += s.dart.dx * b; oy += s.dart.dy * b; }
    }
    if (m === 'angry') ox += Math.sin(s.anim * 55) * 0.8;
  }
  if (m === 'asleep') { ox += 3; oy += 7; }
  if (still) { s.x = cx + ox; s.y = cy + oy; s.vx = 0; s.vy = 0; } else _cmpSpring(s, dt, cx + ox, cy + oy, m);

  s.tilt = still ? 0 : ease(s.tilt, _cmpClamp(s.vx * 0.0012, -0.3, 0.3), 18);
  s.red = ease(s.red, m === 'angry' ? 1 : 0, m === 'angry' ? 12 : 3);
  s.glow = ease(s.glow, { happy: 0.65, angry: 0.6, asleep: 0.1, dizzy: 0.4, moving: 0.3, busy: 0.55 }[m] ?? 0.32, 8);
  s.vis = ease(s.vis, s.present ? 1 : 0, s.present ? 9 : 14);
  s.flash = Math.max(0, s.flash - dt * 3);
  s.fade = ease(s.fade, CMP_PRECISE.has(kind) ? 0.7 : 1, 8);
  if (m === 'dizzy' && !still) s.spin += dt * (s.dizzy > 0.3 ? 26 : 0); else s.spin = ease(s.spin, Math.round(s.spin / CMP_TAU) * CMP_TAU, 6);
  s.blink -= dt;
  if (s.blink < -0.12) s.blink = s.rand(2.5, 5);
  s.open = s.blink > 0;
  if (m === 'asleep' && !still) {
    s.zClock -= dt;
    if (s.zClock <= 0) { s.zClock = 2; s.zs.push({ x: s.x + 4, y: s.y - 5, age: 0 }); }
  } else s.zClock = 1;
  s.zs = s.zs.filter(z => (z.age += dt) < 2.2);
  s.sq = s.pop > 0 && !still ? Math.sin((1 - s.pop / 0.22) * Math.PI) * 0.16 : 0;
  _cmpMorph(s, dt, kind, sp, still);
}

// ⚠ A stiff spring needs small steps, or a slow frame throws it off.
function _cmpSpring(s, dt, tx, ty, m) {
  const K = m === 'asleep' ? 60 : 520, C = m === 'asleep' ? 14 : 38;
  for (let n = Math.ceil(dt / 0.006), h = dt / n, i = 0; i < n; i++) {
    s.vx += ((tx - s.x) * K - s.vx * C) * h; s.vy += ((ty - s.y) * K - s.vy * C) * h;
    s.x += s.vx * h; s.y += s.vy * h;
  }
}

function _cmpMorph(s, dt, kind, sp, still) {
  if (!s.verts) { s.verts = CMP_SHAPES.rest.map(p => [...p]); s.vv = CMP_SHAPES.rest.map(() => [0, 0]); }
  if (still) {
    s.shape = s.present ? 'rest' : 'collapse';
    s.verts = CMP_SHAPES[s.shape].map(p => [...p]); s.vv.forEach(v => { v[0] = 0; v[1] = 0; });
    s.mAng = 0;
    return;
  }
  s.shape = cmpShapeFor(s, kind, sp);
  const T = CMP_SHAPES[s.shape];
  for (let n = Math.ceil(dt / 0.006), h = dt / n, j = 0; j < n; j++) {
    for (let i = 0; i < CMP_N; i++) {
      const p = s.verts[i], v = s.vv[i];
      v[0] += ((T[i][0] - p[0]) * 420 - v[0] * 24) * h; v[1] += ((T[i][1] - p[1]) * 420 - v[1] * 24) * h;
      p[0] += v[0] * h; p[1] += v[1] * h;
    }
  }
  let want = 0;
  if (s.shape === 'moving') want = Math.atan2(s.vy, s.vx) + Math.PI / 2;
  if (s.shape === 'busy') want = Math.floor(s.anim / 0.3) * Math.PI / 3;
  if (s.shape === 'rotate') { s.turn += dt * 2.2; want = s.turn; } else s.turn = s.mAng;
  if (s.mood === 'dizzy' && s.dizzy > 0.3) { s.mAng += dt * 26; want = s.mAng; }
  let d = want - s.mAng;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  s.mAng += d * (1 - Math.exp(-dt * (s.mood === 'dizzy' ? 24 : s.shape === 'moving' ? 16 : 9)));
}

if (typeof module !== 'undefined') {
  module.exports = { CMP_N, CMP_SHAPES, CMP_PRECISE, cmpCreate, cmpEnter, cmpLeave, cmpGone, cmpClick, cmpMoodOf, cmpShapeFor, cmpOffset, cmpStep };
}
