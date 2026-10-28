'use strict';
// mcpNotes.js — Claude's notes tools: read the notes of the campaign, a place or a scene, add to them, or
// replace them. Each change records the old text first, so undo_last_change brings it back.

async function _mcpRead(args) {
  if (args.level === 'campaign') return _mcpOk(notesCampaignGet() || '(no campaign notes yet)');
  if (args.level === 'place') {
    const name = _mcpPlaceName(args.name);
    return name ? _mcpOk(notesPlaceGet(name) || '(no notes for this group yet)') : _mcpNo('No group is called "' + (args.name || '') + '".');
  }
  if (args.level === 'road') {
    const f = _mcpRoadFor(args);
    return f.error ? _mcpNo(f.error) : _mcpOk(notesRoadGet(f.road.uid) || '(no notes for this road yet)');
  }
  if (args.level !== 'scene') return _mcpNo('level must be campaign, group, road or map.');
  const found = _mcpScene(args);
  if (found.error) return _mcpNo(found.error);
  const rec = await _mcpSceneRecord(found.scene.id);
  return _mcpOk({ scene: found.scene.name, place: found.scene.group || null, notes: rec.notes || '', rooms: _mcpRooms(rec.polygons) });
}

// A scene's notes written wherever its live copy is. Returns false when the scene is gone.
async function _mcpPutSceneNotes(sceneId, text) {
  const at = _mcpHolder(sceneId);
  if (at === 'here') { currentScene.notes = text; await doAutoSave(); return true; }
  if (at) await flushPaneScene(at);
  let found = false;
  await sceneStore.updateScene(sceneId, rec => { found = true; rec.notes = text; });
  if (at && found) {
    sendToPane({ type: 'pane-scene-notes', value: text }, at);
    if (_rlScenes[at] && _rlScenes[at].id === sceneId) _rlScenes[at].notes = text;
  }
  return found;
}

// The level a call names, as { where, get, put } or { error }. `get` and `put` read and write its notes text.
function _mcpNotesTarget(args) {
  if (args.level === 'campaign') return { where: 'the campaign', get: async () => notesCampaignGet(), put: async text => notesCampaignSet(text) };
  if (args.level === 'place') {
    const name = _mcpPlaceName(args.name);
    if (!name) return { error: 'No group is called "' + (args.name || '') + '". Use create_place to make one.' };
    return { where: 'the group "' + name + '"', get: async () => notesPlaceGet(name), put: async text => notesPlaceSet(name, text) };
  }
  if (args.level === 'road') {
    const f = _mcpRoadFor(args);
    if (f.error) return { error: f.error };
    const uid = f.road.uid;
    return { where: 'the road "' + f.road.name + '"', get: async () => notesRoadGet(uid), put: async text => notesRoadSet(uid, text) };
  }
  if (args.level === 'scene') {
    const found = _mcpScene(args);
    if (found.error) return { error: found.error };
    const s = found.scene;
    return { where: 'the map "' + s.name + '"',
      get: async () => (await _mcpSceneRecord(s.id)).notes || '',
      put: async text => { if (!await _mcpPutSceneNotes(s.id, text)) throw new Error('The map "' + s.name + '" is no longer in the library.'); } };
  }
  return { error: 'level must be campaign, group, road or map.' };
}

// `make(old)` is mcpAppend or mcpReplace on the old text; `verb` fills the reply and the toast.
async function _mcpWriteNotes(args, make, verb) {
  const target = _mcpNotesTarget(args);
  if (target.error) return _mcpNo(target.error);
  const old = await target.get();
  const m = make(old, String(args.text || ''), _mcpCap());
  if (m.empty) return _mcpNo('The text is empty.');
  if (m.tooLong) return _mcpNo('Nothing was changed: the notes for ' + target.where + ' would pass ' + _mcpCap() + ' characters. Send a shorter text.');
  await target.put(m.text);
  return mcpDone(verb + ' the notes of ' + target.where, () => target.put(old), verb + ' the notes of ' + target.where + '.');
}

const _mcpAdd = args => _mcpWriteNotes(args, (old, text, cap) => mcpAppend(old, text, cap), 'Added to');
const _mcpSet = args => _mcpWriteNotes(args, (old, text, cap) => mcpReplace(text, cap), 'Replaced');

const MCP_NOTES_TOOLS = { read_notes: _mcpRead, add_notes: _mcpAdd, set_notes: _mcpSet };
