'use strict';
// roomPanel.js — the room card (the floating panel shown when a room is selected) plus the
// room-name labels drawn on the DM map. A room is a polygon; `polygon` stays the word in code.
//
// The card is MOVABLE and its description RESIZABLE, both load-bearing rather than polish: it
// floats over the map and will sometimes cover the handles the DM selected the room by, which
// no placement rule wins in general. See _rpManualPos and RP_DESC_H_KEY.
//
// Called once from initToolbar() (DM only). Layout rules in CLAUDE.md, rejected shapes in
// docs/DECISIONS.md.

const ROOM_NAME_MAX = 60;     // cap so a pasted essay can't wreck the card header
// Truncation here is SILENT (sanitizeRoomDesc just slices), so the cap sits in the gap between
// two populations rather than inside either: legitimate rooms average ~3K and the worst case is
// a room that absorbed a sidebar at maybe 10K, while the failure this guards against — a parse
// that finds no headings — produces one entry of several hundred thousand characters.
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

// Fit `text` into maxPx, ellipsising from the end; '' when not even the ellipsis fits. A
// string already narrower than maxPx is returned untouched, so a short name is never swapped
// for a wider ellipsis. measureFn is injected, which is what keeps this pure.
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

// Label size in SCREEN px, scaling only gently with zoom and CLAMPED at both ends: map-locked
// type would vanish when zoomed out, exactly when the DM most needs to tell rooms apart, and
// screen-fixed type looks lost inside a hall. The exponent is the dial (0 = fixed, 1 = locked).
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

// How far a circular corner of radius r cuts in, d below the top edge. Exact: the arc centre
// is r below the top, so the inset tapers from r at the very top to 0 at depth r. This is what
// keeps a label inside a heavily rounded room, where the vertices say "sharp corner" and the
// drawn path says otherwise.
function cornerInsetAt(r, d) {
  if (!(r > 0) || d >= r || d < 0) return 0;
  return r - Math.sqrt(Math.max(0, r * r - (r - d) * (r - d)));
}

// Top-left-ish anchor for a label inside any room shape. Samples rows downward asking "can the
// label sit here, fully inside?", which is why it needs no per-shape special case: a circle
// simply has no usable row until its chord is wide enough.
//
// Returns the FIRST (highest) row that fits the whole label, or the roomiest row so the caller
// can ellipsise into it. MAP units, so the result is pan-independent and safe to cache.
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

// Where the DM dragged the card, screen px, or null for automatic placement. Once moved it
// STAYS moved through repaints, pans and room switches, until the card closes or the bar is
// double-clicked. A card that re-anchored itself would land back on the handles every time.
let _rpManualPos = null;

// Last automatic placement, keyed to the room it was computed for. Held still while a vertex or
// edge drag is in flight: those reshape the room under the pointer, so recomputing every frame
// would make the card flip sides mid-edit. It re-places once, on release.
let _rpAutoPos = null;

function _rpAutoFrozen(pid) {
  if (!_rpAutoPos || _rpAutoPos.pid !== pid) return false;
  return (typeof isDraggingVertex !== 'undefined' && isDraggingVertex) ||
         (typeof isDraggingEdge   !== 'undefined' && isDraggingEdge);
}

// Description height: ONE preference for the card, not per room, because "how tall I like this
// box" is about the DM's screen. localStorage, so never in a scene or backup. No MIN/MAX
// constants beside it — .rp-desc's CSS already clamps anything written to style.height, so a JS
// range check would guard nothing and could disagree with the CSS.
const RP_DESC_H_KEY = 'evermist.roomDescHeight';

