'use strict';
// notesPanel.js — what the Notes window shows and saves: the notes of the campaign, a group, a road, a map, a room,
// a monster, a faction or a piece of lore. The shell is notesWindow.js, the tree notesTree.js.
//
// The room's own field (#rp-desc) lives inside the window, but its logic stays in roomCard.js. What is shown is a
// target { kind, id, scene? }: what the DM picked in the tree or a crumb (notesLevelPick), else what the selection
// follows. A map nobody holds is read and written through the store; one a column holds, through that column.

const NOTES_CAMPAIGN_KEY = 'evermist.campaignNotes';
const NOTES_PLACES_KEY = 'evermist.placeNotes';
const NOTES_ROADS_KEY = 'evermist.roadNotes';

// Where the scene/campaign field's text goes when it commits: filled for one level of one scene
// (and one column), and written back there however the selection has moved since.
let _npAim = null;
let _npFilled = '';              // the text the field was filled with, so only an edit is written
let _npKey = null;
let _npRoomKey = null;
let _npMap = null;               // { key, notes }: the stored notes of a map nobody has open, read once per pick
let _npMapLoading = null;        // the map id being read
let _npForeign = null;           // { scene, id }: the room fields hold a room of a map that is not held

function _npEl(id) { return document.getElementById(id); }

// ─── Campaign notes ──────────────────────────────────────────────────────────

// A save that failed leaves the text here, so the field and the next read still hold it and the next save writes it.
let _npPending = { campaign: null, places: null, roads: null };
const _npSaveReported = new Set();

const _NP_SAVE_WORDS = {
  campaignNotes: () => [t('The campaign notes are not being saved'), t('Evermist could not write the campaign notes to disk, so they will be gone after a restart.')],
  placeNotes: () => [t('The place notes are not being saved'), t('Evermist could not write the place notes to disk, so they will be gone after a restart.')],
  roadNotes: () => [t('The road notes are not being saved'), t('Evermist could not write the road notes to disk, so they will be gone after a restart.')],
  places: () => [t('The places are not being saved'), t('Evermist could not write the places to disk, so your last change will be gone after a restart.')],
  roads: () => [t('The roads are not being saved'), t('Evermist could not write the roads to disk, so your last change will be gone after a restart.')],
  party: () => [t('The party marker is not being saved'), t('Evermist could not write the party marker to disk, so it will be back where it was after a restart.')],
  entries: () => [t('The factions and lore are not being saved'), t('Evermist could not write the factions and lore to disk, so your last change will be gone after a restart.')],
  groups: () => [t('The order of the groups is not being saved'), t('Evermist could not write the order of the groups to disk, so it will be gone after a restart.')],
};

// Every writer of campaign data reports a failed save here, once per launch per kind. Always false, for `return`.
function notesSaveFailed(kind, err) {
  console.warn('Saving ' + kind + ' failed:', err);
  if (!notesSaveReportDue(kind, _npSaveReported)) return false;
  _npSaveReported.add(kind);
  const w = _NP_SAVE_WORDS[kind]();
  messageDialog({ title: w[0], message: w[1] + '\n\n' + ((err && err.message) || err) });
  return false;
}

function notesCampaignGet() {
  if (_npPending.campaign != null) return _npPending.campaign;
  try { return localStorage.getItem(NOTES_CAMPAIGN_KEY) || ''; } catch (_) { return ''; }
}

function notesCampaignSet(text) {
  try { localStorage.setItem(NOTES_CAMPAIGN_KEY, text); } catch (err) { _npPending.campaign = text; return notesSaveFailed('campaignNotes', err); }
  _npPending.campaign = null;
  return true;
}

// ─── Place notes ─────────────────────────────────────────────────────────────

function notesPlacesAll() {
  if (_npPending.places) return notesPlacesCopy(_npPending.places);
  try { return notesPlacesClean(JSON.parse(localStorage.getItem(NOTES_PLACES_KEY) || '{}')).places; }
  catch (_) { return notesPlacesNew(); }
}

