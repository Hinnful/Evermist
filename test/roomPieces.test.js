'use strict';
// A room made of separate pieces (roomPieces.js): the link by uid, the plan's room-aware groups, the load
// reconcile, head succession, and what Claude's room tools read of it.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// shapeCommit.js reaches these as bare globals, the way the browser's script order provides them.
global.t = (s, v) => String(s).replace(/\{(\w+)\}/g, (_, k) => v[k]);
global.EFFECT_MATERIALS = {};
global.restoreGroupDetail = require('../src/shapes/shapeDetail.js').restoreGroupDetail;
const RP = require('../src/shapes/roomPieces.js');
Object.assign(global, RP);
const { shapePlanApplied, newShapeFromPiece } = require('../src/shapes/shapeCommit.js');
const { trimShapes, mergeShapes, cutRing, joinShapes, cutOutShapes } = require('../src/shapes/roomOps.js');
const { esAssignUids } = require('../src/scenes/editStamps.js');
const { normalizeRoomFields } = require('../src/rooms/roomPanel.js');
const { decodeShapeFromSave, encodeShapeForSave, copyShapeRings } = require('../src/fog/fogGeometry.js');
const TP = require('../src/scenes/transferPlan.js');
const { mcpRoomFind, mcpRoomInsert } = require('../src/mcp/mcpRoomsPlan.js');
const { mcpSeeRead } = require('../src/mcp/mcpSeePlan.js');
const { mcpSceneCopy } = require('../src/mcp/mcpMapFilePlan.js');
const { mcpMapRecordRead } = require('../src/mcp/mcpMapPlan.js');

const MIN = 100;
const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const room = (id, verts, extra) => ({ id, vertices: verts, mode: 'shroud', name: 'Room ' + id, ...extra });
const ids = (from = 10) => { let n = from; return () => n++; };
const names = list => RP.roomHeads(list).map(r => r.name);

describe('a cut through the middle keeps one room of pieces', () => {
  it('a Cut out through a hall leaves one room of two pieces, the far part linked to it', () => {
    const hall = room(1, rect(0, 0, 200, 100), { uid: 'H', name: 'Hall', desc: 'Dusty.' });
    const out = trimShapes([hall], rect(90, -10, 110, 110), MIN);
    const res = shapePlanApplied([hall], [{ shapes: [hall], pieces: out.groups[0], kind: 'link' }], null, ids());
    assert.equal(res.list.length, 2);
    assert.equal(res.list[1].pieceOf, 'H');
    assert.equal(res.list[1].desc, undefined);
    assert.equal(res.list[1].uid, undefined);
    assert.deepEqual(names(res.list), ['Hall']);
    assert.equal(hall.desc, 'Dusty.');
  });

  it('a cut through a piece links its new part to the room\'s head, never to the piece', () => {
    const h = room(1, rect(0, 0, 100, 100), { uid: 'H', name: 'Hall' });
    const p = room(2, rect(200, 0, 400, 100), { pieceOf: 'H' });
    const out = trimShapes([p], rect(290, -10, 310, 110), MIN);
    const res = shapePlanApplied([h, p], [{ shapes: [p], pieces: out.groups[0], kind: 'link' }], null, ids());
    assert.deepEqual(res.list.map(r => r.id), [1, 2, 10]);
    assert.equal(res.list[2].pieceOf, 'H');
    assert.equal(RP.piecesOf(res.list, h).length, 3);
  });

  it('a head with no uid gets one of its own when a piece links to it', () => {
    const hall = room(1, rect(0, 0, 200, 100), { name: 'Hall' });
    const out = trimShapes([hall], rect(90, -10, 110, 110), MIN);
    const res = shapePlanApplied([hall], [{ shapes: [hall], pieces: out.groups[0], kind: 'link' }], null, ids());
    assert.ok(hall.uid);
    assert.equal(res.list[1].pieceOf, hall.uid);
  });

  it('without a kind, as for a light, the extra part is a record of its own', () => {
    const hall = room(1, rect(0, 0, 200, 100), { uid: 'H' });
    const out = trimShapes([hall], rect(90, -10, 110, 110), MIN);
    const res = shapePlanApplied([hall], [{ shapes: [hall], pieces: out.groups[0] }], null, ids());
    assert.equal(res.list[1].pieceOf, undefined);
    assert.equal(RP.roomHeads(res.list).length, 2);
  });

  it('a drawn join\'s fog reaches every piece of the room', () => {
    const h = room(1, rect(0, 0, 100, 100), { uid: 'H', mode: 'reveal' });
    const p = room(2, rect(200, 0, 300, 100), { pieceOf: 'H', mode: 'reveal' });
    const out = joinShapes([p], rect(250, 50, 350, 150), MIN);
    const res = shapePlanApplied([h, p], [{ shapes: [p], pieces: out.pieces, kind: 'link' }], 'shroud', ids());
    assert.deepEqual(res.list.map(r => r.mode), ['shroud', 'shroud']);
  });

  it('a join that takes in the head keeps the head as the record that stays', () => {
    const h = room(1, rect(0, 0, 100, 100), { uid: 'H', name: 'Hall' });
    const p = room(2, rect(100, 0, 200, 100), { pieceOf: 'H' });
    const out = joinShapes([p, h], rect(50, 20, 150, 80), MIN);
    const res = shapePlanApplied([h, p], [{ shapes: [p, h], pieces: out.pieces, kind: 'link' }], 'shroud', ids());
    assert.deepEqual(res.list.map(r => r.id), [1]);
    assert.equal(res.list[0].uid, 'H');
  });
});

