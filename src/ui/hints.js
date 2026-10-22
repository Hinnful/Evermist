'use strict';
// hints.js — first-time hints: one callout toast at a time, each hint shown once ever. DM window only.
// A hint that falls due while another is up replaces it.
// ⚠ A hint is recorded as seen the moment it shows. The previous release ignores both keys.

const HINTS_SEEN_KEY = 'evermist.hintsSeen';
const HINTS_OFF_KEY = 'evermist.hintsOff';

let _hintCur = null;    // { id, el, place, blink } while one is up

function _hintsSeen() {
  try { const a = JSON.parse(localStorage.getItem(HINTS_SEEN_KEY)); return Array.isArray(a) ? a : []; } catch (_) { return []; }
}

function _hintsOff() {
  try { return localStorage.getItem(HINTS_OFF_KEY) === '1'; } catch (_) { return false; }
}

function _hintsMayShow(id) { return !_hintsOff() && !_hintsSeen().includes(id); }

function _hintDrop(cur) {
  cur.el.remove();
  if (cur.blink) cur.blink.classList.remove('hintcall-blink');
}

function hintClose(id) {
  if (!_hintCur || (id && _hintCur.id !== id)) return;
  _hintDrop(_hintCur);
  _hintCur = null;
}

// `place(el)` positions the toast and returns false when its anchor is missing, which leaves the hint unspent.
// `blink` is the id of a button that pulses while the toast is up, or null.
function _hintShow(id, title, body, blink, place) {
  if (!_hintsMayShow(id)) return;
  const el = document.createElement('div');
  el.className = 'hintcall hintcall-' + id;
  el.innerHTML = '<b></b><span></span><button type="button" class="sm-hbtn primary hintcall-ok" tabindex="-1"><span></span></button>';
  el.children[0].textContent = t(title);
  el.children[1].textContent = t(body);
  const ok = el.querySelector('.hintcall-ok');
  ok.firstChild.textContent = t('Got it');
  ok.onclick = () => hintClose(id);
  el.addEventListener('mousedown', e => e.preventDefault());   // a hint never takes focus
  const prev = _hintCur;
  _hintCur = { id, el, place, blink: null };
  document.body.appendChild(el);
  if (place(el) === false) { el.remove(); _hintCur = prev; return; }
  if (prev) _hintDrop(prev);
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
// btn-rect only feeds the Shape list and is never shown.
function _hintPlaceOver(buttonId) {
  return el => {
    const a = document.getElementById(buttonId).getBoundingClientRect();
    if (!a.width) return false;
    const z = parseFloat(getComputedStyle(el).zoom) || 1;
    el.style.left = (a.left + a.width / 2) / z + 'px';
    el.style.top = (a.top - 14) / z + 'px';
  };
}
const _hintPlaceRooms = _hintPlaceOver('btn-shape');

// A fog brush stroke ended (settleFogAfterStroke), or Reveal all was answered either way (revealAllMap).
function hintsRoomsAsk() {
  if (isPane || worldMapOpen || panesActive) return;
  if (polygons.some(p => !p.material && !p.light)) return;   // a map that has rooms already needs no telling
  _hintShow('rooms', 'Show one room at a time',
    'Draw a room with the Shape tool, then use its clouds to reveal just that room.', 'btn-shape', _hintPlaceRooms);
}

// A drawn shape became a room (commitDrawnShape), or the screen changed under the toast (world map, scene switch).
function hintsRoomsDone() { hintClose('rooms'); }

// ─── Seat alignment: Settings opened ─────────────────────────────────────────

// Left of the dock, or of the element itself when it is on the rail (an open pane lies between), level with it,
// the pointer on its right edge.
function _hintPlaceBeside(id, onRail) {
  return el => {
    const sec = document.getElementById(id), dock = document.getElementById('dock');
    if (!sec || !dock || !sec.getBoundingClientRect().height) return false;
    sec.scrollIntoView({ block: 'nearest' });
    const r = sec.getBoundingClientRect(), H = el.getBoundingClientRect().height;
    const z = parseFloat(getComputedStyle(el).zoom) || 1;
    // Level with the target, but kept inside the window: the world map button sits at its very top. The arrow slides.
    const cy = r.top + r.height / 2, top = Math.max(8, Math.min(innerHeight - H - 8, cy - H / 2));
    el.style.left = ((onRail ? r.left : dock.getBoundingClientRect().left) - 12) / z + 'px';
    el.style.top = top / z + 'px';
    el.style.setProperty('--a', Math.max(12, Math.min(H - 12, cy - top)) / z + 'px');
  };
}
const _hintPlaceSeat = _hintPlaceBeside('cp-sec-seat-align');

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
  hintsNextMapInit();
  const seat = document.getElementById('cp-sec-seat-align');
  if (seat) seat.addEventListener('click', e => { if (e.target.closest('.sa-hit')) hintClose('seat'); });
}
