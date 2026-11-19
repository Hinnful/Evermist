'use strict';
// roomPieces.js — a room made of separate pieces. A piece is an ordinary record in `polygons` (or `effects`) whose
// `pieceOf` holds the uid of the room's first record, its head. The head holds the name, notes and uid; a piece's own
// name is ignored. ⚠ LINKED BY UID, NEVER BY ID: sync and Import renumber ids (transferPlan.js).
// Pure helpers, tested; pickedRoomIds() at the end reads the live selection.

const _RP = typeof shapesOverlap === 'function' ? { shapesOverlap, mostHiddenMode } : require('./roomOps.js');

// ⚠ ALONE, never by running esAssignUids over the list: it keeps the first holder in list order.
function _rpMintUid() {
  return (typeof esRandomUid === 'function' ? esRandomUid : require('../scenes/editStamps.js').esRandomUid)();
}

function ensureRoomUid(head) {
  if (!head.uid) head.uid = _rpMintUid();
  return head.uid;
}

function isPiece(s) { return !!s && typeof s.pieceOf === 'string' && s.pieceOf !== ''; }

// uid → the first record holding it that is no piece.
function _rpHeads(list) {
  const m = new Map();
  for (const x of list) if (x && x.uid && !isPiece(x) && !m.has(x.uid)) m.set(x.uid, x);
  return m;
}

// The head a piece's link names; null when the link counts as none: a missing room, a piece, or itself.
function _rpLinked(heads, s) {
  if (!isPiece(s)) return null;
  const h = heads.get(s.pieceOf);
  return h && h !== s ? h : null;
}

function _rpRoom(list, heads, s) {
  const head = _rpLinked(heads, s) || s;
  if (!head.uid || heads.get(head.uid) !== head) return [head];
  return list.filter(x => x === head || _rpLinked(heads, x) === head);
}

function roomHeadOf(list, s) { return (s && _rpLinked(_rpHeads(list), s)) || s; }

function roomHeadById(list, id) {
  const s = list.find(x => x.id === id);
  return s ? roomHeadOf(list, s) : null;
}

// Every record of the room `s` belongs to, the head first.
function piecesOf(list, s) { return s ? _rpRoom(list, _rpHeads(list), s) : []; }

function isLivePiece(list, s) { return !!_rpLinked(_rpHeads(list), s); }

// The list with every piece left out: one record per room, for whatever lists or counts rooms.
function roomHeads(list) {
  const heads = _rpHeads(list || []);
  return (list || []).filter(x => !_rpLinked(heads, x));
}

// head → its records (the head first), in list order, in one pass: for whatever walks every room per frame.
function roomGroups(list) {
  const heads = _rpHeads(list || []), out = new Map();
  for (const x of list || []) {
    const h = _rpLinked(heads, x) || x;
    if (!out.has(h)) out.set(h, [h]);
    if (h !== x) out.get(h).push(x);
  }
  return out;
}

function _rpArea(s) {
  const ring = v => {
    let a = 0;
    for (let i = 0, n = v.length; i < n; i++) a += v[i].x * v[(i + 1) % n].y - v[(i + 1) % n].x * v[i].y;
    return Math.abs(a) / 2;
  };
  return ring(s.vertices || []) - (s.holes || []).reduce((t, h) => t + ring(h), 0);
}

function largestPiece(records) {
  let best = null, area = -1;
  for (const r of records) { const a = _rpArea(r); if (a > area) { area = a; best = r; } }
  return best;
}

// Every record of every picked room, in pick order: the picked record, then the rest of its room in list order, each once.
function roomPickRecords(list, ids) {
  const heads = _rpHeads(list), out = [], seen = new Set();
  for (const id of ids) {
    const s = list.find(x => x.id === id);
    if (!s || seen.has(s)) continue;
    for (const r of [s, ..._rpRoom(list, heads, s)]) if (!seen.has(r)) { seen.add(r); out.push(r); }
  }
  return out;
}

function roomRecordIds(list, ids) { return roomPickRecords(list, ids).map(r => r.id); }

// True when the two records are pieces of one room.
function sameRoom(list, a, b) {
  const heads = _rpHeads(list);
  return !!a && !!b && (_rpLinked(heads, a) || a) === (_rpLinked(heads, b) || b);
}

// Picks stay one id per room: the first id of each room in `ids` is kept.
function onePickPerRoom(list, ids) {
  const heads = _rpHeads(list), seen = new Set(), out = [];
  for (const id of ids) {
    const s = list.find(x => x.id === id);
    const room = s && (_rpLinked(heads, s) || s);
    if (room && !seen.has(room)) { seen.add(room); out.push(id); }
  }
  return out;
}

// A Shift+click on `id` with `mainId` and `extraIds` picked: the extras next, or null when nothing changes. A piece of
// the main's room changes nothing, and a piece of a picked room takes that room out.
function toggleRoomPick(list, mainId, extraIds, id) {
  const s = list.find(x => x.id === id), main = list.find(x => x.id === mainId);
  if (!s || sameRoom(list, s, main)) return null;
  const hit = extraIds.find(x => sameRoom(list, s, list.find(y => y.id === x)));
  return hit !== undefined ? extraIds.filter(x => x !== hit) : extraIds.concat(id);
}

// True when `s` belongs to a room one of `ids` picks.
function roomInPick(list, ids, s) { return ids.some(id => sameRoom(list, s, list.find(x => x.id === id))); }

