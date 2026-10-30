'use strict';
// mcpEntries.js — Claude's tools for the Notes window's model: list, create, edit and delete factions and lore (and
// a blank Bestiary entry for a monster or NPC), and see where an entry appears. Also the two helpers every notes
// write and read goes through: mcpeLink turns "@{Name}" into the stored mention, mcpeShow turns mentions back.
// Rules in mcpEntriesPlan.js; the stores are notesEntries.js and the Bestiary's blocks.

const _MCPE_MAKES = ['faction', 'lore', 'monster'];

// Every entry a note can mention, as the plan's candidates. `mint` answers the id a stored mention carries.
function _mcpeCands() {
  return mxCandidates('').map(c => ({ kind: c.kind, word: c.kind === 'entry' ? c.word.toLowerCase() : c.kind, name: c.name, where: c.where, key: c.key, mint: c.id }));
}

// The ref ("kind:id") a mention of this candidate carries, or null while it has none yet. Mints nothing.
function _mcpePeek(c) {
  const k = c.key;
  if (k === 'campaign') return mpRef('campaign', 'campaign');
  if (k.startsWith('map:')) return mpRef('map', k.slice(4));
  if (k.startsWith('entry:')) return mpRef('entry', k.slice(6));
  if (k.startsWith('road:')) return mpRef('road', k.slice(5));
  if (k.startsWith('place:')) { const u = mxGroupUidPeek(k.slice(6)); return u ? mpRef('group', u) : null; }
  if (k.startsWith('monster:')) { const b = cbState.blocks[k.slice(8)]; return b && b.uid ? mpRef('monster', b.uid) : null; }
  const [, scene, roomId] = k.split(':');
  const r = (searchRoomsOf(scene) || []).find(x => String(x.id) === roomId);
  return r && r.uid ? mpRef('room', scene + ':' + r.uid) : null;
}

// Claude's text with its "@{Name}" resolved. { text, say }: `say` names the ones left as plain words.
async function mcpeLink(text) {
  const s = String(text || '');
  if (s.indexOf('@{') < 0) return { text: s, say: '' };
  await searchReadScenes();
  const r = mpeResolve(s, _mcpeCands(), c => c.mint());
  return { text: r.text, say: mpeUnresolvedSay(r.unresolved) };
}

// A note as Claude reads it: each mention as "@{Name}", "@{Map › Room}" for a room.
async function mcpeShow(text) {
  if (typeof text !== 'string' || text.indexOf('@[') < 0) return text || '';
  await searchReadScenes();
  return mpeReadBack(text, (kind, id) => {
    const r = mxResolve(kind, id);
    if (!r || r.name == null) return null;
    const scene = kind === 'room' ? allScenes.find(x => x.id === id.split(':')[0]) : null;
    return scene ? scene.name + MPE_SEP + r.name : r.name;
  });
}

const _mcpeMonsterHasNote = b => !!String(b.notes || '').trim();

function _mcpeList(args) {
  const want = args.kind;
  if (want && !_MCPE_MAKES.includes(want)) return _mcpNo('kind must be faction, lore or monster.');
  const entries = notesEntriesAll(), out = {};
  if (!want || want === 'faction') out.factions = mpeTree(entries, 'faction');
  if (!want || want === 'lore') out.lore = mpeTree(entries, 'lore');
  if (!want || want === 'monster') {
    out.monsters = Object.values(cbState.blocks).filter(b => b.listed || _mcpeMonsterHasNote(b))
      .map(b => ({ name: b.name, source: b.source || null, hasNote: _mcpeMonsterHasNote(b) }));
  }
  return _mcpOk(out);
}

