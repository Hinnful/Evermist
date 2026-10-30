'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/notes/notesTreePlan.js');

const sq = (x, y, s) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
const keys = n => n.children.map(c => c.key);

describe('notesTreeBuild', () => {
  const src = {
    scenes: [{ id: 's1', name: 'Mansion', group: 'Vallaki' }, { id: 's2', name: 'Inn', group: 'Vallaki' }, { id: 's3', name: 'Loose', group: '' }],
    groups: [{ name: 'Vallaki', outline: sq(10, 10, 100) }, { name: 'Barovia', outline: sq(0, 0, 500) }, { name: 'Elsewhere', outline: sq(900, 900, 50) }],
    roads: [{ uid: 'r1', name: 'Old road' }],
    blocks: [{ id: 'b1', name: 'Wachter', notes: 'plots' }, { id: 'b2', name: 'Blank', notes: '  ' }, { id: 'b3', name: 'Made', notes: '', listed: true }, { id: 'b4', name: 'Aaa', notes: 'x' }],
    entries: [{ id: 'f1', kind: 'faction', name: 'Vistani', parent: 'faction', order: 0 }, { id: 'l2', kind: 'lore', name: 'B', parent: 'l1', order: 0 },
      { id: 'l1', kind: 'lore', name: 'A', parent: 'lore', order: 0 }],
    rooms: { s1: [{ id: 4, name: 'Hall' }, { id: 9, name: '' }] },
  };
  const root = T.notesTreeBuild({ ...src, roomLabel: n => 'Room ' + n });

  it('nests a group in the smallest group that holds its outline, and files maps in their group', () => {
    assert.deepEqual(keys(root).slice(0, 4), ['place:Barovia', 'place:Elsewhere', 'map:s3', 'sec:roads']);
    const bar = root.children[0];
    assert.deepEqual(keys(bar), ['place:Vallaki']);
    assert.deepEqual(keys(bar.children[0]), ['map:s1', 'map:s2']);
  });
  it('names an unnamed room by its place in the list and stores nothing', () => {
    const rooms = T.notesTreeFind(root, 'map:s1').children;
    assert.deepEqual(rooms.map(r => r.name), ['Hall', 'Room 2']);
    assert.equal(rooms[1].unnamed, true);
  });
  it('lists the roads, then monsters with a note or made in the window, then factions and lore', () => {
    assert.deepEqual(keys(root).slice(3), ['sec:roads', 'sec:monster', 'sec:faction', 'sec:lore']);
    assert.deepEqual(keys(T.notesTreeFind(root, 'sec:monster')), ['monster:b4', 'monster:b3', 'monster:b1']);
    assert.deepEqual(keys(T.notesTreeFind(root, 'sec:lore')), ['entry:l1']);
    assert.deepEqual(keys(T.notesTreeFind(root, 'entry:l1')), ['entry:l2']);
  });
  it('lists a book monster some note mentions, so its Appears in has a row to open', () => {
    const r = T.notesTreeBuild({ ...src, blocks: src.blocks.concat({ id: 'b9', name: 'Goblin', notes: '', mentioned: true }), roomLabel: n => 'Room ' + n });
    assert.ok(keys(T.notesTreeFind(r, 'sec:monster')).includes('monster:b9'));
    assert.ok(!keys(T.notesTreeFind(root, 'sec:monster')).includes('monster:b2'));
  });
  it('keeps the empty sections and drops an empty Roads section', () => {
    const r = T.notesTreeBuild({ roomLabel: n => 'Room ' + n });
    assert.deepEqual(keys(r), ['sec:monster', 'sec:faction', 'sec:lore']);
  });
  it('gives a path from the campaign to a room', () => {
    assert.deepEqual(T.notesTreePath(root, 'room:s1:4').map(n => n.key), ['campaign', 'place:Barovia', 'place:Vallaki', 'map:s1', 'room:s1:4']);
    assert.deepEqual(T.notesTreePath(root, 'nope'), []);
  });
});

describe('notesTreeRows', () => {
  const root = T.notesTreeBuild({ scenes: [{ id: 's1', name: 'M', group: 'G' }], groups: [{ name: 'G', outline: sq(0, 0, 9) }], rooms: { s1: [{ id: 1, name: 'R' }] }, roomLabel: n => 'Room ' + n });
  it('shows only open nodes, sections always open', () => {
    assert.deepEqual(T.notesTreeRows(root, new Set()).map(r => r.node.key), ['campaign', 'place:G', 'sec:monster', 'sec:faction', 'sec:lore']);
    const rows = T.notesTreeRows(root, new Set(['place:G', 'map:s1']));
    assert.deepEqual(rows.map(r => [r.node.key, r.depth]).slice(0, 4), [['campaign', 0], ['place:G', 1], ['map:s1', 2], ['room:s1:1', 3]]);
  });
  it('Expand all opens every row that folds, and nothing else', () => {
    assert.deepEqual(T.notesTreeFoldable(root), ['place:G', 'map:s1']);
    const open = new Set(T.notesTreeFoldable(root));
    assert.ok(T.notesTreeRows(root, open).some(r => r.node.key === 'room:s1:1'));
  });
});

describe('notesCrumbFold', () => {
  it('folds nothing when it fits', () => assert.equal(T.notesCrumbFold([40, 40, 40], 200, 5, 10), 0));
  it('folds middle crumbs from the second until it fits', () => {
    assert.equal(T.notesCrumbFold([40, 60, 60, 60, 40], 170, 5, 10), 2);
  });
  it('never folds the first or the last', () => assert.equal(T.notesCrumbFold([40, 60, 60, 60, 40], 10, 5, 10), 3));
  it('has nothing to fold in two crumbs', () => assert.equal(T.notesCrumbFold([100, 100], 10, 5, 10), 0));
});
