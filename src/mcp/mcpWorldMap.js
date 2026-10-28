'use strict';
// mcpWorldMap.js — Claude's tools for what lies around the places on the world map: a road between two
// places, its notes-free edits, the maps on it, and the backdrop picture. Each change records how to put things back.

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

// The road a call names: { road } or { error }. Two roads with one name are told apart by from and to.
function _mcpRoadFor(args) {
  const recs = worldRoadRecords();
  const found = mcpFindRoad(recs.map(r => ({ name: r.name, from: _mcpEnd(r.ends[0]), to: _mcpEnd(r.ends[1]) })), args.name, args.from, args.to);
  return found.error ? found : { road: recs[found.index] };
}

function _mcpEditRoad(args) {
  const f = _mcpRoadFor(args);
  if (f.error) return _mcpNo(f.error);
  const r = f.road, was = r.name, snap = worldSnapshotTake();
  const did = [];
  if (args.newName !== undefined) {
    if (!String(args.newName).trim()) return _mcpNo('A road needs a name.');
  }
  let pts = null;
  if (args.points !== undefined) {
    const raw = args.points;
    pts = Array.isArray(raw) ? raw.map(p => ({ x: Math.round(Number(p && p.x)), y: Math.round(Number(p && p.y)) })) : null;
    if (!pts || pts.length < 2 || pts.length > 400 || !pts.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) return _mcpNo('points is a list of 2 to 400 { x, y } in Campaign units.');
  }
  const radius = args.cornerRadius === undefined ? undefined : Number(args.cornerRadius);
  if (radius !== undefined && !(Number.isFinite(radius) && radius >= 0)) return _mcpNo('cornerRadius is a number of Campaign units, 0 or more.');
  if (args.newName === undefined && !pts && radius === undefined) return _mcpNo('Nothing to change: give newName, points or cornerRadius.');
  if (args.newName !== undefined) { worldRoadRename(r.uid, String(args.newName)); did.push('renamed to "' + r.name + '"'); }
  if (pts) { r.vertices = pts; delete r.handles; delete r.cornerRadii; did.push('given a new route of ' + pts.length + ' points'); }
  if (radius !== undefined) { if (radius > 0) r.cornerRadius = radius; else delete r.cornerRadius; delete r.cornerRadii; did.push('corner radius ' + radius); }
  worldRoadsCommit();
  _mcpWorldRefresh();
  return mcpDone('changed the road "' + was + '"', async () => { worldSnapshotPut(snap); _mcpWorldRefresh(); },
    'The road "' + was + '" was ' + did.join(' and ') + '. Its ends keep to their groups or maps, and maps on it sit on the new line.');
}

function _mcpRoadScenes(names) {
  const out = [];
  for (const n of names || []) {
    const hits = mcpFindScenes(allScenes, n);
    if (hits.length !== 1) return { error: hits.length ? 'More than one map is called "' + n + '". Rename one first.' : 'No map is called "' + n + '".' };
    out.push(hits[0]);
  }
  return { scenes: out };
}

function _mcpSetRoadMaps(args) {
  const f = _mcpRoadFor(args);
  if (f.error) return _mcpNo(f.error);
  const r = f.road;
  const add = _mcpRoadScenes(args.add), off = _mcpRoadScenes(args.remove);
  if (add.error || off.error) return _mcpNo(add.error || off.error);
  if (!add.scenes.length && !off.scenes.length) return _mcpNo('Nothing to change: give add or remove, each a list of map names.');
  const loose = off.scenes.filter(s => !r.scenes.some(x => x.id === s.id));
  if (loose.length) return _mcpNo('Not on the road "' + r.name + '": ' + loose.map(s => '"' + s.name + '"').join(', ') + '.');
  const snap = worldSnapshotTake(), pts = wrSamples(r);
  for (const s of off.scenes) worldRoadsDetach(s.id);
  for (const s of add.scenes) {
    const pos = wmCleanPos(s.worldPos);
    worldRoadsDetach(s.id);
    r.scenes.push({ id: s.id, t: pos ? wrNearest(pts, pos).t : 0.5 });
  }
  worldRoadsCommit();
  worldAssignAll();
  _mcpWorldRefresh();
  const say = (list, w) => list.length ? w + ' ' + list.map(s => '"' + s.name + '"').join(', ') : '';
  return mcpDone('changed the maps on the road "' + r.name + '"', async () => { worldSnapshotPut(snap); _mcpWorldRefresh(); },
    [say(add.scenes, 'Put'), say(off.scenes, 'Took off')].filter(Boolean).join('; ') + ' on the road "' + r.name + '". A map on a road leaves its group; one taken off stays where it is and joins the group holding it.');
}