function notesPlacesWrite(map) {
  try { localStorage.setItem(NOTES_PLACES_KEY, JSON.stringify(map)); } catch (err) { _npPending.places = map; return notesSaveFailed('placeNotes', err); }
  _npPending.places = null;
  if (typeof worldPlacesSave === 'function') worldPlacesSave();
  return true;
}

function notesPlaceGet(name) {
  const all = notesPlacesAll();
  return Object.prototype.hasOwnProperty.call(all, name) ? all[name] : '';
}

function notesPlaceSet(name, text) {
  const all = notesPlacesAll();
  if (text) all[name] = text; else delete all[name];
  return notesPlacesWrite(all);
}

// ─── Road notes ──────────────────────────────────────────────────────────────
// Keyed by the road's stored id, never its name, so a rename moves nothing.

function notesRoadsAll() {
  if (_npPending.roads) return notesPlacesCopy(_npPending.roads);
  try { return notesPlacesClean(JSON.parse(localStorage.getItem(NOTES_ROADS_KEY) || '{}')).places; }
  catch (_) { return notesPlacesNew(); }
}

function notesRoadsWrite(map) {
  try { localStorage.setItem(NOTES_ROADS_KEY, JSON.stringify(map)); } catch (err) { _npPending.roads = map; return notesSaveFailed('roadNotes', err); }
  _npPending.roads = null;
  if (typeof worldRoadsSave === 'function') worldRoadsSave();
  return true;
}

function notesRoadGet(uid) {
  const all = notesRoadsAll();
  return Object.prototype.hasOwnProperty.call(all, uid) ? all[uid] : '';
}

function notesRoadSet(uid, text) {
  const all = notesRoadsAll();
  if (text) all[uid] = text; else delete all[uid];
  return notesRoadsWrite(all);
}

// ─── Which scene ─────────────────────────────────────────────────────────────

// The scene on screen: this window's, or the selected column's in two-map mode.
function _npScene() {
  if (isPane) return null;
  if (panesActive) return paneSelectedScene();
  return currentScene ? { key: currentScene.id, name: currentScene.name, notes: currentScene.notes || '' } : null;
}

// A map's notes, whoever holds it: the open map's live copy, else the stored record (a column's is saved first). The
// first call after a pick answers null and the window repaints when the read lands.
function _npMapNotes(id) {
  if (!allScenes.some(x => x.id === id)) { _npMap = null; return null; }
  if (!panesActive && currentScene && currentScene.id === id) return currentScene.notes || '';
  if (_npMap && _npMap.key === id) return _npMap.notes;
  if (_npMapLoading === id) return null;
  _npMapLoading = id;
  const held = panesActive ? paneColumnOf(id) : null;
  (held ? flushPaneScene(held) : Promise.resolve()).then(() => sceneStore.loadScene(id)).then(rec => {
    if (_npMapLoading !== id) return;
    _npMapLoading = null;
    _npMap = { key: id, notes: notesSanitize(rec && rec.notes).text };
    refreshRoomPanel();
  }).catch(() => { if (_npMapLoading === id) _npMapLoading = null; });
  return null;
}

// What the window shows with nothing picked in it: the Campaign's pick while it is up, else the selected room, else
// the open map, else the campaign note.
function _npFollow(room, scene) {
  if (worldMapOpen) {
    if (worldMapSel.sceneId) return { kind: 'map', id: worldMapSel.sceneId };
    if (worldMapSel.road && worldRoadByUid(worldMapSel.road)) return { kind: 'road', id: worldMapSel.road };
    return worldMapSel.place ? { kind: 'place', id: worldMapSel.place } : { kind: 'campaign' };
  }
  if (room && scene) return { kind: 'room', id: room.id, scene: scene.key, own: true };
  return scene ? { kind: 'map', id: scene.key } : { kind: 'campaign' };
}

const _NP_KIND = { campaign: 'Campaign', place: 'Group', road: 'Road', map: 'Map', room: 'Room', monster: 'Monster or NPC', faction: 'Faction', lore: 'Lore' };

