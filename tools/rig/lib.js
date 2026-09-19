'use strict';

// lib.js — the one page-side helper set, and the one map preamble, that every acceptance
// scenario uses. Nothing here asserts; it only puts the app into a state a scenario can read.
//
// WHY THIS FILE EXISTS. The helpers used to be a `const HELPERS` template literal pasted into
// each scenario. Fourteen files carried one, all fourteen differed, and `__rigDrag` alone had
// four versions across ten files. The drag helper is the one that took a release gate down over
// half a client pixel, and fixing it meant finding four copies and knowing which was which.
//
// ⚠ THE FOURTH ARGUMENT USED TO MEAN TWO DIFFERENT THINGS. In three files it was a modifier-key
// object merged into the MouseEvent; in two it was a flag saying "dispatch on window, not the
// container". Merging those positionally would have turned a Ctrl+drag into a window dispatch
// and left every check passing. So the extras travel in a NAMED options object and nothing is
// positional past the coordinates.
//
// ⚠ A DRAG'S TOLERANCE IS ONE CLIENT PIXEL IN MAP UNITS, never a flat number. The event is built
// on a whole client pixel, so a 17px drag in map units arrives as 17.5 at a zoom of 0.855.
// Assert against the span the app RECORDED, and scale what tolerance is left by `2 / zoom`, read
// live. A flat 0.5 passed at one window size and took a release gate down on a 1008x681 runner.
//
// ⚠ A LETTER OR PUNCTUATION KEY GOES AS `code` WITH NO `key`. The map shortcuts read `e.code`,
// the physical key, so a regression back to `e.key` goes red here instead of dying on a Russian
// layout at the table. A NAMED key carries both, because code and key are the same string for it
// and the fields still read `e.key`.
//
// ⚠ THE MAP IS ANIMATED unless a scenario says otherwise. Animated is the only kind the DM ever
// uses, so a suite running on still PNGs proved the app worked in a case that never happens.
// `openMap` records the clip once per run and caches it by size.
//
// ⚠ ROOMS DO NOT CROSS TO THE PLAYER (CLAUDE.md). What crosses is the fog they paint, so a check
// on the Player reads fog over ground, never a room.

// ─── The page-side helpers ───────────────────────────────────────────────────
// Evaluated in the window under test. Bare identifiers only: the app's scripts are plain
// `<script>` tags using top-level `let`/`const`, which are not properties of `window`.

