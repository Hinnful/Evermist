'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { combatAttacks, combatAttackLine } = require('../src/combat/attackLine.js');

// Action text as the parser and the book import produce it (test/statBlockParse.test.js and
// test/statBlockBook.test.js carry the same lines).
const read = t => combatAttacks({ secs: { Actions: [{ n: 'A', t }] } })[0];

describe('the Attacks line', () => {
  it('reads an English 2014 attack', () => {
    assert.deepEqual(read('Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage.'),
      { n: 'A', hit: '+4', dmg: '5', type: 'slashing' });
  });
  it('reads an English 2024 attack and stops at the first damage', () => {
    const a = read('Melee Attack Roll: +4, reach 5 ft. Hit: 5 (1d6 + 2) Slashing damage, plus 2 (1d4) Slashing damage if the attack roll had Advantage.');
    assert.deepEqual([a.hit, a.dmg, a.type], ['+4', '5', 'slashing']);
  });
  it('reads Russian dnd.su and 2024 lines', () => {
    const a = read('Рукопашная атака оружием: +4 к попаданию. Попадание: 5 (1к6 + 2) рубящего урона.');
    assert.deepEqual([a.hit, a.dmg, a.type], ['+4', '5', 'рубящего']);
    const b = read('Бросок атаки в ближнем бою: +6, зона досягаемости 5 футов. Попадание: 9 (1d10 + 4) Колющего урона Силой.');
    assert.deepEqual([b.hit, b.dmg, b.type], ['+6', '9', 'колющего']);
  });
  it('reads a Russian line that names the damage before its number', () => {
    const a = read('Рукопашная атака оружием: +14 к попаданию, досягаемость 10 футов, одна цель. Попадание: Колющий урон 19 (2к10 + 8) плюс урон огнём 7 (2к6).');
    assert.deepEqual([a.hit, a.dmg, a.type], ['+14', '19', 'колющий']);
    const b = read('Рукопашная атака заклинанием: +12 к попаданию. Попадание: Урон холодом 10 (3к6).');
    assert.deepEqual([b.dmg, b.type], ['10', 'холодом']);
  });
  it('reads flat damage with no dice', () => {
    const a = read('Удар. Рукопашная атака оружием: +3 к попаданию. Попадание: 4 дробящего урона.');
    assert.deepEqual([a.hit, a.dmg, a.type], ['+3', '4', 'дробящего']);
    const b = read('Укус. Бросок атаки: +2. Попадание: 3 Колющего урона.');
    assert.deepEqual([b.hit, b.dmg, b.type], ['+2', '3', 'колющего']);
    assert.deepEqual(read('Melee Weapon Attack: +2 to hit. Hit: 1 piercing damage.').dmg, '1');
  });
  it('reads a minus printed as a minus sign or an en dash', () => {
    assert.equal(read('Melee Weapon Attack: –1 to hit, reach 5 ft. Hit: 1 piercing damage.').hit, '-1');
    assert.equal(read('Melee Weapon Attack: −1 to hit, reach 5 ft. Hit: 1 piercing damage.').hit, '-1');
  });
  it('leaves out an action with no attack roll', () => {
    assert.equal(read('The goblin makes two attacks.'), undefined);
    assert.equal(read('Гоблин совершает две атаки Скимитаром.'), undefined);
  });
  it('puts every attack on a line of its own', () => {
    const sb = { secs: { Actions: [
      { n: 'Scimitar', t: 'Melee Weapon Attack: +4 to hit. Hit: 5 (1d6 + 2) slashing damage.' },
      { n: 'Multiattack', t: 'The goblin makes two attacks.' },
      { n: 'Shortbow', t: 'Ranged Weapon Attack: +4 to hit. Hit: 5 (1d6 + 2) piercing damage.' }] } };
    assert.equal(combatAttackLine(sb), 'Scimitar +4 5 slashing\nShortbow +4 5 piercing');
    assert.equal(combatAttackLine({ secs: {} }), '');
    assert.equal(combatAttackLine(undefined), '');
  });
});