// Where to put the card, ALL SCREEN PIXELS. `room` is the selected room's screen bounding box
// ({left, top, right, bottom}), NOT its centroid: the card has to clear the whole room, or a
// room bigger than the gap swallows the card the DM is trying to edit through.
// Preference: above the room, then below, then right, then left.
function clampPanelPosition(room, pw, ph, vw, vh, gap, margin) {
  const g = gap    == null ? RP_GAP    : gap;
  const m = margin == null ? RP_MARGIN : margin;

  // Math.max wraps Math.min so a card bigger than the viewport pins to the top/left edge
  // rather than being pushed off it.
  const clampX = l => Math.max(m, Math.min(vw - pw - m, l));
  // Not redundant with the branches below: the box comes from MAP coordinates, so panning can
  // put it far off-screen, and "above a room 3000px below the fold" is itself off-screen. A
  // selected room's card must stay readable when the room has scrolled out of view.
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

  // The room reaches every edge, so no placement is fully clear of it — zoomed right into one
  // room is the ordinary case. Pin the card to whichever viewport edge has the most space
  // between it and the room, so the card covers as little of the room as it can.
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

// Label text metrics by polygon id — drawCursor() runs on every mouse move, so measureText()
// must not run per room per frame.
const _rpLabelCache = new Map();

function _rpInvalidateLabel(id) { _rpLabelCache.delete(id); }

// Polygon ids restart per scene, so stale entries are meaningless and would accumulate.
function resetRoomLabelCache() { _rpLabelCache.clear(); }

function _rpEl(id) { return document.getElementById(id); }

function _rpFindPoly(id) {
  return id == null ? null : polygons.find(p => p.id === id);
}

// pushUndo() runs BEFORE the write and only on a real change, so one Ctrl+Z reverts one whole
// edit rather than one keystroke, and focusing a field costs nothing.
function _rpCommitName() {
  const el = _rpEl('rp-name');
  const poly = _rpFindPoly(_rpFieldPid);
  if (!el || !poly) return;
  const v = sanitizeRoomName(el.value, 'Room ' + poly.id);
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
  const poly = _rpFindPoly(_rpFieldPid);
  if (!el || !poly) return;
  const v = sanitizeRoomDesc(el.value);
  el.value = v;
  // `desc` is absent until typed, so missing and empty are the same value — otherwise a blur on
  // an untouched empty field pushes a pointless undo.
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
// ONE pushUndo() for the pair: a pick is a single act, so a single Ctrl+Z must reverse it.
// Pushed lazily, on the first real write, so declining the question leaves no empty undo.
//
// The description is never silently replaced — prep that took an evening must survive a mispick.
// THE QUESTION IS ASYNCHRONOUS, and the split matters: the NAME is written up front because
// opening the dialog blurs the name field and runs its commit, which would otherwise write the
// OLD text back over the pick. The name is also not what the question is about.
function applyModuleEntryToRoom(entry) {
  const poly = _rpFindPoly(selectedPolygonId);
  if (!poly || !entry) return false;

  const nextName = sanitizeRoomName(entry.title, 'Room ' + poly.id);
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
        // Re-resolve rather than closing over the object: the DM can select another room, or
        // switch scenes, while the question is on screen.
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
// them, because Escape reverts to it and an edit must not revert past a pick.
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
// opts.onKeyDown gets first refusal and returns true when it consumed the key. That is how the
// dropdown claims Enter and Escape on the same element, where stopPropagation could not.
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
    // The dropdown claims ↑/↓ and, with a row highlighted, Enter and Escape. The rest falls
    // through, so the field types exactly as it always did.
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

  // Fog pill, all three segments live. Keyed on #rp-mode rather than a styling class: it
  // borrows stock .cp-tabs looks, so it must not depend on a class a restyle could remove.
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

  // Corner radius: ONE number field, no slider and no all-corners toggle. ↑/↓ covers the
  // nudging a slider bought, and the row it cost went to description height. Del already
  // removes a vertex via input.js, through the same undo path a button would have used.
  (() => {
    let radiusUndoPushed = false;
    const num = _rpEl('rp-radius-num');
    const clampR = v => Math.max(0, Math.min(300, v));

    const apply = v => {
      const poly = _rpFindPoly(selectedPolygonId);
      if (!poly) return;
      // One undo per editing session, not per keystroke: typing "150" is one Ctrl+Z. The flag
      // resets on focus/blur so the next edit gets its own entry.
      if (!radiusUndoPushed) { pushUndo(); radiusUndoPushed = true; }
      // Target follows the selection, no mode flag. cornerRadii is created lazily and padded to
      // the vertex count, because a polygon can gain vertices after the array exists.
      const vi = selectedVertexIndex;
      if (vi >= 0 && vi < poly.vertices.length) {
        if (!poly.cornerRadii) poly.cornerRadii = new Array(poly.vertices.length).fill(null);
        while (poly.cornerRadii.length < poly.vertices.length) poly.cornerRadii.push(null);
        poly.cornerRadii[vi] = v;
      } else {
        poly.cornerRadius = v;
      }
      rebuildFogFromPolygons();
      rebuildFogEffect();
      fogDirty = true;
      scheduleRender();
      scheduleAutoSync();
      drawCursor(lastScreenX, lastScreenY);
    };

    num.addEventListener('focus', () => { radiusUndoPushed = false; });
    // Normalise on the way out: mid-edit the field is left alone so typing isn't fought, which
    // means it can be sitting on '' or '007' when focus leaves.
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
  })();
}

function _rpSyncModePill(poly) {
  document.querySelectorAll('#rp-mode [data-mode]').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === poly.mode));
}

