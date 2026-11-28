'use strict';

// fit.js - the fit pass of `design-sweep`. Every floating surface of the
// inventory is opened by its trigger in a small window (1024x640), and an entry anchored to something movable once
// with the anchor at each of nine spots (the corners, the edges, the middle). It fails when the surface's box comes
// within 8px of a window edge or past it, or when a control in it lies outside the window with no scroll that
// reaches it. Opened from the middle, the window then shrinks (820x440) and the surface must come back inside.
// `base` names a file of where each movable surface stood opened from the middle, and the pass fails one that
// stands elsewhere now, unless that old place was itself outside the margin; `save` writes that file.

const fs = require('fs');
const lib = require('./lib');
const { user } = require('./user');
const { INVENTORY, CLOSE_ALL } = require('./inventory');

const SMALL = { width: 1024, height: 640 };
const SHRUNK = { width: 820, height: 440 };
const MARGIN = 8;

// Spot grids as fractions or px of the window, by what the anchor is: a point a menu opens at, a shape on the map
// (kept off the toolbar, the rail and the minimap, so it can still be clicked), a free window's centre.
const SPOTS = {
  point: (W, H) => [[12, W / 2, W - 12], [12, H / 2, H - 12]],
  map: (W, H) => [[0.07 * W, W / 2, 0.8 * W], [0.1 * H, H / 2, 0.66 * H]],
  window: (W, H) => [[0, W / 2, W], [0, H / 2, H]],
};
const ROW = ['top', '', 'bottom'], COL = ['left', '', 'right'];

const HELPERS = `globalThis.__fitPan = (mx, my, X, Y) => {
  const v = clientToView(X, Y); panX = v.x - mx * zoom; panY = v.y - my * zoom;
  pixiSetViewport(zoom, panX, panY); viewportDirty = true; fogDirty = true; scheduleRender(); drawCursor(lastScreenX, lastScreenY); return 1; };
globalThis.__fitJudge = (sel) => {
  const root = document.querySelector(sel);
  if (!root || !root.getClientRects().length) return null;
  const W = innerWidth, H = innerHeight, b = root.getBoundingClientRect();
  const off = r => r.left < -0.5 || r.top < -0.5 || r.right > W + 0.5 || r.bottom > H + 0.5;
  // A control past the edge counts as reachable when a scroll inside the surface, itself on screen, brings it in.
  const reach = e => { for (let n = e.parentElement; n; n = n.parentElement) { const cs = getComputedStyle(n);
    const can = (/auto|scroll/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1) || (/auto|scroll/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 1);
    if (can && !off(n.getBoundingClientRect())) return true; if (n === root) break; } return false; };
  const out = [...root.querySelectorAll('button, input, select, textarea, a, label, [data-i], [contenteditable], .sm-mi, .dd-it, .o, .it')].filter(e => {
    const r = e.getBoundingClientRect(); if (!r.width || !r.height || getComputedStyle(e).visibility === 'hidden') return false;
    if (reach(e)) return false;
    if (off(r)) return true;
    // On screen, but under something else (a bar standing over the map's popups): the DM cannot press it either.
    const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    return !!hit && !root.contains(hit) && !hit.contains(root); });
  const name = e => (e.getAttribute('title') || e.textContent || e.className || e.tagName).trim().slice(0, 24);
  return { box: [b.left, b.top, b.right, b.bottom].map(v => Math.round(v * 10) / 10), W, H, out: out.length, first: out[0] ? name(out[0]) : '' }; };
1`;

// What is wrong with a surface as it stands, one line per edge as `edge, px` (its distance from that window edge,
// negative past it, where 8 is the least allowed), and the controls nothing brings on screen.
function faultsOf(j) {
  const [l, t, r, b] = j.box, gap = { left: l, top: t, right: j.W - r, bottom: j.H - b };
  const f = Object.keys(gap).filter(k => gap[k] < MARGIN - 0.5).map(k => k + ', ' + gap[k].toFixed(1) + 'px (box ' + j.box.join(',') + ' in ' + j.W + 'x' + j.H + ')');
  if (j.out) f.push(j.out + ' control(s) off screen or covered, with no scroll to reach them, first "' + j.first + '"');
  return f;
}

function fitChecked(e) {
  if (e.fit === false) return false;
  if (e.fit) return true;
  return !['still', 'layer', 'bar'].includes(e.motion) && !e.root.startsWith('#dock-pane');
}

