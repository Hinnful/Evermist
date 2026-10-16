'use strict';
// worldMapEmpty.js — the world map with no scenes: a callout over Add says where to begin, and the bar and the notes
// panel put away what has nothing to act on (worldMap.css, body.wm-empty).

function worldMapEmptySync() {
  const empty = worldMapOpen && !allScenes.length;
  document.body.classList.toggle('wm-empty', empty);
  document.getElementById('wm-empty').hidden = !empty;
}

// The callout hangs over Add, centred on it, and follows it.
function worldMapEmptyPlace() {
  const call = document.getElementById('wm-empty');
  if (call.hidden) return;
  const a = document.getElementById('wm-add').getBoundingClientRect();
  const z = parseFloat(getComputedStyle(call).zoom) || 1;
  call.style.left = (a.left + a.width / 2) / z + 'px';
  call.style.top = (a.top - 14) / z + 'px';
}
