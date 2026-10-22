'use strict';
// worldPlaces.js — the places of the world map. A place is a room-shaped record (vertices, corner
// radii, curve handles) kept by name, so the room's own editing code works on it. A scene belongs to
// the place whose outline holds its whole card, so the places decide every scene's `group`.

const WM_SHAPES_KEY = 'evermist.placeShapes';
const WM_PLACE_ID0 = 1000000;    // clear of every room id, which the room editing code shares
let _wpRecs = null;              // name → record: the live truth, edited in place by the room code
const _wpIds = Object.create(null);
let _wpNextId = WM_PLACE_ID0;
let _wpUndo = [], _wpRedo = [];
let _wpSeen = Object.create(null);   // uid → the parts as last saved, which a save compares against
let _wpQuiet = false;                // an import keeps the times that arrive, so its writes stamp nothing

const _wsOwn = (map, k) => Object.prototype.hasOwnProperty.call(map, k);

function _wpAdopt(name, rec) {
  if (!_wsOwn(_wpIds, name)) _wpIds[name] = _wpNextId++;
  rec.name = name;
  rec.id = _wpIds[name];
  rec.mode = 'place';
  if (!rec.uid) rec.uid = 'legacy-' + name;
  _wpRecs[name] = rec;
}

function _wpLoad() {
  if (_wpRecs) return _wpRecs;
  _wpRecs = Object.create(null);
  try {
    const raw = JSON.parse(localStorage.getItem(WM_SHAPES_KEY) || '{}');
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const k of Object.keys(raw)) { const c = wmCleanPlace(raw[k]); if (c) _wpAdopt(k, c); }
    }
  } catch (_) { /* a corrupt entry is no places, and the default rectangles come back */ }
  _wpMarkSeen();
  return _wpRecs;
}

// A place's outline alone: what `shape` stamps.
function _wpShape(rec) {
  const out = { vertices: rec.vertices.map(v => ({ x: Math.round(v.x), y: Math.round(v.y) })) };
  if (rec.cornerRadius > 0) out.cornerRadius = rec.cornerRadius;
  if (rec.cornerRadii && rec.cornerRadii.some(r => r != null)) out.cornerRadii = rec.cornerRadii;
  if (rec.handles && rec.handles.some(Boolean)) out.handles = rec.handles;
  return out;
}

// Only what a place needs to come back, never the runtime id and look.
function _wpStrip(rec) {
  const out = _wpShape(rec);
  out.uid = rec.uid;
  if (rec.edits && Object.keys(rec.edits).length) out.edits = rec.edits;
  return out;
}

function _wpParts(rec, notes) {
  return { shape: esCanon(_wpShape(rec)), name: rec.name, notes: _wsOwn(notes, rec.name) ? notes[rec.name] : '' };
}

function _wpMarkSeen() {
  const notes = notesPlacesAll();
  _wpSeen = esSeen(Object.keys(_wpRecs).map(k => _wpRecs[k]), r => _wpParts(r, notes));
}

// name → record, the LIVE map: the room editing code writes into these objects.
function worldPlacesAll() { return _wpLoad(); }
function worldPlaceRecords() { const m = _wpLoad(); return Object.keys(m).map(k => m[k]); }
function worldPlaceByName(name) { const m = _wpLoad(); return _wsOwn(m, name) ? m[name] : null; }
function worldPlaceNameOfId(id) { const r = worldPlaceRecords().find(x => x.id === id); return r ? r.name : ''; }

// The places as they are kept and as a backup carries them.
function worldPlacesExport() {
  const out = Object.create(null);
  for (const r of worldPlaceRecords()) out[r.name] = _wpStrip(r);
  return out;
}

function worldPlacesSave() {
  if (!_wpQuiet) { const notes = notesPlacesAll(); esStampRecords(worldPlaceRecords(), _wpSeen, r => _wpParts(r, notes), Date.now()); }
  try { localStorage.setItem(WM_SHAPES_KEY, JSON.stringify(worldPlacesExport())); } catch (_) { /* full or blocked */ }
}

// A record, or bare vertices, kept under `name`.
function worldPlaceSet(name, rec) {
  const m = _wpLoad();
  const c = wmCleanPlace(rec) || { vertices: rec.vertices || rec };
  if (!c.uid) c.uid = _wsOwn(m, name) ? m[name].uid : 'pl' + esRandomUid();
  _wpAdopt(name, c);
  worldPlacesSave();
}

