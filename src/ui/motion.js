'use strict';
// motion.js — the one code path every surface opens and closes through, by its kind (menu, popup, window, pane,
// dialog, toast), from its trigger. The rules are .claude/rules/design-system.md, "Motion"; the numbers are the
// --m-* tokens in base.css; the arithmetic is motionPlan.js.
//
// ⚠ OPEN STATE FLIPS AT THE PRESS; ONLY THE PICTURE LINGERS. A leaving surface stays in the DOM until its exit
// ends, so code asks motionOpen(el), never `hidden` or `style.display`, whether it is open.

const _moState = new WeakMap();   // el → { leaving, run, dones, restore }
const _moWhere = new WeakMap();   // el → where it last came from: it leaves to there when its close names no trigger
let _moVals = null;

function _moTokens() {
  if (_moVals) return _moVals;
  const cs = getComputedStyle(document.documentElement), v = (n) => cs.getPropertyValue('--m-' + n).trim();
  const ms = (n) => parseFloat(v(n)) || 0;
  _moVals = { curve: { enter: v('enter'), exit: v('exit') }, scale: parseFloat(v('scale')) || 1,
    window: ms('window-shift'), pane: ms('pane-shift'), popup: ms('popup-shift'), toast: ms('toast-shift'), bar: ms('bar-shift') };
  _moVals.ms = {};
  for (const k of Object.keys(MOTION_KINDS)) _moVals.ms[k] = { in: ms(k + '-in'), out: ms(k + '-out') };
  _moVals.switch = ms('pane-switch');
  _moVals.curveFn = { enter: motionCurve(_moVals.curve.enter), exit: motionCurve(_moVals.curve.exit) };
  return _moVals;
}

function _moBox(from) {
  if (!from) return null;
  if (from instanceof Element) {
    if (!from.isConnected || !from.getClientRects().length) return null;
    const r = from.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }
  if (from.left !== undefined) return { x: from.left, y: from.top, w: from.width || 0, h: from.height || 0 };
  return { x: from.x, y: from.y, w: 0, h: 0 };
}

// Every motion layers over the surface's own transform, so a surface placed by a translate keeps its place.
function _moFrame(st, z) {
  return `translate(${st.tx / z}px, ${st.ty / z}px) scale(${st.s})`;
}

function _moShown(el) { return !!el && el.isConnected && el.getClientRects().length > 0; }

// Whether a surface is open: shown and not on its way out.
function motionOpen(el) {
  const s = el && _moState.get(el);
  return _moShown(el) && !(s && s.leaving);
}

// Stops what runs on `el` and answers where it stood, so the next run starts from there.
function _moStop(el) {
  const s = _moState.get(el);
  if (!s || !s.run) return null;
  const r = s.run, elapsed = Math.min(r.ms, performance.now() - r.t0);
  const at = motionAt(r.a, r.b, r.curve, r.ms, r.opMs, elapsed, r.opCurve);
  r.anims.forEach(a => a.cancel());
  s.run = null;
  return { at, elapsed, ms: r.ms };
}

function _moPlay(el, kind, a, b, ms, opening, veil) {
  const v = _moTokens(), s = _moState.get(el), z = el.currentCSSZoom || 1;
  const moves = motionMoves(kind, v), curve = opening ? v.curve.enter : v.curve.exit;
  const opMs = motionOpacityMs(ms, opening, moves);
  // Opening, opacity runs straight and is done early; closing, it fades on the exit curve, so it starts going at once.
  const anims = [el.animate([{ opacity: a.o }, { opacity: b.o }], { duration: opMs, easing: opening ? 'linear' : curve, fill: 'both' })];
  if (moves) {
    anims.push(el.animate([{ transform: _moFrame(a, z) }, { transform: _moFrame(b, z) }],
      { duration: ms, easing: curve, fill: 'both', composite: 'add' }));
  }
  if (veil) anims.push(veil.animate([{ opacity: a.o }, { opacity: b.o }], { duration: ms, easing: 'linear', fill: 'both' }));
  s.run = { a, b, ms, opMs, curve: opening ? v.curveFn.enter : v.curveFn.exit, opCurve: opening ? undefined : v.curveFn.exit, t0: performance.now(), anims };
  return anims[moves ? 1 : 0];
}

