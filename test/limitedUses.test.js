'use strict';

// Counters on the stat block (BACKLOG 308): a limited ability read off its name, the legendary pool off its section's
// opening sentence, and the crystals' keys. Every sample is written for the test; no book text.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { usesFromName, legendaryPool, usesKeys, LU_POOL_KEY } = require('../src/combat/limitedUses.js');
const { spellcastingRead } = require('../src/combat/spellcasting.js');

const read = n => { const u = usesFromName(n); return u && [u.n, u.kind, u.name]; };

describe('a limited ability read off its name', () => {
  it('reads a count a day in every printed form, either language and edition', () => {
    const cases = [
      ['Сияющий взгляд (2/день)', [2, 'day', 'Сияющий взгляд']],
      ['Сияющий взгляд (2 в день)', [2, 'day', 'Сияющий взгляд']],
      ['Сияющий взгляд (2 / день)', [2, 'day', 'Сияющий взгляд']],
      ['Radiant Gaze (2/Day)', [2, 'day', 'Radiant Gaze']],
      ['Radiant Gaze (2/day)', [2, 'day', 'Radiant Gaze']],
      ['СИЯЮЩИЙ ВЗГЛЯД (2 В ДЕНЬ)', [2, 'day', 'СИЯЮЩИЙ ВЗГЛЯД']],
    ];
    for (const [n, want] of cases) assert.deepEqual(read(n), want, n);
  });

  it('ignores a lair or a domain count after the first', () => {
    assert.deepEqual(read('Легендарная стойкость (3 в день или 4 в день в логове)'), [3, 'day', 'Легендарная стойкость']);
    assert.deepEqual(read('Легендарная стойкость (3/день или 5/день в домене)'), [3, 'day', 'Легендарная стойкость']);
    assert.deepEqual(read('Legendary Resistance (3/Day, or 4/Day in Lair)'), [3, 'day', 'Legendary Resistance']);
  });

  it('reads a bracket with a second clause on either side', () => {
    assert.deepEqual(read('Шёпот теней (1 в день; нужна свеча)'), [1, 'day', 'Шёпот теней']);
    assert.deepEqual(read('Шёпот теней (заклинание 1 уровня; 2/день)'), [2, 'day', 'Шёпот теней']);
  });

  it('reads an after-rest recharge, short when a short rest is named', () => {
    const cases = [
      ['Рывок (Перезаряжается после Короткого или Продолжительного отдыха)', [1, 'shortRest', 'Рывок']],
      ['Рывок (Перезаряжается после Продолжительного отдыха)', [1, 'longRest', 'Рывок']],
      ['Рывок (перезарядка после короткого или долгого отдыха)', [1, 'shortRest', 'Рывок']],
      ['Рывок (Перезарядка после долгого отдыха)', [1, 'longRest', 'Рывок']],
      ['Dash (Recharges after a Short or Long Rest)', [1, 'shortRest', 'Dash']],
      ['Dash (Recharges after a Long Rest)', [1, 'longRest', 'Dash']],
    ];
    for (const [n, want] of cases) assert.deepEqual(read(n), want, n);
  });

  it('keeps the printed bracket for the plate\'s hover', () => {
    assert.equal(usesFromName('Сияющий взгляд (3 в день или 4 в день в логове)').printed, '3 в день или 4 в день в логове');
  });

  it('never reads a recharge roll, a plain name or an empty one', () => {
    for (const n of ['Огненное дыхание (Перезарядка 5–6)', 'Fire Breath (Recharge 5–6)', 'Fire Breath (Recharge 6)',
      'Укус', 'Bite (Melee)', 'Отдых на привале', '', null, undefined, 'Взгляд (0/день)']) assert.equal(usesFromName(n), null, String(n));
  });

  it('leaves a spellcasting entry the spell reader takes whole to the spells', () => {
    const n = 'Врождённое колдовство (1/день)', t = 'Дух сотворяет заклинание.\n1 в день: Полёт';
    assert.ok(spellcastingRead(n, t), 'the spell reader reads it, so the page shows its spell rows and no counter');
  });
});

describe('the legendary action pool', () => {
  it('reads the count from the opening sentence, 2014 and 2024, Russian and English', () => {
    const cases = [
      ['Использования легендарных действий: 3 (4 в логове). Сразу после хода другого существа зверь тратит одно.', 3],
      ['Legendary Action Uses: 3 (4 in Lair). Immediately after another creature\'s turn, the beast can expend a use.', 3],
      ['Зверь может совершить 3 легендарных действия, выбирая из вариантов ниже.', 3],
      ['Зверь может выполнить 2 легендарных действия, выбрав один из вариантов ниже.', 2],
      ['The beast can take 3 legendary actions, choosing from the options below.', 3],
    ];
    for (const [s, n] of cases) assert.equal(legendaryPool(s), n, s);
  });

  it('answers null for an opening with no count', () => {
    for (const s of ['Зверь может совершать легендарные действия.', '', null]) assert.equal(legendaryPool(s), null);
  });
});

describe('the crystals\' keys', () => {
  it('names each counter by its stripped name, a repeat by its index, and the pool apart', () => {
    assert.deepEqual(usesKeys(['Рывок', 'Взгляд', 'рывок']), ['use|рывок', 'use|взгляд', 'use|рывок:2']);
    assert.equal(LU_POOL_KEY, 'legendary');
    assert.ok(!usesKeys([LU_POOL_KEY]).includes(LU_POOL_KEY), 'a counter named like the pool never shares its key');
  });
});
