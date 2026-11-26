'use strict';
// initiativeTv.js — the fight table's Start fight / End fight: while a fight is started, its slots (initiativePlan.js)
// go to the TV, and player/initiativePanel.js draws them there. The started fight stays on the TV while the DM opens
// others; starting another replaces it. Not started at every start and never saved, so a fight being prepared never
// reaches the TV by itself. Only the DM ends it.

const ITV_POLL_MS = 250;
let _itvFight = null;  // the started fight's id
let _itvSent = null;   // the slot list last sent, as JSON
let _itvTimer = 0;

function initInitiativeTv() {
  const b = document.createElement('button');
  b.className = 'sm-hbtn ic';
  b.id = 'cb-tv';
  document.querySelector('#cb-fight .cb-head').insertBefore(b, document.getElementById('cb-close'));
  b.addEventListener('click', () => initiativeTvSet(!initiativeTvOn()));
  initiativeTvButton();
}

// An icon alone; the tooltip carries the words. ⚠ Written through t(): the i18n pass runs once over static text.
// It speaks for the open fight, so it reads Start on a fight that is open while another one is on the TV.
function initiativeTvButton() {
  const b = document.getElementById('cb-tv'), on = initiativeTvOn();
  if (!b) return;
  b.classList.toggle('on', on);
  b.setAttribute('aria-pressed', String(on));
  b.title = t(on ? 'End fight: take the turn order off the TV'
    : 'Start fight: show the turn order on the TV. Players and monsters with an initiative roll appear there. Dead monsters leave it.');
  b.innerHTML = uiIcon(on ? 'stop' : 'play');
}

// Whether the open fight is the one on the TV.
function initiativeTvOn() { return _itvFight !== null && _itvFight === cbState.openId; }
function initiativeTvFight() { return _itvFight; }

// The table has many writers (typing, drag, sort, a fight picked, a backup merged), so the slots are
// read on a clock while the fight is started and sent only when they change.
function initiativeTvSet(on) {
  _itvFight = on ? cbState.openId : null;
  initiativeTvButton();
  clearInterval(_itvTimer);
  _itvTimer = _itvFight ? setInterval(_itvTick, ITV_POLL_MS) : 0;
  initiativeTvResend();
}

function _itvTick() {
  const f = _itvFight && cbState.fights.find(x => x.id === _itvFight);
  // A started fight that was deleted takes its turn order with it.
  if (_itvFight && !f) { initiativeTvSet(false); return; }
  // The Player and the two-map shell carry no translations, so the monster word travels in the slot.
  const word = t('Monster');
  const slots = f ? initiativeSlots(combatFightRows(cbState, f)).map(s => s.name == null ? Object.assign({ word }, s) : s) : null;
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