function _moRest(el) {
  const s = _moState.get(el);
  if (!s) return;
  if (s.run) s.run.anims.forEach(a => a.cancel());
  el.style.transformOrigin = s.restore.origin;
  el.style.pointerEvents = s.restore.pe;
  if (s.veil) s.veil.style.pointerEvents = s.restore.veilPe;
  _moState.delete(el);
}

// Opens `el` by its kind. `o.from` is the trigger (an element or a point; none for a surface code opened),
// `o.reveal` makes it visible (given, a surface already open stays as it is), `o.veil` fades in with it.
// Called on a surface still leaving, it turns back from where it stands and its hide never lands.
function motionShow(el, kind, o = {}) {
  if (!el) return;
  const wasShown = _moShown(el), prev = _moState.get(el);
  if (o.reveal) o.reveal();
  if (prev && prev.leaving) {
    const v = _moTokens(), stood = _moStop(el);
    prev.leaving = false;
    prev.dones = [];
    el.style.pointerEvents = prev.restore.pe;
    if (prev.veil) prev.veil.style.pointerEvents = prev.restore.veilPe;
    const back = stood ? motionReverseMs(v.ms[kind].in, stood.elapsed, stood.ms) : v.ms[kind].in;
    const a = stood ? stood.at : prev.states.end;
    _moPlay(el, kind, a, prev.states.rest, back, true, prev.veil).finished.then(() => { if (_moState.get(el) === prev && !prev.leaving) _moRest(el); }, () => {});
    return;
  }
  if (wasShown && (o.reveal || prev)) return;
  if (prev) _moRest(el);
  if (!_moShown(el)) return;
  const v = _moTokens(), r = el.getBoundingClientRect();
  const geo = motionGeometry(kind, { x: r.left, y: r.top, w: r.width, h: r.height }, _moBox(o.from));
  const z = el.currentCSSZoom || 1;
  _moWhere.set(el, geo);
  const s = { leaving: false, run: null, dones: [], kind, veil: o.veil || null, states: motionStates(kind, v, geo),
    restore: { origin: el.style.transformOrigin, pe: el.style.pointerEvents, veilPe: o.veil ? o.veil.style.pointerEvents : '' } };
  _moState.set(el, s);
  el.style.transformOrigin = `${geo.ox / z}px ${geo.oy / z}px`;
  _moPlay(el, kind, s.states.start, s.states.rest, v.ms[kind].in, true, s.veil).finished.then(() => { if (_moState.get(el) === s && !s.leaving) _moRest(el); }, () => {});
}

// Closes `el` by its kind: it takes no clicks from the press on, and `o.done` (the real hide) runs only when the
// exit ends. `o.from` is where it leaves to; `o.glow` lights that trigger once as it goes.
function motionHide(el, kind, o = {}) {
  const done = o.done || (() => {});
  if (!el || !_moShown(el)) { done(); return; }
  let s = _moState.get(el);
  if (s && s.leaving) { s.dones.push(done); return; }
  const v = _moTokens();
  let a, ms = v.ms[kind].out;
  if (s) {
    const stood = _moStop(el);
    a = stood ? stood.at : s.states.rest;
    if (stood) ms = motionReverseMs(v.ms[kind].out, stood.elapsed, stood.ms);
    if (o.veil && !s.veil) { s.veil = o.veil; s.restore.veilPe = o.veil.style.pointerEvents; }
  } else {
    const r = el.getBoundingClientRect(), z = el.currentCSSZoom || 1, back = o.from ? null : _moWhere.get(el);
    const geo = back || motionGeometry(kind, { x: r.left, y: r.top, w: r.width, h: r.height }, _moBox(o.from));
    s = { leaving: false, run: null, dones: [], kind, veil: o.veil || null, states: motionStates(kind, v, geo),
      restore: { origin: el.style.transformOrigin, pe: el.style.pointerEvents, veilPe: o.veil ? o.veil.style.pointerEvents : '' } };
    _moState.set(el, s);
    el.style.transformOrigin = `${geo.ox / z}px ${geo.oy / z}px`;
    a = s.states.rest;
  }
  s.leaving = true;
  s.dones = [done];
  el.style.pointerEvents = 'none';
  if (s.veil) s.veil.style.pointerEvents = 'none';
  _moPlay(el, kind, a, s.states.end, ms, false, s.veil).finished.then(() => {
    if (_moState.get(el) !== s || !s.leaving) return;
    const dones = s.dones;
    s.dones = [];
    dones.forEach(f => f());
    _moRest(el);
  }, () => {});
  if (o.glow && o.from instanceof Element) motionGlow(o.from, ms);
}

