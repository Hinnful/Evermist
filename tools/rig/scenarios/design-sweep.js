// The interface audit: every entry of tools/rig/inventory.js opened in every state it lists, and checked.
// Kept, unlike a build's scenario, by the DM's call: a change to the interface is done only when this is clean.
// Run with --dm-size 1280x1500 so the dock's panes fit unscrolled. DS_SHOTS=<folder> also writes a 2x close-up
// of each entry in each state, the faults to faults.txt and what could not be checked to unchecked.txt.
//
// Criteria:
// - Every entry opens; one that does not is named and fails the run.
// - A row's bare texts stay within 1.5x of each other in size (a button's or a plate's text is not bare), and no glyph
//   without capitals (✓ › + ×, in text or in ::before/::after) is written as text beside text.
// - Every row, shot at 4 device pixels per CSS pixel with the entry moved down by 0, 0.25, 0.5 and 0.75px, stands as
//   the rule says, on the mean of the four (the same wherever the window lands): its texts on one baseline whatever
//   their sizes, within one device pixel; a box, an icon, a glyph or an unfilled button's text within 0.25px of the
//   capitals of the row's main (largest) text, and within 1.5px at any one position; in a row with no text, its boxes
//   within 0.25px of each other as laid out, or by their painted edges. A row's item that holds text on
//   several lines and is no box (a heading over its source, a label column) stands in the row as laid out, by the
//   middle of its first line box's top and its last one's bottom. An item a scroll edge cuts shows only part of itself
//   and is not read; the entry's note names its row.
// - A vertical divider (1px of the line token) runs its container's full height.
// - A plate inside anything the pointer lights never merges with what it lies on, and stands off it under the
//   pointer at least as well as at rest.
// - No control is the browser's own, and text in a filled control keeps 6px from its sides.
// - Nothing but the toggled box moves when an entry's state changes.
// - Every right-click menu has the same row height on screen, and none is narrower than the skin.
// - Every entry opens by a real click on its trigger where it has one (scrolled to first when it sits past its pane's
//   fold, as the DM scrolls to it), and moves by its kind's values
//   (design-system.md, "Motion"): its duration, curve, scale and shift; its origin on its trigger's side (a pane's
//   shift from the rail, a toast's from below, a dialog's about its centre); it ends at rest, at opacity 1 with
//   nothing running; it leaves faster than it came, on its kind's exit, taking no clicks. A `still` entry does not move.
// - Every entry that moves is seen whole within its fade plus 50ms of the press (or the call), and at rest within its
//   entry plus 50ms, each plus one frame for the reading; a late entry is opened twice more and judged on the middle
//   of the three; the times are listed, and written to times.txt.
// - A surface with a pop or window shadow that shows during the sweep without an inventory entry fails.
// - Every floating surface stays 8px inside a small window from every spot its anchor can take, scrolls what does not
//   fit and comes back inside when the window shrinks (fit.js). DS_FIT=only runs this pass alone, and stamps nothing.
// Every check waits for each surface's motion to end (every running animation that is not a Loop), so nothing is
// measured mid-flight.
const lib = require('../lib');
const path = require('path');
const fs = require('fs');
const { SETUP, INVENTORY, CLOSE_ALL } = require('../inventory');
const { fitPass } = require('../fit');
const { runRoot } = require('../../../.claude/commit/runRoot');

// The ink prints that read clean (lib.inkPrint), shared by every session and worktree on this machine. A state whose
// print is here is not shot again: its rows, letters and paint are the ones that passed. DS_FULL=1 reads every row.
const ROOT = path.resolve(__dirname, '../../..');
const CLEAN = path.join(runRoot(ROOT) || ROOT, '.claude', 'commit', 'runs', 'sweep-ink-clean.json');
const readClean = () => { try { return JSON.parse(fs.readFileSync(CLEAN, 'utf8')); } catch { return {}; } };

