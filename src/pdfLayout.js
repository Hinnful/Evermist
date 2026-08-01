'use strict';
// pdfLayout.js — turning a PDF page's positioned text back into lines, in reading order.
//
// WHY THIS EXISTS. A published module ships as a PDF, so asking the DM to export a .txt first is
// friction the app should absorb — a campaign module is not something you "prepare". But a PDF has
// no lines and no paragraphs: it has glyph runs at coordinates. Recovering the text is not the hard
// part (pdf.js does that); recovering the READING ORDER of a two-column book with sidebars and
// spanning headings is. That reconstruction is this file, and it is pure so it can be tested.
//
// NOT a browser-runtime module despite living in src/ — main.js requires it, because pdfjs-dist is
// ESM-only and browser-side `import` breaks on file://. It sits here to ride the src/**/*.js build
// glob and the node:test convention, and it is deliberately dependency-free so either side can
// require it. There is no <script src> tag for it.
//
// THE MISTAKE TO NOT REPEAT: group items into lines FIRST and split columns after. On a two-column
// page the left and right lines share a baseline, so grouping by y merges them into one line of
// roughly double the width — every body line then looks like it spans the page, the column split
// never fires, and the output is the two columns interleaved sentence by sentence. Measured on the
// real book: that order gives a 96-character median line where the correct order gives 51.
// Columns first. Always.

// Vertical tolerance for "same line", in PDF points. Generous enough for the sub-pixel baseline
// jitter a typesetter leaves behind, tight enough not to merge consecutive lines (~12pt apart).
const PL_LINE_TOL = 3;

// How far past the page's midline a run must reach before it counts as SPANNING both columns
// rather than belonging to one. A column's own text stops well short of the gutter, so this only
// needs to exceed the raggedness of a justified right edge.
const PL_SPAN_MARGIN = 40;

// Group text runs that share a baseline into one line. Safe ONLY within a single column — see the
// header. `items` are {str, x, y, w}; the result carries the line's own extent so the caller can
// ask where on the page it sits.
function plGroupLines(items, tol) {
  const t = tol == null ? PL_LINE_TOL : tol;
  const sorted = (Array.isArray(items) ? items : [])
    .filter(it => it && it.str && String(it.str).trim())
    .slice()
    .sort((a, b) => (b.y - a.y) || (a.x - b.x));   // top-to-bottom, then left-to-right

  const lines = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= t) last.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  return lines.map(l => {
    l.items.sort((a, b) => a.x - b.x);
    // Runs are joined with no separator: a PDF splits a word across runs at every kerning or style
    // change, so inserting spaces would break words apart. The runs carry their own spaces.
    const text = l.items.map(i => String(i.str)).join('').replace(/\s+/g, ' ').trim();
    return {
      text,
      y: l.y,
      x0: Math.min(...l.items.map(i => i.x)),
      x1: Math.max(...l.items.map(i => i.x + (i.w || 0))),
    };
  }).filter(l => l.text);
}

// Which of the page's three buckets a run belongs to: the left column, the right column, or
// spanning both. A run that starts left of the gutter and ends well right of it spans.
function plClassify(item, pageWidth, spanMargin) {
  const m = spanMargin == null ? PL_SPAN_MARGIN : spanMargin;
  const mid = pageWidth / 2;
  const x0 = item.x, x1 = item.x + (item.w || 0);
  if (x0 < mid - m && x1 > mid + m) return 'span';
  return (x0 + x1) / 2 < mid ? 'left' : 'right';
}

// One page's runs → its lines, in reading order.
//
// Spanning lines (a chapter heading, a wide table, a full-width illustration caption) cut the page
// into BANDS. Within a band the left column is read top-to-bottom before the right, which is what
// a human does; across bands the spanning line separates them. Without the banding, a heading
// halfway down the page would be read after both full columns, landing its rooms under the wrong
// heading.
function plPageLines(page, opts) {
  const o = opts || {};
  const width = (page && page.width) || 0;
  const items = (page && page.items) || [];
  if (!width || !items.length) return [];

  const buckets = { left: [], right: [], span: [] };
  for (const it of items) buckets[plClassify(it, width, o.spanMargin)].push(it);

  const left  = plGroupLines(buckets.left,  o.lineTol);
  const right = plGroupLines(buckets.right, o.lineTol);
  const span  = plGroupLines(buckets.span,  o.lineTol);

  // Bands run downward, so band boundaries are descending y values. A line belongs to the band
  // whose top it is below and whose bottom it is above.
  const out = [];
  let top = Infinity;
  for (const boundary of [...span.map(s => s.y), -Infinity]) {
    const inBand = l => l.y <= top && l.y > boundary;
    left.filter(inBand).forEach(l => out.push(l.text));
    right.filter(inBand).forEach(l => out.push(l.text));
    const s = span.find(x => x.y === boundary);
    if (s) out.push(s.text);
    top = boundary;
  }
  return out;
}

// Every page's lines, concatenated into the one text blob the module parser consumes.
// Page furniture is left in on purpose: moduleText.js already identifies and removes it, and it
// does so better than a coordinate-based guess would — a running header is not reliably at a fixed
// position, but it IS reliably the same text with a different page number attached.
function plDocumentText(pages, opts) {
  return (Array.isArray(pages) ? pages : [])
    .map(p => plPageLines(p, opts).join('\n'))
    .join('\n');
}

// ─── Node.js export guard (main.js + unit tests) ─────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    plGroupLines, plClassify, plPageLines, plDocumentText,
    PL_LINE_TOL, PL_SPAN_MARGIN,
  };
}
