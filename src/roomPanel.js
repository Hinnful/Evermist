'use strict';
// roomPanel.js — the room card: the floating panel that opens when a room is selected,
// plus the room-name labels drawn on the DM map.
//
// A room is a polygon (`polygon` stays the word in code). The MAP is the interaction
// surface — it is the biggest target on screen and it shows an actual room instead of a
// room's name — so this module deliberately adds no sidebar list. What it adds is the
// CONTENT a room carries: a name and a freeform description, written during prep and
// scanned at the table.
//
// The card is always identical: no modes, no sections that appear or disappear based on
// the active tool. Once a room is selected the card stays open through tool switches, so
// the DM can read a description while painting fog.
//
// It is MOVABLE (drag its title bar) and its description is RESIZABLE. Both exist for the
// same reason: the card floats over the map, so it will sometimes cover the very thing the
// DM is working on, and no placement rule can win that in general — a 270px card centred on
// a room's centroid sits on top of the handles you would grab. Rather than guess harder,
// hand it over. See _rpManualPos and RP_DESC_H_KEY.
//
// Called once from initToolbar() (DM mode only). See CLAUDE.md.

const ROOM_NAME_MAX = 60;     // cap so a pasted essay can't wreck the card header
const ROOM_DESC_MAX = 2000;   // generous — a room's worth of prep notes, not a chapter

// ─── Pure helpers (unit-tested — keep DOM-free) ───────────────────────────────

// Backfill `name` on polygons loaded from a scene saved before rooms had names.
// ADDITIVE SPREAD ONLY — never rebuild from a fixed key list, which would silently drop
// cornerRadii (per-vertex corner overrides) from every scene on load.
function normalizeRoomFields(polys) {
  if (!Array.isArray(polys)) return [];
  return polys.map(p => ({
    ...p,
    name: p.name ?? ('Room ' + p.id),
  }));
}

// Trim + fall back, mirroring commitSceneName() in sceneManager.js. Newlines collapse to
// spaces: drawRoomLabels() feeds the name to fillText(), where a pasted multi-line name
// renders as a control glyph.
function sanitizeRoomName(raw, fallback) {
  const v = String(raw == null ? '' : raw)
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, ROOM_NAME_MAX);
  return v || fallback;
}

// The description keeps its internal newlines — it's prose the DM reads aloud from, and
// line breaks are how they structure it. Only the ends are trimmed, and there is no
// fallback: an empty description is a valid, common state.
function sanitizeRoomDesc(raw) {
  return String(raw == null ? '' : raw).slice(0, ROOM_DESC_MAX).trim();
}

// Fit `text` into maxPx, ellipsising from the end. Returns '' when not even the ellipsis
// fits. A string already narrower than maxPx is returned untouched, so a short name is
// never swapped for an ellipsis that would be wider than it.
// measureFn is injected (canvas measureText in the app, a stub in the tests) — that's what
// keeps this function pure.
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

// Label type size for a given camera zoom. Screen px, so it is NOT map paint: it scales
// with zoom only gently and CLAMPED at both ends. Fully map-locked type would vanish when
// zoomed out — the exact moment the DM most needs to know which room is which — and fully
// screen-fixed type looks lost inside a hall when zoomed in. The exponent is the dial:
// 0 would be screen-fixed, 1 fully map-locked.
function roomLabelFontPx(zoomLevel, base, minPx, maxPx, exp) {
  const b = base  == null ? 21  : base;
  const lo = minPx == null ? 17  : minPx;
  const hi = maxPx == null ? 38  : maxPx;
  const e  = exp   == null ? 0.4 : exp;
  const z = zoomLevel > 0 ? zoomLevel : 1;
  return Math.round(Math.max(lo, Math.min(hi, b * Math.pow(z, e))));
}

// Horizontal spans of a polygon's interior at height y, left to right. Standard even-odd
// scanline: each pair of edge crossings bounds one inside run. Concave shapes yield more
// than one span, which is why this returns a list.
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

// How far a circular corner of radius r cuts in, d below the shape's top edge. Exact:
// the corner's arc centre is r below the top, so at depth d the arc sits at
// r - sqrt(r² - (r-d)²) from the straight edge, tapering from r at the very top to 0 at
// depth r. This is what keeps a top-left label inside a heavily rounded room's outline —
// the vertices say "sharp corner", the drawn path says otherwise.
function cornerInsetAt(r, d) {
  if (!(r > 0) || d >= r || d < 0) return 0;
  return r - Math.sqrt(Math.max(0, r * r - (r - d) * (r - d)));
}

