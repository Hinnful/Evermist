'use strict';
// roomLink.js — two-map mode's Room tab. The selected room lives in a column, which has no dock of
// its own, so the column reports the room to the DM window and the tab edits it from there. Every
// edit goes back to that column alone and returns in its next report.

// ─── Column side ──────────────────────────────────────────────────────────────

let _rlSent = null;

// From the column's refreshRoomPanel on every repaint; a report goes up only when it changed,
// and the picture blobs only when the set did.
function paneReportRoom(room) {
  if (!isPane || parent === window) return;
  const snap = room ? {
    id: room.id, name: room.name != null ? room.name : _rpFallbackName(room),
    desc: room.desc != null ? room.desc : '', mode: room.mode,
    pictures: roomPictureRefs(room, pictureBlobs).map(p => ({ id: p.id, name: p.name })),
    onTv: tvPicture && tvPicture.roomId === room.id ? tvPicture.picId : '',
  } : null;
  const key = JSON.stringify(snap);
  if (key === _rlSent) return;
  const picsChanged = !_rlSent || !snap || JSON.stringify((JSON.parse(_rlSent) || {}).pictures) !== JSON.stringify(snap.pictures);
  _rlSent = key;
  const blobs = {};
  if (snap && picsChanged) snap.pictures.forEach(p => { blobs[p.id] = pictureBlobs[p.id]; });
  parent.postMessage({ type: 'pane-room', pane: paneId, room: snap, blobs }, '*');
}

// What the DM window asks of this column's selected room. ⚠ Refused when the selection moved on
// since the report, so an edit typed for one room never lands on the next.
function paneApplyRoomEdit(m) {
  const room = selectedPolygonId === m.id ? polygons.find(p => p.id === m.id) : null;
  if (!room) return;
  _rpFieldPid = room.id;
  if (m.op === 'name' || m.op === 'desc') {
    _rpEl(m.op === 'name' ? 'rp-name' : 'rp-desc').value = m.value;
    if (m.op === 'name') _rpCommitName(); else _rpCommitDesc();
  } else if (m.op === 'mode') setPolygonMode(room.id, m.mode);
  else if (m.op === 'delete') deleteSelectedPolygon();
  else if (m.op === 'entry') applyModuleEntryToRoom(m.entry);
  else if (m.op === 'add-pictures') addRoomPictures(room.id, m.files);
  else if (m.op === 'drop-picture') _rpPicEdit(room.id, list => picturesWithout(list, m.pic));
  else if (m.op === 'move-picture') _rpPicEdit(room.id, list => picturesMoved(list, m.from, m.to));
  else if (m.op === 'tv') { if (m.pic) showTvPicture(room.id, m.pic); else hideTvPicture(); }
  drawCursor(lastScreenX, lastScreenY);
}

// ─── DM window side ──────────────────────────────────────────────────────────

const _rlRooms = { A: null, B: null };

function paneRoomReported(id, room, blobs) {
  _rlRooms[id] = room;
  for (const k in blobs) if (blobs[k]) pictureBlobs[k] = blobs[k];
  // ⚠ refreshRoomPanel, never drawCursor: the DM window holds no map in two-map mode, and
  // drawCursor returns before it reaches the tab.
  if (id === panesSelected) refreshRoomPanel();
}

function paneRoomsClear() { _rlRooms.A = _rlRooms.B = null; _rlAim = null; }

// The room the tab shows in two-map mode: the selected column's. Null in single-map mode.
function paneSelectedRoom() {
  return panesActive && !isPane ? _rlRooms[panesSelected] : null;
}

// Two columns number their rooms alike, so a room is told apart by its column too.
function roomTabKey(room) {
  if (!room) return null;
  return paneSelectedRoom() ? panesSelected + ':' + room.id : room.id;
}

// The column and room the tab's fields were filled from. ⚠ Not the selected column: a commit on
// the way out of a room runs after the selection moved, and belongs to the room it was typed for.
let _rlAim = null;
function paneRoomAim(room) {
  _rlAim = room && paneSelectedRoom() ? { pane: panesSelected, id: room.id } : null;
}

// True when the edit went to a column, so the caller skips its own.
function paneRoomEdit(op, payload) {
  if (!panesActive || isPane) return false;
  if (_rlAim) sendToPane({ ...(payload || {}), op, id: _rlAim.id, type: 'pane-room-edit' }, _rlAim.pane);
  return true;
}
