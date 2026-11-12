'use strict';
// mcpNotes.js — Claude's notes tools: read the notes of the campaign, a group, a road, a map, a faction, a lore
// entry or a monster, add to them, or replace them, and read or set the Notes tree's order and groups. Each change
// records the old state first, so undo_last_change brings it back. Mentions read back as @{Name} and written text
// resolves @{Name} (mcpEntries.js).

async function _mcpRead(args) {
  if (args.level === 'campaign') return _mcpOk(await mcpeShow(notesCampaignGet()) || '(no campaign notes yet)');
  if (args.level === 'place') {
    const name = _mcpPlaceName(args.name);
    return name ? _mcpOk(await mcpeShow(notesPlaceGet(name)) || '(no notes for this group yet)') : _mcpNo('No group is called "' + (args.name || '') + '".');
  }
  if (args.level === 'road') {
    const f = _mcpRoadFor(args);
    return f.error ? _mcpNo(f.error) : _mcpOk(await mcpeShow(notesRoadGet(f.road.uid)) || '(no notes for this road yet)');
  }
  if (args.level === 'faction' || args.level === 'lore' || args.level === 'monster') {
    const target = _mcpNotesTarget(args);
    return target.error ? _mcpNo(target.error) : _mcpOk(await mcpeShow(await target.get()) || '(no note yet)');
  }
  if (args.level !== 'scene') return _mcpNo('level must be campaign, group, road, map, faction, lore or monster.');
  const found = _mcpScene(args);
  if (found.error) return _mcpNo(found.error);
  const rec = await _mcpSceneRecord(found.scene.id);
  const rooms = _mcpRooms(rec.polygons);
  for (const r of rooms) r.notes = await mcpeShow(r.notes);
  return _mcpOk({ scene: found.scene.name, place: found.scene.group || null, notes: await mcpeShow(rec.notes || ''), rooms });
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
  if (args.level === 'faction' || args.level === 'lore') {
    const f = mpeFind(notesEntriesAll(), args.level, args.name);
    if (f.error) return { error: f.error };
    const id = f.entry.id;
    return { where: 'the ' + args.level + ' entry "' + f.entry.name + '"', get: async () => (notesEntryGet(id) || {}).note || '',
      put: async text => { if (notesEntryGet(id)) { notesEntrySetNote(id, text); mxBump(); } } };
  }
  if (args.level === 'monster') {
    const f = mcpFindMonster(cbState.blocks, args.name, args.source);
    if (f.error) return { error: f.error };
    const id = f.entry.id;
    return { where: 'the monster "' + f.entry.name + '"', get: async () => (cbState.blocks[id] || {}).notes || '',
      put: async text => { const b = cbState.blocks[id]; if (!b) return; b.notes = text; cbSave(); mxBump(); bestiaryRender(); } };
  }
  return { error: 'level must be campaign, group, road, map, faction, lore or monster.' };
}

// `make(old)` is mcpAppend or mcpReplace on the old text; `verb` fills the reply and the toast.
function _mcpWriteNotes(args, make, verb) {
  const target = _mcpNotesTarget(args);
  if (target.error) return _mcpNo(target.error);
  return mcpInTurn('notes:' + target.where, () => _mcpWriteNotesNow(target, args, make, verb));
}

async function _mcpWriteNotesNow(target, args, make, verb) {
  const old = await target.get();
  const linked = await mcpeLink(args.text);
  const m = make(old, linked.text, _mcpCap());
  if (m.empty) return _mcpNo('The text is empty.');
  if (m.tooLong) return _mcpNo('Nothing was changed: the notes for ' + target.where + ' would pass ' + _mcpCap() + ' characters. Send a shorter text.');
  await target.put(m.text);
  mxBump();
  return mcpDone(verb + ' the notes of ' + target.where, async () => { await target.put(old); mxBump(); }, verb + ' the notes of ' + target.where + '.' + linked.say);
}

const _mcpAdd = args => _mcpWriteNotes(args, (old, text, cap) => mcpAppend(old, text, cap), 'Added to');
const _mcpSet = args => _mcpWriteNotes(args, (old, text, cap) => mcpReplace(text, cap), 'Replaced');

// ─── The Notes tree's order and groups ───────────────────────────────────────
// Notes-only (notesOrder.js): never a map's rooms list, its fog or a map's Campaign group, which move_scene changes.

