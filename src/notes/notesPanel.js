'use strict';
// notesPanel.js — the left panel: breadcrumbs, and the notes of the campaign, the scene or the room.
//
// The room's own field (#rp-desc) and its pictures live inside this panel, but their logic stays in
// roomCard.js and roomPictures.js. The level shown is derived each repaint: the room if one is
// selected, a crumb the DM clicked, otherwise the scene. A scene in a group has a Place level between
// the campaign and itself. With the world map up the panel follows what is picked there instead.

const NOTES_OPEN_KEY = 'evermist.notesPanelOpen';
const NOTES_CAMPAIGN_KEY = 'evermist.campaignNotes';
const NOTES_WIDTH_KEY = 'evermist.notesWidth';
const NOTES_PLACES_KEY = 'evermist.placeNotes';
const NOTES_ROADS_KEY = 'evermist.roadNotes';
const NOTES_MIN_W = 220, NOTES_MAX_W = 420;   // the pane, in the panel's pre-zoom px

// Where the scene/campaign field's text goes when it commits: filled for one level of one scene
// (and one column), and written back there however the selection has moved since.
let _npAim = null;
let _npFilled = '';              // the text the field was filled with, so a column is sent only an edit
let _npKey = null;
let _npOpen = true;
let _npWantW = NOTES_MIN_W;
let _npShown = false;
let _npHadRoom = false;
let _npRoomKey = null;

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
  try { localStorage.setItem(NOTES_PLACES_KEY, JSON.stringify(map)); return true; } catch (_) { return false; }
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
  try { localStorage.setItem(NOTES_ROADS_KEY, JSON.stringify(map)); return true; } catch (_) { return false; }
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

// The scene whose notes the panel shows: this window's, or the selected column's in two-map mode.
function _npScene() {
  if (isPane) return null;
  if (panesActive) return paneSelectedScene();
  return currentScene ? { key: currentScene.id, name: currentScene.name, notes: currentScene.notes || '' } : null;
}

// The place the panel shows: the world map's pick while it is up, else the shown scene's own group.
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
function _npLevel(room, place, road) {
  const have = worldMapOpen ? (road ? ['campaign', 'road'] : place ? ['campaign', 'place'] : ['campaign'])
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
  } else if (aim.pane) {
    // ⚠ THE SHELL'S COPY OF A COLUMN'S SCENE LAGS: until the column reports, the field holds the scene
    // it showed before, and sending that unedited text would write it over the new scene's notes.
    if (v !== _npFilled) { sendToPane({ type: 'pane-scene-notes', value: v }, aim.pane); _npFilled = v; }
  } else if (currentScene && currentScene.id === aim.sceneKey) {
    if (v !== (currentScene.notes || '')) { currentScene.notes = v; scheduleAutoSave(); }
  }
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
  const panel = _npEl('notes-panel');
  if (!panel || isPane) return;
  // ⚠ THE WORLD MAP COVERS THE SCENE, so its room and its notes are not shown, and the panel shows
  // with no scene open at all.
  const scene = worldMapOpen ? null : _npScene();
  if (worldMapOpen) room = null;
  if ((!scene && !worldMapOpen) || _npCalibrating()) {
    if (_npAim) { _npCommit(); _npAim = null; _npKey = null; }
    _npApplyVisible();
    return;
  }
  // Picking a room opens a shut panel without changing what the DM chose to keep.
  if (room && !_npHadRoom && !_npOpen) _npSetOpen(true, true);
  _npHadRoom = !!room;
  _npApplyVisible();
  const roomKey = room ? roomTabKey(room) : null;
  if (roomKey !== _npRoomKey) { _npRoomKey = roomKey; notesLevelPick = null; }
  const place = _npPlace(scene), road = _npRoad();
  const level = _npLevel(room, place, road);

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
  const aim = { level, pane, sceneKey, place: level === 'place' ? place : '', road: level === 'road' ? road.uid : '' };
  const moved = !_npAim || _npAim.level !== level || _npAim.pane !== pane || _npAim.sceneKey !== sceneKey || _npAim.place !== aim.place || _npAim.road !== aim.road;
  if (moved) {
    if (_npAim) _npCommit();
    field.placeholder = t(level === 'campaign' ? 'Notes for the whole campaign…' : level === 'place' ? 'Notes for this place…' : level === 'road' ? 'Notes for this road…' : 'Notes for this scene…');
  }
  _npAim = aim;
  if (moved || field !== document.activeElement) {
    const v = level === 'campaign' ? notesCampaignGet() : level === 'place' ? notesPlaceGet(place) : level === 'road' ? notesRoadGet(road.uid) : scene.notes;
    if (field.value !== v) field.value = v;
    _npFilled = notesSanitize(v).text;
  }
}

