'use strict';
// transferPlan.js — pure kernel: what an import does with a scene, room, effect, place, road and the
// backdrop that exists on both machines. The part edited later wins; a part with no time is the oldest,
// a tie goes to the incoming copy, and an incoming time past the import's moment counts as that moment.
// Rooms and effects are matched by `uid`, places by `uid` then name, roads by key. Tested.

const _TP_ES = typeof esCanon === 'function'
  ? { esCanon, esRoomParts, esEffectPart, esSceneParts, esWithUids, ES_SCENE_PARTS, ES_ROOM_OWN }
  : require('./editStamps.js');
const _TP_FG = typeof decodeShapeFromSave === 'function'
  ? { decodeShapeFromSave, encodeShapeForSave }
  : require('../fog/fogGeometry.js');

const TP_ROOM_PARTS = ['shape', 'notes', 'mode'];
const TP_PART_LABEL = {
  name: 'name', grid: 'grid', map: 'map', fog: 'fog', notes: 'notes', fogSettings: 'fog settings', lights: 'lights', tvFit: 'TV fit',
  shape: 'shape', mode: 'revealed state', text: 'name and notes', effect: 'effect', deleted: 'room deleted',
};

function tpTime(times, key, moment) {
  const t = times && times[key];
  return Number.isFinite(t) && t > 0 ? Math.min(t, moment) : 0;
}

function _tpLatest(times, moment) {
  let m = 0;
  for (const k of Object.keys(times || {})) m = Math.max(m, tpTime(times, k, moment));
  return m;
}

// Which id an incoming scene takes here: its own when this library holds it (a match) or when it is free
// and safe as a file name, else a fresh one. `mint()` answers a new id.
function tpSceneIds(manifest, localIds, isSafe, mint) {
  const taken = new Set(localIds), matched = new Set();
  return manifest.map(entry => {
    const id = entry && entry.id;
    if (typeof id === 'string' && localIds.has(id) && !matched.has(id)) { matched.add(id); return { entry, id, matched: true }; }
    if (typeof id === 'string' && isSafe(id) && !taken.has(id)) { taken.add(id); return { entry, id, matched: false }; }
    let fresh = mint();
    while (taken.has(fresh)) fresh = mint();
    taken.add(fresh);
    return { entry, id: fresh, matched: false };
  });
}

function _tpIndex(list) {
  const out = Object.create(null);
  for (const x of list) out[x.uid] = x;
  return out;
}

function _tpDecoded(list) {
  return _TP_ES.esWithUids((list || []).map(_TP_FG.decodeShapeFromSave));
}

function _tpApplyRoomPart(into, from, part) {
  if (part === 'shape') {
    for (const k of Object.keys(into)) if (!_TP_ES.ES_ROOM_OWN.includes(k)) delete into[k];
    for (const k of Object.keys(from)) if (!_TP_ES.ES_ROOM_OWN.includes(k)) into[k] = JSON.parse(JSON.stringify(from[k]));
  } else if (part === 'notes') {
    into.name = from.name;
    if (from.desc === undefined) delete into.desc; else into.desc = from.desc;
  } else into.mode = from.mode;
}

