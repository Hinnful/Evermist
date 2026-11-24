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

// ─── The alignment sweep ─────────────────────────────────────────────────────
// .claude/rules/design-system.md, "Alignment": everything in a row centres on one line - a text by its capitals, a
// glyph with none by its ink, a box by its middle. A row is any visible flex row with two or more in-flow items;
// a field, a multi-line block and a graphic taller than 30px are left out, since none has one line to meet.
const ALIGN_SWEEP = `
globalThis.__rigAlignSweep = (rootSel, tol) => {
  tol = tol === undefined ? 0.5 : tol;
  const shown = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return false;
    const cs = getComputedStyle(e);
    return cs.visibility !== 'hidden' && +cs.opacity > 0;
  };
  const firstText = (e) => {
    const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT, {
      // A sign hung outside its number (position: absolute) is not where the row's text stands.
      acceptNode: (n) => (n.textContent.trim() && shown(n.parentElement) && getComputedStyle(n.parentElement).position !== 'absolute' ? 1 : 3) });
    return w.nextNode();
  };
  const lines = (e) => {
    const tops = new Set();
    const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!n.textContent.trim() || !shown(n.parentElement)) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      for (const r of rg.getClientRects()) if (r.width > 0) tops.add(Math.round(r.bottom));
    }
    return tops.size;
  };
  // A zero-width probe one cap tall, set on the text's own line: its bottom is the baseline. A text that is a
  // flex item on its own is wrapped in a span for the read, which lays out the same, and unwrapped after.
  const metrics = (node) => {
    const parent = node.parentElement;
    let host = parent, wrap = null;
    if (/flex|grid/.test(getComputedStyle(parent).display)) {
      wrap = document.createElement('span'); node.replaceWith(wrap); wrap.appendChild(node); host = wrap;
    }
    const probe = document.createElement('span');
    probe.style.cssText = 'display:inline-block;width:0;height:1cap;padding:0;margin:0;border:0;vertical-align:baseline';
    host.insertBefore(probe, node.nextSibling);
    const r = probe.getBoundingClientRect();
    probe.remove();
    if (wrap) { wrap.replaceWith(node); }
    const text = node.textContent.trim();
    // A text with no letter or digit (›, ·, ×) has no capitals: the eye reads where its ink sits.
    let inkC = null;
    if (!/[\\p{L}\\p{N}]/u.test(text)) {
      const ctx = (globalThis.__rigInk = globalThis.__rigInk || document.createElement('canvas').getContext('2d'));
      ctx.font = getComputedStyle(parent).font;
      const m = ctx.measureText(text);
      inkC = r.bottom + (m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2;
    }
    return { base: r.bottom, capC: (r.top + r.bottom) / 2, inkC, size: parseFloat(getComputedStyle(parent).fontSize),
      text: text.slice(0, 24) };
  };
  const name = (e) => {
    const bits = [];
    for (let x = e; x && x !== document.body && bits.length < 3; x = x.parentElement) {
      bits.unshift(x.id ? '#' + x.id : x.tagName.toLowerCase() + (x.classList.length ? '.' + [...x.classList].slice(0, 2).join('.') : ''));
      if (x.id) break;
    }
    return bits.join(' > ');
  };
  const roots = rootSel ? [...document.querySelectorAll(rootSel)] : [document.body];
  const faults = [];
  let rows = 0;
  for (const root of roots) {
    for (const row of [root, ...root.querySelectorAll('*')]) {
      const cs = getComputedStyle(row);
      // A select's options are its open list, not a row.
      if (!/flex/.test(cs.display) || /column/.test(cs.flexDirection) || !shown(row) || row.closest('select')) continue;
      const kids = [...row.children].filter((c) => shown(c) && !/absolute|fixed/.test(getComputedStyle(c).position));
      if (kids.length < 2) continue;
      // A wrapping row is measured line by line: each flex line is a row of its own.
      const flexLines = [];
      for (const c of kids) {
        const r = c.getBoundingClientRect(), cur = flexLines[flexLines.length - 1];
        if (cur && (cs.flexWrap === 'nowrap' || r.top < cur.bottom)) { cur.items.push(c); cur.bottom = Math.max(cur.bottom, r.bottom); }
        else flexLines.push({ items: [c], bottom: r.bottom });
      }
      for (const fl of flexLines) {
        const texts = [], marks = [];
        for (const c of fl.items) {
          if (c.matches('input, textarea, select, canvas, img, video') || c.querySelector('input:not([type=range]), textarea, select')) continue;
          const n = firstText(c);
          if (n) {
            if (lines(c) !== 1) continue;
            const m = metrics(n);
            if (m) texts.push(m);
          } else {
            // An empty value's dim placeholder is ::before text on the baseline, with no text node to measure.
            if ([c, ...c.querySelectorAll('*')].some((e) => !e.firstChild && getComputedStyle(e, '::before').content.startsWith('"'))) continue;
            const r = c.getBoundingClientRect();
            if (r.height <= 30) marks.push({ c: (r.top + r.bottom) / 2, what: name(c) });
          }
        }
        // A line whose main text sits in a field cannot be read: the field's text has no probe.
        if (fl.items.some((c) => c.matches('input:not([type=range]), textarea'))) continue;
        if (!texts.length || texts.length + marks.length < 2) continue;
        rows++;
        // One centre line: a text by the middle of its capitals (its ink when it has none), a box by its middle.
        // The median item sets the line, so one stray item is named, not the rest of the row.
        const items = [...texts.map((t) => ({ c: t.inkC === null ? t.capC : t.inkC, what: '"' + t.text + '"' })), ...marks.map((m) => ({ c: m.c, what: m.what }))];
        const sorted = items.map((i) => i.c).sort((a, b) => a - b), line = sorted[Math.floor((sorted.length - 1) / 2)];
        const off = items.filter((i) => Math.abs(i.c - line) > tol);
        if (off.length) faults.push(name(row) + ': off the centre line of the row ' + off.map((i) => i.what + ' ' + (i.c - line).toFixed(2) + 'px').join(', '));
      }
    }
  }
  return { rows, faults };
};
0`;

