'use strict';
// mcpWorld.js — Claude's view of the campaign and its places on the world map: list, create, rename, reshape, delete.

// A place's outline box in world-map units ({ x, y, w, h }), or null for a place with no outline yet.
function _mcpBounds(name) {
  const rec = worldPlaceByName(name);
  return rec ? wmPolyBounds(wmOutline(rec)) : null;
}

function _mcpEnd(end) {
  if (end.kind === 'place') return end.ref;
  const s = end.kind === 'scene' ? allScenes.find(x => x.id === end.ref) : null;
  return s ? s.name : null;
}

function _mcpList() {
  const placeOf = s => sanitizeGroupName(s.group);
  return _mcpOk({
    campaignNotes: notesCampaignGet().length + ' characters',
    places: _mcpPlaceNames().map(name => ({ name, hasNotes: !!notesPlaceGet(name), bounds: _mcpBounds(name), scenes: allScenes.filter(s => placeOf(s) === name).map(s => s.name) })),
    scenesWithoutPlace: allScenes.filter(s => !placeOf(s)).map(s => s.name),
    roads: worldRoadRecords().map(r => ({ name: r.name, from: _mcpEnd(r.ends[0]), to: _mcpEnd(r.ends[1]) })),
    fights: cbState.fights.map(f => f.name),
    bestiaryMonsters: Object.keys(cbState.blocks).length,
  });
}

function _mcpWorldRefresh() { if (worldMapOpen) worldMapRefresh(); else refreshRoomPanel(); }

function _mcpTaken() {
  const rects = worldPlaceRecords().map(r => wmPolyBounds(wmOutline(r)));
  for (const s of allScenes) if (wmCleanPos(s.worldPos)) rects.push(wmCardRect(s.worldPos));
  return rects;
}

function _mcpCreatePlace(args) {
  const want = sanitizeGroupName(args.name);
  if (!want) return _mcpNo('A place needs a name.');
  if (_mcpPlaceName(want)) return _mcpNo('A place called "' + want + '" already exists. Use add_notes to add to it.');
  const notes = String(args.notes || '').trim();
  if (notes.length > _mcpCap()) return _mcpNo('Nothing was created: the notes pass ' + _mcpCap() + ' characters.');
  const r = mcpFreeRect(_mcpTaken());
  const snap = worldSnapshotTake();
  const name = addGroup(want);
  worldPlaceSet(name, { vertices: wmRectShape(r.x, r.y, r.x + r.w, r.y + r.h) });
  worldAssignAll();
  if (notes) notesPlaceSet(name, notes);
  _mcpWorldRefresh();
  return mcpDone('created the place "' + name + '"', async () => { worldSnapshotPut(snap); forgetGroup(name); _mcpWorldRefresh(); },
    'Created the place "' + name + '" in an empty spot on the world map' + (notes ? ', with its notes' : '') + '. The DM can drag it into position. The place holds no scenes yet: it gets them when the DM or Claude adds maps into it.');
}

// The place a call names, as { name }, or { error }.
function _mcpPlaceFor(raw) {
  const name = _mcpPlaceName(raw);
  return name ? { name } : { error: 'No place is called "' + (raw || '') + '".' };
}

function _mcpRenamePlace(args) {
  const p = _mcpPlaceFor(args.name);
  if (p.error) return _mcpNo(p.error);
  const to = sanitizeGroupName(args.newName);
  if (!to) return _mcpNo('A place needs a name.');
  if (to !== p.name && _mcpPlaceName(to)) return _mcpNo('A place called "' + to + '" already exists.');
  const now = renameGroup(p.name, to);
  _mcpWorldRefresh();
  return mcpDone('renamed the place "' + p.name + '" to "' + now + '"', async () => { renameGroup(now, p.name); _mcpWorldRefresh(); },
    'Renamed the place "' + p.name + '" to "' + now + '". Its notes, scenes and roads came with it.');
}

function _mcpReshapePlace(args) {
  const p = _mcpPlaceFor(args.name);
  if (p.error) return _mcpNo(p.error);
  const r = mcpRectArg(args);
  if (!r) return _mcpNo('x, y, w and h are needed, in world-map units, at least ' + MCP_PLACE_MIN_W + ' wide and ' + MCP_PLACE_MIN_H + ' high. list_campaign shows each place\'s bounds.');
  const snap = worldSnapshotTake();
  worldPlaceSet(p.name, { vertices: wmRectShape(r.x, r.y, r.x + r.w, r.y + r.h) });
  worldReconcile();
  _mcpWorldRefresh();
  return mcpDone('reshaped the place "' + p.name + '"', async () => { worldSnapshotPut(snap); _mcpWorldRefresh(); },
    'The place "' + p.name + '" is now a rectangle at ' + r.x + ',' + r.y + ', ' + r.w + ' by ' + r.h + '. Scenes in it were pulled inside; a scene whose card now lies in another place or none was filed there.');
}

function _mcpDeletePlace(args) {
  const p = _mcpPlaceFor(args.name);
  if (p.error) return _mcpNo(p.error);
  const snap = worldSnapshotTake();
  const kept = allScenes.filter(s => sanitizeGroupName(s.group) === p.name);
  forgetGroup(p.name);
  worldShapeDelete(p.name);
  notesPlaceSet(p.name, '');
  for (const s of kept) worldSceneSet(s.id, { group: '' });
  sceneListChanged();
  _mcpWorldRefresh();
  return mcpDone('deleted the place "' + p.name + '"', async () => {
    worldSnapshotPut(snap);
    if (!knownGroupNames().includes(p.name)) addGroup(p.name);
    sceneListChanged();
    _mcpWorldRefresh();
  }, 'Deleted the place "' + p.name + '" and its notes. ' + (kept.length ? kept.length + ' scene(s) stay, now in no place.' : 'It held no scenes.'));
}

const MCP_WORLD_TOOLS = { list_campaign: _mcpList, create_place: _mcpCreatePlace, rename_place: _mcpRenamePlace,
  reshape_place: _mcpReshapePlace, delete_place: _mcpDeletePlace };