// The target as the window draws it: its tree key, name, kind word and notes, or null when what it named is gone.
// `notes` is null while a map's is being read.
function _npMeta(tg, room) {
  const e = tg.kind === 'entry' ? notesEntryGet(tg.id) : null;
  const kind = e ? e.kind : tg.kind;
  const base = { tg, kind, word: _NP_KIND[kind], rename: tg.kind !== 'campaign' };
  if (tg.kind === 'campaign') return { ...base, key: 'campaign', name: t('Campaign'), notes: notesCampaignGet() };
  if (tg.kind === 'place') return worldPlaceByName(tg.id) || knownGroupNames().includes(tg.id)
    ? { ...base, key: 'place:' + tg.id, name: tg.id, notes: notesPlaceGet(tg.id) } : null;
  if (tg.kind === 'road') { const r = worldRoadByUid(tg.id); return r ? { ...base, key: 'road:' + tg.id, name: r.name, notes: notesRoadGet(tg.id) } : null; }
  if (tg.kind === 'map') { const s = allScenes.find(x => x.id === tg.id); return s ? { ...base, key: 'map:' + tg.id, name: s.name, notes: _npMapNotes(tg.id) } : null; }
  if (tg.kind === 'monster') { const b = cbState.blocks[tg.id]; return b ? { ...base, key: 'monster:' + tg.id, name: b.name, notes: b.notes || '', block: b } : null; }
  if (tg.kind === 'entry') return e ? { ...base, key: 'entry:' + tg.id, name: e.name, notes: e.note } : null;
  const r = tg.own ? room : (searchRoomsOf(tg.scene) || []).find(x => x.id === tg.id);
  if (!r || !allScenes.some(x => x.id === tg.scene)) return null;
  return { ...base, key: 'room:' + tg.scene + ':' + tg.id, name: r.name != null && r.name !== '' ? r.name : '', rename: true, room: r };
}

// ─── Committing ──────────────────────────────────────────────────────────────

function _npCommit() {
  const aim = _npAim, el = _npEl('np-field');
  if (!aim || !el) return;
  const v = notesSanitize(el.value).text;
  el.value = v;
  if (aim.kind === 'campaign') { if (v !== notesCampaignGet()) notesCampaignSet(v); return; }
  if (aim.kind === 'place') { if (v !== notesPlaceGet(aim.id)) notesPlaceSet(aim.id, v); return; }
  if (aim.kind === 'road') { if (v !== notesRoadGet(aim.id)) notesRoadSet(aim.id, v); return; }
  if (v === _npFilled) return;
  _npFilled = v;
  if (aim.kind === 'map') _npCommitMap(aim.id, v);
  else if (aim.kind === 'entry') notesEntrySetNote(aim.id, v);
  else if (aim.kind === 'monster' && cbState.blocks[aim.id]) { cbState.blocks[aim.id].notes = v; cbSaveSoon(); }
}

// A map's notes written where its live copy is, so no autosave of it writes the old text back.
function _npCommitMap(key, v) {
  if (!panesActive && currentScene && currentScene.id === key) { currentScene.notes = v; scheduleAutoSave(); return; }
  const col = panesActive ? paneColumnOf(key) : null;
  if (col) sendToPane({ type: 'pane-scene-notes', value: v }, col);
  else sceneStore.updateScene(key, rec => { rec.notes = v; });
  if (_npMap && _npMap.key === key) _npMap.notes = v;
}

// The column's side of a notes edit from the shell.
function paneApplySceneNotes(m) {
  if (!currentScene) return;
  const v = notesSanitize(m.value).text;
  if (v === (currentScene.notes || '')) return;
  currentScene.notes = v;
  scheduleAutoSave();
  drawCursor(lastScreenX, lastScreenY);
}

// ─── A room of a map that is not held ────────────────────────────────────────

// The one way a room's name or notes change from outside its own fields: the open map live, a column through its
// inbox, any other map in its stored record. The room is found by id and the list keeps its order.
function notesRoomPatch(sceneId, roomId, fields) {
  if (!panesActive && currentScene && currentScene.id === sceneId) { roomCardPatch(roomId, fields); return; }
  const col = panesActive ? paneColumnOf(sceneId) : null;
  if (col) { sendToPane({ type: 'pane-room-patch', id: roomId, fields }, col); return; }
  sceneStore.updateScene(sceneId, rec => {
    const p = (rec.polygons || []).find(x => x && x.id === roomId);
    if (!p) return false;
    if (fields.name !== undefined) p.name = sanitizeRoomName(fields.name, t('Room {n}', { n: p.id }));
    if (fields.desc !== undefined) p.desc = sanitizeRoomDesc(fields.desc);
  }).then(refreshRoomPanel);
}