// Every visible row under `rootSel` (the whole page when omitted) measured against the alignment rule.
// Resolves with { rows, faults }; a fault names the row and the offset.
async function alignSweep(session, rootSel, tol) {
  await session.evaluate(ALIGN_SWEEP);
  return session.evaluate('__rigAlignSweep(' + JSON.stringify(rootSel || null) + ', ' + (tol === undefined ? 0.5 : tol) + ')');
}

// The hover rule: a plate inside something the pointer lights stands off the surface it lies on at least as well
// as at rest, and never merges with it in whatever state the screen is in. Every element a :hover rule repaints
// is forced into :hover over CDP and each filled box inside it is measured against its own parent, both
// composited over their ancestors, before and after.
const HOVER_SWEEP = `(() => {
  const parse = s => { const m = s.match(/[\\d.]+/g); if (!m) return null; let [r, g, b, a] = m.map(Number);
    if (s.startsWith('color(')) { r *= 255; g *= 255; b *= 255; } return [r, g, b, a === undefined ? 1 : a]; };
  const over = (f, b) => [0, 1, 2].map(i => f[i] * f[3] + b[i] * (1 - f[3])).concat(1);
  const eff = el => { const chain = []; for (let e = el; e; e = e.parentElement) chain.push(e);
    let c = [0, 0, 0, 1]; for (const e of chain.reverse()) { const p = parse(getComputedStyle(e).backgroundColor); if (p && p[3] > 0) c = over(p, c); } return c; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const name = e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + [...e.classList].slice(0, 2).map(c => '.' + c).join('');
  const hosts = new Set();
  const walk = list => { for (const r of list) { if (r.cssRules && !r.selectorText) { walk(r.cssRules); continue; }
    if (!r.selectorText || !/background/.test(r.style ? r.style.cssText : '')) continue;
    for (const s of r.selectorText.split(',')) { const i = s.indexOf(':hover'); if (i > 0) hosts.add(s.slice(0, i).trim()); } } };
  for (const sh of document.styleSheets) { try { walk(sh.cssRules); } catch (e) {} }
  const seen = el => { const b = el.getBoundingClientRect(); return b.width && b.height && b.bottom > 0 && b.top < innerHeight && el.offsetParent !== null; };
  const els = new Set();
  const root = window.__rigHoverRoot ? document.querySelector(window.__rigHoverRoot) : document.body;
  for (const h of hosts) { try { document.querySelectorAll(h).forEach(e => { if (seen(e) && root && root.contains(e)) els.add(e); }); } catch (e) {} }
  window.__rigHover = { hosts: [...els], kids: null,
    take(i, fresh) { const el = this.hosts[i];
      if (fresh) this.kids = [...el.querySelectorAll('*')].filter(k => { if (!seen(k)) return false; const b = k.getBoundingClientRect();
        if (b.width * b.height > 40000) return false; const cs = getComputedStyle(k);
        // A masked box is an icon drawn in its background, not a plate.
        if (cs.maskImage !== 'none' || cs.webkitMaskImage !== 'none') return false;
        const p = parse(cs.backgroundColor); return p && p[3] > 0.02; });
      return { host: name(el), kids: this.kids.map(k => { const p = k.parentElement, a = k.getBoundingClientRect(), b = p.getBoundingClientRect();
        return { k: name(k), r: ratio(eff(k), eff(p)), plate: a.width < b.width * 0.9 && a.height < b.height * 0.9 }; }) }; } };
  return els.size;
})()`;

