'use strict';
// cornerRound.js — rounding a picked shape's corners by hand, Figma's way. A focused shape shows a
// circle in every corner while the pointer is on it; edit mode shows the picked corner's alone.

const CORNER_INSET_PX = 20, CORNER_HIT_PX = 8, CORNER_MIN_SHAPE_PX = 70;
const CORNER_REST_FILL = 'rgba(255,244,214,0.55)';
const CORNER_ICON_ALL = 'M2 6V4.5A2.5 2.5 0 014.5 2H6M10 2h1.5A2.5 2.5 0 0114 4.5V6M14 10v1.5a2.5 2.5 0 01-2.5 2.5H10M6 14H4.5A2.5 2.5 0 012 11.5V10';
const CORNER_ICON_ONE = 'M2.5 14V6.5A4 4 0 016.5 2.5H14';

let cornerHover = false;   // the pointer is over the focused shape
let cornerHot = -1;        // flat index of the circle under the pointer
let cornerAlt = false;
let cornerDrag = null;
let cornerField = null;

function _cornerAt(poly, flat) {
  const ref = flatVertexRef(poly, flat);
  if (!ref) return null;
  const rings = polyRings(poly);
  let offset = 0;
  for (let r = 0; r < ref.ring; r++) offset += rings[r].length;
  const verts = rings[ref.ring];
  const h = cornerHandle(verts, poly.handles, offset, ref.i, cornerRadiusAt(poly, flat), CORNER_INSET_PX / zoom, !!poly.open);
  return h && { ...h, flat, v: verts[ref.i] };
}

function cornerCircles(poly) {
  if (isPlayer || shape !== 'select' || !poly) return [];
  const b = getPolyBBox(poly.vertices);
  // A line is long and thin, so it is its longer side that must be big enough to hold a circle.
  const span = poly.open ? Math.max(b.maxX - b.minX, b.maxY - b.minY) : Math.min(b.maxX - b.minX, b.maxY - b.minY);
  if (span * zoom < CORNER_MIN_SHAPE_PX) return [];
  let flats;
  if (shapeEditMode) {
    if (selectedVertexIndex < 0) return [];
    flats = [selectedVertexIndex];
  } else if (cornerDrag && cornerDrag.solo) {
    flats = [cornerDrag.flat];
  } else if (cornerDrag || cornerHover || cornerField) {
    flats = poly.vertices.map((_, i) => i);
  } else {
    return [];
  }
  return flats.map(f => _cornerAt(poly, f)).filter(Boolean);
}

function _cornerHitAt(poly, p) {
  const r = CORNER_HIT_PX / zoom;
  return cornerCircles(poly).find(h => Math.hypot(p.x - h.x, p.y - h.y) <= r) || null;
}

const _cornerAlong = (h, p) => (p.x - h.v.x) * h.dir.x + (p.y - h.v.y) * h.dir.y;

function drawCornerCircles(poly) {
  const cs = cornerCircles(poly);
  const solo = shapeEditMode || (cornerDrag ? cornerDrag.solo : cornerAlt);
  const c = cursorCtx;
  c.save();
  for (const h of cs) {
    const s = toScreen(h.x, h.y);
    const lit = !!cornerDrag || (cornerHot >= 0 && (!solo || cornerHot === h.flat));
    c.beginPath();
    c.arc(s.sx, s.sy, 4, 0, Math.PI * 2);
    c.fillStyle = lit ? (solo ? SHAPE_PART_SELECTED : POLY_EDGE_SELECTED) : CORNER_REST_FILL;
    c.fill();
    c.strokeStyle = lit ? '#ffffff' : POLY_EDGE_SELECTED;
    c.lineWidth = 1.5;
    c.stroke();
  }
  c.restore();
  const held = cornerDrag && cs.find(h => h.flat === cornerDrag.flat);
  if (held) {
    // Below and right of the circle as the DM sees it, whichever way the seat turns the map.
    const s = toScreen(held.x, held.y), d = turnDelta(40, 20);
    drawLabelPlate(cursorCtx, s.sx + d.x, s.sy + d.y, Math.round(cornerRadiusAt(poly, held.flat)) + ' px',
                   cornerDrag.solo ? CORNER_ICON_ONE : CORNER_ICON_ALL,
                   cornerDrag.solo ? SHAPE_PART_SELECTED : '#8b9099');
  }
  _cornerPlaceField(poly);
}

