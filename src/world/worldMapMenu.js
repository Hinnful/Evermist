'use strict';
// worldMapMenu.js — the right-click menu on the world map: what can be done to the scene, the place
// or the empty ground under the pointer. The rows reuse the library's own menu look.

let _wmMenu = null;
let _wmAddAt = null;             // where Add a scene puts the next scene, once, when the menu chose it

function worldMapMenuClose() {
  if (_wmMenu) { _wmMenu.remove(); _wmMenu = null; }
}

function _wmSceneRows(id) {
  const s = allScenes.find(x => x.id === id);
  if (!s) return [];
  const group = sanitizeGroupName(s.group);
  const placed = !!group, far = _wm.classList.contains('places');
  const el = far && !placed ? _wmEls.get('l' + id).lastChild : _wmEls.get('c' + id).lastChild;
  const rows = [
    { label: 'Open', run: () => worldMapOpenScene(id) },
    { label: 'Rename', off: far && placed, run: () => _wmRenameStart(el, 'scene', id) },
  ];
  if (group) rows.push({ label: 'Take out of its place', run: () => _wmTakeOut(id, group) });
  if (worldRoadOfScene(id)) rows.push({ label: 'Take off the road', run: () => worldMapRoadLeave(id) });
  rows.push({ label: 'Export this scene', run: () => worldBackupExport([id]) });
  rows.push({ sep: true });
  rows.push({ label: 'Delete scene', danger: true, off: _wmIsOpen(id), run: () => _wmDeletePicked([id]) });
  return rows;
}

// Out of its place: moved just past the outline's right edge, which is what leaving a place is.
function _wmTakeOut(id, group) {
  worldUndoPush();
  const b = wmPolyBounds(wmOutline(worldPlaceByName(group)));
  worldSceneSet(id, { worldPos: { x: Math.round(b.x + b.w + WM_CARD_W / 2 + WM_PAD), y: allScenes.find(s => s.id === id).worldPos.y } });
  worldAssignAll();
  worldMapRefresh();
}

// Several scenes picked: what can be done to them all.
function _wmPickRows(ids) {
  return [
    { label: t.plural(ids.length, 'Export {n} scene', 'Export {n} scenes'), run: () => worldBackupExport(ids), raw: true },
    { sep: true },
    { label: t.plural(ids.length, 'Delete {n} scene', 'Delete {n} scenes'), danger: true, raw: true, run: () => _wmDeletePicked(ids) },
  ];
}

function _wmPlaceRows(name) {
  return [
    { label: 'Rename', off: !_wmNameShown(name), run: () => _wmRenameStart(_wmEls.get('h' + name), 'place', name) },
    { label: 'Fit in view', run: () => worldMapFlyToPlace(name) },
    { sep: true },
    { label: 'Delete place', danger: true, run: () => worldPlaceDelete(worldPlaceByName(name).id) },
  ];
}

function _wmRoadRows(uid) {
  const rec = worldRoadByUid(uid);
  return [
    { label: 'Rename', run: () => _wmRenameStart(_wmEls.get('r' + uid), 'road', uid) },
    { label: 'Edit points', run: () => { worldMapSelect({ sceneId: null, place: '', road: uid }); enterShapeEditMode(rec.id); worldMapRefresh(); } },
    { sep: true },
    { label: 'Delete road', danger: true, run: () => worldMapRoadDelete(uid) },
  ];
}

// A corner of the open place under the pointer: the room code's own delete, which keeps three.
function _wmCornerRows(flat) {
  const poly = findActiveShape();
  return [{ label: 'Delete point', danger: true, off: poly.vertices.length <= 3,
           run: () => { selectedVertexIndex = flat; _wmWithCamera(deleteSelectedPart); } }];
}

function _wmGroundRows(at) {
  return [
    { label: 'Add a scene here', run: () => { _wmAddAt = at; document.getElementById('wm-add').click(); } },
    { label: 'Show everything', run: () => _wmFly(_wmOverview(), 650) },
  ];
}

function worldMapMenuOpen(e) {
  e.preventDefault();
  e.stopPropagation();
  worldMapMenuClose();
  if (_wmAnim || _wmEditing || e.target.isContentEditable) return;
  const g = _wmGrab(e);
  const at = _wmToWorld(e.clientX, e.clientY);
  // The ground is the room code's: a corner of the open place, or the inside of a place.
  const under = g.kind !== 'none' ? null : _wmWithCamera(() => {
    const poly = findActiveShape();
    const corner = poly && shapeEditMode ? findVertexAt(poly, at.x, at.y) : -1;
    return { corner, place: corner >= 0 ? null : findPolygonAt(at.x, at.y) };
  });
  let rows;
  const held = g.kind === 'card' || g.kind === 'lm' ? worldMapPicked() : [];
  if (held.length > 1 && held.includes(g.id)) rows = _wmPickRows(held);
  else if (g.kind === 'card' || g.kind === 'lm') { worldMapSelect({ sceneId: g.id, place: '' }); rows = _wmSceneRows(g.id); }
  else if (g.kind === 'road') { worldMapSelect({ sceneId: null, place: '', road: g.uid }); rows = _wmRoadRows(g.uid); }
  else if (under && under.corner >= 0) rows = _wmCornerRows(under.corner);
  else if (under && under.place) { worldMapSelect({ sceneId: null, place: under.place.name }); rows = _wmPlaceRows(under.place.name); }
  else if (g.kind === 'place') { worldMapSelect({ sceneId: null, place: g.name }); rows = _wmPlaceRows(g.name); }
  else rows = _wmGroundRows(at);
  const menu = document.createElement('div');
  menu.className = 'sm-menu wm-menu';
  menu.dataset.noI18n = '';
  for (const r of rows) {
    if (r.sep) { menu.insertAdjacentHTML('beforeend', '<div class="sm-msep"></div>'); continue; }
    const b = document.createElement('button');
    b.className = 'sm-mi' + (r.danger ? ' danger' : '');
    b.textContent = r.raw ? r.label : t(r.label);
    b.disabled = !!r.off;
    b.addEventListener('click', () => { worldMapMenuClose(); r.run(); });
    menu.appendChild(b);
  }
  menu.addEventListener('mousedown', ev => ev.stopPropagation());
  menu.addEventListener('contextmenu', ev => ev.preventDefault());
  document.body.appendChild(menu);
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = Math.max(4, Math.min(e.clientX, innerWidth - w - 4)) + 'px';
  menu.style.top = Math.max(4, Math.min(e.clientY, innerHeight - h - 4)) + 'px';
  _wmMenu = menu;
}

// A click anywhere else, the wheel, or the layer closing puts the menu away.
function worldMapMenuInit() {
  window.addEventListener('mousedown', e => { if (_wmMenu && !_wmMenu.contains(e.target)) worldMapMenuClose(); }, true);
  _wm.addEventListener('wheel', worldMapMenuClose, { passive: true });
  _wm.addEventListener('contextmenu', worldMapMenuOpen);
}
