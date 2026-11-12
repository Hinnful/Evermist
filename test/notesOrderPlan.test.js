'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const O = require('../src/notes/notesOrderPlan.js');
const T = require('../src/notes/notesTreePlan.js');

const plain = v => JSON.parse(JSON.stringify(v));
const list = (order, groups, at) => ({ at: at || 1, order, groups: Object.assign(Object.create(null), groups || {}) });
const kids = keys => keys.map(k => ({ key: 'n:' + k, okey: k }));
const shown = out => out.map(x => (x.gid ? { [x.gid]: x.kids.map(k => k.okey) } : x.okey));

describe('cleanNotesOrder', () => {
  it('keeps lists, drops what is not one, and parses with a null prototype', () => {
    const v = O.notesOrderParse(JSON.stringify({ v: 1, lists: { 'map:s1': { at: 5, order: ['s1:a', 's1:a', 3, '#g1', '#nope'], groups: { '#g1': { name: ' Wing ', members: ['s1:b', 's1:a'] } } }, bad: 7 } }));
    assert.equal(Object.getPrototypeOf(v.lists), null);
    assert.deepEqual(plain(v.lists), { 'map:s1': { at: 5, order: ['s1:a', '#g1'], groups: { '#g1': { name: 'Wing', members: ['s1:b'] } } } });
  });
  it('refuses a group with no name or no member, and an item shaped like a group id', () => {
    const v = O.cleanNotesOrder({ lists: { roads: { order: ['#a', '#b', '#c'], groups: { '#a': { name: '', members: ['r1'] }, '#b': { name: 'B', members: [] }, '#c': { name: 'C', members: ['#x', 'r2'] } } } } });
    assert.deepEqual(plain(v.lists.roads), { at: 0, order: ['#c'], groups: { '#c': { name: 'C', members: ['r2'] } } });
  });
  it('answers null for text that is not the key', () => {
    assert.equal(O.notesOrderParse('nope'), null);
    assert.equal(O.notesOrderParse(JSON.stringify({ lists: [] })), null);
    assert.equal(O.notesOrderParse(''), null);
  });
  it('puts a group the order forgot at its end', () => {
    const v = O.cleanNotesOrder({ lists: { roads: { order: ['r1'], groups: { '#g': { name: 'G', members: ['r2'] } } } } });
    assert.deepEqual(v.lists.roads.order, ['r1', '#g']);
  });
});

describe('notesOrderApply', () => {
  it('puts listed kids in order, groups as groups, newcomers at the end in built order', () => {
    const l = list(['c', '#g', 'a'], { '#g': { name: 'G', members: ['b', 'gone'] } });
    assert.deepEqual(shown(O.notesOrderApply(l, kids(['a', 'b', 'c', 'd', 'e']))), ['c', { '#g': ['b'] }, 'a', 'd', 'e']);
  });
  it('skips a missing item and never prunes it from the list', () => {
    const l = list(['x', 'a', 'b']);
    assert.deepEqual(shown(O.notesOrderApply(l, kids(['b', 'a']))), ['a', 'b']);
    assert.deepEqual(l.order, ['x', 'a', 'b']);
  });
  it('hides a group none of whose members is here, and flattens groups when asked', () => {
    const l = list(['#g', 'a', '#h'], { '#g': { name: 'G', members: ['gone'] }, '#h': { name: 'H', members: ['b'] } });
    assert.deepEqual(shown(O.notesOrderApply(l, kids(['a', 'b']))), ['a', { '#h': ['b'] }]);
    assert.deepEqual(shown(O.notesOrderApply(l, kids(['a', 'b']), true)), ['a', 'b']);
  });
  it('puts a kid with no key yet at the end', () => {
    const k = kids(['a']).concat([{ key: 'n:none', okey: null }]);
    assert.deepEqual(O.notesOrderApply(list(['a']), k.slice().reverse()).map(n => n.key), ['n:a', 'n:none']);
  });
  it('a restored item takes its old place and group back', () => {
    const l = list(['a', '#g'], { '#g': { name: 'G', members: ['b', 'c'] } });
    assert.deepEqual(shown(O.notesOrderApply(l, kids(['a', 'b']))), ['a', { '#g': ['b'] }]);
    assert.deepEqual(shown(O.notesOrderApply(l, kids(['c', 'a', 'b']))), ['a', { '#g': ['b', 'c'] }]);
  });
});

