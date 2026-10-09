'use strict';
// worldMap.js — the world map: a layer of DOM over the map, with the places drawn over it by the
// room code. A place keeps its polygon zoomed out, where its scenes stay as prints and its name shows. The camera,
// the render and the opening and closing live here; worldMapEdit.js holds the pointer, the renames
// and the toolbar.
//
// ⚠ NAMES REACH THE DOM THROUGH textContent ONLY: a scene or place name is the DM's own text.

let _wm = null;                  // #wm, the layer
let _wmWorld = null;             // #wm-world, the layer that pans and scales
const _wmLayers = {};            // hull, card and mark
const _wmEls = new Map();        // key → element, kept across renders so a move can animate
let _wmCam = { cx: 0, cy: 0, z: 1 };
let _wmAnim = false;
let _wmQuery = '';
let _wmPlaceList = [];           // the places as the last draw found them
let _wmLive = {};                // id → position while a drag is under way
let _wmRoadPos = Object.create(null);  // id → spot on its road, for every scene a road holds
let _wmPre = null;               // the shape being drawn: { verts, open }
let _wmKept = null;              // the room selection the map had when this layer opened
let _wmTool = 'select';          // the toolbar's `shape` as the layer reads it: select, rect, circle, poly or cut
let _wmHeld = null;              // the scene's tool, placement mode and repair, put back when the layer closes
let _wmEditing = null;           // the element whose text is being edited
let _wmExt = null;               // how far the map reaches, kept until a draw or the backdrop changes it
let _wmPickSet = new Set();      // the scenes picked, as the last draw found them
let _wmUz = 1;                   // the interface zoom, which the scene prints and names follow
const _wmPlateMemo = new Map();  // place name → its plate, kept while its shape, text and zoom hold still

const WM_ICON_ROAD = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19c5-1 2-7 7-8s3-6 7-7" stroke-dasharray="3 2.5"/></svg>';
const WM_ICON_PLACE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="8" height="7" rx="1.5"/><rect x="13" y="4" width="8" height="7" rx="1.5"/><rect x="3" y="13" width="8" height="7" rx="1.5"/><rect x="13" y="13" width="8" height="7" rx="1.5"/></svg>';

function worldMapInit() {
  _wm = document.getElementById('wm');
  if (!_wm) return;
  _wmWorld = document.getElementById('wm-world');
  for (const k of ['hull', 'card', 'mark', 'rn', 'edit']) _wmLayers[k] = document.getElementById('wm-' + k);
  window.addEventListener('resize', () => { if (worldMapOpen) _wmApplyCam(); });
  worldMistInit();
  worldMapEditInit();
  worldMapRoadsInit();
  worldMapMenuInit();
  worldBackgroundInit();
  worldMapPickInit();
  worldBackupInit();
  worldMapColumnsInit();
  worldMapFindInit();
}

const _wmView = () => ({ w: _wm.clientWidth || innerWidth, h: _wm.clientHeight || innerHeight });

// ─── What is open ────────────────────────────────────────────────────────────

function _wmIsOpen(id) {
  return panesActive ? !!paneColumnOf(id) : !!(currentScene && currentScene.id === id);
}

// The scene Esc and the button return to. With two maps on the shell holds none, so nothing returns.
function _wmReturnScene() {
  return !panesActive && currentScene ? allScenes.find(s => s.id === currentScene.id) || null : null;
}

const _wmPos = s => _wmLive[s.id] || _wmRoadPos[s.id] || s.worldPos;

// Every place, with the scenes filed under it.
function _wmPlaces() {
  return worldPlaceRecords().map(rec => {
    const outline = wmOutline(rec);
    return {
      name: rec.name, rec, bounds: wmPolyBounds(outline), centre: wmPolyCentre(outline),
      ids: allScenes.filter(s => sanitizeGroupName(s.group) === rec.name).map(s => s.id),
    };
  });
}

