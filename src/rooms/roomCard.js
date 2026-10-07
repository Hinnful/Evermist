'use strict';
// roomCard.js — the dock's Room tab: the selected room's name, notes and pictures.
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
  return t(poly.material ? 'Fire {n}' : 'Room {n}', { n: poly.id });
}

// pushUndo() runs BEFORE the write and only on a real change, so one Ctrl+Z reverts one edit.
function _rpCommitName() {
  const el = _rpEl('rp-name');
  if (el && paneRoomEdit('name', { value: el.value })) return;
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
  if (el && paneRoomEdit('desc', { value: el.value })) return;
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
  if (entry && paneRoomEdit('entry', { entry })) return true;
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

  // Enter commits the name (one line); in the description it inserts a newline.
  _rpWireField(_rpEl('rp-name'), {
    commit: _rpCommitName, enterCommits: true,
    // The dropdown claims ↑/↓ and, with a row highlighted, Enter and Escape.
    onKeyDown: typeof mtNameKeyDown === 'function' ? mtNameKeyDown : null,
  });
  _rpWireField(_rpEl('rp-desc'), { commit: _rpCommitDesc, enterCommits: false });
  _rpEl('rp-desc').addEventListener('input', _rpFitNotes);

  // Last of the field wiring, so the dropdown is appended after the fields exist.
  if (typeof initModuleText === 'function') initModuleText(_rpEl('rp-name'));

  initRoomPictures(panel);
  document.addEventListener('dockpane', e => { if (e.detail === 'room') _rpFitNotes(); });

  _rpEl('rp-delete').onclick = () => {
    if (paneRoomEdit('delete')) return;
    if (selectedPolygonId != null) deleteSelectedPolygon();
  };
}

// The notes grow with what is written in them; the tab scrolls, the field never does.
function _rpFitNotes() {
  const el = _rpEl('rp-desc');
  if (!el || !el.offsetParent) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

// Refill, from drawCursor() on every repaint. ⚠ NEVER from setPolygonMode(), where a rebuild
// mid-edit steals field focus. The tab follows the selection ONLY, never the tool.
let _rpTrioPid = null, _rpTabKey = null;
function refreshRoomPanel() {
  if (typeof isPlayer !== 'undefined' && isPlayer) return;
  const panel = _rpEl('panel-room');
  if (!panel) return;
  reconcileTvPicture();
  refreshFogTrio();

  // Calibration takes the map's mouse and puts the pane away (dock.js). SELECTION IS UNTOUCHED,
  // so the same room is in the tab at Done. ⚠ Committing first: a tab put away mid-sentence
  // would otherwise drop what was typed.
  if (typeof gridCalArmed !== 'undefined' && gridCalArmed) {
    if (_rpFieldPid != null) _rpCommitFields();
    if (typeof mtCloseDropdown === 'function') mtCloseDropdown();
    return;
  }

  const poly = _rpFindPoly(selectedPolygonId);
  const linked = paneSelectedRoom();
  const room = linked || (poly && !poly.material && !poly.light ? poly : null);
  if (isPane) paneReportRoom(room);
  if (roomTabKey(room) !== _rpTrioPid) { _rpTrioPid = roomTabKey(room); updateContextPanels(); }

  dockSyncRoom(roomTabKey(room));

  // ⚠ AN EFFECT OR A LIGHT GETS NO TAB: it has no name, notes or module text. It leaves by the SAME path as
  // a deselect, or the tab can go without committing what was typed into a real room.
  if (!room) {
    if (_rpFieldPid != null) { _rpCommitFields(); _rpFieldPid = null; }
    paneRoomAim(null);
    if (typeof mtCloseDropdown === 'function') mtCloseDropdown();
    return;
  }

  // Selection moved: commit what the fields still hold for the OLD room before overwriting.
  const sameRoom = _rpFieldPid === room.id && _rpTabKey === roomTabKey(room);
  _rpTabKey = roomTabKey(room);
  if (!sameRoom && _rpFieldPid != null) _rpCommitFields();
  // A dropdown left open across a room change picks into the new room while filtered by the old.
  if (!sameRoom && typeof mtCloseDropdown === 'function') mtCloseDropdown();

  const nameEl = _rpEl('rp-name');
  const descEl = _rpEl('rp-desc');
  // Never clobber a field being typed in.
  if (!sameRoom || nameEl !== document.activeElement) nameEl.value = room.name != null ? room.name : _rpFallbackName(room);
  if (!sameRoom || descEl !== document.activeElement) descEl.value = room.desc != null ? room.desc : '';
  _rpFieldPid = room.id;
  paneRoomAim(room);

  refreshRoomPictures(room, linked ? linked.onTv : null);
  if (!sameRoom) _rpFitNotes();
}

// Screen px → the pre-zoom px style.left/top are written in, for a box carrying
// `zoom: var(--ui-zoom)`. MEASURED and AFFINE — a slope AND a constant origin. ⚠ Never reduce
// this to a bare `/ uiZoom`: that leaves a constant offset a drag exposes as a jump on grab.
function _rpScreenToStyle(panel, screenLeft, screenTop) {
  const r  = panel.getBoundingClientRect();
  const cs = getComputedStyle(panel);
  const z  = panel.offsetWidth > 0 ? (r.width / panel.offsetWidth) : 1;
  const originX = r.left - (parseFloat(cs.left) || 0) * z;
  const originY = r.top  - (parseFloat(cs.top)  || 0) * z;
  return { left: (screenLeft - originX) / z, top: (screenTop - originY) / z };
}
