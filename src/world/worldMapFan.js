'use strict';
// worldMapFan.js — what a place holds, zoomed out: a hand of cards (its first three maps, then a "+N" card) in one
// compact spot clear of the walls and the name plate. The spot is worldMapPlan.js's search; this draws it, again
// whenever the labels are laid, and answers a press on a card. It writes nothing to any scene or place.
//
// ⚠ NAMES REACH THE DOM THROUGH textContent ONLY.

const _wmFans = new Map();       // place name → { el, sig }
const _wmFanMemo = new Map();    // place name → { key, spot }: the search is kept while its inputs hold still
let _wmFanTimer = 0;             // a single click waits here to see whether it is a double

function worldMapFanInit() {
  const layer = _wmLayers.fan;
  layer.addEventListener('mousedown', e => { if (e.button !== 2 && e.target.closest('.wm-fc')) e.stopPropagation(); });
  layer.addEventListener('click', _wmFanClick);
  layer.addEventListener('dblclick', _wmFanDbl);
}

function _wmFanClick(e) {
  const card = e.target.closest('.wm-fc');
  if (!card) return;
  e.stopPropagation();
  if (e.detail > 1) return;
  if (!card.dataset.id) { worldMapFlyToPlace(card.closest('.wm-fan').dataset.place); return; }
  const id = card.dataset.id;
  worldMapSelect({ sceneId: id, place: '' });
  clearTimeout(_wmFanTimer);
  _wmFanTimer = setTimeout(() => {
    const s = allScenes.find(x => x.id === id);
    if (worldMapOpen && s && s.worldPos) _wmFly({ cx: s.worldPos.x, cy: s.worldPos.y, z: Math.max(WM_SPLIT * 1.4, 1) }, 650);
  }, 260);
}

function _wmFanDbl(e) {
  const card = e.target.closest('.wm-fc');
  if (!card) return;
  e.stopPropagation();
  clearTimeout(_wmFanTimer);
  if (card.dataset.id) worldMapOpenScene(card.dataset.id);
}

// The DOM of one hand: a card per map, each carrying its own name for the hover plate.
function _wmFanBuild(el, ids) {
  const { shown, cards, more } = wmFanCards(ids.length);
  el.textContent = '';
  const rot = i => (cards === 1 ? 0 : -WM_FAN.tilt + 2 * WM_FAN.tilt * i / (cards - 1));
  for (let i = 0; i < cards; i++) {
    const c = document.createElement('div');
    c.className = 'wm-fc';
    c.style.setProperty('--l', i * WM_FAN.step + 'px');
    c.style.setProperty('--r', rot(i) + 'deg');
    c.style.setProperty('--ty', (i && i < cards - 1 ? -WM_FAN.lift : 0) + 'px');
    if (i < shown) {
      const s = allScenes.find(x => x.id === ids[i]), url = thumbURLs.get(ids[i]);
      c.dataset.id = ids[i];
      if (url) c.style.backgroundImage = 'url("' + url + '")';
      const n = document.createElement('span');
      n.className = 'wm-fcn';
      n.textContent = s ? s.name : '';
      c.appendChild(n);
    } else {
      c.classList.add('wm-fmore');
      c.textContent = '+' + more;
    }
    el.appendChild(c);
  }
}

// Laid with the labels, so the camera, the interface zoom and a redraw each move it. Only the places level shows it.
function worldMapFanLayout() {
  const layer = _wmLayers.fan;
  if (!layer || _wmCam.z >= WM_SPLIT || _wm.classList.contains('moving')) return;
  const z = _wmCam.z, zq = _wmZq(z), uz = _wmUz || 1, live = new Set();
  for (const p of _wmPlaceList) {
    if (!p.ids.length) continue;
    const outline = wmOutline(p.rec), plate = _wmPlateAt(p, z, outline), box = plate.spot && { x: plate.spot.x, y: plate.spot.y, w: plate.spot.w, h: plate.textH };
    const key = [zq.toFixed(4), uz, p.ids.length, outline.length, outline.reduce((t, v) => t + v.x * 7 + v.y * 13, 0).toFixed(1), box ? [box.x, box.y, box.w, box.h].map(v => v.toFixed(1)).join(',') : ''].join('|');
    let memo = _wmFanMemo.get(p.name);
    if (!memo || memo.key !== key) {
      const size = wmFanSize(p.ids.length);
      memo = { key, spot: wmFanSpot(outline, { w: size.w * uz, h: size.h * uz }, box, 1 / zq) };
      _wmFanMemo.set(p.name, memo);
    }
    if (!memo.spot) continue;
    let f = _wmFans.get(p.name);
    if (!f) {
      const el = document.createElement('div');
      el.className = 'wm-fan';
      layer.appendChild(el);
      f = { el, sig: '' };
      _wmFans.set(p.name, f);
    }
    const sig = p.ids.map(id => id + thumbURLs.get(id) + (allScenes.find(s => s.id === id) || {}).name).join('|');
    if (f.sig !== sig) { f.sig = sig; _wmFanBuild(f.el, p.ids); }
    f.el.dataset.place = p.name;
    f.el.style.setProperty('--gx', memo.spot.x + 'px');
    f.el.style.setProperty('--gy', memo.spot.y + 'px');
    f.el.style.setProperty('--gs', uz * memo.spot.scale);
    f.el.classList.toggle('dim', _wmPlaceDim(p.name));
    f.el.classList.toggle('editing', shapeEditMode && selectedPolygonId === p.rec.id);
    live.add(p.name);
  }
  for (const [name, f] of _wmFans) if (!live.has(name)) { f.el.remove(); _wmFans.delete(name); _wmFanMemo.delete(name); }
}