const HELPERS = `
// ── Mouse ──
// opts: { mods } merged into the MouseEvent (ctrlKey, shiftKey, …)
//       { onWindow } dispatches on window instead of the map container, which is what lets a
//       release outside the map still commit.
globalThis.__rigMouse = (type, mx, my, opts) => {
  const o = opts || {};
  const r = container.getBoundingClientRect();
  const ev = new MouseEvent(type, Object.assign({
    clientX: mx * zoom + panX + r.left, clientY: my * zoom + panY + r.top,
    bubbles: true, cancelable: true, button: 0,
  }, o.mods || {}));
  (o.onWindow ? window : container).dispatchEvent(ev);
};

// opts: { mods, steps, onWindow }. steps interpolates the move, for a handler that integrates
// the path rather than reading the endpoints. onWindow applies to the RELEASE alone.
globalThis.__rigDrag = (x1, y1, x2, y2, opts) => {
  const o = opts || {};
  const move = { mods: o.mods };
  __rigMouse('mousedown', x1, y1, move);
  if (o.steps) {
    for (let k = 1; k <= o.steps; k++) {
      __rigMouse('mousemove', x1 + (x2 - x1) * k / o.steps, y1 + (y2 - y1) * k / o.steps, move);
    }
  } else {
    __rigMouse('mousemove', (x1 + x2) / 2, (y1 + y2) / 2, move);
    __rigMouse('mousemove', x2, y2, move);
  }
  __rigMouse('mouseup', x2, y2, { mods: o.mods, onWindow: o.onWindow });
};

globalThis.__rigClick = (mx, my, opts) => {
  __rigMouse('mousedown', mx, my, opts);
  __rigMouse('mouseup', mx, my, opts);
};

// Edit mode is entered by a real double-click, not by setting the flag: the point of the check
// is that the gesture reaches it. The leading click is part of the gesture the browser sends.
globalThis.__rigDbl = (mx, my) => { __rigClick(mx, my); __rigMouse('dblclick', mx, my); };

// A bare dblclick with no click in front of it, for a handler that must not see the click.
globalThis.__rigDblOnly = (mx, my) => __rigMouse('dblclick', mx, my);

// The pointer parked without pressing anything. This is what a paste aims at.
globalThis.__rigPoint = (mx, my) => __rigMouse('mousemove', mx, my);

// ── Keyboard ──
globalThis.__rigKey = (c, mods) => document.dispatchEvent(new KeyboardEvent('keydown',
  Object.assign({ code: c, key: /^(Key|Digit|Bracket|Slash|Backquote|Space)/.test(c) ? '' : c,
                  bubbles: true, cancelable: true }, mods || {})));

// ── Fog ──
// The painted alpha at a map point, off the DM's own fog data canvas. 255 is fully shrouded.
globalThis.__rigFog = (mx, my) => fogDataCtx.getImageData(
  Math.round(mx / FOG_SCALE), Math.round(my / FOG_SCALE), 1, 1).data[3];

// ── Shapes ──
globalThis.__rigById = (id) => polygons.find(p => p.id === id);
globalThis.__rigOf = (list, id) => (list === 'effects' ? effects : polygons).find(s => s.id === id);

globalThis.__rigRingBox = (ring) => ({
  x0: Math.min(...ring.map(v => v.x)), x1: Math.max(...ring.map(v => v.x)),
  y0: Math.min(...ring.map(v => v.y)), y1: Math.max(...ring.map(v => v.y)),
});
globalThis.__rigCentre = (b) => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });

// Unsigned area. __rigArea2 is the SIGNED double area, which carries winding as well as size —
// two different quantities, and a check that wants winding cannot use the unsigned one.
globalThis.__rigArea = (v) => {
  let s = 0;
  for (let i = 0, n = v.length; i < n; i++) { const a = v[i], b = v[(i + 1) % n]; s += a.x * b.y - b.x * a.y; }
  return Math.abs(s) / 2;
};
globalThis.__rigArea2 = (ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
  }
  return a;
};

// One shape, by id, as plain data. Searches rooms and effects together unless a list is named,
// because a scenario that cares WHICH list a shape landed in has to be able to say so.
globalThis.__rigShape = (id, list) => {
  const p = list ? __rigOf(list, id) : polygons.concat(effects).find(s => s.id === id);
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    desc: p.desc == null ? null : p.desc,
    mode: p.mode == null ? null : p.mode,
    material: p.material == null ? null : p.material,
    n: p.vertices.length,
    verts: p.vertices.map(v => ({ x: v.x, y: v.y })),
    box: __rigRingBox(p.vertices),
    area: __rigArea(p.vertices),
    area2: __rigArea2(p.vertices),
    holes: (p.holes || []).length,
    holeArea: (p.holes || []).map(h => __rigArea(h)),
    holeArea2: (p.holes || []).map(h => __rigArea2(h)),
    holeBox: (p.holes || []).map(h => __rigRingBox(h)),
    handles: p.handles ? p.handles.map(h => h && { ix: h.ix, iy: h.iy, ox: h.ox, oy: h.oy }) : null,
    radii: p.cornerRadii ? p.cornerRadii.slice() : null,
    // doorPoint is the app's own; guarded because a window that has no door module loaded would
    // otherwise throw here and report the whole shape as missing.
    doors: (p.doors || []).map(d => ({ edge: d.edge, t: d.t,
      pt: typeof doorPoint === 'function' ? doorPoint(p.vertices, d) : null })),
  };
};

// ── Drawing ──
// setShapeOp('new') is explicit: a repair STAYS ARMED after the shape it ran on, so a room drawn
// straight after one would otherwise be a second repair.
globalThis.__rigDrawRoom = (mode, x1, y1, x2, y2, opts) => {
  setShapeOp('new');
  setShape('rect');
  document.getElementById('btn-' + mode).click();
  __rigDrag(x1, y1, x2, y2, opts);
  setShape('select');
  return polygons[polygons.length - 1].id;
};
globalThis.__rigDrawShroud = (x1, y1, x2, y2, opts) => __rigDrawRoom('shroud', x1, y1, x2, y2, opts);

// A repair run as a rectangle, then disarmed. __rigOpRectRaw leaves it armed, for the check that
// arming survives the shape.
globalThis.__rigOpRect = (op, x1, y1, x2, y2) => {
  setShapeOp(op); setShape('rect'); __rigDrag(x1, y1, x2, y2);
  setShapeOp('new'); setShape('select'); return 0;
};
globalThis.__rigOpRectRaw = (op, x1, y1, x2, y2) => {
  setShapeOp(op); setShape('rect'); __rigDrag(x1, y1, x2, y2); return 0;
};
0`;

// Read off the Player's own fog canvas, as an expression rather than a helper: the Player window
// gets the helper set too, but a one-line read is clearer at the call site than a name.
const TV_FOG = `((mx, my) => fogDataCtx.getImageData(
  Math.round(mx / FOG_SCALE), Math.round(my / FOG_SCALE), 1, 1).data[3])`;

