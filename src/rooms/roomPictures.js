'use strict';
// roomPictures.js — a room's pictures on its card, and the one on the TV. picturePlan.js is the
// pure half; tvPicture.js draws it on the Player.

const _picUrls = {};   // picture id → object URL, for the thumbnails
let _rpPicKey = null;
let _rpPicDrag = -1;

function _picUrl(id) {
  if (!_picUrls[id] && pictureBlobs[id]) _picUrls[id] = URL.createObjectURL(pictureBlobs[id]);
  return _picUrls[id];
}

function _picNewId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ─── Scene load and save ─────────────────────────────────────────────────────

function adoptScenePictures(scene) {
  for (const id in _picUrls) { URL.revokeObjectURL(_picUrls[id]); delete _picUrls[id]; }
  pictureBlobs = picturesReferenced(polygons, (scene && scene.pictureBlobs) || {});
  _rpPicKey = null;
}

// ─── Adding ──────────────────────────────────────────────────────────────────

async function addRoomPictures(roomId, files) {
  const added = [], failed = [];
  for (const f of files) {
    const blob = await decodeRoomPicture(f);
    if (!blob) { failed.push(f.name); continue; }
    const id = _picNewId();
    pictureBlobs[id] = blob;
    added.push({ id, name: f.name });
  }
  // Found again after the awaits: the room can be deleted while a big file decodes.
  const room = polygons.find(p => p.id === roomId);
  if (room && added.length) {
    pushUndo();
    room.pictures = (room.pictures || []).concat(added);
    scheduleAutoSave();
    drawCursor(lastScreenX, lastScreenY);
  }
  if (failed.length) messageDialog({
    title: t.plural(failed.length, 'One picture was not added', '{n} pictures were not added'),
    message: t('Evermist could not read these as pictures:') + '\n\n' + failed.join('\n'),
  });
}

// ─── The TV ──────────────────────────────────────────────────────────────────

// ⚠ A COLUMN'S playerWindow IS ITS HALF of the TV, and a picture covers the whole screen, so a
// column hands it to the DM window, which owns the shell.
function _picSend(blob) {
  if (isPane) {
    if (parent !== window) parent.postMessage({ type: 'pane-picture', pane: paneId, blob }, '*');
    return;
  }
  if (playerWindow && !playerWindow.closed) playerWindow.postMessage({ type: 'tv-picture', blob }, '*');
}

function showTvPicture(roomId, picId) {
  if (!currentScene || !pictureBlobs[picId]) return;
  tvPicture = { sceneId: currentScene.id, roomId, picId };
  _picSend(pictureBlobs[picId]);
  _rpPicKey = null;
  drawCursor(lastScreenX, lastScreenY);
}

// `silent` is a column told another column replaced its picture: the TV already moved on.
function hideTvPicture(silent) {
  if (!tvPicture) return;
  tvPicture = null;
  if (!silent) _picSend(null);
  _rpPicKey = null;
  drawCursor(lastScreenX, lastScreenY);
}

function resendTvPicture() {
  if (tvPicture && pictureBlobs[tvPicture.picId]) _picSend(pictureBlobs[tvPicture.picId]);
}

// Escape's first stop. In two-map mode the DM window asks whichever column put it up.
function takeDownTvPicture() {
  if (panesActive && !isPane) return paneTakeDownPicture();
  if (!tvPicture) return false;
  hideTvPicture();
  return true;
}

// A delete, an undo, a scene switch: whatever took the picture away takes it off the TV.
function reconcileTvPicture() {
  if (tvPicture && !tvPictureLive(tvPicture, currentScene && currentScene.id, polygons, pictureBlobs)) hideTvPicture();
}

// ─── The strip on the card ───────────────────────────────────────────────────

function _rpPicEdit(roomId, fn) {
  const room = polygons.find(p => p.id === roomId);
  if (!room) return;
  pushUndo();
  room.pictures = fn(room.pictures || []);
  scheduleAutoSave();
  drawCursor(lastScreenX, lastScreenY);
}

// Rebuilt only when the room, its pictures or the one on the TV changed: this runs every repaint.
// `tvPic` is a column's own reading in two-map mode; the DM window holds no tvPicture then.
function refreshRoomPictures(poly, tvPic) {
  const strip = _rpEl('rp-pics');
  if (!strip) return;
  const refs = roomPictureRefs(poly, pictureBlobs);
  const onTv = tvPic != null ? tvPic : (tvPicture && tvPicture.roomId === poly.id ? tvPicture.picId : '');
  const key = poly.id + ':' + refs.map(p => p.id).join(',') + ':' + onTv;
  if (key === _rpPicKey) return;
  _rpPicKey = key;
  strip.style.display = refs.length ? '' : 'none';
  strip.textContent = '';
  refs.forEach((p, i) => {
    const th = document.createElement('div');
    th.className = 'rp-pic' + (p.id === onTv ? ' on' : '');
    th.title = p.name || '';
    th.draggable = true;
    const img = document.createElement('img');
    img.src = _picUrl(p.id);
    img.draggable = false;
    const x = document.createElement('button');
    x.className = 'rp-pic-x';
    x.title = t('Delete picture');
    x.textContent = '×';
    th.append(img, x);
    th.onclick = e => {
      if (e.target === x) return;
      if (paneRoomEdit('tv', { pic: p.id === onTv ? '' : p.id })) return;
      if (p.id === onTv) hideTvPicture(); else showTvPicture(poly.id, p.id);
    };
    x.onclick = e => {
      e.stopPropagation();
      if (!paneRoomEdit('drop-picture', { pic: p.id })) _rpPicEdit(poly.id, list => picturesWithout(list, p.id));
    };
    th.addEventListener('dragstart', () => { _rpPicDrag = i; th.classList.add('drag'); });
    th.addEventListener('dragend', () => { _rpPicDrag = -1; _rpPicKey = null; drawCursor(lastScreenX, lastScreenY); });
    th.addEventListener('dragover', e => { if (_rpPicDrag >= 0) { e.preventDefault(); th.classList.add('over'); } });
    th.addEventListener('dragleave', () => th.classList.remove('over'));
    th.addEventListener('drop', e => {
      if (_rpPicDrag < 0) return;
      e.preventDefault(); e.stopPropagation();
      const from = _rpPicDrag;
      _rpPicDrag = -1;
      if (from !== i && !paneRoomEdit('move-picture', { from, to: i })) _rpPicEdit(poly.id, list => picturesMoved(list, from, i));
    });
    strip.appendChild(th);
  });
}

function initRoomPictures(panel) {
  const input = _rpEl('rp-pic-input');
  _rpEl('rp-pic-add').onclick = () => input.click();
  input.onchange = () => {
    const files = Array.from(input.files || []);
    input.value = '';
    if (files.length && !paneRoomEdit('add-pictures', { files }) && _rpFieldPid != null) addRoomPictures(_rpFieldPid, files);
  };
  // ⚠ STOPPED HERE, so a file dropped on the card never reaches the window's own drop handler.
  const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.items || []).some(i => i.kind === 'file');
  panel.addEventListener('dragover', e => { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); } });
  panel.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); e.stopPropagation();
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length && !paneRoomEdit('add-pictures', { files }) && _rpFieldPid != null) addRoomPictures(_rpFieldPid, files);
  });
}
