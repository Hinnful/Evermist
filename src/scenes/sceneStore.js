'use strict';

// ─── IndexedDB scene storage ───────────────────────────────────────────────────
// One object store 'scenes' keyed by id, holding the whole scene record.
//
// ⚠ listScenes() returns lightweight metadata only, over a cursor, so the heavy map Blobs are never
// pulled into the JS heap during a listing. IDB Blobs are lazy until read.

const sceneStore = (() => {
  const DB_NAME    = 'evermist';
  const DB_VERSION = 1;
  const STORE_NAME = 'scenes';

  let db = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORE_NAME)) {
          d.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess  = e => resolve(e.target.result);
      req.onerror    = e => reject(e.target.error);
      req.onblocked  = ()  => reject(new Error('IndexedDB blocked'));
    });
  }

  async function initSceneDB() {
    db = await openDB();
  }

  function getTx(mode) {
    // Without this every call after a failed open throws "cannot read properties of null", which
    // names nothing. initScenes reports the open failure; this keeps the rest legible.
    if (!db) throw new Error('The scene database is not open, so nothing can be read or saved.');
    const tx    = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    return { tx, store };
  }

  // ⚠ Resolves on tx.oncomplete, never req.onsuccess, which fires before the commit — an abort
  // then loses the write against a promise that already resolved.
  function idbWrite(req) {
    return new Promise((resolve, reject) => {
      req.onerror              = e => reject(e.target.error);
      req.transaction.onabort  = e => reject(e.target.error);
      req.transaction.oncomplete = () => resolve();
    });
  }

  // Read requests are fine resolving on onsuccess — reads can't be "lost".
  function idbRead(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  }

  // ⚠ REPORTED, NEVER JUST LOGGED: every caller only logs a failed write, and a full disk would lose a
  // session's reveals unseen. Once per launch, through the notes' own dialog.
  function _writeFailed(err) {
    if (typeof notesSaveFailed === 'function') notesSaveFailed('maps', err);
    return err;
  }

  // ⚠ STAMPS BY DIFF against the stored record, in the same transaction, so every save path times its
  // own edits. An import writes with putScene, which keeps the times that arrive.
  function saveScene(scene, opts) {
    const fogEdited = !!(opts && opts.fogEdited);
    return new Promise((resolve, reject) => {
      const { tx, store } = getTx('readwrite');
      const req = store.get(scene.id);
      req.onerror = e => reject(e.target.error);
      req.onsuccess = e => {
        const stored = e.target.result;
        scene.edits = esStamp(stored ? esSnapshot(stored) : null, scene, Date.now(), fogEdited);
        store.put(scene);
      };
      tx.oncomplete = () => { searchStale(scene.id); _syncNote(scene); resolve(); };
      tx.onabort    = e => reject(_writeFailed(e.target.error));
    });
  }

  // Sync's index hears of every write after it commits. updateScene holds no record, so it reads the stored one back.
  function _syncNote(rec) { if (typeof syncIndex !== 'undefined' && syncIndex.isOn()) syncIndex.sceneSaved(rec); }
  function _syncNoteId(id) {
    if (typeof syncIndex === 'undefined' || !syncIndex.isOn()) return;
    idbRead(getTx('readonly').store.get(id)).then(rec => { if (rec) syncIndex.sceneSaved(rec); }).catch(() => {});
  }

  async function putScene(scene) {
    const { store } = getTx('readwrite');
    try { await idbWrite(store.put(scene)); } catch (err) { throw _writeFailed(err); }
    searchStale(scene.id);
    _syncNote(scene);
  }

  async function loadScene(id) {
    return idbRead(getTx('readonly').store.get(id));
  }

  // Read-modify-write of ONE stored scene, inside ONE readwrite transaction.
  //
  // ⚠ NEVER load-then-save FOR THIS. They are separate transactions, so doAutoSave() can land
  // between them and the save half then writes the record read before it, taking the fog with it —
  // a rename during a game silently reverts the last reveal.
  //
  // saveScene() stays right for the scene the app HOLDS; this is for one field of a scene it does
  // not. `mutate` edits in place, and returning false skips the put.
  function updateScene(id, mutate) {
    return new Promise((resolve, reject) => {
      const { tx, store } = getTx('readwrite');
      const req = store.get(id);
      req.onerror = e => reject(e.target.error);
      req.onsuccess = e => {
        const rec = e.target.result;
        if (!rec) return;
        // ⚠ THE FULL STAMP, rooms and effects included: a note on a closed map's room and Claude's rooms on
        // it come through here, and an untimed edit loses to the other machine's older copy on import.
        const before = esSnapshot(rec), fogBefore = rec.baseFogBlob;
        if (mutate(rec) === false) return;
        rec.edits = esStamp(before, rec, Date.now(), rec.baseFogBlob !== fogBefore);
        store.put(rec);
      };
      tx.oncomplete = () => { searchStale(id); _syncNoteId(id); resolve(); };
      tx.onabort    = e => reject(_writeFailed(e.target.error));
    });
  }

  async function deleteScene(id) {
    const { store } = getTx('readwrite');
    await idbWrite(store.delete(id));
    searchStale(id);
    if (typeof syncIndex !== 'undefined') syncIndex.sceneDeleted(id);
  }

  // Returns only lightweight metadata — never the map blob or full fog PNG.
  // Uses a cursor so the full records are not simultaneously in memory.
  function listScenes() {
    return new Promise((resolve, reject) => {
      const results = [];
      const { tx } = getTx('readonly');
      const req = tx.objectStore(STORE_NAME).openCursor();
      req.onsuccess = e => {
        const cursor = e.target.result;
        if (!cursor) { resolve(results); return; }
        const { id, name, group, thumbnail, sortOrder, createdAt, mapType, worldPos } = cursor.value;
        results.push({ id, name, group: group || '', thumbnail, sortOrder, createdAt, mapType, worldPos });
        cursor.continue();
      };
      req.onerror = e => reject(e.target.error);
    });
  }

  // Every stored record, one at a time, for the start-up reconcile. Blobs stay lazy until read.
  function eachRecord(fn) {
    return new Promise((resolve, reject) => {
      const req = getTx('readonly').store.openCursor();
      req.onsuccess = e => {
        const cursor = e.target.result;
        if (!cursor) { resolve(); return; }
        fn(cursor.value);
        cursor.continue();
      };
      req.onerror = e => reject(e.target.error);
    });
  }

  return { initSceneDB, saveScene, putScene, updateScene, loadScene, deleteScene, listScenes, eachRecord };
})();