// Settles the DM's fog and pushes it, so a TV reading is of the edit and not of the frame before
// it. Every call is the app's own: nothing here is a rig-only path.
const SETTLE = 'rebuildFogFromPolygons(); rebuildFogEffect(); fogDirty = true;' +
               ' scheduleRender(); sendToPlayer(); 0';

// ─── The preamble ────────────────────────────────────────────────────────────

// Import a map and wait for it to land, then install the helpers. One line at the top of a
// scenario, in place of the five it used to take.
//
// opts: { w, h, kind: 'animated' | 'still', session, name }
// Returns the fixture record, so a caller that needs the bytes again has them.
async function openMap(rig, opts) {
  const o = Object.assign({ w: 1600, h: 1000, kind: 'animated' }, opts || {});
  const session = o.session || rig.dm;
  const still = o.kind === 'still';
  const fixture = still
    ? await rig.fixtures.stillMap(session, rig.fixtureDir,
        { w: o.w, h: o.h, name: o.name || ('rig-still-' + o.w + 'x' + o.h + '.png') })
    : await rig.fixtures.tableMap(session, rig.fixtureDir, { w: o.w, h: o.h });

  await session.evaluate('createNewScene(' + (await rig.fixtures.asFileExpr(session, fixture)) + ')',
                         180000);
  await session.waitFor(
    'currentScene && currentScene.mapType === ' + (still ? '"image"' : '"video"') +
    ' && mapWidth === ' + o.w,
    180000, 'the ' + o.kind + ' map to load on ' + session.label);
  await session.evaluate(HELPERS);
  return fixture;
}

// The helper set alone, for a window openMap did not load a map into — the Player, or a column.
async function installHelpers(session) {
  await session.evaluate(HELPERS);
}

// ─── Waiting ─────────────────────────────────────────────────────────────────

// A bounded wait that never fails on its own. It turns "the sleep was too short" into a real
// measurement; the assertion that follows is still the one that decides.
//
// ⚠ THIS REPLACES rig.sleep, AND rig.sleep IS NOT TO COME BACK INTO A SCENARIO. A fixed wait is
// either a lie or a waste, and on a slow runner it is the lie.
async function settle(session, expr, ms) {
  try { await session.waitFor(expr, ms || 8000, expr); } catch (_) { return false; }
  return true;
}

// Set a control's value and let the app hear about it. The app listens on the event, not on the
// property, so an assignment alone changes the field and nothing else.
function fire(session, id, value, ev) {
  return session.evaluate('(() => { const el = document.getElementById(' + JSON.stringify(id) +
    '); el.value = ' + JSON.stringify(String(value)) +
    '; el.dispatchEvent(new Event(' + JSON.stringify(ev || 'input') + ', { bubbles: true }));' +
    ' return 0; })()');
}

// A deliberate pause, for the one case a poll cannot serve: a check that something does NOT
// happen. There is no state to wait for, so the wait IS the measurement and its length is the
// claim being made. `why` is required, and it is the whole point — it stops this becoming the
// fixed wait `settle` replaced.
//
// ⚠ NOT A SUBSTITUTE FOR settle. If a condition exists, wait for it. Every use of this in a
// scenario should read as "give it long enough to go wrong, then prove it did not".
function hold(ms, why) {
  if (!why) throw new Error('hold(ms, why) needs a reason, or it is just a sleep');
  return new Promise(r => setTimeout(r, ms));
}

// A poll written in Node, for a condition that cannot be read as one synchronous expression —
// anything touching IndexedDB, or a value that has to be compared against one taken earlier.
// `waitFor` wraps what it is handed in `!!(…)`, so an async arrow's promise is truthy on the
// first poll and the wait returns instantly, having looked at nothing.
//
// ⚠ A FALSY ANSWER READS AS "NOT FOUND", so `fn` must never return the bare value it is looking
// for when 0 or '' is a possible answer. A fog alpha of 0 is exactly the reading that means the
// thing happened, and returning it makes the poll run its full bound and then report nothing.
// Wrap it: `return a < 60 ? { alpha: a } : null`.
async function poll(fn, ms, everyMs) {
  const deadline = Date.now() + (ms || 8000);
  for (;;) {
    const got = await fn();
    if (got) return got;
    if (Date.now() > deadline) return null;
    await new Promise(r => setTimeout(r, everyMs || 100));
  }
}

module.exports = { HELPERS, TV_FOG, SETTLE, openMap, installHelpers, settle, poll, hold, fire };
