'use strict';
// mentionIndex.js — what a mention points at, read from the app's own state: whether its entry exists and its current
// name and note, the entries the @ picker lists (minting the ids a mention needs when one is picked), the notes
// that mention a given entry, and the group uids. The stored form and its rules are mentionPlan.js.
//
// A mention is blue while its entry exists and red when it does not. A monster is found by its uid and goes red
// only when it leaves the Bestiary; clearing its note in the tree leaves it blue.

const MX_GROUP_UIDS_KEY = 'evermist.groupUids';
const MX_WORDS = { campaign: 'Campaign', group: 'Group', road: 'Road', map: 'Map', room: 'Room', monster: 'Monster or NPC', faction: 'Faction', lore: 'Lore' };

let _mxRev = 0;
let _mxMentioned = { rev: -1, set: null };

// Something that holds a note changed: what "appears in" and the tree's mentioned monsters read is stale.
function mxBump() { _mxRev++; }
function mxRev() { return _mxRev; }

function _mxGroupNames() {
  const names = knownGroupNames();
  return names.concat(worldPlaceRecords().map(r => r.name).filter(n => !names.includes(n)));
}

// ─── Group uids ──────────────────────────────────────────────────────────────

function mxGroupUids() {
  try { return mpGroupUidsClean(JSON.parse(localStorage.getItem(MX_GROUP_UIDS_KEY) || '{}')); } catch (_) { return mpGroupUidsNew(); }
}

function mxGroupUidsWrite(map) {
  try { localStorage.setItem(MX_GROUP_UIDS_KEY, JSON.stringify(map)); } catch (err) { notesSaveFailed('groupUids', err); }
}

// A group's uid, minted the first time it is mentioned, whether or not it has a place record.
function mxGroupUidFor(name) {
  const map = mxGroupUids();
  if (!Object.prototype.hasOwnProperty.call(map, name)) { map[name] = 'g' + esRandomUid(); mxGroupUidsWrite(map); }
  return map[name];
}

function mxGroupUidPeek(name) {
  const map = mxGroupUids();
  return Object.prototype.hasOwnProperty.call(map, name) ? map[name] : null;
}

// The uids of just these groups, for an export of picked maps.
function mxGroupUidsOf(names) {
  const all = mxGroupUids(), out = mpGroupUidsNew();
  for (const n of names) if (Object.prototype.hasOwnProperty.call(all, n)) out[n] = all[n];
  return out;
}

// Called where a group's notes move to its new name.
function mxGroupUidsRename(from, to) { mxGroupUidsWrite(mpGroupUidsRename(mxGroupUids(), from, to)); }

// ─── The ids a mention needs ─────────────────────────────────────────────────

function mxMonsterUid(b) {
  if (!b.uid) {
    do b.uid = combatMintUid(); while (Object.values(cbState.blocks).some(x => x !== b && x.uid === b.uid));
    cbSaveSoon();
  }
  return b.uid;
}

// A room's uid at pick time. The open map's rooms get theirs now (they are assigned on autosave otherwise); a stored
// room with none gets one written into its record. A room in a column with none cannot be mentioned yet.
function mxRoomUid(sceneId, r) {
  if (!panesActive && currentScene && currentScene.id === sceneId) {
    const had = polygons.every(p => p.uid);
    esAssignUids(polygons);
    if (!had) scheduleAutoSave();
    const p = polygons.find(x => x.id === r.id);
    return p ? p.uid : null;
  }
  if (r.uid) return r.uid;
  if (panesActive && paneColumnOf(sceneId)) return null;
  const uid = esRandomUid();
  r.uid = uid;
  sceneStore.updateScene(sceneId, rec => {
    const p = (rec.polygons || []).find(x => x && x.id === r.id);
    if (!p || p.uid) return false;
    p.uid = uid;
  });
  return uid;
}

// ─── What an id resolves to ──────────────────────────────────────────────────

const _mxRes = (kind, id, name, note, key, target, extra) => ({ exists: true, kind, id, word: MX_WORDS[kind], name, note: note || '', key, target, ...extra });

// null when the entry is gone. A room of a map not read yet is assumed to exist (`pending`), so no label flashes red.
function mxResolve(kind, id) {
  if (kind === 'campaign') return id === 'campaign' ? _mxRes('campaign', id, t('Campaign'), notesCampaignGet(), 'campaign', { kind: 'campaign' }) : null;
  if (kind === 'map') {
    const s = allScenes.find(x => x.id === id);
    return s ? _mxRes('map', id, s.name, searchSceneNotes(id), 'map:' + id, { kind: 'map', id }) : null;
  }
  if (kind === 'room') {
    const [sceneId, uid] = id.split(':');
    if (!allScenes.some(x => x.id === sceneId)) return null;
    const rooms = searchRoomsOf(sceneId);
    if (!rooms) return { exists: true, pending: true, kind, id, word: MX_WORDS.room, name: null, note: '', key: null, target: null };
    const i = rooms.findIndex(r => r.uid === uid);
    if (i < 0) return null;
    const r = rooms[i];
    return _mxRes('room', id, r.name || t('Room {n}', { n: i + 1 }), r.desc, 'room:' + sceneId + ':' + r.id, { kind: 'room', id: r.id, scene: sceneId });
  }
  if (kind === 'group') {
    const name = mpGroupNameOf(mxGroupUids(), id);
    if (name === null || !_mxGroupNames().includes(name)) return null;
    return _mxRes('group', id, name, notesPlaceGet(name), 'place:' + name, { kind: 'place', id: name });
  }
  if (kind === 'road') {
    const r = worldRoadByUid(id);
    return r ? _mxRes('road', id, r.name, notesRoadGet(id), 'road:' + id, { kind: 'road', id }) : null;
  }
  if (kind === 'monster') {
    const b = Object.values(cbState.blocks).find(x => x.uid === id);
    return b ? _mxRes('monster', id, b.name, b.notes, 'monster:' + b.id, { kind: 'monster', id: b.id }) : null;
  }
  if (kind === 'entry') {
    const e = notesEntryGet(id);
    return e ? _mxRes(e.kind, id, e.name, e.note, 'entry:' + id, { kind: 'entry', id }) : null;
  }
  return null;
}