// Resolves with { hosts, faults }; a fault names the plate and its separation at rest and under the pointer.
async function hoverSweep(session, rootSel) {
  await session.evaluate('window.__rigHoverRoot = ' + JSON.stringify(rootSel || null) + '; 0');
  const n = await session.evaluate(HOVER_SWEEP);
  await session.send('DOM.enable'); await session.send('CSS.enable');
  await session.send('DOM.getDocument', { depth: 0 });
  const faults = new Set();
  for (let i = 0; i < n; i++) {
    const rest = await session.evaluate('__rigHover.take(' + i + ', true)');
    if (!rest.kids.length) continue;
    const { result } = await session.send('Runtime.evaluate', { expression: '__rigHover.hosts[' + i + ']' });
    const { nodeId } = await session.send('DOM.requestNode', { objectId: result.objectId });
    await session.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
    const lit = await session.evaluate('__rigHover.take(' + i + ', false)');
    await session.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
    rest.kids.forEach((k, j) => { const h = lit.kids[j];
      if (k.plate && k.r < 1.05) faults.add(rest.host + ' > ' + k.k + ' merges with what it lies on: ' + k.r.toFixed(2));
      // A plate still standing off at 1.3 or more under the pointer is nowhere near merging.
      if (h.r < k.r - 0.03 && h.r < 1.3) faults.add(rest.host + ' > ' + k.k + ' stands off what it lies on ' + k.r.toFixed(2) + ' at rest, ' + h.r.toFixed(2) + ' under the pointer'); });
  }
  return { hosts: n, faults: [...faults] };
}

// Three checks the eye used to be the only one to make, each over the visible part of `rootSel`:
// - a native control: a <select> the browser draws, a button in the browser's own grey;
// - text inside a filled control closer than 6px to its side;
// - text trimmed to its capitals inside a box that clips, which cuts the tails of у and р;
// - a box that moves when `toggle` runs; only what lies inside the toggled box (`except`, a selector) may change.
const SURFACE_SWEEP = `(() => {
  const seen = el => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < innerHeight && el.offsetParent !== null; };
  const name = e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + [...e.classList].slice(0, 2).map(c => '.' + c).join('');
  const zoomOf = el => { let z = 1; for (let e = el; e; e = e.parentElement) z *= parseFloat(getComputedStyle(e).zoom) || 1; return z; };
  const filled = cs => { const m = cs.backgroundColor.match(/[\\d.]+/g); return (m && (m[3] === undefined || +m[3] > 0.02)) || parseFloat(cs.borderTopWidth) > 0 || cs.boxShadow !== 'none'; };
  window.__rigSurface = {
    native(rootSel) { const root = rootSel ? document.querySelector(rootSel) : document.body; if (!root) return [];
      const out = [];
      root.querySelectorAll('select').forEach(s => { if (seen(s) && getComputedStyle(s).appearance !== 'base-select') out.push(name(s) + ' is the browser\\'s own select'); });
      root.querySelectorAll('button').forEach(b => { if (!seen(b)) return; const bg = getComputedStyle(b).backgroundColor;
        if (/^rgb\\((239|240), (239|240), (239|240)\\)$/.test(bg) || getComputedStyle(b).borderStyle === 'outset') out.push(name(b) + ' wears the browser\\'s button'); });
      return out; },
    padding(rootSel) { const root = rootSel ? document.querySelector(rootSel) : document.body; if (!root) return [];
      const out = [];
      root.querySelectorAll('button, select, input[type=text], input[type=search], input:not([type])').forEach(c => {
        if (!seen(c)) return; const cs = getComputedStyle(c); if (!filled(cs)) return; const z = zoomOf(c), b = c.getBoundingClientRect();
        let l, r;
        if (c.tagName === 'BUTTON') { const rg = document.createRange(); const texts = [...c.querySelectorAll('*')].concat(c).flatMap(e => [...e.childNodes]).filter(n => n.nodeType === 3 && n.textContent.trim());
          if (!texts.length) return; const rs = texts.map(n => { rg.selectNodeContents(n); return rg.getBoundingClientRect(); }).filter(x => x.width);
          if (!rs.length) return; l = (Math.min(...rs.map(x => x.left)) - b.left) / z; r = (b.right - Math.max(...rs.map(x => x.right))) / z;
          const icon = c.querySelector('svg'); if (icon) { const ib = icon.getBoundingClientRect(); if (ib.width) { l = Math.min(l, (ib.left - b.left) / z); r = Math.min(r, (b.right - ib.right) / z); } }
        } else { l = parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth); r = parseFloat(cs.paddingRight) + parseFloat(cs.borderRightWidth); if (c.tagName === 'SELECT') r = Math.max(r, 6); }
        if (l < 5.5 || r < 5.5) out.push(name(c) + ' holds its content ' + l.toFixed(1) + 'px from the left and ' + r.toFixed(1) + 'px from the right'); });
      return out; },
    // A box that clips must hold its text's glyphs: a line height under the font's own, or a trim to the capitals,
    // cuts the tails of у, р, д. A field is judged by its value and placeholder.
    clip(rootSel) { const root = rootSel ? document.querySelector(rootSel) : document.body; if (!root) return [];
      const out = new Set(), rg = document.createRange();
      [root, ...root.querySelectorAll('*')].forEach(e => { if (!seen(e)) return; const cs = getComputedStyle(e);
        const field = /^(INPUT|TEXTAREA)$/.test(e.tagName);
        const nodes = field ? [] : [...e.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
        const text = field ? (e.value || '') + (e.placeholder || '') : nodes.map(n => n.textContent).join('');
        // Only a letter that hangs below the line is cut; digits and capitals never are.
        if (!/[ДдЗзРрУуФфЦцЩщgjpqy,()]/.test(text)) return;
        const trimmed = cs.textBoxTrim && cs.textBoxTrim !== 'none';
        if (field) { if (trimmed) out.add(name(e) + ' trims its text to the capitals and clips the descenders'); return; }
        if (/visible/.test(cs.overflowY) && /visible/.test(cs.overflow)) return;
        const b = e.getBoundingClientRect(), bottom = b.bottom - parseFloat(cs.borderBottomWidth) * (b.height / (e.offsetHeight || b.height));
        for (const n of nodes) { rg.selectNodeContents(n); const r = rg.getBoundingClientRect();
          if (r.height && r.bottom > bottom + 0.5) { out.add(name(e) + ' clips the tails of its letters by ' + (r.bottom - bottom).toFixed(1) + 'px'); break; } } });
      return [...out]; },
    snap(rootSel) { const root = document.querySelector(rootSel); if (!root) return null; const m = new Map();
      const walk = (e, path) => { if (seen(e)) { const b = e.getBoundingClientRect(); m.set(path, { n: name(e), tag: e.tagName, x: b.x, y: b.y, el: e }); }
        [...e.children].forEach((c, i) => walk(c, path + '/' + i)); };
      walk(root, ''); return m; },
    shift(before, rootSel, except) { const after = this.snap(rootSel); if (!before || !after) return ['cannot find ' + rootSel];
      const out = new Set(); for (const [p, a] of before) { // Matched by place and tag: a toggle changes the classes of what it toggles.
        const b = after.get(p); if (!b || b.tag !== a.tag) continue;
        // What the toggle draws inside its box may change; the box itself may not move.
        if (except && b.el.parentElement && b.el.parentElement.closest(except)) continue;
        const dx = b.x - a.x, dy = b.y - a.y; if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) out.add(a.n + ' moves ' + dx.toFixed(1) + ', ' + dy.toFixed(1) + 'px'); }
      return [...out]; },
  };
  return 0;
})()`;

