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

// Scenes taken out of the list, their road ends opened, and moved into the Trash with an animated map's file, where
// the DM can restore them for 30 days: a delete, and the undo of Claude's own create, copy or import.
async function _mcpRemoveScenes(ids) {
  if (panesActive && ids.some(id => paneColumnOf(id))) throw new Error('A map is open in a column. Ask the DM to close the column first.');
  // Only a delete of one of these ends the DM's undo window; another stays theirs to take back.
  if (smPending && smPending.ids.some(id => ids.includes(id))) commitPendingDelete();
  const gone = new Set(ids);
  allScenes = allScenes.filter(s => !gone.has(s.id));
  if (currentScene && gone.has(currentScene.id)) handleCurrentDeleted();
  const roads = sceneTrash.roadsOf(ids);
  worldRoadsSceneGone(ids);
  await sceneTrash.put(ids, Date.now(), roads);
  sceneListChanged();
}

// ⚠ A MAP CLAUDE MADE BECOMES THE DM'S ONCE THEY OPEN IT. Undoing its creation goes to the Trash with their work,
// and while it is open, in a column or on the TV (Manual keeps the last map sent) it is refused and the step kept.
function mcpRefuseRemovingOpen(ids, what) {
  const open = allScenes.find(x => ids.includes(x.id) && _mcpHolder(x.id));
  if (open) throw Object.assign(new Error('Not undone: the DM has "' + open.name + '" open, and ' + what + ' would take it away. Ask the DM to open another map first.'), { mcpKeep: true });
  const tv = allScenes.find(x => ids.includes(x.id) && _mcpOnTv(x.id));
  if (tv) throw Object.assign(new Error('Not undone: the TV shows "' + tv.name + '", and ' + what + ' would take it off the players\' screen. Ask the DM to send another map to the TV first.'), { mcpKeep: true });
}

// What an undone create or copy says: where the maps went.
const _mcpTrashed = names => (names.length > 1 ? names.join(', ') + ' are in the Trash, where the DM can restore them' : names[0] + ' is in the Trash, where the DM can restore it') + ' for 30 days.';

async function _mcpFind(args) {
  const files = await window.electronAPI.findMapFiles(String(args.query || ''));
  if (!files.length) return _mcpOk('No image, video or zip' + (args.query ? ' named like "' + args.query + '"' : '') + ' in Downloads, Desktop, Documents or Pictures.');
  return _mcpOk(files.map(f => ({ path: f.path, name: f.name, kind: f.kind, sizeMB: Math.round(f.size / 1048576 * 10) / 10, modified: f.modified })));
}

async function _mcpCreateScene(args) {
  const place = _mcpPlaceArg(args.place);
  if (place.error) return _mcpNo(place.error);
  const read = await window.electronAPI.listMapFolder(String(args.path || ''));
  if (read.error) return _mcpNo(read.error);
  if (!read.files.length) return _mcpNo('No map was made: ' + read.skipped.map(s => '"' + s.name + '" ' + s.reason).join(' '));
  const snap = worldSnapshotTake();
  // ⚠ ONE MAP CROSSES IPC AND SITS IN THIS WINDOW AT A TIME. A folder's maps in one message froze the page and
  // killed it past about 500 MB (docs/decisions/storage-and-packaging.md).
  const dropAt = wmSideBySide(0, 0, read.files.length);
  const done = { ids: [], failures: [] };
  for (let i = 0; i < read.files.length; i++) {
    const one = await window.electronAPI.readMapFiles(read.files[i].path);
    const f = one.files && one.files[0];
    if (!f) { read.skipped.push({ name: read.files[i].name, reason: (one.skipped && one.skipped[0] && one.skipped[0].reason) || 'could not be read.' }); continue; }
    const r = await addMapsToLibrary([new File([f.bytes], f.name, { type: f.type })], dropAt[i], true);
    done.ids.push(...r.ids);
    done.failures.push(...r.failures);
  }
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
  return mcpDone('created ' + names.join(', '), async () => { mcpRefuseRemovingOpen(ids, 'undoing its creation'); await _mcpRemoveScenes(ids); worldSnapshotPut(snap); },
    'Created ' + names.join(', ') + (place.name ? ' in the group "' + place.name + '"' : ' in no group') + '. The DM has not opened it and the TV does not show it. It starts fully fogged with no rooms.' + crowded + (left.length ? ' Not made: ' + left.join(' ') : '') + (await _mcpSizes(ids)), _mcpTrashed(names));
}

// What each new map's size is, with the warning for an animated map past 4K.
async function _mcpSizes(ids) {
  const on = typeof compressBox === 'function' && !!compressBox();
  const out = [];
  for (const id of ids) {
    const rec = await sceneStore.loadScene(id);
    if (rec) out.push((ids.length > 1 ? ' "' + rec.name + '": ' : ' ') + mcpSizeNote(rec, on).text);
  }
  return out.join('');
}

