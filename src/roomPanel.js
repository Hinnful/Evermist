'use strict';
// roomPanel.js — the room card (the floating panel shown when a room is selected) plus the
// room-name labels drawn on the DM map. A room is a polygon; `polygon` stays the word in code.
//
// The card is MOVABLE and its description RESIZABLE, neither of them polish: the card floats
// over the map and will sometimes cover the handles the DM selected the room by.
//
// Called once from initToolbar() (DM only). Layout rules in CLAUDE.md, rejected shapes in
// docs/DECISIONS.md.

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
function polygonRowSpans(verts, y) {
  const xs = [];
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const a = verts[j], b = verts[i];
    if ((a.y > y) === (b.y > y)) continue;          // edge doesn't straddle this row
    xs.push(a.x + (y - a.y) / (b.y - a.y) * (b.x - a.x));
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
function fitLabelBox(verts, textW, textH, pad, cornerR, rows) {
  if (!verts || verts.length < 3) return null;
  const bb = getPolyBBox(verts);
  const n = rows || 14;
  const first = bb.minY + pad + textH / 2;
  const last  = bb.maxY - pad - textH / 2;
  if (last < first) return null;

  let best = null;
  for (let i = 0; i <= n; i++) {
    const y = first + (last - first) * (i / n);
    // Test the label's top AND bottom edges, not its centre: on a shape that narrows upward a
    // centre-only test lets the top corners poke outside the outline.
    const top = polygonRowSpans(verts, y - textH / 2);
    const bot = polygonRowSpans(verts, y + textH / 2);
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

// ─── Card UI ──────────────────────────────────────────────────────────────────

// Id of the room the fields currently hold values for. NOT selectedPolygonId: a canvas click
// changes the selection *before* the focused field's blur fires, so commits key off this.
let _rpFieldPid = null;

// Label text metrics by polygon id: drawCursor() runs on every mouse move, so measureText() must
// not run per room per frame.
const _rpLabelCache = new Map();

function _rpInvalidateLabel(id) { _rpLabelCache.delete(id); }

// Polygon ids restart per scene, so stale entries are meaningless and would accumulate.
function resetRoomLabelCache() { _rpLabelCache.clear(); }

function _rpEl(id) { return document.getElementById(id); }

// Resolves against whichever list the placement mode names, since that is where the selection
// came from. One helper therefore serves a room and an effect.
function _rpFindPoly(id) {
  return id == null ? null : activeShapeList().find(s => s.id === id) || null;
}

// ⚠ THE CARD'S OWN FIELDS RESOLVE AGAINST `polygons`, NOT the active list. The card holds a ROOM,
// and what closes it on a live edit is the placement mode changing — at which point the active
// list is the OTHER one. Ids are numbered per list, so the name would land on an effect.
function _rpFindRoom(id) {
  return id == null ? null : polygons.find(p => p.id === id) || null;
}

// A room defaults to "Room 4", an effect to "Fire 4". `material` is the discriminator
// everywhere; there is no type field to keep in step with it.
function _rpFallbackName(poly) {
  return (poly.material ? 'Fire ' : 'Room ') + poly.id;
}

// pushUndo() runs BEFORE the write and only on a real change, so one Ctrl+Z reverts one edit.
function _rpCommitName() {
  const el = _rpEl('rp-name');
  const poly = _rpFindRoom(_rpFieldPid);
  if (!el || !poly) return;
  const v = sanitizeRoomName(el.value, _rpFallbackName(poly));
  el.value = v;
  if (v === poly.name) return;
  pushUndo();
  poly.name = v;
  _rpInvalidateLabel(poly.id);
  scheduleAutoSave();   // nothing else writes scene.polygons — without this it's lost on reload
  drawCursor(lastScreenX, lastScreenY);
}

function _rpCommitDesc() {
  const el = _rpEl('rp-desc');
  const poly = _rpFindRoom(_rpFieldPid);
  if (!el || !poly) return;
  const v = sanitizeRoomDesc(el.value);
  el.value = v;
  // `desc` is absent until typed, so missing and empty are one value — otherwise a blur on an
  // untouched field pushes a pointless undo.
  if (v === (poly.desc == null ? '' : poly.desc)) return;
  pushUndo();
  poly.desc = v;
  scheduleAutoSave();
}

function _rpCommitFields() {
  _rpCommitName();
  _rpCommitDesc();
}

// Fill name AND description from one module-text entry, when the DM picks from the dropdown.
//
// ONE pushUndo() for the pair: a pick is a single act. Pushed lazily, on the first real write, so
// declining the question leaves no empty undo.
//
// The description is never silently replaced. ⚠ THE QUESTION IS ASYNCHRONOUS: write the NAME up
// front, because opening the dialog blurs the name field and runs its commit, which would write
// the OLD text back over the pick.
function applyModuleEntryToRoom(entry) {
  const poly = _rpFindPoly(selectedPolygonId);
  if (!poly || !entry) return false;

  const nextName = sanitizeRoomName(entry.title, _rpFallbackName(poly));
  const nextDesc = sanitizeRoomDesc(entry.body);
  const curDesc  = poly.desc == null ? '' : poly.desc;
  const writeName  = nextName !== poly.name;
  const descDiffers = nextDesc !== curDesc;
  if (!writeName && !descDiffers) return true;   // nothing to do, but the pick still counts

  let pushed = false;
  const undoOnce = () => { if (!pushed) { pushed = true; pushUndo(); } };

  if (writeName) {
    undoOnce();
    poly.name = nextName;
    _rpInvalidateLabel(poly.id);
  }
  const ask = descDiffers && !!curDesc;
  if (descDiffers && !ask) { undoOnce(); poly.desc = nextDesc; }
  _rpSyncEntryFields(poly);

  if (ask) {
    confirmDialog({
      title: 'Replace description?',
      message: 'This room already has a description. Replacing it with the module text ' +
               'overwrites what you wrote. Keeping yours still applies the name.',
      confirmLabel: 'Replace',
      cancelLabel: 'Keep mine',
      danger: true,
      onConfirm: () => {
        // Re-resolve rather than closing over the object: the DM can change room or scene while
        // the question is on screen.
        const p = _rpFindPoly(poly.id);
        if (!p) return;
        undoOnce();
        p.desc = nextDesc;
        _rpSyncEntryFields(p);
      },
    });
  }
  return true;
}

// Push a room's values back into the fields and repaint its map label. dataset.orig moves with
// them, because Escape reverts to it.
function _rpSyncEntryFields(poly) {
  scheduleAutoSave();
  const nameEl = _rpEl('rp-name'), descEl = _rpEl('rp-desc');
  if (nameEl) { nameEl.value = poly.name; nameEl.dataset.orig = poly.name; }
  if (descEl) {
    const d = poly.desc == null ? '' : poly.desc;
    descEl.value = d; descEl.dataset.orig = d;
  }
  _rpFieldPid = poly.id;
  drawCursor(lastScreenX, lastScreenY);   // repaints the map label under its new name
}

// Commit on blur, revert on Escape, and swallow keydown so the global map shortcuts don't fire
// while typing — without that, writing a description switches tool and can delete the room.
//
// opts.onKeyDown gets first refusal and returns true when it consumed the key, which is how the
// dropdown claims Enter and Escape on the same element.
function _rpWireField(el, opts) {
  const commit = opts.commit;
  el.addEventListener('focus', () => { el.dataset.orig = el.value; });
  el.addEventListener('blur', commit);
  el.addEventListener('mousedown', e => e.stopPropagation());
  el.addEventListener('keydown', e => {
    e.stopPropagation();
    if (opts.onKeyDown && opts.onKeyDown(e)) return;
    if (e.key === 'Enter' && opts.enterCommits) { e.preventDefault(); el.blur(); }
    else if (e.key === 'Escape') { el.value = el.dataset.orig || ''; el.blur(); }
  });
}

function initRoomPanel() {
  if (typeof isPlayer !== 'undefined' && isPlayer) return;
  const panel = _rpEl('panel-room');
  if (!panel) return;

  // The card floats over the map; a click inside must never reach the canvas handlers.
  panel.addEventListener('mousedown', e => e.stopPropagation());

  // Enter commits the name (one line); in the description it inserts a newline.
  _rpWireField(_rpEl('rp-name'), {
    commit: _rpCommitName, enterCommits: true,
    // The dropdown claims ↑/↓ and, with a row highlighted, Enter and Escape.
    onKeyDown: typeof mtNameKeyDown === 'function' ? mtNameKeyDown : null,
  });
  _rpWireField(_rpEl('rp-desc'), { commit: _rpCommitDesc, enterCommits: false });

  // Last of the field wiring, so the dropdown is appended after the fields exist.
  if (typeof initModuleText === 'function') initModuleText(_rpEl('rp-name'));

  _rpInitDrag(panel, _rpEl('rp-head'));
  _rpApplyDescHeight(_rpEl('rp-desc'));
  _rpWatchDescHeight(_rpEl('rp-desc'), panel);

  _rpEl('rp-close').onclick = () => {
    _rpCommitFields();
    selectedPolygonId = null;
    selectedVertexIndex = -1;
    drawCursor(lastScreenX, lastScreenY);
  };

  // Fog pill. Keyed on #rp-mode rather than a styling class, since it borrows stock .cp-tabs
  // looks and must not depend on a class a restyle could remove.
  panel.querySelectorAll('#rp-mode [data-mode]').forEach(btn => {
    btn.onclick = () => {
      const poly = _rpFindPoly(selectedPolygonId);
      if (!poly) return;
      setPolygonMode(poly.id, btn.dataset.mode);
      _rpSyncModePill(poly);   // in place — setPolygonMode deliberately doesn't refresh
    };
  });

  _rpEl('rp-delete').onclick = () => {
    if (selectedPolygonId != null) deleteSelectedPolygon();
  };

  // Corner radius. TWO fields, one behaviour: the card's for a room, the Effects context row's
  // for an effect. One helper, so the per-vertex targeting cannot drift between them.
  _rpWireRadiusField('rp-radius-num');
  _rpWireRadiusField('fx-radius-num');
}

// Corner radius: ONE number field, no slider and no all-corners toggle. ↑/↓ covers the nudging,
// and Del already removes a vertex via input.js through the same undo path.
function _rpWireRadiusField(numId) {
  let radiusUndoPushed = false;
  const num = _rpEl(numId);
  if (!num) return;
  const clampR = v => Math.max(0, Math.min(300, v));

  const apply = v => {
    const poly = _rpFindPoly(selectedPolygonId);
    if (!poly) return;
    // One undo per editing session, never per keystroke: typing "150" is one Ctrl+Z.
    if (!radiusUndoPushed) { pushUndo(); radiusUndoPushed = true; }
    // Target follows the selection. cornerRadii is created lazily and padded to the vertex count,
    // because a polygon can gain vertices after the array exists.
    const vi = selectedVertexIndex;
    if (vi >= 0 && vi < poly.vertices.length) {
      if (!poly.cornerRadii) poly.cornerRadii = new Array(poly.vertices.length).fill(null);
      while (poly.cornerRadii.length < poly.vertices.length) poly.cornerRadii.push(null);
      poly.cornerRadii[vi] = v;
    } else {
      poly.cornerRadius = v;
    }
    // A room's corners reshape the fog stencil, an effect's only its own fill. Both paths live in
    // tools.js, so neither field has to know which it holds.
    shapeGeometryChanged();
    persistShapeEdit();
    fogDirty = true;
    scheduleRender();
    drawCursor(lastScreenX, lastScreenY);
  };

  num.addEventListener('focus', () => { radiusUndoPushed = false; });
  // Normalise on the way out: mid-edit the field is left alone, so it can hold '' or '007'.
  num.addEventListener('blur', () => {
    radiusUndoPushed = false;
    num.value = clampR(parseInt(num.value) || 0);
  });
  num.addEventListener('keydown', e => {
    e.stopPropagation();   // keep the map shortcuts out of a field being typed in
    const dir = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const v = clampR((parseInt(num.value) || 0) + dir * (e.shiftKey ? 10 : 1));
    num.value = v;
    apply(v);
  });
  num.oninput = e => apply(clampR(parseInt(e.target.value) || 0));
}

// Which corner(s) the radius targets is DERIVED from the selection, never stored, so icon and
// write target cannot disagree. A null poly means nothing is selected, and the field is greyed
// rather than left looking live.
function _rpSyncRadiusField(fieldId, numId, poly) {
  const field = _rpEl(fieldId);
  const num   = _rpEl(numId);
  if (!field || !num) return;
  num.disabled = !poly;
  const perVertex = !!poly && selectedVertexIndex >= 0 && selectedVertexIndex < poly.vertices.length;
  const override  = perVertex && poly.cornerRadii ? poly.cornerRadii[selectedVertexIndex] : null;
  const currentR  = !poly ? 0 : (override != null ? override : (poly.cornerRadius || 0));
  if (num !== document.activeElement) num.value = currentR;

  field.classList.toggle('rp-per-vertex', perVertex);
  field.title = perVertex
    ? 'Corner radius for the selected corner. ↑/↓ to step, Shift for 10. Esc goes back to every corner, Del removes the vertex.'
    : 'Corner radius for every corner. ↑/↓ to step, Shift for 10. Select a vertex on the map to round just that one.';
}

// An effect has a material where a room has a fog state, so the pill is hidden rather than left
// with no segment lit. The corner-radius field keeps its place.
function _rpSyncModePill(poly) {
  const pill = _rpEl('rp-mode');
  if (pill) pill.style.display = poly.material ? 'none' : '';
  if (poly.material) return;
  document.querySelectorAll('#rp-mode [data-mode]').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === poly.mode));
}

// Rebuild + reposition, from drawCursor() on every repaint. ⚠ NEVER from setPolygonMode(), where
// a rebuild mid-edit steals field focus. Visibility is gated on selection ONLY, never the tool.
function refreshRoomPanel() {
  if (typeof isPlayer !== 'undefined' && isPlayer) return;
  const panel = _rpEl('panel-room');
  if (!panel) return;

  const poly = _rpFindPoly(selectedPolygonId);

  // The Effects row's radius field is this card's twin for a shape that has no card.
  _rpSyncRadiusField('fx-radius-field', 'fx-radius-num', poly && poly.material ? poly : null);

  // ⚠ AN EFFECT GETS NO CARD: it has no name, description or module text, so selecting one shows
  // its handles alone. It leaves by the SAME path as a deselect, or a card can vanish without
  // committing what was typed into a real room.
  if (!poly || poly.material) {
    if (_rpFieldPid != null) { _rpCommitFields(); _rpFieldPid = null; }
    // The dropdown lives inside the card, so hiding the card must close it.
    if (typeof mtCloseDropdown === 'function') mtCloseDropdown();
    panel.style.display = 'none';
    // Closing means the next card opens beside its room, not where the last was parked.
    _rpManualPos = null;
    _rpAutoPos = null;
    return;
  }

  // Selection moved: commit what the fields still hold for the OLD room before overwriting.
  const sameRoom = _rpFieldPid === poly.id;
  if (!sameRoom && _rpFieldPid != null) _rpCommitFields();
  // A dropdown left open across a room change picks into the new room while filtered by the old.
  if (!sameRoom && typeof mtCloseDropdown === 'function') mtCloseDropdown();

  panel.style.display = 'block';

  const nameEl = _rpEl('rp-name');
  const descEl = _rpEl('rp-desc');
  // Never clobber a field being typed in.
  if (!sameRoom || nameEl !== document.activeElement) nameEl.value = poly.name != null ? poly.name : _rpFallbackName(poly);
  if (!sameRoom || descEl !== document.activeElement) descEl.value = poly.desc != null ? poly.desc : '';
  _rpFieldPid = poly.id;

  _rpSyncModePill(poly);

  _rpSyncRadiusField('rp-radius-field', 'rp-radius-num', poly);

  _rpPositionPanel(panel, poly);
}

// Screen px → the pre-zoom px style.left/top are written in (the card carries
// `zoom: var(--ui-zoom)`). MEASURED and AFFINE — a slope AND a constant origin. ⚠ Never reduce
// this to a bare `/ uiZoom`: that leaves a constant offset a drag exposes as a jump on grab.
function _rpScreenToStyle(panel, screenLeft, screenTop) {
  const r  = panel.getBoundingClientRect();
  const cs = getComputedStyle(panel);
  const z  = panel.offsetWidth > 0 ? (r.width / panel.offsetWidth) : 1;
  const originX = r.left - (parseFloat(cs.left) || 0) * z;
  const originY = r.top  - (parseFloat(cs.top)  || 0) * z;
  return { left: (screenLeft - originX) / z, top: (screenTop - originY) / z };
}

function _rpPositionPanel(panel, poly) {
  const r = panel.getBoundingClientRect();

  let left, top;
  if (_rpManualPos) {
    // Re-clamped rather than trusted: a resize or a taller description can put a stored position
    // off-screen.
    left = Math.max(RP_MARGIN, Math.min(window.innerWidth  - r.width  - RP_MARGIN, _rpManualPos.left));
    top  = Math.max(RP_MARGIN, Math.min(window.innerHeight - r.height - RP_MARGIN, _rpManualPos.top));
  } else if (_rpAutoFrozen(poly.id)) {
    left = _rpAutoPos.left; top = _rpAutoPos.top;
  } else {
    const bb = getPolyBBox(poly.vertices);
    const a  = toScreen(bb.minX, bb.minY);
    const b  = toScreen(bb.maxX, bb.maxY);
    const pos = clampPanelPosition({ left: a.sx, top: a.sy, right: b.sx, bottom: b.sy },
                                   r.width, r.height, window.innerWidth, window.innerHeight);
    left = pos.left; top = pos.top;
    _rpAutoPos = { pid: poly.id, left, top };
  }
  const st = _rpScreenToStyle(panel, left, top);
  panel.style.left = st.left + 'px';
  panel.style.top  = st.top  + 'px';
}

// Drag by the title bar, screen px throughout. The move/up listeners go on window, so a fast drag
// that outruns the pointer doesn't drop the card.
function _rpInitDrag(panel, head) {
  let dragging = false, gx = 0, gy = 0, l0 = 0, t0 = 0;

  head.addEventListener('mousedown', e => {
    if (e.button !== 0 || e.target.closest('button')) return;   // let Close be Close
    const r = panel.getBoundingClientRect();
    dragging = true;
    gx = e.clientX; gy = e.clientY; l0 = r.left; t0 = r.top;
    e.preventDefault();      // no text selection, no native drag
    e.stopPropagation();     // and nothing reaches the canvas handlers underneath
  });

  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const r = panel.getBoundingClientRect();
    _rpManualPos = {
      left: Math.max(RP_MARGIN, Math.min(window.innerWidth  - r.width  - RP_MARGIN, l0 + e.clientX - gx)),
      top:  Math.max(RP_MARGIN, Math.min(window.innerHeight - r.height - RP_MARGIN, t0 + e.clientY - gy)),
    };
    const st = _rpScreenToStyle(panel, _rpManualPos.left, _rpManualPos.top);
    panel.style.left = st.left + 'px';
    panel.style.top  = st.top  + 'px';
  });

  window.addEventListener('mouseup', () => { dragging = false; });

  // Double-click the bar to send the card back to its room.
  head.addEventListener('dblclick', e => {
    if (e.target.closest('button')) return;
    _rpManualPos = null;
    drawCursor(lastScreenX, lastScreenY);
  });
}

