'use strict';
// initiativeTv.js — the fight table's Start fight / End fight: while a fight is started, the open fight's slots
// (initiativePlan.js) go to the TV, and player/initiativePanel.js draws them there. Not started at every start
// and never saved, so a fight being prepared never reaches the TV by itself. Only the DM ends it.

const ITV_POLL_MS = 250;
let _itvOn = false;
let _itvSent = null;   // the slot list last sent, as JSON
let _itvTimer = 0;

function initInitiativeTv() {
  const b = document.createElement('button');
  b.className = 'sm-hbtn ic';
  b.id = 'cb-tv';
  document.querySelector('#cb-fight .cb-head').insertBefore(b, document.getElementById('cb-close'));
  b.addEventListener('click', () => initiativeTvSet(!_itvOn));
  _itvButton();
}

// An icon alone; the tooltip carries the words. ⚠ Written through t(): the i18n pass runs once over static text.
function _itvButton() {
  const b = document.getElementById('cb-tv');
  b.classList.toggle('on', _itvOn);
  b.setAttribute('aria-pressed', String(_itvOn));
  b.title = t(_itvOn ? 'End fight: take the turn order off the TV'
    : 'Start fight: show the turn order on the TV. Players and monsters with an initiative roll appear there. Dead monsters leave it.');
  b.innerHTML = uiIcon(_itvOn ? 'stop' : 'play');
}

function initiativeTvOn() { return _itvOn; }

// The table has many writers (typing, drag, sort, a fight picked, a backup merged), so the slots are
// read on a clock while the fight is started and sent only when they change.
function initiativeTvSet(on) {
  _itvOn = !!on;
  _itvButton();
  clearInterval(_itvTimer);
  _itvTimer = _itvOn ? setInterval(_itvTick, ITV_POLL_MS) : 0;
  initiativeTvResend();
}

function _itvTick() {
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
