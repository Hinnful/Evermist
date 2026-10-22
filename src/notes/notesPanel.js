'use strict';
// notesPanel.js — the Notes pane of the dock: breadcrumbs, and the notes of the campaign, a place, the scene or the room.
//
// The room's own field (#rp-desc) lives inside this pane, but its logic stays in roomCard.js.
// The level shown is derived each repaint: the room if one is selected, a crumb the DM clicked, otherwise the scene. A scene in a group has a Place level between
// the campaign and itself. With the world map up the pane follows what is picked there instead.

const NOTES_CAMPAIGN_KEY = 'evermist.campaignNotes';
const NOTES_PLACES_KEY = 'evermist.placeNotes';
const NOTES_ROADS_KEY = 'evermist.roadNotes';

// Where the scene/campaign field's text goes when it commits: filled for one level of one scene
// (and one column), and written back there however the selection has moved since.
let _npAim = null;
let _npFilled = '';              // the text the field was filled with, so a column is sent only an edit
let _npKey = null;
let _npRoomKey = null;
let _npPickedKey = null;         // the room last picked on the scene, for the dock's room-pick rule
let _npWorld = null;             // { key, notes }: the stored notes of the map picked on the Campaign, read once per pick
let _npWorldLoading = null;      // the map id being read

function _npEl(id) { return document.getElementById(id); }

// ─── Campaign notes ──────────────────────────────────────────────────────────

function notesCampaignGet() {
  try { return localStorage.getItem(NOTES_CAMPAIGN_KEY) || ''; } catch (_) { return ''; }
}

function notesCampaignSet(text) {
  try { localStorage.setItem(NOTES_CAMPAIGN_KEY, text); return true; } catch (_) { return false; }
}

// ─── Place notes ─────────────────────────────────────────────────────────────

function notesPlacesAll() {
  try { return notesPlacesClean(JSON.parse(localStorage.getItem(NOTES_PLACES_KEY) || '{}')).places; }
  catch (_) { return notesPlacesNew(); }
}

function notesPlacesWrite(map) {
  try { localStorage.setItem(NOTES_PLACES_KEY, JSON.stringify(map)); } catch (_) { return false; }
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
  try { return notesPlacesClean(JSON.parse(localStorage.getItem(NOTES_ROADS_KEY) || '{}')).places; }
  catch (_) { return notesPlacesNew(); }
}