// The name a note's mention should show now, or null to leave it (the entry is gone, or its map is still unread).
function mxCurrentName(kind, id) {
  const r = mxResolve(kind, id);
  return r && r.name != null ? r.name : null;
}

// The stored text with its shown names brought up to date. A refresh that would pass the cap is refused.
function mxRefreshText(text) {
  return mpRefresh(text, mxCurrentName, notesCap());
}

function notesCap() { return typeof ROOM_DESC_MAX !== 'undefined' ? ROOM_DESC_MAX : 20000; }

// ─── The picker's list ───────────────────────────────────────────────────────

// Every entry a note can mention, as { kind, word, name, where, key, id() }: `id()` answers the id the stored mention
// carries and may mint one, so it is called only for the entry picked. `exceptKey` is the note being written.
function mxCandidates(exceptKey) {
  const out = [];
  const add = (kind, name, key, id, where, wordKind) => { if (key !== exceptKey) out.push({ kind, word: MX_WORDS[wordKind || kind], name, where: where || '', key, id }); };
  add('campaign', t('Campaign'), 'campaign', () => 'campaign');
  for (const name of _mxGroupNames()) add('group', name, 'place:' + name, () => mxGroupUidFor(name));
  for (const s of allScenes) {
    add('map', s.name, 'map:' + s.id, () => s.id);
    (searchRoomsOf(s.id) || []).forEach((r, i) => {
      if (!r.uid && panesActive && paneColumnOf(s.id)) return;
      add('room', r.name || t('Room {n}', { n: i + 1 }), 'room:' + s.id + ':' + r.id, () => { const u = mxRoomUid(s.id, r); return u ? s.id + ':' + u : null; }, s.name);
    });
  }
  for (const r of worldRoadRecords()) add('road', r.name, 'road:' + r.uid, () => r.uid);
  for (const b of Object.values(cbState.blocks)) add('monster', b.name, 'monster:' + b.id, () => mxMonsterUid(b));
  for (const e of notesEntriesAll()) add('entry', e.name, 'entry:' + e.id, () => e.id, '', e.kind);
  return out;
}

// ─── Appears in ──────────────────────────────────────────────────────────────

// The ref ("kind:id") the stored mentions of the entry `m` (a notesPanel meta) carry, or null when none can exist yet.
function mxRefOf(m) {
  const tg = m.tg;
  if (tg.kind === 'campaign') return mpRef('campaign', 'campaign');
  if (tg.kind === 'place') { const u = mxGroupUidPeek(tg.id); return u && mpRef('group', u); }
  if (tg.kind === 'road') return mpRef('road', tg.id);
  if (tg.kind === 'map') return mpRef('map', tg.id);
  if (tg.kind === 'entry') return mpRef('entry', tg.id);
  if (tg.kind === 'monster') return m.block && m.block.uid ? mpRef('monster', m.block.uid) : null;
  const rooms = searchRoomsOf(tg.scene) || [];
  const r = tg.own && m.room && m.room.uid ? m.room : rooms.find(x => x.id === tg.id);
  return r && r.uid ? mpRef('room', tg.scene + ':' + r.uid) : null;
}

// The notes that mention `ref`, as { key, name, word }, the note shown (`selfKey`) left out.
function mxAppearsIn(ref, selfKey) {
  if (!ref) return [];
  const out = [];
  for (const row of searchEntries()) {
    if (!row.text || row.key === selfKey || !mpFindRef(row.text, ref)) continue;
    const word = row.kind === 'campaign' ? 'Campaign' : MX_WORDS[row.kind === 'place' ? 'group' : row.kind];
    out.push({ key: row.key, name: row.kind === 'campaign' ? t('Campaign') : row.label || row.name, word, where: row.kind === 'room' ? row.where : '' });
  }
  return out;
}

// The uids of the monsters some note mentions, so the tree lists them under Monsters and NPCs.
function mxMentionedMonsters() {
  if (_mxMentioned.rev === _mxRev && _mxMentioned.set) return _mxMentioned.set;
  const set = new Set();
  for (const row of searchEntries()) for (const m of mpMentions(row.text)) if (m.kind === 'monster') set.add(m.id);
  _mxMentioned = { rev: _mxRev, set };
  return set;
}
