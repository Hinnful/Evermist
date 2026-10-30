'use strict';
// searchPick.js — what a pick does, per kind. A map, and a room (its map goes to the players), open by the
// Manual/Auto rule on every view: Manual opens it on the DM's screen and the TV waits for Send, Auto asks first.

// The map the TV shows now. In Manual a held change leaves the TV on the old map.
function searchSceneOnTv(id) {
  return mcpOnTv({ playerOpen: !!(playerWindow && !playerWindow.closed), held: tvHeld, panes: panesActive,
    isOpen: !!(currentScene && currentScene.id === id) && !tvShowsOtherMap(), inColumn: panesActive && !!paneColumnOf(id) });
}

// The right-hand word of the selected row.
function searchActionWord(row) {
  const e = row.entry;
  if (e.kind === 'campaign' || (row.rank === SP_NOTE && e.kind !== 'monster')) return t('Show notes');
  if (e.kind === 'map') return autoSync && !searchSceneOnTv(e.id) && !(currentScene && currentScene.id === e.id) ? t('Open and send') : t('Open');
  return t({ room: 'Open map', place: 'Show on Campaign', road: 'Show on Campaign', monster: 'Stat block', fight: 'Fight table', music: 'Pick track', picture: 'Open picture' }[e.kind]);
}

function _srNotes(level) {
  notesLevelPick = level;
  dockOpen('notes');
  refreshRoomPanel();
}

function _srSelectRoom(id, notes) {
  const p = polygons.find(x => x.id === id);
  if (!p || panesActive) return;
  selectedPolygonId = p.id;
  leaveShapeEditMode();
  notesLevelPick = null;
  if (notes) dockOpen('notes');
  refreshRoomPanel();
  drawCursor(lastScreenX, lastScreenY);
  scheduleRender();
}

// Opens a scene, then `after`. The Campaign's own open keeps its zoom when nothing follows.
async function _srGoScene(id, after) {
  if (panesActive) { if (loadSceneIntoSelectedPane(id) && worldMapOpen) worldMapHide(); return; }
  if (worldMapOpen && !after) { worldMapOpenScene(id); return; }
  await switchScene(id).catch(err => console.error('switchScene failed:', err));
  if (worldMapOpen) worldMapHide();
  if (after) after();
}

function _srOpenScene(id, name, after) {
  const open = !!(currentScene && currentScene.id === id) && !panesActive;
  if (!autoSync || open || searchSceneOnTv(id)) { _srGoScene(id, after); return; }
  confirmDialog({
    title: t('Open “{name}”?', { name }),
    message: t('Updates are Auto, so the players see it at once.'),
    confirmLabel: t('Open and send'),
    onConfirm: () => _srGoScene(id, after),
  });
}

// The Campaign, framed on `cam` and `select` run once it is up.
function _srWorld(cam, select) {
  if (worldMapOpen && _wmAnim) return;
  if (worldMapOpen) _wmFly(cam, 650); else worldMapShow(cam);
  select();
}

function _srPlace(name, notes) {
  const p = _wmPlaces().find(x => x.name === name);
  if (!p) return;
  _srWorld(wmPlaceCamera(p.bounds, _wmView()), () => { worldMapSelect({ sceneId: null, place: name }); if (notes) _srNotes(null); });
}

function _srRoad(uid, notes) {
  const r = worldRoadByUid(uid);
  if (!r) return;
  const xs = r.vertices.map(v => v.x), ys = r.vertices.map(v => v.y), x = Math.min(...xs), y = Math.min(...ys);
  const box = { x, y, w: Math.max(...xs) - x || 1, h: Math.max(...ys) - y || 1 };
  _srWorld(wmPlaceCamera(box, _wmView()), () => { worldMapSelect({ sceneId: null, place: '', road: uid }); if (notes) _srNotes(null); });
}

function _srCampaign() {
  if (!worldMapOpen && !currentScene && !panesActive) worldMapShow();
  _srNotes('campaign');
}

// A row picked: the box has already closed.
function searchPick(row) {
  const e = row.entry, notes = row.rank === SP_NOTE;
  searchRecentAdd(e.key);
  if (e.kind === 'map') _srOpenScene(e.id, e.name, notes ? () => _srNotes('scene') : null);
  else if (e.kind === 'room') _srOpenScene(e.id, e.where, () => _srSelectRoom(e.roomId, notes));
  else if (e.kind === 'place') _srPlace(e.id, notes);
  else if (e.kind === 'road') _srRoad(e.id, notes);
  else if (e.kind === 'campaign') _srCampaign();
  else if (e.kind === 'monster') { bestiarySetOpen(true); _bsShow(e.id); }
  else if (e.kind === 'fight') { cbSetOpen(true); _cfSwitch(e.id); }
  else if (e.kind === 'music') { dockOpen('music'); musicPickTrack(e.id); }
  else if (e.kind === 'picture') { dockOpen('gallery'); galleryPickPicture(e.id); }
}