// The place the notes panel shows: the picked scene's own, else the picked place.
function worldMapPlaceName() {
  if (worldMapSel.sceneId) {
    const s = allScenes.find(x => x.id === worldMapSel.sceneId);
    return s ? sanitizeGroupName(s.group) : '';
  }
  return worldMapSel.place;
}

// The road the notes panel shows: the picked road, else the road holding the picked scene.
function worldMapRoadKey() {
  if (worldMapSel.sceneId) { const r = worldRoadOfScene(worldMapSel.sceneId); return r ? r.uid : ''; }
  return worldMapSel.road || '';
}

// ─── Drawing ─────────────────────────────────────────────────────────────────

function _wmEl(key, layer, cls, html) {
  let e = _wmEls.get(key);
  if (!e) {
    e = document.createElement('div');
    e.className = cls;
    e.innerHTML = html;
    _wmLayers[layer].appendChild(e);
    _wmEls.set(key, e);
  }
  e.dataset.live = '1';
  return e;
}

function _wmSetText(e, text) {
  if (e !== _wmEditing && e.textContent !== text) e.textContent = text;
}

function _wmPx(e, name, v) { e.style.setProperty(name, v + 'px'); }

function _wmPlaceDim(name) {
  return !allScenes.some(s => sanitizeGroupName(s.group) === name && wmMatches(_wmQuery, s.name, name)) &&
         !wmMatches(_wmQuery, '', name);
}

function _wmDrawPlace(p, selPlace) {
  const dim = _wmPlaceDim(p.name);
  const h = _wmEl('h' + p.name, 'hull', 'wm-hl', '');
  h.dataset.place = p.name;
  h.classList.toggle('sel', selPlace === p.name);
  h.classList.toggle('dim', dim);
  _wmSetText(h, p.name);
}

// A place's name is seen from afar and never from inside: zoomed out it shows, zoomed in the scenes' own
// names take over. It is a room's label (roomPanel.js): its type size by zoom and clamped, its weight, padding,
// radius and gap, laid at the top left of the place a fixed gap from its walls (wmPlateSpot) and cut short
// where the shape narrows. It is laid in world units, so it is laid again whenever the camera moves.
let _wmMeasure = null;

function _wmTextWidth(text, px) {
  if (!_wmMeasure) _wmMeasure = document.createElement('canvas').getContext('2d');
  _wmMeasure.font = _rpLabelFont(px);
  return _wmMeasure.measureText(text).width;
}