// Top-left-ish anchor for a label inside an arbitrary room: rounded rectangle, 32-gon
// circle, or hand-drawn concave blob. Works by sampling rows downward from the top and
// asking "can the label sit on this row, fully inside the shape?" — which is why it needs
// no special case per shape. A circle simply has no usable row until far enough down that
// its chord is wide enough; a rounded rect's corner is handled by cornerInsetAt.
//
// Returns the FIRST row (highest up) that fits the whole label. If none does, returns the
// roomiest row so the caller can ellipsise into it rather than dropping the label. All
// distances are MAP units, so the result is pan-independent and safe to cache.
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
    // Test the label's top AND bottom edges, not its centre line: on a shape that narrows
    // upward, a centre-only test would let the top corners poke outside the outline.
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

// Where the DM dragged the card to, screen px, or null for automatic placement. This is the
// answer to the card covering the very vertices you selected it by: auto-placement can't
// win that fight in general — the card is 270px wide and a room's handles surround its
// centroid — so the DM gets to move it, and once moved it STAYS moved (through repaints,
// pans, and switching to another room) until the card closes or they double-click the title
// bar to snap it back. A card that helpfully re-anchored itself would put itself back on top
// of the handles the moment you clicked the next one.
let _rpManualPos = null;

// Description height, one preference for the whole card rather than per room: "how tall I
// like this box" is about the DM's screen, not about a room. localStorage, so it is NOT in
// scenes or backups — a description's text is data, its box's height is not.
// There are deliberately no MIN/MAX constants beside this. An earlier version had them and a
// note to keep them in step with .rp-desc's CSS — which is the smell: CSS min-height/max-height
// already clamp anything written to style.height, so a JS range check guarded nothing and just
// created two numbers that could disagree. CSS owns the bounds.
const RP_DESC_H_KEY = 'evermist.roomDescHeight';

// Where to put the card, ALL IN SCREEN PIXELS (see refreshRoomPanel for the conversion).
// Preference order: above the centroid → below it → beside it. The side fallback matters
// because a card tall enough to miss both vertical slots is exactly the case where the
// old above/below-only logic left it clipped at the top of the screen.
function clampPanelPosition(anchorX, anchorY, pw, ph, vw, vh, gap, margin) {
  const g = gap    == null ? RP_GAP    : gap;
  const m = margin == null ? RP_MARGIN : margin;

  // Centred on the anchor, clamped inward. Math.max wraps Math.min so a card wider than
  // the viewport pins to the left edge instead of being pushed off-screen to the left.
  const left = Math.max(m, Math.min(vw - pw - m, anchorX - pw / 2));
  // Same idiom vertically. This is not redundant with the branches below: the anchor is a
  // point on the MAP, so panning or zooming in can push it clean off the viewport, and
  // "above an anchor 3000px below the fold" is itself off-screen. A selected room's card
  // must stay readable even when the room itself has scrolled out of view.
  const clampTop = t => Math.max(m, Math.min(vh - ph - m, t));

  const above = anchorY - g - ph;
  if (above >= m) return { left, top: clampTop(above), placement: 'above' };

  const below = anchorY + g;
  if (below + ph <= vh - m) return { left, top: clampTop(below), placement: 'below' };

  // Neither slot fits: sit beside the room, vertically centred and clamped. Right first,
  // left when the right side would overflow.
  //
  // Both sides go through the same horizontal clamp as the vertical slots above, for the
  // same reason: the anchor is a point on the MAP, so panning can put it far off-screen,
  // and "22px right of an anchor 500px left of the viewport" is itself off-screen. Without
  // the clamp the card followed the room out of view entirely — reachable whenever the card
  // is tall enough that neither above nor below fits, which a taller description makes
  // common rather than rare.
  const clampLeft = l => Math.max(m, Math.min(vw - pw - m, l));
  const top = clampTop(anchorY - ph / 2);
  if (anchorX + g + pw <= vw - m) return { left: clampLeft(anchorX + g), top, placement: 'right' };
  return { left: clampLeft(anchorX - g - pw), top, placement: 'left' };
}

// ─── Card UI ──────────────────────────────────────────────────────────────────

// Id of the room the name/description fields currently hold values for. NOT the same as
// selectedPolygonId: a click on the canvas changes the selection *before* the focused
// field's blur fires, so the commit handlers key off this instead. See _rpCommitFields().
let _rpFieldPid = null;