describe('the head goes, the largest piece takes over', () => {
  it('a cut that leaves nothing of the head hands its name, notes and uid to the largest piece', () => {
    const h = room(1, rect(0, 0, 50, 50), { uid: 'H', name: 'Hall', desc: 'Old.' });
    const p = room(2, rect(100, 0, 300, 100), { uid: 'P', pieceOf: 'H' });
    const q = room(3, rect(400, 0, 450, 50), { pieceOf: 'H' });
    const res = shapePlanApplied([h, p, q], [{ shapes: [h], pieces: [], kind: 'link' }], null, ids());
    assert.deepEqual(res.list.map(r => r.id), [2, 3]);
    assert.equal(p.uid, 'H');
    assert.equal(p.pieceOf, undefined);
    assert.equal(p.name, 'Hall');
    assert.equal(p.desc, 'Old.');
    assert.equal(h.uid, undefined, 'the uid comes off the old record first');
    assert.deepEqual(RP.piecesOf(res.list, q).map(r => r.id), [2, 3]);
  });

  it('succeedRoomHead leaves a head that is still listed, or one with no pieces, alone', () => {
    const h = room(1, rect(0, 0, 50, 50), { uid: 'H' });
    assert.equal(RP.succeedRoomHead([h], h), null);
    assert.equal(RP.succeedRoomHead([], h), null);
    assert.equal(h.uid, 'H');
  });
});

describe('Split makes separate rooms', () => {
  it('a line across one piece makes every part and every other piece a room; the largest keeps the room', () => {
    const h = room(1, rect(0, 0, 100, 100), { uid: 'H', name: 'Hall', desc: 'Read aloud.' });
    const p = room(2, rect(200, 0, 500, 100), { pieceOf: 'H' });
    const cut = cutRing(p, [{ x: 300, y: -10 }, { x: 300, y: 110 }], MIN);
    const res = shapePlanApplied([h, p], [{ shapes: [p], pieces: cut.pieces, kind: 'split' }], null, ids());
    assert.equal(res.list.length, 3);
    assert.ok(res.list.every(r => r.pieceOf === undefined));
    const big = res.list.find(r => r.name === 'Hall');
    assert.equal(big.id, 2, 'the piece\'s larger part, 200 wide, is the largest');
    assert.equal(big.uid, 'H');
    assert.equal(big.desc, 'Read aloud.');
    assert.equal(h.name, 'Room 1');
    assert.equal(h.uid, undefined);
    assert.equal(h.desc, undefined);
    assert.deepEqual(res.list.map(r => r.name).sort(), ['Hall', 'Room 1', 'Room 10']);
  });

  it('a plain room split keeps its name and id on its largest part', () => {
    const r = room(2, rect(0, 0, 300, 100), { uid: 'R', name: 'Nave' });
    const cut = cutRing(r, [{ x: 100, y: -10 }, { x: 100, y: 110 }], MIN);
    const res = shapePlanApplied([r], [{ shapes: [r], pieces: cut.pieces, kind: 'split' }], null, ids());
    assert.equal(res.list[0].id, 2);
    assert.equal(res.list[0].name, 'Nave');
    assert.equal(Math.min(...res.list[0].vertices.map(v => v.x)), 100);
    assert.equal(res.list[1].name, 'Room 10');
  });
});

