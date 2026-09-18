'use strict';
// roomPanel.js — the room-name labels drawn on the DM map, and the pure geometry that places
// them. A room is a polygon; `polygon` stays the word in code.
//
// The card itself is roomCard.js. Layout rules are the dm-ui skill's.


const ROOM_NAME_MAX = 60;     // cap so a pasted essay can't wreck the card header
// Truncation is SILENT, so the cap sits in the gap between a real room (thousands of characters)
// and the failure it guards against: a parse that found no headings, at hundreds of thousands.
const ROOM_DESC_MAX = 20000;

// ─── Pure helpers (unit-tested — keep DOM-free) ───────────────────────────────

// Backfill `name` on polygons from scenes saved before rooms had names.
// ADDITIVE SPREAD ONLY — a fixed key list would silently drop cornerRadii from every scene.
function normalizeRoomFields(polys) {
  if (!Array.isArray(polys)) return [];
  return polys.map(p => ({
    ...p,
    name: p.name ?? ('Room ' + p.id),
  }));
}

// Newlines collapse to spaces: drawRoomLabels() feeds this to fillText(), where a pasted
// multi-line name renders as a control glyph.
function sanitizeRoomName(raw, fallback) {
  const v = String(raw == null ? '' : raw)
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, ROOM_NAME_MAX);
  return v || fallback;
}

// Internal newlines are kept — they are how the DM structures prose they read aloud. No
// fallback: an empty description is a valid, common state.
function sanitizeRoomDesc(raw) {
  return String(raw == null ? '' : raw).slice(0, ROOM_DESC_MAX).trim();
}

// Fit `text` into maxPx, ellipsising from the end; '' when not even the ellipsis fits. A string
// already narrower is returned untouched. measureFn is injected, which keeps this pure.
function ellipsizeToWidth(text, maxPx, measureFn) {
  const s = String(text == null ? '' : text);
  if (!s) return '';
  if (measureFn(s) <= maxPx) return s;
  const ell = '…';
  if (measureFn(ell) > maxPx) return '';
  // Longest prefix that still fits once the ellipsis is appended.
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measureFn(s.slice(0, mid) + ell) <= maxPx) lo = mid; else hi = mid - 1;
  }
  return lo > 0 ? s.slice(0, lo) + ell : ell;
}

// ─── Label geometry (pure — unit-tested) ──────────────────────────────────────

// Label size in SCREEN px, scaling gently with zoom and CLAMPED at both ends: map-locked type
// vanishes when zoomed out, screen-fixed type looks lost inside a hall. The exponent is the dial.
function roomLabelFontPx(zoomLevel, base, minPx, maxPx, exp) {
  const b = base  == null ? 21  : base;
  const lo = minPx == null ? 17  : minPx;
  const hi = maxPx == null ? 38  : maxPx;
  const e  = exp   == null ? 0.4 : exp;
  const z = zoomLevel > 0 ? zoomLevel : 1;
  return Math.round(Math.max(lo, Math.min(hi, b * Math.pow(z, e))));
}

// Horizontal spans of a polygon's interior at height y. Even-odd scanline: each pair of edge
// crossings bounds one inside run, and a concave shape yields more than one.
// EVERY ring's crossings, sorted into one list: the even-odd pairing then skips a hole for free.
function polygonRowSpans(src, y) {
  const rings = Array.isArray(src) ? [src] : polyRings(src);
  const xs = [];
  for (const verts of rings) {
    for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
      const a = verts[j], b = verts[i];
      if ((a.y > y) === (b.y > y)) continue;        // edge doesn't straddle this row
      xs.push(a.x + (y - a.y) / (b.y - a.y) * (b.x - a.x));
    }
  }
  xs.sort((p, q) => p - q);
  const spans = [];
  for (let i = 0; i + 1 < xs.length; i += 2) spans.push({ x0: xs[i], x1: xs[i + 1] });
  return spans;
}

// How far a circular corner of radius r cuts in, d below the top edge. Keeps a label inside a
// heavily rounded room, where the vertices say "sharp corner" and the drawn path does not.
function cornerInsetAt(r, d) {
  if (!(r > 0) || d >= r || d < 0) return 0;
  return r - Math.sqrt(Math.max(0, r * r - (r - d) * (r - d)));
}