// What is typed goes to the level it was typed for, and the panel forgets it, so a rename that moves
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

// ─── Showing, width, and the minimap beside it ───────────────────────────────

function _npCalibrating() { return typeof gridCalArmed !== 'undefined' && gridCalArmed; }

// The panel while it is open, the floating icon while it is shut, neither with no scene.
function _npApplyVisible() {
  const away = (!worldMapOpen && !_npScene()) || _npCalibrating();
  _npEl('notes-panel').hidden = away || !_npOpen;
  _npEl('np-fab').hidden = away || _npOpen;
  _npLayoutIfMoved(!_npEl('notes-panel').hidden);
}

// The ui zoom as the browser applied it, off a borderless button of the panel or the icon.
function _npZoom() {
  for (const id of ['np-toggle', 'np-fab']) {
    const b = _npEl(id);
    if (b && b.offsetWidth > 0) return b.getBoundingClientRect().width / b.offsetWidth;
  }
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')) || 1;
}

// ⚠ THE TOOLBAR NEVER MOVES (dock.js): the pane stops where the minimap beside it meets the toolbar's
// left edge, and only its narrowest width goes past.
function _npMaxW() {
  const z = _npZoom();
  const room = window.innerWidth / 2 - _dockBarW() / 2 - DOCK_TOOLBAR_GAP - (168 + 16) * z;
  return Math.max(NOTES_MIN_W, Math.min(NOTES_MAX_W, room / z));
}

// Sets the pane's width, then hands the minimap the edge it sits against. The minimap moves with the
// panel, so opening or shutting one moves the other.
function _npLayout() {
  const panel = _npEl('notes-panel');
  if (!panel) return;
  panel.style.setProperty('--np-pane-w', Math.max(NOTES_MIN_W, Math.min(_npMaxW(), _npWantW)) + 'px');
  const right = panel.hidden ? 0 : panel.getBoundingClientRect().right / _npZoom();
  document.documentElement.style.setProperty('--np-right', right + 'px');
}

function _npLayoutIfMoved(shown) {
  if (shown === _npShown) return;
  _npShown = shown;
  _npLayout();
}

function _npInitEdge(edge, panel) {
  edge.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    const z = _npZoom(), x0 = e.clientX, w0 = panel.offsetWidth;
    panel.classList.add('resizing');
    const move = m => { _npWantW = w0 + (m.clientX - x0) / z; _npLayout(); };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      panel.classList.remove('resizing');
      try { localStorage.setItem(NOTES_WIDTH_KEY, String(Math.round(_npWantW))); } catch (_) {}
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}

// `transient` opens without remembering it, for a room pick.
function _npSetOpen(open, transient) {
  _npOpen = open;
  if (!transient) { try { localStorage.setItem(NOTES_OPEN_KEY, open ? '1' : '0'); } catch (_) {} }
  _npApplyVisible();
  _npLayout();
  if (open) _rpFitNotes();
}

function initNotesPanel() {
  const panel = _npEl('notes-panel');
  if (!panel) return;
  panel.addEventListener('mousedown', e => e.stopPropagation());
  _npEl('np-fab').addEventListener('mousedown', e => e.stopPropagation());
  const field = _npEl('np-field');
  _rpWireField(field, { commit: _npCommit, enterCommits: false });
  for (const id of ['np-toggle', 'np-fab']) _npEl(id).addEventListener('click', () => _npSetOpen(!_npOpen));
  try { _npWantW = parseFloat(localStorage.getItem(NOTES_WIDTH_KEY)) || NOTES_MIN_W; } catch (_) {}
  _npInitEdge(_npEl('np-edge'), panel);
  new ResizeObserver(_npLayout).observe(document.documentElement);
  try { _npOpen = localStorage.getItem(NOTES_OPEN_KEY) !== '0'; } catch (_) {}
  initRoomPictures(panel);
  // ⚠ REGISTERED BEFORE index.html's own listeners, which save: the commit has to land first.
  window.addEventListener('beforeunload', notesPanelFlush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) notesPanelFlush(); });
}