// ⚠ A COPY HAS ITS OWN FILE. Deleting a map deletes its video by the map's id, so a shared path would take the
// other map's picture with it.
async function _mcpCopyScene(args) {
  const found = _mcpScene(args);
  if (found.error) return _mcpNo(found.error);
  const s = found.scene;
  const place = args.toPlace === undefined ? { name: sanitizeGroupName(s.group) } : _mcpPlaceArg(args.toPlace);
  if (place.error) return _mcpNo(place.error);
  const name = String(args.newName || '').replace(/\s+/g, ' ').trim() || s.name + ' copy';
  if (mcpFindScenes(allScenes, name, place.name || undefined).some(x => sanitizeGroupName(x.group) === place.name)) return _mcpNo('A map called "' + name + '" is already in ' + (place.name ? 'the group "' + place.name + '"' : 'no group') + '. Give another newName.');
  const at = _mcpHolder(s.id);
  if (at === 'here') await doAutoSave();
  else if (at) await flushPaneScene(at);
  const src = await sceneStore.loadScene(s.id);
  if (!src) return _mcpNo('The map "' + s.name + '" is no longer in the library.');
  const id = crypto.randomUUID();
  let mapPath;
  if (src.mapPath) {
    const from = window.electronAPI && await window.electronAPI.getVideoFilePath(s.id);
    if (!from) return _mcpNo('Nothing was copied: the animated map file of "' + s.name + '" is not on this computer yet. If sync is still bringing it, try again later.');
    const mime = /\.mp4$/i.test(from) ? 'video/mp4' : 'video/webm';
    try { await window.electronAPI.saveVideoFile(from, id, mime); } catch (err) { return _mcpNo('Nothing was copied: the map file could not be copied (' + (err && err.message) + ').'); }
    mapPath = 'maps/' + id + (mime === 'video/mp4' ? '.mp4' : '.webm');
  }
  const snap = worldSnapshotTake();
  const spot = _mcpSpot(place.name, new Set()) || (s.worldPos ? { x: s.worldPos.x + 40, y: s.worldPos.y + 40 } : { x: 0, y: 0 });
  const maxOrder = allScenes.length ? Math.max(...allScenes.map(x => x.sortOrder ?? 0)) : -1;
  const rec = mcpSceneCopy(src, { id, name, group: place.name, worldPos: spot, sortOrder: maxOrder + 1, now: Date.now(), mapPath });
  try { await sceneStore.saveScene(rec); } catch (err) {
    if (mapPath) await window.electronAPI.deleteVideoFile(id).catch(() => {});
    return _mcpNo('Nothing was copied: the new map could not be saved (' + (err && err.message) + ').');
  }
  allScenes.push({ id, name, group: place.name, thumbnail: rec.thumbnail, sortOrder: rec.sortOrder, createdAt: rec.createdAt, mapType: rec.mapType, worldPos: spot });
  worldAssignAll();
  sceneListChanged();
  const rooms = roomHeads(rec.polygons || []).length;
  return mcpDone('copied the map "' + s.name + '"', async () => { mcpRefuseRemovingOpen([id], 'undoing the copy'); await _mcpRemoveScenes([id]); worldSnapshotPut(snap); },
    'Copied the map "' + s.name + '" as "' + name + '"' + (place.name ? ' in the group "' + place.name + '"' : ' in no group') + ', with its own ' + (mapPath ? 'video file' : 'picture') + ', ' + rooms + ' rooms, its grid, fog, effects, lights and notes. ' + mcpSizeNote(rec, false).text, _mcpTrashed(['"' + name + '"']));
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
  // An extension still on the old tool list sends fogColor, which no longer exists.
  if (args.fogColor !== undefined) return _mcpNo(MCP_OLD_TOOLS);
  const size = args.gridCellSize === undefined ? undefined : mcpGridSize(args.gridCellSize);
  if (size === null) return _mcpNo('gridCellSize must be a whole number of map pixels from 10 to 400.');
  if (size === undefined) return _mcpNo('Nothing to change: give gridCellSize.');
  const edit = await mcpEditMap(s, 'changing its grid', ['grid'], d => { d.gridConfig.cellSize = size; });
  if (edit.no) return edit.no;
  const said = 'grid cell size ' + size + ' px';
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
  if (args.confirmed !== true) return _mcpOk(mcpWouldDelete('scene', { name: s.name, rooms: roomHeads(rec.polygons || []).length }));
  const snap = worldSnapshotTake();
  await _mcpRemoveScenes([s.id]);
  return mcpDone('deleted the map "' + s.name + '"', async () => {
    if (!(await sceneTrash.restore(s.id))) throw new Error('"' + s.name + '" is no longer in the Trash.');
    worldSnapshotPut(snap);
  }, 'Moved the map "' + s.name + '" with its map, fog and rooms to the Trash in Settings, where the DM can restore it for 30 days.');
}

const MCP_SCENES_TOOLS = { find_map_files: _mcpFind, create_scene: _mcpCreateScene, copy_scene: _mcpCopyScene, rename_scene: _mcpRename,
  move_scene: _mcpMove, set_scene: _mcpSetScene, delete_scene: _mcpDeleteScene };
