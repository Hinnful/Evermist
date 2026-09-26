'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { combatDamageType, combatAttacks, combatAttackLine } = require('../src/combat/attackLine.js');

// Action text as the parser and the book import produce it (test/statBlockParse.test.js and
// test/statBlockBook.test.js carry the same lines).
const read = t => combatAttacks({ secs: { Actions: [{ n: 'A', t }] } })[0];
const pills = acts => combatAttacks({ secs: { Actions: acts.map(([n, t]) => ({ n, t })) } });
const brief = a => a.fallback ? 'MULTI' : `${a.x ? a.x + '× ' : ''}${a.n} ${a.hit} ${a.parts.map(p => p.dmg + ' ' + p.type).join(' + ')}`;

describe('damage types', () => {
  it('reads English and every Russian case as one key', () => {
    assert.equal(combatDamageType('Slashing'), 'slashing');
    for (const w of ['рубящего', 'Рубящий', 'рубящий']) assert.equal(combatDamageType(w), 'slashing');
    assert.equal(combatDamageType('огнём'), 'fire');
    assert.equal(combatDamageType('Огнем'), 'fire');
    assert.equal(combatDamageType('холодом'), 'cold');
    assert.equal(combatDamageType('Силового'), 'force');
    assert.equal(combatDamageType('Силой'), 'force');
    assert.equal(combatDamageType('Режущего'), 'slashing');
    assert.equal(combatDamageType('электричеством'), 'lightning');
    assert.equal(combatDamageType('некротической'), 'necrotic');
    assert.equal(combatDamageType('ядом'), 'poison');
    assert.equal(combatDamageType('психической'), 'psychic');
    assert.equal(combatDamageType('излучением'), 'radiant');
    assert.equal(combatDamageType('звуком'), 'thunder');
  });
  it('never guesses at a word it does not know', () => {
    assert.equal(combatDamageType('bludgeonin'), '');
    assert.equal(combatDamageType('энергией'), '');
  });
});