async function _mcpeCreate(args) {
  const kind = args.kind;
  if (!_MCPE_MAKES.includes(kind)) return _mcpNo('kind must be faction, lore or monster.');
  const name = kind === 'monster' ? String(args.name || '').trim() : neCleanName(args.name);
  if (!name) return _mcpNo('Give the new ' + kind + ' a name.');
  const entries = notesEntriesAll();
  const refusal = kind === 'monster' ? mpeMonsterRefusal(cbState.blocks, name) : mpeCreateRefusal(entries, kind, name);
  if (refusal) return _mcpNo(refusal);
  let parent = kind;
  if (args.parent) {
    if (kind === 'monster') return _mcpNo('A monster or NPC sits in the Bestiary and has no parent. Leave parent out.');
    const f = mpeFind(entries, kind, args.parent);
    if (f.error) return _mcpNo(f.error);
    parent = f.entry.id;
  }
  const linked = await mcpeLink(args.notes);
  const note = linked.text.trim();
  if (note.length > _mcpCap()) return _mcpNo('Nothing was created: the note would pass ' + _mcpCap() + ' characters. Send a shorter note.');
  const said = (note ? ', with its note' : '') + '.' + linked.say;
  if (kind === 'monster') {
    const b = cbNewBlock(combatUniqueName(cbState.blocks, name, ''));
    b.listed = true;
    if (note) b.notes = note;
    const id = b.id;
    if (!cbSave(true)) { delete cbState.blocks[id]; return _mcpNo('Nothing was created: Evermist\'s storage is full.'); }
    bestiaryRender();
    mxBump();
    return mcpDone('made the monster or NPC "' + b.name + '" in the Bestiary', async () => { delete cbState.blocks[id]; cbSave(); bestiaryRender(); mxBump(); },
      'Made a blank Bestiary entry "' + b.name + '"' + said + ' Its stat block is empty; the DM fills it in.');
  }
  const e = notesEntryAdd(kind, name, parent);
  if (note) notesEntrySetNote(e.id, note);
  mxBump();
  return mcpDone('made the ' + kind + ' entry "' + e.name + '"', async () => { if (notesEntryGet(e.id)) notesEntryDelete(e.id); mxBump(); },
    'Made the ' + kind + ' entry "' + e.name + '"' + (parent !== kind ? ' inside "' + notesEntryGet(parent).name + '"' : '') + said);
}

async function _mcpeEdit(args) {
  const kind = args.kind;
  if (kind !== 'faction' && kind !== 'lore') return _mcpNo('kind must be faction or lore.');
  const entries = notesEntriesAll();
  const f = mpeFind(entries, kind, args.name);
  if (f.error) return _mcpNo(f.error);
  const e = f.entry;
  const moves = args.parent !== undefined || args.before !== undefined;
  if (args.newName === undefined && !moves && args.notes === undefined && args.addNotes === undefined) {
    return _mcpNo('Nothing to change: give newName, parent and/or before, notes or addNotes.');
  }
  if (args.notes !== undefined && args.addNotes !== undefined) return _mcpNo('Give notes (replaces the note) or addNotes (adds to it), not both.');
  const done = [];
  let newName = null, parentId = e.parent, beforeId = null, note = null, say = '';
  if (args.newName !== undefined) {
    newName = neCleanName(args.newName);
    if (!newName) return _mcpNo('The new name is empty.');
    if (entries.some(x => x.id !== e.id && x.kind === kind && x.name.toLowerCase() === newName.toLowerCase())) return _mcpNo('Not renamed: another ' + kind + ' entry is already called "' + newName + '".');
  }
  if (moves) {
    if (args.parent !== undefined) {
      if (!String(args.parent).trim()) parentId = kind;
      else { const p = mpeFind(entries, kind, args.parent); if (p.error) return _mcpNo(p.error); parentId = p.entry.id; }
    }
    if (parentId === e.id || neDescendants(entries, e.id).includes(parentId)) return _mcpNo('Not moved: an entry cannot go inside itself or inside something it holds.');
    if (args.before !== undefined) {
      const q = neCleanName(args.before).toLowerCase();
      const sib = neChildren(entries, parentId).find(x => x.id !== e.id && x.name.toLowerCase() === q);
      if (!sib) return _mcpNo('Not moved: no entry called "' + args.before + '" sits ' + (parentId === kind ? 'at the top of the ' + kind + ' section' : 'inside "' + notesEntryGet(parentId).name + '"') + '.');
      beforeId = sib.id;
    }
  }
  if (args.notes !== undefined || args.addNotes !== undefined) {
    const linked = await mcpeLink(args.notes !== undefined ? args.notes : args.addNotes);
    say = linked.say;
    const m = args.notes !== undefined ? mcpReplace(linked.text, _mcpCap()) : mcpAppend(e.note, linked.text, _mcpCap());
    if (m.empty) return _mcpNo('The text is empty.');
    if (m.tooLong) return _mcpNo('Nothing was changed: the note of "' + e.name + '" would pass ' + _mcpCap() + ' characters. Send a shorter text.');
    note = m.text;
  }
  const was = { name: e.name, note: e.note, parent: e.parent, next: (neChildren(entries, e.parent).find(x => x.order > e.order) || {}).id || null };
  if (newName !== null && newName !== e.name) { notesEntryRename(e.id, newName); done.push('renamed to "' + newName + '"'); }
  if (moves) { notesEntryMove(e.id, parentId, beforeId); done.push('moved ' + (parentId === kind ? 'to the top of the ' + kind + ' section' : 'inside "' + notesEntryGet(parentId).name + '"') + (beforeId ? ' before "' + notesEntryGet(beforeId).name + '"' : '')); }
  if (note !== null) { notesEntrySetNote(e.id, note); done.push(args.notes !== undefined ? 'note replaced' : 'added to the note'); }
  mxBump();
  const undo = async () => {
    if (!notesEntryGet(e.id)) return;
    if (note !== null) notesEntrySetNote(e.id, was.note);
    if (moves) notesEntryMove(e.id, was.parent, was.next);
    if (newName !== null) notesEntryRename(e.id, was.name);
    mxBump();
  };
  const shown = newName || e.name;
  return mcpDone('edited the ' + kind + ' entry "' + was.name + '"', undo, 'The ' + kind + ' entry "' + shown + '": ' + (done.join(', ') || 'nothing needed changing') + '.' + say);
}

