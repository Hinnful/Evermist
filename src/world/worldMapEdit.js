'use strict';
// worldMapEdit.js — what the DM does on the world map: pick, drag, drop, rename and add.
// The left button picks and drags, the middle button pans, the wheel zooms; the layer keeps every
// pointer and wheel event to itself so none reaches the map underneath (input.js). Drawing a place and
// editing its corners is worldMapShapes.js.

let _wmDrag = null;
let _wmDropEl = null;
let _wmEdit = null;              // { el, kind: 'scene' | 'place', key, old }

function worldMapEditInit() {
  _wm.addEventListener('mousedown', _wmDown);
  _wm.addEventListener('wheel', _wmWheel, { passive: false });
  _wm.addEventListener('dblclick', _wmDbl);
  _wm.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('mousemove', _wmMove);
  window.addEventListener('mouseup', _wmUp);
  document.addEventListener('keydown', worldMapKeys, true);

  const file = document.getElementById('wm-file-input');
  document.getElementById('wm-add').addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const files = Array.from(file.files || []);
    file.value = '';
    const spot = _wmAddAt, last = allScenes.find(s => s.id === worldMapPicked().slice(-1)[0]);
    _wmAddAt = null;
    if (!files.length) return;
    const from = { at: spot || (last ? last.worldPos : { x: _wmCam.cx, y: _wmCam.cy }), beside: !spot && !!last };
    const before = new Set(allScenes.map(s => s.id));
    addMapsToLibrary(files, from.at).then(() => _wmAddLand(allScenes.filter(s => !before.has(s.id)).map(s => s.id), from));
  });
  file.addEventListener('cancel', () => { _wmAddAt = null; });
}

// New scenes land one by one in the next clear spot, then the last is picked and brought into view at a zoom
// where scenes show.
function _wmAddLand(ids, from) {
  const taken = allScenes.filter(s => !ids.includes(s.id) && s.worldPos).map(s => wmCardRect(s.worldPos));
  let at = from.at, beside = from.beside;
  for (const id of ids) {
    at = wmFreeSpot(at, taken, beside);
    worldSceneSet(id, { worldPos: at });
    taken.push(wmCardRect(at));
    beside = true;
  }
  worldAssignAll();
  if (!worldMapOpen) return;
  if (!ids.length) { worldMapRefresh(); return; }
  worldMapPickSet(ids, ids[ids.length - 1]);
  const v = _wmView(), z = _wmCam.z < WM_SPLIT ? 1 : _wmCam.z;
  const sx = v.w / 2 + (at.x - _wmCam.cx) * _wmCam.z, sy = v.h / 2 + (at.y - _wmCam.cy) * _wmCam.z;
  const seen = Math.abs(sx - v.w / 2) < v.w / 2 - WM_CARD_W * _wmCam.z && Math.abs(sy - v.h / 2) < v.h / 2 - WM_CARD_H * _wmCam.z;
  if (_wmCam.z < WM_SPLIT || !seen) _wmFly({ cx: at.x, cy: at.y, z }, 500);
}

// ─── The pointer ─────────────────────────────────────────────────────────────
// A card, a name or a marker is the layer's own; the ground between them, and so every place's polygon,
// is the room code's (selectMouseDown and its kin), run on the world's camera.

function _wmGrab(e) {
  const t = e.target.closest('.wm-card, .wm-hl, .wm-lm');
  if (!t) {
    const road = e.target.closest('.roadhit, .wm-rn');
    return road ? { kind: 'road', uid: road.dataset.uid } : { kind: 'none' };
  }
  const onName = !!e.target.closest('.wm-nm, .wm-lbl, .wm-hl'), onDot = !!e.target.closest('.wm-dot');
  const c = t.classList;
  if (c.contains('wm-hl')) return { kind: 'place', name: t.dataset.place, onName, onDot };
  return { kind: c.contains('wm-card') ? 'card' : 'lm', id: t.dataset.id, onName, onDot };
}

const _wmAt = id => { const s = allScenes.find(x => x.id === id); return s ? { id, x: s.worldPos.x, y: s.worldPos.y } : null; };
const _wmMembers = name => allScenes.filter(s => sanitizeGroupName(s.group) === name).map(s => _wmAt(s.id));