// Top-left-ish anchor for a label inside any room shape. Samples rows downward asking whether the
// label fits fully inside, so no shape needs a special case.
//
// Returns the FIRST (highest) row that fits the whole label, or the roomiest row so the caller can
// ellipsise into it. MAP units, so the result is pan-independent and safe to cache.
function fitLabelBox(poly, textW, textH, pad, cornerR, rows) {
  const outer = Array.isArray(poly) ? poly : (poly && poly.vertices);
  if (!outer || outer.length < 3) return null;
  const bb = shapeBBox(Array.isArray(poly) ? outer : poly);
  const n = rows || 14;
  const first = bb.minY + pad + textH / 2;
  const last  = bb.maxY - pad - textH / 2;
  if (last < first) return null;

  let best = null;
  for (let i = 0; i <= n; i++) {
    const y = first + (last - first) * (i / n);
    // Test the label's top AND bottom edges, not its centre: on a shape that narrows upward a
    // centre-only test lets the top corners poke outside the outline.
    const top = polygonRowSpans(poly, y - textH / 2);
    const bot = polygonRowSpans(poly, y + textH / 2);
    const inset = cornerInsetAt(cornerR, (y - textH / 2) - bb.minY);

    let row = null;
    for (const t of top) {
      for (const b of bot) {
        const x0 = Math.max(t.x0, b.x0) + pad + inset;
        const x1 = Math.min(t.x1, b.x1) - pad - inset;
        if (x1 <= x0) continue;
        if (!row || x0 < row.x) row = { x: x0, y, avail: x1 - x0 };
      }
    }
    if (!row) continue;
    if (row.avail >= textW) return row;               // fits whole — take the highest row
    if (!best || row.avail > best.avail) best = row;   // otherwise remember the roomiest
  }
  return best;
}

const RP_GAP    = 22;   // screen px between the card and the room's centroid
const RP_MARGIN = 8;    // keep the card at least this far off every viewport edge

// Where the DM dragged the card, screen px, or null for automatic placement. Once moved it STAYS
// moved until the card closes or the bar is double-clicked, or it lands back on the handles.
let _rpManualPos = null;

// Last automatic placement, keyed to its room. Held still during a vertex or edge drag, or the
// card flips sides mid-edit; it re-places once, on release.
let _rpAutoPos = null;

function _rpAutoFrozen(pid) {
  if (!_rpAutoPos || _rpAutoPos.pid !== pid) return false;
  return (typeof isDraggingVertex !== 'undefined' && isDraggingVertex) ||
         (typeof isDraggingEdge   !== 'undefined' && isDraggingEdge);
}

// Description height: ONE preference for the card, never per room. localStorage, so never in a
// scene or backup. No MIN/MAX here — .rp-desc's CSS already clamps style.height.
const RP_DESC_H_KEY = 'evermist.roomDescHeight';

// Where to put the card, ALL SCREEN PIXELS. `room` is the selected room's screen bounding box,
// NEVER its centroid: the card has to clear the whole room. Preference: above, below, right, left.
function clampPanelPosition(room, pw, ph, vw, vh, gap, margin) {
  const g = gap    == null ? RP_GAP    : gap;
  const m = margin == null ? RP_MARGIN : margin;

  // Math.max wraps Math.min, so a card bigger than the viewport pins to the top/left edge.
  const clampX = l => Math.max(m, Math.min(vw - pw - m, l));
  // Not redundant with the branches below: the box comes from MAP coordinates, so panning can put
  // it far off-screen, and the card must stay readable when its room has scrolled out of view.
  const clampY = t => Math.max(m, Math.min(vh - ph - m, t));

  const left = clampX((room.left + room.right) / 2 - pw / 2);   // centred on the room
  const top  = clampY((room.top + room.bottom) / 2 - ph / 2);

  const above = room.top - g - ph;
  if (above >= m) return { left, top: clampY(above), placement: 'above' };

  const below = room.bottom + g;
  if (below + ph <= vh - m) return { left, top: clampY(below), placement: 'below' };

  const right = room.right + g;
  if (right + pw <= vw - m) return { left: clampX(right), top, placement: 'right' };

  const beside = room.left - g - pw;
  if (beside >= m) return { left: clampX(beside), top, placement: 'left' };

  // The room reaches every edge, so nothing is fully clear of it. Pin the card to whichever edge
  // has the most space, covering as little of the room as possible.
  const slots = [
    { placement: 'above', space: room.top - m,          left,              top: m },
    { placement: 'below', space: vh - m - room.bottom,  left,              top: vh - ph - m },
    { placement: 'right', space: vw - m - room.right,   left: vw - pw - m, top },
    { placement: 'left',  space: room.left - m,         left: m,           top },
  ];
  let best = slots[0];
  for (const s of slots) if (s.space > best.space) best = s;
  return { left: clampX(best.left), top: clampY(best.top), placement: best.placement };
}

// Label text metrics by polygon id: drawCursor() runs on every mouse move, so measureText() must
// not run per room per frame.
const _rpLabelCache = new Map();

function _rpInvalidateLabel(id) { _rpLabelCache.delete(id); }

// Polygon ids restart per scene, so stale entries are meaningless and would accumulate.
function resetRoomLabelCache() { _rpLabelCache.clear(); }

// ─── Room labels on the DM map ────────────────────────────────────────────────
// Names are drawn on the map so the DM can read the dungeon at a glance. DM-only: this paints on
// the cursor overlay, which the Player window doesn't have.
//
// Placement is TOP-LEFT INSIDE the room. The bounding-box corner is outside the shape on a circle
// or a heavily rounded rectangle, so the anchor comes from fitLabelBox().