function worldShapeDelete(name) {
  const m = _wpLoad();
  if (!_wsOwn(m, name)) return;
  delete m[name];
  worldPlacesSave();
  worldRoadsOpenPlace(name);
}

// A rename that carries the place's notes along: only the name is stamped, since the notes were not edited.
// An import renames through here too and keeps the times it arrived with.
function worldShapeRenameWithNotes(from, to, moveNotes) {
  const was = _wpQuiet;
  _wpQuiet = true;
  try { moveNotes(); worldShapeRename(from, to); } finally { _wpQuiet = was; }
  const rec = worldPlaceByName(to);
  if (rec && !was) rec.edits = { ...rec.edits, name: Date.now() };
  if (!was) { _wpMarkSeen(); worldPlacesSave(); }
}

// A rename onto a place that exists keeps that place; the other one goes.
function worldShapeRename(from, to) {
  const m = _wpLoad();
  if (from === to || !_wsOwn(m, from)) return;
  if (_wsOwn(m, to)) { delete m[from]; } else { _wpIds[to] = _wpIds[from]; _wpAdopt(to, m[from]); delete m[from]; }
  delete _wpIds[from];
  worldPlacesSave();
  worldRoadsRenamePlace(from, to);
}

// An import's places, from tpMergePlaces: new ones are added moved by (dx, dy), matched ones take the parts
// the plan says, and every place keeps the times that arrived. A rename goes through the usual path, so the
// scenes in the place and its notes follow; onto a name another place wears it is skipped.
function worldPlacesImport(plan, dx, dy) {
  const m = _wpLoad();
  _wpQuiet = true;
  try {
    for (const p of plan.add) {
      const c = wmCleanPlace(p.rec);
      c.vertices = c.vertices.map(v => ({ x: v.x + dx, y: v.y + dy }));
      c.uid = tpPlaceUid(p.rec, p.name);
      _wpAdopt(p.name, c);
      if (p.note) notesPlaceSet(p.name, p.note);
    }
    for (const u of plan.update) {
      const rec = m[u.name];
      if (!rec) continue;
      if (u.shape) {
        const c = wmCleanPlace(u.shape);
        for (const k of ['vertices', 'cornerRadius', 'cornerRadii', 'handles']) { if (c[k] === undefined) delete rec[k]; else rec[k] = c[k]; }
      }
      if (u.note !== undefined) notesPlaceSet(u.name, u.note);
      rec.edits = u.edits;
      if (u.rename && !_wsOwn(m, u.rename)) renameGroup(u.name, u.rename);
    }
    _wpMarkSeen();
    worldPlacesSave();
  } finally { _wpQuiet = false; }
}

const _wsGroup = s => sanitizeGroupName(s.group);

function _wpOutlines() {
  const out = Object.create(null);
  for (const r of worldPlaceRecords()) out[r.name] = wmOutline(r);
  return out;
}

// A group with scenes and no place (every group made before the map, or in the library) gets the
// rectangle that fits its scenes.
function worldEnsureShapes() {
  const m = _wpLoad();
  let changed = false;
  for (const name of new Set(allScenes.map(_wsGroup).filter(Boolean))) {
    if (_wsOwn(m, name)) continue;
    const r = wmHullRect(allScenes.filter(s => _wsGroup(s) === name && wmCleanPos(s.worldPos)).map(s => s.worldPos));
    if (!r) continue;
    _wpAdopt(name, { vertices: wmRectShape(r.x, r.y, r.x + r.w, r.y + r.h) });
    changed = true;
  }
  if (changed) worldPlacesSave();
}

// A scene filed under a place in the library sits wherever it was. It moves into the place.
function worldPullIn() {
  const outlines = _wpOutlines();
  for (const s of allScenes) {
    const name = _wsGroup(s);
    if (!name || !_wsOwn(outlines, name) || !wmCleanPos(s.worldPos) || worldRoadOfScene(s.id)) continue;
    if (wmRectInPoly(wmCardRect(s.worldPos), outlines[name])) continue;
    const taken = allScenes.filter(o => o !== s && _wsGroup(o) === name && wmCleanPos(o.worldPos)).map(o => wmCardRect(o.worldPos));
    const spot = wmSlotInPoly(outlines[name], taken) || wmPolyCentre(outlines[name]);
    worldSceneSet(s.id, { worldPos: { x: Math.round(spot.x), y: Math.round(spot.y) } });
  }
}

