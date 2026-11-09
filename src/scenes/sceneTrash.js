'use strict';
// sceneTrash.js — Recently deleted on this computer: a deleted map's whole record kept 30 days in its own database,
// its animated file in userData/trash, and Restore putting both back with the road ends it held; a deleted music track
// the same way, its file in userData/trash/music. The rules are trashPlan.js; the list in Settings is trashPanel.js.

const sceneTrash = (() => {
  // ⚠ A DATABASE OF ITS OWN, never a store in `evermist`: a new store means a version bump, and the previous release's
  // open of `evermist` at version 1 then fails, losing it the whole library on a rollback.
  const DB_NAME = 'evermist-trash';
  const STORE = 'maps', TRACKS = 'tracks';
  let _dbP = null;

  function _db() {
    if (!_dbP) {
      _dbP = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = e => {
          e.target.result.createObjectStore(STORE, { keyPath: 'id' });
          e.target.result.createObjectStore(TRACKS, { keyPath: 'id' });
        };
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = e => reject(e.target.error);
        req.onblocked = () => reject(new Error('IndexedDB blocked'));
      });
      _dbP.catch(() => { _dbP = null; });
    }
    return _dbP;
  }

  // Resolves once the transaction commits, so a put that resolved is on disk before the scene goes.
  async function _tx(mode, fn, store = STORE) {
    const db = await _db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      let out;
      const req = fn(tx.objectStore(store));
      if (req) req.onsuccess = e => { out = e.target.result; };
      tx.oncomplete = () => resolve(out);
      tx.onabort = tx.onerror = e => reject(e.target.error);
    });
  }

  const _get = id => _tx('readonly', s => s.get(id));
  const _del = id => _tx('readwrite', s => s.delete(id));
  const _api = () => window.electronAPI;

  // [{ id, at, name }] without the records, newest first.
  async function _all() {
    const db = await _db();
    return new Promise((resolve, reject) => {
      const out = [];
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
      req.onsuccess = e => {
        const c = e.target.result;
        if (!c) { resolve(out.sort((a, b) => b.at - a.at)); return; }
        out.push({ id: c.value.id, at: c.value.at, name: c.value.name });
        c.continue();
      };
      req.onerror = e => reject(e.target.error);
    });
  }

  // The track entries [{ id, at, name, token, hash }], newest first.
  const _tracks = async () => ((await _tx('readonly', s => s.getAll(), TRACKS)) || []).sort((a, b) => b.at - a.at);
  const _delTrack = id => _tx('readwrite', s => s.delete(id), TRACKS);

  // The road ends each map holds, read before worldRoadsSceneGone opens them.
  function roadsOf(ids) {
    const roads = worldRoadRecords(), out = {};
    for (const id of ids) out[id] = trashRoadEnds(roads, id);
    return out;
  }

  // ⚠ THE ENTRY FIRST, then the scene, then the file: a crash in between leaves a duplicate, never a loss. The
  // start-up reconcile drops an entry whose map is still in the library.
  async function put(ids, at, roads) {
    for (const id of ids) {
      const rec = await sceneStore.loadScene(id);
      if (!rec) continue;
      await _tx('readwrite', s => s.put({ id, at, name: rec.name || '', rec, roads: roads[id] || [] }));
      await sceneStore.deleteScene(id);
      if (_api()) await _api().trashMapFile(id).catch(() => {});
    }
    trashPanelRefresh();
  }

  // ⚠ ONE RESTORE PER MAP AT A TIME: a sync tick restores a map marked restored, and one landing during the DM's own
  // Restore would put it on the list twice.
  const _restoring = new Map();
  function restore(id) {
    if (!_restoring.has(id)) _restoring.set(id, _restore(id).finally(() => _restoring.delete(id)));
    return _restoring.get(id);
  }

  // The map back in the library with its file, its place on the list and its road ends. False when it is not here.
  async function _restore(id) {
    const e = await _get(id);
    if (!e) return false;
    if (allScenes.some(s => s.id === id)) { await purge(id); return false; }
    await sceneStore.putScene(e.rec);
    if (_api()) await _api().untrashMapFile(id).catch(() => {});
    for (const held of e.roads) {
      const r = worldRoadByUid(held.uid);
      if (!r) continue;
      const o = trashReattach(r, id, held);
      r.ends = o.ends; r.scenes = o.scenes;
    }
    const { name, group, thumbnail, sortOrder, createdAt, mapType, worldPos } = e.rec;
    allScenes.splice(Math.min(sortOrder ?? allScenes.length, allScenes.length), 0, { id, name, group: group || '', thumbnail, sortOrder, createdAt, mapType, worldPos });
    allScenes.forEach((s, i) => { s.sortOrder = i; });
    persistSceneOrder();
    worldRoadsFollow();
    worldRoadsSave();
    worldAssignAll();
    await _del(id);
    sceneListChanged();
    trashPanelRefresh();
    return true;
  }

  // For good: the entry and its file in userData/trash.
  async function purge(id) {
    await _del(id);
    if (_api()) await _api().purgeTrashFile(id).catch(() => {});
  }

  // ⚠ THE ENTRY FIRST, then the move: a crash in between leaves an entry with no file, which Restore drops, never a
  // file nobody lists. `move(token)` takes the file out of the music folder and answers its hash, or false when it
  // did not. Answers the entry's id, or null.
  async function putTrack(name, at, hash, move) {
    const token = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + (/\.\w+$/.exec(name) || [''])[0].toLowerCase();
    const id = 'track:' + token;
    await _tx('readwrite', s => s.put({ id, at, name, token, hash }), TRACKS);
    let h;
    try { h = await move(token); } catch (err) { await _delTrack(id); throw err; }
    if (!h) { await _delTrack(id); return null; }
    if (h !== hash) await _tx('readwrite', s => s.put({ id, at, name, token, hash: h }), TRACKS);
    trashPanelRefresh();
    return id;
  }

  // The DM's or Claude's delete of a track.
  const trashTrack = name => putTrack(name, Date.now(), '', token => _api().trashMusicFile(name, token));

  // The track back in the music folder under its name, or " (2)" when that is taken. Answers that name, or null when it
  // is not here or its file did not move (the entry then stays, and goes at its 30 days). ⚠ With sync on the caller marks its deletion restored first (syncMusic.restoreHere).
  function restoreTrack(id) {
    if (!_restoring.has(id)) _restoring.set(id, _restoreTrack(id).finally(() => _restoring.delete(id)));
    return _restoring.get(id);
  }

  async function _restoreTrack(id) {
    const e = await _tx('readonly', s => s.get(id), TRACKS);
    if (!e) return null;
    let back;
    try { back = await _api().untrashMusicFile(e.token, e.name); } catch (err) { console.error('[trash]', err); return null; }
    await _delTrack(id);
    await _muRefreshTracks();
    trashPanelRefresh();
    return back;
  }

  async function purgeTrack(id) {
    const e = await _tx('readonly', s => s.get(id), TRACKS);
    await _delTrack(id);
    if (e && _api()) await _api().purgeTrashedMusic(e.token).catch(() => {});
  }

  // [{ id, hash }] of the tracks held, for sync.
  const trackHashes = async () => (await _tracks()).map(e => ({ id: e.id, hash: e.hash }));

  // The entries, minus any whose map is in the library again (an import of it, or a crash mid-put), which go.
  async function list() {
    const out = [];
    for (const e of await _all()) {
      if (allScenes.some(s => s.id === e.id)) await purge(e.id);
      else out.push(e);
    }
    for (const e of await _tracks()) out.push({ id: e.id, at: e.at, name: displayName(e.name), hash: e.hash });
    return out.sort((a, b) => b.at - a.at);
  }

  const ids = () => _tx('readonly', s => s.getAllKeys());

  async function purgeDue(now) {
    for (const id of trashDue(await _all(), now)) await purge(id);
    for (const id of trashDue(await _tracks(), now)) await purgeTrack(id);
  }

  async function emptyAll() {
    for (const e of await _all()) await purge(e.id);
    for (const e of await _tracks()) await purgeTrack(e.id);
    trashPanelRefresh();
  }

  // At start, once the library is loaded.
  async function reconcile() {
    await list();
    await purgeDue(Date.now());
  }

  return { roadsOf, put, restore, purge, putTrack, trashTrack, restoreTrack, purgeTrack, trackHashes, list, ids, purgeDue, emptyAll, reconcile };
})();