// Plate padding, generous relative to the type: tighter, it shrink-wraps the glyphs and reads as
// a stray rectangle.
const RP_LABEL_PAD_X = 13;
const RP_LABEL_PAD_Y = 8;
const RP_LABEL_RADIUS = 7;

// Gap between the PLATE and the room's outline, one number for both axes. ⚠ The fit sizes the
// whole plate, never the text: fitting the text makes the draw step subtract PAD_X back out and
// collapses the left gap. Screen px, ÷ zoom on the way into the fit.
const RP_LABEL_GAP = 10;

function _rpLabelFont(px) {
  return '600 ' + px + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
}

function drawRoomLabels() {
  if (typeof isPlayer !== 'undefined' && isPlayer) return;
  // A room name over a fire the DM is drawing is chrome for a shape they cannot touch.
  if (placeMode === 'effects') return;
  if (!showRoomLabels || !polygons.length || !cursorCtx) return;

  const ctx = cursorCtx;
  const fontPx = roomLabelFontPx(zoom);
  ctx.save();
  ctx.font         = _rpLabelFont(fontPx);
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';
  ctx.setLineDash([]);
  ctx.shadowBlur   = 0;

  const vw = cursorCanvas.width, vh = cursorCanvas.height;
  const measure = t => ctx.measureText(t).width;
  const textH   = fontPx + RP_LABEL_PAD_Y * 2;   // backing height, screen px

  for (const poly of polygons) {
    if (poly.id === selectedPolygonId) continue;         // its name is already in the card
    if (!poly.vertices || poly.vertices.length < 3) continue;

    const name = poly.name != null ? poly.name : ('Room ' + poly.id);
    if (!name) continue;

    // Neither measureText nor the row scan may run per room per frame. The fit is in MAP units, so
    // the cached anchor is pan-independent.
    const bb  = shapeBBox(poly);
    const key = name + '|' + fontPx + '|' + flatVertexCount(poly) + '|' +
                Math.round(bb.minX) + ',' + Math.round(bb.minY) + ',' +
                Math.round(bb.maxX) + ',' + Math.round(bb.maxY) + '|' +
                (poly.cornerRadius || 0) + '|' + (poly.cornerRadii ? poly.cornerRadii.join(',') : '');

    let entry = _rpLabelCache.get(poly.id);
    if (!entry || entry.key !== key) {
      // The widest radius in play, since it is the one that could push the label outside.
      let cornerR = poly.cornerRadius || 0;
      if (poly.cornerRadii) {
        for (const r of poly.cornerRadii) if (r != null && r > cornerR) cornerR = r;
      }
      // Fit the PLATE, not the text — see RP_LABEL_GAP.
      const box = fitLabelBox(
        poly,
        (measure(name) + RP_LABEL_PAD_X * 2) / zoom,   // map units — screen plate width ÷ zoom
        textH / zoom,
        RP_LABEL_GAP / zoom,
        cornerR,
      );
      if (!box) { _rpLabelCache.set(poly.id, { key, text: '' }); continue; }
      const text = ellipsizeToWidth(name, box.avail * zoom - RP_LABEL_PAD_X * 2, measure);
      // Auto-hide: a truncation leaving under two real characters names nothing and is dropped.
      // Only truncated text is judged, so a room genuinely called "A" keeps its label.
      const truncated = text !== name;
      const tooShort  = truncated && text.replace('…', '').trim().length < 2;
      entry = (text && !tooShort)
        ? { key, text, w: measure(text), mx: box.x, my: box.y }
        : { key, text: '' };
      _rpLabelCache.set(poly.id, entry);
    }
    if (!entry.text) continue;

    // sx/sy is the plate's left edge and vertical centre; the glyphs start one PAD_X in.
    const { sx, sy } = toScreen(entry.mx, entry.my);
    const bw = entry.w + RP_LABEL_PAD_X * 2;
    if (sx < -bw || sy < -textH || sx > vw || sy > vh + textH) continue;

    // Opaque enough to read against bright map art, or the name dissolves into the texture. The
    // hairline is the panel border colour, so the plate reads as app chrome.
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(sx, sy - textH / 2, bw, textH, RP_LABEL_RADIUS);
    else ctx.rect(sx, sy - textH / 2, bw, textH);
    ctx.fillStyle = 'rgba(10, 9, 18, 0.75)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.055)';
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.fillText(entry.text, sx + RP_LABEL_PAD_X, sy);
  }

  ctx.restore();
}

function toggleRoomLabels() {
  showRoomLabels = !showRoomLabels;
  drawCursor(lastScreenX, lastScreenY);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeRoomFields, sanitizeRoomName, sanitizeRoomDesc,
    clampPanelPosition, ellipsizeToWidth,
    roomLabelFontPx, polygonRowSpans, cornerInsetAt, fitLabelBox,
    ROOM_NAME_MAX, ROOM_DESC_MAX,
  };
}