// Every animation motion.js starts, logged as it starts (its element, keyframes, timing, transform origin, whether it
// takes clicks, the box it stood in), and every opacity transition a stylesheet is running when a run is read.
const RECORDER = `globalThis.__mv = (() => {
  let log = [], held = null;
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (kf, opt) {
    const o = typeof opt === 'number' ? { duration: opt } : (opt || {});
    log.push({ el: this, kf: Array.isArray(kf) ? kf : [], dur: o.duration, easing: o.easing || 'linear', origin: this.style.transformOrigin,
      pe: getComputedStyle(this).pointerEvents, rect: this.getBoundingClientRect(), z: this.currentCSSZoom || 1 });
    return animate.call(this, kf, opt);
  };
  // An opacity transition a stylesheet runs, read while it runs.
  const fromCss = a => {
    const el = a.effect.target, k = a.effect.getKeyframes(), t = a.effect.getTiming();
    return { el, anim: a, css: true, kf: [{ opacity: +k[0].opacity }, { opacity: +k[k.length - 1].opacity }], dur: t.duration, easing: t.easing,
      pe: getComputedStyle(el).pointerEvents, rect: el.getBoundingClientRect(), z: el.currentCSSZoom || 1 };
  };
  const near = (el, root) => el === root ? 0 : el.contains(root) ? 1 : root.contains(el) ? 2 : -1;
  const tr = s => { const m = /translate\\(([-\\d.e]+)px, ([-\\d.e]+)px\\) scale\\(([\\d.e]+)\\)/.exec(s || ''); return m ? { tx: +m[1], ty: +m[2], s: +m[3] } : null; };
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  // From the press (or the call, for a surface code opens) to the first frame the surface is fully seen, and to the
  // first frame it is at rest. Opacity is the product up its ancestors, so a surface inside a moving row counts too.
  let timing = null;
  const seen = el => { if (!el || !el.getClientRects().length) return false; let o = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.visibility === 'hidden' || cs.display === 'none') return false; o *= +cs.opacity; }
    return o >= 0.99; };
  const busy = el => document.getAnimations().some(a => a.playState === 'running' && a.effect && a.effect.target &&
    near(a.effect.target, el) >= 0 && near(a.effect.target, el) <= 1 && a.effect.getComputedTiming().iterations !== Infinity);
  return {
    watch(sel, onPress) {
      const t = timing = { sel, t0: onPress ? 0 : performance.now(), seen: null, rest: null };
      if (onPress) document.addEventListener('mousedown', ev => { t.t0 = ev.timeStamp; }, { capture: true, once: true });
      const f = now => { if (timing !== t) return; const el = document.querySelector(sel);
        if (t.t0 && seen(el)) { if (t.seen === null) t.seen = Math.round(now - t.t0); if (!busy(el)) { t.rest = Math.round(now - t.t0); return; } }
        if (!t.t0 || now - t.t0 < 3000) requestAnimationFrame(f); };
      requestAnimationFrame(f);
      return 1;
    },
    timing() { return timing && { seen: timing.seen, rest: timing.rest }; },
    reset() { log = []; },
    hold(sel) { held = document.querySelector(sel); return !!held; },
    tokens() {
      const ms = n => parseFloat(css('--m-' + n)) || 0, k = {};
      for (const n of ['menu', 'popup', 'window', 'pane', 'dialog', 'toast', 'bar', 'layer']) k[n] = { in: ms(n + '-in'), out: ms(n + '-out') };
      return { ms: k, enter: css('--m-enter'), exit: css('--m-exit'), scale: parseFloat(css('--m-scale')),
        shift: { window: ms('window-shift'), pane: ms('pane-shift'), popup: ms('popup-shift'), toast: ms('toast-shift'), bar: ms('bar-shift') } };
    },
    // The run of the held surface: its transform (or, with none, its opacity) nearest it, opening or closing.
    take(opening) {
      const root = held, enter = css('--m-enter'), exit = css('--m-exit');
      if (!root) return null;
      const running = document.getAnimations().filter(a => a instanceof CSSTransition && a.transitionProperty === 'opacity' && a.effect.target).map(fromCss);
      const mine = log.concat(running).filter(r => near(r.el, root) >= 0 && !r.kf.some(f => 'boxShadow' in f));
      const moves = mine.filter(r => r.kf.some(f => 'transform' in f) && r.easing === (opening ? enter : exit));
      const fades = mine.filter(r => r.kf.some(f => 'opacity' in f) && (r.kf[r.kf.length - 1].opacity > r.kf[0].opacity) === opening);
      const rank = (a, b) => near(a.el, root) - near(b.el, root) || (near(a.el, root) === 1 ? (a.el.contains(b.el) ? 1 : -1) : 0);
      const r = (moves.length ? moves : fades).sort(rank)[0];
      if (!r) return null;
      const f = tr((opening ? r.kf[0] : r.kf[r.kf.length - 1]).transform) || { tx: 0, ty: 0, s: 1 };
      const op = fades.filter(x => x.el === r.el)[0];
      const o = (r.origin || '').split(' ').map(parseFloat);
      const b = r.rect;
      return { near: near(r.el, root), css: !!r.css, moves: moves.length > 0, dur: r.dur, easing: r.easing, tx: f.tx * r.z, ty: f.ty * r.z, s: f.s,
        ox: Number.isFinite(o[0]) ? b.left + o[0] * r.z : null, oy: Number.isFinite(o[1]) ? b.top + o[1] * r.z : null,
        cx: b.left + b.width / 2, cy: b.top + b.height / 2, pe: r.pe, opDur: op ? op.dur : null,
        what: r.el.tagName.toLowerCase() + (r.el.id ? '#' + r.el.id : '') };
    },
    // Whether the held surface's run has ended: nothing but a Loop running on it or round it, and fully opaque. What
    // runs inside it (the undo toast's timer bar) is its content, not its motion.
    rested() {
      const root = held;
      if (!root || !root.isConnected) return 'gone';
      const run = document.getAnimations().filter(a => a.playState === 'running' && a.effect && a.effect.target &&
        near(a.effect.target, root) >= 0 && near(a.effect.target, root) <= 1 &&
        a.effect.getComputedTiming().iterations !== Infinity);
      return run.length ? run.length + ' animation(s) still running' : +getComputedStyle(root).opacity < 0.999 ? 'opacity ' + getComputedStyle(root).opacity : '';
    },
    // Everything on screen with the pop or the window shadow.
    shadowed() {
      const probe = document.createElement('div');
      document.body.appendChild(probe);
      const vals = ['--pop-shadow', '--win-shadow'].map(v => { probe.style.boxShadow = 'var(' + v + ')'; return getComputedStyle(probe).boxShadow; });
      probe.remove();
      return [...document.querySelectorAll('body *')].filter(el => {
        if (!el.getClientRects().length) return false;
        const cs = getComputedStyle(el);
        return vals.includes(cs.boxShadow) && cs.visibility !== 'hidden' && +cs.opacity > 0;
      });
    },
  };
})(); 1`;

