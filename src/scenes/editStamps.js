'use strict';
// editStamps.js — pure kernel: when each part of a stored record last changed. A save compares what
// is stored with what is about to be written and gives every changed part the save's time. Import
// reads these times to decide which copy of a part wins. Tested.

const ES_SCENE_PARTS = ['name', 'grid', 'map', 'fog', 'notes', 'fogSettings', 'lights', 'tvFit'];
const ES_ROOM_OWN = ['id', 'uid', 'name', 'desc', 'mode', 'modeWithHoles'];
const ES_GONE_MAX = 300;

// A stable text of any JSON value: object keys sorted, so equal data compares equal.
function esCanon(v) {
  if (v === undefined) return 'u';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(esCanon).join(',') + ']';
  return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined)
    .map(k => JSON.stringify(k) + ':' + esCanon(v[k])).join(',') + '}';
}

function esRoomParts(r) {
  const shape = {};
  for (const k of Object.keys(r)) if (!ES_ROOM_OWN.includes(k)) shape[k] = r[k];
  return { shape: esCanon(shape), notes: esCanon([r.name, r.desc]), mode: esCanon(r.modeWithHoles || r.mode) };
}

function esEffectPart(e) {
  const rest = {};
  for (const k of Object.keys(e)) if (k !== 'id' && k !== 'uid') rest[k] = e[k];
  return esCanon(rest);
}

function esSceneParts(s) {
  return {
    name: esCanon(s.name),
    grid: esCanon(s.gridConfig || {}),
    notes: esCanon(typeof s.notes === 'string' ? s.notes : ''),
    fogSettings: esCanon(s.fogSettings),
    // Off is absent, so a scene saved before the field and one stepped back to Off match.
    tvFit: esCanon(s.tvFit && s.tvFit.step ? { step: s.tvFit.step, turn: s.tvFit.turn } : null),
    lights: esCanon([!!s.lightsHidden, s.lightShapes || []]),
    map: esCanon([s.mapType || 'image', s.mapPath || '', s.mapWidth || 0, s.mapHeight || 0, s.mapBlob && s.mapBlob.size ? s.mapBlob.size : 0]),
  };
}

// A saved room or effect that carries no uid is one from before uids: `legacy-<id>` on every
// machine holding that scene, so the same room matches across machines.
function esLegacyUid(item) { return item.uid || 'legacy-' + item.id; }

function esWithUids(list) { return (list || []).map(x => (x.uid ? x : { ...x, uid: esLegacyUid(x) })); }

function esRandomUid(rand) {
  const r = rand || Math.random;
  return Math.floor(r() * 0xffffffff).toString(36) + Date.now().toString(36).slice(-4);
}

// Live lists, edited in place: a room with no uid gets a random one, and the later of two rooms
// sharing one gets another (a paste or a split copies the uid along).
function esAssignUids(list, rand) {
  const seen = Object.create(null);
  for (const x of list) {
    if (!x.uid || seen[x.uid]) x.uid = esRandomUid(rand);
    seen[x.uid] = true;
  }
  return list;
}

// What a record looked like, in parts: the input a later stamp compares against.
function esSnapshot(rec) {
  const rooms = Object.create(null), effects = Object.create(null);
  for (const r of esWithUids(rec.polygons)) rooms[r.uid] = esRoomParts(r);
  for (const e of esWithUids(rec.effects)) effects[e.uid] = esEffectPart(e);
  return { scene: esSceneParts(rec), rooms, effects, edits: rec.edits || {} };
}

// The times of the parts that changed, kept where a part did not. `prev` null means all are new.
function esDiff(times, prev, next, now) {
  const out = {};
  for (const k of Object.keys(next)) {
    if (!prev || prev[k] !== next[k]) out[k] = now;
    else if (times && times[k] > 0) out[k] = times[k];
  }
  return out;
}

function _esTrim(gone) {
  const keys = Object.keys(gone);
  if (keys.length <= ES_GONE_MAX) return gone;
  const out = {};
  keys.sort((a, b) => gone[b] - gone[a]).slice(0, ES_GONE_MAX).forEach(k => { out[k] = gone[k]; });
  return out;
}

function _esStampList(prevMap, nextMap, prevTimes, prevGone, now, one) {
  const times = {}, gone = { ...prevGone };
  for (const uid of Object.keys(nextMap)) {
    if (one) {
      const same = prevMap[uid] === nextMap[uid];
      const t = same ? (prevTimes && prevTimes[uid]) || 0 : now;
      if (t > 0) times[uid] = t;
    } else {
      times[uid] = esDiff(prevTimes && prevTimes[uid], prevMap[uid] || null, nextMap[uid], now);
    }
    delete gone[uid];
  }
  for (const uid of Object.keys(prevMap)) if (!nextMap[uid]) gone[uid] = now;
  return { times, gone: _esTrim(gone) };
}

// The record's `edits` after a save. `prev` is esSnapshot of what is stored (null for a new record),
// `next` the record being written, and `fogEdited` says the fog picture was painted since the last save.
function esStamp(prev, next, now, fogEdited) {
  const pe = prev ? prev.edits : {};
  const ns = esSnapshot(next);
  const scene = esDiff(pe.scene, prev && prev.scene, ns.scene, now);
  if (!prev || fogEdited) scene.fog = now;
  else if (pe.scene && pe.scene.fog > 0) scene.fog = pe.scene.fog;
  const r = _esStampList(prev ? prev.rooms : {}, ns.rooms, pe.rooms, pe.goneRooms, now);
  const e = _esStampList(prev ? prev.effects : {}, ns.effects, pe.effects, pe.goneEffects, now, true);
  return { scene, rooms: r.times, goneRooms: r.gone, effects: e.times, goneEffects: e.gone };
}

// Records that carry their own `edits` (places, roads). `seen` maps uid to the parts as last saved, and
// `partsOf(rec)` reads them; a stamp compares the two, times what differs, and moves `seen` on.
function esSeen(recs, partsOf) {
  const seen = Object.create(null);
  for (const r of recs) seen[r.uid] = partsOf(r);
  return seen;
}

function esStampRecords(recs, seen, partsOf, now) {
  for (const r of recs) {
    const parts = partsOf(r);
    r.edits = esDiff(r.edits, seen[r.uid] || null, parts, now);
    seen[r.uid] = parts;
  }
}

// A save by a writer that only touches scene-level fields (a rename, a place, a note): the scene parts are
// compared and the rooms' and effects' times carry over untouched, with no pass over every room.
function esStampScene(before, next, now) {
  const pe = before.edits || {};
  return {
    scene: esDiff(pe.scene, before.scene, esSceneParts(next), now),
    rooms: pe.rooms || {}, goneRooms: pe.goneRooms || {}, effects: pe.effects || {}, goneEffects: pe.goneEffects || {},
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ES_SCENE_PARTS, ES_ROOM_OWN, esCanon, esRoomParts, esEffectPart, esSceneParts, esLegacyUid, esWithUids,
    esRandomUid, esAssignUids, esSnapshot, esDiff, esStamp, esStampScene, esSeen, esStampRecords,
  };
}