async function surfaceSweep(session, rootSel) {
  await session.evaluate(SURFACE_SWEEP);
  const sel = JSON.stringify(rootSel || null);
  return (await session.evaluate('__rigSurface.native(' + sel + ')')).concat(await session.evaluate('__rigSurface.padding(' + sel + ')'),
    await session.evaluate('__rigSurface.clip(' + sel + ')'));
}

// The boxes under `rootSel` that move when `toggle` (page JS) runs; `except` names the box the toggle changes.
async function shiftSweep(session, rootSel, toggle, except) {
  await session.evaluate(SURFACE_SWEEP);
  await session.evaluate('window.__rigBefore = __rigSurface.snap(' + JSON.stringify(rootSel) + '); 0');
  await session.evaluate('(async () => { ' + toggle + ' })()');
  await settle(session, 'false', 150);
  return session.evaluate('__rigSurface.shift(__rigBefore, ' + JSON.stringify(rootSel) + ', ' + JSON.stringify(except || null) + ')');
}

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
  await dm.evaluate('globalThis.__rigPlan = ' + JSON.stringify({ name: name + '.dd2vtt', text: plan || HALLS_PLAN }) +
    '; window.findPlanForFile = async () => globalThis.__rigPlan; findPlanForFile = window.findPlanForFile; 0');
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

// A WAV track written by Node: 8-bit mono PCM at 8 kHz; `tone` makes two tracks of one length differ.
function wav(seconds, tone) {
  const rate = 8000, n = rate * seconds, buf = Buffer.alloc(44 + n);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34);
  buf.write('data', 36); buf.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) buf[44 + i] = 128 + Math.round(40 * Math.sin(i / (tone || 8)));
  return buf;
}

module.exports = { DM_MAP, wav, alignSweep, hoverSweep, surfaceSweep, shiftSweep, installHelpers, settle, poll, hold, inRussian, importWithPlan, drawRooms, step, tvFog, connectOpens, consentFaults };
