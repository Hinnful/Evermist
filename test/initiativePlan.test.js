'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { initiativeSlots, initiativeColumns, initiativeLivingMonsters, initiativeFightOver } = require('../src/combat/initiativePlan.js');

const ally = (name, init, hp) => ({ name, init: String(init), side: 'ally', hp: hp || '' });
const foe = (name, init, hp, max) => ({ name, init: String(init), side: 'enemy', hp: hp || '', sb: max ? { hp: String(max) } : undefined });

describe('initiativeSlots', () => {
  it('keeps the fight table\'s own order, whatever the initiatives say', () => {
    const s = initiativeSlots([ally('Вотан', 8), ally('Алистер', 19), ally('Селестия', 12)]);
    assert.deepEqual(s.map(x => x.name), ['Вотан', 'Алистер', 'Селестия']);
  });

  it('keeps tied rows in the order the DM has them', () => {
    const s = initiativeSlots([ally('B', 10), ally('A', 10)]);
    assert.deepEqual(s.map(x => x.name), ['B', 'A']);
  });

  it('shows an ally by its name as typed, trimmed, and an enemy by no name', () => {
    const s = initiativeSlots([ally('  Квента ', 15), foe('Призрак 2', 9)]);
    assert.deepEqual(s, [{ n: 1, name: 'Квента' }, { n: 2, count: 1 }]);
  });

  it('merges enemies back to back into one slot with a count', () => {
    const s = initiativeSlots([foe('Призрак', 20), foe('Призрак 2', 18), foe('Призрак 3', 17), ally('Чико', 12), foe('Гуль', 3)]);
    assert.deepEqual(s, [{ n: 1, count: 3 }, { n: 2, name: 'Чико' }, { n: 3, count: 1 }]);
  });

  it('never merges across an ally', () => {
    const s = initiativeSlots([foe('a', 20), ally('X', 15), foe('b', 10)]);
    assert.deepEqual(s.map(x => x.count || x.name), [1, 'X', 1]);
  });

  it('numbers slots, not rows', () => {
    const s = initiativeSlots([foe('a', 20), foe('b', 19), ally('X', 15), foe('c', 10), foe('d', 9), ally('Y', 5)]);
    assert.deepEqual(s.map(x => x.n), [1, 2, 3, 4]);
    assert.deepEqual(s.map(x => x.count || x.name), [2, 'X', 2, 'Y']);
  });

  it('shows a row with no initiative, in its place', () => {
    const s = initiativeSlots([ally('X', ''), ally('Y', 7), foe('a', ' '), foe('b', 'abc')]);
    assert.deepEqual(s, [{ n: 1, name: 'X' }, { n: 2, name: 'Y' }, { n: 3, count: 2 }]);
  });

  it('shows an enemy at 0 HP or below', () => {
    const s = initiativeSlots([foe('a', 20, '- 7', 7), ally('X', 19), foe('b', 18, '12 - 12')]);
    assert.deepEqual(s, [{ n: 1, count: 1 }, { n: 2, name: 'X' }, { n: 3, count: 1 }]);
  });

  it('keeps an ally at 0 HP', () => {
    const s = initiativeSlots([ally('X', 10, '20 - 25')]);
    assert.deepEqual(s, [{ n: 1, name: 'X' }]);
  });

  it('reads a row with no side as an enemy', () => {
    assert.deepEqual(initiativeSlots([{ name: 'Wolf', init: '4' }]), [{ n: 1, count: 1 }]);
  });

  it('answers an empty list for no rows', () => {
    assert.deepEqual(initiativeSlots([]), []);
    assert.deepEqual(initiativeSlots(undefined), []);
  });

  it('does not change the rows it reads', () => {
    const rows = [foe('a', 1), ally('X', 9)];
    const before = JSON.stringify(rows);
    initiativeSlots(rows);
    assert.equal(JSON.stringify(rows), before);
  });
});

describe('initiativeColumns', () => {
  it('keeps one column up to ten slots', () => {
    assert.deepEqual(initiativeColumns(1), { cols: 1, per: 1 });
    assert.deepEqual(initiativeColumns(10), { cols: 1, per: 10 });
  });
  it('balances the columns past ten', () => {
    assert.deepEqual(initiativeColumns(11), { cols: 2, per: 6 });
    assert.deepEqual(initiativeColumns(13), { cols: 2, per: 7 });
    assert.deepEqual(initiativeColumns(21), { cols: 3, per: 7 });
  });
});

describe('initiativeFightOver', () => {
  const at = (rows, fight) => ({ fight: fight || 'f1', living: initiativeLivingMonsters(rows) });

  it('counts the monsters still standing, initiative or not', () => {
    assert.equal(initiativeLivingMonsters([foe('a', 20), foe('b', 19, '- 7', 7), foe('c', ''), ally('X', 10), { name: 'W', init: '4' }]), 3);
    assert.equal(initiativeLivingMonsters(undefined), 0);
  });

  it('ends when the last monster goes down', () => {
    assert.equal(initiativeFightOver(at([foe('a', 20, '', 7), ally('X', 9)]), at([foe('a', 20, '- 7', 7), ally('X', 9)])), true);
  });

  it('ends when the last monster is deleted', () => {
    assert.equal(initiativeFightOver(at([foe('a', 20), ally('X', 9)]), at([ally('X', 9)])), true);
  });

  it('never ends a fight that had no monster yet', () => {
    assert.equal(initiativeFightOver(at([]), at([])), false);
    assert.equal(initiativeFightOver(at([ally('X', 9)]), at([ally('X', 9), foe('a', '')])), false);
  });

  it('does not end while a monster is left', () => {
    assert.equal(initiativeFightOver(at([foe('a', 20), foe('b', 19)]), at([foe('a', 20), foe('b', 19, '- 9', 9)])), false);
  });

  it('never ends on a change to the allies alone', () => {
    assert.equal(initiativeFightOver(at([ally('X', 9)]), at([ally('X', 9, '20 - 20')])), false);
    assert.equal(initiativeFightOver(at([foe('a', 20), ally('X', 9)]), at([foe('a', 20)])), false);
  });

  it('never ends on the first count after a start', () => {
    assert.equal(initiativeFightOver(null, at([])), false);
  });

  it('does not end when another fight with no monster is opened', () => {
    assert.equal(initiativeFightOver(at([foe('a', 20)], 'f1'), at([], 'f2')), false);
  });
});
