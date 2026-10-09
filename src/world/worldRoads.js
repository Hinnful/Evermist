'use strict';
// worldRoads.js — the roads of the world map. A road is an open line the room editing code edits like a
// wall (`open`), two ends that stick to a scene or a place, and the scenes that sit on it. Roads are kept
// by a stored id, so names need not be unique. A scene record gains no field: the road holds its own list.

const WR_KEY = 'evermist.worldRoads';
let _wrRecs = null;              // uid → record: the live truth, edited in place by the room code
const _wrIds = Object.create(null);
let _wrNextId = WR_ID0;

function _wrAdopt(uid, rec) {
  if (!_wrOwn(_wrIds, uid)) _wrIds[uid] = _wrNextId++;
  rec.uid = uid;
  rec.id = _wrIds[uid];
  rec.mode = 'road';
  rec.open = true;
  _wrRecs[uid] = rec;
}

function _wrLoad() {
  if (_wrRecs) return _wrRecs;
  _wrRecs = Object.create(null);
  try {
    const raw = JSON.parse(localStorage.getItem(WR_KEY) || '{}');
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const k of Object.keys(raw)) { const c = wrCleanRoad(raw[k]); if (c) _wrAdopt(k, c); }
    }
  } catch (_) { /* a corrupt entry is no roads */ }
  return _wrRecs;
}

// Only what a road needs to come back, never the runtime id and look.
function _wrStrip(rec) {
  const r1 = n => Math.round(n * 10) / 10;
  const out = {
    name: rec.name,
    vertices: rec.vertices.map(v => ({ x: r1(v.x), y: r1(v.y) })),
    ends: rec.ends.map(e => ({ ...e })),
    scenes: rec.scenes.map(s => ({ id: s.id, t: Math.round(s.t * 10000) / 10000 })),
  };
  if (rec.handles && rec.handles.some(Boolean)) out.handles = rec.handles;
  if (rec.cornerRadius > 0) out.cornerRadius = rec.cornerRadius;
  if (rec.cornerRadii && rec.cornerRadii.some(r => r != null)) out.cornerRadii = rec.cornerRadii;
  return out;
}

function worldRoadRecords() { const m = _wrLoad(); return Object.keys(m).map(k => m[k]); }
function worldRoadByUid(uid) { const m = _wrLoad(); return _wrOwn(m, uid) ? m[uid] : null; }
function worldRoadById(id) { return worldRoadRecords().find(r => r.id === id) || null; }

function worldRoadsExport() {
  const out = Object.create(null);
  for (const r of worldRoadRecords()) out[r.uid] = _wrStrip(r);
  return out;
}

function worldRoadsSave() {
  try { localStorage.setItem(WR_KEY, JSON.stringify(worldRoadsExport())); } catch (_) { /* full or blocked */ }
}

// A new road from drawn points, with the curve each was dragged out to. Its ends stick to what they were drawn on.
function worldRoadCreate(vertices, ends, handles, cornerRadii) {
  const m = _wrLoad(), uid = wrNewUid(m);
  _wrAdopt(uid, wrCleanRoad({ name: t('New road'), vertices, ends, handles, cornerRadii }));
  worldRoadsFollow();
  worldRoadsSave();
  return uid;
}

function worldRoadDelete(uid) {
  const m = _wrLoad();
  if (!_wrOwn(m, uid)) return;
  delete m[uid];
  worldRoadsSave();
}

function worldRoadRename(uid, name) {
  const r = worldRoadByUid(uid);
  if (!r || typeof name !== 'string' || !name.trim()) return;
  r.name = name.trim().slice(0, WR_NAME_MAX);
  worldRoadsSave();
}

// ─── Undo ────────────────────────────────────────────────────────────────────

function worldRoadsSnapshot() {
  return JSON.stringify(worldRoadRecords().map(r => [r.uid, _wrStrip(r)]));
}

// The ids stay with their roads, so a pick survives an undo.
function worldRoadsRestore(snap) {
  _wrRecs = Object.create(null);
  for (const [uid, rec] of JSON.parse(snap)) _wrAdopt(uid, wrCleanRoad(rec));
  worldRoadsSave();
}

// ─── What the roads read of the world ────────────────────────────────────────

function _wrWorldCtx() {
  return {
    scene: id => {
      const s = allScenes.find(x => x.id === id);
      return s ? wmCleanPos(_wmLive[id] || s.worldPos) : null;
    },
    place: name => { const r = worldPlaceByName(name); return r ? wmOutline(r) : null; },
  };
}

// The world as a click sees it at zoom z: a scene with no place (its diamond far out, its card close
// in) and the smallest place holding the point.
function _wrHitCtx(z) {
  const far = z < WM_SPLIT;
  return {
    sceneAt: p => {
      for (const s of allScenes) {
        const pos = wmCleanPos(_wmLive[s.id] || s.worldPos);
        if (!pos || sanitizeGroupName(s.group)) continue;
        if (far ? Math.hypot(p.x - pos.x, p.y - pos.y) < 14 / z
                : Math.abs(p.x - pos.x) <= WM_CARD_W / 2 && Math.abs(p.y - pos.y) <= WM_CARD_H / 2) return s.id;
      }
      return '';
    },
    placeAt: p => {
      let best = null, area = Infinity;
      for (const rec of worldPlaceRecords()) {
        const outline = wmOutline(rec);
        if (!wmPointInPoly(p, outline)) continue;
        const a = wmPolyArea(outline);
        if (a <= area) { best = { name: rec.name, outline }; area = a; }
      }
      return best;
    },
  };
}

