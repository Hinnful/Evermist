'use strict';
// seatAlignment.js — Settings' Seat alignment: the TV from above with the open map on it and a
// chair on each side. The DM's chair is the laptop map's turn (mapTurn.js's setSeatTurn); the TV
// never changes. DM window only.

const SEAT_SIDES = [0, 90, 180, 270];
const SEAT_VIEW = { w: 196, h: 150, tvW: 104, tvH: 58, gap: 18 };
// Outward from the TV, by the seat's turn: bottom 0, right 90, top 180, left 270.
const SEAT_OUT = { 0: [0, 1], 90: [1, 0], 180: [0, -1], 270: [-1, 0] };

let _saSvg = null;
let _saHover = null;
let _saThumb = '';
let _saThumbFor = null;

function _saEl(tag, attrs, parent) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}

function _saThumbUrl() {
  if (currentScene !== _saThumbFor) {
    if (_saThumb) URL.revokeObjectURL(_saThumb);
    _saThumb = currentScene && currentScene.thumbnail ? URL.createObjectURL(currentScene.thumbnail) : '';
    _saThumbFor = currentScene;
  }
  return _saThumb;
}

function _saDrawTv(cx, cy) {
  const { tvW, tvH } = SEAT_VIEW;
  _saEl('rect', { class: 'sa-tv', x: cx - tvW / 2, y: cy - tvH / 2, width: tvW, height: tvH, rx: 3 }, _saSvg);
  const url = _saThumbUrl();
  if (!url) return;
  const clip = _saEl('clipPath', { id: 'sa-clip-tv' }, _saSvg);
  _saEl('rect', { x: cx - tvW / 2 + 2, y: cy - tvH / 2 + 2, width: tvW - 4, height: tvH - 4, rx: 2 }, clip);
  const pic = _saEl('g', { 'clip-path': 'url(#sa-clip-tv)', class: 'sa-pic' }, _saSvg);
  _saEl('image', { href: url, x: cx - tvW / 2 + 2, y: cy - tvH / 2 + 2, width: tvW - 4, height: tvH - 4 }, pic);
}

// A chair from above: the seat, and its back on the side away from the TV.
function _saDrawChair(s, cx, cy) {
  const { tvW, tvH, gap } = SEAT_VIEW;
  const [ox, oy] = SEAT_OUT[s];
  const x = cx + ox * (tvW / 2 + gap), y = cy + oy * (tvH / 2 + gap);
  const mine = s === seatTurn;
  const g = _saEl('g', { 'data-seat': s, class: 'sa-chair' + (mine ? ' on' : '') + (s === _saHover && !mine ? ' hov' : ''),
    transform: 'translate(' + x + ' ' + y + ') rotate(' + (-s) + ')' }, _saSvg);
  _saEl('rect', { class: 'sa-seat', x: -8, y: -8, width: 16, height: 14, rx: 3 }, g);
  _saEl('rect', { class: 'sa-back', x: -9, y: 7, width: 18, height: 4, rx: 2 }, g);
  // Under every chair, never beside a side one, where the pane's edge would cut it off.
  if (mine) _saEl('text', { class: 'sa-you', x, y: oy ? y + oy * 22 + 3 : y + 27, 'text-anchor': 'middle' }, _saSvg).textContent = t('You');
}

function _saDrawHits(cx, cy) {
  const { tvW, tvH, gap } = SEAT_VIEW;
  for (const s of SEAT_SIDES) {
    const [ox, oy] = SEAT_OUT[s];
    const x = cx + ox * (tvW / 2 + gap / 2), y = cy + oy * (tvH / 2 + gap / 2);
    const side = s % 180;
    const hit = _saEl('rect', { class: 'sa-hit', 'data-seat-pick': s, x: x - (side ? 18 : 30), y: y - (side ? 30 : 18),
      width: side ? 36 : 60, height: side ? 60 : 36 }, _saSvg);
    hit.addEventListener('mouseenter', () => { if (_saHover !== s) { _saHover = s; refreshSeatAlignment(); } });
    hit.addEventListener('click', () => setSeatTurn(s));
  }
}

function refreshSeatAlignment() {
  if (!_saSvg) return;
  const cx = SEAT_VIEW.w / 2, cy = SEAT_VIEW.h / 2;
  _saSvg.textContent = '';
  _saDrawTv(cx, cy);
  _saEl('text', { class: 'sa-cap', x: cx, y: cy + 3, 'text-anchor': 'middle' }, _saSvg).textContent = t('TV');
  for (const s of SEAT_SIDES) _saDrawChair(s, cx, cy);
  _saDrawHits(cx, cy);
}

function initSeatAlignment() {
  const host = document.getElementById('cp-sec-seat-align');
  if (!host) return;
  host.innerHTML = '<div class="dk-sh"><span class="cp-label">Seat alignment</span></div>' +
    '<div class="dk-blk"><span class="dk-sub">Where you sit at the TV</span></div>';
  _saSvg = _saEl('svg', { width: SEAT_VIEW.w, height: SEAT_VIEW.h, viewBox: '0 0 ' + SEAT_VIEW.w + ' ' + SEAT_VIEW.h });
  _saSvg.addEventListener('mouseleave', () => { _saHover = null; refreshSeatAlignment(); });
  host.querySelector('.dk-blk').appendChild(_saSvg);
  refreshSeatAlignment();
}
