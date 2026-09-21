'use strict';
// roomCard.js — the floating panel shown when a room is selected: its fields, where it places
// itself, and the drag that moves it.
//
// The card is MOVABLE and its description RESIZABLE, neither of them polish: the card floats
// over the map and will sometimes cover the handles the DM selected the room by.
//
// Called once from initToolbar() (DM only). The name labels on the map are roomPanel.js.

// Id of the room the fields currently hold values for. NOT selectedPolygonId: a canvas click
// changes the selection *before* the focused field's blur fires, so commits key off this.
let _rpFieldPid = null;

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
    clearShapeSelection();
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
    // ⚠ THE CONTEXT ROW'S FIELD IS THE DM WINDOW'S; the card's own lives inside the column.
    if (numId === 'fx-radius-num' && paneForward('corner-radius', { radius: v })) return;
    const poly = _rpFindPoly(selectedPolygonId);
    if (!poly) return;
    // One undo per editing session, never per keystroke: typing "150" is one Ctrl+Z.
    if (!radiusUndoPushed) { pushUndo(); radiusUndoPushed = true; }
    // The target follows the selection; the array pads out, since a polygon can gain vertices.
    const vi = selectedVertexIndex;
    const total = flatVertexCount(poly);
    if (vi >= 0 && vi < total) {
      editCornerRadii(poly, r => {
        while (r.length < total) r.push(null);
        r[vi] = v;
      });
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
  const perVertex = !!poly && selectedVertexIndex >= 0 && selectedVertexIndex < flatVertexCount(poly);
  const curved    = perVertex && !!handleAt(poly.handles, selectedVertexIndex);
  num.disabled = !poly;
  const override  = perVertex && poly.cornerRadii ? poly.cornerRadii[selectedVertexIndex] : null;
  const currentR  = !poly ? 0 : (override != null ? override : (poly.cornerRadius || 0));
  if (num !== document.activeElement) num.value = currentR;

  field.classList.toggle('rp-per-vertex', perVertex);
  field.title = curved
    ? 'Corner radius for the selected corner, filleted against its own curve. ↑/↓ to step, Shift for 10.'
    : (perVertex
      ? 'Corner radius for the selected corner. ↑/↓ to step, Shift for 10. Esc goes back to every corner, Del removes the vertex.'
      : 'Corner radius for every corner. ↑/↓ to step, Shift for 10. Select a vertex on the map to round just that one.');
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

  // Calibration takes the map's mouse and shuts the control panel for the room it needs; a card
  // left floating over that map swallows the drag. SELECTION IS UNTOUCHED, so this is not the
  // tool gate the card must never have - the same card comes back on the same room at Done.
  // ⚠ Committing first: a card hidden mid-sentence would otherwise drop what was typed, the same
  // reason the deselect path below commits before it hides.
  if (typeof gridCalArmed !== 'undefined' && gridCalArmed) {
    if (_rpFieldPid != null) _rpCommitFields();
    if (typeof mtCloseDropdown === 'function') mtCloseDropdown();
    panel.style.display = 'none';
    return;
  }

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
    const bb = shapeBBox(poly);
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

