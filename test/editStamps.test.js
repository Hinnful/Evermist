'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/scenes/editStamps.js');

const room = (id, extra) => ({ id, name: 'Room ' + id, mode: 'shroud', vertices: [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 9 }], ...extra });
const scene = (polygons, extra) => ({ id: 's', name: 'Cave', polygons, effects: [], notes: '', ...extra });

describe('esStamp', () => {
  it('stamps nothing on a save that changed nothing', () => {
    const rec = scene([room(1)]);
    const st = E.esStamp(E.esSnapshot(rec), scene([room(1)]), 500, false);
    assert.deepEqual(st.scene, {});
    assert.deepEqual(st.rooms['legacy-1'], {});
  });

  it('stamps each room part on its own', () => {
    const prev = E.esSnapshot(scene([room(1), room(2)]));
    const next = scene([room(1, { mode: 'revealed' }), room(2, { desc: 'Cold' })]);
    const st = E.esStamp(prev, next, 700, false);
    assert.deepEqual(st.rooms['legacy-1'], { mode: 700 });
    assert.deepEqual(st.rooms['legacy-2'], { notes: 700 });
  });

  it('stamps the shape and not the state when only a corner moves', () => {
    const prev = E.esSnapshot(scene([room(1)]));
    const moved = room(1, { vertices: [{ x: 1, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 9 }] });
    assert.deepEqual(E.esStamp(prev, scene([moved]), 800, false).rooms['legacy-1'], { shape: 800 });
  });

  it('reads a held room by its real mode', () => {
    const held = room(1, { mode: 'shroud', modeWithHoles: 'revealed', holes: [[{ x: 1, y: 1 }]] });
    const live = room(1, { mode: 'revealed', holes: [[{ x: 1, y: 1 }]] });
    const st = E.esStamp(E.esSnapshot(scene([held])), scene([live]), 900, false);
    assert.deepEqual(st.rooms['legacy-1'], {});
  });

  it('keeps an earlier time where the part did not change', () => {
    const rec = scene([room(1)], { edits: { rooms: { 'legacy-1': { mode: 40 } } } });
    const st = E.esStamp(E.esSnapshot(rec), scene([room(1, { desc: 'x' })]), 900, false);
    assert.deepEqual(st.rooms['legacy-1'], { mode: 40, notes: 900 });
  });

  it('records a removed room as a deletion and drops the record when it returns', () => {
    const prev = E.esSnapshot(scene([room(1), room(2)]));
    const gone = E.esStamp(prev, scene([room(1)]), 1000, false);
    assert.equal(gone.goneRooms['legacy-2'], 1000);
    const back = E.esStamp(E.esSnapshot(scene([room(1)], { edits: gone })), scene([room(1), room(2)]), 1100, false);
    assert.equal(back.goneRooms['legacy-2'], undefined);
    assert.deepEqual(back.rooms['legacy-2'], { shape: 1100, notes: 1100, mode: 1100 });
  });

  it('stamps every part of a record that is new', () => {
    const st = E.esStamp(null, scene([room(1)]), 50, false);
    assert.equal(st.scene.name, 50);
    assert.equal(st.scene.fog, 50);
    assert.deepEqual(st.rooms['legacy-1'], { shape: 50, notes: 50, mode: 50 });
  });

  it('stamps the fog only when it was painted', () => {
    const snap = E.esSnapshot(scene([]));
    assert.equal(E.esStamp(snap, scene([]), 60, false).scene.fog, undefined);
    assert.equal(E.esStamp(snap, scene([]), 60, true).scene.fog, 60);
  });

  it('stamps a scene part when its value changes', () => {
    const snap = E.esSnapshot(scene([]));
    const st = E.esStamp(snap, scene([], { name: 'Deep cave', notes: 'x' }), 70, false);
    assert.deepEqual(st.scene, { name: 70, notes: 70 });
  });

  it('stamps the weather when it changes, and reads absent and No weather as the same', () => {
    const snap = E.esSnapshot(scene([]));
    assert.deepEqual(E.esStamp(snap, scene([], { weather: 'rain' }), 71, false).scene, { weather: 71 });
    assert.deepEqual(E.esStamp(snap, scene([], { weather: 'none' }), 72, false).scene, {});
  });

  it('stamps the time of day when it changes, and reads absent and None as the same', () => {
    const snap = E.esSnapshot(scene([]));
    assert.deepEqual(E.esStamp(snap, scene([], { timeOfDay: 'night' }), 73, false).scene, { timeOfDay: 73 });
    assert.deepEqual(E.esStamp(snap, scene([], { timeOfDay: 'none' }), 74, false).scene, {});
  });

  it('gives an effect one time, and a deletion record when it goes', () => {
    const fx = { id: 1, material: 'fire', vertices: [] };
    const prev = E.esSnapshot(scene([], { effects: [fx] }));
    const edited = E.esStamp(prev, scene([], { effects: [{ ...fx, material: 'acid' }] }), 80, false);
    assert.equal(edited.effects['legacy-1'], 80);
    const removed = E.esStamp(prev, scene([]), 90, false);
    assert.equal(removed.goneEffects['legacy-1'], 90);
  });
});

describe('uids', () => {
  it('gives an old room the same uid on every machine', () => {
    assert.equal(E.esLegacyUid({ id: 7 }), 'legacy-7');
    assert.equal(E.esWithUids([{ id: 7 }, { id: 8, uid: 'abc' }]).map(r => r.uid).join(), 'legacy-7,abc');
  });

  it('gives a new room a random uid and a pasted copy another', () => {
    const list = [{ id: 1, uid: 'a' }, { id: 2 }, { id: 3, uid: 'a' }];
    E.esAssignUids(list);
    assert.equal(new Set(list.map(r => r.uid)).size, 3);
    assert.equal(list[0].uid, 'a');
  });
});