// A map's rooms as they load, edited in place. One pass, read by the open map's load and by Claude's read of a stored
// map alike: a link to a missing room, a piece or itself is dropped; a room's pieces take the most hidden fog among them
// and an effect's pieces its head's material;
// a piece's own non-empty notes move below the room's.
function reconcileRoomPieces(list) {
  if (!Array.isArray(list)) return list;
  const heads = _rpHeads(list), rooms = new Map();
  for (const x of list) {
    if (!isPiece(x)) continue;
    const h = _rpLinked(heads, x);
    if (!h) { delete x.pieceOf; continue; }
    if (!rooms.has(h)) rooms.set(h, []);
    rooms.get(h).push(x);
  }
  for (const [h, pieces] of rooms) {
    if (typeof h.mode === 'string') {
      const mode = _RP.mostHiddenMode([h, ...pieces].map(p => p.mode));
      for (const p of [h, ...pieces]) p.mode = mode;
    }
    if (typeof h.material === 'string') for (const p of pieces) p.material = h.material;   // an effect is one material
    for (const p of pieces) {
      const own = typeof p.desc === 'string' ? p.desc.trim() : '';
      if (own) h.desc = [typeof h.desc === 'string' ? h.desc.trim() : '', own].filter(Boolean).join('\n\n');
      delete p.desc;
    }
  }
  return list;
}

// The head left the list (a cut left nothing of it, or a join took it): the largest piece still linked to it takes its
// name, notes and uid, so every other piece's link holds unchanged. ⚠ The uid comes off the old record first.
function succeedRoomHead(list, oldHead) {
  const uid = oldHead && oldHead.uid;
  if (!uid || isPiece(oldHead) || list.includes(oldHead)) return null;
  const pieces = list.filter(x => x.pieceOf === uid);
  if (!pieces.length) return null;
  const next = largestPiece(pieces);
  delete oldHead.uid;
  delete next.pieceOf;
  next.uid = uid;
  if (oldHead.name !== undefined) next.name = oldHead.name;
  if (typeof oldHead.desc === 'string' && oldHead.desc) next.desc = oldHead.desc; else delete next.desc;
  return next;
}

// A Split crossed the room: every record of it is a room of its own. The largest keeps the room's name, notes and uid,
// and the others take `nameFor`'s plain name.
function dissolveRoom(records, head, nameFor) {
  const big = largestPiece(records);
  const uid = head.uid, name = head.name, desc = head.desc;
  for (const r of records) delete r.pieceOf;
  if (big !== head) {
    delete head.uid;
    if (uid) big.uid = uid;
    if (name !== undefined) big.name = name;
    if (desc) big.desc = desc; else delete big.desc;
  }
  for (const r of records) {
    if (r === big) continue;
    const plain = nameFor(r);
    if (plain === undefined) delete r.name; else r.name = plain;
    delete r.desc;
  }
  return big;
}

// A boolean on picked rooms as plan groups for shapePlanApplied. `recs` is roomPickRecords' answer, the main first and
// the rest of its room next (`mainCount` in all); `out` is the kernel's, `out.shapes` Merge's welded copies aligned
// with `recs`. A result piece goes to the main when it holds the main's area, else to the earliest record in `list`
// whose area it holds. A record holding no piece welds into the group of the first piece it holds, else the main's;
// another room's record that keeps a piece becomes a piece of the main's room.
function pickedBooleanPlan(list, recs, mainCount, out) {
  const shapes = out.shapes || recs, main = recs[0];
  const own = new Map(), joined = new Map();
  for (const pc of out.pieces) {
    const at = { vertices: pc.verts, holes: pc.holes };
    const hit = recs.filter((r, i) => _RP.shapesOverlap(shapes[i], at));
    const owner = hit.includes(main) ? main : hit.sort((a, b) => list.indexOf(a) - list.indexOf(b))[0] || main;
    if (!own.has(owner)) own.set(owner, []);
    own.get(owner).push(pc);
    for (const r of hit) if (!joined.has(r)) joined.set(r, owner);
  }
  const owners = recs.filter(r => own.has(r));
  if (!owners.length) return [];
  const groups = new Map(owners.map(o => [o, [o]]));
  const first = own.has(main) ? main : owners[0];
  for (const r of recs) if (!own.has(r)) groups.get(joined.get(r) || first).push(r);
  const inMain = new Set(recs.slice(0, mainCount)), head = roomHeadOf(list, main);
  return owners.map(o => ({ shapes: groups.get(o), pieces: own.get(o), detail: shapes, kind: 'link',
    ...(inMain.has(o) ? {} : { joinTo: head }) }));
}

// Copied records, edited in place: each copied head with pieces among them takes a new uid and its pieces follow it,
// so a copy is a room of its own. ⚠ The copies only: the source keeps its uid.
function renewRoomUids(records) {
  const heads = _rpHeads(records), moved = new Map();
  for (const r of records) if (r.uid && heads.get(r.uid) === r && records.some(x => _rpLinked(heads, x) === r)) moved.set(r.uid, r);
  for (const [old, head] of moved) {
    head.uid = _rpMintUid();
    for (const x of records) if (x.pieceOf === old) x.pieceOf = head.uid;
  }
  return records;
}

// Every record of the picked rooms, by id: what Delete, T, copy, Split's limit and the booleans act on.
function pickedRoomIds() {
  return worldMapOpen ? pickedIds() : roomRecordIds(activeShapeList(), pickedIds());
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isPiece, isLivePiece, roomGroups, roomHeadOf, roomHeadById, piecesOf, roomHeads, largestPiece, roomPickRecords, roomRecordIds,
    sameRoom, onePickPerRoom, toggleRoomPick, roomInPick, ensureRoomUid, renewRoomUids, reconcileRoomPieces, succeedRoomHead, dissolveRoom, pickedBooleanPlan,
  };
}
