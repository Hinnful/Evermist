'use strict';
// worldMapOpenBar.js — the bar over the one picked map: Open, and More for the map's menu. It follows the picked print
// and hides while the camera or a drag is moving things, zoomed out to places, and while searching.

let _wmBar = null;

function worldMapOpenBarInit() {
  _wmBar = document.createElement('div');
  _wmBar.id = 'wm-bar';
  _wmBar.dataset.noI18n = '';
  _wmBar.innerHTML =
    '<button class="wm-bar-open" title="' + t('Open') + '">' + uiIcon('open', 16, 1.9) + '<span>' + t('Open') + '</span></button>' +
    '<button class="wm-bar-more" title="' + t('More') + '">' + uiIcon('more', 16) + '</button>';
  _wmBar.addEventListener('mousedown', e => e.stopPropagation());
  _wmBar.querySelector('.wm-bar-open').addEventListener('click', () => {
    const id = worldMapPicked()[0];
    if (id) worldMapOpenScene(id);
  });
  // The menu hangs from the button that opened it.
  _wmBar.querySelector('.wm-bar-more').addEventListener('click', e => {
    const card = _wmPickedCard();
    if (!card) return;
    const r = e.currentTarget.getBoundingClientRect();
    worldMapMenuOpen({ target: card, clientX: r.left, clientY: r.bottom + 6, preventDefault() {}, stopPropagation() {} });
  });
  _wm.appendChild(_wmBar);
}

// The print of the one picked scene, or null.
function _wmPickedCard() {
  const picked = worldMapPicked();
  return picked.length === 1 ? _wmEls.get('c' + picked[0]) || null : null;
}

function worldMapOpenBarPlace() {
  if (!_wmBar) return;
  const card = worldMapOpen ? _wmPickedCard() : null;
  const show = !!card && !_wmAnim && !(_wmDrag && _wmDrag.moved) && !_wm.classList.contains('places') &&
               !document.body.classList.contains('searching');
  _wmBar.classList.toggle('on', show);
  if (!show) return;
  const r = card.getBoundingClientRect(), w = _wm.getBoundingClientRect();
  const z = parseFloat(getComputedStyle(_wmBar).zoom) || 1;
  _wmBar.style.left = (r.left + r.width / 2 - w.left) / z + 'px';
  _wmBar.style.top = Math.max(_wmBar.offsetHeight + 6, (r.top - w.top - 10) / z) + 'px';
}

// The things laid over the layer that follow what it shows: the bar over the picked map. They
// move with a flight, a drag and the prints' own glide, so they are placed every frame while the layer is up.
let _wmFollowing = false;
function worldMapFollow() {
  if (_wmFollowing) return;
  _wmFollowing = true;
  const step = () => {
    if (!worldMapOpen) { _wmFollowing = false; return; }
    worldMapOpenBarPlace();
    hintsCuesSync();
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
