'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mpePath, mpeTree, mpeFind, mpeCreateRefusal, mpeMonsterRefusal, mpeWouldDelete, mpeParse, mpeMatch, mpeResolve, mpeUnresolvedSay, mpeReadBack } = require('../src/mcp/mcpEntriesPlan.js');
const { mpToken } = require('../src/notes/mentionPlan.js');

const E = (id, kind, name, parent, order, note) => ({ id, kind, name, note: note || '', parent: parent || kind, order: order || 0 });
const entries = [E('f1', 'faction', 'Zhentarim'), E('f2', 'faction', 'Black Network', 'f1', 0, 'Spies.'), E('f3', 'faction', 'Wachter', 'f1', 1),
  E('l1', 'lore', 'History'), E('l2', 'lore', 'Wachter', 'l1')];

describe('mpeTree and mpeFind', () => {
  it('lists a kind with its nesting and which entries hold a note', () => {
    assert.deepEqual(mpeTree(entries, 'faction'), [{ name: 'Zhentarim', hasNote: false, children: [
      { name: 'Black Network', hasNote: true, children: [] }, { name: 'Wachter', hasNote: false, children: [] }] }]);
  });
  it('finds an entry by name in any case, and by path', () => {
    assert.equal(mpeFind(entries, 'faction', 'black network').entry.id, 'f2');
    assert.equal(mpeFind(entries, 'faction', 'Zhentarim › Wachter').entry.id, 'f3');
    assert.equal(mpePath(entries, entries[2]), 'Zhentarim › Wachter');
  });
  it('keeps kinds apart and says when nothing matches', () => {
    assert.equal(mpeFind(entries, 'lore', 'Wachter').entry.id, 'l2');
    assert.match(mpeFind(entries, 'lore', 'Black Network').error, /No lore entry/);
  });
  it('asks for a path when two entries share a name', () => {
    const two = entries.concat(E('f4', 'faction', 'Wachter', 'f2'));
    assert.match(mpeFind(two, 'faction', 'Wachter').error, /Zhentarim › Wachter.*Zhentarim › Black Network › Wachter/);
    assert.equal(mpeFind(two, 'faction', 'Black Network › Wachter').entry.id, 'f4');
  });
});

describe('the refusal to make a second one', () => {
  it('names the existing entry, in any case', () => {
    assert.match(mpeCreateRefusal(entries, 'faction', 'wachter'), /already exists \(at "Zhentarim › Wachter"\).*@\{Wachter\}/);
    assert.equal(mpeCreateRefusal(entries, 'faction', 'Harpers'), null);
  });
  it('checks the Bestiary for a monster, in any case', () => {
    const blocks = { b1: { id: 'b1', name: 'Lady Wachter', source: 'Module' } };
    assert.match(mpeMonsterRefusal(blocks, 'lady wachter'), /Bestiary already holds.*Lady Wachter.*Module/);
    assert.equal(mpeMonsterRefusal(blocks, 'Goblin'), null);
  });
});

describe('mpeWouldDelete', () => {
  it('lists what goes and which notes mention it', () => {
    const t = mpeWouldDelete('faction', 'Zhentarim', ['Zhentarim › Wachter'], [{ name: 'Keep', word: 'Map' }]);
    assert.match(t, /Zhentarim.*1 entry inside it.*Zhentarim › Wachter.*Map "Keep".*Nothing was deleted.*confirmed: true/);
    assert.match(mpeWouldDelete('lore', 'History', [], []), /No note mentions it/);
  });
});

const cands = [
  { kind: 'entry', word: 'faction', name: 'Wachter', where: '', id: 'f3' },
  { kind: 'entry', word: 'lore', name: 'Wachter', where: '', id: 'l2' },
  { kind: 'monster', word: 'monster', name: 'Lady Vex', where: '', id: 'm1' },
  { kind: 'map', word: 'map', name: 'Keep', where: '', id: 's1' },
  { kind: 'room', word: 'room', name: 'Hall', where: 'Keep', id: 's1:u1' },
  { kind: 'room', word: 'room', name: 'Hall', where: 'Crypt', id: 's2:u2' },
];
const mint = c => c.id;