// From selectHoverCursor: tracks the pointer over the focused shape and answers a cursor over a circle.
// A line has no inside, so its circles show while the pointer is near it or on one of them.
function _cornerHoverOnLine(poly, pos) {
  if (wrNearest(wrSamples(poly), pos).d < 24 / zoom) return true;
  const was = cornerHover;
  cornerHover = true;
  const on = !!_cornerHitAt(poly, pos);
  cornerHover = was;
  return on;
}

function cornerRoundHover(poly, pos, e) {
  const was = [cornerHover, cornerHot, cornerAlt].join();
  cornerHover = !!poly && !shapeEditMode && (poly.open ? _cornerHoverOnLine(poly, pos) : pointInShape(pos.x, pos.y, poly));
  cornerAlt = !!(e && e.altKey);
  const h = poly ? _cornerHitAt(poly, pos) : null;
  cornerHot = h ? h.flat : -1;
  if ([cornerHover, cornerHot, cornerAlt].join() !== was) drawCursor(lastScreenX, lastScreenY);
  return h ? 'pointer' : null;
}

function cornerRoundDown(poly, raw, e) {
  if (cornerField) cornerFieldClose(true);
  cornerAlt = !!(e && e.altKey);
  const h = poly ? _cornerHitAt(poly, raw) : null;
  if (!h) return false;
  cornerDrag = {
    flat: h.flat, solo: shapeEditMode || !!(e && e.altKey), h,
    r0: Math.min(cornerRadiusAt(poly, h.flat), h.maxR), along0: _cornerAlong(h, raw), wrote: false,
  };
  return true;
}

function cornerRoundMove(poly, pos) {
  if (!cornerDrag) return false;
  const d = cornerDrag;
  if (poly) {
    const r = cornerDragRadius(d.h, d.r0, _cornerAlong(d.h, pos) - d.along0);
    if (d.wrote || r !== d.r0) {
      if (!d.wrote) { pushUndo(); d.wrote = true; }
      _cornerWrite(poly, d.solo ? [d.flat] : null, r);
    }
  }
  drawCursor(lastScreenX, lastScreenY);
  return true;
}

function cornerRoundUp() {
  if (!cornerDrag) return false;
  const wrote = cornerDrag.wrote;
  cornerDrag = null;
  if (wrote) persistShapeEdit();
  drawCursor(lastScreenX, lastScreenY);
  return true;
}

function cornerRoundDragging() { return !!cornerDrag; }

// `flats` null writes every corner.
function _cornerWrite(poly, flats, r) {
  if (flats) {
    const n = flatVertexCount(poly);
    editCornerRadii(poly, rs => { while (rs.length < n) rs.push(null); for (const f of flats) rs[f] = r; });
  } else {
    setAllCornerRadii(poly, r);
  }
  shapeGeometryChanged();
  fogDirty = true;
  scheduleRender();
}