describe('esSeen and esStampRecords - places and roads', () => {
  const partsOf = r => ({ name: E.esCanon(r.name), shape: E.esCanon(r.vertices) });

  it('times only the part edited since the last stamp, and moves seen on', () => {
    const place = { uid: 'p1', name: 'Town', vertices: [1, 2] };
    const seen = E.esSeen([place], partsOf);
    E.esStampRecords([place], seen, partsOf, 100);
    assert.deepEqual(place.edits, {});
    place.name = 'City';
    E.esStampRecords([place], seen, partsOf, 200);
    assert.deepEqual(place.edits, { name: 200 });
    place.vertices = [3, 4];
    E.esStampRecords([place], seen, partsOf, 300);
    assert.deepEqual(place.edits, { name: 200, shape: 300 });
    E.esStampRecords([place], seen, partsOf, 400);
    assert.deepEqual(place.edits, { name: 200, shape: 300 });
  });

  it('stamps every part of a record the last stamp never saw', () => {
    const seen = E.esSeen([], partsOf);
    const road = { uid: 'r1', name: 'North road', vertices: [] };
    E.esStampRecords([road], seen, partsOf, 500);
    assert.deepEqual(road.edits, { name: 500, shape: 500 });
  });
});

describe('esStamp - deletion records', () => {
  it('keeps the newest 300 deletions and drops the oldest', () => {
    const goneRooms = {};
    for (let i = 0; i < 300; i++) goneRooms['g' + i] = i + 1;
    const rec = scene([room(1)], { edits: { goneRooms } });
    const st = E.esStamp(E.esSnapshot(rec), scene([]), 1000, false);
    assert.equal(Object.keys(st.goneRooms).length, 300);
    assert.equal(st.goneRooms['legacy-1'], 1000);
    assert.equal(st.goneRooms.g0, undefined);
    assert.equal(st.goneRooms.g1, 2);
  });
});

describe('esStamp - a write to one field of a stored record', () => {
  it('keeps the fog time when only the name changes', () => {
    const rec = scene([room(1)], { edits: { scene: { fog: 50 }, rooms: { 'legacy-1': { mode: 40 } }, goneRooms: { x: 9 } } });
    const st = E.esStamp(E.esSnapshot(rec), { ...rec, name: 'Deeper' }, 300, false);
    assert.equal(st.scene.name, 300);
    assert.equal(st.scene.fog, 50);
    assert.deepEqual(st.rooms, { 'legacy-1': { mode: 40 } });
    assert.deepEqual(st.goneRooms, { x: 9 });
  });

  it('keeps the times of parts a newer release stamped, which this build does not know', () => {
    const rec = scene([room(1)], { edits: { scene: { fog: 50, smell: 60 }, rooms: { 'legacy-1': { scent: 70 } }, later: { a: 1 } } });
    const st = E.esStamp(E.esSnapshot(rec), { ...rec, name: 'Deeper' }, 300, false);
    assert.equal(st.scene.smell, 60);
    assert.equal(st.rooms['legacy-1'].scent, 70);
    assert.deepEqual(st.later, { a: 1 });
  });

  it('times a map moved to another group or spot, and nothing else', () => {
    const rec = scene([], { group: 'Town', worldPos: { x: 1, y: 2 }, edits: { scene: { fog: 50 } } });
    assert.deepEqual(E.esStamp(E.esSnapshot(rec), { ...rec, group: 'Keep' }, 300, false).scene, { fog: 50, place: 300 });
    assert.deepEqual(E.esStamp(E.esSnapshot(rec), { ...rec, worldPos: { x: 4, y: 2 } }, 300, false).scene, { fog: 50, place: 300 });
    assert.deepEqual(E.esStamp(E.esSnapshot(rec), { ...rec }, 300, false).scene, { fog: 50 });
  });

  it('times a room note changed on a map that is not open', () => {
    const rec = scene([room(1)], { edits: { scene: { fog: 50 } } });
    const next = { ...rec, polygons: [{ ...rec.polygons[0], desc: 'A new note' }] };
    const st = E.esStamp(E.esSnapshot(rec), next, 300, false);
    assert.equal(st.rooms['legacy-1'].notes, 300);
    assert.equal(st.scene.fog, 50);
  });
});

describe('esStamp: the rooms\' layer order', () => {
  const ids = (...n) => n.map(i => room(i, { uid: 'u' + i }));
  it('times a layer move, and only that', () => {
    const prev = E.esSnapshot(scene(ids(1, 2, 3)));
    assert.equal(E.esStamp(prev, scene(ids(2, 1, 3)), 900, false).scene.order, 900);
    // an added or a deleted room moves nothing between the others
    assert.equal('order' in E.esStamp(prev, scene(ids(1, 4, 2, 3)), 900, false).scene, false);
    assert.equal('order' in E.esStamp(prev, scene(ids(1, 3)), 900, false).scene, false);
  });

  it('keeps an earlier move\'s time, and a new map has none', () => {
    const rec = { ...scene(ids(2, 1)), edits: { scene: { order: 400 } } };
    assert.equal(E.esStamp(E.esSnapshot(rec), scene(ids(2, 1, 5)), 900, false).scene.order, 400);
    assert.equal('order' in E.esStamp(null, scene(ids(1, 2)), 900, false).scene, false);
  });

  it('tells a reorder from an add or a delete', () => {
    assert.equal(E.esOrderMoved(['a', 'b', 'c'], ['b', 'a']), true);
    assert.equal(E.esOrderMoved(['a', 'b', 'c'], ['a', 'x', 'c']), false);
  });
});