describe('an attack pill', () => {
  it('reads an English 2014 attack', () => {
    assert.deepEqual(read('Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage.'),
      { n: 'A', t: 'Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage.',
        hit: '+4', parts: [{ dmg: '5', type: 'slashing' }], rc: '', grab: '', x: 0 });
  });
  it('leaves out damage that holds only under a condition', () => {
    const a = read('Melee Attack Roll: +4, reach 5 ft. Hit: 5 (1d6 + 2) Slashing damage, plus 2 (1d4) Slashing damage if the attack roll had Advantage.');
    assert.deepEqual([a.hit, a.parts], ['+4', [{ dmg: '5', type: 'slashing' }]]);
  });
  it('reads two damage types joined by plus', () => {
    assert.equal(brief(read('Melee Weapon Attack: +10 to hit, reach 10 ft. Hit: 17 (2d10 + 6) piercing damage plus 3 (1d6) fire damage.')),
      'A +10 17 piercing + 3 fire');
    assert.equal(brief(read('Рукопашная атака оружием: +14 к попаданию, досягаемость 10 футов, одна цель. Попадание: Колющий урон 19 (2к10 + 8) плюс урон огнём 7 (2к6).')),
      'A +14 19 piercing + 7 fire');
    assert.equal(brief(read('Рукопашная атака оружием: +9 к попаданию. Попадание: Колющий урон 7 (1к6+4) плюс урон некротической энергией 10 (3к6). Максимум хитов цели уменьшается.')),
      'A +9 7 piercing + 10 necrotic');
    assert.equal(brief(read('Бросок атаки в ближнем бою: +7. Попадание: 10 (1d12 + 4) Режущего урона, и ещё 10 (3d6) урона Громом цели или другому существу в пределах 5 футов от цели.')),
      'A +7 10 slashing + 10 thunder');
  });
  it('joins the part after an alternative set off by dashes', () => {
    assert.equal(brief(read('Melee Attack Roll: +5. Hit: 7 (1d8 + 3) Piercing damage—or 12 (2d8 + 3) Piercing damage if the target is Grappled—plus 4 (1d8) Acid damage.')),
      'A +5 7 piercing + 4 acid');
    assert.equal(brief(read('Бросок атаки в ближнем бою: +6. Попадание: 8 (1d8 + 4) Колющего урона — или 6 (1d4 + 4) Колющего урона, если стая Окровавлена — плюс 10 (3d6) урона Ядом.')),
      'A +6 8 piercing + 10 poison');
  });
  it('shows a versatile weapon one-handed', () => {
    assert.equal(brief(read('Melee Weapon Attack: +6 to hit. Hit: 8 (1d8 + 4) slashing damage, or 9 (1d10 + 4) slashing damage if used with two hands.')),
      'A +6 8 slashing');
    assert.equal(brief(read('Melee Weapon Attack: +3 to hit. Hit: 4 (1d6 + 1) bludgeoning damage or 5 (1d8 + 1) bludgeoning damage if used with two hands. Once per turn, it deals an additional 10 (3d6) necrotic damage.')),
      'A +3 4 bludgeoning');
  });
  it('reads Russian dnd.su and 2024 lines', () => {
    assert.equal(brief(read('Рукопашная атака оружием: +4 к попаданию. Попадание: 5 (1к6 + 2) рубящего урона.')), 'A +4 5 slashing');
    assert.equal(brief(read('Бросок атаки в ближнем бою: +6, зона досягаемости 5 футов. Попадание: 9 (1d10 + 4) Колющего урона Силой.')), 'A +6 9 piercing');
    assert.equal(brief(read('Рукопашная атака заклинанием: +12 к попаданию. Попадание: Урон холодом 10 (3к6).')), 'A +12 10 cold');
    assert.equal(brief(read('Бросок рукопашной атаки: +12, досягаемость 5 фт. Попадание: 15 (3к6 + 5) урона Холодом, и цель Парализована.')), 'A +12 15 cold');
  });
  it('reads flat damage with no dice', () => {
    assert.equal(brief(read('Удар. Рукопашная атака оружием: +3 к попаданию. Попадание: 4 дробящего урона.')), 'A +3 4 bludgeoning');
    assert.equal(brief(read('Melee Weapon Attack: +2 to hit. Hit: 1 piercing damage.')), 'A +2 1 piercing');
  });
  it('keeps a hit whose type it cannot read, without a type', () => {
    assert.deepEqual(read('Melee Weapon Attack: +2 to hit. Hit: 3 (1d6) sonic damage.').parts, [{ dmg: '3', type: '' }]);
    assert.deepEqual(read('Бросок атаки: +8. Попадание: 25 (5d6 + 8) типом урона, выбранным культистом: Гром, Огонь.').parts, [{ dmg: '25', type: '' }]);
  });
  it('leaves out a hit that deals no damage', () => {
    assert.equal(read('Бросок рукопашной атаки: +9. Попадание: цель Захвачена (СЛ освобождения 14) одним из шести щупалец.'), undefined);
  });
  it('reads a minus printed as a minus sign or an en dash', () => {
    assert.equal(read('Melee Weapon Attack: –1 to hit, reach 5 ft. Hit: 1 piercing damage.').hit, '-1');
    assert.equal(read('Melee Weapon Attack: −1 to hit, reach 5 ft. Hit: 1 piercing damage.').hit, '-1');
  });
  it('reads a grapple only with its escape DC', () => {
    assert.equal(read('Melee Weapon Attack: +6 to hit. Hit: 13 (2d8 + 4) bludgeoning damage, and the target is grappled (escape DC 16).').grab, '16');
    assert.equal(read('Melee Attack Roll: +6. Hit: 13 (2d8 + 4) Bludgeoning damage. If the target is Large or smaller, it has the Grappled condition (escape DC 14).').grab, '14');
    assert.equal(read('Рукопашная атака оружием: +6 к попаданию. Попадание: 13 (2к8 + 4) дробящего урона, и цель становится схваченной (Сл высвобождения 16).').grab, '16');
    assert.equal(read('Бросок рукопашной атаки: +6. Попадание: 13 (2d8 + 4) Дробящего урона, и цель Захвачена (СЛ освобождения 14).').grab, '14');
    assert.equal(read('Melee Weapon Attack: +6 to hit. Hit: 13 (2d8 + 4) bludgeoning damage, and the target is grappled.').grab, '');
  });
});