describe('mpeParse', () => {
  it('splits a text into words and names, unescaping a brace', () => {
    assert.deepEqual(mpeParse('See @{Lady Vex} and @{A \\} B}.'), [{ text: 'See ' }, { name: 'Lady Vex', raw: '@{Lady Vex}' }, { text: ' and ' }, { name: 'A } B', raw: '@{A \\} B}' }, { text: '.' }]);
  });
  it('leaves an unclosed or empty one as words', () => {
    assert.deepEqual(mpeParse('a @{x b and more'), [{ text: 'a @{x b and more' }]);
    assert.deepEqual(mpeParse('a @{} b'), [{ text: 'a @{} b' }]);
  });
});

describe('mpeResolve', () => {
  it('writes the stored mention for a name that matches one entry', () => {
    const r = mpeResolve('Ask @{Lady Vex}.', cands, mint);
    assert.equal(r.text, 'Ask ' + mpToken('Lady Vex', 'monster', 'm1') + '.');
    assert.equal(r.linked, 1);
    assert.deepEqual(r.unresolved, []);
  });
  it('resolves a room by Map › Room and shows only the room name', () => {
    const r = mpeResolve('In @{Keep › Hall}.', cands, mint);
    assert.equal(r.text, 'In ' + mpToken('Hall', 'room', 's1:u1') + '.');
  });
  it('never guesses between two matches: plain words, listed with the options', () => {
    const r = mpeResolve('@{Wachter} and @{Hall}', cands, mint);
    assert.equal(r.text, 'Wachter and Hall');
    assert.equal(r.linked, 0);
    assert.deepEqual(r.unresolved.map(u => [u.name, u.why]), [['Wachter', 'ambiguous'], ['Hall', 'ambiguous']]);
    assert.deepEqual(r.unresolved[0].options, ['faction "Wachter"', 'lore "Wachter"']);
    assert.match(mpeUnresolvedSay(r.unresolved), /Left as plain words.*"Wachter".*faction "Wachter", lore "Wachter"/);
  });
  it('takes a kind word to pick between them', () => {
    const r = mpeResolve('@{lore: Wachter}', cands, mint);
    assert.equal(r.text, mpToken('Wachter', 'entry', 'l2'));
  });
  it('leaves an unknown name plain and listed', () => {
    const r = mpeResolve('Meet @{Nobody}.', cands, mint);
    assert.equal(r.text, 'Meet Nobody.');
    assert.deepEqual(r.unresolved, [{ name: 'Nobody', why: 'unknown' }]);
  });
  it('lists a match that cannot be minted yet', () => {
    const r = mpeResolve('@{Keep}', cands, () => null);
    assert.equal(r.text, 'Keep');
    assert.equal(r.unresolved[0].why, 'unavailable');
  });
  it('leaves text with no names untouched and says nothing', () => {
    assert.deepEqual(mpeResolve('plain', cands, mint), { text: 'plain', linked: 0, unresolved: [] });
    assert.equal(mpeUnresolvedSay([]), '');
  });
});

describe('mpeMatch', () => {
  it('narrows by the kind given', () => {
    assert.equal(mpeMatch(cands, 'Wachter', 'faction').hits.length, 1);
    assert.equal(mpeMatch(cands, 'Wachter').hits.length, 2);
  });
});

describe('mpeReadBack', () => {
  const stored = 'Allied with ' + mpToken('Lady Vex', 'monster', 'm1') + ' in ' + mpToken('Hall', 'room', 's1:u1') + ' and ' + mpToken('Gone', 'entry', 'x1') + '.';
  const shownAs = (kind, id) => (id === 'm1' ? 'Lady Vex' : id === 's1:u1' ? 'Keep › Hall' : null);
  const gone = mpToken('Gone', 'entry', 'x1');
  it('reads each mention as @{Name}, a room as Map › Room, and keeps the stored mention of a gone entry', () => {
    assert.equal(mpeReadBack(stored, shownAs), 'Allied with @{Lady Vex} in @{Keep › Hall} and ' + gone + '.');
  });
  it('round-trips through mpeResolve', () => {
    const shown = mpeReadBack(stored, shownAs);
    assert.equal(mpeResolve(shown, cands, mint).text, 'Allied with ' + mpToken('Lady Vex', 'monster', 'm1') + ' in ' + mpToken('Hall', 'room', 's1:u1') + ' and ' + gone + '.');
  });
  it('passes plain text through', () => {
    assert.equal(mpeReadBack('nothing here', shownAs), 'nothing here');
    assert.equal(mpeReadBack(undefined, shownAs), '');
  });
});