// The notes that mention an entry or anything inside it, not counting the entries' own notes.
function _mcpeMentions(ids) {
  const seen = new Map();
  for (const id of ids) for (const row of mxAppearsIn(mpRef('entry', id), null)) if (!ids.includes(row.key.replace(/^entry:/, ''))) seen.set(row.key, row);
  return [...seen.values()];
}

async function _mcpeDelete(args) {
  const kind = args.kind;
  if (kind !== 'faction' && kind !== 'lore') return _mcpNo('kind must be faction or lore. A monster is deleted with delete_monster.');
  const entries = notesEntriesAll();
  const f = mpeFind(entries, kind, args.name);
  if (f.error) return _mcpNo(f.error);
  const e = f.entry;
  const belowIds = neDescendants(entries, e.id);
  if (args.confirmed !== true) {
    await searchReadScenes();
    const mentions = _mcpeMentions([e.id, ...belowIds]).map(r => ({ name: r.name, word: r.word }));
    return _mcpOk(mpeWouldDelete(kind, mpePath(entries, e), belowIds.map(id => mpePath(entries, neById(entries, id))), mentions));
  }
  const gone = entries.filter(x => x.id === e.id || belowIds.includes(x.id));
  notesEntryDelete(e.id);
  mxBump();
  return mcpDone('deleted the ' + kind + ' entry "' + e.name + '"', async () => { notesEntriesAdopt(gone); mxBump(); },
    'Deleted the ' + kind + ' entry "' + e.name + '"' + (belowIds.length ? ' and the ' + belowIds.length + ' inside it' : '') + '. Mentions of it now show red and keep their words.');
}

async function _mcpeAppearsIn(args) {
  await searchReadScenes();
  const { name, hits } = mpeMatch(_mcpeCands(), args.name, args.kind);
  if (!hits.length) return _mcpNo('Nothing is called "' + name + '". Name a map, room, group, road, faction, lore entry or monster; a "kind:" before the name, or kind, narrows it.');
  if (hits.length > 1) return _mcpNo('More than one thing is called "' + name + '": ' + hits.map(c => c.word + (c.where ? ' in "' + c.where + '"' : '')).join(', ') + '. Give kind, or write the name as "Map › Room".');
  const rows = mxAppearsIn(_mcpePeek(hits[0]), null);
  if (!rows.length) return _mcpOk('No note mentions "' + hits[0].name + '".');
  return _mcpOk(rows.map(r => ({ in: r.word, name: r.name, where: r.where || undefined })));
}

const MCP_ENTRIES_TOOLS = { list_entries: _mcpeList, create_entry: _mcpeCreate, edit_entry: _mcpeEdit, delete_entry: _mcpeDelete, appears_in: _mcpeAppearsIn };
