'use strict';

// AC and HP edit on the read page as two values, the large number and the note under it (BACKLOG 312).

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { combatSplitBig, combatJoinBig } = require('../src/combat/combatPlan.js');
const P = require('../src/combat/statBlockParse.js');
const { statBlocksInText } = require('../src/combat/statBlockBook.js');

// What the parser and the book import store, from their own test fixtures.
const SHAPES = ['15 (leather armor, shield)', '7 (2d6)', '45 (6d10 + 12)', '17 (natural armor)', '15 (кожаный доспех, щит)',
  '7 (2к6)', '149 (13к12 + 65)', '10 (3к6)', '11 (2к8 +2)', '13', '20', '11 (шкуры)', '68 (8к10 + 24)', '204 (24к8 + 96)',
  '13 (природный доспех)', '30 (4к8 + 12)'];

describe('combatSplitBig', () => {
  it('reads the number and the note the way the read page shows them', () => {
    assert.deepEqual(combatSplitBig('11 (шкуры)'), { n: '11', note: 'шкуры' });
    assert.deepEqual(combatSplitBig('68 (8к10 + 24)'), { n: '68', note: '8к10 + 24' });
    assert.deepEqual(combatSplitBig('13'), { n: '13', note: '' });
    assert.deepEqual(combatSplitBig('  12 natural armor'), { n: '12', note: 'natural armor' });
  });
  it('keeps a line with no leading number whole, in the number', () => {
    assert.deepEqual(combatSplitBig('varies'), { n: 'varies', note: '' });
    assert.deepEqual(combatSplitBig(''), { n: '', note: '' });
    assert.deepEqual(combatSplitBig(undefined), { n: '', note: '' });
  });
});

describe('combatJoinBig', () => {
  it('joins a number and a note as N (note)', () => {
    assert.equal(combatJoinBig('11', 'шкуры'), '11 (шкуры)');
    assert.equal(combatJoinBig('68', '8к10 + 24'), '68 (8к10 + 24)');
    assert.equal(combatJoinBig(' 12 ', ' leather '), '12 (leather)');
  });
  it('joins a number alone as the number', () => {
    assert.equal(combatJoinBig('11', ''), '11');
    assert.equal(combatJoinBig('11', '   '), '11');
  });
  it('keeps the raw text when there is no leading number', () => {
    assert.equal(combatJoinBig('varies', ''), 'varies');
    assert.equal(combatJoinBig('', 'шкуры'), 'шкуры');
    assert.equal(combatJoinBig('', ''), '');
  });
  it('does not wrap a note that already opens with its own brackets', () => {
    assert.equal(combatJoinBig('17', '(natural armor), 19 with mage armor'), '17 (natural armor), 19 with mage armor');
  });
  it('gives back every shape the parser and the book import store', () => {
    for (const s of SHAPES) {
      const { n, note } = combatSplitBig(s);
      assert.equal(combatJoinBig(n, note), s, s);
    }
  });
  it('gives back what a real import stored', () => {
    const a = P.statBlockFromLines(['Goblin', 'Small humanoid', 'Armor Class 15 (leather armor, shield)', 'Hit Points 7 (2d6)', 'Speed 30 ft.']);
    const [b] = statBlocksInText(['Зомби Страда', 'Средний нежить, без мировоззрения', 'Класс Доспеха 8', 'Хиты 30 (4к8 + 12)', 'Скорость 20 фт.',
      'СИЛ ЛОВ ТЕЛ ИНТ МДР ХАР', '13 ( +1 ) 6 ( –2 ) 16 ( +3 ) 3 ( –4 ) 6 ( –2 ) 5 ( –3 )', 'Опасность 1 (200 опыта)'].join('\n'));
    assert.deepEqual([a.ac, a.hp, b.ac, b.hp], ['15 (leather armor, shield)', '7 (2d6)', '8', '30 (4к8 + 12)']);
    for (const v of [a.ac, a.hp, b.ac, b.hp]) {
      const { n, note } = combatSplitBig(v);
      assert.equal(combatJoinBig(n, note), v, v);
    }
  });
});
