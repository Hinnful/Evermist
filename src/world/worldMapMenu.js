'use strict';
// worldMapMenu.js — the right-click menu on the world map: what can be done to the scene, the place
// or the empty ground under the pointer. The rows reuse the library's own menu look.

let _wmMenu = null;
let _wmAddAt = null;             // where Add a scene puts the next scene, once, when the menu chose it
let _wmAddIn = '';               // the group the next maps are added into, once, when its menu chose it

function worldMapMenuClose() {
  if (_wmMenu) { _wmMenu.remove(); _wmMenu = null; }
}

// The blocks of a menu in order, a block left empty dropped and one separator between those that stay.
function _wmBlocks(...blocks) {
  const rows = [];
  for (const b of blocks.filter(x => x.length)) { if (rows.length) rows.push({ sep: true }); rows.push(...b); }
  return rows;
}

function _wmSceneRows(id) {
  const s = allScenes.find(x => x.id === id);
  if (!s) return [];
  const group = sanitizeGroupName(s.group);
  const placed = !!group, far = _wm.classList.contains('places');
  const el = far && !placed ? _wmEls.get('l' + id).lastChild : _wmEls.get('c' + id).lastChild;
  const organise = [];
  if (group) organise.push({ label: 'Remove from group', run: () => _wmTakeOut(id, group) });
  if (worldRoadOfScene(id)) organise.push({ label: 'Remove from road', run: () => worldMapRoadLeave(id) });
  if (!worldPartyOn(id)) organise.push({ label: 'Put the marker here', run: () => worldPartyPlace({ scene: id }) });
  return _wmBlocks(
    [{ label: 'Open', run: () => worldMapOpenScene(id) },
     { label: 'Rename', off: far && placed, run: () => _wmRenameStart(el, 'scene', id) },
     { label: 'Show notes', run: () => _wmOpenNotes('scene') }],
    organise,
    [{ label: 'Export map…', run: () => worldBackupExport([id]) }],
    [{ label: 'Delete map', danger: true, run: () => _wmDeletePicked([id]) }]);
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
  return _wmBlocks(
    [{ label: t.plural(ids.length, 'Group {n} map', 'Group {n} maps'), key: 'Ctrl+G', raw: true, run: worldMapGroupPicked }],
    [{ label: t.plural(ids.length, 'Export {n} map…', 'Export {n} maps…'), run: () => worldBackupExport(ids), raw: true }],
    [{ label: t.plural(ids.length, 'Delete {n} map', 'Delete {n} maps'), danger: true, raw: true, run: () => _wmDeletePicked(ids) }]);
}

function _wmPlaceRows(name, at) {
  return _wmBlocks(
    [{ label: 'Add maps…', run: () => { _wmAddIn = name; document.getElementById('wm-add').click(); } }],
    [{ label: 'Rename', off: !_wmNameShown(name), run: () => _wmRenameStart(_wmEls.get('h' + name), 'place', name) },
     { label: 'Show notes', run: () => _wmOpenNotes('place') }],
    [{ label: 'Put the marker here', run: () => worldPartyPlace(at) }],
    [{ label: 'Zoom to group', key: 'Shift+2', run: () => worldMapFlyToPlace(name) }],
    [{ label: 'Ungroup', key: 'Ctrl+Shift+G', run: () => worldPlaceUngroup(worldPlaceByName(name).id) }]);
}

function _wmRoadRows(uid) {
  const rec = worldRoadByUid(uid);
  return _wmBlocks(
    [{ label: 'Rename', run: () => _wmRenameStart(_wmEls.get('r' + uid), 'road', uid) },
     { label: 'Show notes', run: () => _wmOpenNotes('road') },
     { label: 'Edit points', run: () => { worldMapSelect({ sceneId: null, place: '', road: uid }); enterShapeEditMode(rec.id); worldMapRefresh(); } }],
    [{ label: 'Delete road', danger: true, run: () => worldMapRoadDelete(uid) }]);
}

// A corner of the open place under the pointer: the room code's own delete, which keeps three.
function _wmCornerRows(flat) {
  const poly = findActiveShape();
  return [{ label: 'Delete point', danger: true, off: poly.vertices.length <= 3,
           run: () => { selectedVertexIndex = flat; _wmWithCamera(deleteSelectedPart); } }];
}

// The Notes pane on what the menu was opened on, which is already picked. A map's own level is a crumb the pick must name;
// a place's and a road's follow the pick.
function _wmOpenNotes(level) {
  notesLevelPick = level === 'scene' ? 'scene' : null;
  dockOpen('notes');
  refreshRoomPanel();
}

// One map's room in a group of its own, centred on the click, named and ready to rename like one drawn by hand.
function _wmNewGroupAt(at) {
  const r = wmGroupRectAt(at);
  _wmCreatePlace(wmRectShape(r.x, r.y, r.x + r.w, r.y + r.h));
}

function _wmGroundRows(at) {
  return _wmBlocks(
    [{ label: 'Add maps…', run: () => { _wmAddAt = at; document.getElementById('wm-add').click(); } },
     { label: 'New group', run: () => _wmNewGroupAt(at) },
     { label: 'Put the marker here', run: () => worldPartyPlace(at) }],
    [{ label: 'Zoom to fit', key: 'Shift+1', run: () => _wmFly(_wmOverview(), 650) },
     { label: 'Background picture…', run: () => document.getElementById('wm-bg-pick').click() }]);
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
  else if (under && under.place) { worldMapSelect({ sceneId: null, place: under.place.name }); rows = _wmPlaceRows(under.place.name, at); }
  else if (g.kind === 'place') { worldMapSelect({ sceneId: null, place: g.name }); rows = _wmPlaceRows(g.name, at); }
  else rows = _wmGroundRows(at);
  _wmMenuShow(rows, e);
}

// The marker's own menu holds one row: remove it.
function worldMapPartyMenuOpen(e) {
  e.preventDefault();
  e.stopPropagation();
  worldMapMenuClose();
  if (_wmAnim || _wmEditing) return;
  _wmMenuShow([{ label: 'Remove the marker', run: worldPartyRemove }], e);
}

function _wmMenuShow(rows, e) {
  const menu = document.createElement('div');
  menu.className = 'sm-menu wm-menu';
  menu.dataset.noI18n = '';
  for (const r of rows) {
    if (r.sep) { menu.insertAdjacentHTML('beforeend', '<div class="sm-msep"></div>'); continue; }
    const b = document.createElement('button');
    b.className = 'sm-mi' + (r.danger ? ' danger' : '');
    const text = r.raw ? r.label : t(r.label);
    if (r.key) {
      // The key sits at the right of its row, as in the bar's lists.
      b.innerHTML = '<span class="nm"></span><span class="ky"></span>';
      b.firstChild.textContent = text;
      b.lastChild.textContent = r.key;
    } else b.textContent = text;
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