describe('a save pill', () => {
  it('reads an English 2014 breath with its recharge', () => {
    const [a] = pills([['Fire Breath (Recharge 5–6)', 'The dragon exhales fire in a 30-foot cone. Each creature in that area must make a DC 17 Dexterity saving throw, taking 56 (16d6) fire damage on a failed save, or half as much damage on a successful one.']]);
    assert.equal(brief(a), 'Fire Breath DC 17 Dex 56 fire');
    assert.equal(a.rc, '5–6');
  });
  it('reads an English 2024 save', () => {
    assert.equal(brief(pills([['Fire Breath (Recharge 5–6)', 'Dexterity Saving Throw: DC 17, each creature in a 60-foot Cone. Failure: 56 (16d6) Fire damage. Success: Half damage.']])[0]),
      'Fire Breath DC 17 Dex 56 fire');
  });
  it('reads Russian saves', () => {
    const [a] = pills([['Огненное дыхание (перезарядка 5–6)', 'Дракон выдыхает огонь 60-футовым конусом. Все существа в этой области должны совершить спасбросок Ловкости Сл 21, получая урон огнём 63 (18к6) при провале, или половину этого урона при успехе.']]);
    assert.equal(brief(a), 'Огненное дыхание DC 21 Dex 63 fire');
    assert.equal(a.rc, '5–6');
    assert.equal(brief(pills([['Дыхание', 'Спасбросок Ловкости: Сл 17, каждое существо в Конусе 60 фт. Провал: 56 (16к6) урона Огнём. Успех: Половина урона.']])[0]),
      'Дыхание DC 17 Dex 56 fire');
    assert.equal(brief(pills([['Дыхание', 'Испытание\nЛовкости: СЛ 12, каждое существо в 15-футовом Конусе.\nПровал: 17 (5d6) урона Огнём. Успех: половина урона.']])[0]),
      'Дыхание DC 12 Dex 17 fire');
  });
  it('names a ray from its text when the action is named by a die roll', () => {
    assert.equal(brief(pills([['4', 'Луч замедления. Испытание Выносливости: СЛ 16. Провал: 18 (4d8) Некротического урона.']])[0]),
      'Луч замедления DC 16 Con 18 necrotic');
  });
  it('leaves out an action with no damage', () => {
    assert.deepEqual(pills([['Frightful Presence', 'Each creature of the dragon\'s choice within 120 feet must succeed on a DC 19 Wisdom saving throw or become frightened for 1 minute.']]), []);
    assert.deepEqual(pills([['Spellcasting', 'The lich casts one of the following spells (spell save DC 20): Fireball, Lightning Bolt.']]), []);
  });
  it('leaves out an action with no attack roll or save', () => {
    assert.equal(read('The goblin makes two attacks.'), undefined);
  });
});

