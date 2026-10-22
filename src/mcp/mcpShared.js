'use strict';
// mcpShared.js — what every Claude tool group reads: the reply shapes, the names a call points at, and a
// scene's record wherever its live copy is. Loaded before the groups.

const _mcpOk = (value) => ({ text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) });
const _mcpNo = (text) => ({ text, isError: true });
const _mcpCap = () => ROOM_DESC_MAX;

function _mcpPlaceNames() {
  return [...new Set([...worldPlaceRecords().map(r => r.name), ...knownGroupNames()])];
}

function _mcpPlaceName(name) {
  const q = sanitizeGroupName(name).toLowerCase();
  return _mcpPlaceNames().find(n => n.toLowerCase() === q) || null;
}

// One scene by name, or the reason there is not exactly one.
function _mcpScene(args) {
  const hits = mcpFindScenes(allScenes, args.name, args.place);
  if (hits.length === 1) return { scene: hits[0] };
  if (!hits.length) return { error: 'No map is called "' + (args.name || '') + '"' + (args.place ? ' in "' + args.place + '"' : '') + '. Use create_scene to add one from a map file.' };
  return { error: 'More than one map is called "' + args.name + '". Name its group too: ' + hits.map(s => s.group || '(no group)').join(', ') + '.' };
}

// Where a scene's live copy is: this window's open scene, a column in two-map mode, or only the store.
function _mcpHolder(id) {
  if (!panesActive && currentScene && currentScene.id === id) return 'here';
  return panesActive ? paneColumnOf(id) : null;
}

function _mcpRooms(polys) {
  return (polys || []).filter(p => p.name || p.desc).map(p => ({ name: p.name || null, notes: p.desc || '' }));
}

async function _mcpSceneRecord(id) {
  const at = _mcpHolder(id);
  if (at === 'here') return { notes: currentScene.notes || '', polygons };
  if (at) await flushPaneScene(at);
  return (await sceneStore.loadScene(id)) || {};
}

// A refusal when the TV shows this scene, else null. Fog, fog colour, the map and a delete all alter the TV's picture.
function _mcpTvRefuse(scene, what) {
  const onTv = mcpOnTv({ playerOpen: !!(playerWindow && !playerWindow.closed), held: tvHeld, panes: panesActive,
    isOpen: !!(currentScene && currentScene.id === scene.id), inColumn: panesActive && !!paneColumnOf(scene.id) });
  return onTv ? _mcpNo('Not done: the TV shows "' + scene.name + '" now, and ' + what + ' would change what the players see. Ask the DM to open another map first or close the Player window.') : null;
}
