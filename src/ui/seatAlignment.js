'use strict';
// seatAlignment.js — Settings' "Your seat at the TV": four icons, a TV with the DM's chair on one side. The chair
// is the laptop map's turn (mapTurn.js's setSeatTurn); the TV never changes. DM window only.

// The seat's turn, and the TV and chair drawn for it.
const SEAT_PICKS = [
  { turn: 0, title: 'Below the TV', tv: [3, 2.5, 10, 7], chair: [6, 11.5, 4, 2.5] },
  { turn: 180, title: 'Above the TV', tv: [3, 6.5, 10, 7], chair: [6, 2, 4, 2.5] },
  { turn: 270, title: 'Left of the TV', tv: [5.5, 4, 9, 8], chair: [1.5, 6, 2.5, 4] },
  { turn: 90, title: 'Right of the TV', tv: [1.5, 4, 9, 8], chair: [12, 6, 2.5, 4] },
];

function _saIcon(p) {
  const [x, y, w, h] = p.tv, [cx, cy, cw, ch] = p.chair;
  return '<svg width="15" height="15" viewBox="0 0 16 16"><rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h +
    '" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="' + cx + '" y="' + cy + '" width="' + cw +
    '" height="' + ch + '" rx=".8" fill="currentColor"/></svg>';
}

function refreshSeatAlignment() {
  document.querySelectorAll('#cp-seat-row [data-seat]').forEach(b => b.classList.toggle('active', +b.dataset.seat === seatTurn));
}

function initSeatAlignment() {
  const host = document.getElementById('cp-sec-seat-align');
  if (!host) return;
  host.innerHTML = '<span class="dk-sub"></span><div class="cp-iconrow cp-seg" id="cp-seat-row"></div>';
  host.firstChild.textContent = t('Your seat at the TV');
  const row = host.lastChild;
  for (const p of SEAT_PICKS) {
    const b = document.createElement('button');
    b.className = 'cp-iconbtn';
    b.dataset.seat = p.turn;
    b.title = t(p.title);
    b.innerHTML = _saIcon(p);
    b.addEventListener('click', () => setSeatTurn(p.turn));
    row.appendChild(b);
  }
  refreshSeatAlignment();
}