describe('Multiattack', () => {
  const bite = ['Bite', 'Melee Weapon Attack: +14 to hit. Hit: 19 (2d10 + 8) piercing damage plus 7 (2d6) fire damage.'];
  const claw = ['Claw', 'Melee Weapon Attack: +14 to hit. Hit: 15 (2d6 + 8) slashing damage.'];
  const tail = ['Tail', 'Melee Weapon Attack: +14 to hit. Hit: 17 (2d8 + 8) bludgeoning damage.'];
  it('counts named attacks and drops its own line', () => {
    assert.deepEqual(pills([['Multiattack', 'The dragon makes three attacks: one with its bite and two with its claws.'], bite, claw, tail]).map(brief),
      ['Bite +14 19 piercing + 7 fire', '2× Claw +14 15 slashing', 'Tail +14 17 bludgeoning']);
  });
  it('keeps the counts past an action it uses first', () => {
    assert.deepEqual(pills([['Multiattack', 'The dragon can use its Frightful Presence. It then makes three attacks: one with its bite and two with its claws.'], bite, claw]).map(brief),
      ['Bite +14 19 piercing + 7 fire', '2× Claw +14 15 slashing']);
  });
  it('counts 2024 wording', () => {
    assert.deepEqual(pills([['Multiattack', 'The owlbear makes two Rend attacks.'], ['Rend', 'Melee Attack Roll: +7, reach 5 ft. Hit: 14 (2d8 + 5) Slashing damage.']]).map(brief),
      ['2× Rend +7 14 slashing']);
    assert.deepEqual(pills([['Multiattack', 'The mage makes three Arcane Burst attacks.'], ['Arcane Burst', 'Melee or Ranged Attack Roll: +6. Hit: 16 (3d8 + 3) Force damage.']]).map(brief),
      ['3× Arcane Burst +6 16 force']);
  });
  it('gives an unnamed total to the only attack', () => {
    assert.deepEqual(pills([['Multiattack', 'The goblin makes two melee attacks.'], ['Goat Staff', 'Melee Weapon Attack: +3 to hit. Hit: 4 (1d6 + 1) bludgeoning damage.']]).map(brief),
      ['2× Goat Staff +3 4 bludgeoning']);
  });
  it('counts Russian wording by stem', () => {
    assert.deepEqual(pills([['Мультиатака', 'Дракон может использовать Ужасающее присутствие. Затем он совершает три атаки: одну укусом, и две когтями.'],
      ['Укус', 'Рукопашная атака оружием: +14 к попаданию. Попадание: Колющий урон 19 (2к10 + 8) плюс урон огнём 7 (2к6).'],
      ['Коготь', 'Рукопашная атака оружием: +14 к попаданию. Попадание: Рубящий урон 15 (2к6 + 8).']]).map(brief),
    ['Укус +14 19 piercing + 7 fire', '2× Коготь +14 15 slashing']);
    assert.deepEqual(pills([['Мультиатака', 'Гоблин совершает две атаки Скимитаром.'],
      ['Скимитар', 'Рукопашная атака оружием: +4 к попаданию. Попадание: 5 (1к6 + 2) рубящего урона.']]).map(brief),
    ['2× Скимитар +4 5 slashing']);
    const paw = ['Лапа', 'Бросок атаки в ближнем бою: +6. Попадание: 8 (1d6 + 3) Режущего урона.'];
    assert.deepEqual(pills([['Мультиатака', 'Зорн совершает одну атаку Укусом и три атаки Лапой.'],
      ['Укус', 'Бросок атаки в ближнем бою: +6. Попадание: 17 (4d6 + 3) Колющего урона.'], paw]).map(brief),
    ['Укус +6 17 piercing', '3× Лапа +6 8 slashing']);
  });
  it('never reads a number inside a hyphenated name', () => {
    assert.deepEqual(pills([['Мультиатака', 'Три-крины совершают три атаки Псионическим копьём.'],
      ['Псионическое копьё', 'Бросок атаки: +7. Попадание: 18 (3d8 + 5) Психического урона.']]).map(brief),
    ['3× Псионическое копьё +7 18 psychic']);
  });
  it('falls back on a choice, and counts nothing', () => {
    const scim = ['Scimitar', 'Melee Weapon Attack: +5 to hit. Hit: 6 (1d6 + 3) slashing damage.'];
    const dagger = ['Dagger', 'Melee or Ranged Weapon Attack: +5 to hit. Hit: 5 (1d4 + 3) piercing damage.'];
    assert.deepEqual(pills([['Multiattack', 'The captain makes three melee attacks: two with its scimitar and one with its dagger. Or the captain makes two ranged attacks with its daggers.'], scim, dagger]).map(brief),
      ['MULTI', 'Scimitar +5 6 slashing', 'Dagger +5 5 piercing']);
    assert.equal(pills([['Мультиатака', 'Дьявол совершает либо одну атаку Лапами и одну атаку Хвостом, либо две атаки Метанием пламени.'],
      ['Лапы', 'Бросок атаки: +2. Попадание: 5 (2d4) Режущего урона.'], ['Хвост', 'Бросок атаки: +2. Попадание: 3 (1d6) Режущего урона.'],
      ['Метание пламени', 'Бросок атаки: +4. Попадание: 10 (3d6) урона Огнём.']])[0].fallback, true);
  });
  const group = a => `[${a.x ? a.x + '× ' : ''}${a.opts.map(brief).join(' | ')}${a.swap ? ` ⇄ ${a.swap.k} ${a.swap.to}` : ''}]`;
  const burst = ['Потусторонняя вспышка', 'Бросок рукопашной или дальнобойной атаки: +12. Попадание: 31 (4к12 + 5) Силового урона.'];
  const touch = ['Парализующее касание', 'Бросок рукопашной атаки: +12. Попадание: 15 (3к6 + 5) урона Холодом.'];
  it('groups a pick in any combination under one count', () => {
    const got = pills([['Мультиатака', 'Лич совершает три атаки Потусторонней вспышкой или Парализующим касанием в любой комбинации.'], burst, touch]);
    assert.deepEqual(got.map(a => a.group ? group(a) : brief(a)), ['[3× Потусторонняя вспышка +12 31 force | Парализующее касание +12 15 cold]']);
    assert.equal(got[0].t, 'Лич совершает три атаки Потусторонней вспышкой или Парализующим касанием в любой комбинации.');
    assert.deepEqual(pills([['Multiattack', 'The lich makes three attacks, using Eldritch Burst or Paralyzing Touch in any combination.'],
      ['Eldritch Burst', 'Melee or Ranged Attack Roll: +12. Hit: 31 (4d12 + 5) Force damage.'], ['Paralyzing Touch', 'Melee Attack Roll: +12. Hit: 15 (3d6 + 5) Cold damage.']])
      .map(a => a.group ? group(a) : brief(a)), ['[3× Eldritch Burst +12 31 force | Paralyzing Touch +12 15 cold]']);
    assert.deepEqual(pills([['Мультиатака', 'Воитель совершает две атаки либо Двуручным мечом, либо Тяжёлым арбалетом.'],
      ['Двуручный меч', 'Бросок атаки: +5. Попадание: 10 (2d6 + 3) Режущего урона.'], ['Тяжёлый арбалет', 'Бросок атаки: +3. Попадание: 6 (1d10 + 1) Колющего урона.']])
      .map(a => a.group ? group(a) : brief(a)), ['[2× Двуручный меч +5 10 slashing | Тяжёлый арбалет +3 6 piercing]']);
  });
  it('settles two names that share a first word by the second', () => {
    assert.deepEqual(pills([['Мультиатака', 'Джинн совершает три атаки Грозовым клинком или Грозовым разрядом в любой комбинации.'],
      ['Грозовой клинок', 'Бросок атаки: +9. Попадание: 12 (2d6 + 5) Режущего урона.'], ['Грозовой разряд', 'Бросок атаки: +9. Попадание: 13 (3d8 + 5) урона Молнией.']])
      .map(a => a.group ? group(a) : brief(a)), ['[3× Грозовой клинок +9 12 slashing | Грозовой разряд +9 13 lightning]']);
  });
  it('keeps a count with its swap', () => {
    const rend = ['Раздирание', 'Бросок атаки: +7. Попадание: 15 (2d10 + 4) Режущего урона.'];
    const breath = ['Отторгающее дыхание', 'Испытание Силы: СЛ 15, каждое существо в 30-футовом Конусе. Провал: цель отталкивается.'];
    assert.deepEqual(pills([['Мультиатака', 'Дракон совершает три атаки Раздиранием. Он может заменить одну из этих атак на использование Отторгающего дыхания.'], rend, breath])
      .map(a => a.group ? group(a) : brief(a)), ['[3× Раздирание +7 15 slashing ⇄ 1 Отторгающее дыхание]']);
    assert.deepEqual(pills([['Мультиатака', 'Дракон совершает три атаки Раздиранием. Он может заменить одну из этих атак на (А) использование Отторгающего дыхания или (Б) сотворение заклинания Направляющий луч (2-й круг).'], rend])
      .map(a => a.group ? group(a) : brief(a)), ['[3× Раздирание +7 15 slashing ⇄ 1 Отторгающего дыхания or Направляющий луч (2-й круг)]']);
    assert.deepEqual(pills([['Multiattack', 'The dragon makes three Rend attacks. It can replace one attack with a use of Spellcasting.'], ['Rend', 'Melee Attack Roll: +7. Hit: 14 (2d8 + 5) Slashing damage.']])
      .map(a => a.group ? group(a) : brief(a)), ['[3× Rend +7 14 slashing ⇄ 1 Spellcasting]']);
  });
  it('names a swapped-in spell as printed, never as an attack sharing its first letters', () => {
    const rend = ['Раздирание', 'Бросок атаки: +14. Попадание: 13 (2d8 + 4) Режущего урона.'];
    const g = pills([['Мультиатака', 'Дракон совершает три атаки Раздиранием. Он может заменить одну из этих атак на сотворение заклинания Разбивающий звук.'], rend])[0];
    assert.equal(g.swap.to, 'Разбивающий звук');
    const arc = pills([['Мультиатака', 'Арканалот совершает три атаки Вспышкой. Он может заменить одну из этих атак на атаку Изгоняющим когтем.'],
      ['Вспышка', 'Бросок атаки: +9. Попадание: 20 (4d8 + 2) Силового урона.'], ['Изгоняющий коготь (требуется Фолиант душ)', 'Бросок атаки: +9. Попадание: 9 (1d8 + 5) Режущего урона.']]);
    assert.equal(arc.find(a => a.group).swap.to, 'Изгоняющий коготь');
  });
  it('groups a pick with a swap, the options joined by or', () => {
    const got = pills([['Мультиатака', 'Волк-оборотень совершает две атаки Царапаньем или Длинным луком в любой комбинации. Он может заменить одну из этих атак на атаку Укусом.'],
      ['Укус', 'Бросок атаки: +5. Попадание: 12 (2d8 + 3) Колющего урона.'], ['Царапание', 'Бросок атаки: +5. Попадание: 10 (2d6 + 3) Режущего урона.'],
      ['Длинный лук', 'Бросок атаки: +4. Попадание: 11 (2d8 + 2) Колющего урона.']]);
    assert.deepEqual(got.map(a => a.group ? group(a) : brief(a)), ['Укус +5 12 piercing', '[2× Царапание +5 10 slashing | Длинный лук +4 11 piercing ⇄ 1 Укус]']);
    assert.equal(got[1].or, true);
  });
  it('falls back when a name matches nothing or the counts do not add up', () => {
    assert.deepEqual(pills([['Multiattack', 'The beast makes two attacks: one with its bite and one with its tentacles.'], bite]).map(brief),
      ['MULTI', 'Bite +14 19 piercing + 7 fire']);
    assert.deepEqual(pills([['Multiattack', 'The dragon makes three attacks: one with its bite and one with its claws.'], bite, claw]).map(brief),
      ['MULTI', 'Bite +14 19 piercing + 7 fire', 'Claw +14 15 slashing']);
    assert.deepEqual(pills([['Multiattack', 'The dragon makes two attacks.'], bite, claw]).map(brief),
      ['MULTI', 'Bite +14 19 piercing + 7 fire', 'Claw +14 15 slashing']);
  });
  it('matches a whole name over a shared stem, and never a filler word', () => {
    const sword = ['Longsword', 'Melee Weapon Attack: +5 to hit. Hit: 7 (1d8 + 3) slashing damage.'];
    const bow = ['Longbow', 'Ranged Weapon Attack: +3 to hit. Hit: 6 (1d8 + 1) piercing damage.'];
    assert.deepEqual(pills([['Multiattack', 'The knight makes two longsword attacks.'], sword, bow]).map(brief),
      ['2× Longsword +5 7 slashing', 'Longbow +3 6 piercing']);
    const wither = ['Withering Touch', 'Melee Spell Attack: +5 to hit. Hit: 9 (2d6 + 2) necrotic damage.'];
    const claw = ['Claw', 'Melee Weapon Attack: +5 to hit. Hit: 6 (1d6 + 3) slashing damage.'];
    assert.deepEqual(pills([['Multiattack', 'It makes three attacks: two with its claws and one with its withering touch.'], wither, claw]).map(brief),
      ['Withering Touch +5 9 necrotic', '2× Claw +5 6 slashing']);
  });
  it('keeps the fallback pill\'s full text', () => {
    const [m] = pills([['Multiattack', 'Two attacks or one spell.'], bite]);
    assert.deepEqual(m, { n: 'Multiattack', t: 'Two attacks or one spell.', fallback: true });
  });
});