describe('Merge of rooms that do not touch', () => {
  it('A touches B, C apart: one room, A\'s name and fog, B welded in, C linked in its own slot, notes below A\'s', () => {
    const x = room(9, rect(1000, 0, 1100, 100), { uid: 'X' });
    const a = room(1, rect(0, 0, 100, 100), { uid: 'A', name: 'A', desc: 'a' });
    const b = room(2, rect(100, 0, 200, 100), { uid: 'B', name: 'B', desc: 'b' });
    const c = room(3, rect(400, 0, 500, 100), { uid: 'C', name: 'C', desc: 'c', mode: 'reveal' });
    const list = [a, x, b, c];
    const recs = RP.roomPickRecords(list, [1, 2, 3]);
    const out = mergeShapes(recs[0], recs.slice(1), MIN, 2);
    assert.equal(out.pieces.length, 2);
    const plan = RP.pickedBooleanPlan(list, recs, 1, out);
    assert.equal(plan.length, 2);
    const res = shapePlanApplied(list, plan, null, ids());
    assert.deepEqual(res.list.map(r => r.id), [1, 9, 3]);
    assert.deepEqual(names(res.list), ['A', 'Room 9']);
    assert.equal(c.pieceOf, 'A');
    assert.equal(c.mode, 'shroud');
    assert.equal(a.desc, 'a\n\nb\n\nc');
    assert.equal(c.desc, undefined);
    assert.equal(Math.max(...a.vertices.map(v => v.x)), 200);
  });

  it('a room picked with pieces brings every piece, in pick order, each once', () => {
    const h = room(1, rect(0, 0, 10, 10), { uid: 'H' });
    const x = room(2, rect(50, 0, 60, 10), { uid: 'X' });
    const p = room(3, rect(20, 0, 30, 10), { pieceOf: 'H' });
    const q = room(4, rect(30, 20, 40, 30), { pieceOf: 'H' });
    const y = room(5, rect(70, 0, 80, 10), { pieceOf: 'X' });
    const list = [h, x, p, q, y];
    assert.deepEqual(RP.roomPickRecords(list, [3, 5]).map(r => r.id), [3, 1, 4, 5, 2]);
    assert.deepEqual(RP.roomRecordIds(list, [1, 1, 4]), [1, 3, 4]);
  });

  it('Cut out on a room of pieces cuts every piece, and the cutter goes with its notes', () => {
    const h = room(1, rect(0, 0, 100, 100), { uid: 'H', desc: 'h' });
    const p = room(2, rect(200, 0, 300, 100), { pieceOf: 'H' });
    const k = room(3, rect(50, -10, 250, 50), { uid: 'K', desc: 'k' });
    const list = [h, p, k];
    const recs = RP.roomPickRecords(list, [1, 3]);
    const out = cutOutShapes([h, p], [k], MIN);
    const res = shapePlanApplied(list, RP.pickedBooleanPlan(list, recs, 2, out), null, ids());
    assert.deepEqual(res.list.map(r => r.id), [1, 2]);
    assert.equal(p.pieceOf, 'H');
    assert.equal(h.desc, 'h\n\nk');
  });

  it('a Merge of effects apart makes one effect of the main\'s material', () => {
    const fx = (id, verts, extra) => ({ id, vertices: verts, name: 'E' + id, ...extra });
    const f = fx(1, rect(0, 0, 100, 100), { uid: 'F', material: 'fire' });
    const i = fx(2, rect(400, 0, 500, 100), { uid: 'I', material: 'ice' });
    const list = [f, i];
    const recs = RP.roomPickRecords(list, [1, 2]);
    const out = mergeShapes(recs[0], recs.slice(1), MIN, 2);
    shapePlanApplied(list, RP.pickedBooleanPlan(list, recs, 1, out), null, ids());
    assert.equal(i.pieceOf, 'F');
    assert.equal(i.material, 'fire');
  });

  it('a drawn join that takes a room\'s head but not its other piece leaves that room its name and notes', () => {
    const a = room(1, rect(0, 0, 100, 100), { uid: 'A', name: 'A', desc: 'a' });
    const ap = room(2, rect(600, 0, 700, 100), { pieceOf: 'A' });
    const c = room(3, rect(200, 0, 300, 100), { uid: 'C', name: 'C', desc: 'c' });
    const list = [c, a, ap];
    const out = joinShapes([c, a], rect(90, 40, 210, 60), MIN);
    const res = shapePlanApplied(list, [{ shapes: [c, a], pieces: out.pieces, kind: 'link' }], null, ids());
    assert.equal(c.desc, 'c');
    const left = res.list.find(r => r.id === 2);
    assert.equal(left.name, 'A');
    assert.equal(left.desc, 'a');
    assert.equal(left.uid, 'A');
  });
});

