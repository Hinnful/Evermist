'use strict';
// playersView.js — the DM's own map as the TV shows it. Holding H puts the
// fog at full strength (the DM's usual fog is thinned to 55% so the map stays readable), hides the
// room outlines and labels that ride the cursor canvas, and frames the screen in blue with a label
// so it is never mistaken for the working view. Releasing H puts the working view back.

let _pvHeld = false;

function initPlayersView() {
  document.addEventListener('keydown', e => {
    if (e.code !== 'KeyH' || e.ctrlKey || e.metaKey || e.altKey || worldMapOpen) return;
    const el = e.target;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
    _pvHeld = true;
    _pvApply();
  });
  document.addEventListener('keyup', e => { if (e.code === 'KeyH' && _pvHeld) { _pvHeld = false; _pvApply(); } });
  // A key released in another window never reaches this one.
  window.addEventListener('blur', () => { if (_pvHeld) { _pvHeld = false; _pvApply(); } });
}

function _pvApply() {
  const on = _pvHeld;
  if (on === playersViewOn) return;
  playersViewOn = on;
  document.body.classList.toggle('players-view', on);
  if (pixiFogLayer) pixiFogLayer.alpha = on ? 1 : FOG_OPACITY_DM;
  viewportDirty = true;
  scheduleRender();
}