function _wmReadUz() { _wmUz = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')) || 1; }

// The zoom rounded to a fiftieth, so a camera moving keeps a plate it already laid and the gap holds to a pixel.
const _wmZq = z => Math.exp(Math.round(Math.log(z) / 0.02) * 0.02);

// A place's plate at zoom z: where it sits and how wide it can be, in world units, and the type size it is laid for.
function _wmPlateAt(p, z, outline) {
  const zq = _wmZq(z), fontPx = roomLabelFontPx(zq), textH = fontPx + RP_LABEL_PAD_Y * 2;
  const measure = t => _wmTextWidth(t, fontPx), textW = measure(p.name) + RP_LABEL_PAD_X * 2;
  const sig = [zq.toFixed(4), fontPx, p.name, outline.length, outline.reduce((t, v) => t + v.x * 7 + v.y * 13, 0).toFixed(1)].join('|');
  let got = _wmPlateMemo.get(p.name);
  if (!got || got.sig !== sig) {
    const narrow = (measure(p.name.slice(0, 2) + '…') + RP_LABEL_PAD_X * 2) / zq;
    got = { sig, fontPx, textH: textH / zq, spot: wmPlateSpot(outline, textW / zq, textH / zq, RP_LABEL_GAP / zq, narrow) };
    _wmPlateMemo.set(p.name, got);
  }
  return got;
}

// Rename is off while the name it would edit is hidden: zoomed in, or a plate the shape has no room for.
function _wmNameShown(name) {
  const h = _wmEls.get('h' + name);
  return !!h && _wm.classList.contains('places') && !h.classList.contains('off');
}

function _wmLayoutLabels() {
  if (!_wmWorld) return;
  const z = _wmCam.z, zq = _wmZq(z);
  _wmWorld.style.setProperty('--fs', roomLabelFontPx(zq));
  _wmWorld.style.setProperty('--lx', RP_LABEL_PAD_X);
  _wmWorld.style.setProperty('--ly', RP_LABEL_PAD_Y);
  _wmWorld.style.setProperty('--lr', RP_LABEL_RADIUS);
  if (z >= WM_SPLIT) return;
  for (const p of _wmPlaceList) {
    const h = _wmEls.get('h' + p.name);
    if (!h) continue;
    const { spot, textH, fontPx } = _wmPlateAt(p, z, wmOutline(p.rec));
    const shown = spot ? ellipsizeToWidth(p.name, spot.w * zq - RP_LABEL_PAD_X * 2, t => _wmTextWidth(t, fontPx)) : '';
    h.classList.toggle('off', !spot || !shown || (shown !== p.name && shown.replace('…', '').trim().length < 2));
    if (!spot) continue;
    _wmPx(h, '--hx', spot.x);
    _wmPx(h, '--hy', spot.y + textH / 2);
    h.style.setProperty('--hw', spot.w);
  }
}

// ─── What the map reaches ────────────────────────────────────────────────────

// The picture with the layout, or the layout with a margin: the camera never shows beyond it.
function _wmExtent() {
  if (_wmExt) return _wmExt;
  const pts = [];
  for (const s of allScenes) {
    const p = _wmPos(s);
    if (p) pts.push({ x: p.x - WM_CARD_W / 2, y: p.y - WM_CARD_H / 2 }, { x: p.x + WM_CARD_W / 2, y: p.y + WM_CARD_H / 2 });
  }
  for (const p of _wmPlaceList) { const b = wmPolyBounds(wmOutline(p.rec)); pts.push({ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h }); }
  return (_wmExt = wmExtent(pts, worldBackgroundPicture()));
}

function worldMapExtentReset() { _wmExt = null; }

const _wmFloor = () => wmZoomFloor(_wmExtent(), _wmView());

function _wmDrawScene(s, places) {
  const pos = _wmPos(s), group = _wmRoadPos[s.id] ? '' : sanitizeGroupName(s.group);
  const place = group ? places.find(p => p.name === group) : null;
  const c = _wmEl('c' + s.id, 'card', 'wm-card', '<div class="wm-th"></div><div class="wm-nm"></div>');
  c.dataset.id = s.id;
  const url = thumbURLs.get(s.id);
  c.firstChild.style.backgroundImage = url ? 'url("' + url + '")' : '';
  if (!c.classList.contains('dragging')) {
    _wmPx(c, '--px', pos.x - WM_CARD_W / 2);
    _wmPx(c, '--py', pos.y - WM_CARD_H / 2);
  }
  c.dataset.col = worldMapColumnMark(s.id);
  c.classList.toggle('placed', !!place);
  c.classList.toggle('loose', !place && !_wmRoadPos[s.id]);
  c.classList.toggle('onroad', !!_wmRoadPos[s.id]);
  c.classList.toggle('cur', _wmIsOpen(s.id));
  c.classList.toggle('sel', _wmPickSet.has(s.id));
  c.classList.toggle('dim', !wmMatches(_wmQuery, s.name, group));
  _wmSetText(c.lastChild, s.name);
  if (place) return;
  const m = _wmEl('l' + s.id, 'mark', 'wm-lm', '<div class="wm-dot"></div><div class="wm-lbl"></div>');
  m.dataset.id = s.id;
  m.dataset.col = worldMapColumnMark(s.id);
  _wmPx(m, '--mx', pos.x);
  _wmPx(m, '--my', pos.y);
  _wmSetText(m.lastChild, s.name);
  m.classList.toggle('cur', _wmIsOpen(s.id));
  m.classList.toggle('sel', _wmPickSet.has(s.id));
  m.classList.toggle('stn', !!_wmRoadPos[s.id]);
  m.classList.toggle('dim', !wmMatches(_wmQuery, s.name, ''));
}

function _wmDraw() {
  if (!worldMapOpen || !_wm) return;
  worldEnsurePositions();
  _wmReadUz();
  worldRoadsFollow();
  _wmRoadPos = worldRoadScenePos();
  for (const e of _wmEls.values()) e.dataset.live = '';
  const places = _wmPlaces();
  _wmPlaceList = places;
  const selScene = worldMapSel.sceneId && allScenes.find(s => s.id === worldMapSel.sceneId);
  const selPlace = selScene ? sanitizeGroupName(selScene.group) : worldMapSel.place;
  _wmExt = null;
  _wmPickSet = new Set(worldMapPicked());
  worldMistDraw(places, allScenes);
  for (const p of places) _wmDrawPlace(p, selPlace);
  worldMapRoadsDraw();
  for (const s of allScenes) _wmDrawScene(s, places);
  for (const [k, e] of _wmEls) if (!e.dataset.live) { e.remove(); _wmEls.delete(k); }
  _wmLayoutLabels();
  document.getElementById('wm-empty').hidden = allScenes.length > 0;
  worldMapDrawOverlay();
}

// ─── The places, drawn and edited by the room code ───────────────────────────
// The room's own functions (drawPolyOutline, selectMouseDown, the box, the corner circles) read the
// camera from globals, so each call is made inside this, which sets them to the world's and puts the
// map's own back. ⚠ SYNCHRONOUS ONLY: nothing that awaits belongs inside it.
function _wmWithCamera(fn) {
  const keep = { zoom, panX, panY, shape, seatTurn };
  const v = _wmView(), r = container.getBoundingClientRect();
  zoom = _wmCam.z;
  panX = v.w / 2 - _wmCam.cx * _wmCam.z - r.left;
  panY = v.h / 2 - _wmCam.cy * _wmCam.z - r.top;
  shape = 'select';
  seatTurn = 0;
  try { return fn(); } finally { ({ zoom, panX, panY, shape, seatTurn } = keep); }
}

function _wmDrawPre() {
  const c = cursorCtx;
  c.save();
  c.setLineDash([6, 4]);
  c.strokeStyle = POLY_EDGE_SELECTED;
  c.fillStyle = 'rgba(255,208,96,0.08)';
  c.lineWidth = 1.5;
  c.beginPath();
  _wmPre.verts.forEach((v, i) => { const p = toScreen(v.x, v.y); if (i) c.lineTo(p.sx, p.sy); else c.moveTo(p.sx, p.sy); });
  if (!_wmPre.open) c.closePath();
  c.fill();
  c.stroke();
  c.restore();
}

// With two maps on nothing sizes the overlay (its container is hidden), so it is sized to the window here.
function _wmFitOverlay() {
  if (!panesActive) return;
  const w = container.clientWidth, h = container.clientHeight;
  if (cursorCanvas.width !== w || cursorCanvas.height !== h) { cursorCanvas.width = w; cursorCanvas.height = h; }
}

// The overlay canvas rides above the layer while the map is up (worldMap.css), and this paints it.
function worldMapDrawOverlay() {
  if (!worldMapOpen) return;
  _wmFitOverlay();
  cursorCtx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
  _wmWithCamera(() => {
    for (const rec of worldPlaceRecords()) {
      const sel = rec.id === selectedPolygonId;
      drawPolyOutline(rec, sel, sel ? selectedVertexIndex : -1, _wmPlaceDim(rec.name));
    }
    for (const rec of worldRoadRecords()) if (rec.id === selectedPolygonId) drawPolyOutline(rec, true, selectedVertexIndex, false);
    const picked = findActiveShape();
    if (picked) { if (!picked.open) drawShapeBox(picked); drawCornerCircles(picked); }
    if (_wmPre) _wmDrawPre();
    worldMapRoadsOverlay();
  });
}

// What the room code calls once an edit is done: the places are kept and every scene is filed again.
function worldPlaceCommit() {
  worldPlacesSave();
  worldRoadsCommit();
  worldAssignAll();
  worldMapRefresh();
}

// Delete on a picked place: undoable, so it asks nothing.
function worldPlaceDelete(id) {
  const road = worldRoadById(id);
  if (road) { worldMapRoadDelete(road.uid); return; }
  const name = worldPlaceNameOfId(id);
  if (!name) return;
  clearShapeSelection();
  worldMapSel = { sceneId: null, place: '' };
  deleteGroup({ name, scenes: allScenes.filter(s => sanitizeGroupName(s.group) === name) });
}

// ⚠ THE TOOLBAR IS THE SCENE'S, lent to the layer: Select with no repair armed and the rooms' tool list, so
// no armed mode is left swallowing a shape with its button off the bar. Each goes back as it was.
function _wmHoldTools() {
  _wmHeld = { shape, shapeOp, placeMode };
  if (shapeOp !== 'new') setShapeOp('new');
  if (placeMode !== 'rooms') setPlaceMode('rooms');
  setShape('select');
}

function _wmReturnTools() {
  const held = _wmHeld;
  _wmHeld = null;
  _wmTool = 'select';
  worldMapDrawCancel();
  if (!held) return;
  setShapeOp(held.shapeOp);
  if (placeMode !== held.placeMode) setPlaceMode(held.placeMode);
  setShape(held.shape);
}

// The room selection the layer found is put away and given back, so the map's room is as it was.
function _wmKeepSelection() {
  _wmKept = { sceneId: currentScene ? currentScene.id : null, selectedPolygonId, shapeEditMode, selectedVertexIndex, selectedHoleIndex, holeEditMode };
  clearShapeSelection();
}

function _wmRestoreSelection() {
  clearShapeSelection();
  // ⚠ ONLY ONTO THE SCENE IT CAME FROM: a scene opened from the map has its own rooms under those ids.
  if (!_wmKept || _wmKept.sceneId !== (currentScene ? currentScene.id : null)) { _wmKept = null; return; }
  ({ selectedPolygonId, shapeEditMode, selectedVertexIndex, selectedHoleIndex, holeEditMode } = _wmKept);
  _wmKept = null;
}

// What is picked on the layer, from what the room code left selected.
function _wmSyncSelection() {
  const road = selectedPolygonId == null ? null : worldRoadById(selectedPolygonId);
  const name = selectedPolygonId == null || road ? '' : worldPlaceNameOfId(selectedPolygonId);
  worldMapSel = { sceneId: null, place: name, road: road ? road.uid : '' };
  notesLevelPick = null;
  worldMapRefresh();
}

// Draws, and tells the notes panel what is picked.
function worldMapRefresh() {
  _wmDraw();
  refreshRoomPanel();
  worldBackupSync();
  worldMapColumnsSync();
}

// ─── The camera ──────────────────────────────────────────────────────────────

function _wmApplyCam() {
  const v = _wmView();
  _wmReadUz();
  _wmCam = wmClampCamera(_wmCam, v, _wmExtent());
  const tx = v.w / 2 - _wmCam.cx * _wmCam.z, ty = v.h / 2 - _wmCam.cy * _wmCam.z;
  _wmWorld.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + _wmCam.z + ')';
  _wmWorld.style.setProperty('--iz', 1 / _wmCam.z);
  _wmWorld.style.setProperty('--uz', _wmUz);
  _wmWorld.style.setProperty('--rw', Math.min(7, 3 + 3 * _wmCam.z).toFixed(2));
  const level = wmLevelFor(_wmCam.z);
  _wm.classList.toggle('places', level === 'places');
  _wm.classList.toggle('scenes', level === 'scenes');
  const g = 60 * _wmCam.z * (_wmCam.z < 0.2 ? 4 : _wmCam.z < 0.6 ? 2 : 1);
  _wm.style.backgroundSize = g + 'px ' + g + 'px';
  _wm.style.backgroundPosition = tx + 'px ' + ty + 'px';
  _wmLayoutLabels();
  worldMapDrawOverlay();
}

function _wmToWorld(px, py) {
  const v = _wmView();
  return { x: _wmCam.cx + (px - v.w / 2) / _wmCam.z, y: _wmCam.cy + (py - v.h / 2) / _wmCam.z };
}

// Zoom is eased on its logarithm and the centre on the inverse scale, so a fly in or out stays on
// the point it is heading for.
function _wmFly(t, ms, done) {
  _wmAnim = true;
  const s = { ..._wmCam }, t0 = performance.now();
  const ease = k => k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / ms), e = ease(k);
    _wmCam.z = Math.exp(Math.log(s.z) + (Math.log(t.z) - Math.log(s.z)) * e);
    const span = 1 / t.z - 1 / s.z;
    const u = Math.abs(span) > 1e-6 ? (1 / _wmCam.z - 1 / s.z) / span : e;
    _wmCam.cx = s.cx + (t.cx - s.cx) * u;
    _wmCam.cy = s.cy + (t.cy - s.cy) * u;
    _wmApplyCam();
    if (k < 1) requestAnimationFrame(step); else { _wmAnim = false; if (done) done(); }
  };
  step();
}

