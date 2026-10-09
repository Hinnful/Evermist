'use strict';
// worldMapStore.js — where a scene sits on the world map, which place it belongs to, and its name.
// The ONE writer: the open scene, a column and the store all take the same fields from it. It also owns the
// two renames and the place delete, which every route to them ends in.

// ⚠ A COLUMN SAVES ITS WHOLE RECORD, so a write that reached only the store is reverted by the next
// autosave. The column is told, and saves what it was told.
function worldSceneSet(id, patch) {
  const fields = {};
  const pos = patch.worldPos === undefined ? null : wmCleanPos(patch.worldPos);
  if (pos) fields.worldPos = pos;
  if (patch.group !== undefined) fields.group = sanitizeGroupName(patch.group);
  if (typeof patch.name === 'string') fields.name = patch.name;
  if (!Object.keys(fields).length) return Promise.resolve();
  const entry = allScenes.find(s => s.id === id);
  if (entry) Object.assign(entry, fields);
  if (currentScene && currentScene.id === id) Object.assign(currentScene, fields);
  const column = panesActive ? paneColumnOf(id) : null;
  if (column) sendToPane({ type: 'pane-scene-place', ...fields }, column);
  return sceneStore.updateScene(id, rec => {
    const same = (!fields.worldPos || (rec.worldPos && rec.worldPos.x === fields.worldPos.x && rec.worldPos.y === fields.worldPos.y)) &&
                 (fields.group === undefined || sanitizeGroupName(rec.group) === fields.group) &&
                 (fields.name === undefined || rec.name === fields.name);
    if (same) return false;
    Object.assign(rec, fields);
  }).catch(console.error);
}

// The column's side of worldSceneSet.
function paneApplyScenePlace(m) {
  if (!currentScene) return;
  const pos = wmCleanPos(m.worldPos);
  if (pos) currentScene.worldPos = pos;
  if (typeof m.group === 'string') currentScene.group = sanitizeGroupName(m.group);
  if (typeof m.name === 'string') currentScene.name = m.name;
  scheduleAutoSave();
}

// Every scene with no position gets one, written once to the store.
function worldEnsurePositions() {
  const plan = wmPlanPositions(allScenes);
  for (const id of Object.keys(plan)) worldSceneSet(id, { worldPos: plan[id] });
}

// The one way a scene is renamed: the world map's text ends here.
function renameScene(id, name) {
  const v = String(name || '').replace(/\s+/g, ' ').trim() || 'Untitled';
  worldSceneSet(id, { name: v });
  updateTriggerName();
  return v;
}

// The one way a group (a place) is renamed: its scenes follow, and so do its notes.
function renameGroup(from, to) {
  const a = sanitizeGroupName(from);
  notesPanelSettle();
  const final = renameGroupInOrder(a, to);
  for (const s of allScenes.filter(x => sanitizeGroupName(x.group) === a)) worldSceneSet(s.id, { group: final });
  notesPlacesWrite(notesRenamePlace(notesPlacesAll(), a, final).map);
  worldShapeRename(a, final);
  if (worldMapSel.place === a) worldMapSel.place = final;
  if (typeof refreshRoomPanel === 'function') refreshRoomPanel();
  sceneListChanged();
  return final;
}

// ⚠ A NAME ANOTHER PLACE WEARS IS REFUSED: a merge would drop one outline and leave its scenes on bare ground.
function renameGroupAsking(from, next) {
  if (!worldPlaceByName(next) && !knownGroupNames().some(n => n !== from && n === next)) { renameGroup(from, next); return; }
  messageDialog({ title: 'Nothing changed', message: t('There is already a place called “{name}”. Pick another name.', { name: next }) });
}

// Deletes the place, never the maps: its scenes are left with no place. Ctrl+Z brings back the place, its
// roads' ends and its notes, so it asks nothing.
function deleteGroup(sec) {
  worldUndoPush();
  forgetGroup(sec.name);
  worldShapeDelete(sec.name);
  notesPlaceSet(sec.name, '');
  for (const s of sec.scenes) worldSceneSet(s.id, { group: '' });
  sceneListChanged();
}
