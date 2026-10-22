'use strict';
// mcpWorldMap.js — Claude's tools for what lies around the places on the world map: a road between two
// places, and the backdrop picture. Each change records how to put things back.

function _mcpCreateRoad(args) {
  const a = _mcpPlaceName(args.from), b = _mcpPlaceName(args.to);
  const ra = a && worldPlaceByName(a), rb = b && worldPlaceByName(b);
  if (!ra || !rb) return _mcpNo('A road joins two groups that have outlines on the Campaign. ' + (!a ? '"' + (args.from || '') + '"' : !b ? '"' + (args.to || '') + '"' : 'One of them') + ' is not one. Use list_campaign to see the groups.');
  if (a === b) return _mcpNo('A road joins two different groups.');
  const snap = worldRoadsSnapshot();
  const ca = wmPolyCentre(wmOutline(ra)), cb = wmPolyCentre(wmOutline(rb));
  const name = String(args.name || '').trim() || 'Road from ' + a + ' to ' + b;
  const uid = worldRoadCreate([ca, cb], [{ kind: 'place', ref: a, dx: 0, dy: 0 }, { kind: 'place', ref: b, dx: 0, dy: 0 }]);
  worldRoadRename(uid, name);
  _mcpWorldRefresh();
  return mcpDone('made the road "' + name + '"', async () => { worldRoadsRestore(snap); _mcpWorldRefresh(); }, 'Made the road "' + name + '" between "' + a + '" and "' + b + '".');
}

async function _mcpSetBackdrop(args) {
  const read = await window.electronAPI.readMapFiles(String(args.path || ''));
  if (read.error) return _mcpNo(read.error);
  const f = read.files[0];
  if (read.files.length !== 1 || !/^image\//.test(f.type)) return _mcpNo('The backdrop is one image file, not a folder or a video.');
  if (f.bytes.length > 30 * 1024 * 1024) return _mcpNo('The backdrop can be up to 30 MB.');
  const was = await worldBackgroundTake();
  if (!await worldBackgroundSet(new File([f.bytes], f.name, { type: f.type }))) return _mcpNo('The picture would not open as an image.');
  _mcpWorldRefresh();
  return mcpDone('set the Campaign backdrop to "' + f.name + '"', async () => { await worldBackgroundPut(was); _mcpWorldRefresh(); },
    'The Campaign backdrop is now "' + f.name + '", centred over the maps. The DM can move and fade it in Settings.');
}

const MCP_WORLDMAP_TOOLS = { create_road: _mcpCreateRoad, set_backdrop: _mcpSetBackdrop };