// The tree node whose rows a call names: { node, where, grouping } or { error }.
async function _mcpOrderTarget(args) {
  await searchReadScenes();
  const root = ntBuild(), find = k => notesTreeFind(root, k);
  if (args.level === 'campaign') return { node: root, where: 'the Campaign', grouping: false };
  if (args.level === 'group') {
    const name = _mcpPlaceName(args.name), node = name && find('place:' + name);
    return node ? { node, where: 'the group "' + name + '"', grouping: false } : { error: 'No group is called "' + (args.name || '') + '".' };
  }
  if (args.level === 'map') {
    const f = _mcpScene(args);
    return f.error ? f : { node: find('map:' + f.scene.id), where: 'the rooms of "' + f.scene.name + '"', grouping: true };
  }
  if (args.level === 'roads') { const node = find('sec:roads'); return node ? { node, where: 'the roads', grouping: true } : { error: 'There are no roads.' }; }
  if (args.level === 'monsters') return { node: find('sec:monster'), where: 'the monsters and NPCs', grouping: true };
  return { error: 'level must be campaign, group, map, roads or monsters.' };
}

// Each row top to bottom with the Notes group it sits in.
const _mcpOrderRows = node => node.children.filter(c => c.kind !== 'section')
  .flatMap(c => (c.kind === 'ngroup' ? c.children.map(n => ({ n, group: c.name })) : [{ n: c, group: null }]))
  .map(r => ({ key: r.n.key, label: r.n.name, group: r.group, node: r.n }));

async function _mcpReadOrder(args) {
  const tg = await _mcpOrderTarget(args);
  if (tg.error) return _mcpNo(tg.error);
  const rows = _mcpOrderRows(tg.node);
  return _mcpOk({ where: tg.where, rows: rows.map(r => ({ name: r.label, kind: r.node.kind === 'place' ? 'group' : r.node.kind, notesGroup: r.group })),
    notesGroups: [...new Set(rows.map(r => r.group).filter(Boolean))] });
}

// `groups` as Claude names them, each a clean name and its items' keys: { groups } or { error }.
function _mcpOrderGroups(raw, items) {
  if (!Array.isArray(raw)) return { groups: null };
  const groups = [], taken = new Set();
  for (const g of raw) {
    const name = noName(g && g.name);
    if (!name) return { error: 'Every Notes group needs a name.' };
    const many = mcpLibMany(items, g.items, 'row', 'read_notes_order');
    if (many.error) return { error: many.error };
    const twice = many.items.find(x => taken.has(x.key));
    if (twice) return { error: '"' + twice.label + '" is in two groups. Put each row in one group at most.' };
    many.items.forEach(x => taken.add(x.key));
    groups.push({ name, items: many.items });
  }
  return { groups };
}

async function _mcpSetOrder(args) {
  const tg = await _mcpOrderTarget(args);
  if (tg.error) return _mcpNo(tg.error);
  if (args.groups !== undefined && !tg.grouping) return _mcpNo('Notes groups are for rooms, roads and monsters. A map changes its Campaign group with move_scene.');
  const items = _mcpOrderRows(tg.node);
  const many = Array.isArray(args.order) && args.order.length ? mcpLibMany(items, args.order, 'row', 'read_notes_order') : { items: [] };
  if (many.error) return _mcpNo(many.error);
  const gs = _mcpOrderGroups(args.groups, items);
  if (gs.error) return _mcpNo('Nothing was changed. ' + gs.error);
  const keyOf = new Map(items.map(x => [x.key, _ndKey(x.node)]));
  const lk = tg.node.kind === 'place' ? 'place:' + mxGroupUidFor(tg.node.id) : tg.node.list, was = notesOrderGet(lk);
  const groups = gs.groups && gs.groups.map(g => ({ name: g.name, keys: g.items.map(x => keyOf.get(x.key)).filter(Boolean) }));
  const next = notesOrderRebuild(notesOrderFill(was, [...keyOf.values()].filter(Boolean)), many.items.map(x => keyOf.get(x.key)).filter(Boolean), groups, Date.now(), notesOrderNewGid);
  notesOrderPut(lk, next);
  ntRefresh();
  return mcpDone('set the order of ' + tg.where, async () => { notesOrderPut(lk, was); ntRefresh(); },
    'Set the order of ' + tg.where + ' in the Notes window. Only the Notes tree changed: no map, fog or Campaign group moved.');
}

const MCP_NOTES_TOOLS = { read_notes: _mcpRead, add_notes: _mcpAdd, set_notes: _mcpSet, read_notes_order: _mcpReadOrder, set_notes_order: _mcpSetOrder };
