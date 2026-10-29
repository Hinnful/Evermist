'use strict';
// worldMapShapes.js — drawing a place on the world map with the toolbar's own tools. The tool is the
// toolbar's `shape` (input.js and toolbar.js); this file reads it. Places take no Merge, Cut out or Split.
// Editing a place afterwards is the room's own code (worldMapEdit.js runs it on the world's camera).

let _wmPoly = null;              // the polygon being clicked out: { pts, cur }
const WM_MIN_PLACE = 30;         // a dragged rectangle or circle smaller than this is a slip, not a place
const WM_DRAWN = ['rect', 'circle', 'poly'];

// Where groups overlap a press picks the smallest outline under it, so a group drawn inside another can be picked.
// The later one wins a tie, as top-most does for rooms (findPolygonAt).
function worldShapeAt(list, x, y) {
  let best = null, area = Infinity;
  for (const r of list) {
    if (!pointInShape(x, y, r)) continue;
    const a = wmPolyArea(wmOutline(r));
    if (a <= area) { best = r; area = a; }
  }
  return best;
}

// What the layer does follows the tool in hand. setShape (input.js) calls this once `shape` is set.
function worldMapToolSync() {
  worldMapDrawCancel();
  _wmTool = WM_DRAWN.indexOf(shape) >= 0 ? shape : 'select';
  if (_wm) _wm.classList.toggle('drawing', _wmTool !== 'select');
  worldMapRoadButtonSync();
  if (worldMapOpen) worldMapRefresh();
}

// V, R, O and P pick the tool, as on the map, and L takes Road (the world map only); Enter closes a path, Escape drops it, then the tool.
function worldMapToolKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.code === 'KeyL') { if (_wmTool !== 'road') worldMapRoadToolToggle(); return true; }
  const tool = { KeyV: 'select', KeyR: 'rect', KeyO: 'circle', KeyP: 'poly' }[e.code];
  if (tool) { setShape(tool); return true; }
  if ((_wmPoly || _wmRoadPath) && (e.code === 'Enter' || e.code === 'NumpadEnter')) { e.preventDefault(); worldMapPathFinish(); return true; }
  if (e.code === 'Escape' && _wmRoadPath) { worldMapRoadFinish(); return true; }   // as in Figma, Esc leaves the path as it is
  if (e.code === 'Escape' && _wmPoly) { worldMapDrawCancel(); return true; }
  if (e.code === 'Escape' && _wmTool !== 'select') { setShape('select'); return true; }
  return false;
}

// Ctrl+G groups the picked maps, Ctrl+Shift+G ungroups the picked group (or the picked map's), Shift+1 frames
// everything and Shift+2 the picked group.
function worldMapGroupKey(e) {
  if (e.altKey) return false;
  const mod = e.ctrlKey || e.metaKey, rec = worldPlaceByName(worldMapPlaceName());
  if (mod && e.code === 'KeyG') {
    e.preventDefault();
    if (!e.shiftKey) worldMapGroupPicked(); else if (rec) worldPlaceUngroup(rec.id);
    return true;
  }
  if (!e.shiftKey || mod || (e.code !== 'Digit1' && e.code !== 'Digit2')) return false;
  if (e.code === 'Digit1') _wmFly(_wmOverview(), 650); else if (rec) worldMapFlyToPlace(rec.name);
  return true;
}

function _wmPreview(verts, open) {
  _wmPre = verts && verts.length ? { verts, open } : null;
  worldMapDrawOverlay();
}

function worldMapDrawCancel() {
  _wmPoly = null;
  _wmRoadPath = null;
  _wmRoadHover = null;
  _wmPre = null;
  if (worldMapOpen) worldMapDrawOverlay();
}

// A place from a finished shape: named, selected, and its name open for typing where it shows.
function _wmCreatePlace(verts) {
  const name = worldPlaceCreate(verts);
  setShape('select');
  worldMapSelect({ sceneId: null, place: name });
  if (_wmNameShown(name)) _wmRenameStart(_wmEls.get('h' + name), 'place', name);
}

function worldMapDrawDown(e, base) {
  if (_wmTool === 'marker') { worldMapMarkerDown(e); return; }
  const w = _wmToWorld(e.clientX, e.clientY);
  _wmDrag = { ...base, kind: 'draw', tool: _wmTool, w0: w };
  if (_wmTool === 'road') worldMapRoadDown(e, w);
}

function _wmDragShape(d, p) {
  return d.tool === 'rect' ? wmRectShape(d.w0.x, d.w0.y, p.x, p.y)
    : wmCircleShape(d.w0.x, d.w0.y, Math.hypot(p.x - d.w0.x, p.y - d.w0.y), 40);
}

const _wmClicked = tool => tool === 'poly';

function worldMapDrawMove(e, d) {
  if (d.tool === 'road') { worldMapRoadDrag(e); return; }
  if (_wmClicked(d.tool)) return;
  _wmPreview(_wmDragShape(d, _wmToWorld(e.clientX, e.clientY)));
}

function worldMapDrawUp(e, d) {
  if (d.tool === 'road') { worldMapRoadHover(e); return; }
  const p = _wmToWorld(e.clientX, e.clientY);
  if (!_wmClicked(d.tool)) {
    _wmPreview(null);
    if (!d.moved) return;
    const verts = _wmDragShape(d, p), b = wmPolyBounds(verts);
    if (b.w >= WM_MIN_PLACE && b.h >= WM_MIN_PLACE) _wmCreatePlace(verts);
    return;
  }
  if (d.moved) return;
  if (!_wmPoly) _wmPoly = { pts: [], cur: p };
  const first = _wmPoly.pts[0];
  if (d.tool === 'poly' && first && _wmPoly.pts.length >= 3 && Math.hypot(p.x - first.x, p.y - first.y) * _wmCam.z < 10) { worldMapPathFinish(); return; }
  _wmPoly.pts.push({ x: Math.round(p.x), y: Math.round(p.y) });
  _wmPoly.cur = p;
  _wmPreview([..._wmPoly.pts, p], true);
}

// The rubber band from the last corner to the pointer.
function worldMapDrawHover(e) {
  if (_wmTool === 'road' && worldMapOpen) { worldMapRoadHover(e); return; }
  if (!_wmPoly || !worldMapOpen) return;
  const p = _wmToWorld(e.clientX, e.clientY);
  _wmPoly.cur = p;
  _wmPreview([..._wmPoly.pts, p], true);
}

// A double-click lands two clicks on one spot, so a corner on top of the last one is dropped.
function worldMapPathFinish() {
  if (_wmRoadPath) { worldMapRoadFinish(); return; }
  if (!_wmPoly) return;
  const pts = _wmPoly.pts.filter((p, i, a) => !i || Math.hypot(p.x - a[i - 1].x, p.y - a[i - 1].y) > 2);
  worldMapDrawCancel();
  if (pts.length >= 3) _wmCreatePlace(pts);
}
