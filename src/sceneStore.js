'use strict';

// ─── IndexedDB scene storage ───────────────────────────────────────────────────
// One object store 'scenes' keyed by id. Full scene record:
//   { id, name, group, mapBlob, mapWidth, mapHeight, polygons, nextPolygonId,
//     effects, nextEffectId, baseFogPNG, gridConfig, thumbnail, createdAt, sortOrder }
//
// listScenes() uses a cursor and returns only lightweight metadata so the heavy
// map Blobs (up to 50 MB each) are never pulled into JS heap during listing.
// IDB Blobs are lazy — they don't load their binary data until explicitly read.

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
    const tx    = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    return { tx, store };
  }

  // Resolves on tx.oncomplete (durable commit) rather than req.onsuccess.
  // req.onsuccess fires before the transaction commits; if the tx later aborts
  // (quota exceeded, disk error) the write is lost but the promise already resolved.
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

  async function saveScene(scene) {
    const { store } = getTx('readwrite');
    await idbWrite(store.put(scene));
  }

  async function loadScene(id) {
    return idbRead(getTx('readonly').store.get(id));
  }

  // Read-modify-write of ONE stored scene, inside ONE readwrite transaction.
  //
  // ⚠ NEVER load-then-save FOR THIS. The two are separate transactions, so doAutoSave() can
  // land between them — it puts the whole in-memory currentScene, and the save half of the
  // pair then writes the record read before it and takes the fog with it. A rename or a
  // reorder during a game silently reverted the last reveal.
  //
  // saveScene() stays right for the scene the app HOLDS; this is for touching one field of
  // a scene it does not. `mutate` edits the stored record in place; returning false skips
  // the put, so an unchanged record costs no write. A scene deleted meanwhile is a no-op.
  function updateScene(id, mutate) {
    return new Promise((resolve, reject) => {
      const { tx, store } = getTx('readwrite');
      const req = store.get(id);
      req.onerror = e => reject(e.target.error);
      req.onsuccess = e => {
        const rec = e.target.result;
        if (!rec) return;
        if (mutate(rec) !== false) store.put(rec);
      };
      tx.oncomplete = () => resolve();
      tx.onabort    = e => reject(e.target.error);
    });
  }

  async function deleteScene(id) {
    const { store } = getTx('readwrite');
    await idbWrite(store.delete(id));
  }

  // Returns only lightweight metadata — never the map blob or full fog PNG.
  // Uses a cursor so the full records are not simultaneously in memory.
  function listScenes() {
    return new Promise((resolve, reject) => {
      const results = [];
      const tx  = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).openCursor();
      req.onsuccess = e => {
        const cursor = e.target.result;
        if (!cursor) { resolve(results); return; }
        const { id, name, group, thumbnail, sortOrder, createdAt, mapType } = cursor.value;
        results.push({ id, name, group: group || '', thumbnail, sortOrder, createdAt, mapType });
        cursor.continue();
      };
      req.onerror = e => reject(e.target.error);
    });
  }

  return { initSceneDB, saveScene, updateScene, loadScene, deleteScene, listScenes };
})();