// ─── The number field ─────────────────────────────────────────────────────────
// A double-click on a circle. Its two presses already ran through cornerRoundDown, which wrote nothing.
function cornerRoundDblClick(poly, raw) {
  const h = poly ? _cornerHitAt(poly, raw) : null;
  if (!h) return false;
  const one = shapeEditMode || cornerAlt;
  const flats = one ? [h.flat] : null;
  const all = Array.from({ length: flatVertexCount(poly) }, (_, i) => i);
  const vals = new Set((flats || all).map(f => cornerRadiusAt(poly, f)));
  const el = document.getElementById('corner-field'), num = document.getElementById('corner-field-num');
  cornerField = {
    id: poly.id, flat: h.flat, flats, pushed: false,
    before: { r: poly.cornerRadius, radii: poly.cornerRadii ? poly.cornerRadii.slice() : null },
  };
  num.value = vals.size === 1 ? [...vals][0] : '';
  num.placeholder = vals.size === 1 ? '' : t('Mixed');
  num.style.width = Math.max(4, num.placeholder.length + 1) + 'ch';
  el.classList.toggle('rp-per-vertex', one);
  el.style.display = 'flex';
  _cornerPlaceField(poly);
  num.focus();
  num.select();
  return true;
}

function _cornerPlaceField(poly) {
  if (!cornerField) return;
  if (!poly || poly.id !== cornerField.id) { cornerFieldClose(true); return; }
  const h = _cornerAt(poly, cornerField.flat);
  if (!h) return;
  // On the far side of the circle from its corner, so the corner's own dot stays in sight.
  const s = toScreen(h.x, h.y), v = toScreen(h.v.x, h.v.y);
  const p = viewToClient(s.sx, s.sy), q = viewToClient(v.sx, v.sy);
  const el = document.getElementById('corner-field'), box = el.getBoundingClientRect();
  const away = { x: p.x >= q.x ? 1 : -1, y: p.y >= q.y ? 1 : -1 };
  const st = _rpScreenToStyle(el, p.x + away.x * 10 - (away.x < 0 ? box.width : 0),
                                  p.y + away.y * 10 - (away.y < 0 ? box.height : 0));
  el.style.left = st.left + 'px';
  el.style.top = st.top + 'px';
}

function _cornerFieldPoly() {
  return cornerField ? activeShapeList().find(s => s.id === cornerField.id) || null : null;
}

function _cornerFieldInput(num) {
  num.value = num.value.replace(/[^0-9]/g, '');
  const poly = _cornerFieldPoly();
  if (!poly || num.value === '') return;
  if (!cornerField.pushed) { pushUndo(); cornerField.pushed = true; }
  _cornerWrite(poly, cornerField.flats, parseInt(num.value, 10));
  drawCursor(lastScreenX, lastScreenY);
}

// `keep` false puts the radii back as the field found them, and takes back the undo step it spent.
function cornerFieldClose(keep) {
  if (!cornerField) return;
  const f = cornerField, poly = _cornerFieldPoly();
  cornerField = null;
  document.getElementById('corner-field').style.display = 'none';
  if (poly && f.pushed) {
    if (!keep) {
      if (f.before.r === undefined) delete poly.cornerRadius; else poly.cornerRadius = f.before.r;
      if (f.before.radii) poly.cornerRadii = f.before.radii; else delete poly.cornerRadii;
      if (worldMapOpen) worldUndoDropLast(); else undoStack.pop();
      shapeGeometryChanged();
      fogDirty = true;
      scheduleRender();
    }
    persistShapeEdit();
  }
  drawCursor(lastScreenX, lastScreenY);
}

function initCornerField() {
  const num = document.getElementById('corner-field-num');
  if (!num) return;
  num.addEventListener('input', () => _cornerFieldInput(num));
  num.addEventListener('keydown', e => {
    e.stopPropagation();   // keep the map shortcuts out of a field being typed in
    if (e.key === 'Enter') { e.preventDefault(); cornerFieldClose(true); }
    if (e.key === 'Escape') { e.preventDefault(); cornerFieldClose(false); }
  });
  num.addEventListener('blur', () => cornerFieldClose(true));
  container.addEventListener('mouseleave', () => {
    if (!cornerHover && cornerHot < 0) return;
    cornerHover = false; cornerHot = -1;
    drawCursor(lastScreenX, lastScreenY);
  });
}
