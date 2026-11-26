'use strict';

const test = require('node:test');
const assert = require('node:assert');
const P = require('../src/ui/libraryPlan.js');
const { SOUND_GROUPS } = (() => { const src = require('fs').readFileSync(require('path').join(__dirname, '../src/ui/soundList.js'), 'utf8'); return new Function(src + '; return { SOUND_GROUPS };')(); })();

const plain = o => JSON.parse(JSON.stringify(o));

test('libLabelClean keeps one trimmed line and caps it', () => {
  assert.strictEqual(P.libLabelClean('  Рёв\n  дракона \t'), 'Рёв дракона');
  assert.strictEqual(P.libLabelClean(null), '');
  assert.strictEqual(P.libLabelClean('x'.repeat(500)).length, P.LIB_LABEL_MAX);
});

test('cleanMusicOrder drops bad keys, duplicates and empty labels, and answers null for junk', () => {
  const c = P.cleanMusicOrder({ at: 5, order: ['a.mp3', 'a.mp3', '../x.mp3', 7, '#' + 'f'.repeat(64)], labels: { 'a.mp3': ' Битва ', 'b.mp3': '  ', '../c': 'x' } });
  assert.deepStrictEqual(plain(c), { v: 1, at: 5, order: ['a.mp3', '#' + 'f'.repeat(64)], labels: { 'a.mp3': 'Битва' } });
  assert.strictEqual(P.cleanMusicOrder('nope'), null);
  assert.strictEqual(P.cleanMusicOrder(null), null);
  assert.strictEqual(P.cleanMusicOrder({ at: -3 }).at, 0);
});

test('a cleaned map has no prototype, so a key called __proto__ or constructor is only data', () => {
  const c = P.libParse('{"labels":{"__proto__":"x","constructor":"Рёв"}}', P.cleanMusicOrder);
  assert.strictEqual(Object.getPrototypeOf(c.labels), null);
  assert.strictEqual(c.labels.constructor, 'Рёв');
  assert.strictEqual(P.cleanMusicOrder({}).labels.toString, undefined);
});

test('cleanSoundsLayout keeps an unnamed built-in group, drops an unnamed own group, and only built-in files hide', () => {
  const c = P.cleanSoundsLayout({ at: 9, order: ['x.wav'], groupOrder: ['builtin:Combat', 'g1', 'g2'],
    groups: { 'builtin:Combat': { members: ['builtin:a.mp3'] }, g1: { members: ['y.wav'] }, g2: { name: 'Сессия 4', members: ['y.wav', 'y.wav'] } },
    labels: { 'builtin:a.mp3': 'Лязг' }, hidden: ['bell.mp3', 'Mine.wav', '../a.mp3'] });
  assert.deepStrictEqual(plain(c), { v: 1, at: 9, order: ['x.wav'], groups: { 'builtin:Combat': { members: ['builtin:a.mp3'] }, g2: { name: 'Сессия 4', members: ['y.wav'] } },
    groupOrder: ['builtin:Combat', 'g2'], labels: { 'builtin:a.mp3': 'Лязг' }, hidden: ['bell.mp3'] });
});

test('cleanPicturesLayout takes picture ids only and groups with a name', () => {
  const c = P.cleanPicturesLayout({ order: ['ab1', 'Bad Id', 'ab1'], groups: { g: { name: 'Люди', members: ['zz9', 'NO'] }, h: { members: ['q'] } } });
  assert.deepStrictEqual(plain(c), { v: 1, at: 0, order: ['ab1'], groups: { g: { name: 'Люди', members: ['zz9'] } }, groupOrder: ['g'] });
});

test('libParse answers null for text that is not JSON or missing', () => {
  assert.strictEqual(P.libParse('{', P.cleanPicturesLayout), null);
  assert.strictEqual(P.libParse(null, P.cleanPicturesLayout), null);
});

test('upgrade: empty music groups are dropped, the ones holding a track kept in order', () => {
  assert.deepStrictEqual(P.musicGroupsUpgrade(['Пусто', 'Бой', 'Таверна'], { 'a.mp3': 'Таверна', 'b.mp3': 'Бой' }), ['Бой', 'Таверна']);
});

test('upgrade: tracks keep the order listed, pictures go newest first', () => {
  assert.deepStrictEqual(P.musicOrderSeed(['b.mp3', 'a.mp3']).order, ['b.mp3', 'a.mp3']);
  assert.deepStrictEqual(P.picturesSeed([{ id: 'a', added: 1 }, { id: 'b', added: 3 }, { id: 'c', added: 2 }]).order, ['b', 'c', 'a']);
});

test('upgrade: own sounds go into My sounds, then the six built-in groups', () => {
  const L = P.soundsSeedLayout(SOUND_GROUPS, ['Колокол.wav']);
  assert.deepStrictEqual(L.groupOrder, ['builtin:My sounds'].concat(SOUND_GROUPS.map(g => 'builtin:' + g.name)));
  assert.deepStrictEqual(L.groups['builtin:My sounds'].members, ['Колокол.wav']);
  assert.strictEqual(L.groups['builtin:Combat'].members.length, 5);
  assert.deepStrictEqual(plain(P.cleanSoundsLayout(plain(L))), plain(L), 'the seed survives its own cleaner');
});