// Per-room label text metrics, keyed by polygon id. drawCursor() runs on every mouse
// move, so measureText() must not run per room per frame — see drawRoomLabels().
const _rpLabelCache = new Map();

function _rpInvalidateLabel(id) { _rpLabelCache.delete(id); }

// Called on scene switch / scene delete. Polygon ids restart per scene (nextPolygonId is
// restored from the scene record), so entries from the previous scene are meaningless here
// and would otherwise accumulate for the life of the session.
function resetRoomLabelCache() { _rpLabelCache.clear(); }

function _rpEl(id) { return document.getElementById(id); }

function _rpFindPoly(id) {
  return id == null ? null : polygons.find(p => p.id === id);
}

// Commit the name field to the room it was populated for. pushUndo() runs BEFORE the
// write and only when the value actually changed, so one Ctrl+Z reverts one whole edit
// (not one keystroke) and simply focusing a field costs nothing.
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
  // `desc` is absent until the DM types one, so treat missing and empty as the same
  // value — otherwise a blur on an untouched empty field would push a pointless undo.
  if (v === (poly.desc == null ? '' : poly.desc)) return;
  pushUndo();
  poly.desc = v;
  scheduleAutoSave();
}

function _rpCommitFields() {
  _rpCommitName();
  _rpCommitDesc();
}

// Wire one text field: commit on blur, revert on Escape, and — critically — swallow
// keydown so the global map shortcuts (input.js) don't fire while the DM types. Without
// it, typing a description switches the paint tool and can delete the room.
function _rpWireField(el, opts) {
  const commit = opts.commit;
  el.addEventListener('focus', () => { el.dataset.orig = el.value; });
  el.addEventListener('blur', commit);
  el.addEventListener('mousedown', e => e.stopPropagation());
  el.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter' && opts.enterCommits) { e.preventDefault(); el.blur(); }
    else if (e.key === 'Escape') { el.value = el.dataset.orig || ''; el.blur(); }
  });
}

