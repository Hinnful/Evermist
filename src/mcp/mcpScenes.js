'use strict';
// mcpScenes.js — Claude's scene tools: find map files, make a scene from one, rename, move, change and delete.
// ⚠ NOTHING HERE OPENS A SCENE OR REACHES THE TV. A change to a map's fog or grid goes through mcpEditMap
// (mcpMapEdit.js); a delete leaves alone the scene the DM has open or the TV shows.

// Where a new card goes: inside the place's outline, or clear of every place and card when `place` is ''.
// Null when the place has no outline or no room left. `skip` is the ids of scenes being placed.
function _mcpSpot(place, skip) {
  const others = allScenes.filter(s => !skip.has(s.id) && wmCleanPos(s.worldPos));
  if (place) {
    const rec = worldPlaceByName(place);
    if (!rec) return null;
    const inside = others.filter(s => sanitizeGroupName(s.group) === place).map(s => wmCardRect(s.worldPos));
    return wmSpotInOutline(wmOutline(rec), inside);
  }
  const taken = [...worldPlaceRecords().map(r => wmPolyBounds(wmOutline(r))), ...others.map(s => wmCardRect(s.worldPos))];
  const r = mcpFreeRect(taken, WM_CARD_W, WM_CARD_H);
  return { x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2) };
}

// A place named in a call: its name as the app has it, '' for none, or { error }.
function _mcpPlaceArg(raw) {
  if (!raw) return { name: '' };
  const name = _mcpPlaceName(raw);
  return name ? { name } : { error: 'No group is called "' + raw + '". Use create_place to make one.' };
}

// Scenes taken out for good: the list, the road ends, the store and an animated map's file.
async function _mcpRemoveScenes(ids) {
  if (panesActive && ids.some(id => paneColumnOf(id))) throw new Error('A map is open in a column. Ask the DM to close the column first.');
  commitPendingDelete();
  const gone = new Set(ids);
  allScenes = allScenes.filter(s => !gone.has(s.id));
  if (currentScene && gone.has(currentScene.id)) handleCurrentDeleted();
  worldRoadsSceneGone(ids);
  for (const id of ids) {
    await sceneStore.deleteScene(id);
    if (window.electronAPI) await window.electronAPI.deleteVideoFile(id).catch(() => {});
  }
  sceneListChanged();
}

async function _mcpFind(args) {
  const files = await window.electronAPI.findMapFiles(String(args.query || ''));
  if (!files.length) return _mcpOk('No image, video or zip' + (args.query ? ' named like "' + args.query + '"' : '') + ' in Downloads, Desktop, Documents or Pictures.');
  return _mcpOk(files.map(f => ({ path: f.path, name: f.name, kind: f.kind, sizeMB: Math.round(f.size / 1048576 * 10) / 10, modified: f.modified })));
}

async function _mcpCreateScene(args) {
  const place = _mcpPlaceArg(args.place);
  if (place.error) return _mcpNo(place.error);
  const read = await window.electronAPI.readMapFiles(String(args.path || ''));
  if (read.error) return _mcpNo(read.error);
  if (!read.files.length) return _mcpNo('No map was made: ' + read.skipped.map(s => '"' + s.name + '" ' + s.reason).join(' '));
  const snap = worldSnapshotTake();
  const files = read.files.map(f => new File([f.bytes], f.name, { type: f.type }));
  const done = await addMapsToLibrary(files, { x: 0, y: 0 }, true);
  const ids = done.ids;
  if (!ids.length) return _mcpNo('No map was made: ' + done.failures.join(' '));
  const skip = new Set(ids);
  const spots = [];
  for (const id of ids) {
    const at = _mcpSpot(place.name, skip);
    if (!at) break;
    await worldSceneSet(id, { worldPos: at, group: place.name });
    skip.delete(id);
    spots.push(id);
  }
  // A card with no spot stays where the import dropped it, filed under the place all the same.
  for (const id of ids.filter(i => !spots.includes(i))) await worldSceneSet(id, { group: place.name });
  const made = ids.map(id => allScenes.find(s => s.id === id));
  if (args.name && made.length === 1) renameScene(ids[0], args.name);
  worldAssignAll();
  sceneListChanged();
  const names = made.map(s => '"' + s.name + '"');
  const left = [...read.skipped.map(s => '"' + s.name + '" ' + s.reason), ...done.failures];
  const crowded = spots.length < ids.length ? ' The group had no free spot for ' + (ids.length - spots.length) + ' of them; the DM can drag them into position.' : '';
  return mcpDone('created ' + names.join(', '), async () => { await _mcpRemoveScenes(ids); worldSnapshotPut(snap); },
    'Created ' + names.join(', ') + (place.name ? ' in the group "' + place.name + '"' : ' in no group') + '. The DM has not opened it and the TV does not show it. It starts fully fogged with no rooms.' + crowded + (left.length ? ' Not made: ' + left.join(' ') : ''));
}

async function _mcpRename(args) {
  const found = _mcpScene(args);
  if (found.error) return _mcpNo(found.error);
  const s = found.scene, old = s.name;
  if (!String(args.newName || '').trim()) return _mcpNo('A map needs a name.');
  const now = renameScene(s.id, args.newName);
  return mcpDone('renamed the map "' + old + '" to "' + now + '"', async () => { renameScene(s.id, old); }, 'Renamed the map "' + old + '" to "' + now + '".');
}

