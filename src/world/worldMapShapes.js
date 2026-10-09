'use strict';
// worldMapShapes.js — drawing a place on the world map with the toolbar's own tools, and repairing the
// places already there with Merge, Cut out and Split. The tool is the toolbar's `shape` and `shapeOp`
// (input.js and toolbar.js); this file reads them. Editing a place afterwards is the room's own code
// (worldMapEdit.js runs it on the world's camera).

let _wmPoly = null;              // the path being clicked out, for a polygon or a split: { pts, cur }
const WM_MIN_PLACE = 30;         // a dragged rectangle or circle smaller than this is a slip, not a place
const WM_DRAWN = ['rect', 'circle', 'poly', 'cut'];

// What the layer does follows the tool in hand. setShape (input.js) calls this once `shape` is set.
function worldMapToolSync() {
  worldMapDrawCancel();
  _wmTool = WM_DRAWN.indexOf(shape) >= 0 ? shape : 'select';
  if (_wm) _wm.classList.toggle('drawing', _wmTool !== 'select');
  worldMapRoadButtonSync();
  if (worldMapOpen) worldMapRefresh();
}

// V, R, O and P pick the tool, as on the map; Enter closes a path, Escape drops it, then the tool.
function worldMapToolKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  const tool = { KeyV: 'select', KeyR: 'rect', KeyO: 'circle', KeyP: 'poly' }[e.code];
  if (tool) { setShape(tool); return true; }
  if ((_wmPoly || _wmRoadPath) && (e.code === 'Enter' || e.code === 'NumpadEnter')) { e.preventDefault(); worldMapPathFinish(); return true; }
  if (e.code === 'Escape' && _wmRoadPath) { worldMapRoadFinish(); return true; }   // as in Figma, Esc leaves the path as it is
  if (e.code === 'Escape' && _wmPoly) { worldMapDrawCancel(); return true; }
  if (e.code === 'Escape' && _wmTool !== 'select') { setShape('select'); return true; }
  return false;
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
  const w = _wmToWorld(e.clientX, e.clientY);
  _wmDrag = { ...base, kind: 'draw', tool: _wmTool, w0: w };
  if (_wmTool === 'road') worldMapRoadDown(e, w);
}

function _wmDragShape(d, p) {
  return d.tool === 'rect' ? wmRectShape(d.w0.x, d.w0.y, p.x, p.y)
    : wmCircleShape(d.w0.x, d.w0.y, Math.hypot(p.x - d.w0.x, p.y - d.w0.y), 40);
}

const _wmClicked = tool => tool === 'poly' || tool === 'cut';

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
    if (b.w >= WM_MIN_PLACE && b.h >= WM_MIN_PLACE) _wmFinished(verts);
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
  const tool = _wmTool;
  worldMapDrawCancel();
  if (tool === 'cut') { if (pts.length >= 2) _wmSplit(pts); return; }
  if (pts.length >= 3) _wmFinished(pts);
}

// A closed shape the DM drew: a new place, or what an armed Merge or Cut out does to the places it lands on.
function _wmFinished(verts) {
  if (shapeOp === 'new') { _wmCreatePlace(verts); return; }
  _wmRepair(verts);
}

// ─── Repairs ─────────────────────────────────────────────────────────────────
// The geometry is roomOps.js, the same kernel the room tools use. A place keeps its name and notes
// through a repair: the first one of a Merge, the one a Cut out shrinks, and the first piece of a split.

const WM_REASONS = {
  [REASON_FAILED]: 'Those places could not be combined. Nothing changed.',
  [REASON_CUT]: 'A cut has to enter and leave the place once each. Nothing changed.',
};

function _wmRefuse(reason) {
  messageDialog({ title: 'Nothing changed', message: t(WM_REASONS[reason] || reason) });
}

const WM_REASON_HOLE = 'A place cannot have a hole in it. Draw the shape so it touches the edge, or use Split.';

// Vertices, rounding and curves of a piece, the only things a place keeps.
function _wmPlacePieces(shapes, pieces) {
  const kept = restoreGroupDetail(shapes, pieces);
  return kept.pieces.length ? kept.pieces : pieces.map(p => ({ vertices: p.verts, holes: p.holes }));
}

// A merged-away place hands its notes to the one that stays, and its scenes fall to whichever outline holds them.
function _wmRetire(rec, into) {
  if (into) {
    const gone = notesPlaceGet(rec.name), keep = notesPlaceGet(into.name);
    if (gone) notesPlaceSet(into.name, [keep, gone].filter(Boolean).join('\n\n'));
    notesPlaceSet(rec.name, '');
  }
  forgetGroup(rec.name);
  worldShapeDelete(rec.name);
}

function _wmApplyPlan(plan) {
  worldUndoPush();
  for (const g of plan) {
    const base = g.shapes[0];
    for (let i = 1; i < g.shapes.length; i++) _wmRetire(g.shapes[i], base);
    if (!g.pieces.length) { _wmRetire(base, null); continue; }
    const parts = _wmPlacePieces(g.shapes, g.pieces);
    base.vertices = parts[0].vertices;
    if (parts[0].cornerRadii) base.cornerRadii = parts[0].cornerRadii; else delete base.cornerRadii;
    if (parts[0].handles) base.handles = parts[0].handles; else delete base.handles;
    for (let i = 1; i < parts.length; i++) {
      worldPlaceSet(addGroup(t('New place')), { vertices: parts[i].vertices, cornerRadii: parts[i].cornerRadii, handles: parts[i].handles });
    }
  }
  clearShapeSelection();
  worldPlaceCommit();
}

function _wmRepair(verts) {
  const hits = worldPlaceRecords().filter(r => r.vertices.length >= 3 && shapesOverlap(r, verts));
  if (!hits.length) return;
  const minArea = roomOpMinArea(WM_MIN_PLACE);
  let plan;
  if (shapeOp === 'join') {
    const out = joinShapes(hits, verts, minArea);
    if (out.reason) { _wmRefuse(out.reason); return; }
    plan = [{ shapes: hits, pieces: out.pieces }];
  } else {
    const out = trimShapes(hits, verts, minArea);
    if (out.reason) { _wmRefuse(out.reason); return; }
    plan = hits.map((r, i) => ({ shapes: [r], pieces: out.groups[i] }));
  }
  if (plan.some(g => g.pieces.some(p => p.holes && p.holes.length))) { messageDialog({ title: 'Nothing changed', message: t(WM_REASON_HOLE) }); return; }
  _wmApplyPlan(plan);
}

// ⚠ EVERY PLACE THE PATH TOUCHES IS IN OR THE WHOLE SPLIT IS REFUSED, as with rooms.
function _wmSplit(path) {
  const minArea = roomOpMinArea(WM_MIN_PLACE), plan = [];
  for (const rec of worldPlaceRecords()) {
    if (rec.vertices.length < 3 || !ringPathCrossings(rec.vertices, path).length) continue;
    const out = cutRing(rec, path, minArea);
    if (out.reason) { _wmRefuse(out.reason); return; }
    plan.push({ shapes: [rec], pieces: out.pieces });
  }
  if (!plan.length) { _wmRefuse(REASON_CUT); return; }
  _wmApplyPlan(plan);
}