const KINDS = ['menu', 'popup', 'window', 'pane', 'dialog', 'toast', 'bar', 'layer'];
const SCALES = { menu: true, popup: true, window: true, pane: false, dialog: true, toast: false, bar: false, layer: false };
const SHIFTS = { menu: null, popup: 'popup', window: 'window', pane: 'pane', dialog: null, toast: 'toast', bar: 'bar', layer: null };
// Which kinds fade in; a menu, popup or bar is there at once.
const FADES = { menu: false, popup: false, window: true, pane: true, dialog: true, toast: true, bar: false, layer: true };
const EXIT_PART = { menu: 0.5, popup: 0.5, window: 1, pane: 1, dialog: 0.5, toast: 0.5, bar: 1, layer: 0 };
const r1 = n => Math.round(n * 10) / 10;

// The kind a run's numbers look like, to name what moved where nothing should.
function kindOf(T, run, phase) {
  const k = KINDS.filter(n => Math.abs(T.ms[n][phase] - run.dur) < 1.5);
  return k.length > 1 ? k.find(n => SCALES[n] === (run.s < 0.999)) || k[0] : k[0] || null;
}

// What is wrong with an entry's run against its kind and its trigger (a point, or null for none).
function judgeIn(T, kind, run, trig) {
  const f = [];
  if (kind === 'still') return run && run.near <= 1 ? ['moves as ' + (kindOf(T, run, 'in') || run.dur + 'ms') + ' on ' + run.what + ', though it is still'] : [];
  if (!run) return ['opened with no motion'];
  // Two kinds may share a duration, so the run is held to its own kind's values; scale, shift and origin below tell kinds apart.
  if (Math.abs(T.ms[kind].in - run.dur) >= 1.5) f.push('opens in ' + run.dur + 'ms, not the ' + T.ms[kind].in + 'ms of a ' + kind);
  if (run.css) return f;
  if (run.easing !== T.enter) f.push('opens on ' + run.easing + ', not --m-enter');
  const s = SCALES[kind] ? T.scale : 1;
  if (Math.abs(run.s - s) > 0.005) f.push('starts at scale ' + run.s + ', not ' + s);
  // Opened from code with no trigger, a menu, popup or window grows from its centre and does not shift.
  const d = SHIFTS[kind] && (trig || kind === 'pane' || kind === 'toast' || kind === 'bar') ? T.shift[SHIFTS[kind]] : 0, shift = Math.hypot(run.tx, run.ty);
  if (Math.abs(shift - d) > 0.75) f.push('starts ' + r1(shift) + 'px off, not ' + d + 'px');
  if (run.opDur != null && Math.abs(run.opDur - run.dur / 3) > 1.5) f.push('fades in over ' + run.opDur + 'ms, not a third of its ' + run.dur + 'ms');
  const o = run.ox != null ? { x: run.ox, y: run.oy } : { x: run.cx, y: run.cy }, c = { x: run.cx, y: run.cy };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  if (kind === 'pane') {
    if (trig && Math.sign(run.tx) !== Math.sign(trig.x - c.x)) f.push('slides from ' + (run.tx > 0 ? 'the right' : 'the left') + ', away from the rail');
  } else if (kind === 'toast' || kind === 'bar') {
    if (!(run.ty > 0) || Math.abs(run.tx) > 0.5) f.push('starts ' + r1(run.tx) + ',' + r1(run.ty) + 'px off, not from below');
  } else if (kind === 'dialog' || !trig) {
    if (dist(o, c) > 1) f.push('grows from ' + r1(o.x) + ',' + r1(o.y) + ', not its centre ' + r1(c.x) + ',' + r1(c.y));
  } else {
    if (!(dist(o, trig) < dist(c, trig) - 1)) f.push('grows from ' + r1(o.x) + ',' + r1(o.y) + ', not its side nearest the trigger at ' + r1(trig.x) + ',' + r1(trig.y));
    if (d && !((run.tx * (trig.x - c.x) + run.ty * (trig.y - c.y)) > 0)) f.push('starts ' + r1(run.tx) + ',' + r1(run.ty) + 'px off, away from its trigger');
  }
  return f;
}