function notesForeignRoom() { return !!_npForeign; }

// roomCard.js hands the fields' commits here while they hold another map's room. True when it took one.
function notesForeignRoomEdit(op, payload) {
  if (!_npForeign) return false;
  const { scene, id } = _npForeign;
  if (op === 'name') { if (payload.value.trim()) notesRoomPatch(scene, id, { name: payload.value }); }
  else if (op === 'desc') notesRoomPatch(scene, id, { desc: payload.value });
  else if (op === 'entry') {
    const cur = (searchRoomsOf(scene) || []).find(x => x.id === id);
    const fill = () => notesRoomPatch(scene, id, { name: payload.entry.title, desc: payload.entry.body });
    if (cur && cur.desc) confirmDialog({ title: 'Replace description?', message: 'This room already has a description. Replacing it with the module text overwrites what you wrote. Keeping yours still applies the name.',
      confirmLabel: 'Replace', cancelLabel: 'Keep mine', danger: true, onConfirm: fill, onCancel: () => notesRoomPatch(scene, id, { name: payload.entry.title }) });
    else fill();
  }
  return true;
}

function _npForeignFill(m) {
  const nameEl = _npEl('rp-name'), descEl = _npEl('rp-desc');
  const name = m.room.name || t('Room {n}', { n: m.tg.id });
  if (!_npForeign || _npForeign.scene !== m.tg.scene || _npForeign.id !== m.tg.id) {
    if (!_npForeign && _rpFieldPid != null) _rpCommitFields();
    _npForeign = { scene: m.tg.scene, id: m.tg.id };
    _rpFieldPid = null;
    _rpTabKey = null;
    nameEl.value = name; descEl.value = m.room.desc || '';
    _rpFitNotes();
    return;
  }
  if (nameEl !== document.activeElement) nameEl.value = name;
  if (descEl !== document.activeElement) descEl.value = m.room.desc || '';
}

function _npForeignLeave() {
  if (!_npForeign) return;
  _npForeign = null;
  _rpFieldPid = null;
  _rpTabKey = null;
}

// ─── The repaint hook ────────────────────────────────────────────────────────

// Which rows of the body show: the room level has its own name row and notes; the rest share a title and a field.
function _npShowLevel(m) {
  const room = m.kind === 'room';
  _npEl('panel-room').hidden = !room;
  _npEl('np-field').hidden = room;
  const title = _npEl('nw-title');
  title.hidden = room;
  title.readOnly = !m.rename;
  _npEl('nw-kind').textContent = t(m.word);
  _npEl('rp-delete').disabled = room && !m.tg.own;
  _npEl('rp-delete').title = room && !m.tg.own ? t('Open the map to delete') : t('Delete room (Del)');
  const mon = _npEl('nw-monster');
  mon.hidden = m.tg.kind !== 'monster';
  if (!mon.hidden) {
    const lore = String(m.block.lore || '').trim();
    _npEl('nw-lore').hidden = !lore;
    _npEl('nw-lore-body').textContent = lore;
  }
}

