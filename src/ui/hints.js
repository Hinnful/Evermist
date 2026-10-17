'use strict';
// hints.js — first-time hints: one callout toast, shown once ever and one per run. DM window only.
// ⚠ A hint is recorded as seen the moment it shows. The previous release ignores both keys.

const HINTS_SEEN_KEY = 'evermist.hintsSeen';
const HINTS_OFF_KEY = 'evermist.hintsOff';

let _hintRun = false;   // a hint has shown this run; no other shows until the app restarts
let _hintCur = null;    // { id, el, place, blink } while one is up

function _hintsSeen() {
  try { const a = JSON.parse(localStorage.getItem(HINTS_SEEN_KEY)); return Array.isArray(a) ? a : []; } catch (_) { return []; }
}

function _hintsOff() {
  try { return localStorage.getItem(HINTS_OFF_KEY) === '1'; } catch (_) { return false; }
}

function _hintsMayShow(id) { return !_hintRun && !_hintsOff() && !_hintsSeen().includes(id); }

function hintClose(id) {
  if (!_hintCur || (id && _hintCur.id !== id)) return;
  _hintCur.el.remove();
  if (_hintCur.blink) _hintCur.blink.classList.remove('hintcall-blink');
  _hintCur = null;
}

// `place(el)` positions the toast and returns false when its anchor is missing, which leaves the hint unspent.
// `blink` is the id of a button that pulses while the toast is up, or null.
function _hintShow(id, title, body, blink, place) {
  if (!_hintsMayShow(id)) return;
  const el = document.createElement('div');
  el.className = 'hintcall hintcall-' + id;
  el.innerHTML = '<b></b><span></span><button type="button" class="hintcall-ok" tabindex="-1"></button>';
  el.children[0].textContent = t(title);
  el.children[1].textContent = t(body);
  const ok = el.querySelector('.hintcall-ok');
  ok.textContent = t('Got it');
  ok.onclick = () => hintClose(id);
  el.addEventListener('mousedown', e => e.preventDefault());   // a hint never takes focus
  _hintCur = { id, el, place, blink: null };
  document.body.appendChild(el);
  if (place(el) === false) { el.remove(); _hintCur = null; return; }
  _hintRun = true;
  try { localStorage.setItem(HINTS_SEEN_KEY, JSON.stringify(_hintsSeen().concat(id))); } catch (_) {}
  const b = blink && document.getElementById(blink);
  if (b) {
    _hintCur.blink = b;
    b.classList.add('hintcall-blink');
    b.addEventListener('animationend', () => b.classList.remove('hintcall-blink'), { once: true });
  }
  requestAnimationFrame(() => el.classList.add('vis'));
}

function _hintReplace() { if (_hintCur) _hintCur.place(_hintCur.el); }

// ─── Rooms: the first brush stroke, or the answer to Reveal all ──────────────

// left/top live in the toast's own zoomed space, so the zoom is divided out.
function _hintPlaceRooms(el) {
  const a = document.getElementById('btn-shape').getBoundingClientRect();   // btn-rect only feeds the Shape list and is never shown
  if (!a.width) return false;
  const z = parseFloat(getComputedStyle(el).zoom) || 1;
  el.style.left = (a.left + a.width / 2) / z + 'px';
  el.style.top = (a.top - 14) / z + 'px';
}

// A fog brush stroke began (toolBrushStart), or Reveal all was answered either way (revealAllMap).
function hintsRoomsAsk() {
  if (isPane || worldMapOpen || panesActive) return;
  _hintShow('rooms', 'Show one room at a time',
    'Draw a room with the Shape tool, then use its clouds to reveal just that room.', 'btn-shape', _hintPlaceRooms);
}

// A drawn shape became a room (commitDrawnShape), or the screen changed under the toast (world map, scene switch).
function hintsRoomsDone() { hintClose('rooms'); }

// ─── Seat alignment: Settings opened ─────────────────────────────────────────

// Left of the dock, level with the section, the pointer on its right edge.
function _hintPlaceSeat(el) {
  const sec = document.getElementById('cp-sec-seat-align'), dock = document.getElementById('dock');
  if (!sec || !dock || !sec.getBoundingClientRect().height) return false;
  sec.scrollIntoView({ block: 'nearest' });
  const r = sec.getBoundingClientRect();
  const z = parseFloat(getComputedStyle(el).zoom) || 1;
  el.style.left = (dock.getBoundingClientRect().left - 12) / z + 'px';
  el.style.top = (r.top + r.height / 2) / z + 'px';
}

function _hintSeat() {
  _hintShow('seat', 'Sitting at the side of the TV?',
    'Seat alignment turns your map to face your chair. The TV never turns.', null, _hintPlaceSeat);
}

// ─── Settings' switch ────────────────────────────────────────────────────────

function _hintsInitSwitch() {
  const host = document.getElementById('settings-hints');
  if (!host) return;
  host.innerHTML = '<span class="dk-sub"></span><div class="cp-tabs" data-no-i18n>' +
    '<button type="button" class="cp-segtab" data-on="1"></button><button type="button" class="cp-segtab" data-on="0"></button></div>';
  host.firstChild.textContent = t('Hints');
  const tabs = host.querySelectorAll('.cp-segtab');
  tabs[0].textContent = t('On');
  tabs[1].textContent = t('Off');
  const paint = () => tabs.forEach(b => b.classList.toggle('active', (b.dataset.on === '1') !== _hintsOff()));
  tabs.forEach(b => b.addEventListener('click', () => {
    try { if (b.dataset.on === '1') localStorage.removeItem(HINTS_OFF_KEY); else localStorage.setItem(HINTS_OFF_KEY, '1'); } catch (_) {}
    if (_hintsOff()) hintClose();
    paint();
  }));
  paint();
}

function initHints() {
  _hintsInitSwitch();
  document.addEventListener('dockpane', e => { if (e.detail === 'settings') _hintSeat(); else hintClose('seat'); });
  window.addEventListener('resize', _hintReplace);
  const seat = document.getElementById('cp-sec-seat-align');
  if (seat) seat.addEventListener('click', e => { if (e.target.closest('.sa-hit')) hintClose('seat'); });
}