describe('the moves a drop makes', () => {
  it('fills the newcomers before a move so a drop between them lands there', () => {
    const l = O.notesOrderFill(list(['a']), ['a', 'b', 'c']);
    assert.deepEqual(O.notesOrderMove(l, 'a', null, 'c', 9).order, ['b', 'a', 'c']);
  });
  it('moves an item into and out of a group, and an emptied group goes', () => {
    let l = list(['a', '#g', 'c'], { '#g': { name: 'G', members: ['b'] } });
    l = O.notesOrderMove(l, 'a', '#g', null, 2);
    assert.deepEqual(plain(l), { at: 2, order: ['#g', 'c'], groups: { '#g': { name: 'G', members: ['b', 'a'] } } });
    l = O.notesOrderMove(O.notesOrderMove(l, 'a', null, null, 3), 'b', null, 'c', 4);
    assert.deepEqual(plain(l), { at: 4, order: ['b', 'c', 'a'], groups: {} });
  });
  it('moves a group among the items but never into a group', () => {
    const l = list(['a', '#g', '#h'], { '#g': { name: 'G', members: ['b'] }, '#h': { name: 'H', members: ['c'] } });
    assert.deepEqual(O.notesOrderMove(l, '#h', null, 'a', 2).order, ['#h', 'a', '#g']);
    assert.deepEqual(O.notesOrderMove(l, '#h', '#g', null, 2).order, ['a', '#g', '#h']);
  });
  it('a hold makes a group where the target stood, the target first', () => {
    const l = O.notesOrderHold(list(['a', 'b', 'c']), 'c', 'a', '#n', 'Group', 5);
    assert.deepEqual(plain(l), { at: 5, order: ['#n', 'b'], groups: { '#n': { name: 'Group', members: ['a', 'c'] } } });
  });
  it('a hold on an item already in a group takes the dragged one in after it', () => {
    const l = list(['a', '#g'], { '#g': { name: 'G', members: ['b', 'c'] } });
    assert.deepEqual(O.notesOrderHold(l, 'a', 'b', '#n', 'X', 2).groups['#g'].members, ['b', 'a', 'c']);
  });
  it('ungroup puts the members where the group stood; rename keeps a clean name', () => {
    const l = list(['a', '#g', 'd'], { '#g': { name: 'G', members: ['b', 'c'] } });
    assert.deepEqual(O.notesOrderUngroup(l, '#g', 3).order, ['a', 'b', 'c', 'd']);
    assert.equal(O.notesOrderRename(l, '#g', '  Upper   floor ', 3).groups['#g'].name, 'Upper floor');
    assert.equal(O.notesOrderRename(l, '#g', '   ', 3).groups['#g'].name, 'G');
    assert.deepEqual(O.notesOrderFlat(l), ['a', 'b', 'c', 'd']);
  });
});

describe('notesOrderMerge', () => {
  it('takes each list from whichever side edited it later', () => {
    const mine = O.cleanNotesOrder({ lists: { monster: { at: 10, order: ['m2', 'm1'] }, 'map:s': { at: 1, order: ['s:a'] } } });
    const theirs = O.cleanNotesOrder({ lists: { monster: { at: 5, order: ['m1', 'm2'] }, 'map:s': { at: 7, order: ['s:b', 's:a'] }, roads: { at: 2, order: ['r'] } } });
    const m = O.notesOrderMerge(mine, theirs);
    assert.equal(m.changed, true);
    assert.deepEqual(m.value.lists.monster.order, ['m2', 'm1']);
    assert.deepEqual(m.value.lists['map:s'].order, ['s:b', 's:a']);
    assert.deepEqual(m.value.lists.roads.order, ['r']);
    assert.equal(O.notesOrderMerge(m.value, mine).changed, false);
  });
});

describe('notesOrderRemap', () => {
  it('moves scene ids and group uids to the library ones, rooms keeping their uid', () => {
    const v = O.cleanNotesOrder({ lists: { campaign: { at: 1, order: ['old', 'gOld', 'same'] }, 'map:old': { at: 1, order: ['old:r1'], groups: {} }, 'place:gOld': { at: 1, order: ['old'] } } });
    const r = O.notesOrderRemap(v, { old: 'new' }, { gOld: 'gNew' });
    assert.deepEqual(Object.keys(r.lists).sort(), ['campaign', 'map:new', 'place:gNew']);
    assert.deepEqual(r.lists.campaign.order, ['new', 'gNew', 'same']);
    assert.deepEqual(r.lists['map:new'].order, ['new:r1']);
  });
});