function _wmDown(e) {
  e.stopPropagation();
  if (_wmAnim || e.target.isContentEditable) return;
  const base = { sx: e.clientX, sy: e.clientY, moved: false, shift: e.shiftKey };
  if (e.button === 1) {
    e.preventDefault();
    _wmDrag = { ...base, kind: 'pan', c0: { ..._wmCam } };
    _wm.classList.add('panning');
    return;
  }
  if (e.button !== 0) return;
  if (_wmTool !== 'select') { worldMapDrawDown(e, base); return; }
  const d = { ...base, ..._wmGrab(e) };
  if (d.kind === 'none' && worldBackgroundMoving()) { _wmDrag = { ...d, kind: 'bgmove', m0: worldBackgroundMeta() }; return; }
  if (d.kind === 'none' && e.shiftKey) { worldMapMarqueeStart(d); _wmDrag = d; return; }
  if (d.kind === 'none') { _wmGroundDown(e, d); return; }
  if (d.kind === 'road') { _wmRoadDown(e, d); return; }
  if (d.kind === 'card') {
    const w = _wmToWorld(e.clientX, e.clientY), s = _wmAt(d.id);
    if (!s) return;
    d.ox = w.x - s.x;
    d.oy = w.y - s.y;
  }
  if (d.kind === 'place') {
    d.p0 = _wmMembers(d.name);
    d.rec = worldPlaceByName(d.name);
    d.v0 = d.rec.vertices.map(v => ({ x: v.x, y: v.y }));
  }
  if (d.kind === 'lm') d.p0 = [_wmAt(d.id)].filter(Boolean);
  const held = d.kind === 'card' || d.kind === 'lm' ? worldMapPicked() : [];
  if (held.length > 1 && held.includes(d.id)) { d.kind = 'pick'; d.p0 = held.map(_wmAt).filter(Boolean); }
  _wmDrag = d;
}

// A road is picked by its line. Once it is open, its line is the room code's ground: corners, walls, bends.
// Ctrl+click opens it in one press, as it opens a place.
function _wmRoadDown(e, d) {
  const rec = worldRoadByUid(d.uid);
  if (!rec) return;
  const onCircle = rec.id === selectedPolygonId && _wmWithCamera(() => !!_cornerHitAt(rec, _wmToWorld(e.clientX, e.clientY)));
  if (rec.id === selectedPolygonId && (shapeEditMode || onCircle)) { _wmGroundDown(e, d); return; }
  if (e.ctrlKey) {
    worldMapSelect({ sceneId: null, place: '', road: d.uid });
    enterShapeEditMode(rec.id);
    worldMapRefresh();
    return;
  }
  _wmDrag = d;
}

// A press on the ground: the room code picks, grabs a corner, a wall, a box handle or a corner circle.
function _wmGroundDown(e, d) {
  const raw = _wmToWorld(e.clientX, e.clientY);
  d.kind = 'shapes';
  _wmWithCamera(() => selectMouseDown(raw, e));
  _wmSyncSelection();
  if (isDraggingPolygon && selectedPolygonId != null) d.members0 = _wmMembers(worldPlaceNameOfId(selectedPolygonId));
  _wmDrag = d;
}

// The cursor over the ground says what a press there would do, as it does on the map.
function worldMapHover(e) {
  if (_wmTool !== 'select' || _wmAnim || !e.target.closest) return;
  const ground = e.target === _wm || e.target === _wmWorld || !e.target.closest('.wm-card, .wm-hl, .wm-lm, .sm-menu, .roadhit, .wm-rn');
  _wm.style.cursor = ground && _wm.contains(e.target) ? _wmWithCamera(() => selectHoverCursor(_wmToWorld(e.clientX, e.clientY), e)) : '';
}

// While a place is carried, the scenes filed under it go with it.
function _wmCarry(d, dx, dy) {
  _wmLive = {};
  for (const o of d.members0 || d.p0) _wmLive[o.id] = { x: o.x + dx, y: o.y + dy };
}

