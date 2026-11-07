'use strict';
// galleryStore.js — the gallery's pictures on disk: { id, name, blob, added } under their id.
//
// ⚠ A SEPARATE DATABASE, never the scenes' store: that store lists every record as a scene, and a
// version bump on it would lock the previous release out of every scene.

const galleryStore = (() => {
  const DB_NAME = 'evermist-gallery';

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('pics', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function run(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pics', mode);
      const req = fn(tx.objectStore('pics'));
      tx.oncomplete = () => { db.close(); resolve(req ? req.result : undefined); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    });
  }

  const all = async () => (await run('readonly', s => s.getAll())) || [];
  // Sync's index hears of a write after it commits.
  const put = async pic => { await run('readwrite', s => s.put(pic)); if (typeof syncIndex !== 'undefined') syncIndex.picSaved(pic); };
  const remove = async id => { await run('readwrite', s => s.delete(id)); if (typeof syncIndex !== 'undefined') syncIndex.picDeleted(id); };

  // Adds the pictures whose id is not held yet, in one transaction. Resolves the ones it added.
  async function addMissing(list) {
    const added = galleryMissing((await all()).map(p => p.id), list);
    if (added.length) await run('readwrite', s => { added.forEach(p => s.put(p)); });
    if (typeof syncIndex !== 'undefined') added.forEach(p => syncIndex.picSaved(p));
    return added;
  }

  return { all, put, remove, addMissing };
})();
