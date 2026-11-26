'use strict';
// importJournal.js — What a running Import has overwritten, kept on disk until it ends, so an import cut short by a
// close, a quit or a reload is undone at the next start the way its Stop button undoes it.

const importJournal = (() => {
  // ⚠ A DATABASE OF ITS OWN, never a store in `evermist`: a new store means a version bump, and the previous release's
  // open of `evermist` at version 1 then fails. The previous release never opens this one.
  const DB_NAME = 'evermist-import';
  const RUN = 'run', MAPS = 'maps', RUN_KEY = 'run';
  const TOLD_KEY = 'evermist.importInterrupted';
  let _dbP = null;

  function _db() {
    if (!_dbP) {
      _dbP = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = e => {
          e.target.result.createObjectStore(RUN, { keyPath: 'id' });
          e.target.result.createObjectStore(MAPS, { keyPath: 'id' });
        };
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = e => reject(e.target.error);
        req.onblocked = () => reject(new Error('IndexedDB blocked'));
      });
      _dbP.catch(() => { _dbP = null; });
    }
    return _dbP;
  }

  // Resolves once the transaction commits, so the journal is on disk before the write it covers.
  async function _tx(stores, fn) {
    const db = await _db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, 'readwrite');
      let out;
      const req = fn(tx);
      if (req) req.onsuccess = e => { out = e.target.result; };
      tx.oncomplete = () => resolve(out);
      tx.onabort = tx.onerror = e => reject(e.target.error);
    });
  }

  function _all(store) {
    return _tx([store], tx => tx.objectStore(store).getAll());
  }

  // Before the first write: the new animated maps' files and the temporary `.import` files the import may leave.
  function start(run) {
    return _tx([RUN, MAPS], tx => {
      tx.objectStore(MAPS).clear();
      tx.objectStore(RUN).put({ id: RUN_KEY, created: [], createdVideos: run.createdVideos.slice(), temps: run.temps.slice() });
    });
  }

  // A matched map's record as it was, before the import writes over it.
  function snapshot(rec) {
    return _tx([MAPS], tx => { tx.objectStore(MAPS).put(rec); });
  }

  // A map the import adds, before it is written.
  function created(id) {
    return _tx([RUN], tx => {
      const s = tx.objectStore(RUN), req = s.get(RUN_KEY);
      req.onsuccess = () => { const r = req.result; if (r) { r.created.push(id); s.put(r); } };
    });
  }

  // An animated map whose new file is in place: its record and file agree, so a restart keeps it as imported.
  function settled(id) {
    return _tx([RUN, MAPS], tx => {
      tx.objectStore(MAPS).delete(id);
      const s = tx.objectStore(RUN), req = s.get(RUN_KEY);
      req.onsuccess = () => { const r = req.result; if (r) { r.temps = r.temps.filter(x => x.id !== id); s.put(r); } };
    });
  }

  function clear() {
    return _tx([RUN, MAPS], tx => { tx.objectStore(RUN).clear(); tx.objectStore(MAPS).clear(); });
  }

  // At start, before the scene list is read: an import that never ended is undone from its journal.
  async function recover() {
    try {
      const run = (await _all(RUN))[0];
      if (run) {
        // A reload while Claude's import ran leaves main still writing its file.
        await window.electronAPI.cancelBackup().catch(() => {});
        for (const rec of await _all(MAPS)) await sceneStore.putScene(rec);
        for (const id of run.created) if (await sceneStore.loadScene(id)) await sceneStore.deleteScene(id);
        for (const id of run.createdVideos) await window.electronAPI.deleteVideoFile(id);
        for (const x of run.temps) await window.electronAPI.settleImportVideo(x.id, x.ext, false).catch(() => {});
        await clear();
        try { localStorage.setItem(TOLD_KEY, '1'); } catch { /* the dialog below still shows this once */ }
        if (appInBackground) return;
      }
    } catch (err) {
      console.error('[import] putting back an interrupted import failed', err);
      return;
    }
    // Told on the first start the DM sees, not in the window Claude's call left unseen.
    if (appInBackground || localStorage.getItem(TOLD_KEY) !== '1') return;
    localStorage.removeItem(TOLD_KEY);
    messageDialog({
      title: 'The last import was interrupted',
      message: 'Evermist closed before the import finished, so your maps are back as they were before it.',
    });
  }

  return { start, snapshot, created, settled, clear, recover };
})();