function _mcpDeleteRoad(args) {
  const f = _mcpRoadFor(args);
  if (f.error) return _mcpNo(f.error);
  const r = f.road, notes = notesRoadGet(r.uid);
  if (args.confirmed !== true) return _mcpOk(mcpWouldDeleteRoad({ name: r.name, notes: notes.length, maps: r.scenes.length }));
  const snap = worldSnapshotTake(), name = r.name;
  worldRoadDelete(r.uid);
  notesRoadSet(r.uid, '');
  _mcpWorldRefresh();
  return mcpDone('deleted the road "' + name + '"', async () => { worldSnapshotPut(snap); if (notes) notesRoadSet(r.uid, notes); _mcpWorldRefresh(); },
    'Deleted the road "' + name + '"' + (notes ? ' and its notes' : '') + '. ' + (r.scenes.length ? 'Its maps stay where they are.' : 'No maps were on it.'));
}

async function _mcpSetBackdrop(args) {
  const nums = mcpBackdropArgs(args);
  if (nums.error) return _mcpNo(nums.error);
  const was = await worldBackgroundTake();
  if (!args.path) {
    if (!Object.keys(nums).length) return _mcpNo('Nothing to change: give a path, or scale, opacity, x or y.');
    if (!was) return _mcpNo('There is no backdrop yet. Give the path of an image file first.');
    worldBackgroundNumbersSet(nums);
    _mcpWorldRefresh();
    return mcpDone('changed the Campaign backdrop', async () => { await worldBackgroundPut(was); _mcpWorldRefresh(); },
      'Changed the Campaign backdrop: ' + Object.keys(nums).map(k => (k === 'alpha' ? 'opacity' : k) + ' ' + (k === 'scale' ? nums[k] * 100 + '%' : nums[k])).join(', ') + '.');
  }
  const read = await window.electronAPI.readMapFiles(String(args.path));
  if (read.error) return _mcpNo(read.error);
  const f = read.files[0];
  if (read.files.length !== 1 || !/^image\//.test(f.type)) return _mcpNo('The backdrop is one image file, not a folder or a video.');
  if (f.bytes.length > 30 * 1024 * 1024) return _mcpNo('The backdrop can be up to 30 MB.');
  if (!await worldBackgroundSet(new File([f.bytes], f.name, { type: f.type }))) return _mcpNo('The picture would not open as an image.');
  if (Object.keys(nums).length) worldBackgroundNumbersSet(nums);
  _mcpWorldRefresh();
  return mcpDone('set the Campaign backdrop to "' + f.name + '"', async () => { await worldBackgroundPut(was); _mcpWorldRefresh(); },
    'The Campaign backdrop is now "' + f.name + '"' + (Object.keys(nums).length ? ' with your size, opacity and position' : ', centred over the maps') + '. The DM can move and fade it in Settings.');
}

const MCP_WORLDMAP_TOOLS = { create_road: _mcpCreateRoad, edit_road: _mcpEditRoad, set_road_maps: _mcpSetRoadMaps, delete_road: _mcpDeleteRoad, set_backdrop: _mcpSetBackdrop };