function judgeOut(T, kind, inn, run, trig) {
  if (kind === 'still') return [];
  if (!run) return ['closed with no motion'];
  const f = [];
  if (Math.abs(T.ms[kind].out - run.dur) >= 1.5) f.push('closes in ' + run.dur + 'ms, not the ' + T.ms[kind].out + 'ms of a ' + kind);
  if (inn && !(run.dur < inn.dur)) f.push('leaves in ' + run.dur + 'ms, not faster than its ' + inn.dur + 'ms entry');
  if (run.css) return f;
  if (run.easing !== T.exit) f.push('closes on ' + run.easing + ', not --m-exit');
  if (run.pe !== 'none') f.push('takes clicks while it leaves');
  const d = SHIFTS[kind] && (trig || kind === 'pane' || kind === 'toast' || kind === 'bar') ? T.shift[SHIFTS[kind]] * EXIT_PART[kind] : 0, shift = Math.hypot(run.tx, run.ty);
  if (Math.abs(shift - d) > 0.75) f.push('leaves ' + r1(shift) + 'px off, not ' + d + 'px');
  return f;
}

module.exports = async function (rig) {
  const T_START = Date.now(), spent = {}, perEntry = [];
  const timed = async (step, fn) => { const t = Date.now(); try { return await fn(); } finally { spent[step] = (spent[step] || 0) + Date.now() - t; } };
  await lib.inRussian(rig);
  await lib.importWithPlan(rig, 'Склеп');
  const dm = rig.dm;
  const shots = process.env.DS_SHOTS;
  if (shots) {
    fs.mkdirSync(shots, { recursive: true });
    const [w, h] = await dm.evaluate('[innerWidth, innerHeight]');
    await dm.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false });
  }
  await timed('setup', () => dm.evaluate('(async () => { ' + SETUP + ' })()'));
  spent.boot = Date.now() - T_START - spent.setup;
  const all = new Map(), unchecked = [], menus = {}, times = [], inkRows = [];
  const clean = process.env.DS_FULL ? {} : readClean(), passed = {};
  let reused = 0, shot = 0;
  let inkMs = 0;
  const fault = (where, f) => { if (!all.has(f)) all.set(f, where); };
  const run = js => dm.evaluate('(async () => { ' + js + ' })()');
  // Resolves when every running animation that is not a Loop has finished, read from the animations' own promises
  // rather than polled; a chain that keeps starting new ones is cut at 3s and printed, as a settle's bound is.
  const still = async () => { if (!(await dm.evaluate(`(async () => { const end = performance.now() + 3000;
    for (;;) { const run = document.getAnimations().filter(a => a.playState === 'running' && a.effect.getComputedTiming().iterations !== Infinity);
      if (!run.length) return true; const left = end - performance.now(); if (left <= 0) return false;
      await Promise.race([Promise.allSettled(run.map(a => a.finished)), new Promise(r => setTimeout(r, left))]); } })()`)))
    console.log('  (a wait ran its whole 3 s: the running animations)'); };
  const visible = sel => dm.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false;
    const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; })()`);

  await dm.evaluate(RECORDER);
  const T = await dm.evaluate('__mv.tokens()');
  const q = JSON.stringify;
  const listed = INVENTORY.flatMap(e => [e.root].concat(e.kin ? [e.kin] : []));
  const unlisted = async where => (await dm.evaluate(`__mv.shadowed().filter(el => !${q(listed)}.some(r => el.matches(r) || el.closest(r) || el.querySelector(r)))
    .map(el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + el.classList[0] : ''))`))
    .forEach(x => fault(where, 'shows ' + x + ', a surface with a pop or window shadow and no inventory entry'));
  // Where a trigger stands on screen: a selector's first line box (and what lies on top of it there), a room of the
  // open map, or a point.
  const aim = t => dm.evaluate(`(() => { const t = ${q(t)};
    if (t.map != null || t.effect) { const v = t.effect ? __fxMake().vertices : polygons.filter(p => !p.material && !p.light)[t.map].vertices;
      const p = toScreen(v.reduce((a, b) => a + b.x, 0) / v.length, v.reduce((a, b) => a + b.y, 0) / v.length), c = viewToClient(p.sx, p.sy);
      return { x: c.x, y: c.y }; }
    if (t.x != null) return { x: t.x, y: t.y };
    const e = document.querySelector(t.sel || t); if (!e) return null;
    // A trigger below its pane's fold is scrolled to first, as the DM scrolls to it.
    let r = e.getClientRects()[0]; if (!r || !r.width) return null;
    if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) { e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); r = e.getClientRects()[0]; }
    const x = r.left + r.width / 2, y = r.top + r.height / 2, h = document.elementFromPoint(x, y);
    return { x, y, covered: e.contains(h) ? '' : h ? h.tagName.toLowerCase() + '#' + h.id + '.' + h.classList[0] : 'nothing' }; })()`);
  const click = async (p, button) => {
    await dm.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
    await dm.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button, buttons: button === 'right' ? 2 : 1, clickCount: 1 });
    await dm.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button, buttons: 0, clickCount: 1 });
  };
  const frames = () => dm.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  // One frame, as the page paints them. A time is read on frames, and a motion whose length is a whole number of frames
  // ends on that frame or the next by sub-millisecond jitter, so each budget carries one frame for the reading.
  const FRAME = await dm.evaluate(`new Promise(r => { const t = []; const f = n => { t.push(performance.now());
    if (n) requestAnimationFrame(() => f(n - 1)); else { const d = t.slice(1).map((v, i) => v - t[i]).sort((a, b) => a - b); r(d[d.length >> 1]); } };
    requestAnimationFrame(() => f(12)); })`);

  const fitOnly = process.env.DS_FIT === 'only';
  // An entry marked fitOnly is read inside another entry and opened alone only by the fit pass.
  for (const e of fitOnly ? [] : INVENTORY.filter(x => !x.fitOnly)) {
    const tEntry = Date.now(), tOpen = Date.now();
    try {
      if (!KINDS.concat('still').includes(e.motion)) fault(e.id, 'has no motion kind in tools/rig/inventory.js');
      if (e.prep) { await run(e.prep); await still(); }
      const clicked = !!e.trigger && (typeof e.trigger === 'string' || !!e.trigger.sel || e.trigger.map != null || !!e.trigger.effect);
      const open = async () => {
        let at = null;
        await dm.evaluate('__mv.reset(); 1');
        await dm.evaluate(`__mv.watch(${q(e.root)}, ${clicked})`);
        if (clicked) {
          at = await aim(e.trigger);
          if (!at || at.covered) throw new Error('its trigger ' + q(e.trigger) + (at ? ' is covered by ' + at.covered : ' is not on screen'));
          if (e.trigger.hover) await dm.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
          else await click(at, e.trigger.button || 'left');
          if (e.trigger.text) await dm.send('Input.insertText', { text: e.trigger.text });
        } else {
          await run(e.open || '');
          at = e.trigger ? await aim(e.trigger) : e.from ? await aim(e.from) : null;
        }
        // `origin`: page JS naming the point the surface truly comes from (a caret, a corner), when it is not the trigger's box.
        if (e.origin) at = await dm.evaluate(e.origin) || at;
        await lib.settle(dm, `(e => !!e && e.getClientRects().length > 0)(document.querySelector(${q(e.root)}))`, 3000);
        await frames();
        await dm.evaluate(`__mv.hold(${q(e.root)})`);
        const took = await dm.evaluate('__mv.take(true)');
        await still();
        return { at, took };
      };
      const { at: trig, took: inn } = await open();
      if (!(await visible(e.root))) { unchecked.push(e.id + ': did not open'); await run(e.close || '').catch(() => {}); continue; }
      spent.open = (spent.open || 0) + Date.now() - tOpen;
      judgeIn(T, e.motion, inn, trig).forEach(f => fault(e.id, f));
      if (e.motion !== 'still') {
        const k = T.ms[e.motion], seenBy = (FADES[e.motion] ? k.in / 3 : 0) + 50 + FRAME, restBy = k.in + 50 + FRAME;
        const late = t => !t || t.seen === null || t.seen > seenBy || (t.rest !== null && t.rest > restBy);
        const tries = [await dm.evaluate('__mv.timing()')];
        // A late open is opened twice more and judged on the middle of the three: another session's load on this machine
        // delays one open by a frame or more, and a surface that is truly slow is late every time.
        for (let i = 0; i < 2 && late(tries[0]); i++) {
          await run((e.close || '') + CLOSE_ALL); await frames(); await still();
          await open();
          tries.push(await dm.evaluate('__mv.timing()'));
        }
        const mid = f => { const v = tries.map(f).sort((x, y) => x - y)[Math.floor(tries.length / 2)]; return v === Infinity ? null : v; };
        const tm = tries.some(Boolean) && { seen: mid(t => (t && t.seen !== null ? t.seen : Infinity)), rest: mid(t => (t && t.rest !== null ? t.rest : -1)) };
        if (tm && tm.rest === -1) tm.rest = null;
        if (tries.length > 1) rig.note(e.id + ': opened ' + tries.length + ' times, seen ' + tries.map(t => t && t.seen).join(', ') + 'ms');
        times.push({ id: e.id, kind: e.motion, by: clicked ? 'click' : 'call', seen: tm && tm.seen, rest: tm && tm.rest, seenBy, restBy });
        if (!tm || tm.seen === null) fault(e.id, 'was never seen whole within 3s of the ' + (clicked ? 'press' : 'call'));
        else {
          if (tm.seen > seenBy) fault(e.id, 'is seen whole ' + tm.seen + 'ms after the ' + (clicked ? 'press' : 'call') + ', over its ' + Math.round(seenBy) + 'ms');
          if (tm.rest !== null && tm.rest > restBy) fault(e.id, 'comes to rest ' + tm.rest + 'ms after the ' + (clicked ? 'press' : 'call') + ', over its ' + Math.round(restBy) + 'ms');
        }
      }
      if (e.motion !== 'still') { const r = await dm.evaluate('__mv.rested()'); if (r) fault(e.id, 'is not at rest once its motion ends: ' + r); }
      rig.note(e.id + ': ' + e.motion + (inn ? ' ' + inn.dur + 'ms on ' + inn.what + ', from ' + r1(inn.tx) + ',' + r1(inn.ty) + 'px at scale ' + inn.s : ', no motion') +
        (trig ? ', trigger at ' + Math.round(trig.x) + ',' + Math.round(trig.y) : ''));
      for (const st of e.states || [{ name: 'rest', set: '' }]) {
        const where = e.id + (st.name === 'rest' ? '' : ' (' + st.name + ')');
        await timed('state', async () => { await run(st.set); await frames(); await still(); });
        await timed('unlisted', () => unlisted(where));
        let { rows, faults, ink, cut } = await timed('align', () => lib.alignSweep(dm, e.root));
        const t0 = Date.now();
        const print = await lib.inkPrint(dm, ink);
        let inked = clean[print] ? { faults: [], measured: [], unmoved: [], reused: true } : await lib.inkSweep(dm, ink);
        // An entry a late answer grew (a footer shown once a check returns) is found again where it now stands.
        for (let k = 0; inked.relaid && k < 2; k++) {
          await still();
          ({ rows, faults, ink, cut } = await lib.alignSweep(dm, e.root));
          inked = await lib.inkSweep(dm, ink);
        }
        inkMs += Date.now() - t0; spent.ink = (spent.ink || 0) + Date.now() - t0;
        if (inked.reused) reused++;
        else {
          shot++;
          if (!inked.relaid && !inked.unmoved.length && !inked.faults.length) passed[await lib.inkPrint(dm, ink)] = Date.now();
        }
        if (inked.relaid) { unchecked.push(where + ': its layout kept changing while its rows were read'); inked = { faults: [], measured: [], unmoved: [] }; }
        inkRows.push(...inked.measured.map(m => Object.assign({ where }, m)));
        inked.unmoved.forEach(u => unchecked.push(where + ': no layout offset moved its root (' + u + '), so its rows were judged at one position'));
        const hover = await timed('hover', () => lib.hoverSweep(dm, e.root));
        const surface = await timed('surface', () => lib.surfaceSweep(dm, e.root));
        rig.note(where + ': ' + rows + ' rows, ' + faults.length + ' mixed or capless; ' + (inked.reused ? 'ink as at its last clean read; ' :
          inked.measured.length + ' inked, ' + inked.faults.length + ' off; ') +
          hover.hosts + ' lit, ' + hover.faults.length + ' swallowed; ' + surface.length + ' controls off' +
          (cut.length ? '; ' + cut.length + ' rows a scroll edge cuts, their cut items not read: ' + cut.join(', ') : ''));
        faults.concat(inked.faults, hover.faults, surface).forEach(f => fault(where, f));
        if (shots) {
          const r = await dm.evaluate(`(() => { const b = document.querySelector(${JSON.stringify(e.root)}).getBoundingClientRect();
            return { x: Math.max(0, b.x - 8), y: Math.max(0, b.y - 8), width: Math.min(innerWidth, b.width + 16), height: Math.min(innerHeight - Math.max(0, b.y - 8), b.height + 16 + ${e.below || 0}) }; })()`);
          await dm.screenshot(path.join(shots, where.replace(/[^\w-]+/g, '_') + '.png'), r);
        }
      }
      const tClose = Date.now();
      await still();
      for (const sh of e.shifts || []) (await lib.shiftSweep(dm, sh.root || e.root, sh.run, sh.except)).forEach(f => fault(e.id + ' (' + sh.name + ')', f));
      if (e.menu) menus[e.id] = await dm.evaluate(`(() => { const m = document.querySelector(${JSON.stringify(e.root)}), r = m.getBoundingClientRect(),
        i = m.querySelector('.sm-mi, [data-i]').getBoundingClientRect(); return { w: Math.round(r.width), row: +i.height.toFixed(1) }; })()`);
      await dm.evaluate(`__mv.hold(${q(e.root)}); __mv.reset(); 1`);
      await run(e.close || '');
      await frames();
      // A surface that closes on the next render (a map selection cleared) starts its exit a frame or two late, so its
      // exit is read on each frame for up to a second; one that truly closes with no motion costs that second.
      const out = e.motion === 'still' ? null : await dm.evaluate(`new Promise(r => { const t0 = performance.now();
        const f = () => { const x = __mv.take(false); if (x || performance.now() - t0 > 1000) r(x); else requestAnimationFrame(f); }; f(); })`);
      judgeOut(T, e.motion, inn, out, trig).forEach(f => fault(e.id + ' (closing)', f));
      await run(CLOSE_ALL);
      await frames();
      await still();
      spent.close = (spent.close || 0) + Date.now() - tClose;
    } catch (err) {
      unchecked.push(e.id + ': ' + err.message.split('\n')[0]);
      await run((e.close || '') + CLOSE_ALL).catch(() => {});
    }
    perEntry.push([e.id, (e.states || [1]).length, Date.now() - tEntry]);
  }
  spent.total = Date.now() - T_START;
  // Kept newest first and capped, so the file never grows past what a few weeks of work leave behind.
  const merged = Object.entries(Object.assign(readClean(), passed)).sort((a, b) => b[1] - a[1]).slice(0, 3000);
  fs.mkdirSync(path.dirname(CLEAN), { recursive: true });
  fs.writeFileSync(CLEAN, JSON.stringify(Object.fromEntries(merged)) + '\n');
  rig.note('ink: ' + shot + ' states shot, ' + reused + ' unchanged since a clean read');
  rig.note('time by step (s): ' + Object.entries(spent).map(([k, v]) => k + ' ' + (v / 1000).toFixed(1)).join(', '));
  rig.note('slowest entries (s): ' + perEntry.sort((a, b) => b[2] - a[2]).slice(0, 5).map(([id, n, ms]) => id + ' ' + (ms / 1000).toFixed(1) + ' (' + n + ' states)').join(', '));

  // Each fit fault and each surface the pass could not open is its own failed check, so a run names every one of them
  // even when the runner keeps no notes (a first attempt that is rerun).
  const fit = await fitPass(rig, dm, { base: process.env.DS_FIT_BASE, save: process.env.DS_FIT_SAVE });
  fit.faults.forEach(f => rig.check(false, 'fit fault: ' + f));
  fit.unchecked.forEach(x => rig.check(false, 'fit unchecked: ' + x));
  rig.note('fit pass: ' + fit.faults.length + ' faults, ' + fit.unchecked.length + ' unchecked, ' + Object.keys(fit.mids).length + ' middle places compared');
  if (shots) fs.writeFileSync(path.join(shots, 'fit-faults.txt'), fit.faults.concat(fit.unchecked).join('\n') + '\n');

  const list = [...all].map(([f, where]) => where + ' — ' + f);
  const timeRows = times.map(t => t.id.padEnd(24) + t.kind.padEnd(8) + t.by.padEnd(7) + 'seen ' + String(t.seen).padStart(4) + 'ms (by ' + Math.round(t.seenBy) +
    ')  rest ' + String(t.rest).padStart(4) + 'ms (by ' + Math.round(t.restBy) + ')');
  rig.note('times from the press:\n    ' + timeRows.join('\n    '));
  rig.note('ink: ' + inkRows.length + ' rows measured in ' + Math.round(inkMs / 1000) + 's');
  if (shots) {
    fs.writeFileSync(path.join(shots, 'times.txt'), timeRows.join('\n') + '\n');
    fs.writeFileSync(path.join(shots, 'faults.txt'), list.join('\n') + '\n');
    fs.writeFileSync(path.join(shots, 'unchecked.txt'), unchecked.join('\n') + '\n');
    fs.writeFileSync(path.join(shots, 'ink.json'), JSON.stringify(inkRows, null, 1));
  }
  rig.note('not checked: ' + unchecked.length + (unchecked.length ? '\n    ' + unchecked.join('\n    ') : ''));
  rig.check(unchecked.length === 0, unchecked.length + ' inventory entries could not be checked; the note above names each');
  const sizes = Object.values(menus);
  rig.note('menus ' + JSON.stringify(menus));
  // One row height, and no menu narrower than the skin's 200px at the UI's zoom.
  if (!fitOnly) rig.check(sizes.length > 1 && sizes.every(m => Math.abs(m.row - sizes[0].row) < 0.5 && m.w >= 239), 'the right-click menus differ in size: ' + JSON.stringify(menus));
  rig.note('faults: ' + list.length + (list.length ? '\n    ' + list.join('\n    ') : ''));
  rig.check(list.length === 0, list.length + ' faults on the inventory: ' + list.slice(0, 3).join('; ') + (list.length > 3 ? '; the notes above name the rest' : ''));
};
