'use strict';
// motionPlan.js — pure kernel of the interface's motion (motion.js): where a surface grows from, which way it
// shifts, its resting, starting and leaving states, a curve read at a moment, and the time a turn-back takes.
// Values in, numbers out; the rules are in .claude/rules/design-system.md, "Motion".

// Per kind: shift names the distance token (none: scale only), scale whether it grows, aim where it grows from,
// exit how much of the way in it travels back on the way out, fade whether it fades in. A menu or popup answers a
// click and is there at once, only settling into place; a fade on something that small reads as a delay.
const MOTION_KINDS = {
  menu:   { shift: null,     scale: true,  aim: 'near',   exit: 0.5, fade: false },
  popup:  { shift: 'popup',  scale: true,  aim: 'near',   exit: 0.5, fade: false },
  window: { shift: 'window', scale: true,  aim: 'near',   exit: 1,   fade: true },
  pane:   { shift: 'pane',   scale: false, aim: 'side',   exit: 1,   fade: true },
  dialog: { shift: null,     scale: true,  aim: 'centre', exit: 0.5, fade: true },
  toast:  { shift: 'toast',  scale: false, aim: 'below',  exit: 0.5, fade: true },
  bar:    { shift: 'bar',    scale: false, aim: 'below',  exit: 1,   fade: false },
};

// The point of the surface nearest its trigger (the transform origin, relative to the surface) and the unit
// direction from the surface's centre toward the trigger. `surf` and `from` are screen boxes {x, y, w, h}; a
// point is a box of no size; `from` null is a code-opened surface, which grows from its centre.
function motionGeometry(kind, surf, from) {
  const k = MOTION_KINDS[kind];
  const cx = surf.w / 2, cy = surf.h / 2;
  if (k.aim === 'centre') return { ox: cx, oy: cy, ux: 0, uy: 0 };
  if (k.aim === 'below') return { ox: cx, oy: cy, ux: 0, uy: 1 };
  if (k.aim === 'side') {
    const right = !from || from.x + from.w / 2 >= surf.x + cx;
    return { ox: right ? surf.w : 0, oy: cy, ux: right ? 1 : -1, uy: 0 };
  }
  if (!from) return { ox: cx, oy: cy, ux: 0, uy: 0 };
  const fx = from.x + from.w / 2 - surf.x, fy = from.y + from.h / 2 - surf.y;
  const dx = fx - cx, dy = fy - cy, len = Math.hypot(dx, dy);
  return {
    ox: Math.min(Math.max(fx, 0), surf.w), oy: Math.min(Math.max(fy, 0), surf.h),
    ux: len ? dx / len : 0, uy: len ? dy / len : 0,
  };
}

// The three states a surface passes through: at rest, where it starts on the way in, where it ends on the way
// out. `vals` holds the distances in screen px by token name and `scale`; a state is { tx, ty, s, o }.
function motionStates(kind, vals, geo) {
  const k = MOTION_KINDS[kind];
  const d = k.shift ? vals[k.shift] : 0, s0 = k.scale ? vals.scale : 1;
  const at = (part, o) => ({ tx: geo.ux * d * part, ty: geo.uy * d * part, s: 1 - (1 - s0) * part, o });
  return { rest: { tx: 0, ty: 0, s: 1, o: 1 }, start: at(1, k.fade ? 0 : 1), end: at(k.exit, 0) };
}

// Whether a kind moves at all, past its opacity.
function motionMoves(kind, vals) {
  const k = MOTION_KINDS[kind];
  return k.scale && vals.scale !== 1 || !!k.shift && vals[k.shift] !== 0;
}

// Opacity runs on its own straight line; on the way in it is done by a third of the movement, so a surface reads as there at once.
function motionOpacityMs(ms, opening, moves) { return opening && moves ? ms / 3 : ms; }

// A cubic-bezier curve as a function of time 0..1, as CSS reads one.
function motionBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const xAt = (u) => ((ax * u + bx) * u + cx) * u;
  const yAt = (u) => ((ay * u + by) * u + cy) * u;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let lo = 0, hi = 1, u = t;
    for (let i = 0; i < 40; i++) {
      const x = xAt(u);
      if (Math.abs(x - t) < 1e-6) break;
      if (x < t) lo = u; else hi = u;
      u = (lo + hi) / 2;
    }
    return yAt(u);
  };
}

// A CSS curve value read into a function; anything but cubic-bezier() is the straight line.
function motionCurve(css) {
  const m = /cubic-bezier\(([^)]*)\)/.exec(css || '');
  if (!m) return (t) => Math.min(Math.max(t, 0), 1);
  const p = m[1].split(',').map(parseFloat);
  return motionBezier(p[0], p[1], p[2], p[3]);
}

// Where a surface stands `elapsed` ms into a run from `a` to `b`: movement on `curve` over `ms`, opacity on the
// straight line over `opMs`.
function motionAt(a, b, curve, ms, opMs, elapsed, opCurve = (t) => t) {
  const m = curve(ms ? Math.min(Math.max(elapsed / ms, 0), 1) : 1);
  const o = opCurve(opMs ? Math.min(Math.max(elapsed / opMs, 0), 1) : 1);
  return { tx: a.tx + (b.tx - a.tx) * m, ty: a.ty + (b.ty - a.ty) * m, s: a.s + (b.s - a.s) * m, o: a.o + (b.o - a.o) * o };
}

// A surface turned back part way takes the other direction's time for the part it covered, so the turn has the
// same speed as a full run and never jumps.
function motionReverseMs(fullMs, elapsed, ranMs) {
  const part = ranMs ? Math.min(Math.max(elapsed / ranMs, 0), 1) : 1;
  return Math.max(1, Math.round(fullMs * part));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MOTION_KINDS, motionGeometry, motionStates, motionMoves, motionOpacityMs, motionBezier, motionCurve, motionAt, motionReverseMs };
}