function _tpMergeRooms(localList, incList, le, ie, moment, rep) {
  const L = _tpDecoded(localList), I = _tpDecoded(incList), li = _tpIndex(L), ii = _tpIndex(I);
  const lt = le.rooms || {}, it = ie.rooms || {};
  const lg = le.goneRooms || {}, ig = ie.goneRooms || {};
  const out = [], times = {}, gone = { ...lg };
  for (const r of L) {
    const i = ii[r.uid];
    if (!i) {
      const g = tpTime(ig, r.uid, moment), own = _tpLatest(lt[r.uid], moment);
      if (g > 0 && g >= own) {
        rep.roomsRemoved.push(r.name);
        if (own > 0) rep.overwritten.push({ room: r.name, part: 'deleted' });
        gone[r.uid] = Math.max(g, tpTime(lg, r.uid, moment));
        continue;
      }
      out.push(r);
      if (lt[r.uid]) times[r.uid] = lt[r.uid];
      continue;
    }
    const m = { ...r }, lp = _TP_ES.esRoomParts(r), ip = _TP_ES.esRoomParts(i), t = {};
    for (const part of TP_ROOM_PARTS) {
      const tl = tpTime(lt[r.uid], part, moment), ti = tpTime(it[i.uid], part, moment);
      t[part] = Math.max(tl, ti);
      if (lp[part] === ip[part]) continue;
      if (ti >= tl) {
        _tpApplyRoomPart(m, i, part);
        rep.changed.push({ room: r.name, part });
        if (tl > 0) rep.overwritten.push({ room: r.name, part });
      } else rep.kept.push({ room: r.name, part });
    }
    out.push(m);
    times[r.uid] = t;
  }
  const used = new Set(out.map(r => r.id));
  let next = Math.max(1, ...out.map(r => (r.id || 0) + 1));
  const added = [];
  for (const i of I) {
    if (li[i.uid]) continue;
    const g = tpTime(lg, i.uid, moment), own = _tpLatest(it[i.uid], moment);
    if (g > 0 && g >= own) { rep.kept.push({ room: i.name, part: 'deleted' }); continue; }
    added.push(i);
    delete gone[i.uid];
    if (it[i.uid]) times[i.uid] = it[i.uid];
    rep.roomsAdded.push(i.name);
  }
  for (const i of added) {
    const room = { ...i };
    if (used.has(room.id)) room.id = next;
    used.add(room.id);
    next = Math.max(next, (room.id || 0) + 1);
    out.push(room);
  }
  return { list: out.map(r => { const c = { ...r }; delete c.modeWithHoles; return _TP_FG.encodeShapeForSave(c); }), times, gone, next };
}

function _tpMergeEffects(localList, incList, le, ie, moment, rep) {
  const L = _TP_ES.esWithUids(localList), I = _TP_ES.esWithUids(incList), li = _tpIndex(L), ii = _tpIndex(I);
  const lt = le.effects || {}, it = ie.effects || {}, lg = le.goneEffects || {}, ig = ie.goneEffects || {};
  const out = [], times = {}, gone = { ...lg };
  for (const e of L) {
    const i = ii[e.uid], tl = tpTime(lt, e.uid, moment);
    if (!i) {
      const g = tpTime(ig, e.uid, moment);
      if (g > 0 && g >= tl) { rep.effectsRemoved++; gone[e.uid] = Math.max(g, tpTime(lg, e.uid, moment)); continue; }
      out.push(e);
      if (tl > 0) times[e.uid] = lt[e.uid];
      continue;
    }
    const ti = tpTime(it, i.uid, moment);
    const differs = _TP_ES.esEffectPart(e) !== _TP_ES.esEffectPart(i);
    if (differs && ti >= tl) {
      out.push({ ...JSON.parse(JSON.stringify(i)), id: e.id });
      rep.changed.push({ room: '', part: 'effect' });
      if (tl > 0) rep.overwritten.push({ room: '', part: 'effect' });
    } else {
      out.push(e);
      if (differs) rep.kept.push({ room: '', part: 'effect' });
    }
    if (Math.max(tl, ti) > 0) times[e.uid] = Math.max(tl, ti);
  }
  const used = new Set(out.map(e => e.id));
  let next = Math.max(1, ...out.map(e => (e.id || 0) + 1));
  for (const i of I) {
    if (li[i.uid]) continue;
    const g = tpTime(lg, i.uid, moment), ti = tpTime(it, i.uid, moment);
    if (g > 0 && g >= ti) continue;
    const e = { ...i };
    if (used.has(e.id)) e.id = next;
    used.add(e.id);
    next = Math.max(next, (e.id || 0) + 1);
    out.push(e);
    delete gone[i.uid];
    if (ti > 0) times[i.uid] = ti;
    rep.effectsAdded++;
  }
  return { list: out, times, gone, next };
}

