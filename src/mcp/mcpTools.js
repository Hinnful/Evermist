'use strict';
// mcpTools.js — what Claude may read and write through the MCP connection, answered in the DM window.
// Main relays each call (electron/mcpBridge.js) and the tool list Claude sees lives in electron/mcpShim.js.
// Claude only ever adds: notes go below the DM's, and a place or a fight is new.

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
  if (!hits.length) return { error: 'No scene is called "' + (args.name || '') + '"' + (args.place ? ' in "' + args.place + '"' : '') + '. Claude cannot create scenes; the DM adds them with a map.' };
  return { error: 'More than one scene is called "' + args.name + '". Name its place too: ' + hits.map(s => s.group || '(no place)').join(', ') + '.' };
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

function _mcpList() {
  const placeOf = s => sanitizeGroupName(s.group);
  return _mcpOk({
    campaignNotes: notesCampaignGet().length + ' characters',
    places: _mcpPlaceNames().map(name => ({ name, hasNotes: !!notesPlaceGet(name), scenes: allScenes.filter(s => placeOf(s) === name).map(s => s.name) })),
    scenesWithoutPlace: allScenes.filter(s => !placeOf(s)).map(s => s.name),
    fights: cbState.fights.map(f => f.name),
    bestiaryMonsters: Object.keys(cbState.blocks).length,
  });
}

async function _mcpRead(args) {
  if (args.level === 'campaign') return _mcpOk(notesCampaignGet() || '(no campaign notes yet)');
  if (args.level === 'place') {
    const name = _mcpPlaceName(args.name);
    return name ? _mcpOk(notesPlaceGet(name) || '(no notes for this place yet)') : _mcpNo('No place is called "' + (args.name || '') + '".');
  }
  if (args.level !== 'scene') return _mcpNo('level must be campaign, place or scene.');
  const found = _mcpScene(args);
  if (found.error) return _mcpNo(found.error);
  const rec = await _mcpSceneRecord(found.scene.id);
  return _mcpOk({ scene: found.scene.name, place: found.scene.group || null, notes: rec.notes || '', rooms: _mcpRooms(rec.polygons) });
}

async function _mcpAddSceneNotes(scene, text) {
  const at = _mcpHolder(scene.id);
  if (at === 'here') {
    const m = mcpAppend(currentScene.notes, text, _mcpCap());
    if (!m.tooLong) { currentScene.notes = m.text; await doAutoSave(); }
    return m;
  }
  if (at) await flushPaneScene(at);
  let m = null;
  await sceneStore.updateScene(scene.id, rec => { m = mcpAppend(rec.notes, text, _mcpCap()); if (m.tooLong) return false; rec.notes = m.text; });
  if (at && m && !m.tooLong) {
    sendToPane({ type: 'pane-scene-notes', value: m.text }, at);
    if (_rlScenes[at] && _rlScenes[at].id === scene.id) _rlScenes[at].notes = m.text;
  }
  return m || { tooLong: false, missing: true };
}

async function _mcpAdd(args) {
  const text = String(args.text || '');
  let m, where;
  if (args.level === 'campaign') {
    m = mcpAppend(notesCampaignGet(), text, _mcpCap());
    if (!m.tooLong && !m.empty) notesCampaignSet(m.text);
    where = 'the campaign';
  } else if (args.level === 'place') {
    const name = _mcpPlaceName(args.name);
    if (!name) return _mcpNo('No place is called "' + (args.name || '') + '". Use create_place to make one.');
    m = mcpAppend(notesPlaceGet(name), text, _mcpCap());
    if (!m.tooLong && !m.empty) notesPlaceSet(name, m.text);
    where = 'the place "' + name + '"';
  } else if (args.level === 'scene') {
    const found = _mcpScene(args);
    if (found.error) return _mcpNo(found.error);
    m = await _mcpAddSceneNotes(found.scene, text);
    if (m.missing) return _mcpNo('The scene "' + found.scene.name + '" is no longer in the library.');
    where = 'the scene "' + found.scene.name + '"';
  } else return _mcpNo('level must be campaign, place or scene.');
  if (m.empty) return _mcpNo('The text is empty.');
  if (m.tooLong) return _mcpNo('Nothing was added: the notes for ' + where + ' would pass ' + _mcpCap() + ' characters. Send a shorter text.');
  return _mcpOk('Added to the notes of ' + where + '.');
}

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
  worldUndoPush();
  const name = addGroup(want);
  worldPlaceSet(name, { vertices: wmRectShape(r.x, r.y, r.x + r.w, r.y + r.h) });
  worldAssignAll();
  if (notes) notesPlaceSet(name, notes);
  if (worldMapOpen) worldMapRefresh(); else refreshRoomPanel();
  return _mcpOk('Created the place "' + name + '" in an empty spot on the world map' + (notes ? ', with its notes' : '') + '. The DM can drag it into position.');
}

function _mcpCreateFight(args) {
  const name = String(args.name || '').trim() || 'New fight';
  const built = mcpFightRows(cbState.blocks, args.monsters, cbState.nextId);
  const missing = built.missing.map(x => x.name + (x.suggest.length ? ' (the bestiary has: ' + x.suggest.join(', ') + ')' : ''));
  const left = missing.length ? ' Left out, not in the bestiary: ' + missing.join('; ') + '.' : '';
  if (!built.rows.length) return _mcpNo('No fight was created: none of the monsters is in the bestiary.' + left);
  cbState.nextId = built.nextId;
  cbState.fights.push({ id: combatFightId(), name, rows: built.rows });
  cbSave();
  cbRender();
  cbFightsTitle();
  return _mcpOk('Created the fight "' + name + '" with ' + built.rows.length + ' rows.' + left);
}

function _mcpBestiary(args) {
  const hits = combatSearchBlocks(cbState.blocks, args.query || '');
  return _mcpOk({ total: hits.length, monsters: hits.slice(0, 60).map(b => ({ name: b.name, cr: b.cr || null, source: b.source || null })) });
}

const MCP_TOOLS = {
  list_campaign: _mcpList,
  read_notes: _mcpRead,
  add_notes: _mcpAdd,
  create_place: _mcpCreatePlace,
  create_fight: _mcpCreateFight,
  list_bestiary: _mcpBestiary,
};

async function _mcpAnswer(req) {
  const run = MCP_TOOLS[req.tool];
  if (!run) return _mcpNo('Evermist has no tool called "' + req.tool + '".');
  // Whatever the DM is typing lands first, and the field refills with Claude's text after.
  notesPanelSettle();
  try { return await run(req.args || {}); } catch (err) {
    console.error('A Claude request failed:', err);
    return _mcpNo('Evermist could not do that: ' + ((err && err.message) || err));
  } finally { refreshRoomPanel(); }
}

function initMcp() {
  window.electronAPI.onMcpRequest(async req => window.electronAPI.mcpReply(req.id, await _mcpAnswer(req)));
  window.electronAPI.mcpReady();
  initMcpConnect();
}
