'use strict';

// ─── IndexedDB scene storage ───────────────────────────────────────────────────
// One object store 'scenes' keyed by id. Full scene record:
//   { id, name, mapBlob, mapWidth, mapHeight, polygons, nextPolygonId,
//     baseFogPNG, gridConfig, thumbnail, createdAt, sortOrder }
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
        const { id, name, thumbnail, sortOrder, createdAt, mapType } = cursor.value;
        results.push({ id, name, thumbnail, sortOrder, createdAt, mapType });
        cursor.continue();
      };
      req.onerror = e => reject(e.target.error);
    });
  }

  return { initSceneDB, saveScene, loadScene, deleteScene, listScenes };
})();
