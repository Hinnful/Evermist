'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { sanitizeGroupName, uniqueGroupName, mergeGroupOrder, buildGroupSections } =
  require('../src/scenes/sceneGroups.js');

// ── sanitizeGroupName ────────────────────────────────────────────────────────

test('sanitizeGroupName collapses whitespace and trims', () => {
  assert.strictEqual(sanitizeGroupName('  The   Watcherhouse  '), 'The Watcherhouse');
});

test('sanitizeGroupName turns an all-space name into ungrouped', () => {
  // An all-space heading would render as an empty bar nothing could be dragged out of.
  assert.strictEqual(sanitizeGroupName('   '), '');
  assert.strictEqual(sanitizeGroupName(null), '');
  assert.strictEqual(sanitizeGroupName(undefined), '');
});

test('sanitizeGroupName caps the length', () => {
  assert.strictEqual(sanitizeGroupName('x'.repeat(120)).length, 40);
});

// ── uniqueGroupName ──────────────────────────────────────────────────────────

test('uniqueGroupName leaves a free name alone', () => {
  assert.strictEqual(uniqueGroupName('Greyhollow', ['Watcherhouse']), 'Greyhollow');
});

test('uniqueGroupName numbers a collision', () => {
  assert.strictEqual(uniqueGroupName('New group', ['New group']), 'New group 2');
  assert.strictEqual(uniqueGroupName('New group', ['New group', 'New group 2']), 'New group 3');
});

test('uniqueGroupName falls back when the name is empty', () => {
  assert.strictEqual(uniqueGroupName('   ', []), 'Group');
});

// ── mergeGroupOrder ──────────────────────────────────────────────────────────

test('mergeGroupOrder keeps the stored order and appends unseen names', () => {
  // The restore path is the case: a zip brings in a group the stored order never saw.
  const out = mergeGroupOrder(['Watcherhouse', 'Greyhollow'], ['Greyhollow', 'Ashfall Mine']);
  assert.deepStrictEqual(out, ['Watcherhouse', 'Greyhollow', 'Ashfall Mine']);
});

test('mergeGroupOrder keeps a stored group that holds nothing', () => {
  // An empty group is a heading the DM made before dragging anything into it.
  assert.deepStrictEqual(mergeGroupOrder(['Empty'], []), ['Empty']);
});

test('mergeGroupOrder drops blanks and duplicates', () => {
  assert.deepStrictEqual(mergeGroupOrder(['A', '  ', 'A', ''], ['A']), ['A']);
});

// ── buildGroupSections ───────────────────────────────────────────────────────

const S = (name, group) => ({ id: name, name, group });

test('buildGroupSections files each scene under its own group', () => {
  const scenes = [S('cellar', 'House'), S('attic', 'House'), S('pass', '')];
  const secs = buildGroupSections(scenes, ['House']);
  assert.strictEqual(secs.length, 2);
  assert.deepStrictEqual(secs[0].scenes.map(s => s.id), ['cellar', 'attic']);
  assert.strictEqual(secs[0].ungrouped, false);
  assert.deepStrictEqual(secs[1].scenes.map(s => s.id), ['pass']);
  assert.strictEqual(secs[1].ungrouped, true);
});

test('buildGroupSections always puts Ungrouped last', () => {
  const scenes = [S('loose', ''), S('filed', 'House')];
  const secs = buildGroupSections(scenes, ['House']);
  assert.strictEqual(secs[secs.length - 1].ungrouped, true);
});

test('buildGroupSections keeps Ungrouped when every scene is filed', () => {
  // It is the only place to drag a card back OUT of a group, so it cannot hide when empty.
  const secs = buildGroupSections([S('a', 'House')], ['House']);
  assert.strictEqual(secs.length, 2);
  assert.strictEqual(secs[0].ungrouped, false);
  assert.strictEqual(secs[1].ungrouped, true);
  assert.strictEqual(secs[1].scenes.length, 0);
});