function _wmOverview() {
  return wmOverviewCamera(allScenes.map(_wmPos), _wmView());
}

function worldMapFlyToPlace(name) {
  const p = _wmPlaces().find(x => x.name === name);
  if (!p) return;
  worldMapSelect({ sceneId: null, place: name });
  _wmFly(wmPlaceCamera(p.bounds, _wmView()), 650);
}

// ─── Opening and closing ─────────────────────────────────────────────────────

function worldMapShow() {
  if (worldMapOpen || !_wm) return;
  worldMapOpen = true;
  worldMapSel = { sceneId: null, place: '' };
  _wmKeepSelection();
  _wmHoldTools();
  worldUndoClear();
  document.body.classList.add('world');
  _wm.hidden = false;
  worldEnsurePositions();
  worldReconcile();
  const open = _wmReturnScene();
  _wmCam = open ? { cx: open.worldPos.x, cy: open.worldPos.y, z: wmFillZoom(_wmView()) } : _wmOverview();
  _wm.classList.add('notrans');
  worldMapRefresh();
  _wmApplyCam();
  void _wm.offsetWidth;
  _wm.classList.remove('notrans');
  _wm.classList.add('shown');
  dockRefreshRail();
  dockHoldForWorld(true);
  if (open) _wmFly(_wmOverview(), 1100);
}