// Restored once at init: a resize handle's inline style survives the card being hidden and
// reshown, so only a reload needs this.
function _rpApplyDescHeight(el) {
  let h = 0;
  try { h = parseInt(localStorage.getItem(RP_DESC_H_KEY)) || 0; } catch (_) {}
  // Only checks that it IS a height — .rp-desc's CSS clamps the range, so it self-heals.
  if (h > 0) el.style.height = h + 'px';
}

// Save on mouseup, never a ResizeObserver: firing continuously needs a debounce and a 0×0 guard,
// and it re-clamps the card every tick so dragging the handle DOWN slides the card UP. The
// listener is on window because a resize drag can release anywhere.
function _rpWatchDescHeight(el, panel) {
  let last = el.offsetHeight;
  // ARMED BY A MOUSEDOWN ON THE TEXTAREA: the window listener otherwise runs on every mouse
  // release in the app, and offsetHeight forces a synchronous layout each time. A resize drag
  // always starts with a mousedown here.
  let armed = false;
  el.addEventListener('mousedown', () => { armed = true; });
  window.addEventListener('mouseup', () => {
    if (!armed) return;
    armed = false;
    // ⚠ offsetHeight, NOT getBoundingClientRect().height: the card carries zoom:var(--ui-zoom), so
    // storing the rect grows the box by the UI scale on every reload.
    const h = el.offsetHeight;
    if (!h || h === last) return;          // hidden, or nothing was resized — the common case
    last = h;
    try { localStorage.setItem(RP_DESC_H_KEY, String(h)); } catch (_) {}
    const poly = _rpFindPoly(selectedPolygonId);
    if (poly) _rpPositionPanel(panel, poly);   // the card changed height, so re-clamp it once
  });
}

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
    const bb  = getPolyBBox(poly.vertices);
    const key = name + '|' + fontPx + '|' + poly.vertices.length + '|' +
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
        poly.vertices,
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
