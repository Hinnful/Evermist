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

// Backfill `name` on polygons from scenes saved before rooms had names; `nameFor(id)` words it.
// ADDITIVE SPREAD ONLY — a fixed key list would silently drop cornerRadii from every scene.
function normalizeRoomFields(polys, nameFor) {
  if (!Array.isArray(polys)) return [];
  return polys.map(p => ({
    ...p,
    name: p.name ?? nameFor(p.id),
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

// Label size in SCREEN px for a surface at zoom z under interface zoom uz: the app's own type size
// (12px, or 11px for a name inside a picture) growing gently with zoom, up to 2.5x. One rule for every plate.
function roomLabelFontPx(zoomLevel, uiZoom, small) {
  const uz = uiZoom > 0 ? uiZoom : 1;
  const z = zoomLevel > 0 ? zoomLevel : 1;
  return Math.round((small ? 11 : 12) * uz * Math.max(1, Math.min(2.5, Math.pow(z, 0.4))));
}

// A plate's box for type of fontPx and text textW wide: padding and radius are fractions of the type
// (em from the --plate-* tokens), so a plate keeps its shape at every size.
function plateMetrics(fontPx, textW, skin) {
  const padX = fontPx * skin.padX, padY = fontPx * skin.padY;
  return { padX, padY, radius: fontPx * skin.radius, w: textW + padX * 2, h: fontPx + padY * 2 };
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

// Gap between the PLATE and the room's outline, one number for both axes. ⚠ The fit sizes the
// whole plate, never the text: fitting the text makes the draw step subtract the padding back out and
// collapses the left gap. Screen px, ÷ zoom on the way into the fit.
const RP_LABEL_GAP = 10;

// The plate skin lives once, as --plate-* tokens on :root (base.css); the canvas reads them here.
let _rpSkin = null;
function rpPlateSkin() {
  if (_rpSkin) return _rpSkin;
  const cs = getComputedStyle(document.documentElement);
  const v = n => cs.getPropertyValue('--plate-' + n).trim();
  return (_rpSkin = {
    padX: parseFloat(v('pad-x')), padY: parseFloat(v('pad-y')), radius: parseFloat(v('radius')),
    bg: v('bg'), line: v('line'), text: v('text'), family: v('family'), weight: v('weight'),
    shadowColor: v('shadow-color'), shadowY: parseFloat(v('shadow-y')), shadowBlur: parseFloat(v('shadow-blur')),
  });
}

function _rpUiZoom() {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')) || 1;
}

function _rpLabelFont(px) {
  const k = rpPlateSkin();
  return k.weight + ' ' + px + 'px ' + k.family;
}

function drawRoomLabels() {
  if (typeof isPlayer !== 'undefined' && isPlayer) return;
  // A room name over a fire the DM is drawing is chrome for a shape they cannot touch.
  if (placeMode !== 'rooms') return;
  if (!showRoomLabels || !polygons.length || !cursorCtx) return;

  const ctx = cursorCtx;
  const skin = rpPlateSkin();
  const fontPx = roomLabelFontPx(zoom, _rpUiZoom());
  ctx.save();
  ctx.font         = _rpLabelFont(fontPx);
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';
  ctx.setLineDash([]);
  ctx.shadowBlur   = 0;

  const vw = cursorCanvas.width, vh = cursorCanvas.height;
  const measure = t => ctx.measureText(t).width;
  const pm = plateMetrics(fontPx, 0, skin), padX = pm.padX, textH = pm.h;   // plate height, screen px

  for (const poly of polygons) {
    if (poly.id === selectedPolygonId) continue;         // its name is already in the card
    if (!poly.vertices || poly.vertices.length < 3) continue;

    const name = poly.name != null ? poly.name : t('Room {n}', { n: poly.id });
    if (!name) continue;

    // Neither measureText nor the row scan may run per room per frame. The fit is in MAP units, so
    // the cached anchor is pan-independent.
    const bb  = shapeBBox(poly);
    const key = name + '|' + fontPx + '|' + flatVertexCount(poly) + '|' +
                Math.round(bb.minX) + ',' + Math.round(bb.minY) + ',' +
                Math.round(bb.maxX) + ',' + Math.round(bb.maxY) + '|' +
                (poly.cornerRadius || 0) + '|' + (poly.cornerRadii ? poly.cornerRadii.join(',') : '') +
                '|' + seatTurn;

    let entry = _rpLabelCache.get(poly.id);
    if (!entry || entry.key !== key) {
      // The widest radius in play, since it is the one that could push the label outside.
      let cornerR = poly.cornerRadius || 0;
      if (poly.cornerRadii) {
        for (const r of poly.cornerRadii) if (r != null && r > cornerR) cornerR = r;
      }
      // Fit the PLATE, not the text — see RP_LABEL_GAP.
      // A turned seat fits the plate against the room as the screen shows it, so it reads upright.
      const box = fitLabelBox(
        seatTurn ? turnShape(poly, seatTurn) : poly,
        (measure(name) + padX * 2) / zoom,   // map units — screen plate width ÷ zoom
        textH / zoom,
        RP_LABEL_GAP / zoom,
        cornerR,
      );
      if (!box) { _rpLabelCache.set(poly.id, { key, text: '' }); continue; }
      const text = ellipsizeToWidth(name, box.avail * zoom - padX * 2, measure);
      // Auto-hide: a truncation leaving under two real characters names nothing and is dropped.
      // Only truncated text is judged, so a room genuinely called "A" keeps its label.
      const truncated = text !== name;
      const tooShort  = truncated && text.replace('…', '').trim().length < 2;
      const at = turnVec(box.x, box.y, unturn(seatTurn));
      entry = (text && !tooShort)
        ? { key, text, w: measure(text), mx: at.x, my: at.y }
        : { key, text: '' };
      _rpLabelCache.set(poly.id, entry);
    }
    if (!entry.text) continue;

    // sx/sy is the plate's left edge and vertical centre; the glyphs start one PAD_X in.
    const { sx, sy } = toScreen(entry.mx, entry.my);
    const bw = entry.w + padX * 2;
    if (seatTurn ? (sx < -bw || sy < -bw || sx > vw + bw || sy > vh + bw)
                 : (sx < -bw || sy < -textH || sx > vw || sy > vh + textH)) continue;

    ctx.save();
    uprightAt(ctx, sx, sy);
    const top = sy - textH / 2, r = pm.radius;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(sx, top, bw, textH, r); else ctx.rect(sx, top, bw, textH);
    ctx.shadowColor = skin.shadowColor;
    ctx.shadowBlur = skin.shadowBlur;
    ctx.shadowOffsetY = skin.shadowY;
    ctx.fillStyle = skin.bg;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(sx + 0.5, top + 0.5, bw - 1, textH - 1, Math.max(0, r - 0.5));
    else ctx.rect(sx + 0.5, top + 0.5, bw - 1, textH - 1);
    ctx.lineWidth = 1;
    ctx.strokeStyle = skin.line;
    ctx.stroke();

    ctx.fillStyle = skin.text;
    ctx.fillText(entry.text, sx + padX, sy);
    ctx.restore();
  }

  ctx.restore();
}

function toggleRoomLabels() {
  showRoomLabels = !showRoomLabels;
  refreshRoomsControlUI();
  paneBroadcast('room-labels', { on: showRoomLabels });
  drawCursor(lastScreenX, lastScreenY);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeRoomFields, sanitizeRoomName, sanitizeRoomDesc,
    ellipsizeToWidth,
    roomLabelFontPx, plateMetrics, polygonRowSpans, cornerInsetAt, fitLabelBox,
    ROOM_NAME_MAX, ROOM_DESC_MAX,
  };
}