// A scene both machines hold. `local` and `incoming` are scene records (the incoming one without blobs).
// Answers the fields to write over the local record, which parts take their file from the zip, and what
// to tell the DM. `opts.localMapMissing` lets the incoming map in, whatever the times say.
function tpMergeScene(local, incoming, moment, opts) {
  const o = opts || {};
  const le = local.edits || {}, ie = incoming.edits || {};
  const lp = _TP_ES.esSceneParts(local), ip = _TP_ES.esSceneParts(incoming);
  const rep = { changed: [], kept: [], overwritten: [], roomsAdded: [], roomsRemoved: [], effectsAdded: 0, effectsRemoved: 0 };
  const take = {}, scene = {};
  for (const part of _TP_ES.ES_SCENE_PARTS) {
    const tl = tpTime(le.scene, part, moment), ti = tpTime(ie.scene, part, moment);
    scene[part] = Math.max(tl, ti);
    take[part] = part === 'map' ? ti > tl || !!o.localMapMissing : ti >= tl;
    const blob = part === 'map' || part === 'fog';
    const differs = blob ? ti !== tl : lp[part] !== ip[part];
    if (!differs) continue;
    if (take[part]) {
      rep.changed.push({ room: '', part });
      if (tl > 0) rep.overwritten.push({ room: '', part });
    } else rep.kept.push({ room: '', part });
  }
  const rooms = _tpMergeRooms(local.polygons, incoming.polygons, le, ie, moment, rep);
  const effects = _tpMergeEffects(local.effects, incoming.effects, le, ie, moment, rep);
  const record = {
    polygons: rooms.list,
    nextPolygonId: Math.max(local.nextPolygonId || 1, incoming.nextPolygonId || 1, rooms.next),
    effects: effects.list,
    nextEffectId: Math.max(local.nextEffectId || 1, incoming.nextEffectId || 1, effects.next),
    edits: { scene, rooms: rooms.times, goneRooms: rooms.gone, effects: effects.times, goneEffects: effects.gone },
  };
  if (take.name) record.name = incoming.name;
  if (take.grid) record.gridConfig = incoming.gridConfig || {};
  if (take.notes) record.notes = incoming.notes;
  if (take.fogSettings) record.fogSettings = incoming.fogSettings;
  if (take.tvFit) record.tvFit = incoming.tvFit;
  if (take.lights) { record.lightsHidden = !!incoming.lightsHidden; record.lightShapes = incoming.lightShapes || []; }
  const touched = rep.changed.length > 0 || rep.roomsAdded.length > 0 || rep.roomsRemoved.length > 0
    || rep.effectsAdded > 0 || rep.effectsRemoved > 0;
  return { record, take, report: rep, touched };
}

// ─── Places, roads and the backdrop ──────────────────────────────────────────

function tpPlaceUid(rec, name) { return (rec && rec.uid) || 'legacy-' + name; }

const _tpShapeKey = r => _TP_ES.esCanon({ v: r.vertices, c: r.cornerRadius, r: r.cornerRadii, h: r.handles });
const _tpRoadShapeKey = r => _TP_ES.esCanon({ v: r.vertices, c: r.cornerRadius, r: r.cornerRadii, h: r.handles, e: r.ends, s: r.scenes });

// The parts of a record both machines hold, as [part, differs] pairs: the newer time of each, which parts the
// file takes, which stay local, and which of the taken ones overwrote a local edit.
function _tpPick(le, ie, parts, moment) {
  const edits = {}, take = [], keep = [], over = [];
  for (const [part, differs] of parts) {
    const tl = tpTime(le, part, moment), ti = tpTime(ie, part, moment);
    edits[part] = Math.max(tl, ti);
    if (!differs) continue;
    if (ti >= tl) { take.push(part); if (tl > 0) over.push(part); } else keep.push(part);
  }
  return { edits, take, keep, over };
}

