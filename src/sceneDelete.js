'use strict';
// sceneDelete.js — the trash and its undo.

let smPending = null;            // deferred delete: { items:[{id,index,meta}], ids:[…] }
let smUndoTimer = null;

// ── Delete with undo ──────────────────────────────────────────────────────────
// The trash removes scenes from the list at once but DEFERS the real IndexedDB deletion so Undo
// can cancel it. A new delete finalises the previous one, as does beforeunload.
function deleteScenesWithUndo(ids) {
  const items = ids
    .map(id => ({ id, index: allScenes.findIndex(s => s.id === id), meta: allScenes.find(s => s.id === id) }))
    .filter(x => x.index !== -1 && x.meta)
    .sort((a, b) => a.index - b.index);
  if (!items.length) return;

  commitPendingDelete(); // finalise anything still pending from a previous delete

  const idset = new Set(items.map(x => x.id));
  allScenes = allScenes.filter(s => !idset.has(s.id));
  smSelectedIds.clear();

  // If the loaded scene was among those deleted, switch away (data stays in IDB
  // until the delete is committed, so Undo can still bring it back).
  if (currentScene && idset.has(currentScene.id)) handleCurrentDeleted();

  smPending = { items, ids: items.map(x => x.id) };
  showUndoToast(items.length === 1 ? `"${items[0].meta.name}" removed` : `${items.length} scenes removed`);
  clearTimeout(smUndoTimer);
  smUndoTimer = setTimeout(commitPendingDelete, 4200);
  renderSceneManager();
}

function handleCurrentDeleted() {
  currentScene = null;
  cleanupVideo();
  if (mapBitmap) { try { mapBitmap.close(); } catch (e) {} }
  mapBitmap = null; mapOffscreen = null; mapWidth = 0; mapHeight = 0;
  polygons = []; nextPolygonId = 1;
  clearEffects(); nextEffectId = 1;
  clearShapeSelection();
  if (typeof resetRoomLabelCache === 'function') resetRoomLabelCache();
  if (typeof refreshRoomPanel === 'function') refreshRoomPanel();
  landing.style.display = '';
  if (!isPlayer) container.style.cursor = 'default';
  localStorage.removeItem('evermist-current-scene-id');
  if (allScenes.length) switchScene(allScenes[0].id).catch(err => console.error('switchScene failed:', err));
}

function undoDelete() {
  if (!smPending) return;
  clearTimeout(smUndoTimer);
  for (const it of smPending.items) {
    allScenes.splice(Math.min(it.index, allScenes.length), 0, it.meta);
  }
  allScenes.forEach((s, i) => { s.sortOrder = i; });
  persistSceneOrder();
  smPending = null;
  hideUndoToast();
  renderSceneManager();
}

function commitPendingDelete() {
  if (!smPending) return;
  const ids = smPending.ids;
  smPending = null;
  clearTimeout(smUndoTimer);
  hideUndoToast();
  for (const id of ids) {
    sceneStore.deleteScene(id).catch(() => {});
    if (window.electronAPI) window.electronAPI.deleteVideoFile(id).catch(() => {});
    if (thumbURLs.has(id)) { URL.revokeObjectURL(thumbURLs.get(id)); thumbURLs.delete(id); }
  }
}

function showUndoToast(msg) {
  const t = document.getElementById('scene-undo-toast');
  if (!t) return;
  t.querySelector('.undo-msg').textContent = msg;
  t.style.display = '';
  const bar = t.querySelector('.undo-bar');
  bar.style.animation = 'none';
  void bar.offsetWidth; // reflow so the 4s timer bar restarts on each delete
  bar.style.animation = 'smUndoTimer 4s linear forwards';
}

function hideUndoToast() {
  const t = document.getElementById('scene-undo-toast');
  if (t) t.style.display = 'none';
}