// The card's centre exactly there: a road it lands on takes it, and its group follows from the outlines.
async function _mcpMoveExact(s, spot, toPlace) {
  if (toPlace) return _mcpNo('Give toPlace or an exact x and y, not both: the group follows from where the card lands.');
  const snap = worldSnapshotTake();
  const landed = worldRoadsSettleScene(s.id, spot);
  await worldSceneSet(s.id, { worldPos: landed });
  worldAssignAll();
  worldRoadsSave();
  _mcpWorldRefresh();
  const now = sanitizeGroupName(allScenes.find(x => x.id === s.id).group);
  return mcpDone('moved the map "' + s.name + '"', async () => { worldSnapshotPut(snap); _mcpWorldRefresh(); },
    'Moved the map "' + s.name + '" to ' + landed.x + ',' + landed.y + ' on the Campaign. It is ' + (now ? 'in the group "' + now + '"' : worldRoadOfScene(s.id) ? 'on a road' : 'in no group') + '.');
}

async function _mcpMove(args) {
  const found = _mcpScene(args);
  if (found.error) return _mcpNo(found.error);
  const exact = mcpSpotArg(args);
  if (exact.error) return _mcpNo(exact.error);
  if (exact.at) return _mcpMoveExact(found.scene, exact.at, args.toPlace);
  const place = _mcpPlaceArg(args.toPlace);
  if (place.error) return _mcpNo(place.error);
  const s = found.scene;
  const at = _mcpSpot(place.name, new Set([s.id]));
  if (!at) return _mcpNo(place.name ? 'The group "' + place.name + '" has no free spot for the map. Reshape it bigger first.' : 'No free spot on the Campaign.');
  const snap = worldSnapshotTake();
  await worldSceneSet(s.id, { worldPos: at, group: place.name });
  _mcpWorldRefresh();
  return mcpDone('moved the map "' + s.name + '"', async () => { worldSnapshotPut(snap); _mcpWorldRefresh(); },
    'Moved the map "' + s.name + '" ' + (place.name ? 'into the group "' + place.name + '"' : 'out of its group') + '.');
}

// What stops a call from touching a scene's record: the TV shows it, or the DM window holds it open.
function _mcpScenePinned(scene, what) {
  const tv = _mcpTvRefuse(scene, what);
  if (tv) return tv;
  return _mcpHolder(scene.id) ? _mcpNo('Not done: the DM has "' + scene.name + '" open, and ' + what + ' would change it under them. Ask the DM to open another map first.') : null;
}

async function _mcpSetScene(args) {
  const found = _mcpScene(args);
  if (found.error) return _mcpNo(found.error);
  const s = found.scene;
  const hex = args.fogColor === undefined ? undefined : mcpCleanHex(args.fogColor);
  const size = args.gridCellSize === undefined ? undefined : mcpGridSize(args.gridCellSize);
  if (hex === null) return _mcpNo('fogColor must be a hex colour such as #8899aa.');
  if (size === null) return _mcpNo('gridCellSize must be a whole number of map pixels from 10 to 400.');
  if (hex === undefined && size === undefined) return _mcpNo('Nothing to change: give fogColor or gridCellSize.');
  const parts = [hex && 'fogSettings', size && 'grid'].filter(Boolean);
  const edit = await mcpEditMap(s, 'changing its ' + [hex && 'fog colour', size && 'grid'].filter(Boolean).join(' and '), parts, d => {
    if (hex) d.fogSettings.pickedHex = hex;
    if (size) d.gridConfig.cellSize = size;
  });
  if (edit.no) return edit.no;
  const said = [hex && 'fog colour ' + hex, size && 'grid cell size ' + size + ' px'].filter(Boolean).join(' and ');
  const open = _mcpHolder(s.id) === 'here' ? ' The DM has it open and sees the change now.' : '';
  return mcpDone('set the ' + said + ' of the map "' + s.name + '"', edit.undo, 'Set the ' + said + ' of the map "' + s.name + '".' + open);
}

async function _mcpDeleteScene(args) {
  const found = _mcpScene(args);
  if (found.error) return _mcpNo(found.error);
  const s = found.scene;
  const pinned = _mcpScenePinned(s, 'deleting it');
  if (pinned) return pinned;
  const rec = await sceneStore.loadScene(s.id);
  if (!rec) return _mcpNo('The map "' + s.name + '" is no longer in the library.');
  if (rec.mapType === 'video') return _mcpNo('Not deleted: "' + s.name + '" is an animated map, and Claude cannot bring one back after deleting it. Ask the DM to delete it in Evermist.');
  if (args.confirmed !== true) return _mcpOk(mcpWouldDelete('scene', { name: s.name, rooms: (rec.polygons || []).length }));
  const index = allScenes.findIndex(x => x.id === s.id), meta = { ...allScenes[index] }, snap = worldSnapshotTake();
  await _mcpRemoveScenes([s.id]);
  return mcpDone('deleted the map "' + s.name + '"', async () => {
    await sceneStore.saveScene(rec);
    allScenes.splice(Math.min(index, allScenes.length), 0, meta);
    allScenes.forEach((x, i) => { x.sortOrder = i; });
    persistSceneOrder();
    worldSnapshotPut(snap);
    sceneListChanged();
  }, 'Deleted the map "' + s.name + '" with its map, fog and rooms.');
}

const MCP_SCENES_TOOLS = { find_map_files: _mcpFind, create_scene: _mcpCreateScene, rename_scene: _mcpRename,
  move_scene: _mcpMove, set_scene: _mcpSetScene, delete_scene: _mcpDeleteScene };