function initRoomPanel() {
  if (typeof isPlayer !== 'undefined' && isPlayer) return;
  const panel = _rpEl('panel-room');
  if (!panel) return;

  // The card floats over the map; a click inside it must never reach the canvas handlers.
  panel.addEventListener('mousedown', e => e.stopPropagation());

  // Enter commits the name (a room name is one line); in the description Enter inserts a
  // newline, because line breaks are how the DM structures prep notes.
  _rpWireField(_rpEl('rp-name'), { commit: _rpCommitName, enterCommits: true });
  _rpWireField(_rpEl('rp-desc'), { commit: _rpCommitDesc, enterCommits: false });

  _rpInitDrag(panel, _rpEl('rp-head'));
  _rpApplyDescHeight(_rpEl('rp-desc'));
  _rpWatchDescHeight(_rpEl('rp-desc'), panel);

  _rpEl('rp-close').onclick = () => {
    _rpCommitFields();
    selectedPolygonId = null;
    selectedVertexIndex = -1;
    drawCursor(lastScreenX, lastScreenY);
  };

  // ── Fog state — the pill. All three segments are live. ──
  // Keyed on #rp-mode, not on a styling class: the pill borrows stock .cp-tabs/.cp-segtab
  // looks, so it must not depend on a class that a restyle could legitimately remove.
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

  // There is no Remove-vertex button and no all-corners/one-corner toggle here on purpose.
  // Del already removes the selected vertex (input.js), through the same pushUndo → splice →
  // rebuild → autosync path the button used, so the button was a second way to do one thing.
  // And the radius field targets whatever the selection says: a selected vertex means that
  // corner, no selection means all of them — see the apply() below and .rp-radius in the CSS.

  // ── Corner radius: ONE number field, no slider. ──
  // The slider cost a whole row of a card whose scarcest resource is description height, and
  // the only thing it did that a number field doesn't is let the DM nudge a radius without
  // knowing the value they want. ↑/↓ stepping covers that, so the row went.
  (() => {
    let radiusUndoPushed = false;
    const num = _rpEl('rp-radius-num');
    const clampR = v => Math.max(0, Math.min(300, v));

    const apply = v => {
      const poly = _rpFindPoly(selectedPolygonId);
      if (!poly) return;
      // One undo entry per editing session, not per keystroke: typing "150" is one Ctrl+Z,
      // and the flag resets on focus/blur (below) so the next edit gets its own entry.
      if (!radiusUndoPushed) { pushUndo(); radiusUndoPushed = true; }
      // Target follows the selection, no mode flag. cornerRadii is created lazily (the old
      // toggle used to do it) and padded to the vertex count, because a polygon can gain
      // vertices after the array exists and writing past its end would leave holes.
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
    // Normalise the display on the way out — mid-edit the field is left alone so typing
    // isn't fought, which means it can be sitting on '' or '007' when focus leaves.
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

// Rebuild + reposition the card. Called from drawCursor() (render.js) on every repaint,
// and from the paths that rewrite modes or reset polygons wholesale (fog.js, sceneManager,
// undo). NOT called by setPolygonMode() — a rebuild mid-edit would steal field focus.
//
// The visibility gate is selection ONLY. It deliberately does not test the active tool:
// once a room is selected the card stays open through tool switches, so the DM can read a
// description while painting fog.
function refreshRoomPanel() {
  if (typeof isPlayer !== 'undefined' && isPlayer) return;
  const panel = _rpEl('panel-room');
  if (!panel) return;

  const poly = _rpFindPoly(selectedPolygonId);
  if (!poly) {
    if (_rpFieldPid != null) { _rpCommitFields(); _rpFieldPid = null; }
    panel.style.display = 'none';
    // A dragged-to position lives as long as the card does. Closing it is the DM saying they
    // are done with this card, so the next one opens beside its room rather than wherever the
    // last one was parked half a session ago.
    _rpManualPos = null;
    return;
  }

  // Selection moved to another room: commit what the fields still hold for the OLD room
  // before overwriting them. (The blur that arrives after this repaint then sees an
  // unchanged value and no-ops.)
  const sameRoom = _rpFieldPid === poly.id;
  if (!sameRoom && _rpFieldPid != null) _rpCommitFields();

  panel.style.display = 'block';

  const nameEl = _rpEl('rp-name');
  const descEl = _rpEl('rp-desc');
  // Never clobber a field the DM is typing in — same guard the radius input uses below.
  if (!sameRoom || nameEl !== document.activeElement) nameEl.value = poly.name != null ? poly.name : ('Room ' + poly.id);
  if (!sameRoom || descEl !== document.activeElement) descEl.value = poly.desc != null ? poly.desc : '';
  _rpFieldPid = poly.id;

  _rpSyncModePill(poly);

  // Radius. Which corner(s) the field targets is DERIVED from the selection, never stored:
  // a selected vertex means that corner, no selection means all of them. The field says which
  // by swapping the glyph inside itself (.rp-per-vertex), so there is no toggle to keep in
  // sync and no way for the icon and the write target to disagree. With a vertex selected but
  // no override on it yet, the room-wide radius is shown as the starting value.
  const num       = _rpEl('rp-radius-num');
  const perVertex = selectedVertexIndex >= 0 && selectedVertexIndex < poly.vertices.length;
  const override  = perVertex && poly.cornerRadii ? poly.cornerRadii[selectedVertexIndex] : null;
  const currentR  = override != null ? override : (poly.cornerRadius || 0);
  if (num !== document.activeElement) num.value = currentR;

  const rfield = _rpEl('rp-radius-field');
  rfield.classList.toggle('rp-per-vertex', perVertex);
  rfield.title = perVertex
    ? 'Corner radius for the selected vertex — ↑/↓ to step, Shift for 10. Esc deselects it to edit every corner; Del removes it.'
    : 'Corner radius, every corner — ↑/↓ to step, Shift for 10. Select a vertex on the map to round just that one.';

  // There is no "v3/8" vertex readout here any more. It reported which handle was selected —
  // a fact the map already shows by highlighting that handle — in a notation that meant
  // nothing without being explained, and the one thing it was genuinely useful for (which
  // corners the radius number is about) is what the glyph above says.

  _rpPositionPanel(panel, poly);
}

// Screen px → the pre-zoom px that style.left/top are written in (the card carries
// `zoom: var(--ui-zoom)`). MEASURED, and AFFINE — a slope AND a constant, which is the part
// two earlier versions each got wrong:
//   slope     getBoundingClientRect().width / offsetWidth = 324/270 at --ui-zoom 1.2.
//   constant  style.left 0 painted at screen x 9.6, and 137 at 174.0; vertically it was 0.
// Assigning screen px raw ignored the slope and drifted the card ~20% off the room. Dividing
// by the slope alone left the constant ~8px, which automatic placement hid but a drag exposes
// as a jump on grab. Both terms are derived from the panel's own measured position, so neither
// is hard-coded. Don't reduce this to a bare `/ uiZoom`. See CLAUDE.md.
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
    // Re-clamped every time rather than trusted as stored: the window can be resized and the
    // description can be dragged taller after the card was placed, either of which could put
    // a remembered position off-screen.
    left = Math.max(RP_MARGIN, Math.min(window.innerWidth  - r.width  - RP_MARGIN, _rpManualPos.left));
    top  = Math.max(RP_MARGIN, Math.min(window.innerHeight - r.height - RP_MARGIN, _rpManualPos.top));
  } else {
    const c = getCentroid(poly.vertices);
    const { sx, sy } = toScreen(c.x, c.y);
    const pos = clampPanelPosition(sx, sy, r.width, r.height, window.innerWidth, window.innerHeight);
    left = pos.left; top = pos.top;
  }
  const st = _rpScreenToStyle(panel, left, top);
  panel.style.left = st.left + 'px';
  panel.style.top  = st.top  + 'px';
}

// Drag by the title bar. Screen pixels throughout, converted on the way into style.left/top by
// _rpScreenToStyle — see its MEASURED note; a drag is the path where getting that conversion
// wrong is immediately visible, because the card is supposed to track the pointer exactly.
// The move/up listeners go on window, not the bar, so a fast drag that outruns the pointer
// doesn't drop the card mid-flight.
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

  // The way back: double-click the bar and the card returns to its room. Without this a DM who
  // parked the card in a corner has no way to undo that short of closing and reopening it.
  head.addEventListener('dblclick', e => {
    if (e.target.closest('button')) return;
    _rpManualPos = null;
    drawCursor(lastScreenX, lastScreenY);
  });
}

// Remembered description height, restored once at init. Once at init is enough — the browser
// writes a resize handle's result as an inline style on the element and that survives the card
// being hidden and reshown, so only a reload needs this.
function _rpApplyDescHeight(el) {
  let h = 0;
  try { h = parseInt(localStorage.getItem(RP_DESC_H_KEY)) || 0; } catch (_) {}
  // Only sanity-check that it IS a height — a garbage value parses to 0 and is skipped. The
  // RANGE needs no check: .rp-desc's own min/max-height clamp it, so an absurd stored value
  // self-heals to a legal box on the next paint.
  if (h > 0) el.style.height = h + 'px';
}

// Save the height when the resize drag ENDS. This was a ResizeObserver first, and that version
// was worse in three ways which all followed from it firing continuously: it needed a debounce
// (localStorage is synchronous), it needed a range guard (hiding the card collapses the textarea
// to 0×0 and the observer fires for THAT too, so an unguarded save wiped the preference every
// time a room was deselected), and — the actual bug — it re-clamped the card on every tick, so
// dragging the handle DOWN near the screen's bottom edge slid the card UP under the pointer.
// One mouseup has none of that: nothing to debounce, no phantom 0×0, and the single re-clamp
// lands after the drag instead of fighting it.
// The listener is on window, not the textarea, because a resize drag can release anywhere.
function _rpWatchDescHeight(el, panel) {
  let last = el.offsetHeight;
  window.addEventListener('mouseup', () => {
    // offsetHeight, NOT getBoundingClientRect().height: the card carries zoom:var(--ui-zoom), so
    // the rect is screen px while offsetHeight is the pre-zoom layout px style.height is written
    // in. Storing the rect would grow the box by the UI scale on every reload.
    const h = el.offsetHeight;
    if (!h || h === last) return;          // hidden, or nothing was resized — the common case
    last = h;
    try { localStorage.setItem(RP_DESC_H_KEY, String(h)); } catch (_) {}
    const poly = _rpFindPoly(selectedPolygonId);
    if (poly) _rpPositionPanel(panel, poly);   // the card changed height, so re-clamp it once
  });
}

// ─── Room labels on the DM map ────────────────────────────────────────────────
// Names are drawn on the map itself so the DM can read the dungeon at a glance instead of
// hovering rooms to identify them. DM-only: this paints on the cursor overlay, which the
// Player window doesn't have (and polygons never cross to the Player at all).
//
// Placement is TOP-LEFT INSIDE the room, like a label on a floorplan, so the name doesn't
// sit on top of the map art in the middle of the room. "Top-left" is meaningless for a
// circle and wrong for a heavily rounded rectangle — the bounding box's corner is outside
// the shape in both cases — so the anchor comes from fitLabelBox(), which finds the highest
// row where the label actually fits inside the outline. See its comment.

// Plate padding — the label's own internal inset, between the glyphs and the plate edge.
// Deliberately generous relative to the type: at 9/5 the plate was a shrink-wrap around the
// glyphs — the name touched the hairline and the plate read as a stray rectangle dropped on
// the map rather than a label.
const RP_LABEL_PAD_X = 13;
const RP_LABEL_PAD_Y = 8;
const RP_LABEL_RADIUS = 7;   // tracks the taller plate; 5 looked square once it grew

// Gap between the PLATE and the room's outline — one number for both axes, which is the
// whole point. MEASURED bug it fixes: the pad handed to fitLabelBox used to be PAD_X, and
// the fit anchored the label's TEXT, so the draw step subtracted PAD_X straight back out
// (`sx - RP_LABEL_PAD_X`) and the left gap collapsed to zero while the top kept its 13 —
// visibly crooked into the corner. The fit now sizes the whole PLATE (width includes
// PAD_X × 2, height already did with PAD_Y), so box.x/box.y describe the plate and this one
// constant lands identically on both sides. Screen px, ÷ zoom on the way into the fit.
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

    // drawCursor() runs on every mouse move (~25 call sites), so neither measureText nor
    // the row scan may run per room per frame. The fit is done in MAP units, which makes
    // the cached anchor pan-independent: only a rename, a zoom change or an edit to the
    // room's own geometry invalidates it.
    const bb  = getPolyBBox(poly.vertices);
    const key = name + '|' + fontPx + '|' + poly.vertices.length + '|' +
                Math.round(bb.minX) + ',' + Math.round(bb.minY) + ',' +
                Math.round(bb.maxX) + ',' + Math.round(bb.maxY) + '|' +
                (poly.cornerRadius || 0) + '|' + (poly.cornerRadii ? poly.cornerRadii.join(',') : '');

    let entry = _rpLabelCache.get(poly.id);
    if (!entry || entry.key !== key) {
      // Corner rounding: the widest radius in play, since it is the one that could push the
      // label outside the drawn outline.
      let cornerR = poly.cornerRadius || 0;
      if (poly.cornerRadii) {
        for (const r of poly.cornerRadii) if (r != null && r > cornerR) cornerR = r;
      }
      // Fit the PLATE, not the text: width carries the plate's own PAD_X on both sides, and
      // the pad handed in is the gap to the outline. That is what makes the top and left gaps
      // come out equal — see RP_LABEL_GAP.
      const box = fitLabelBox(
        poly.vertices,
        (measure(name) + RP_LABEL_PAD_X * 2) / zoom,   // map units — screen plate width ÷ zoom
        textH / zoom,
        RP_LABEL_GAP / zoom,
        cornerR,
      );
      if (!box) { _rpLabelCache.set(poly.id, { key, text: '' }); continue; }
      const text = ellipsizeToWidth(name, box.avail * zoom - RP_LABEL_PAD_X * 2, measure);
      // Auto-hide: "C…" names nothing, so a truncation that leaves under two real
      // characters is dropped rather than drawn. Only truncated text is judged this way —
      // a room genuinely called "A" still gets its label. Self-tuning per room, which beats
      // one global zoom threshold: a great hall and a broom cupboard cross the readable
      // line at different zooms.
      const truncated = text !== name;
      const tooShort  = truncated && text.replace('…', '').trim().length < 2;
      entry = (text && !tooShort)
        ? { key, text, w: measure(text), mx: box.x, my: box.y }
        : { key, text: '' };
      _rpLabelCache.set(poly.id, entry);
    }
    if (!entry.text) continue;

    // sx/sy is the plate's LEFT edge / vertical centre (the fit sized the plate, not the
    // text), so the plate draws straight from sx and the glyphs start one PAD_X in.
    const { sx, sy } = toScreen(entry.mx, entry.my);
    const bw = entry.w + RP_LABEL_PAD_X * 2;
    if (sx < -bw || sy < -textH || sx > vw || sy > vh + textH) continue;

    // Backing plate. Opaque enough to read against bright map art — a faint wash let busy
    // Dungeon Alchemist floors show through and the name dissolved into the texture. The
    // hairline is the panel border colour, so the plate reads as app chrome sitting on the
    // map rather than as part of the art.
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

// ─── Node.js export guard (unit tests only) ──────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeRoomFields, sanitizeRoomName, sanitizeRoomDesc,
    clampPanelPosition, ellipsizeToWidth,
    roomLabelFontPx, polygonRowSpans, cornerInsetAt, fitLabelBox,
    ROOM_NAME_MAX, ROOM_DESC_MAX,
  };
}