describe('picks stay one per room', () => {
  const h = room(1, rect(0, 0, 10, 10), { uid: 'H' });
  const p = room(2, rect(20, 0, 30, 10), { pieceOf: 'H' });
  const x = room(3, rect(50, 0, 60, 10), { uid: 'X' });
  const y = room(4, rect(70, 0, 80, 10), { pieceOf: 'X' });
  const list = [h, p, x, y];
  it('a Shift+click on the main\'s own piece changes nothing, and on a picked room\'s piece takes the room out', () => {
    assert.equal(RP.toggleRoomPick(list, 1, [], 2), null);
    assert.deepEqual(RP.toggleRoomPick(list, 2, [], 4), [4]);
    assert.deepEqual(RP.toggleRoomPick(list, 1, [3], 4), []);
  });
  it('keeps the first id of each room', () => {
    assert.deepEqual(RP.onePickPerRoom(list, [2, 1, 4, 3]), [2, 4]);
    assert.equal(RP.roomInPick(list, [3], y), true);
    assert.equal(RP.roomInPick(list, [3], p), false);
  });
});

describe('the link survives saves, imports and the previous release', () => {
  it('a piece placed ahead of its head keeps its link through esAssignUids', () => {
    const head = room(1, rect(0, 0, 100, 100), { uid: 'H' });
    const piece = newShapeFromPiece(head, { vertices: rect(200, 0, 300, 100) }, 2);
    piece.pieceOf = 'H';
    const list = esAssignUids([piece, head]);
    assert.equal(head.uid, 'H');
    assert.notEqual(piece.uid, 'H');
    assert.equal(RP.roomHeadOf(list, piece), head);
  });

  it('a copy that kept the head\'s uid would steal it from a head behind it, which is why a piece drops its uid', () => {
    const head = room(1, rect(0, 0, 100, 100), { uid: 'H' });
    const stale = { ...head, id: 2, pieceOf: 'H' };
    esAssignUids([stale, head]);
    assert.notEqual(head.uid, 'H');
  });

  it('normalizeRoomFields, the save encoding and its decoding keep pieceOf (the previous release loads it the same way)', () => {
    const saved = [encodeShapeForSave(copyShapeRings(room(2, rect(0, 0, 10, 10), { pieceOf: 'H', mode: 'half' })))];
    const loaded = normalizeRoomFields(saved, n => 'Room ' + n).map(p => decodeShapeFromSave(copyShapeRings(p)));
    assert.equal(loaded[0].pieceOf, 'H');
    assert.equal(loaded[0].mode, 'half');
  });

  it('an import whose ids collide with the library\'s keeps every piece on its room', () => {
    const local = { id: 's', name: 'Cave', notes: '', effects: [], polygons: [room(1, rect(0, 0, 10, 10), { uid: 'a' }), room(2, rect(20, 0, 30, 10), { uid: 'b' })] };
    const incoming = { id: 's', name: 'Cave', notes: '', effects: [], polygons: [
      room(1, rect(0, 0, 10, 10), { uid: 'a' }), room(2, rect(20, 0, 30, 10), { uid: 'b' }),
      room(1, rect(100, 0, 200, 100), { uid: 'hall', name: 'Hall' }), room(2, rect(300, 0, 400, 100), { uid: 'far', pieceOf: 'hall' })] };
    const out = TP.tpMergeScene(local, incoming, 10000).record.polygons.map(decodeShapeFromSave);
    assert.equal(new Set(out.map(r => r.id)).size, 4, 'the added rooms were renumbered');
    const far = out.find(r => r.uid === 'far');
    assert.equal(RP.roomHeadOf(out, far).name, 'Hall');
    assert.deepEqual(names(out), ['Room 1', 'Room 2', 'Hall']);
  });

  it('a copied room takes a new uid and its pieces follow it; the source keeps its own', () => {
    const src = { id: 'old', name: 'Road', polygons: [room(1, rect(0, 0, 10, 10), { uid: 'H' }), room(2, rect(20, 0, 30, 10), { uid: 'P', pieceOf: 'H' })], effects: [] };
    const c = mcpSceneCopy(src, { id: 'new', name: 'Road copy', now: 1 });
    assert.notEqual(c.polygons[0].uid, 'H');
    assert.equal(c.polygons[1].pieceOf, c.polygons[0].uid);
    assert.equal(src.polygons[0].uid, 'H');
    assert.equal(src.polygons[1].pieceOf, 'H');
  });
});