// The trigger a window went into lights once, as the window reaches it.
function motionGlow(btn, exitMs) {
  const at = btn.querySelector('.rail-ind') || btn, cs = getComputedStyle(document.documentElement);
  const ring = cs.getPropertyValue('--b-icon').trim(), fill = cs.getPropertyValue('--b-tint-h').trim();
  at.animate([{ boxShadow: 'inset 0 0 0 1.5px transparent, inset 0 0 0 40px transparent' },
    { boxShadow: `inset 0 0 0 1.5px ${ring}, inset 0 0 0 40px ${fill}`, offset: 0.35 },
    { boxShadow: 'inset 0 0 0 1.5px transparent, inset 0 0 0 40px transparent' }],
  { duration: 650, delay: exitMs * 0.6, easing: 'ease-out', composite: 'add' });
}

// Content swapped inside a surface that stays (the dock's pane switch) fades in, and does not move.
function motionFade(el) {
  if (!el) return;
  el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: _moTokens().switch, easing: 'linear' });
}

// Ends whatever runs on `el` at once: a leaving surface hides now, an opening one stands at rest. For a surface
// moved or replaced outright, where a turn-back would start from the wrong place.
function motionSettle(el) {
  const s = el && _moState.get(el);
  if (!s) return;
  const dones = s.leaving ? s.dones : [];
  s.dones = [];
  dones.forEach(f => f());
  _moRest(el);
}

// ─── Rows: a list that reorders glides ───────────────────────────────────────

const _moLists = new Map();   // list root → { anims, done }: a glide running in it

// Whether `root`'s rows are gliding: a redraw now would snap them, so it waits (libHold) or re-FLIPs (motionRedraw).
function motionGliding(root) { return _moLists.has(root); }

// Measures `root`'s rows (`sel`, keyed by `keyOf`) where they stand, runs `change` (the reorder and the list's
// redraw), and glides every row from its old place to its new one on --m-move. A row mid-glide is measured where it
// stands, so a second call during a glide turns from there. `o.from` gives a key's old box (a dropped ghost's), and
// `o.done` runs once the glide ends.
function motionRows(root, sel, keyOf, change, o = {}) {
  if (!root || !root.isConnected) { change(); return; }
  const was = new Map();
  for (const el of root.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.height) was.set(keyOf(el), r);
  }
  for (const [k, r] of Object.entries(o.from || {})) if (r) was.set(k, r);
  const prev = _moLists.get(root);
  if (prev) { _moLists.delete(root); prev.anims.forEach(a => a.cancel()); }
  change();
  const v = _moTokens(), ms = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--m-list')) || 0;
  const move = getComputedStyle(document.documentElement).getPropertyValue('--m-move').trim();
  const anims = [];
  for (const el of root.querySelectorAll(sel)) {
    const a = was.get(keyOf(el));
    if (!a) continue;
    const b = el.getBoundingClientRect(), z = el.currentCSSZoom || 1;
    const dx = a.left - b.left, dy = a.top - b.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    anims.push(el.animate([{ transform: `translate(${dx / z}px, ${dy / z}px)` }, { transform: 'none' }],
      { duration: ms, easing: move || v.curve.enter, composite: 'add' }));
  }
  const done = o.done || (prev && prev.done);
  if (!anims.length) { if (done) done(); return; }
  const run = { anims, done };
  _moLists.set(root, run);
  Promise.all(anims.map(a => a.finished)).then(() => {
    if (_moLists.get(root) !== run) return;
    _moLists.delete(root);
    if (done) done();
  }, () => {});
}

// A redraw of a list that may be gliding: during a glide it re-FLIPs from where the rows stand, else it just runs.
function motionRedraw(root, sel, keyOf, change) {
  if (motionGliding(root)) motionRows(root, sel, keyOf, change);
  else change();
}
