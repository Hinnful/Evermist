'use strict';
// worldMapRoads.js — roads in the world map's layer: drawn as a dashed line on a dark casing, picked, named
// and deleted, and the Road tool that clicks one out. Editing a picked road's corners and bends is the room
// code's, run on the world's camera (worldMapEdit.js) over a record marked `open`.
//
// ⚠ NAMES REACH THE DOM THROUGH textContent ONLY: a road name is the DM's own text.

const WM_SVG = 'http://www.w3.org/2000/svg';
const _wmRoadEls = new Map();    // uid → { line, hit, wrap } svg paths, kept across draws
let _wmRoadSvg = null;
let _wmRoadPath = null;          // the road being drawn: { pts: [{ x, y, hh? }], and for a road picked up again resume, keep, base, scenes }

function worldMapRoadsInit() {
  _wmRoadSvg = document.getElementById('wm-roads');
  document.getElementById('wm-road').addEventListener('click', worldMapRoadToolToggle);
}

// Only the tool in hand is blue: with Road picked, the toolbar's Select is not.
function worldMapRoadButtonSync() {
  document.getElementById('wm-road').classList.toggle('active', _wmTool === 'road');
  document.getElementById('btn-select').classList.toggle('active', shape === 'select' && _wmTool !== 'road');
}

// The Road tool is a switch beside the bar's shapes: picking any shape tool puts it away.
function worldMapRoadToolToggle() {
  const was = _wmTool === 'road';
  setShape('select');
  if (was) return;
  _wmTool = 'road';
  _wm.classList.add('drawing');
  worldMapRoadButtonSync();
}

// ─── Drawing ─────────────────────────────────────────────────────────────────

function _wmRoadMake(uid) {
  const mk = cls => {
    const p = document.createElementNS(WM_SVG, 'path');
    p.setAttribute('class', cls);
    p.setAttribute('vector-effect', 'non-scaling-stroke');
    _wmRoadSvg.appendChild(p);
    return p;
  };
  const e = { casing: mk('roadcase'), line: mk('road'), hit: mk('roadhit') };
  e.hit.dataset.uid = uid;
  _wmRoadEls.set(uid, e);
  return e;
}

// Every road as a line, and its name where the camera is close or the road is picked.
function worldMapRoadsDraw() {
  const live = new Set();
  for (const r of worldRoadRecords()) {
    live.add(r.uid);
    const e = _wmRoadEls.get(r.uid) || _wmRoadMake(r.uid), vis = worldRoadVisible(r), d = vis ? wrPolylinePath(vis) : wrSvgPath(r);
    for (const p of [e.casing, e.line, e.hit]) p.setAttribute('d', d);
    const sel = worldMapSel.road === r.uid;
    e.line.classList.toggle('sel', sel);
    const mid = wrPointAt(vis || wrSamples(r), 0.5);
    const n = _wmEl('r' + r.uid, 'rn', 'wm-rn', '');
    n.dataset.uid = r.uid;
    _wmPx(n, '--mx', mid.x);
    _wmPx(n, '--my', mid.y);
    n.classList.toggle('sel', sel);
    _wmSetText(n, r.name);
  }
  for (const [uid, e] of _wmRoadEls) {
    if (live.has(uid)) continue;
    e.casing.remove(); e.line.remove(); e.hit.remove();
    _wmRoadEls.delete(uid);
  }
}

// ─── The Road tool ───────────────────────────────────────────────────────────
// Drawn as Figma's pen draws. A press puts a point; dragging out of it bends the line through that point, the
// two sides mirrored; the line follows the pointer; Shift locks 45 degrees; Enter, a double-click or Esc
// finishes; a press on the open end of a road picks it up again. A point on a scene with no place sits on the
// scene's centre, and the thing an end will stick to is ringed before the press.

const WM_ROAD_DRAG = 4;          // screen px a press must move before it is a drag
let _wmRoadHover = null;         // where the pointer is for the tool: { p, at, resume }

function _wmRoadSnap(p, shift, from) {
  if (shift && from) return wrLockAngle(from, p);
  const at = worldRoadAttachAt(p, _wmCam.z);
  const s = at.kind === 'scene' ? allScenes.find(x => x.id === at.ref) : null;
  return s ? { x: s.worldPos.x, y: s.worldPos.y } : { x: p.x, y: p.y };
}

const _wmRoadLast = () => _wmRoadPath.pts[_wmRoadPath.pts.length - 1];