function worldRoadAttachAt(p, z) { return wrAttachAt(p, _wrHitCtx(z)); }

// Every end sticks to its thing again, in memory: the live truth while a scene or a place is carried.
// ⚠ NEVER WHILE A CORNER IS DRAGGED: an end under the hand is not yet the end's anchor.
function worldRoadsFollow() {
  if (typeof isDraggingVertex !== 'undefined' && isDraggingVertex) return false;
  const ctx = _wrWorldCtx();
  let changed = false;
  for (const r of worldRoadRecords()) {
    const v = wrFollow(r, ctx);
    if (v !== r.vertices) { r.vertices = v; changed = true; }
  }
  return changed;
}

// id → the spot on its road, for every scene a road holds.
function worldRoadScenePos() {
  const out = Object.create(null);
  for (const r of worldRoadRecords()) {
    if (!r.scenes.length) continue;
    const pts = wrSamples(r);
    for (const s of r.scenes) out[s.id] = wrPointAt(pts, s.t);
  }
  return out;
}

// The road's line as it is drawn: cut where it enters the place it ends in, or null when it is whole.
function worldRoadVisible(r) { return wrVisible(r, _wrWorldCtx()); }

// The open end of a road under p at zoom z, for the Road tool to pick up from.
function worldRoadEndAt(p, z) { return wrEndNear(worldRoadRecords(), p, 12 / z); }

function worldRoadOfScene(id) {
  return worldRoadRecords().find(r => r.scenes.some(s => s.id === id)) || null;
}

// Whatever the room code or a drag changed: an end moved by hand sticks to what it landed on, every
// end is laid on its thing, the road's scenes sit on their line, and the roads are kept.
function worldRoadsCommit() {
  const ctx = _wrWorldCtx(), hit = _wrHitCtx(_wmCam.z);
  for (const r of worldRoadRecords()) {
    r.ends.forEach((end, k) => {
      // ⚠ ONLY THE PICKED ROAD'S END IS DRAGGED: any other end off its scene or place had that thing move.
      const dragged = r.id === selectedPolygonId && wrEndMoved(r, k, ctx), openPicked = end.kind === null && r.id === selectedPolygonId;
      if (!dragged && !openPicked) return;
      const next = wrAttachAt(r.vertices[k ? r.vertices.length - 1 : 0], hit);
      if (dragged || next.kind !== null) r.ends[k] = next;
    });
  }
  worldRoadsFollow();
  const pos = worldRoadScenePos();
  for (const id of Object.keys(pos)) {
    const s = allScenes.find(x => x.id === id), p = { x: Math.round(pos[id].x), y: Math.round(pos[id].y) };
    if (s && (!s.worldPos || s.worldPos.x !== p.x || s.worldPos.y !== p.y || sanitizeGroupName(s.group))) worldSceneSet(id, { worldPos: p, group: '' });
  }
  worldRoadsSave();
}

function worldRoadsDetach(id) {
  const had = worldRoadOfScene(id);
  if (had) had.scenes = had.scenes.filter(s => s.id !== id);
}

// A scene let go at pos: off any road it was on, and onto the road under it unless a place holds the
// whole card. Answers where it ends up.
function worldRoadsSettleScene(id, pos) {
  worldRoadsDetach(id);
  const outlines = Object.create(null);
  for (const rec of worldPlaceRecords()) outlines[rec.name] = wmOutline(rec);
  if (wmPlaceOf(wmCardRect(pos), outlines)) return pos;
  const snap = wrSnap(worldRoadRecords().map(r => ({ uid: r.uid, pts: wrSamples(r) })), pos, 18 / _wmCam.z);
  if (!snap) return pos;
  worldRoadByUid(snap.uid).scenes.push({ id, t: snap.t });
  return { x: Math.round(snap.x), y: Math.round(snap.y) };
}

// ─── What a place or a scene going does to its roads ─────────────────────────

function worldRoadsOpenPlace(name) {
  for (const r of worldRoadRecords()) r.ends = wrOpenEnds(r, 'place', [name]).ends;
  worldRoadsSave();
}

function worldRoadsRenamePlace(from, to) {
  for (const r of worldRoadRecords()) r.ends = wrRenamePlace(r, from, to).ends;
  worldRoadsSave();
}

// Scenes whose delete is final: their ends open and they leave their roads.
function worldRoadsSceneGone(ids) {
  for (const r of worldRoadRecords()) { const o = wrOpenEnds(r, 'scene', ids); r.ends = o.ends; r.scenes = o.scenes; }
  worldRoadsSave();
}

// A backup's roads, moved with the restored scenes. `sceneMap` is { backupId: newId }, `places` the names
// of the backup's own places that came back. A road whose key the DM already uses takes a new one.
// Answers { backupKey: key } for the notes that follow.
function worldRoadsMerge(incoming, sceneMap, places, dx, dy) {
  const m = _wrLoad(), keys = Object.create(null);
  for (const old of Object.keys(incoming)) {
    const uid = _wrOwn(m, old) ? wrNewUid(m) : old;
    _wrAdopt(uid, wrRemap(incoming[old], sceneMap, places, dx, dy));
    keys[old] = uid;
  }
  worldRoadsSave();
  return keys;
}
