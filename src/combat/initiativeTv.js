'use strict';
// initiativeTv.js — the fight table's Start fight / End fight: while a fight is started, the open fight's slots
// (initiativePlan.js) go to the TV, and player/initiativePanel.js draws them there. Not started at every start
// and never saved, so a fight being prepared never reaches the TV by itself. The last monster going down ends it.

const ITV_POLL_MS = 250;
let _itvOn = false;
let _itvSent = null;   // the slot list last sent, as JSON
let _itvTimer = 0;
let _itvLiving = null; // { fight, living } at the last tick while started

function initInitiativeTv() {
  const b = document.createElement('button');
  b.className = 'sm-hbtn';
  b.id = 'cb-tv';
  document.querySelector('#cb-fight .cb-head').insertBefore(b, document.getElementById('cb-add'));
  b.addEventListener('click', () => initiativeTvSet(!_itvOn));
  _itvButton();
}

// ⚠ Written through t(): the i18n pass runs once over static text, and this label changes with the state.
function _itvButton() {
  const b = document.getElementById('cb-tv');
  b.classList.toggle('on', _itvOn);
  b.setAttribute('aria-pressed', String(_itvOn));
  b.title = t(_itvOn ? 'Take the turn order off the TV' : 'Show the turn order on the TV');
  b.innerHTML = uiIcon(_itvOn ? 'stop' : 'play') + '<span></span>';
  b.querySelector('span').textContent = t(_itvOn ? 'End fight' : 'Start fight');
}

// The table has many writers (typing, drag, sort, a fight picked, a backup merged), so the slots are
// read on a clock while the fight is started and sent only when they change.
function initiativeTvSet(on) {
  _itvOn = !!on;
  _itvLiving = null;
  _itvButton();
  clearInterval(_itvTimer);
  _itvTimer = _itvOn ? setInterval(_itvTick, ITV_POLL_MS) : 0;
  initiativeTvResend();
}

// A map delete still pending is committed first, so its Undo is not replaced silently.
function _itvAutoEnd() {
  initiativeTvSet(false);
  commitPendingDelete();
  const undo = () => { hideUndoToast(); initiativeTvSet(true); };
  showUndoToast(t('All monsters are down. The turn order left the TV.'), undo, true);
  clearTimeout(smUndoTimer);
  smUndoTimer = setTimeout(() => { if (smToastUndo === undo) hideUndoToast(); }, 4200);
}

function _itvTick() {
  if (_itvOn) {
    const now = { fight: cbState.openId, living: initiativeLivingMonsters(cbState.rows) };
    const over = initiativeFightOver(_itvLiving, now);
    _itvLiving = now;
    if (over) { _itvAutoEnd(); return; }
  }
  // The Player and the two-map shell carry no translations, so the monster word travels in the slot.
  const word = t('Monster');
  const slots = _itvOn ? initiativeSlots(cbState.rows).map(s => s.name == null ? Object.assign({ word }, s) : s) : null;
  const key = JSON.stringify(slots);
  if (key === _itvSent) return;
  _itvSent = key;
  // ⚠ In two-map mode the panel goes to the shell, so it shows once across both halves.
  const msg = { type: 'initiative', slots };
  if (panesActive) { if (stageIsOpen()) _stageWindow.postMessage(msg, '*'); }
  else if (playerWindow && !playerWindow.closed) playerWindow.postMessage(msg, '*');
}

// A Player or shell that opened or reloaded holds nothing yet.
function initiativeTvResend() {
  if (isPlayer || isPane) return;
  _itvSent = null;
  _itvTick();
}