// The path as the room code reads a road: its points, and the curve each was dragged out to.
function _wmRoadLine(pts) {
  const handles = pts.map(p => p.hh || null);
  const radii = pts.map(p => (p.r == null ? null : p.r));
  return { vertices: pts.map(p => ({ x: p.x, y: p.y })), handles: handles.some(Boolean) ? handles : null, cornerRadii: radii.some(r => r !== null) ? radii : null };
}

// A road picked up by an open end: walked so that end is the last point, and its scenes noted by spot, since
// they must stay where they stand when the line gets longer.
function _wmRoadResume(end) {
  const rec = worldRoadByUid(end.uid), line = end.k === 0 ? wrReverse(rec) : rec, along = wrSamples(line);
  _wmRoadPath = {
    resume: end.uid, keep: line.ends[0], base: line.vertices.length,
    scenes: line.scenes.map(s => ({ id: s.id, p: wrPointAt(along, s.t) })),
    pts: line.vertices.map((v, i) => ({ x: v.x, y: v.y, hh: line.handles && line.handles[i] ? { ...line.handles[i] } : null, r: line.cornerRadii ? line.cornerRadii[i] : null })),
  };
}

function worldMapRoadDown(e, p) {
  _wmRoadHover = null;
  if (!_wmRoadPath) {
    const end = worldRoadEndAt(p, _wmCam.z);
    if (end) { _wmRoadResume(end); worldMapDrawOverlay(); return; }
    _wmRoadPath = { pts: [] };
  }
  _wmRoadPath.pts.push(_wmRoadSnap(p, e.shiftKey, _wmRoadPath.pts.length ? _wmRoadLast() : null));
  worldMapDrawOverlay();
}

// Held down and moved: the last point's curve follows the pointer, and the other side mirrors it.
function worldMapRoadDrag(e) {
  if (!_wmRoadPath || !_wmRoadPath.pts.length) return;
  const pt = _wmRoadLast(), w = _wmToWorld(e.clientX, e.clientY);
  const dx = w.x - pt.x, dy = w.y - pt.y;
  pt.hh = { ix: -dx, iy: -dy, ox: dx, oy: dy };
  worldMapDrawOverlay();
}

// The pointer, with no button down: the line's next stretch, and what a press here would stick to or pick up.
function worldMapRoadHover(e) {
  const w = _wmToWorld(e.clientX, e.clientY), z = _wmCam.z;
  const resume = _wmRoadPath ? null : worldRoadEndAt(w, z);
  const from = _wmRoadPath && _wmRoadPath.pts.length ? _wmRoadLast() : null;
  const p = _wmRoadSnap(w, e.shiftKey, from);
  _wmRoadHover = { p, resume: resume ? worldRoadByUid(resume.uid).vertices[resume.k ? worldRoadByUid(resume.uid).vertices.length - 1 : 0] : null,
                   at: resume || e.shiftKey ? null : worldRoadAttachAt(p, z) };
  worldMapDrawOverlay();
}

