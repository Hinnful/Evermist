'use strict';
// searchIndex.js — what the search can find: the entries read from the app's own state, the rooms and notes read
// out of the stored scene records (once, cached until a scene is saved), and the recent list.
//
// ⚠ A scene record's maps stay lazy blobs: only `polygons` and `notes` are looked at, and nothing is kept of the rest.

const SR_RECENT_KEY = 'evermist.searchRecent';
const _srRooms = new Map();       // scene id → { notes, rooms: [{ id, name, desc }] }
let _srFailed = new Set();        // scene ids the last read could not open
let _srReading = false;

function _srHere(id) { return !panesActive && currentScene && currentScene.id === id; }

// A scene was saved, imported or deleted: its cached read is stale. ⚠ READ AGAIN, NEVER JUST DROPPED: the Notes
// tree, a mention and "Appears in" read this cache and never ask for a read, so a dropped scene lost its
// rooms there until the search box opened. The open map is read live and needs none.
const _srRereadGen = new Map(), _srPending = new Set();
function searchStale(id) {
  // A column's store writes happen in its own frame; the shell's tree and search read their own cache.
  if (isPane && parent !== window) parent.postMessage({ type: 'pane-saved', pane: paneId, sceneId: id }, '*');
  const gen = (_srRereadGen.get(id) || 0) + 1;
  _srRereadGen.set(id, gen);
  mxBump();
  if (typeof notesMapStale === 'function') notesMapStale(id);
  // The old read stays until the new one lands, or a room being edited from the tree vanishes under the DM.
  if (_srHere(id) || !allScenes.some(s => s.id === id)) { _srRooms.delete(id); return; }
  _srReadOne(id, gen);
}

// One scene read in the background; the window repaints once it lands. A newer save's read wins.
function _srReadOne(id, gen) {
  _srPending.add(id);
  sceneStore.loadScene(id).then(rec => {
    if (!rec || (_srRereadGen.get(id) || 0) !== gen || _srHere(id)) return;
    _srRooms.set(id, _srFromRecord(rec));
    mxBump();
    if (typeof nwIsOpen === 'function' && nwIsOpen()) refreshRoomPanel();
  }).catch(err => { _srFailed.add(id); console.error(err); }).finally(() => _srPending.delete(id));
}

// A scene nobody holds and nothing has read, typically the map just left, whose last save landed while it
// was still open: read it now, once.
function _srWant(id) {
  if (_srHere(id) || _srRooms.has(id) || _srPending.has(id) || _srFailed.has(id) || _srReading) return;
  if (!allScenes.some(s => s.id === id)) return;
  const gen = (_srRereadGen.get(id) || 0) + 1;
  _srRereadGen.set(id, gen);
  _srReadOne(id, gen);
}

// Every room, named or not, in list order: the Notes tree's rooms. Effects and lights are not rooms.
function _srRoomList(polys) {
  return polys.filter(p => p && !p.material && !p.light).map(p => ({ id: p.id, uid: p.uid || '', name: p.name || '', desc: p.desc || '' }));
}

// A scene's rooms for the Notes tree: the open map live, a stored one from the read, null until it is read.
function searchRoomsOf(id) {
  if (_srHere(id)) return _srRoomList(polygons);
  _srWant(id);
  const r = _srRooms.get(id);
  return r ? r.all : null;
}

function _srFromRecord(rec) {
  return {
    notes: String((rec && rec.notes) || ''),
    rooms: ((rec && rec.polygons) || []).filter(p => p && (p.name || p.desc)).map(p => ({ id: p.id, name: p.name || '', desc: p.desc || '' })),
    all: _srRoomList((rec && rec.polygons) || []),
  };
}

// The scenes not yet read, one at a time. `onStep(done, total)` after each; resolves to the ids that failed.
async function searchReadScenes(onStep) {
  const todo = allScenes.filter(s => !_srHere(s.id) && !_srRooms.has(s.id));
  _srFailed = new Set();
  let done = 0;
  _srReading = true;
  try {
    for (const s of todo) {
      try { _srRooms.set(s.id, _srFromRecord(await sceneStore.loadScene(s.id))); } catch (_) { _srFailed.add(s.id); }
      if (onStep) onStep(++done, todo.length);
    }
  } finally { _srReading = false; }
  return [..._srFailed];
}

// True while stored scenes are being read, so what is built from them may still lack some.
function searchReading() { return _srReading; }

// A map's notes as stored, '' while it is unread.
function searchSceneNotes(id) { return _srScene(id).notes; }

function _srScene(id) {
  if (_srHere(id)) return _srFromRecord({ notes: currentScene.notes, polygons });
  _srWant(id);
  return _srRooms.get(id) || { notes: '', rooms: [] };
}

function searchEntries() {
  const out = [];
  const campaign = notesCampaignGet();
  if (campaign) out.push({ key: 'campaign', kind: 'campaign', name: t('Campaign notes'), where: '', text: campaign });
  for (const s of allScenes) {
    const group = sanitizeGroupName(s.group), r = _srScene(s.id);
    out.push({ key: 'map:' + s.id, kind: 'map', id: s.id, name: s.name, where: group, text: r.notes });
    for (const p of r.rooms) out.push({ key: 'room:' + s.id + ':' + p.id, kind: 'room', id: s.id, roomId: p.id, name: p.name, label: p.name || t('Room'), where: s.name, text: p.desc });
  }
  for (const p of worldPlaceRecords()) {
    const n = allScenes.filter(s => sanitizeGroupName(s.group) === p.name).length;
    out.push({ key: 'place:' + p.name, kind: 'place', id: p.name, name: p.name, where: t.plural(n, '{n} map', '{n} maps'), text: notesPlaceGet(p.name) });
  }
  for (const r of worldRoadRecords()) out.push({ key: 'road:' + r.uid, kind: 'road', id: r.uid, name: r.name, where: t('Road'), text: notesRoadGet(r.uid) });
  for (const b of Object.values(cbState.blocks)) {
    out.push({ key: 'monster:' + b.id, kind: 'monster', id: b.id, name: b.name, where: t('CR {cr}', { cr: bsCr(b) }) + ' · ' + t(bsType(b)), text: b.notes || '' });
  }
  out.push(...spNoteRows(notesEntriesAll(), k => t(k === 'faction' ? 'Factions' : 'Lore')));
  for (const f of cbState.fights) out.push({ key: 'fight:' + f.id, kind: 'fight', id: f.id, name: _cfName(f), where: _cfCount(f), text: '' });
  for (const m of _muTracks) out.push({ key: 'music:' + m.name, kind: 'music', id: m.name, name: musicLabel(m.name), where: musicGroupOf(m.name), text: '' });
  for (const p of galleryList()) out.push({ key: 'picture:' + p.id, kind: 'picture', id: p.id, name: p.name, where: '', text: '' });
  return out;
}

function searchRecentKeys() {
  try { const l = JSON.parse(localStorage.getItem(SR_RECENT_KEY)); return Array.isArray(l) ? l.filter(k => typeof k === 'string') : []; } catch (_) { return []; }
}

// Something was opened, through the search or the app's own way in.
function searchRecentAdd(key) {
  try { localStorage.setItem(SR_RECENT_KEY, JSON.stringify(spRecentAdd(searchRecentKeys(), key))); } catch (_) {}
}
