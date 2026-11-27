'use strict';

const ink = require('./ink');

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
// .claude/rules/design-system.md, "Alignment": texts in a row share one baseline, and a box, an icon or a glyph with
// no capitals centres on the capitals of the row's main (largest) text. A row is any visible flex row with two or more
// in-flow items; a field and a graphic taller than 30 CSS px are left out, and an item holding two or more lines of
// text is one block, beside which a box centres on the block. Two faults need no tolerance: bare texts in one row more
// than 1.5x apart in size (the smaller goes on its own line), and a glyph with no capitals written as text beside text
// (it sits by the font's metrics, never by its ink).
// Each row also comes back as items for ink.js to measure on the rendered pixels.
// A box item (`boxSel`: a button, a link, a label round a control, an atom) is a box whether filled or not: its text
// is no bare text of the row, and a filled one is measured by its painted edges.
const ALIGN_SWEEP = `
globalThis.__rigAlignSweep = (rootSel, boxSel) => {
  const sizesApart = ${ink.sizesApart.toString()};
  const BOX = boxSel.split(/,(?![^(]*\\))/).filter((s) => { try { document.querySelector(s); return true; } catch (e) { return false; } }).join(',');
  const boxOf = (from, to) => { for (let e = from; e; e = e.parentElement) { if (e.matches(BOX)) return e; if (e === to) break; } return null; };
  const LETTER = /[\\p{L}\\p{N}]/u;
  // A word with no letter made only of these is punctuation; any other mark in it is a glyph.
  const PUNCT = /^[.,:;!?…"'«»„“”()\\[\\]{}–—\\-\\/%]+$/;
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
  const rangeRect = (n, a, b) => { const rg = document.createRange();
    if (a === undefined) rg.selectNodeContents(n); else { rg.setStart(n, a); rg.setEnd(n, b); }
    return [...rg.getClientRects()].find((r) => r.width > 0) || null; };
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
    return { capH: r.height, text: node.textContent.trim().slice(0, 24) };
  };
  const name = (e) => {
    const bits = [];
    for (let x = e; x && x !== document.body && bits.length < 3; x = x.parentElement) {
      bits.unshift(x.id ? '#' + x.id : x.tagName.toLowerCase() + (x.classList.length ? '.' + [...x.classList].slice(0, 2).join('.') : ''));
      if (x.id) break;
    }
    return bits.join(' > ');
  };
  // A box the eye reads as a box: a fill, a shadow or a border all round.
  const plate = (e) => {
    const cs = getComputedStyle(e), bg = cs.backgroundColor.match(/[\\d.]+/g);
    if ((bg && (bg.length < 4 || +bg[3] > 0.02)) || cs.backgroundImage !== 'none' || cs.boxShadow !== 'none') return true;
    return ['Top', 'Right', 'Bottom', 'Left'].every((s) => parseFloat(cs['border' + s + 'Width']) > 0 && cs['border' + s + 'Style'] !== 'none');
  };
  // Height in CSS px: a screen rect carries the UI zoom, and the graphic cutoff is a CSS size.
  const cssH = (e) => e.getBoundingClientRect().height / (e.currentCSSZoom || 1);
  const pseudoText = (cs) => [...cs.content.matchAll(/"((?:[^"\\\\]|\\\\.)*)"/g)].map((m) => m[1]).join('');
  const skipText = (n) => !!n.parentElement.closest('select, option, textarea, svg, [contenteditable=""], [contenteditable=true]');
  const roots = rootSel ? [...document.querySelectorAll(rootSel)] : [document.body];
  const faults = [], ink = [], mixed = new Map(), glyphs = new Set();
  globalThis.__rigInkEls = []; globalThis.__rigInkRoots = roots;
  let rows = 0;
  const cut = [];
  for (const root of roots) {
    // A lettered text on the same line as a glyph, within four boxes of it: the text the glyph stands beside.
    const besideText = (host, top, bottom) => {
      for (let a = host, k = 0; a && k < 4 && root.contains(a); a = a.parentElement, k++) {
        const w = document.createTreeWalker(a, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          const t = n.textContent.trim();
          if (!LETTER.test(t) || !shown(n.parentElement) || skipText(n)) continue;
          const rg = document.createRange(); rg.selectNodeContents(n);
          for (const r of rg.getClientRects()) if (r.width > 0 && Math.min(r.bottom, bottom) - Math.max(r.top, top) > 0.3 * Math.min(r.height, bottom - top)) return t.slice(0, 24);
        }
      }
      return null;
    };
    const glyphWord = (t) => t.split(/\\s+/).filter((w) => w && !LETTER.test(w) && !PUNCT.test(w));
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const t = n.textContent.trim();
      if (!t || !shown(n.parentElement) || skipText(n)) continue;
      if (LETTER.test(t)) {
        const g = glyphWord(t);
        if (g.length) glyphs.add(name(n.parentElement) + ': "' + t.slice(0, 24) + '" writes ' + g.map((x) => '"' + x + '"').join(', ') + ' as text; a glyph with no capitals beside text is an icon (icons.js)');
        continue;
      }
      if (PUNCT.test(t.replace(/\\s+/g, ''))) continue;
      if (/^[+\\-−±]$/.test(t)) { const nx = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); nx.currentNode = n;
        const after = nx.nextNode(); if (after && /^\\d/.test(after.textContent)) continue; }
      const r = rangeRect(n);
      const by = r && besideText(n.parentElement, r.top, r.bottom);
      if (by) glyphs.add(name(n.parentElement) + ': "' + t.slice(0, 12) + '" is written as text beside "' + by + '"; a glyph with no capitals beside text is an icon (icons.js)');
    }
    for (const e of [root, ...root.querySelectorAll('*')]) {
      if (!shown(e) || e.closest('svg, select')) continue;
      for (const p of ['::before', '::after']) {
        const cs = getComputedStyle(e, p);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const t = pseudoText(cs).trim();
        if (!t) continue;
        const r = e.getBoundingClientRect();
        if (LETTER.test(t)) {
          const g = glyphWord(t);
          if (g.length) glyphs.add(name(e) + p + ': content "' + t.slice(0, 24) + '" writes ' + g.map((x) => '"' + x + '"').join(', ') + ' as text; a glyph with no capitals beside text is an icon (icons.js)');
          continue;
        }
        if (PUNCT.test(t.replace(/\\s+/g, ''))) continue;
        const by = besideText(e, r.top, r.bottom);
        if (by) glyphs.add(name(e) + p + ': content "' + t.slice(0, 12) + '" is written as text beside "' + by + '"; a glyph with no capitals beside text is an icon (icons.js)');
      }
    }
    for (const row of [root, ...root.querySelectorAll('*')]) {
      const cs = getComputedStyle(row);
      // A select's options are its open list, not a row.
      if (!/flex/.test(cs.display) || /column/.test(cs.flexDirection) || !shown(row) || row.closest('select')) continue;
      const kids = [...row.children].filter((c) => shown(c) && !/absolute|fixed/.test(getComputedStyle(c).position));
      // A row's own text and its ::before/::after stand in it too, as anonymous items.
      const texts0 = [...row.childNodes].filter((n) => { if (n.nodeType !== 3 || !n.textContent.trim()) return false;
        const rg = document.createRange(); rg.selectNodeContents(n);
        return new Set([...rg.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.bottom))).size === 1; });
      const pseudos = ['::before', '::after'].map((p) => ({ p, cs: getComputedStyle(row, p) }))
        .filter(({ cs: c }) => c.display !== 'none' && c.content !== 'none' && c.content !== 'normal' && !/absolute|fixed/.test(c.position) && c.visibility !== 'hidden');
      if (kids.length + texts0.length + pseudos.length < 2) continue;
      // A wrapping row is measured line by line: each flex line is a row of its own.
      const flexLines = [];
      for (const c of kids) {
        const r = c.getBoundingClientRect(), cur = flexLines[flexLines.length - 1];
        if (cur && (cs.flexWrap === 'nowrap' || r.top < cur.bottom)) { cur.items.push(c); cur.bottom = Math.max(cur.bottom, r.bottom); }
        else flexLines.push({ items: [c], bottom: r.bottom });
      }
      if (!flexLines.length) flexLines.push({ items: [], bottom: 0 });
      const one = flexLines.length === 1;
      for (const fl of flexLines) {
        // A line whose main text sits in a field cannot be read: the field's text has no probe.
        if (fl.items.some((c) => c.matches('input:not([type=range]), textarea'))) continue;
        const field = (c) => c.matches('input, textarea, select, canvas, img, video') || c.querySelector('input:not([type=range]), textarea, select');
        // Bare texts: words standing in the row itself, not inside a plate or a box item that is the row's item.
        const bare = [];
        const addBare = (n) => { const t = n.textContent.trim(), pe = n.parentElement;
          if (!LETTER.test(t) || !shown(pe) || getComputedStyle(pe).position === 'absolute' || skipText(n)) return;
          for (let e = pe; e && e !== row; e = e.parentElement) if (plate(e) || e.matches(BOX)) return;
          bare.push({ size: parseFloat(getComputedStyle(pe).fontSize), text: t.slice(0, 24) }); };
        for (const c of fl.items) {
          if (field(c) || lines(c) !== 1) continue;
          const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
          for (let n = w.nextNode(); n; n = w.nextNode()) addBare(n);
        }
        if (one) texts0.forEach(addBare);
        const sizes = [...new Set(bare.map((b) => b.size))].sort((a, b) => b - a);
        if (sizesApart(sizes)) {
          const sig = bare.map((b) => b.size + b.text).sort().join('|');
          mixed.set(sig, name(row) + ': bare texts of ' + sizes.map((s) => s + 'px').join(' and ') + ' share the row: ' +
            bare.map((b) => '"' + b.text + '" ' + b.size + 'px').join(', ') + '; a text more than 1.5x smaller than the row\\'s main text goes on its own line');
        }
        const inkItems = [];
        // A text's item: its span, each letter's span and the font's cap height. Null when it shows no width.
        const textOf = (n, c, m, what) => {
          const r = rangeRect(n), pr = n.parentElement.getBoundingClientRect(), cr = c ? c.getBoundingClientRect() : pr;
          if (!r) return;
          const x0 = Math.max(r.left, pr.left, cr.left), x1 = Math.min(r.right, pr.right, cr.right);
          // The text's own plate bounds where its ink can be: outside it lies the row's surface.
          let y0 = r.top - 2, y1 = r.bottom + 2;
          for (let e = n.parentElement; e && e !== row.parentElement; e = e.parentElement) {
            if (e === row || plate(e)) { const b = e.getBoundingClientRect(); y0 = Math.max(y0, b.top); y1 = Math.min(y1, b.bottom); if (e !== row) break; }
          }
          if (x1 - x0 < 1) return null;
          const t = n.textContent;
          if (!LETTER.test(t)) return { kind: 'glyph', what, x0, x1, y0, y1, el: n.parentElement };
          // Each letter's span and the letter itself, for ink.js to read its baseline and cap top per letter, since the
          // bar of an Н is not its top. Only the letters on its first line.
          const chars = [];
          for (let i = 0; i < t.length && i < 80; i++) {
            if (!LETTER.test(t[i])) continue;
            const q = rangeRect(n, i, i + 1);
            if (q && q.right > x0 && q.left < x1 && Math.abs(q.bottom - r.bottom) < 1) chars.push([Math.max(q.left, x0), Math.min(q.right, x1), t[i]]);
          }
          const cs = getComputedStyle(n.parentElement), rgb = cs.color.match(/[\\d.]+/g);
          // Its own colour, which its ink steps toward from the surface (ink.js); color(srgb …) runs 0 to 1.
          const color = /^rgba?\\(/.test(cs.color) ? rgb.slice(0, 3).map(Number) : /^color\\(srgb /.test(cs.color) ? rgb.slice(0, 3).map((v) => v * 255) : undefined;
          return { kind: 'text', what, x0, x1, y0, y1, chars, capH: m.capH, size: parseFloat(cs.fontSize), color, el: n.parentElement };
        };
        // A box item's text (\`box\`, the box) also carries the middle of that box as laid out.
        const inkText = (n, c, m, what, box) => {
          const it = textOf(n, c, m, what);
          if (!it) return;
          if (it.kind === 'text' && box) { const b = box.getBoundingClientRect(); it.box = true; it.lay = (b.top + b.bottom) / 2; }
          inkItems.push(it);
        };
        // A plate holding the text n: should its fill be too faint to read, it stands by that text's capitals.
        const plateText = (n) => { const t = textOf(n, null, metrics(n), ''); if (t && t.kind === 'text') { const o = inkItems[inkItems.length - 1]; delete t.el; o.text = t; } };
        // One line of a text node, first or last, as laid out: its line box, the text's content area grown to the
        // line-height about its middle (the block's strut when taller), inside the content box of the block that
        // holds it, so a line trimmed by \`text-box\` ends where the trim puts it.
        const lineItem = (n, c, last) => {
          const rg = document.createRange(); rg.selectNodeContents(n);
          const rs = [...rg.getClientRects()].filter((q) => q.width > 0);
          if (!rs.length) return null;
          const r = last ? rs[rs.length - 1] : rs[0], same = rs.filter((q) => Math.abs(q.bottom - r.bottom) < 1);
          const pr = n.parentElement.getBoundingClientRect(), cr = c.getBoundingClientRect();
          const x0 = Math.max(Math.min(...same.map((q) => q.left)), pr.left, cr.left), x1 = Math.min(Math.max(...same.map((q) => q.right)), pr.right, cr.right);
          if (x1 - x0 < 1) return null;
          let blk = n.parentElement;
          while (blk.parentElement && /^(inline|contents)$/.test(getComputedStyle(blk).display)) blk = blk.parentElement;
          const z = n.parentElement.currentCSSZoom || 1, lh = (e) => { const v = getComputedStyle(e).lineHeight; return v === 'normal' ? 0 : parseFloat(v) * z; };
          const L = Math.max(lh(n.parentElement), lh(blk), r.height), mid = (r.top + r.bottom) / 2;
          const bc = getComputedStyle(blk), bb = blk.getBoundingClientRect();
          const top = Math.max(mid - L / 2, bb.top + (parseFloat(bc.borderTopWidth) + parseFloat(bc.paddingTop)) * z);
          const bottom = Math.min(mid + L / 2, bb.bottom - (parseFloat(bc.borderBottomWidth) + parseFloat(bc.paddingBottom)) * z);
          return { x0, x1, top, bottom, base: r.bottom };
        };
        // A block's first line is its first lettered text's first line, and its last line its last one's last line,
        // leaving out text in a box item or a plate inside it.
        const inkBlock = (c) => {
          const own = [], w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
          for (let n = w.nextNode(); n; n = w.nextNode()) {
            const pe = n.parentElement;
            if (!LETTER.test(n.textContent) || !shown(pe) || getComputedStyle(pe).position === 'absolute' || skipText(n)) continue;
            let held = false;
            for (let e = pe; e && e !== c && !held; e = e.parentElement) held = plate(e) || e.matches(BOX);
            if (!held) own.push(n);
          }
          if (!own.length) return;
          const first = lineItem(own[0], c, false), last = lineItem(own[own.length - 1], c, true);
          if (!first || !last) return;
          const m = metrics(own[0]);
          // Its text on one line after all (the second line is a box or a plate): a text like any other.
          if (Math.abs(first.base - last.base) < 1) { inkText(own[0], c, m, '"' + m.text + '"', false); return; }
          inkItems.push({ kind: 'block', what: '"' + m.text + '"', x0: Math.min(first.x0, last.x0), x1: Math.max(first.x1, last.x1), y0: first.top, y1: last.bottom,
            top: first.top, bottom: last.bottom, el: c });
        };
        const inkBox = (e, kind) => { const r = e.getBoundingClientRect();
          inkItems.push({ kind, what: name(e), x0: r.left, x1: r.right, y0: r.top, y1: r.bottom, el: e }); };
        for (const c of fl.items) {
          if (field(c)) continue;
          const n = firstText(c);
          if (n) {
            const b = boxOf(n.parentElement, c);
            if (lines(c) !== 1) {
              // A block holding text on several lines (a name over its source, a title over its description) is one
              // item, standing by its middle, unless that text sits in a box item or a plate.
              let held = !!b;
              for (let e = n.parentElement; e && !held; e = e === c ? null : e.parentElement) held = plate(e);
              if (!held) inkBlock(c);
              continue;
            }
            // A filled box item, or any plate round the text, stands where it is painted; an unfilled one by its text,
            // judged as a box.
            if (b && plate(b) && cssH(b) <= 30) { inkBox(b, 'plate'); plateText(n); continue; }
            let pl = null;
            for (let e = n.parentElement; e && !pl; e = e === c ? null : e.parentElement) if (plate(e) && cssH(e) <= 30) pl = e;
            if (pl) { inkBox(pl, 'plate'); inkItems[inkItems.length - 1].lettered = true; plateText(n); continue; }
            const m = metrics(n);
            inkText(n, c, m, '"' + m.text + '"', b);
          } else {
            // An empty value's dim placeholder is ::before text on the baseline, with no text node to measure.
            if ([c, ...c.querySelectorAll('*')].some((e) => !e.firstChild && getComputedStyle(e, '::before').content.startsWith('"'))) continue;
            const r = c.getBoundingClientRect();
            if (cssH(c) > 30) continue;
            // A switch or a dot inside a bare box is the plate the eye reads.
            const fill = plate(c) ? c : [...c.querySelectorAll('*')].find((d) => { const q = d.getBoundingClientRect();
              return shown(d) && !d.closest('svg') && plate(d) && q.width * q.height >= 0.5 * r.width * r.height; });
            if (fill) inkBox(fill, 'plate'); else inkBox(c, 'icon');
          }
        }
        if (one) {
          for (const n of texts0) { const m = metrics(n); inkText(n, null, m, '"' + m.text + '"', false); }
          // A ::before/::after sits between the row's padding and its first (or after its last) item.
          const rb = row.getBoundingClientRect(), z = rb.width / (row.offsetWidth || rb.width);
          const cl = rb.left + (parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft)) * z, cr = rb.right - (parseFloat(cs.borderRightWidth) + parseFloat(cs.paddingRight)) * z;
          const its = [...fl.items.map((c) => c.getBoundingClientRect()), ...texts0.map((n) => rangeRect(n)).filter(Boolean)];
          for (const { p, cs: pc } of pseudos) {
            const t = pseudoText(pc).trim();
            if (LETTER.test(t)) continue;
            const x0 = p === '::before' ? cl : its.length ? Math.max(...its.map((r) => r.right)) : cl;
            const x1 = p === '::before' ? (its.length ? Math.min(...its.map((r) => r.left)) : cr) : cr;
            if (x1 - x0 >= 1) inkItems.push({ kind: 'glyph', what: name(row) + p + (t ? ' "' + t + '"' : ''), x0, x1, y0: rb.top, y1: rb.bottom, el: row });
          }
        }
        if (inkItems.some((i) => i.kind === 'text' || i.kind === 'block' || i.lettered) && inkItems.length >= 2) {
          // An item another box covers (a sticky header, a scroll edge) shows nothing of its own to measure, and one a
          // scroll edge cuts shows only part: its ink and edges end at the cut, not where it stands.
          let cutHere = false;
          const own = inkItems.filter((i) => { const x = (i.x0 + i.x1) / 2, y = (i.y0 + i.y1) / 2, h = document.elementFromPoint(x, y), e = i.el.getBoundingClientRect();
            let whole = true;
            for (let a = i.el.parentElement; a && a !== document.body; a = a.parentElement) {
              if (/visible/.test(getComputedStyle(a).overflow)) continue;
              const b = a.getBoundingClientRect(); if (x < b.left || x > b.right || y < b.top || y > b.bottom) return false;
              if (e.left < b.left - 0.05 || e.right > b.right + 0.05 || e.top < b.top - 0.05 || e.bottom > b.bottom + 0.05) whole = false;
            }
            if (!whole) { cutHere = true; return false; }
            return h && (i.el.contains(h) || h.contains(i.el)); });
          if (cutHere) cut.push(name(row));
          if (own.length >= 2) {
            rows++;
            globalThis.__rigInkEls.push(own.map((i) => [i.el, i.el.getBoundingClientRect().top]));
            ink.push({ row: name(row), k: globalThis.__rigInkEls.length - 1, items: own.map((i) => { const o = Object.assign({}, i); delete o.el; return o; }) });
          }
        }
      }
    }
  }
  faults.push(...mixed.values(), ...glyphs);
  return { rows, faults, ink, cut };
};
// The swept roots moved down by d CSS px on screen by layout (a top offset, never a transform), or put back with null.
// Resolves with how far each root and each inked item moved, so a reading can be taken back to where it stood.
globalThis.__rigInkShift = (d) => {
  const roots = [];
  for (const r of globalThis.__rigInkRoots) {
    if (!r.__rigInk) r.__rigInk = { style: r.getAttribute('style'), top: r.getBoundingClientRect().top, tf: getComputedStyle(r).transform };
    const o = r.__rigInk;
    if (o.style === null) r.removeAttribute('style'); else r.setAttribute('style', o.style);
    if (d === null) { delete r.__rigInk; continue; }
    // Read before any write: a computed style is live.
    const c = getComputedStyle(r), cs = { position: c.position, top: c.top, bottom: c.bottom, marginTop: c.marginTop };
    const px = (v) => (v === 'auto' ? 0 : parseFloat(v));
    const put = (k) => {
      if (cs.position === 'static') { r.style.position = 'relative'; r.style.top = k + 'px'; }
      else if (cs.position === 'relative') r.style.top = px(cs.top) + k + 'px';
      else if (cs.position === 'sticky') r.style.marginTop = px(cs.marginTop) + k + 'px';
      else { r.style.top = px(cs.top) + k + 'px'; if (cs.bottom !== 'auto') r.style.bottom = px(cs.bottom) - k + 'px'; }
    };
    // A zoom on the root or above scales its own offsets.
    const z = r.currentCSSZoom || 1;
    put(d / z);
    let moved = r.getBoundingClientRect().top - o.top;
    if (d && moved && Math.abs(moved - d) > 0.01) { r.setAttribute('style', o.style || ''); put(d / z * d / moved); moved = r.getBoundingClientRect().top - o.top; }
    roots.push({ moved, transform: getComputedStyle(r).transform === o.tf });
  }
  return { roots, items: globalThis.__rigInkEls.map((els) => els.map(([e, t]) => e.getBoundingClientRect().top - t)) };
};
0`;