function _wmMove(e) {
  const d = _wmDrag;
  if (!d) { worldMapDrawHover(e); worldMapHover(e); return; }
  const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
  if (!d.moved && Math.hypot(dx, dy) < 4) return;
  d.moved = true;
  if (d.kind === 'none' || d.kind === 'road') return;
  if (d.kind === 'marquee') { worldMapMarqueeMove(e, d); return; }
  if (d.kind === 'pan') {
    _wmCam.cx = d.c0.cx - dx / _wmCam.z;
    _wmCam.cy = d.c0.cy - dy / _wmCam.z;
    _wmApplyCam();
    return;
  }
  if (d.kind === 'bgmove') { worldBackgroundDragTo(d.m0, dx / _wmCam.z, dy / _wmCam.z); return; }
  if (d.kind === 'draw') { worldMapDrawMove(e, d); return; }
  _wm.classList.add('moving');
  if (d.kind === 'shapes') {
    const raw = _wmToWorld(e.clientX, e.clientY);
    _wmWithCamera(() => selectMouseMove(raw, e.clientX, e.clientY, e));
    if (isDraggingPolygon && d.members0 && dragOrigVerts) {
      const rec = findActiveShape();
      if (rec) { _wmCarry(d, rec.vertices[0].x - dragOrigVerts[0][0].x, rec.vertices[0].y - dragOrigVerts[0][0].y); _wmDraw(); }
    }
    return;
  }
  if (d.kind === 'place' || d.kind === 'lm' || d.kind === 'pick') {
    if (!d.pushed) { worldUndoPush(); d.pushed = true; }
    _wmCarry(d, dx / _wmCam.z, dy / _wmCam.z);
    if (d.kind === 'place') d.rec.vertices = d.v0.map(v => ({ x: v.x + dx / _wmCam.z, y: v.y + dy / _wmCam.z }));
    _wmDraw();
    return;
  }
  if (!d.pushed) { worldUndoPush(); d.pushed = true; }
  const c = _wmEls.get('c' + d.id), w = _wmToWorld(e.clientX, e.clientY);
  c.classList.add('dragging');
  _wmPx(c, '--px', w.x - d.ox - WM_CARD_W / 2);
  _wmPx(c, '--py', w.y - d.oy - WM_CARD_H / 2);
  if (_wmDropEl) _wmDropEl.classList.remove('drop');
  const under = document.elementFromPoint(e.clientX, e.clientY);
  _wmDropEl = under && under.closest('.wm-card.loose');
  if (_wmDropEl) _wmDropEl.classList.add('drop');
}

function _wmCommitLive() {
  const live = _wmLive;
  _wmLive = {};
  for (const id of Object.keys(live)) worldSceneSet(id, { worldPos: { x: Math.round(live[id].x), y: Math.round(live[id].y) } });
}

function _wmUp(e) {
  const d = _wmDrag;
  if (!d) return;
  _wmDrag = null;
  _wm.classList.remove('moving', 'panning');
  const target = _wmDropEl;
  _wmDropEl = null;
  if (target) target.classList.remove('drop');
  if (d.kind === 'draw') { worldMapDrawUp(e, d); return; }
  if (d.kind === 'bgmove') { if (d.moved) worldBackgroundDragEnd(); return; }
  if (d.kind === 'marquee') { worldMapMarqueeEnd(); return; }
  if (d.kind === 'shapes') {
    // ⚠ THE SCENES LAND FIRST: the room code's release re-files every scene against the new outline.
    if (d.moved && isDraggingPolygon) _wmCommitLive();
    _wmWithCamera(() => selectMouseUp());
    _wmSyncSelection();
    return;
  }
  if (!d.moved) { _wmClick(d); return; }
  if (d.kind === 'place' || d.kind === 'lm' || d.kind === 'pick') {
    if (d.kind !== 'place') for (const id of Object.keys(_wmLive)) _wmLive[id] = worldRoadsSettleScene(id, { x: Math.round(_wmLive[id].x), y: Math.round(_wmLive[id].y) });
    _wmCommitLive();
    worldPlaceCommit();
  } else if (d.kind === 'card') {
    _wmDrop(d, e, target);
  }
}

function _wmClick(d) {
  if (d.kind === 'card' || d.kind === 'lm' || d.kind === 'pick') { if (d.shift) worldMapPickToggle(d.id); else worldMapSelect({ sceneId: d.id, place: '' }); }
  else if (d.kind === 'place') worldMapSelect({ sceneId: null, place: d.name });
  else if (d.kind === 'road') worldMapSelect({ sceneId: null, place: '', road: d.uid });
  else if (d.kind === 'none') worldMapSelect({ sceneId: null, place: '' });
}