// Rebuild + reposition. Called from drawCursor() on every repaint and from the paths that
// rewrite modes or reset polygons wholesale. NOT from setPolygonMode() — a rebuild mid-edit
// would steal field focus. Visibility is gated on selection ONLY, never the active tool.
function refreshRoomPanel() {
  if (typeof isPlayer !== 'undefined' && isPlayer) return;
  const panel = _rpEl('panel-room');
  if (!panel) return;

  const poly = _rpFindPoly(selectedPolygonId);
  if (!poly) {
    if (_rpFieldPid != null) { _rpCommitFields(); _rpFieldPid = null; }
    // The dropdown lives inside the card, so hiding the card must close it, or it reappears
    // still filtered by the last room's name.
    if (typeof mtCloseDropdown === 'function') mtCloseDropdown();
    panel.style.display = 'none';
    // Closing is the DM saying they're done with this card, so the next one opens beside its
    // room rather than wherever the last was parked.
    _rpManualPos = null;
    _rpAutoPos = null;
    return;
  }

  // Selection moved: commit what the fields still hold for the OLD room before overwriting.
  // The blur that arrives after this repaint then sees an unchanged value and no-ops.
  const sameRoom = _rpFieldPid === poly.id;
  if (!sameRoom && _rpFieldPid != null) _rpCommitFields();
  // A dropdown left open across a room change would pick into the new room while filtered by
  // the previous room's name.
  if (!sameRoom && typeof mtCloseDropdown === 'function') mtCloseDropdown();

  panel.style.display = 'block';

  const nameEl = _rpEl('rp-name');
  const descEl = _rpEl('rp-desc');
  // Never clobber a field being typed in.
  if (!sameRoom || nameEl !== document.activeElement) nameEl.value = poly.name != null ? poly.name : ('Room ' + poly.id);
  if (!sameRoom || descEl !== document.activeElement) descEl.value = poly.desc != null ? poly.desc : '';
  _rpFieldPid = poly.id;

  _rpSyncModePill(poly);

  // Which corner(s) the radius targets is DERIVED from the selection, never stored, and the
  // field says which by swapping its own glyph — so there is no toggle to keep in sync and no
  // way for icon and write target to disagree.
  const num       = _rpEl('rp-radius-num');
  const perVertex = selectedVertexIndex >= 0 && selectedVertexIndex < poly.vertices.length;
  const override  = perVertex && poly.cornerRadii ? poly.cornerRadii[selectedVertexIndex] : null;
  const currentR  = override != null ? override : (poly.cornerRadius || 0);
  if (num !== document.activeElement) num.value = currentR;

  const rfield = _rpEl('rp-radius-field');
  rfield.classList.toggle('rp-per-vertex', perVertex);
  rfield.title = perVertex
    ? 'Corner radius for the selected corner. ↑/↓ to step, Shift for 10. Esc goes back to every corner, Del removes the vertex.'
    : 'Corner radius for every corner. ↑/↓ to step, Shift for 10. Select a vertex on the map to round just that one.';

  _rpPositionPanel(panel, poly);
}

// Screen px → the pre-zoom px style.left/top are written in (the card carries
// `zoom: var(--ui-zoom)`). MEASURED and AFFINE — a slope AND a constant origin. Assigning
// screen px raw drifts the card ~20% off the room; dividing by the slope alone leaves a
// constant offset that automatic placement hides but a drag exposes as a jump on grab. Both
// terms come from the panel's own measured position, so neither is hard-coded. Never reduce
// this to a bare `/ uiZoom`.
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
    // Re-clamped rather than trusted: the window can be resized and the description dragged
    // taller after placement, either of which could put a stored position off-screen.
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

// Drag by the title bar, screen px throughout. The move/up listeners go on window rather than
// the bar, so a fast drag that outruns the pointer doesn't drop the card mid-flight.
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

  // Double-click the bar to send the card back to its room. Without this a DM who parked it in
  // a corner can only undo that by closing and reopening.
  head.addEventListener('dblclick', e => {
    if (e.target.closest('button')) return;
    _rpManualPos = null;
    drawCursor(lastScreenX, lastScreenY);
  });
}

