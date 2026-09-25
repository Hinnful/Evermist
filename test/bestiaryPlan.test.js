'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../src/combat/bestiaryPlan.js');

const mk = (name, meta, extra) => Object.assign({ name, meta, source: '', speed: '30 ft.', cr: '', ac: '', hp: '', abil: ['10', '10', '10', '10', '10', '10'], saves: '' }, extra);
const goblin = mk('Goblin', 'Small humanoid (goblinoid), neutral evil', { cr: '1/4 (50 XP)', source: 'dnd.su', ac: '15', hp: '7 (2d6)' });
const goblinRu = mk('Гоблин', 'Маленький гуманоид (гоблиноид), нейтрально-злой', { cr: '1/4 (50 опыта)', source: 'dnd.su' });
const lich = mk('Лич', 'Средняя нежить (волшебник), нейтральная злая', { cr: '21 (33 000 опыта)', source: 'new.ttg.club', ac: '20', hp: '315', saves: 'Лов +10, Тел +10, Инт +12' });
const eagle = mk('Giant Eagle', 'Large beast, neutral good', { cr: '1 (200 XP)', speed: '10 ft., fly 80 ft.', ac: '13', hp: '26' });
const druid = mk('Druid', 'Medium humanoid, neutral', { cr: '2', abil: ['10', '12', '13', '12', '15', '11'] });
const all = [goblin, goblinRu, lich, eagle, druid];

describe('what a monster is filed under', () => {
  it('reads size and type in either language onto one name', () => {
    assert.deepEqual([goblin, goblinRu, lich, eagle].map(B.bsSize), ['Small', 'Small', 'Medium', 'Large']);
    assert.deepEqual([goblin, goblinRu, lich, eagle].map(B.bsType), ['Humanoid', 'Humanoid', 'Undead', 'Beast']);
  });
  it('reads "нейтрально-злой" as neutral evil, not as plain neutral', () => {
    assert.equal(B.bsAlign(goblinRu), 'Neutral evil');
    assert.equal(B.bsAlign(lich), 'Neutral evil');
    assert.equal(B.bsAlign(druid), 'Neutral');
  });
  it('reads movement off the speed line, and a plain walker as walk only', () => {
    assert.deepEqual(B.bsMoves(eagle), ['Fly']);
    assert.deepEqual(B.bsMoves(mk('Спрут', 'Большой зверь', { speed: '10 фт., плавая 60 фт.' })), ['Swim']);
    assert.deepEqual(B.bsMoves(goblin), ['Walk only']);
  });
  it('reads the challenge rating as a number that sorts', () => {
    assert.equal(B.bsCr(lich), '21');
    assert.equal(B.bsCrValue(B.bsCr(goblin)), 0.25);
    assert.equal(B.bsCrValue('—'), -1);
  });
});

describe('the search and the filters', () => {
  it('searches the name only', () => {
    const f = Object.assign(B.bsNoFilter(), { q: 'гоб' });
    assert.deepEqual(all.filter(b => B.bsMatches(b, f)).map(b => b.name), ['Гоблин']);
  });
  it('lets any ticked option through, and every filter must pass', () => {
    const f = Object.assign(B.bsNoFilter(), { type: ['Humanoid', 'Beast'], size: ['Small'] });
    assert.deepEqual(all.filter(b => B.bsMatches(b, f)).map(b => b.name), ['Goblin', 'Гоблин']);
  });
  it('keeps a challenge range inclusive at both ends', () => {
    const f = Object.assign(B.bsNoFilter(), { cr: ['1/4', '1'] });
    assert.deepEqual(all.filter(b => B.bsMatches(b, f)).map(b => b.name), ['Goblin', 'Гоблин', 'Giant Eagle']);
  });
  it('counts each option as if only the other filters were set', () => {
    const f = Object.assign(B.bsNoFilter(), { type: ['Undead'] });
    const types = B.bsOptions(all, f, 'type');
    assert.deepEqual(types.find(o => o.value === 'Humanoid'), { value: 'Humanoid', count: 3 });
    assert.deepEqual(B.bsOptions(all, f, 'size'), [{ value: 'Medium', count: 1 }]);
  });
  it('keeps a ticked option on the list when nothing else matches it', () => {
    const f = Object.assign(B.bsNoFilter(), { q: 'lich', source: ['dnd.su'] });
    assert.ok(B.bsOptions(all, f, 'source').some(o => o.value === 'dnd.su'));
  });
  it('says whether anything is filtered', () => {
    assert.equal(B.bsFiltered(B.bsNoFilter()), false);
    assert.equal(B.bsFiltered(Object.assign(B.bsNoFilter(), { cr: [null, '5'] })), true);
  });
});

describe('the order', () => {
  it('sorts by challenge rating with fractions below 1, ties by name', () => {
    assert.deepEqual(B.bsSorted(all, 'cr', 1).map(b => b.name), ['Goblin', 'Гоблин', 'Giant Eagle', 'Druid', 'Лич']);
    assert.deepEqual(B.bsSorted(all, 'cr', -1)[0].name, 'Лич');
  });
  it('sorts sizes smallest first, not alphabetically', () => {
    assert.deepEqual(B.bsSorted([eagle, goblin, lich], 'size', 1).map(b => b.name), ['Goblin', 'Лич', 'Giant Eagle']);
  });
});

describe('a save and the export file', () => {
  it('takes a listed save, and the modifier for one it does not list', () => {
    assert.deepEqual(B.bsSave(lich, 3), { value: '+12', listed: true });
    assert.deepEqual(B.bsSave(druid, 4), { value: '+2', listed: false });
  });
  it('writes monsters without their ids and reads them back', () => {
    const text = B.bsExportFile([Object.assign({ id: 'b3' }, goblin)]);
    const back = B.bsReadFile(text);
    assert.equal(back.length, 1);
    assert.equal(back[0].name, 'Goblin');
    assert.equal(back[0].id, undefined);
  });
  it('refuses a file that is not an exported bestiary', () => {
    assert.equal(B.bsReadFile('{"rows":[]}'), null);
    assert.equal(B.bsReadFile('not json'), null);
  });
});
