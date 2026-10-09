'use strict';
// worldMapPick.js — more than one scene picked on the world map: Shift-click toggles a scene, Shift-drag on
// the ground draws a box that adds what it touches. Carrying the pick and its menu are worldMapEdit.js and
// worldMapMenu.js; the rules are worldPickPlan.js.

let _wmMarquee = null;           // the box's element, on the layer

function worldMapPickInit() {
  _wmMarquee = document.createElement('div');
  _wmMarquee.id = 'wm-marquee';
  _wm.appendChild(_wmMarquee);
}

// The scenes picked. A pick left over from an earlier selection is not one: it counts only while the
// scene the map last picked is in it.
function worldMapPicked() {
  const id = worldMapSel.sceneId;
  if (!id) return [];
  const live = new Set(allScenes.map(s => s.id));
  const ids = worldMapPick.filter(x => live.has(x));
  return ids.includes(id) ? ids : [id];
}

// `ids` is the whole pick and `focus` the scene the notes panel follows.
function worldMapPickSet(ids, focus) {
  worldMapSelect({ sceneId: focus, place: '' });
  worldMapPick = ids;
  worldMapRefresh();
}

function worldMapPickToggle(id) {
  const next = wpToggle(worldMapPicked(), id);
  worldMapPickSet(next, next.includes(id) ? id : next[next.length - 1] || null);
}

// ─── The box ─────────────────────────────────────────────────────────────────

function worldMapMarqueeStart(d) {
  d.kind = 'marquee';
  d.base = worldMapPicked();
}

function worldMapMarqueeMove(e, d) {
  if (selectedPolygonId != null) clearShapeSelection();
  const a = _wmToWorld(d.sx, d.sy), b = _wmToWorld(e.clientX, e.clientY);
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  const far = _wm.classList.contains('places');
  // Zoomed out only a scene shown as a diamond can be taken: the ones with no place, or on a road.
  const items = allScenes
    .filter(s => !far || _wmRoadPos[s.id] || !sanitizeGroupName(s.group))
    .map(s => { const p = _wmPos(s); return { id: s.id, x: p.x, y: p.y }; });
  const ids = wpMarqueeHits(d.base, { x, y, w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }, items, far, WM_CARD_W, WM_CARD_H);
  const v = _wm.getBoundingClientRect();
  Object.assign(_wmMarquee.style, {
    display: 'block', left: Math.min(d.sx, e.clientX) - v.left + 'px', top: Math.min(d.sy, e.clientY) - v.top + 'px',
    width: Math.abs(e.clientX - d.sx) + 'px', height: Math.abs(e.clientY - d.sy) + 'px',
  });
  worldMapSel = { sceneId: ids.length ? ids[ids.length - 1] : null, place: '' };
  worldMapPick = ids;
  worldMapRefresh();
}

function worldMapMarqueeEnd() {
  _wmMarquee.style.display = 'none';
}
