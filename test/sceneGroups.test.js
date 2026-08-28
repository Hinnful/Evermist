'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { sanitizeGroupName, uniqueGroupName, mergeGroupOrder, buildGroupSections } =
  require('../src/sceneGroups.js');

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

test('buildGroupSections omits Ungrouped when every scene is filed', () => {
  const secs = buildGroupSections([S('a', 'House')], ['House']);
  assert.strictEqual(secs.length, 1);
  assert.strictEqual(secs[0].ungrouped, false);
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
  assert.deepStrictEqual(secs.map(s => s.name), ['House', 'Docks']);
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