describe('the load reconcile', () => {
  it('drops a link to a missing room, to a piece and to itself; pieces take the most hidden fog; notes move to the head', () => {
    const list = [
      room(1, rect(0, 0, 10, 10), { uid: 'H', mode: 'reveal', desc: 'Head.' }),
      room(2, rect(20, 0, 30, 10), { uid: 'P', pieceOf: 'H', mode: 'half', desc: ' Piece. ' }),
      room(3, rect(40, 0, 50, 10), { uid: 'Q', pieceOf: 'gone' }),
      room(4, rect(60, 0, 70, 10), { uid: 'R', pieceOf: 'P' }),
      room(5, rect(80, 0, 90, 10), { uid: 'S', pieceOf: 'S' }),
      room(6, rect(0, 20, 10, 30), { pieceOf: 'H', mode: 'reveal' }),
    ];
    RP.reconcileRoomPieces(list);
    assert.deepEqual(list.map(r => r.pieceOf), [undefined, 'H', undefined, undefined, undefined, 'H']);
    assert.deepEqual(list.filter(r => r.uid === 'H' || r.pieceOf === 'H').map(r => r.mode), ['half', 'half', 'half']);
    assert.equal(list[0].desc, 'Head.\n\nPiece.');
    assert.equal(list[1].desc, undefined);
    assert.deepEqual(RP.roomHeads(list).map(r => r.id), [1, 3, 4, 5]);
  });

  it('an effect\'s pieces take its head\'s material', () => {
    const list = [{ id: 1, vertices: rect(0, 0, 10, 10), uid: 'F', material: 'fire' }, { id: 2, vertices: rect(20, 0, 30, 10), pieceOf: 'F', material: 'ice' }];
    RP.reconcileRoomPieces(list);
    assert.equal(list[1].material, 'fire');
  });

  it('Claude\'s read of a stored map runs the same reconcile', () => {
    const rec = { polygons: [room(1, rect(0, 0, 10, 10), { uid: 'H', mode: 'reveal' }), room(2, rect(20, 0, 30, 10), { pieceOf: 'H', mode: 'shroud' })] };
    const d = mcpMapRecordRead(rec, ['polygons'], { grid: {} });
    assert.deepEqual(d.polygons.map(p => p.mode), ['shroud', 'shroud']);
  });
});

describe('Claude\'s room tools see a room once', () => {
  const polys = () => [
    room(1, rect(0, 0, 100, 100), { uid: 'H', name: 'Hall' }),
    room(2, rect(200, 0, 300, 100), { pieceOf: 'H', name: 'Room 2' }),
    room(3, rect(400, 0, 500, 100), { uid: 'K', name: 'Kitchen' }),
  ];
  it('numbers rooms without their pieces and finds a room by its head', () => {
    const list = polys();
    assert.equal(mcpRoomFind(list, null, 2, 'Cave').room.name, 'Kitchen');
    assert.equal(mcpRoomFind(list, null, 2, 'Cave').index, 2);
    assert.match(mcpRoomFind(list, null, 3, 'Cave').error, /index 1 to 2/);
    assert.match(mcpRoomFind(list, 'Room 2', undefined, 'Cave').error, /No room is called/);
    assert.equal(mcpRoomInsert(list, room(4, rect(600, 0, 700, 100)), 10), 3);
  });
  it('read_scene lists a room once, its other pieces under pieces', () => {
    const read = mcpSeeRead({ name: 'Cave', mapW: 1000, mapH: 1000, polygons: polys(), effects: [
      { id: 1, uid: 'F', material: 'fire', vertices: rect(0, 0, 10, 10) }, { id: 2, pieceOf: 'F', material: 'fire', vertices: rect(50, 0, 60, 10) }] });
    assert.deepEqual(read.rooms.map(r => [r.index, r.name, (r.pieces || []).length]), [[1, 'Hall', 1], [2, 'Kitchen', 0]]);
    assert.deepEqual(read.rooms[0].pieces[0].outline[0], [20, 0]);
    assert.equal(read.effects.length, 1);
    assert.equal(read.effects[0].pieces.length, 1);
  });
});