test('buildGroupSections gives an all-ungrouped library one flat section', () => {
  // A DM who never files anything must see exactly the flat list they saw before groups.
  const secs = buildGroupSections([S('a', ''), S('b', undefined)], []);
  assert.strictEqual(secs.length, 1);
  assert.strictEqual(secs[0].ungrouped, true);
  assert.deepStrictEqual(secs[0].scenes.map(s => s.id), ['a', 'b']);
});

test('buildGroupSections keeps an empty group visible', () => {
  const secs = buildGroupSections([S('a', 'House')], ['House', 'Docks']);
  assert.deepStrictEqual(secs.filter(s => !s.ungrouped).map(s => s.name), ['House', 'Docks']);
  assert.strictEqual(secs[1].scenes.length, 0);
});

test('buildGroupSections survives an empty library', () => {
  const secs = buildGroupSections([], []);
  assert.strictEqual(secs.length, 1);
  assert.strictEqual(secs[0].ungrouped, true);
});

test('buildGroupSections matches a group name that needs sanitising', () => {
  // A name written with stray whitespace must land under the same heading as the clean one.
  const secs = buildGroupSections([S('a', ' House '), S('b', 'House')], ['House']);
  assert.deepStrictEqual(secs[0].scenes.map(s => s.id), ['a', 'b']);
});

// ── The library order kernel (Music, Sounds, Pictures) ───────────────────────

const lib = require('../src/scenes/sceneGroups.js');
const mk = (order, groups) => {
  const L = lib.libEmpty();
  L.order = order.slice();
  for (const [gk, name, members] of groups || []) { L.groups[gk] = { name, members: members.slice() }; L.groupOrder.push(gk); }
  return L;
};
const shape = L => ({ order: L.order, groups: L.groupOrder.map(g => [g, L.groups[g].name, L.groups[g].members]) });

test('libNormalize puts a new arrival at the top of Ungrouped and keeps each key once', () => {
  const L = lib.libNormalize(mk(['a', 'b', 'a'], [['g', 'G', ['c', 'b']]]), ['new1', 'a', 'b', 'c', 'new2']);
  assert.deepStrictEqual(shape(L), { order: ['new1', 'new2', 'a'], groups: [['g', 'G', ['c', 'b']]] });
});

test('libNormalize keeps a key that is not present, so a restore lands where it was', () => {
  const L = lib.libNormalize(mk(['gone', 'a'], [['g', 'G', ['away']]]), ['a']);
  assert.deepStrictEqual(shape(L), { order: ['gone', 'a'], groups: [['g', 'G', ['away']]] });
  assert.deepStrictEqual(lib.libSections(L, ['a', 'away']).map(s => [s.key, s.items]), [[null, ['a']], ['g', ['away']]]);
});

test('libNormalize lists a group missing from groupOrder and drops an order entry with no group', () => {
  const L = { order: [], groups: Object.assign(Object.create(null), { x: { name: 'X', members: ['k'] } }), groupOrder: ['nope'] };
  assert.deepStrictEqual(lib.libNormalize(L, ['k']).groupOrder, ['x']);
});

test('libSections shows Ungrouped first and leaves out a group with nothing present', () => {
  const L = mk(['a'], [['g1', 'One', ['b']], ['g2', 'Two', ['gone']]]);
  assert.deepStrictEqual(lib.libSections(L, ['a', 'b']).map(s => s.key), [null, 'g1']);
});

test('libMove reorders within a list, before a key or at the end', () => {
  const L = mk(['a', 'b', 'c'], []);
  assert.deepStrictEqual(lib.libMove(L, ['c'], null, 'a').order, ['c', 'a', 'b']);
  assert.deepStrictEqual(lib.libMove(L, ['a'], null, null).order, ['b', 'c', 'a']);
  assert.deepStrictEqual(L.order, ['a', 'b', 'c'], 'the input is left alone');
});

test('libMove into a group joins it, and the last item out removes the group', () => {
  const L = mk(['a'], [['g', 'G', ['b']]]);
  const into = lib.libMove(L, ['a'], 'g', 'b');
  assert.deepStrictEqual(shape(into), { order: [], groups: [['g', 'G', ['a', 'b']]] });
  const out = lib.libMove(mk([], [['g', 'G', ['b']]]), ['b'], null, null);
  assert.deepStrictEqual(shape(out), { order: ['b'], groups: [] });
});

