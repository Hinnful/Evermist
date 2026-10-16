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

describe('esStampScene', () => {
  it('stamps a changed scene part and carries the room times over', () => {
    const rec = scene([room(1)], { edits: { rooms: { 'legacy-1': { mode: 40 } }, goneRooms: { x: 9 } } });
    const before = { scene: E.esSceneParts(rec), edits: rec.edits };
    const st = E.esStampScene(before, { ...rec, name: 'Deeper' }, 300);
    assert.deepEqual(st.scene, { name: 300 });
    assert.deepEqual(st.rooms, { 'legacy-1': { mode: 40 } });
    assert.deepEqual(st.goneRooms, { x: 9 });
  });
});
