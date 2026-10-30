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

function _mcpRoadMaps(r) {
  return r.scenes.map(x => { const s = allScenes.find(a => a.id === x.id); return s ? s.name : null; }).filter(Boolean);
}

function _mcpList() {
  const placeOf = s => sanitizeGroupName(s.group);
  return _mcpOk({
    campaignNotes: notesCampaignGet().length + ' characters',
    places: _mcpPlaceNames().map(name => ({ name, hasNotes: !!notesPlaceGet(name), bounds: _mcpBounds(name), scenes: allScenes.filter(s => placeOf(s) === name).map(s => s.name) })),
    scenesWithoutPlace: allScenes.filter(s => !placeOf(s)).map(s => s.name),
    roads: worldRoadRecords().map(r => ({ name: r.name, from: _mcpEnd(r.ends[0]), to: _mcpEnd(r.ends[1]), hasNotes: !!notesRoadGet(r.uid), scenes: _mcpRoadMaps(r) })),
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

async function _mcpCreatePlace(args) {
  const want = sanitizeGroupName(args.name);
  if (!want) return _mcpNo('A group needs a name.');
  if (_mcpPlaceName(want)) return _mcpNo('A group called "' + want + '" already exists. Use add_notes to add to it.');
  const linked = await mcpeLink(args.notes);
  const notes = linked.text.trim();
  if (notes.length > _mcpCap()) return _mcpNo('Nothing was created: the notes pass ' + _mcpCap() + ' characters.');
  const r = mcpFreeRect(_mcpTaken());
  const snap = worldSnapshotTake();
  const name = addGroup(want);
  worldPlaceSet(name, { vertices: wmRectShape(r.x, r.y, r.x + r.w, r.y + r.h) });
  worldAssignAll();
  if (notes) notesPlaceSet(name, notes);
  _mcpWorldRefresh();
  return mcpDone('created the group "' + name + '"', async () => { worldSnapshotPut(snap); forgetGroup(name); _mcpWorldRefresh(); },
    'Created the group "' + name + '" in an empty spot on the Campaign' + (notes ? ', with its notes' : '') + '.' + linked.say + ' The DM can drag it into position. The group holds no maps yet: it gets them when the DM or Claude adds maps into it.');
}

// The place a call names, as { name }, or { error }.
function _mcpPlaceFor(raw) {
  const name = _mcpPlaceName(raw);
  return name ? { name } : { error: 'No group is called "' + (raw || '') + '".' };
}

function _mcpRenamePlace(args) {
  const p = _mcpPlaceFor(args.name);
  if (p.error) return _mcpNo(p.error);
  const to = sanitizeGroupName(args.newName);
  if (!to) return _mcpNo('A group needs a name.');
  if (to !== p.name && _mcpPlaceName(to)) return _mcpNo('A group called "' + to + '" already exists.');
  const now = renameGroup(p.name, to);
  _mcpWorldRefresh();
  return mcpDone('renamed the group "' + p.name + '" to "' + now + '"', async () => { renameGroup(now, p.name); _mcpWorldRefresh(); },
    'Renamed the group "' + p.name + '" to "' + now + '". Its notes, maps and roads came with it.');
}

function _mcpReshapePlace(args) {
  const p = _mcpPlaceFor(args.name);
  if (p.error) return _mcpNo(p.error);
  const rect = ['x', 'y', 'w', 'h'].some(k => args[k] !== undefined && args[k] !== null);
  if (args.outline !== undefined && rect) return _mcpNo('Give an outline or x, y, w and h, not both.');
  if (args.outline !== undefined) return _mcpReshapeOutline(p.name, args.outline);
  const r = mcpRectArg(args);
  if (!r) return _mcpNo('x, y, w and h are needed, in Campaign units, at least ' + MCP_PLACE_MIN_W + ' wide and ' + MCP_PLACE_MIN_H + ' high, or an outline of at least 3 points. list_campaign shows each group\'s bounds.');
  const snap = worldSnapshotTake();
  worldPlaceSet(p.name, { vertices: wmRectShape(r.x, r.y, r.x + r.w, r.y + r.h) });
  worldReconcile();
  _mcpWorldRefresh();
  return mcpDone('reshaped the group "' + p.name + '"', async () => { worldSnapshotPut(snap); _mcpWorldRefresh(); },
    'The group "' + p.name + '" is now a rectangle at ' + r.x + ',' + r.y + ', ' + r.w + ' by ' + r.h + '. Maps in it were pulled inside; a map whose card now lies in another group or none was filed there.');
}

// An outline: no map is pulled in. A card no longer wholly inside leaves, as the app's worldAssignAll decides.
function _mcpReshapeOutline(name, raw) {
  const o = mcpOutlineArg(raw);
  if (o.error) return _mcpNo(o.error);
  const held = allScenes.filter(s => sanitizeGroupName(s.group) === name).map(s => s.id);
  const snap = worldSnapshotTake();
  worldPlaceSet(name, { vertices: o.points });
  worldAssignAll();
  const left = held.map(id => allScenes.find(s => s.id === id)).filter(s => s && sanitizeGroupName(s.group) !== name);
  _mcpWorldRefresh();
  return mcpDone('reshaped the group "' + name + '"', async () => { worldSnapshotPut(snap); _mcpWorldRefresh(); },
    'The group "' + name + '" now has an outline of ' + o.points.length + ' points.' + (left.length
      ? ' These maps no longer fit wholly inside and left it: ' + left.map(s => '"' + s.name + '"' + (s.group ? ' (now in "' + s.group + '")' : ' (now in no group)')).join(', ') + '.'
      : ' Every map in it still fits.'));
}

function _mcpDeletePlace(args) {
  const p = _mcpPlaceFor(args.name);
  if (p.error) return _mcpNo(p.error);
  const kept = allScenes.filter(s => sanitizeGroupName(s.group) === p.name);
  if (args.confirmed !== true) return _mcpOk(mcpWouldDelete('place', { name: p.name, notes: notesPlaceGet(p.name).length, maps: kept.length }));
  const snap = worldSnapshotTake();
  forgetGroup(p.name);
  worldShapeDelete(p.name);
  notesPlaceSet(p.name, '');
  for (const s of kept) worldSceneSet(s.id, { group: '' });
  sceneListChanged();
  _mcpWorldRefresh();
  return mcpDone('deleted the group "' + p.name + '"', async () => {
    worldSnapshotPut(snap);
    if (!knownGroupNames().includes(p.name)) addGroup(p.name);
    sceneListChanged();
    _mcpWorldRefresh();
  }, 'Deleted the group "' + p.name + '" and its notes. ' + (kept.length ? kept.length + ' map(s) stay, now in no group.' : 'It held no maps.'));
}

const MCP_WORLD_TOOLS = { list_campaign: _mcpList, create_place: _mcpCreatePlace, rename_place: _mcpRenamePlace,
  reshape_place: _mcpReshapePlace, delete_place: _mcpDeletePlace };