test('libMove to a group that does not exist changes nothing', () => {
  assert.deepStrictEqual(shape(lib.libMove(mk(['a'], []), ['a'], 'nope', null)), { order: ['a'], groups: [] });
});

test('libMoveTo counts the position among present keys only', () => {
  const L = mk(['a', 'gone', 'b', 'c'], []);
  assert.deepStrictEqual(lib.libMoveTo(L, ['c'], null, 1, ['a', 'b', 'c']).order, ['a', 'gone', 'c', 'b']);
  assert.deepStrictEqual(lib.libMoveTo(L, ['a'], null, 99, ['a', 'b', 'c']).order, ['gone', 'b', 'c', 'a']);
});

test('libHoldGroup makes a group of the two, target first, first after Ungrouped', () => {
  const r = lib.libHoldGroup(mk(['w', 'crow', 'rats', 'thunder'], [['c', 'Combat', ['s']]]), 'thunder', 'crow', 'n1', 'New group');
  assert.strictEqual(r.made, true);
  assert.deepStrictEqual(shape(r.L), { order: ['w', 'rats'], groups: [['n1', 'New group', ['crow', 'thunder']], ['c', 'Combat', ['s']]] });
});

test('libHoldGroup over an item in a group makes the new group in its place, emptied groups gone', () => {
  const r = lib.libHoldGroup(mk(['u'], [['a', 'A', ['x']], ['b', 'B', ['y', 'z']]]), 'x', 'y', 'n', 'N');
  assert.strictEqual(r.made, true);
  assert.deepStrictEqual(shape(r.L), { order: ['u'], groups: [['n', 'N', ['y', 'x']], ['b', 'B', ['z']]] });
});

test('libHoldGroup on itself does nothing', () => {
  assert.strictEqual(lib.libHoldGroup(mk(['a'], []), 'a', 'a', 'n', 'N').made, false);
});

test('libMergeGroups appends the items and removes the source; libUngroup keeps the items', () => {
  const L = mk(['u'], [['a', 'A', ['x']], ['b', 'B', ['y']]]);
  assert.deepStrictEqual(shape(lib.libMergeGroups(L, 'a', 'b')), { order: ['u'], groups: [['b', 'B', ['y', 'x']]] });
  assert.deepStrictEqual(shape(lib.libUngroup(L, 'a')), { order: ['u', 'x'], groups: [['b', 'B', ['y']]] });
  assert.deepStrictEqual(shape(lib.libRenameGroup(L, 'a', 'Ä')).groups[0], ['a', 'Ä', ['x']]);
});

test('libGroupNamed finds a clash by the shown name, case ignored, never the group itself', () => {
  const L = mk([], [['builtin:Combat', undefined, ['x']], ['g', 'Ночь', ['y']]]);
  const nameOf = g => L.groups[g].name || ({ 'builtin:Combat': 'Бой' })[g];
  assert.strictEqual(lib.libGroupNamed(L, 'бой', nameOf), 'builtin:Combat');
  assert.strictEqual(lib.libGroupNamed(L, 'НОЧЬ', nameOf, 'g'), null);
});

test('built-in ids: a sound by its file, a group by its English name', () => {
  assert.strictEqual(lib.libBuiltinKey('bell.mp3'), 'builtin:bell.mp3');
  assert.strictEqual(lib.libBuiltinOf('builtin:bell.mp3'), 'bell.mp3');
  assert.strictEqual(lib.libBuiltinOf('bell.mp3'), null);
  assert.strictEqual(lib.libIsBuiltin('builtin:My sounds'), true);
});

test('libSoundsSeed starts with My sounds holding the own files, then the built-in groups unnamed', () => {
  const L = lib.libSoundsSeed([{ name: 'Combat', sounds: [{ file: 'a.mp3' }, { file: 'b.mp3' }] }], ['Лязг.wav']);
  assert.deepStrictEqual(shape(L), { order: [], groups: [['builtin:My sounds', undefined, ['Лязг.wav']], ['builtin:Combat', undefined, ['builtin:a.mp3', 'builtin:b.mp3']]] });
});