// The places decide: every scene is filed under the place that holds all of its card, or under none.
function worldAssignAll() {
  const outlines = _wpOutlines();
  for (const s of allScenes) {
    if (!wmCleanPos(s.worldPos) || worldRoadOfScene(s.id)) continue;
    const name = wmPlaceOf(wmCardRect(s.worldPos), outlines);
    if (name !== _wsGroup(s)) worldSceneSet(s.id, { group: name });
  }
}

function worldReconcile() {
  worldEnsureShapes();
  worldPullIn();
  worldAssignAll();
}

// A new place from vertices: named, entered in the library's groups, and filled with the scenes inside.
function worldPlaceCreate(verts) {
  worldUndoPush();
  const name = addGroup(t('New group'));
  worldPlaceSet(name, { vertices: verts });
  worldAssignAll();
  return name;
}

// ─── Undo ────────────────────────────────────────────────────────────────────
// The room editing code pushes an undo step before each edit; here a step is the places, their notes and
// where every scene stands.
function _wpSnapshot() {
  const places = JSON.stringify(worldPlaceRecords().map(r => [r.name, _wpStrip(r)]));
  return { places, notes: notesPlacesAll(), roads: worldRoadsSnapshot(), scenes: allScenes.map(s => ({ id: s.id, pos: s.worldPos && { ...s.worldPos }, group: _wsGroup(s) })) };
}

// ⚠ ONLY A PLACE THE STEP BRINGS BACK OR TAKES AWAY has its notes touched; one that stays keeps what was typed since.
function _wpRestoreNotes(before, snap) {
  const after = new Set(worldPlaceRecords().map(r => r.name));
  for (const name of before) if (!after.has(name)) notesPlaceSet(name, '');
  for (const name of after) {
    if (before.has(name)) continue;
    if (!knownGroupNames().includes(name)) addGroup(name);   // or the next new place could take its name
    if (_wsOwn(snap.notes, name)) notesPlaceSet(name, snap.notes[name]);
  }
}

// The whole world map's state as one value and back, for a caller with a history of its own (mcpHistory.js).
function worldSnapshotTake() { return _wpSnapshot(); }
function worldSnapshotPut(snap) { _wpRestore(snap); }

function worldUndoPush() {
  _wpUndo.push(_wpSnapshot());
  if (_wpUndo.length > 50) _wpUndo.shift();
  _wpRedo = [];
}

function _wpRestore(snap) {
  const before = new Set(worldPlaceRecords().map(r => r.name));
  _wpRecs = Object.create(null);
  for (const [name, rec] of JSON.parse(snap.places)) _wpAdopt(name, wmCleanPlace(rec));
  worldPlacesSave();
  _wpRestoreNotes(before, snap);
  worldRoadsRestore(snap.roads);
  for (const s of snap.scenes) {
    const now = allScenes.find(x => x.id === s.id);
    if (now && (s.pos && (!now.worldPos || now.worldPos.x !== s.pos.x || now.worldPos.y !== s.pos.y) || _wsGroup(now) !== s.group)) {
      worldSceneSet(s.id, { worldPos: s.pos, group: s.group });
    }
  }
}

function worldUndoStep(from, to) {
  if (!from.length) return;
  to.push(_wpSnapshot());
  _wpRestore(from.pop());
  // As a room's undo: a place or road that survived stays picked at its level, only the indices go.
  if (selectedPolygonId == null || !activeShapeList().some(s => s.id === selectedPolygonId)) clearShapeSelection();
  else { selectedVertexIndex = -1; selectedHoleIndex = -1; holeEditMode = false; }
  worldMapRefresh();
}

function worldUndo() { worldUndoStep(_wpUndo, _wpRedo); }
function worldRedo() { worldUndoStep(_wpRedo, _wpUndo); }
function worldUndoDropLast() { _wpUndo.pop(); }
function worldUndoClear() { _wpUndo = []; _wpRedo = []; }