function worldMapHide() {
  if (!worldMapOpen) return;
  if (typeof cornerFieldClose === 'function') cornerFieldClose(true);
  worldMapOpen = false;
  worldMapSel = { sceneId: null, place: '' };
  worldMapFindClose();
  worldMapMenuClose();
  worldBackgroundMoveSet(false);
  _wmReturnTools();
  _wmRestoreSelection();
  document.body.classList.remove('world');
  _wm.classList.remove('shown');
  setTimeout(() => { if (!worldMapOpen) _wm.hidden = true; }, 260);
  dockRefreshRail();
  dockHoldForWorld(false);
  refreshRoomPanel();
  worldBackupSync();
  drawCursor(lastScreenX, lastScreenY);
}

// Back to the open scene. With none open there is nothing to go back to, so nothing happens. With two maps on
// the map just closes: both columns stay as they are.
function worldMapReturn() {
  if (!worldMapOpen || _wmAnim) return;
  if (panesActive) { worldMapHide(); return; }   // the columns are as the DM left them
  const open = _wmReturnScene();
  if (!open) return;
  _wmFly({ cx: open.worldPos.x, cy: open.worldPos.y, z: wmFillZoom(_wmView()) }, 750, worldMapHide);
}

function worldMapToggle() {
  if (worldMapOpen) worldMapReturn(); else worldMapShow();
}

