'use strict';
// pdfLayout.js — turning a PDF page's positioned text back into lines, in reading order.
//
// A PDF has no lines and no paragraphs, only glyph runs at coordinates. pdf.js recovers the text;
// recovering the READING ORDER of a two-column book is this file. Pure, so it can be tested.
//
// Not browser code despite living in src/ — main.js requires it and there is no <script> tag. It
// stays dependency-free so either side can require it.
//
// ⚠ COLUMNS FIRST, LINES SECOND. On a two-column page the left and right lines share a baseline, so
// grouping by y merges them into one double-width line, the column split never fires, and the
// output interleaves the two columns sentence by sentence.

// "Same line" tolerance in PDF points: loose enough for typesetter baseline jitter, tight
// enough not to merge consecutive lines (~12pt apart).
const PL_LINE_TOL = 3;

// How far past the midline a run must reach to count as SPANNING both columns. A column's text
// stops well short of the gutter, so this only has to exceed a justified edge's raggedness.
const PL_SPAN_MARGIN = 40;

// Group runs sharing a baseline into one line. Safe ONLY within a single column.
// `items` are {str, x, y, w}; the result carries the line's extent.
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
    // Joined with NO separator: a PDF splits a word across runs at every kerning or style
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

// Left column, right column, or spanning both.
function plClassify(item, pageWidth, spanMargin) {
  const m = spanMargin == null ? PL_SPAN_MARGIN : spanMargin;
  const mid = pageWidth / 2;
  const x0 = item.x, x1 = item.x + (item.w || 0);
  if (x0 < mid - m && x1 > mid + m) return 'span';
  return (x0 + x1) / 2 < mid ? 'left' : 'right';
}

// One page's runs → its lines, in reading order.
//
// Spanning lines cut the page into BANDS, and within a band the left column is read before the
// right. Without the banding, a heading halfway down the page is read after both columns and its
// rooms land under the wrong heading.
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

  // Bands run downward, so boundaries are descending y values.
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

// Every page's lines, concatenated into the blob the module parser consumes. Page furniture is left
// in: moduleText.js identifies it better than coordinates can, because a running header is not
// reliably positioned but IS reliably the same text with a different number.
function plDocumentText(pages, opts) {
  return (Array.isArray(pages) ? pages : [])
    .map(p => plPageLines(p, opts).join('\n'))
    .join('\n');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    plGroupLines, plClassify, plPageLines, plDocumentText,
    PL_LINE_TOL, PL_SPAN_MARGIN,
  };
}