// What the tool draws, in the world's camera: the halo, the line so far, its points, the last point's curve.
function worldMapRoadsOverlay() {
  const path = _wmRoadPath, hov = _wmRoadHover, c = cursorCtx, BLUE = '#8fb6ff';
  if (!path && !hov) return;
  c.save();
  const at = hov && hov.at;
  if (at && at.kind === 'scene') {
    const s = allScenes.find(x => x.id === at.ref), a = toScreen(s.worldPos.x - WM_CARD_W / 2, s.worldPos.y - WM_CARD_H / 2), b = toScreen(s.worldPos.x + WM_CARD_W / 2, s.worldPos.y + WM_CARD_H / 2);
    c.strokeStyle = BLUE; c.lineWidth = 2.5; c.shadowColor = BLUE; c.shadowBlur = 8;
    c.beginPath();
    if (_wmCam.z < WM_SPLIT) { const m = toScreen(s.worldPos.x, s.worldPos.y); c.arc(m.sx, m.sy, 14, 0, Math.PI * 2); } else c.roundRect(a.sx - 4, a.sy - 4, b.sx - a.sx + 8, b.sy - a.sy + 8, 6);
    c.stroke();
    c.shadowBlur = 0;
  } else if (at && at.kind === 'place') {
    const ring = wmOutline(worldPlaceByName(at.ref));
    c.beginPath();
    ring.forEach((v, i) => { const q = toScreen(v.x, v.y); if (i) c.lineTo(q.sx, q.sy); else c.moveTo(q.sx, q.sy); });
    c.closePath();
    c.fillStyle = 'rgba(143,182,255,0.10)'; c.fill();
    c.strokeStyle = BLUE; c.lineWidth = 3; c.stroke();
  }
  if (hov && hov.resume) {
    const q = toScreen(hov.resume.x, hov.resume.y);
    c.strokeStyle = BLUE; c.lineWidth = 2;
    c.beginPath(); c.arc(q.sx, q.sy, 10, 0, Math.PI * 2); c.stroke();
  }
  if (path && path.pts.length) {
    const pts = hov && !hov.resume ? path.pts.concat([{ x: hov.p.x, y: hov.p.y }]) : path.pts;
    const line = _wmRoadLine(pts);
    c.beginPath();
    wrSamples(line).forEach((v, i) => { const q = toScreen(v.x, v.y); if (i) c.lineTo(q.sx, q.sy); else c.moveTo(q.sx, q.sy); });
    c.strokeStyle = BLUE; c.lineWidth = 1.5; c.lineJoin = 'round'; c.stroke();
    path.pts.forEach((v, i) => {
      const q = toScreen(v.x, v.y), tip = i === path.pts.length - 1;
      drawCorner(q.sx, q.sy, true, tip, tip ? SHAPE_PART_SELECTED : '#ffffff');
    });
    const tip = _wmRoadLast();
    if (tip.hh) {
      const q = toScreen(tip.x, tip.y);
      drawHandleKnob(q, toScreen(tip.x + tip.hh.ox, tip.y + tip.hh.oy));
      drawHandleKnob(q, toScreen(tip.x + tip.hh.ix, tip.y + tip.hh.iy));
    }
  }
  c.restore();
}

// Enter, a double-click or Esc. A path too short to be a road, or a picked-up road no longer, makes nothing.
// The road stays picked with its points open, so the next move is editing it.
function worldMapRoadFinish() {
  const path = _wmRoadPath;
  worldMapDrawCancel();
  if (!path) return;
  const base = path.base || 0;
  const pts = path.pts.filter((p, i, a) => i < Math.max(1, base) || Math.hypot(p.x - a[i - 1].x, p.y - a[i - 1].y) > 2);
  if (path.resume ? pts.length <= base : pts.length < 2) return;
  worldUndoPush();
  const line = _wmRoadLine(pts), z = _wmCam.z, far = worldRoadAttachAt(pts[pts.length - 1], z);
  let uid;
  if (path.resume) {
    const rec = worldRoadByUid(path.resume);
    rec.vertices = line.vertices;
    if (line.handles) rec.handles = line.handles; else delete rec.handles;
    if (line.cornerRadii) rec.cornerRadii = line.cornerRadii; else delete rec.cornerRadii;
    rec.ends = [path.keep, far];
    const along = wrSamples(rec);
    rec.scenes = path.scenes.map(s => ({ id: s.id, t: wrNearest(along, s.p).t }));
    uid = rec.uid;
  } else {
    uid = worldRoadCreate(line.vertices, [worldRoadAttachAt(pts[0], z), far], line.handles, line.cornerRadii);
  }
  setShape('select');
  worldMapSelect({ sceneId: null, place: '', road: uid });
  enterShapeEditMode(worldRoadByUid(uid).id);
  worldPlaceCommit();
}

// ─── Deleting ────────────────────────────────────────────────────────────────

// A road goes and its scenes stay where they are, as scenes with no road.
function worldMapRoadDelete(uid) {
  if (!worldRoadByUid(uid)) return;
  worldUndoPush();
  clearShapeSelection();
  worldMapSel = { sceneId: null, place: '', road: '' };
  worldRoadDelete(uid);
  worldMapRefresh();
}

// A scene let go of its road: set a little to the side, so it is plain that it left.
function worldMapRoadLeave(id) {
  const r = worldRoadOfScene(id), s = allScenes.find(x => x.id === id);
  if (!r || !s) return;
  worldUndoPush();
  r.scenes = r.scenes.filter(x => x.id !== id);
  worldSceneSet(id, { worldPos: { x: s.worldPos.x, y: Math.round(s.worldPos.y + WM_CARD_H + WM_PAD) } });
  worldRoadsSave();
  worldPlaceCommit();
}
