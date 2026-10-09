'use strict';
// sceneList.js — the list of scenes the app holds, whatever shows it: loading it at startup, the
// thumbnails kept in step with it, the open scene's name in the dock, and the counter `switchScene`
// uses to drop a stale switch. The world map reads it.

let switchGeneration = 0;     // monotone counter; each switchScene call captures its
                               // own generation and aborts if a newer call has started

const thumbURLs = new Map(); // scene id → blob URL for thumbnail display

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function generateThumbnail(bitmap, w, h) {
  const W = 400, H = Math.round(W * h / w);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  c.getContext('2d').drawImage(bitmap, 0, 0, W, H);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
}

function sceneListInit() {
  loadGroupPrefs();
}

function updateTriggerName() {
  const el = document.getElementById('scene-dd-name');
  if (!el) return;
  if (panesActive) {
    // Reading order matches the columns. A column with no map yet says so, or the name reads
    // as one map while two columns are on screen.
    el.textContent = PANE_IDS
      .map(id => panes[id].sceneId
        ? ((allScenes.find(x => x.id === panes[id].sceneId) || {}).name || '?')
        : t('Pick a map'))
      .join('  ·  ');
    return;
  }
  el.textContent = currentScene ? currentScene.name : t(allScenes.length ? 'Select a scene' : 'No scenes');
}

// What every change to the list does: the dock's names, the thumbnails, the world map.
function sceneListChanged() {
  updateTriggerName();
  refreshTwoMapsButton();
  const ids = new Set(allScenes.map(s => s.id));
  for (const [id, url] of thumbURLs) {
    if (!ids.has(id)) { URL.revokeObjectURL(url); thumbURLs.delete(id); }
  }
  for (const s of allScenes) {
    if (!thumbURLs.has(s.id) && s.thumbnail) thumbURLs.set(s.id, URL.createObjectURL(s.thumbnail));
  }
  if (worldMapOpen) worldMapRefresh();
}

async function initScenes() {
  try { await sceneStore.initSceneDB(); }
  catch (err) {
    // ⚠ REPORTED, NEVER JUST LOGGED. Every save and every import fails from here on, and a DM
    // who is told nothing finds out when a session's reveals are gone.
    messageDialog({
      title: 'Evermist cannot reach its saved scenes',
      message: t('The scene database would not open, so maps cannot be saved or loaded this ' +
                 'session. Restarting the app usually clears it.') + ' (' + ((err && err.message) || err) + ')',
    });
    return;
  }
  allScenes = await sceneStore.listScenes();
  allScenes.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  sceneListChanged();
  const lastId = isPane
    ? new URLSearchParams(window.location.search).get('scene')
    : localStorage.getItem('evermist-current-scene-id');
  if (lastId && allScenes.find(s => s.id === lastId)) await switchScene(lastId);
}

if (typeof module !== 'undefined') module.exports = { escHtml };