// A dropped scene is in whichever place's outline holds all of it. Dropped on a loose scene it makes a
// place of its own: the rectangle that fits both, named on the spot.
function _wmDrop(d, e, target) {
  const w = _wmToWorld(e.clientX, e.clientY);
  let pos = { x: w.x - d.ox, y: w.y - d.oy };
  const mate = target && allScenes.find(s => s.id === target.dataset.id);
  let fresh = null;
  if (mate) {
    pos = { x: mate.worldPos.x + WM_STEP_X, y: mate.worldPos.y };
    worldRoadsDetach(d.id);
    worldSceneSet(d.id, { worldPos: pos });
    const r = wmHullRect([mate.worldPos, pos]);
    fresh = worldPlaceCreate(wmRectShape(r.x, r.y, r.x + r.w, r.y + r.h));
    worldUndoDropLast();   // the drag's own step, taken before the move, undoes the move and the place as one
  } else {
    worldSceneSet(d.id, { worldPos: worldRoadsSettleScene(d.id, { x: Math.round(pos.x), y: Math.round(pos.y) }) });
    worldRoadsCommit();
    worldAssignAll();
  }
  _wmEls.get('c' + d.id).classList.remove('dragging');
  worldMapSelect(fresh ? { sceneId: null, place: fresh } : { sceneId: d.id, place: '' });
  if (fresh && _wmNameShown(fresh)) _wmRenameStart(_wmEls.get('h' + fresh), 'place', fresh);
}

function _wmWheel(e) {
  e.preventDefault();
  e.stopPropagation();
  if (_wmAnim) return;
  const r = _wm.getBoundingClientRect();
  _wmCam = wmZoomAround(_wmCam, _wmView(), e.clientX - r.left, e.clientY - r.top, e.deltaY, _wmFloor());
  _wmApplyCam();
}

// ─── Renaming ────────────────────────────────────────────────────────────────

function _wmDbl(e) {
  e.stopPropagation();
  if (_wmTool === 'poly' || _wmTool === 'cut' || _wmTool === 'road') { worldMapPathFinish(); return; }
  const name = e.target.closest('.wm-nm, .wm-lbl, .wm-hl, .wm-rn');
  if (name) {
    const host = name.closest('.wm-card, .wm-lm, .wm-hl, .wm-rn');
    if (host.classList.contains('wm-rn')) _wmRenameStart(name, 'road', host.dataset.uid);
    else if (host.classList.contains('wm-card') || host.classList.contains('wm-lm')) _wmRenameStart(name, 'scene', host.dataset.id);
    else _wmRenameStart(name, 'place', host.dataset.place);
    return;
  }
  const card = e.target.closest('.wm-card'), lm = e.target.closest('.wm-lm .wm-dot'), line = e.target.closest('.roadhit');
  const road = line ? worldRoadByUid(line.dataset.uid) : null;
  if (card) worldMapOpenScene(card.dataset.id);
  else if (lm) worldMapOpenScene(lm.parentElement.dataset.id);
  else if (road && !(road.id === selectedPolygonId && shapeEditMode)) {
    worldMapSelect({ sceneId: null, place: '', road: road.uid });
    enterShapeEditMode(road.id);
    worldMapRefresh();
  } else if (_wmTool === 'select' && !e.target.closest('.wm-lm')) {
    _wmWithCamera(() => selectDblClick(_wmToWorld(e.clientX, e.clientY)));
    _wmSyncSelection();
  }
}

function _wmRenameStart(el, kind, key) {
  if (_wmEdit) _wmRenameDone(true);
  _wmEdit = { el, kind, key, old: el.textContent };
  _wmEditing = el;
  el.contentEditable = 'true';
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  el.onblur = () => _wmRenameDone(true);
}

function _wmRenameDone(commit) {
  const ed = _wmEdit;
  if (!ed) return;
  _wmEdit = null;
  _wmEditing = null;
  ed.el.onblur = null;
  ed.el.contentEditable = 'false';
  const text = ed.el.textContent;
  ed.el.textContent = ed.old;
  if (commit && ed.kind === 'scene') renameScene(ed.key, text);
  else if (commit && ed.kind === 'road') worldRoadRename(ed.key, text);
  else if (commit) {
    const next = sanitizeGroupName(text);
    if (next && next !== ed.old) renameGroupAsking(ed.old, next);
  }
  worldMapRefresh();
}

// Keys while a name is being edited: Enter keeps it, Escape puts the old one back.
function worldMapEditKey(e) {
  if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); _wmRenameDone(true); }
  else if (e.code === 'Escape') { e.preventDefault(); _wmRenameDone(false); }
}