// Zoom into the card, then open the scene. With two maps on there is no zoom: the scene fills the active column.
function worldMapOpenScene(id) {
  const s = allScenes.find(x => x.id === id);
  if (!worldMapOpen || _wmAnim || !s) return;
  if (panesActive) { worldMapColumnFill(id); return; }
  _wmFly({ cx: s.worldPos.x, cy: s.worldPos.y, z: wmFillZoom(_wmView()) }, 750, async () => {
    await switchScene(id).catch(err => console.error('switchScene failed:', err));
    worldMapHide();
  });
}

function worldMapSelect(sel) {
  worldMapSel = sel;
  worldMapPick = sel.sceneId ? [sel.sceneId] : [];
  notesLevelPick = null;
  const rec = sel.sceneId ? null : sel.road ? worldRoadByUid(sel.road) : sel.place ? worldPlaceByName(sel.place) : null;
  if (!rec) clearShapeSelection();
  else if (selectedPolygonId !== rec.id) { selectedPolygonId = rec.id; leaveShapeEditMode(); }
  worldMapRefresh();
}

// ─── Keys ────────────────────────────────────────────────────────────────────

// ⚠ CAPTURE, AT THE DOCUMENT, as the What's new panel does: the map's shortcuts hang off a document
// keydown that knows nothing of this layer, and a Space or a Delete here would reach the hidden scene
// and the TV. A field, and anything inside a dialog or window, keeps its own keys.
function _wmOwnKeys(target) {
  if (!target || !target.closest) return false;
  if (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return true;
  return !!target.closest('#cd-anchor, #bs-modal, #cl-anchor, .sm-toast, #mt-modal');
}

function _wmOverlayUp() {
  const shown = id => { const el = document.getElementById(id); return !!el && el.style.display !== 'none' && el.style.display !== ''; };
  return bsIsOpen() || shown('cd-anchor') || shown('cl-anchor') || shown('mt-modal');
}

function worldMapKeys(e) {
  if (!worldMapOpen || _wmOverlayUp()) return;
  if (legendVisible) {   // the legend is over the map: Esc and ? put it away, and nothing reaches the map behind it
    e.stopPropagation();
    if (e.code === 'Escape' || (e.code === 'Slash' && e.shiftKey)) toggleLegend();
    return;
  }
  if (_wmMenu && e.code === 'Escape') { e.stopPropagation(); worldMapMenuClose(); return; }
  if (_wmEditing) {
    e.stopPropagation();
    worldMapEditKey(e);
    return;
  }
  if (_wmOwnKeys(e.target)) return;
  e.stopPropagation();
  if (worldMapToolKey(e)) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) worldRedo(); else worldUndo(); return; }
  if (mod && e.code === 'KeyY') { e.preventDefault(); worldRedo(); return; }
  if ((e.code === 'Delete' || e.code === 'Backspace') && selectedPolygonId != null) {
    e.preventDefault();
    _wmWithCamera(deleteSelectedPart);
    return;
  }
  if (e.code === 'Escape' && selectedPolygonId != null) { _wmWithCamera(escapeShapeSelection); _wmSyncSelection(); return; }
  const picked = worldMapPicked();
  if (e.code === 'Escape' && picked.length) { worldMapSelect({ sceneId: null, place: '' }); return; }
  if ((e.code === 'Delete' || e.code === 'Backspace') && picked.length) { e.preventDefault(); _wmDeletePicked(picked); return; }
  if ((e.code === 'Enter' || e.code === 'NumpadEnter') && picked.length === 1) { worldMapOpenScene(picked[0]); return; }
  if (e.code === 'Slash' && e.shiftKey) toggleLegend();
  else if (e.code === 'Escape') worldMapReturn();
  else if (e.code === 'KeyM' && !e.ctrlKey && !e.metaKey && !e.altKey) worldMapReturn();
  else if (e.code === 'KeyF' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); worldMapFindOpen(); }
}

// The menu's delete, with its undo toast. The open scene stays: deleting it would switch the TV.
function _wmDeletePicked(ids) {
  const gone = ids.filter(id => !_wmIsOpen(id));
  if (!gone.length) return;
  worldMapSelect({ sceneId: null, place: '' });
  deleteScenesWithUndo(gone);
}
