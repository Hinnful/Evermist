'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const N = require('../src/notes/notesEntriesPlan.js');

const E = (id, kind, parent, order, extra) => ({ id, kind, name: id, note: '', parent: parent || kind, order: order || 0, ...extra });

describe('neClean', () => {
  it('keeps good entries, drops duplicates and unknown kinds, and reports it', () => {
    const r = N.neClean([E('a', 'faction'), E('a', 'lore'), { id: 'b', kind: 'tag' }, null, E('c', 'lore')]);
    assert.deepEqual(r.entries.map(e => e.id), ['a', 'c']);
    assert.equal(r.dropped, true);
  });
  it('reports a list that is not a list and returns nothing', () => {
    assert.deepEqual(N.neClean({ x: 1 }), { entries: [], dropped: true });
  });
  it('sends an unknown, cross-kind or looping parent to the section', () => {
    const r = N.neClean([E('a', 'faction', 'ghost'), E('b', 'faction', 'x'), E('x', 'lore'), E('l1', 'lore', 'l2'), E('l2', 'lore', 'l1'), E('s', 'lore', 's')]);
    const p = Object.fromEntries(r.entries.map(e => [e.id, e.parent]));
    assert.deepEqual(p, { a: 'faction', b: 'faction', x: 'lore', l1: 'lore', l2: 'l1', s: 'lore' });
  });
  it('keeps a field this release does not know', () => {
    assert.equal(N.neClean([E('a', 'lore', null, 0, { mention: 7 })]).entries[0].mention, 7);
  });
  it('names a blank entry Untitled and caps a note', () => {
    const r = N.neClean([{ id: 'a', kind: 'lore', name: '   ', note: 5, parent: 'lore', order: 0 }]);
    assert.equal(r.entries[0].name, 'Untitled');
    assert.equal(r.dropped, true);
  });
});

describe('neClean and a later release', () => {
  it('keeps a field the entry was written with', () => {
    const out = N.neClean([E('a', 'faction', 'faction', 1, { colour: 'red' })]).entries;
    assert.equal(out[0].colour, 'red');
    assert.equal(N.neClean(out).entries[0].colour, 'red');
  });
});

describe('add, rename, note', () => {
  it('adds last among its siblings, under the section or an entry of its kind', () => {
    let l = [E('a', 'faction', null, 4)];
    l = N.neAdd(l, 'faction', 'Vistani', 'faction', 'v').entries;
    assert.equal(l[1].order, 5);
    l = N.neAdd(l, 'faction', 'Child', 'a', 'c').entries;
    assert.equal(l[2].parent, 'a');
    l = N.neAdd(l, 'lore', 'X', 'a', 'x').entries;
    assert.equal(l[3].parent, 'lore');
  });
  it('renames and refuses an empty name', () => {
    const l = [E('a', 'lore')];
    assert.equal(N.neRename(l, 'a', '  Sunsword ')[0].name, 'Sunsword');
    assert.equal(N.neRename(l, 'a', '  ')[0].name, 'a');
  });
  it('sets a note', () => {
    assert.equal(N.neSetNote([E('a', 'lore')], 'a', ' hi ')[0].note, 'hi');
  });
});

describe('neMove', () => {
  const l = [E('a', 'lore', null, 0), E('b', 'lore', null, 1), E('c', 'lore', 'a', 0), E('f', 'faction', null, 0)];
  it('reorders before a sibling', () => {
    const r = N.neMove(l, 'b', 'lore', 'a');
    assert.deepEqual(N.neChildren(r, 'lore').map(e => e.id), ['b', 'a']);
  });
  it('nests inside another entry of the kind, last', () => {
    const r = N.neMove(l, 'b', 'a');
    assert.deepEqual(N.neChildren(r, 'a').map(e => e.id), ['c', 'b']);
  });
  it('refuses itself, its descendant and another kind', () => {
    assert.equal(N.neMove(l, 'a', 'a'), l);
    assert.equal(N.neMove(l, 'a', 'c'), l);
    assert.equal(N.neMove(l, 'a', 'faction'), l);
    assert.equal(N.neMove(l, 'a', 'f'), l);
  });
});

describe('neDelete', () => {
  const l = [E('a', 'lore'), E('c', 'lore', 'a'), E('d', 'lore', 'c'), E('b', 'lore')];
  it('removes the entry and everything under it and counts them', () => {
    const r = N.neDelete(l, 'a');
    assert.deepEqual(r.entries.map(e => e.id), ['b']);
    assert.equal(r.removed, 3);
  });
  it('names the parent the window moves to, or null for the campaign note', () => {
    assert.equal(N.neFallback(l, 'c'), 'a');
    assert.equal(N.neFallback(l, 'a'), null);
  });
});

describe('neMerge', () => {
  it('adds what is missing and never replaces an entry', () => {
    const have = [E('a', 'lore', null, 0, { note: 'mine' })];
    const r = N.neMerge(have, [E('a', 'lore', null, 0, { note: 'theirs' }), E('b', 'lore', 'a', 1), E('c', 'faction', 'gone', 0)]);
    assert.equal(r.added, 2);
    assert.equal(r.entries.find(e => e.id === 'a').note, 'mine');
    assert.equal(r.entries.find(e => e.id === 'c').parent, 'faction');
    assert.equal(r.entries.find(e => e.id === 'b').parent, 'a');
  });
  it('takes an entry edited later elsewhere, and keeps one edited later here', () => {
    const have = [E('a', 'lore', null, 0, { note: 'mine', edited: 100 }), E('b', 'lore', null, 1)];
    const r = N.neMerge(have, [E('a', 'lore', 'b', 0, { note: 'theirs', name: 'A2', edited: 200 }), have[1]], 1000);
    const a = r.entries.find(e => e.id === 'a');
    assert.deepEqual([a.note, a.name, a.parent, a.edited, r.updated], ['theirs', 'A2', 'b', 200, 1]);
    const keep = N.neMerge(have, [E('a', 'lore', null, 0, { note: 'theirs', edited: 50 })], 1000);
    assert.equal(keep.entries.find(e => e.id === 'a').note, 'mine');
    assert.equal(keep.updated, 0);
  });
  it('lets a timed copy beat an untimed one, and keeps the one here when neither has a time', () => {
    const have = [E('a', 'faction', null, 0, { note: 'mine' })];
    assert.equal(N.neMerge(have, [E('a', 'faction', null, 0, { note: 'theirs', edited: 5 })], 1000).entries[0].note, 'theirs');
    assert.equal(N.neMerge(have, [E('a', 'faction', null, 0, { note: 'theirs' })], 1000).entries[0].note, 'mine');
  });
  it('puts a taken entry under its section when its new parent would loop', () => {
    const have = [E('a', 'lore', null, 0), E('b', 'lore', 'a', 0)];
    const r = N.neMerge(have, [E('a', 'lore', 'b', 0, { note: 'x', edited: 9 }), E('b', 'lore')], 1000);
    assert.equal(r.entries.find(e => e.id === 'a').parent, 'lore');
  });
});

describe('neStamp', () => {
  it('times an entry whose name, note or place changed, and a new one, and nothing else', () => {
    const before = [E('a', 'lore', null, 0, { edited: 5 }), E('b', 'lore', null, 1, { edited: 5 })];
    const after = [{ ...before[0], order: 3 }, { ...before[1], note: 'new' }, E('c', 'lore')];
    assert.deepEqual(N.neStamp(before, after, 70).map(e => e.edited), [5, 70, 70]);
  });
});