// Restored once at init, which is enough: the browser writes a resize handle's result as an
// inline style that survives the card being hidden and reshown, so only a reload needs this.
function _rpApplyDescHeight(el) {
  let h = 0;
  try { h = parseInt(localStorage.getItem(RP_DESC_H_KEY)) || 0; } catch (_) {}
  // Only checks that it IS a height; the RANGE needs no check because .rp-desc's own CSS
  // clamps it, so an absurd stored value self-heals on the next paint.
  if (h > 0) el.style.height = h + 'px';
}

// Save on mouseup, deliberately not a ResizeObserver. Everything wrong with that version came
// from it firing continuously: it needed a debounce, it needed a 0×0 guard (hiding the card
// collapses the textarea, and an unguarded save wiped the preference on every deselect), and it
// re-clamped the card every tick, so dragging the handle DOWN slid the card UP under the
// pointer. The listener is on window because a resize drag can release anywhere.
function _rpWatchDescHeight(el, panel) {
  let last = el.offsetHeight;
  window.addEventListener('mouseup', () => {
    // offsetHeight, NOT getBoundingClientRect().height: the card carries zoom:var(--ui-zoom),
    // so the rect is screen px while style.height is written in pre-zoom layout px. Storing the
    // rect would grow the box by the UI scale on every reload.
    const h = el.offsetHeight;
    if (!h || h === last) return;          // hidden, or nothing was resized — the common case
    last = h;
    try { localStorage.setItem(RP_DESC_H_KEY, String(h)); } catch (_) {}
    const poly = _rpFindPoly(selectedPolygonId);
    if (poly) _rpPositionPanel(panel, poly);   // the card changed height, so re-clamp it once
  });
}

// ─── Room labels on the DM map ────────────────────────────────────────────────
// Names are drawn on the map so the DM can read the dungeon at a glance. DM-only: this paints
// on the cursor overlay, which the Player window doesn't have.
//
// Placement is TOP-LEFT INSIDE the room, like a floorplan label. "Top-left" is meaningless for
// a circle and wrong for a heavily rounded rectangle, since the bounding box corner is outside
// the shape in both cases, so the anchor comes from fitLabelBox().

// Plate padding, deliberately generous relative to the type: tighter, the plate shrink-wrapped
// the glyphs and read as a stray rectangle dropped on the map.
const RP_LABEL_PAD_X = 13;
const RP_LABEL_PAD_Y = 8;
const RP_LABEL_RADIUS = 7;

// Gap between the PLATE and the room's outline, one number for both axes — which is the point.
// The fit sizes the whole plate (width includes PAD_X × 2), so box.x/box.y describe the plate
// and this constant lands identically on both sides. Fitting the TEXT instead made the draw
// step subtract PAD_X back out, collapsing the left gap to zero while the top kept its own.
// Screen px, ÷ zoom on the way into the fit.
const RP_LABEL_GAP = 10;

function _rpLabelFont(px) {
  return '600 ' + px + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
}

function drawRoomLabels() {
  if (typeof isPlayer !== 'undefined' && isPlayer) return;
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

    // Neither measureText nor the row scan may run per room per frame. The fit is done in MAP
    // units, so the cached anchor is pan-independent: only a rename, a zoom change or a
    // geometry edit invalidates it.
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
      // Auto-hide: "C…" names nothing, so a truncation leaving under two real characters is
      // dropped. Only truncated text is judged, so a room genuinely called "A" keeps its label.
      // Self-tuning per room beats one global zoom threshold — a great hall and a broom
      // cupboard cross the readable line at different zooms.
      const truncated = text !== name;
      const tooShort  = truncated && text.replace('…', '').trim().length < 2;
      entry = (text && !tooShort)
        ? { key, text, w: measure(text), mx: box.x, my: box.y }
        : { key, text: '' };
      _rpLabelCache.set(poly.id, entry);
    }
    if (!entry.text) continue;

    // sx/sy is the plate's left edge and vertical centre, so the plate draws straight from sx
    // and the glyphs start one PAD_X in.
    const { sx, sy } = toScreen(entry.mx, entry.my);
    const bw = entry.w + RP_LABEL_PAD_X * 2;
    if (sx < -bw || sy < -textH || sx > vw || sy > vh + textH) continue;

    // Opaque enough to read against bright map art: a faint wash let busy Dungeon Alchemist
    // floors show through and the name dissolved into the texture. The hairline is the panel
    // border colour, so the plate reads as app chrome rather than part of the art.
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