function _tpNoteRep(rep, label, pick) {
  for (const part of pick.over) rep.overwritten.push({ room: label, part });
  for (let i = 0; i < pick.keep.length; i++) rep.kept.push(label);
}

// `local` and `incoming` are lists of { name, rec, note }: a place's record with its `uid` and `edits`, and
// its note text. Answers what to add and what to update on a place both machines hold.
function tpMergePlaces(local, incoming, moment) {
  const byUid = Object.create(null), byName = Object.create(null);
  for (const p of local) { byUid[tpPlaceUid(p.rec, p.name)] = p; byName[p.name] = p; }
  const add = [], update = [];
  const rep = { added: [], updated: [], kept: [], overwritten: [] };
  for (const inc of incoming) {
    const l = byUid[tpPlaceUid(inc.rec, inc.name)] || byName[inc.name];
    if (!l) { add.push(inc); rep.added.push(inc.name); continue; }
    const pick = _tpPick(l.rec.edits, inc.rec.edits, [
      ['shape', _tpShapeKey(l.rec) !== _tpShapeKey(inc.rec)],
      ['name', l.name !== inc.name],
      ['notes', (l.note || '') !== (inc.note || '')],
    ], moment);
    const dir = { name: l.name, edits: pick.edits };
    if (pick.take.includes('shape')) dir.shape = inc.rec;
    if (pick.take.includes('name')) dir.rename = inc.name;
    if (pick.take.includes('notes')) dir.note = inc.note || '';
    update.push(dir);
    if (pick.take.length) rep.updated.push(l.name);
    _tpNoteRep(rep, l.name, pick);
  }
  return { add, update, report: rep, matched: update.length > 0 };
}

// `local` and `incoming` are { key: { rec, note } }. A road is `shape` (its line, ends and scenes) and
// `text` (its name and note).
function tpMergeRoads(local, incoming, moment) {
  const add = [], update = [];
  const rep = { added: [], updated: [], kept: [], overwritten: [] };
  for (const key of Object.keys(incoming)) {
    const inc = incoming[key], l = Object.prototype.hasOwnProperty.call(local, key) ? local[key] : null;
    if (!l) { add.push({ key, ...inc }); rep.added.push(inc.rec.name); continue; }
    const label = l.rec.name || 'road';
    const pick = _tpPick(l.rec.edits, inc.rec.edits, [
      ['shape', _tpRoadShapeKey(l.rec) !== _tpRoadShapeKey(inc.rec)],
      ['text', _TP_ES.esCanon([l.rec.name, l.note || '']) !== _TP_ES.esCanon([inc.rec.name, inc.note || ''])],
    ], moment);
    const dir = { key, edits: pick.edits };
    if (pick.take.includes('shape')) dir.shape = inc.rec;
    if (pick.take.includes('text')) dir.text = { name: inc.rec.name, note: inc.note || '' };
    update.push(dir);
    if (pick.take.length) rep.updated.push(label);
    _tpNoteRep(rep, label, pick);
  }
  return { add, update, report: rep, matched: update.length > 0 };
}

// 'none' with nothing incoming, 'take' when the incoming backdrop wins or fills an empty spot, else 'keep'.
function tpMergeBackground(local, incoming, moment) {
  if (!incoming) return { act: 'none', at: 0 };
  if (!local) return { act: 'take', at: tpTime(incoming, 'at', moment) };
  const tl = tpTime(local, 'at', moment), ti = tpTime(incoming, 'at', moment);
  return { act: ti >= tl ? 'take' : 'keep', at: Math.max(tl, ti) };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    tpTime, tpSceneIds, tpMergeScene, tpPlaceUid, tpMergePlaces, tpMergeRoads, tpMergeBackground, TP_PART_LABEL,
  };
}