function notesRoadsWrite(map) {
  try { localStorage.setItem(NOTES_ROADS_KEY, JSON.stringify(map)); } catch (_) { return false; }
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

// The scene whose notes the pane shows: this window's, or the selected column's in two-map mode.
function _npScene() {
  if (isPane) return null;
  if (panesActive) return paneSelectedScene();
  return currentScene ? { key: currentScene.id, name: currentScene.name, notes: currentScene.notes || '' } : null;
}

// The map picked on the Campaign, open or not: its notes come off the stored record, so the first sync after a
// pick answers null and the pane repaints when the read lands. A map a column holds is saved first.
function _npWorldScene() {
  const id = worldMapSel.sceneId, s = id && allScenes.find(x => x.id === id);
  if (!s) { _npWorld = null; return null; }
  if (!panesActive && currentScene && currentScene.id === id) return { key: id, name: s.name, notes: currentScene.notes || '' };
  if (_npWorld && _npWorld.key === id) return { key: id, name: s.name, notes: _npWorld.notes };
  if (_npWorldLoading === id) return null;
  _npWorldLoading = id;
  const held = panesActive ? paneColumnOf(id) : null;
  (held ? flushPaneScene(held) : Promise.resolve()).then(() => sceneStore.loadScene(id)).then(rec => {
    if (_npWorldLoading !== id) return;
    _npWorldLoading = null;
    _npWorld = { key: id, notes: notesSanitize(rec && rec.notes).text };
    if (worldMapOpen && worldMapSel.sceneId === id) refreshRoomPanel();
  }).catch(() => { if (_npWorldLoading === id) _npWorldLoading = null; });
  return null;
}

// The place the pane shows: the world map's pick while it is up, else the shown scene's own group.
function _npPlace(scene) {
  if (worldMapOpen) return worldMapPlaceName();
  if (!scene) return '';
  const s = allScenes.find(x => x.id === scene.key);
  return s ? sanitizeGroupName(s.group) : '';
}

// The road the world map has picked, or the road holding the scene it has picked: { uid, name } or null.
function _npRoad() {
  if (!worldMapOpen) return null;
  const r = worldRoadByUid(worldMapRoadKey());
  return r ? { uid: r.uid, name: r.name } : null;
}

// A pick that names a crumb that is not there (the scene left its place) falls back to following. A road
// and a place never show together: a road's scene is in no place.
function _npLevel(room, place, road, world) {
  const have = worldMapOpen ? (road ? ['campaign', 'road'] : place ? ['campaign', 'place'] : ['campaign']).concat(world ? ['scene'] : [])
    : ['campaign', ...(place ? ['place'] : []), 'scene', ...(room ? ['room'] : [])];
  if (notesLevelPick && have.includes(notesLevelPick)) return notesLevelPick;
  if (worldMapOpen) return road ? 'road' : place ? 'place' : 'campaign';
  return room ? 'room' : 'scene';
}

// ─── Committing ──────────────────────────────────────────────────────────────

function _npCommit() {
  const aim = _npAim, el = _npEl('np-field');
  if (!aim || !el) return;
  const v = notesSanitize(el.value).text;
  el.value = v;
  if (aim.level === 'campaign') {
    if (v !== notesCampaignGet()) notesCampaignSet(v);
  } else if (aim.level === 'place') {
    if (v !== notesPlaceGet(aim.place)) notesPlaceSet(aim.place, v);
  } else if (aim.level === 'road') {
    if (v !== notesRoadGet(aim.road)) notesRoadSet(aim.road, v);
  } else if (aim.world) {
    if (v !== _npFilled) _npCommitWorldScene(aim.sceneKey, v);
    _npFilled = v;
  } else if (aim.pane) {
    // ⚠ THE SHELL'S COPY OF A COLUMN'S SCENE LAGS: until the column reports, the field holds the scene
    // it showed before, and sending that unedited text would write it over the new scene's notes.
    if (v !== _npFilled) { sendToPane({ type: 'pane-scene-notes', value: v }, aim.pane); _npFilled = v; }
  } else if (currentScene && currentScene.id === aim.sceneKey) {
    if (v !== (currentScene.notes || '')) { currentScene.notes = v; scheduleAutoSave(); }
  }
}

// A map picked on the Campaign: written where its live copy is, as when it is open.
function _npCommitWorldScene(key, v) {
  if (!panesActive && currentScene && currentScene.id === key) { currentScene.notes = v; scheduleAutoSave(); return; }
  const col = panesActive ? paneColumnOf(key) : null;
  if (col) sendToPane({ type: 'pane-scene-notes', value: v }, col);
  else sceneStore.updateScene(key, rec => { rec.notes = v; });
  if (_npWorld && _npWorld.key === key) _npWorld.notes = v;
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

// ─── Crumbs ──────────────────────────────────────────────────────────────────

// A crumb only picks the level shown. The selection, and so the room's crumb, stays as it is.
function _npCrumbClick(level) {
  notesLevelPick = level === 'room' ? null : level;
  refreshRoomPanel();
}

function _npDrawCrumbs(scene, place, road, room, level) {
  const box = _npEl('np-crumbs');
  box.textContent = '';
  const add = (lv, label, mine) => {
    if (box.childNodes.length) {
      const sep = document.createElement('span');
      sep.className = 'np-sep';
      sep.textContent = '›';
      box.appendChild(sep);
    }
    const b = document.createElement('button');
    b.className = 'np-crumb' + (lv === level ? ' on' : '');
    b.textContent = label;
    b.title = label;   // the full name, for a crumb the width cut short
    if (mine) b.dataset.noI18n = '';
    b.dataset.level = lv;
    b.addEventListener('click', () => _npCrumbClick(lv));
    box.appendChild(b);
  };
  const names = { campaign: t('Campaign'), place: place || null, road: road ? road.name : null, scene: scene ? scene.name : null,
                  room: room ? (room.name != null ? room.name : _rpFallbackName(room)) : null };
  for (const c of notesCrumbs(names)) add(c.level, c.label, c.level !== 'campaign');
}

// ─── The repaint hook ────────────────────────────────────────────────────────

// From refreshRoomPanel on every repaint, with the selected room or null.
function notesPanelSync(room) {
  if (!_npEl('np-crumbs') || isPane) return;
  // ⚠ THE WORLD MAP COVERS THE SCENE, so its room and its notes are not shown, and the pane works
  // with no scene open at all.
  const scene = worldMapOpen ? _npWorldScene() : _npScene();
  if (!worldMapOpen) { _npWorld = null; _npWorldLoading = null; }
  if (worldMapOpen) room = null;
  if ((!scene && !worldMapOpen) || _npCalibrating()) {
    if (_npAim) { _npCommit(); _npAim = null; _npKey = null; }
    dockRefreshRail();
    return;
  }
  // A new room, or a switch from one room to another, brings the Notes up (dock.js).
  if (!worldMapOpen) {
    const pk = room ? roomTabKey(room) : null;
    if (pk !== null && pk !== _npPickedKey) dockRoomPicked();
    _npPickedKey = pk;
  }
  dockRefreshRail();
  const roomKey = room ? roomTabKey(room) : null;
  if (roomKey !== _npRoomKey) { _npRoomKey = roomKey; notesLevelPick = null; }
  const place = _npPlace(scene), road = _npRoad();
  const level = _npLevel(room, place, road, worldMapOpen && !!scene);

  const key = [scene ? scene.name : '', place, road ? road.uid + road.name : '', level, room ? room.name : ''].join('\u0001');
  if (key !== _npKey) { _npKey = key; _npDrawCrumbs(scene, place, road, room, level); }
  _npEl('panel-room').hidden = level !== 'room';
  const field = _npEl('np-field');
  field.hidden = level === 'room';

  if (level === 'room') {
    if (_npAim) { _npCommit(); _npAim = null; }
    return;
  }
  const pane = panesActive ? panesSelected : null;
  const sceneKey = scene ? scene.key : null;
  const aim = { level, pane: worldMapOpen ? null : pane, world: worldMapOpen && level === 'scene', sceneKey, place: level === 'place' ? place : '', road: level === 'road' ? road.uid : '' };
  const moved = !_npAim || _npAim.level !== level || _npAim.world !== aim.world || _npAim.pane !== aim.pane || _npAim.sceneKey !== sceneKey || _npAim.place !== aim.place || _npAim.road !== aim.road;
  if (moved) {
    if (_npAim) _npCommit();
    field.placeholder = t(level === 'campaign' ? 'Notes for the whole campaign…' : level === 'place' ? 'Notes for this group…' : level === 'road' ? 'Notes for this road…' : 'Notes for this map…');
  }
  _npAim = aim;
  if (moved || field !== document.activeElement) {
    const v = level === 'campaign' ? notesCampaignGet() : level === 'place' ? notesPlaceGet(place) : level === 'road' ? notesRoadGet(road.uid) : scene.notes;
    if (field.value !== v) field.value = v;
    _npFilled = notesSanitize(v).text;
  }
}

// What is typed goes to the level it was typed for, and the pane forgets it, so a rename that moves
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
  else if (a.id === 'rp-desc' || a.id === 'rp-name') _rpCommitFields();
}

function notesPanelFollow() {
  if (!notesLevelPick) return;
  notesLevelPick = null;
  refreshRoomPanel();
}

// ─── Showing ─────────────────────────────────────────────────────────────────

function _npCalibrating() { return typeof gridCalArmed !== 'undefined' && gridCalArmed; }

function initNotesPanel() {
  const field = _npEl('np-field');
  if (!field) return;
  _rpWireField(field, { commit: _npCommit, enterCommits: false });
  // The room's field grows with its text, which needs the pane on screen to measure.
  document.addEventListener('dockpane', e => { if (e.detail === 'notes') _rpFitNotes(); });
  // ⚠ REGISTERED BEFORE index.html's own listeners, which save: the commit has to land first.
  window.addEventListener('beforeunload', notesPanelFlush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) notesPanelFlush(); });
}