describe('notesTreeBuild with an order', () => {
  const src = {
    scenes: [{ id: 's1', name: 'Mansion', group: '' }, { id: 's2', name: 'Inn', group: '' }],
    groups: [{ name: 'Vallaki', uid: 'gV', outline: [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 9 }, { x: 0, y: 9 }] }],
    roads: [{ uid: 'r1', name: 'North' }, { uid: 'r2', name: 'South' }],
    blocks: [{ id: 'b1', uid: 'u1', name: 'Ash', notes: 'x' }, { id: 'b2', uid: 'u2', name: 'Birch', notes: 'x' }, { id: 'b3', name: 'Cedar', notes: 'x' }],
    entries: [],
    rooms: { s1: [{ id: 4, uid: 'a', name: '' }, { id: 7, uid: 'b', name: 'Hall' }, { id: 9, uid: '', name: '' }] },
    roomLabel: n => 'Room ' + n,
  };
  const order = O.cleanNotesOrder({ lists: {
    campaign: { at: 1, order: ['s2', 'gV', 's1'] },
    'map:s1': { at: 1, order: ['s1:b', '#w'], groups: { '#w': { name: 'Wing', members: ['s1:a'] } } },
    roads: { at: 1, order: ['r2'] },
    monster: { at: 1, order: ['u2'] },
  } });
  const root = T.notesTreeBuild({ ...src, order });
  it('orders the Campaign, groups included, ahead of the sections', () => {
    assert.deepEqual(root.children.map(c => c.key), ['map:s2', 'place:Vallaki', 'map:s1', 'sec:roads', 'sec:monster', 'sec:faction', 'sec:lore']);
  });
  it('a moved unnamed room keeps the label of its place in the map\'s list', () => {
    const map = T.notesTreeFind(root, 'map:s1');
    assert.deepEqual(map.children.map(c => c.kind === 'ngroup' ? c.name + ':' + c.children.map(r => r.name).join() : c.name), ['Hall', 'Wing:Room 1', 'Room 3']);
    assert.equal(map.children[1].key, 'ng:map:s1:#w');
  });
  it('orders roads and monsters, newcomers last', () => {
    assert.deepEqual(T.notesTreeFind(root, 'sec:roads').children.map(c => c.id), ['r2', 'r1']);
    assert.deepEqual(T.notesTreeFind(root, 'sec:monster').children.map(c => c.id), ['b2', 'b1', 'b3']);
  });
  it('builds as before with no order', () => {
    const plainRoot = T.notesTreeBuild(src);
    assert.deepEqual(plainRoot.children.map(c => c.key).slice(0, 3), ['place:Vallaki', 'map:s1', 'map:s2']);
  });
});

describe('campaign.json carries the order', () => {
  const { notesCampaignPayload } = require('../src/notes/notesPlan.js');
  it('writes the key when it holds a list, and nothing for an empty one', () => {
    const order = O.cleanNotesOrder({ lists: { roads: { at: 3, order: ['r1'] } } });
    const text = notesCampaignPayload('', {}, {}, {}, {}, undefined, undefined, undefined, 0, undefined, order);
    assert.deepEqual(plain(O.cleanNotesOrder(JSON.parse(text).notesOrder)), plain(order));
    assert.equal(notesCampaignPayload('', {}, {}, {}, {}, undefined, undefined, undefined, 0, undefined, O.notesOrderEmpty()), null);
  });
});

describe('notesOrderRebuild', () => {
  let n = 0;
  const gid = () => '#n' + (++n);
  it('sets the order and keeps the groups the list has', () => {
    const old = list(['a', '#g', 'd'], { '#g': { name: 'G', members: ['b', 'c'] } });
    const l = O.notesOrderRebuild(old, ['d', 'c', 'a'], null, 9, gid);
    assert.deepEqual(plain(l), { at: 9, order: ['d', '#g', 'a'], groups: { '#g': { name: 'G', members: ['c', 'b'] } } });
  });
  it('replaces the groups when given, and keeps an item it does not name, missing ones included', () => {
    const old = list(['gone', 'a', 'b', 'c']);
    const l = O.notesOrderRebuild(old, ['c', 'b'], [{ name: ' Wing ', keys: ['b', 'a'] }], 3, gid);
    assert.equal(l.order[0], 'c');
    const g = l.order[1];
    assert.deepEqual(plain(l.groups[g]), { name: 'Wing', members: ['b', 'a'] });
    assert.deepEqual(l.order.slice(2), ['gone']);
  });
  it('keeps a named group\'s items in the order they are named, where the first of them stands', () => {
    const l = O.notesOrderRebuild(list(['a', 'b', 'c', 'd']), ['d'], [{ name: 'G', keys: ['c', 'b'] }], 4, gid);
    assert.deepEqual(l.order.length, 3);
    assert.equal(l.order[0], 'd');
    assert.deepEqual(l.groups[l.order[2]].members, ['c', 'b']);
    assert.equal(l.order[1], 'a');
  });
});
