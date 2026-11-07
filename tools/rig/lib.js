'use strict';

// lib.js — the one page-side helper set, and the blockers' shared setup, that every
// blocker scenario uses. Nothing here asserts; it only puts the app into a state a scenario can read.
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

// ── Keyboard ──
globalThis.__rigKey = (c, mods) => document.dispatchEvent(new KeyboardEvent('keydown',
  Object.assign({ code: c, key: /^(Key|Digit|Bracket|Slash|Backquote|Space)/.test(c) ? '' : c,
                  bubbles: true, cancelable: true }, mods || {})));

// ── Fog ──
// The painted alpha at a map point, off the DM's own fog data canvas. 255 is fully shrouded.
globalThis.__rigFog = (mx, my) => fogDataCtx.getImageData(
  Math.round(mx / FOG_SCALE), Math.round(my / FOG_SCALE), 1, 1).data[3];

// The fog a window PAINTS at a map point, off the fog mesh the Player draws, through that window's own
// camera. -1 where the point is off screen, so a caller can tell "clear" from "not on screen".
globalThis.__rigPainted = (mx, my) => {
  if (typeof pixiPFogMesh === 'undefined' || !pixiPFogMesh || !pixiApp) return -2;
  const c = pixiApp.renderer.extract.canvas(pixiPFogMesh);
  const sx = Math.round(mx * zoom + panX), sy = Math.round(my * zoom + panY);
  if (sx < 0 || sy < 0 || sx >= c.width || sy >= c.height) return -1;
  return c.getContext('2d').getImageData(sx, sy, 1, 1).data[3];
};
0`;

// Read off the Player's own fog canvas, as an expression rather than a helper: the Player window
// gets the helper set too, but a one-line read is clearer at the call site than a name.
const TV_FOG = `((mx, my) => fogDataCtx.getImageData(
  Math.round(mx / FOG_SCALE), Math.round(my / FOG_SCALE), 1, 1).data[3])`;

// ─── The preamble ────────────────────────────────────────────────────────────

// The helper set alone, for a window, such as the Player, that no import loaded a map into.
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

// ─── The blockers' shared setup ──────────────────────────────────────────────

// The DM's real maps are about this size (3110x2160, animated). It stays inside the 4K shrink box, so an import
// costs no re-encode.
const DM_MAP = { w: 3110, h: 2160 };

// A Dungeon Alchemist plan in the DM's own shape: three halls in a row, a door between each pair and one to the
// outside, drawn on 100px squares across 31 squares. Rooms come out left to right, 1 to 3.
const _seg = (a, b, c, d) => [{ x: a, y: b }, { x: c, y: d }];
const HALLS_PLAN = JSON.stringify({
  format: 0.3,
  resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 31, y: 21 }, pixels_per_grid: 100 },
  line_of_sight: [
    _seg(2, 2, 4, 2), _seg(5, 2, 29, 2), _seg(29, 2, 29, 19), _seg(29, 19, 2, 19), _seg(2, 19, 2, 2),
    _seg(10, 2, 10, 9), _seg(10, 10, 10, 19), _seg(20, 2, 20, 9), _seg(20, 10, 20, 19),
  ],
  portals: [{ bounds: _seg(4, 2, 5, 2) }, { bounds: _seg(10, 9, 10, 10) }, { bounds: _seg(20, 9, 20, 10) }],
});

// The DM's language is Russian. The app reads the stored choice at start, so this stores it and restarts.
// Returns the new DM session, with the helpers back in it.
async function inRussian(rig) {
  await rig.dm.evaluate('localStorage.setItem("evermist-lang", "ru"); 0');
  const dm = await rig.restart();
  await installHelpers(dm);
  return dm;
}

// A map named `name` imported with the floor plan its .dd2vtt would have carried. The disk lookup is the one
// stub (a File built in the page has no path); the import, the plan reading and the grid are the app's own.
// Returns the scene id.
async function importWithPlan(rig, name, plan) {
  const dm = rig.dm;
  const base = await rig.fixtures.tableMap(dm, rig.fixtureDir, { w: DM_MAP.w, h: DM_MAP.h });
  const file = await rig.fixtures.asFileExpr(dm, Object.assign({}, base, { name: name + '.mp4' }));
  await dm.evaluate('globalThis.__rigPlanText = ' + JSON.stringify(plan || HALLS_PLAN) +
    '; window.findPlanForFile = async () => globalThis.__rigPlanText; findPlanForFile = window.findPlanForFile; 0');
  await dm.evaluate('createNewScene(' + file + ')', 240000);
  await dm.waitFor('currentScene && currentScene.name === ' + JSON.stringify(name) + ' && mapWidth === ' + DM_MAP.w,
                   240000, 'the import of ' + name);
  await installHelpers(dm);
  await settle(dm, 'fogCoverT === 0', 60000);
  return dm.evaluate('currentScene.id');
}

// The plan's rooms, drawn by the Draw Rooms button. Resolves with the rooms, left to right, each as
// { id, name, mode, cx, cy } (the centre of its box, in map units).
async function drawRooms(rig, want) {
  const dm = rig.dm;
  await dm.evaluate('document.getElementById("btn-floorplan").click(); 0');
  await settle(dm, 'polygons.length >= ' + (want || 1), 30000);
  return dm.evaluate(`polygons.map(p => {
    const xs = p.vertices.map(v => v.x), ys = p.vertices.map(v => v.y);
    return { id: p.id, name: p.name, mode: p.mode,
             cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2,
             x2: Math.max(...xs), y2: Math.max(...ys) };
  }).sort((a, b) => a.cx - b.cx)`);
}

// One step of a walk. A step that throws is a failed check naming it, and the walk goes on.
async function step(rig, label, fn) {
  try { await fn(); } catch (err) { rig.check(false, label + ' stopped: ' + (err && err.message ? err.message : err)); }
}

// The Player's fog data at a map point: 255 is hidden ground, 0 is clear.
const tvFog = (player, x, y) => player.evaluate('(' + TV_FOG + ')(' + Math.round(x) + ',' + Math.round(y) + ')');

// Settings' Connect to Google clicked in an app started with `rig.catchBrowser()`'s env: the address handed to the
// system browser, as a URL, or null when none came. Settings must be open.
async function connectOpens(dm, browser) {
  const before = browser.opened().length;
  await dm.evaluate(`document.getElementById('sy-connect').click(); 0`);
  const got = await poll(() => browser.opened()[before] || null, 20000, 200);
  return got ? new URL(got) : null;
}

// What a consent address must carry for `clientId`, as failure messages; none when it is right.
function consentFaults(url, clientId) {
  if (!url) return ['the system browser was handed nothing'];
  const p = url.searchParams, out = [];
  if (url.origin + url.pathname !== 'https://accounts.google.com/o/oauth2/v2/auth') out.push('not Google\'s consent page: ' + url.origin + url.pathname);
  if (p.get('client_id') !== clientId) out.push('client_id is ' + JSON.stringify(p.get('client_id')));
  if (p.get('scope') !== 'https://www.googleapis.com/auth/drive.appdata') out.push('scope is ' + JSON.stringify(p.get('scope')));
  if (!/^http:\/\/127\.0\.0\.1:\d+\/oauth2callback$/.test(p.get('redirect_uri') || '')) out.push('redirect_uri is ' + JSON.stringify(p.get('redirect_uri')));
  if (p.get('code_challenge_method') !== 'S256' || !p.get('code_challenge') || !p.get('state')) out.push('no PKCE challenge or state');
  if (/secret/i.test(url.search)) out.push('the address carries a secret');
  return out;
}

module.exports = { DM_MAP, installHelpers, settle, poll, hold, inRussian, importWithPlan, drawRooms, step, tvFog, connectOpens, consentFaults };