describe('bonus actions', () => {
  it('gives a damaging bonus action a marked pill after the actions, outside the Multiattack count', () => {
    const got = combatAttacks({ secs: {
      Actions: [{ n: 'Мультиатака', t: 'Заражённое растение совершает две атаки Ветвью.' },
        { n: 'Ветвь', t: 'Бросок атаки в ближнем бою: +9, зона досягаемости 15 футов. Попадание: 16 (3d6 + 6) Дробящего урона.' }],
      'Bonus actions': [{ n: 'Щелчок зубами', t: 'Испытание Ловкости: СЛ 17, одно Захваченное существо. Провал: 19 (3d8 + 6) Колющего урона. Успех: половина урона.' },
        { n: 'Шаг', t: 'Растение перемещается на 10 футов.' }] } });
    assert.deepEqual(got.map(a => [brief(a), !!a.ba]), [['2× Ветвь +9 16 bludgeoning', false], ['Щелчок зубами DC 17 Dex 19 piercing', true]]);
  });
});

describe('the plain line', () => {
  it('puts every pill on a line of its own, fallback left out', () => {
    const sb = { secs: { Actions: [
      { n: 'Scimitar', t: 'Melee Weapon Attack: +4 to hit. Hit: 5 (1d6 + 2) slashing damage.' },
      { n: 'Multiattack', t: 'The goblin makes two attacks with its scimitar.' },
      { n: 'Bite', t: 'Melee Weapon Attack: +4 to hit. Hit: 5 (1d6 + 2) piercing damage plus 2 (1d4) fire damage.' }] } };
    assert.equal(combatAttackLine(sb), '2× Scimitar +4 5 slashing\nBite +4 5 piercing + 2 fire');
    assert.equal(combatAttackLine({ secs: {} }), '');
    assert.equal(combatAttackLine(undefined), '');
  });
});