test('music layout: groups from the names tracks carry, the order one list, and back again', () => {
  const L = P.musicToLib(['u1', 'd1', 'u2', 'd2'], { d1: 'Подземье', d2: 'Подземье', late: 'Таверна' }, ['Таверна', 'Подземье']);
  assert.deepStrictEqual(L.order, ['u1', 'u2']);
  assert.deepStrictEqual(L.groupOrder, ['Таверна', 'Подземье']);
  assert.deepStrictEqual(L.groups['Подземье'].members, ['d1', 'd2']);
  assert.deepStrictEqual(L.groups['Таверна'].members, ['late'], 'a grouped track the order has not met yet joins its group');
  const back = P.musicFromLib(L);
  assert.deepStrictEqual(back.order, ['u1', 'u2', 'late', 'd1', 'd2']);
  assert.deepStrictEqual(plain(back.of), { late: 'Таверна', d1: 'Подземье', d2: 'Подземье' });
  assert.deepStrictEqual(back.groupOrder, ['Таверна', 'Подземье']);
});

test('with sync off nothing is hashed: every stored form keys by file name, id or built-in id', () => {
  const HASH = /^[#]?[0-9a-f]{64}$/;
  const forms = [P.musicOrderSeed(['Битва.mp3', 'Тема [abcdefghijk].m4a']), P.soundsSeedLayout(SOUND_GROUPS, ['Колокол.wav']),
    P.picturesSeed([{ id: 'abc', added: 1 }])];
  const keys = f => (f.order || []).concat(...Object.keys(f.groups || {}).map(g => f.groups[g].members), Object.keys(f.labels || {}));
  for (const f of forms) assert.ok(!keys(f).some(k => HASH.test(k)), JSON.stringify(f));
});

test('a backup carries the pictures layout of the pictures it holds only, and drops a group left empty', () => {
  const L = { order: ['u1', 'gone'], groups: { g1: { name: 'Люди', members: ['a', 'b'] }, g2: { name: 'Пусто', members: ['zz'] } }, groupOrder: ['g1', 'g2'] };
  assert.deepStrictEqual(plain(P.picturesLayoutFor(L, ['u1', 'a', 'b'])),
    { v: 1, at: 0, order: ['u1'], groups: { g1: { name: 'Люди', members: ['a', 'b'] } }, groupOrder: ['g1'] });
  assert.deepStrictEqual(plain(P.picturesLayoutFor(null, ['a'])), { v: 1, at: 0, order: [], groups: {}, groupOrder: [] });
});

const FILE = { order: ['u1', 'u2'], groups: { gA: { name: 'Люди', members: ['a1', 'a2'] }, gB: { name: 'Письма', members: ['b1', 'b2', 'b3'] } }, groupOrder: ['gA', 'gB'] };

test('import into a fresh library: the pictures take the file\'s groups, group order and order', () => {
  const mine = { order: [], groups: Object.create(null), groupOrder: [] };
  const out = P.picturesLayoutMerge(mine, FILE, ['b3', 'a2', 'u2', 'b1', 'a1', 'u1', 'b2']);
  assert.deepStrictEqual(plain(out), plain(FILE));
});

test('import into a library that has pictures: those keep their place, new ones go where the file puts them', () => {
  const mine = { order: ['x1', 'u1'], groups: { mine1: { name: 'люди', members: ['x2', 'a1'] }, mine2: { name: 'Свои', members: ['x3'] } }, groupOrder: ['mine2', 'mine1'] };
  const out = P.picturesLayoutMerge(mine, FILE, ['u2', 'a2', 'b1', 'b2']);
  assert.deepStrictEqual(out.order, ['x1', 'u1', 'u2'], 'a new picture lands after the one before it in the file');
  assert.deepStrictEqual(out.groups.mine1.members, ['x2', 'a1', 'a2'], 'a group of the same name, any case, is the file\'s group');
  assert.deepStrictEqual(out.groupOrder, ['mine2', 'mine1', 'gB'], 'a missing group is made after the file\'s groups before it');
  assert.deepStrictEqual(out.groups.gB, { name: 'Письма', members: ['b1', 'b2'] });
  assert.deepStrictEqual(mine.order, ['x1', 'u1'], 'the library\'s own layout is not changed in place');
});

test('a picture already here keeps this library\'s group even when the file has it elsewhere', () => {
  const mine = { order: ['a1'], groups: Object.create(null), groupOrder: [] };
  const out = P.picturesLayoutMerge(mine, FILE, ['a2']);
  assert.deepStrictEqual(out.order, ['a1']);
  assert.deepStrictEqual(out.groups.gA.members, ['a2']);
});

test('a new picture placed before the next one the file lists that is already there', () => {
  const mine = { order: ['u2'], groups: Object.create(null), groupOrder: [] };
  assert.deepStrictEqual(P.picturesLayoutMerge(mine, FILE, ['u1']).order, ['u1', 'u2']);
  assert.deepStrictEqual(P.picturesLayoutMerge(mine, null, ['u1']).order, ['u2'], 'an older backup with no layout changes nothing');
});
