'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/scenes/trashPlan.js');
const { wrOpenEnds } = require('../src/world/worldRoadPlan.js');

const DAY = P.TRASH_DAY_MS;
const NOW = 1000 * DAY;

describe('trashDaysLeft', () => {
  it('reads 30 the moment a map is deleted, and 29 a day later', () => {
    assert.equal(P.trashDaysLeft(NOW, NOW), 30);
    assert.equal(P.trashDaysLeft(NOW - DAY, NOW), 29);
  });
  it('counts a part day as a day left', () => {
    assert.equal(P.trashDaysLeft(NOW - DAY - 1, NOW), 29);
    assert.equal(P.trashDaysLeft(NOW - 29 * DAY - 5, NOW), 1);
  });
  it('never reads below 1 or past 30', () => {
    assert.equal(P.trashDaysLeft(NOW - 40 * DAY, NOW), 1);
    assert.equal(P.trashDaysLeft(NOW + 3 * DAY, NOW), 30);
  });
});

describe('trashDue', () => {
  it('is due at 30 days to the millisecond, not before', () => {
    assert.equal(P.trashIsDue(NOW - 30 * DAY, NOW), true);
    assert.equal(P.trashIsDue(NOW - 30 * DAY + 1, NOW), false);
  });
  it('lists only the entries past 30 days', () => {
    const e = [{ id: 'a', at: NOW - 31 * DAY }, { id: 'b', at: NOW - 2 * DAY }, { id: 'c', at: NOW - 30 * DAY }];
    assert.deepEqual(P.trashDue(e, NOW), ['a', 'c']);
    assert.deepEqual(P.trashDue([], NOW), []);
  });
  it('counts a track the same as a map', () => {
    const e = [{ id: 'track:t1.mp3', at: NOW - 30 * DAY }, { id: 'm', at: NOW - 31 * DAY }, { id: 'track:t2.mp3', at: NOW - DAY }];
    assert.deepEqual(P.trashDue(e, NOW), ['track:t1.mp3', 'm']);
  });
});

describe('trashRows', () => {
  const H = 'a'.repeat(64);
  it('lists this computer\'s maps and tracks with the Drive\'s rows not held here, newest first', () => {
    const local = [{ id: 'm1', at: 3, name: 'Склеп' }, { id: 'track:t1.mp3', at: 5, name: 'Тема', hash: H }];
    const drive = [{ id: 'm1', at: 3, name: 'Склеп' }, { id: 'm2', at: 4, name: 'Мост' }, { id: 'music:' + H, at: 5, name: 'Тема' }, { id: 'music:' + 'b'.repeat(64), at: 1, name: 'Бой' }];
    assert.deepEqual(P.trashRows(local, drive).map(r => [r.id, r.local, r.drive]), [
      ['track:t1.mp3', true, false], ['m2', false, true], ['m1', true, true], ['music:' + 'b'.repeat(64), false, true],
    ]);
  });
  it('lists this computer\'s entries alone when the Drive cannot be read', () => {
    assert.deepEqual(P.trashRows([{ id: 'm1', at: 1 }], null).map(r => r.id), ['m1']);
  });
});

const road = (uid, ends, scenes) => ({ uid, ends, scenes, vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }] });

describe('trashRoadEnds', () => {
  it('records the ends a map holds and its place on a road, and skips roads that do not touch it', () => {
    const roads = [
      road('r1', [{ kind: 'scene', ref: 'm' }, { kind: 'place', ref: 'Town', dx: 0, dy: 0 }], []),
      road('r2', [{ kind: null }, { kind: null }], [{ id: 'm', t: 0.4 }, { id: 'n', t: 0.6 }]),
      road('r3', [{ kind: 'scene', ref: 'n' }, { kind: null }], []),
    ];
    assert.deepEqual(P.trashRoadEnds(roads, 'm'), [
      { uid: 'r1', ends: [0], scene: null },
      { uid: 'r2', ends: [], scene: { id: 'm', t: 0.4 } },
    ]);
  });
  it('records both ends of a road that starts and ends at the map', () => {
    assert.deepEqual(P.trashRoadEnds([road('r', [{ kind: 'scene', ref: 'm' }, { kind: 'scene', ref: 'm' }], [])], 'm')[0].ends, [0, 1]);
  });
});

describe('trashReattach', () => {
  it('undoes what wrOpenEnds did to a road nobody touched since', () => {
    const before = road('r', [{ kind: 'scene', ref: 'm' }, { kind: 'scene', ref: 'x' }], [{ id: 'm', t: 0.5 }]);
    const held = P.trashRoadEnds([before], 'm')[0];
    const opened = wrOpenEnds(before, 'scene', ['m']);
    assert.deepEqual(opened.ends[0], { kind: null });
    const back = P.trashReattach(opened, 'm', held);
    assert.deepEqual(back.ends, before.ends);
    assert.deepEqual(back.scenes, before.scenes);
  });
  it('leaves an end attached elsewhere since where it is', () => {
    const held = { uid: 'r', ends: [0, 1], scene: null };
    const now = road('r', [{ kind: 'scene', ref: 'other' }, { kind: null }], []);
    assert.deepEqual(P.trashReattach(now, 'm', held).ends, [{ kind: 'scene', ref: 'other' }, { kind: 'scene', ref: 'm' }]);
  });
  it('does not put the map on the road\'s list twice', () => {
    const held = { uid: 'r', ends: [], scene: { id: 'm', t: 0.2 } };
    const now = road('r', [{ kind: null }, { kind: null }], [{ id: 'm', t: 0.3 }]);
    assert.deepEqual(P.trashReattach(now, 'm', held).scenes, [{ id: 'm', t: 0.3 }]);
  });
  it('touches no end the map did not hold', () => {
    const held = { uid: 'r', ends: [1], scene: null };
    const now = road('r', [{ kind: null }, { kind: null }], []);
    assert.deepEqual(P.trashReattach(now, 'm', held).ends, [{ kind: null }, { kind: 'scene', ref: 'm' }]);
  });
});