// What the alignment rule calls a box item beyond the tags: the buttons, plates, switches and checkboxes of
// design-system.md's atom registry, read from it so a control that joins the registry is a box here too.
const BOX_ATOMS = /button|^Link$|^Well|^Tool$|^Number stepper$|^Thing|^Status word$|^Key$|^Switch$|^Checkbox$/;
const BOX_ITEMS = ['button', '[role=button]', 'a', 'label:has(input, select, textarea, button)'].concat(
  (require('fs').readFileSync(require('path').join(__dirname, '../../.claude/rules/design-system.md'), 'utf8').split('\n## Atoms')[1] || '')
    .split('\n## ')[0].split('\n').map((l) => l.split('|')).filter((c) => c.length > 3 && BOX_ATOMS.test(c[1].trim()))
    .flatMap((c) => [...c[2].matchAll(/`([^`]+)`/g)].map((m) => m[1]))).join(',');

// Every visible row under `rootSel` (the whole page when omitted) measured against the alignment rule.
// Resolves with { rows, faults, ink }: the faults that need no measuring (sizes too far apart, capless glyphs) and the rows as
// items for inkSweep, which judges where they stand.
async function alignSweep(session, rootSel) {
  await session.evaluate(ALIGN_SWEEP);
  return session.evaluate('__rigAlignSweep(' + JSON.stringify(rootSel || null) + ', ' + JSON.stringify(BOX_ITEMS) + ')');
}

// The eye's own check: each row alignSweep found, shot at 4 device pixels per CSS pixel and measured on its ink
// (ink.js) with the swept roots moved down by a layout offset at each fraction of OFFSETS, so the judgment is the same
// wherever the window lands. A row whose mean lies within 1/N of a limit is read again at the fractions in between,
// twice at most: it then tips only within 1/16px of the limit. Rows are shot in bands, so a tall pane never becomes one
// huge image. Resolves with { faults, measured, unmoved }; `unmoved` names a root no layout offset moved, whose rows
// were judged at the positions it did reach. Resolves with { relaid: true } when the entry's layout changed on its own
// while it was read, and nothing it read counts.
const OFFSETS = [0, 0.25, 0.5, 0.75];
async function inkSweep(session, rows) {
  const dpr = await session.evaluate('devicePixelRatio');
  const scale = 4 / dpr, unmoved = [];
  const span = (r) => { const xs = r.items.flatMap((i) => [i.x0, i.x1]), ys = r.items.flatMap((i) => [i.y0, i.y1]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; };
  const [vw, vh] = await session.evaluate('[innerWidth, innerHeight]');
  const bandsOf = (list) => {
    const bands = [];
    for (const x of list.map((r) => ({ r, s: span(r) })).sort((a, b) => a.s.y0 - b.s.y0)) {
      const b = bands[bands.length - 1];
      if (b && Math.max(b.y1, x.s.y1) - b.y0 <= 300) { b.rows.push(x.r); b.x0 = Math.min(b.x0, x.s.x0); b.x1 = Math.max(b.x1, x.s.x1); b.y1 = Math.max(b.y1, x.s.y1); }
      else bands.push({ rows: [x.r], ...x.s });
    }
    return bands;
  };
  const readings = new Map(rows.map((r) => [r, []]));
  // How far each inked item stands from where alignSweep found it.
  const now = () => session.evaluate('__rigInkEls.map((els) => els.map(([e, t]) => e.getBoundingClientRect().top - t))');
  const same = (a, b) => a.every((row, k) => row.every((v, i) => Math.abs(v - b[k][i]) <= 0.02));
  const read = async (list, offsets) => {
    const bands = bandsOf(list);
    for (const d of offsets) {
      const sh = await session.evaluate('__rigInkShift(' + d + ')');
      // The entry laid itself out again (a late answer grew it, and its centring moved it): every item found before
      // stands somewhere else, so the rows are found again (design-sweep) rather than read where they were.
      if (!d && !same(sh.items, sh.items.map((r) => r.map(() => 0)))) return 'relaid';
      if (d && !sh.roots.every((r) => Math.abs(r.moved - d) <= 0.02 && r.transform)) {
        const back = await session.evaluate('__rigInkShift(0)');
        if (!same(back.items, back.items.map((r) => r.map(() => 0)))) return 'relaid';
        unmoved.push('moved ' + sh.roots.map((r) => r.moved.toFixed(3) + 'px' + (r.transform ? '' : ' with its transform changed')).join(', ') + ' for ' + d + 'px');
        return false;
      }
      await session.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))');
      const got = [];
      for (const b of bands) {
        // One px of room below for the offset.
        const clip = { x: Math.max(0, Math.floor(b.x0) - 2), y: Math.max(0, Math.floor(b.y0) - 3) };
        clip.width = Math.min(vw, Math.ceil(b.x1) + 2) - clip.x; clip.height = Math.min(vh, Math.ceil(b.y1) + 4) - clip.y;
        if (clip.width < 1 || clip.height < 1) continue;
        const shot = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip: { ...clip, scale } }, 60000);
        const img = ink.decodePng(Buffer.from(shot.data, 'base64'));
        for (const row of b.rows) got.push([row, ink.measureRow(img, clip, row, sh.items[row.k])]);
      }
      if (!same(await now(), sh.items)) return 'relaid';
      for (const [row, m] of got) readings.get(row).push(m);
    }
    return true;
  };
  const judge = (row) => (readings.get(row).length ? ink.judgeRow(row, readings.get(row)) : null);
  // A dimmed item (a defeated row, a disabled control) is shot at full opacity: opacity moves nothing, and a plate
  // dimmed below the judge's fill step would be read by its letters instead of its edges.
  await session.evaluate(`(() => { for (const e of document.querySelectorAll('*')) { const o = +getComputedStyle(e).opacity;
    if (o > 0.05 && o < 1) { e.dataset.rigInkOpacity = e.style.opacity; e.style.opacity = '1'; } } return 1; })()`);
  try {
    let list = rows, offsets = OFFSETS;
    for (let pass = 0; pass < 3 && list.length; pass++) {
      const done = await read(list, offsets);
      if (done === 'relaid') return { relaid: true };
      if (!done) break;
      // The fractions halfway between the n read so far.
      const n = offsets.length * 2 ** pass;
      offsets = Array.from({ length: n }, (_, i) => (2 * i + 1) / (2 * n));
      list = list.filter((r) => { const j = judge(r); return j && j.near; });
    }
  } finally {
    await session.evaluate('__rigInkShift(null), 1');
    await session.evaluate(`(() => { for (const e of document.querySelectorAll('[data-rig-ink-opacity]')) { e.style.opacity = e.dataset.rigInkOpacity; delete e.dataset.rigInkOpacity; } return 1; })()`);
  }
  const faults = [], measured = [];
  for (const row of rows) {
    const m = judge(row);
    if (!m) continue;
    measured.push(m);
    if (m.fault) faults.push(m.fault);
  }
  return { faults, measured, unmoved };
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
    // A vertical divider, 1px of the line token, runs its container's full height: the container's padding is
    // cancelled with negative margins (design-system.md, "Wells and dividers"). A line drawn as a border is not read.
    divider(rootSel) { const root = rootSel ? document.querySelector(rootSel) : document.body; if (!root) return [];
      const probe = document.createElement('i'); probe.style.background = 'var(--g-line)'; root.appendChild(probe);
      const line = getComputedStyle(probe).backgroundColor; probe.remove();
      const out = [];
      [root, ...root.querySelectorAll('*')].forEach(e => { const p = e.parentElement;
        if (!p || !seen(e) || e.closest('svg') || getComputedStyle(e).backgroundColor !== line) return;
        const z = zoomOf(e), b = e.getBoundingClientRect();
        if (Math.abs(b.width / z - 1) > 0.05 || b.height / z < 6) return;
        const pc = getComputedStyle(p), pb = p.getBoundingClientRect(), pz = zoomOf(p);
        const top = b.top - (pb.top + parseFloat(pc.borderTopWidth) * pz), bottom = pb.bottom - parseFloat(pc.borderBottomWidth) * pz - b.bottom;
        if (top > 0.5 || bottom > 0.5) out.push(name(e) + ' stops ' + (top / pz).toFixed(1) + 'px short of the top of ' + name(p) + ' and ' + (bottom / pz).toFixed(1) +
          'px short of its bottom; a divider runs its container\\'s full height'); });
      return out; },
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
    await session.evaluate('__rigSurface.clip(' + sel + ')'), await session.evaluate('__rigSurface.divider(' + sel + ')'));
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

module.exports = { DM_MAP, wav, alignSweep, inkSweep, hoverSweep, surfaceSweep, shiftSweep, installHelpers, settle, poll, hold, inRussian, importWithPlan, drawRooms, step, tvFog, connectOpens, consentFaults };