function notesPanelSync(room) {
  if (!_npEl('nw-crumbs') || isPane) return;
  // ⚠ THE CAMPAIGN MAP COVERS THE SCENE, so its room is not shown.
  const scene = worldMapOpen ? null : _npScene();
  if (worldMapOpen) room = null;
  dockRefreshRail();
  const roomKey = room ? roomTabKey(room) : null;
  if (roomKey !== _npRoomKey) { _npRoomKey = roomKey; notesLevelPick = null; }
  if (_npCalibrating() || !nwIsOpen()) {
    if (_npAim) { _npCommit(); _npAim = null; _npKey = null; }
    _npForeignLeave();
    return;
  }
  let m = null;
  const pick = notesLevelPick && typeof notesLevelPick === 'object' ? notesLevelPick : null;
  if (pick) m = _npMeta(pick, room);
  if (!m) { if (pick) notesLevelPick = null; m = _npMeta(_npFollow(room, scene), room) || _npMeta({ kind: 'campaign' }, room); }
  ntSync(m.key);
  nwShown(m.key, ntPathOf(m));
  _npShowLevel(m);

  if (m.kind === 'room') {
    if (_npAim) { _npCommit(); _npAim = null; }
    if (m.tg.own) _npForeignLeave(); else _npForeignFill(m);
    return;
  }
  _npForeignLeave();
  const aim = { kind: m.tg.kind, id: m.tg.id || '', key: m.key };
  const field = _npEl('np-field'), title = _npEl('nw-title');
  const moved = !_npAim || _npAim.key !== aim.key;
  if (moved && _npAim) _npCommit();
  if (m.notes === null) {   // a map's notes still being read: nothing to edit, nothing to write
    _npAim = null;
    field.value = '';
    field.disabled = true;
    return;
  }
  field.disabled = false;
  if (moved) field.placeholder = t({ campaign: 'Notes for the whole campaign…', place: 'Notes for this group…', road: 'Notes for this road…', map: 'Notes for this map…' }[m.tg.kind] || 'Write here…');
  _npAim = aim;
  if (moved || field !== document.activeElement) {
    if (field.value !== m.notes) field.value = m.notes;
    _npFilled = notesSanitize(m.notes).text;
  }
  if (title !== document.activeElement && title.value !== m.name) title.value = m.name;
  title.dataset.noI18n = '';
}

// What is typed goes to the level it was typed for, and the window forgets it, so a rename that moves
// the notes under it is not undone by the next repaint writing the old text back.
function notesPanelSettle() {
  _npCommit();
  _npAim = null;
  _npKey = null;
}

// The field the cursor is still in, committed before a save that would otherwise miss it: those
// fields commit on blur, and closing the app or switching the scene fires none.
function notesPanelFlush() {
  const a = document.activeElement;
  if (!a) return;
  if (a.id === 'np-field') _npCommit();
  else if (a.id === 'nw-title') _npTitleCommit();
  else if (a.id === 'rp-desc' || a.id === 'rp-name') _rpCommitFields();
}

function notesPanelFollow() {
  if (!notesLevelPick) return;
  notesLevelPick = null;
  refreshRoomPanel();
}

// Shows `target` ({ kind, id, scene? }), or what the selection follows when it is null, and opens the window.
function notesShow(target) {
  notesLevelPick = target;
  nwShow();
  refreshRoomPanel();
}

function _npCalibrating() { return typeof gridCalArmed !== 'undefined' && gridCalArmed; }

// The title renames what is shown, through its owner's own rename path (notesTree.js).
function _npTitleCommit() {
  const el = _npEl('nw-title'), aim = _npAim;
  if (!el || !aim || el.readOnly) return;
  const v = el.value.trim();
  if (!v) { el.value = ntNameOf(aim.key); return; }
  if (v !== ntNameOf(aim.key)) ntRenameKey(aim.key, v);
}

function initNotesPanel() {
  const field = _npEl('np-field');
  if (!field) return;
  _rpWireField(field, { commit: _npCommit, enterCommits: false });
  _rpWireField(_npEl('nw-title'), { commit: _npTitleCommit, enterCommits: true, escapeReverts: true });
  // A monster's notes are one field in two places; the Bestiary page re-reads it the same way.
  field.addEventListener('focus', () => {
    const b = _npAim && _npAim.kind === 'monster' ? cbState.blocks[_npAim.id] : null;
    if (b && field.value !== (b.notes || '')) { field.value = b.notes || ''; _npFilled = field.value; }
  });
  _npEl('nw-stat').addEventListener('click', () => {
    if (_npAim && _npAim.kind === 'monster') { bestiarySetOpen(true); _bsShow(_npAim.id); }
  });
  nwInit();
  ntInit();
  // ⚠ REGISTERED BEFORE index.html's own listeners, which save: the commit has to land first.
  window.addEventListener('beforeunload', notesPanelFlush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) notesPanelFlush(); });
}
