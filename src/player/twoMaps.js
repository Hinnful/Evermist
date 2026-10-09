'use strict';
// twoMaps.js — the Two maps toggle in the dock: into two columns from the open map, and back to one.

function twoMapsInit() {
  document.getElementById('btn-two-maps').onclick = toggleTwoMaps;
}

// ⚠ THE SECOND COLUMN OPENS EMPTY and waits to be picked - see docs/ARCHITECTURE.md.
async function toggleTwoMaps() {
  if (panesActive) { await exitPanes(paneSceneToKeep(panesSelected)); refreshTwoMapsButton(); return; }
  const openId = currentScene ? currentScene.id : null;
  if (!openId) {
    messageDialog({
      title: 'Open a map first',
      message: 'Two maps starts from the one you are on. Open one from the world map (M), then press Two maps again.',
    });
    return;
  }
  await enterPanes(openId, null);
  refreshTwoMapsButton();
  worldMapShow();   // the next thing to do is pick the second map, so the world map is already up
}

function refreshTwoMapsButton() {
  const btn = document.getElementById('btn-two-maps');
  if (!btn) return;
  btn.classList.toggle('active', panesActive);
  btn.title = panesActive ? 'Back to one map' : 'Show a second map beside this one';
}
