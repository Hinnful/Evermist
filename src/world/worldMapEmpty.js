'use strict';
// worldMapEmpty.js — the Campaign with no maps: a call to action in the middle of the layer, and the bar and the Notes tab
// put away what has nothing to act on (worldMap.css, body.wm-empty; dock.js).

function worldMapEmptySync() {
  const empty = worldMapOpen && !allScenes.length;
  document.body.classList.toggle('wm-empty', empty);
  document.getElementById('wm-empty').hidden = !empty;
  dockRefreshRail();
}

// The button does what the bar's Add does. Its mousedown stops short of the layer, which would drop the pick and close menus.
function worldMapEmptyInit() {
  const btn = document.getElementById('wm-empty-add');
  btn.addEventListener('mousedown', e => e.stopPropagation());
  btn.addEventListener('click', () => document.getElementById('wm-add').click());
}