async function fitPass(rig, dm, { base, save } = {}) {
  const u = user(dm);
  const faults = [], unchecked = [], mids = {};
  const q = JSON.stringify;
  const run = js => dm.evaluate('(async () => { ' + js + ' })()');
  const size = s => dm.send('Emulation.setDeviceMetricsOverride', { width: s.width, height: s.height, deviceScaleFactor: 1, mobile: false });
  const frames = () => dm.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  const still = () => lib.settle(dm, "document.getAnimations().every(a => a.playState !== 'running' || a.effect.getComputedTiming().iterations === Infinity)", 3000);
  const shown = sel => lib.settle(dm, `(e => !!e && e.getClientRects().length > 0)(document.querySelector(${q(sel)}))`, 3000);
  const xy = (js, p) => 'const X = ' + p.x + ', Y = ' + p.y + '; ' + js;
  const baseline = base && fs.existsSync(base) ? JSON.parse(fs.readFileSync(base, 'utf8')) : null;

  await size(SMALL);
  await frames();
  await dm.evaluate(HELPERS);

  async function open(e, spot) {
    if (spot && e.fit.open) return run(xy(e.fit.open, spot));
    const t = e.trigger;
    if (!t || (t.x != null && !t.sel)) return run(e.open || '');
    if (t.map != null || t.effect) {
      const p = await dm.evaluate(`(() => { const t = ${q(t)};
        const v = t.effect ? __fxMake().vertices : polygons.filter(p => !p.material && !p.light)[t.map].vertices;
        const s = toScreen(v.reduce((a, b) => a + b.x, 0) / v.length, v.reduce((a, b) => a + b.y, 0) / v.length), c = viewToClient(s.sx, s.sy);
        return { x: c.x, y: c.y }; })()`);
      return u.click({ ...p, over: '#canvas-container' });
    }
    const sel = typeof t === 'string' ? t : t.sel;
    if (t.hover) return u.hover(sel);
    if (t.button === 'right') return u.rightClick(sel);
    await u.click(sel);
    if (t.text) await u.type(t.text);
  }

  for (const e of INVENTORY) {
    if (!fitChecked(e)) continue;
    const grid = e.fit && (e.fit.move || e.fit.open) ? SPOTS[e.fit.points](SMALL.width, SMALL.height) : null;
    const spots = grid ? grid[1].flatMap((y, r) => grid[0].map((x, c) => ({ x: Math.round(x), y: Math.round(y),
      name: (ROW[r] + ' ' + COL[c]).trim() || 'middle' }))) : [null];
    for (const spot of spots) {
      const where = e.id + ' @ ' + (spot ? spot.name : 'its place');
      try {
        await run(CLOSE_ALL);
        if (e.prep) { await run(e.prep); await still(); }
        if (spot && e.fit.move && !e.fit.late) { await run(xy(e.fit.move, spot)); await frames(); await still(); }
        await open(e, spot);
        await shown(e.root);
        await frames();
        if (spot && e.fit.move && e.fit.late) { await run(xy(e.fit.move, spot)); await frames(); }
        await still();
        const j = await dm.evaluate('__fitJudge(' + q(e.root) + ')');
        if (!j) { unchecked.push(where + ': did not open'); await run((e.close || '') + CLOSE_ALL).catch(() => {}); continue; }
        faultsOf(j).forEach(f => faults.push(where + ': ' + f));
        if (!spot || spot.name === 'middle') {
          if (spot) {
            mids[e.id] = j.box;
            // Compared only where the old place was itself inside the margin: a place that was a fault is meant to move.
            const was = baseline && baseline[e.id], fine = was && !faultsOf({ box: was, W: SMALL.width, H: SMALL.height, out: 0 }).length;
            if (fine && was.some((v, i) => Math.abs(v - j.box[i]) > 1)) faults.push(where + ': stands at ' + j.box.join(',') + ', not where it stood before (' + was.join(',') + ')');
          }
          // The window shrinks under the open surface, as the DM drags its corner in.
          await size(SHRUNK);
          await frames();
          await lib.settle(dm, 'false', 150);
          await still();
          const k = await dm.evaluate('__fitJudge(' + q(e.root) + ')');
          // A surface only the pointer's rest keeps open may close instead; inside the window or gone, the DM is not left with it cut.
          if (!k) { if (!(e.fit && e.fit.hover)) faults.push(where + ': closed when the window shrank to ' + SHRUNK.width + 'x' + SHRUNK.height); }
          else faultsOf(k).forEach(f => faults.push(where + ', shrunk to ' + SHRUNK.width + 'x' + SHRUNK.height + ': ' + f));
          await size(SMALL);
          await frames();
          await still();
        }
        await run(e.close || '');
        await run(CLOSE_ALL);
        await still();
      } catch (err) {
        unchecked.push(where + ': ' + err.message.split('\n')[0]);
        await size(SMALL).catch(() => {});
        await run((e.close || '') + CLOSE_ALL).catch(() => {});
      }
    }
  }
  await dm.send('Emulation.clearDeviceMetricsOverride');
  if (save) fs.writeFileSync(save, JSON.stringify(mids, null, 1));
  if (base && !baseline) unchecked.push('no baseline at ' + base + ', so where a surface opened from the middle stood was not compared');
  return { faults, unchecked, mids };
}

module.exports = { fitPass, faultsOf, HELPERS, SMALL, SHRUNK, MARGIN };
