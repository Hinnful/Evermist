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
  it('leaves out a hit that deals no damage, unless it grapples', () => {
    assert.equal(read('Melee Weapon Attack: +5 to hit. Hit: The target is poisoned until the end of its next turn.'), undefined);
    const g = read('Бросок рукопашной атаки: +9. Попадание: цель Захвачена (СЛ освобождения 14) одним из шести щупалец.');
    assert.deepEqual([g.hit, g.parts, g.grab], ['+9', [], '14']);
    assert.equal(read('Рукопашная атака оружием: +9 к попаданию, одно существо. Существо захвачено (вырваться Сл 15). Пока оно не вырвалось, оно получает 9 (1к6+6) дробящего урона в начале каждого хода.').grab, '15');
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
  it('reads a recharge after a rest', () => {
    const [a] = pills([['Проклятие (Перезаряжается после Продолжительного отдыха)', 'Испытание Мудрости: СЛ 14. Провал: 6 (1d12) Психического урона.']]);
    assert.deepEqual([a.n, a.rc], ['Проклятие', 'Long rest']);
    assert.equal(pills([['Curse (Recharges after a Short or Long Rest)', 'Wisdom Saving Throw: DC 14. Failure: 6 (1d12) Psychic damage.']])[0].rc, 'Short rest');
  });
  it('reads uses per day as a recharge', () => {
    const [a] = pills([['Смертельный вой (1 в день)', 'Испытание Выносливости: СЛ 13. Провал: 10 (3d6) Психического урона.']]);
    assert.deepEqual([a.n, a.rc], ['Смертельный вой', '1/day']);
    assert.equal(pills([['Stunning Screech (1/Day)', 'Constitution Saving Throw: DC 14. Failure: 10 (3d6) Thunder damage.']])[0].rc, '1/day');
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
  const group = a => a.alts ? `[${a.alts.map(alt => alt.map(brief).join(' + ')).join(' OR ')}]`
    : `[${a.x ? a.x + '× ' : ''}${a.opts.map(brief).join(a.or ? ' | ' : ' + ')}${a.swap ? ` ⇄ ${a.swap.k} ${a.swap.to}` : ''}]`;
  const show = acts => pills(acts).map(a => a.group ? group(a) : (a.ba ? 'Bonus ' : '') + brief(a));
  it('frames named counts as one action and drops its own line', () => {
    assert.deepEqual(show([['Multiattack', 'The dragon makes three attacks: one with its bite and two with its claws.'], bite, claw, tail]),
      ['[Bite +14 19 piercing + 7 fire + 2× Claw +14 15 slashing]', 'Tail +14 17 bludgeoning']);
  });
  it('keeps the counts past a step that deals no damage', () => {
    assert.deepEqual(show([['Multiattack', 'The dragon can use its Frightful Presence. It then makes three attacks: one with its bite and two with its claws.'], bite, claw]),
      ['[Bite +14 19 piercing + 7 fire + 2× Claw +14 15 slashing]']);
  });
  it('puts one attack\'s count on the frame', () => {
    assert.deepEqual(show([['Multiattack', 'The owlbear makes two Rend attacks.'], ['Rend', 'Melee Attack Roll: +7, reach 5 ft. Hit: 14 (2d8 + 5) Slashing damage.']]),
      ['[2× Rend +7 14 slashing]']);
    assert.deepEqual(show([['Multiattack', 'The mage makes three Arcane Burst attacks.'], ['Arcane Burst', 'Melee or Ranged Attack Roll: +6. Hit: 16 (3d8 + 3) Force damage.']]),
      ['[3× Arcane Burst +6 16 force]']);
    assert.deepEqual(show([['Multiattack', 'The panther makes one Pounce attack and uses Prowl.'], ['Pounce', 'Melee Attack Roll: +6. Hit: 7 (1d6 + 4) Slashing damage.']]),
      ['[Pounce +6 7 slashing]']);
  });
  it('gives an unnamed total to the only attack, or the only melee one', () => {
    assert.deepEqual(show([['Multiattack', 'The goblin makes two melee attacks.'], ['Goat Staff', 'Melee Weapon Attack: +3 to hit. Hit: 4 (1d6 + 1) bludgeoning damage.']]),
      ['[2× Goat Staff +3 4 bludgeoning]']);
    assert.deepEqual(show([['Multiattack', 'The knight makes two melee attacks.'], ['Greatsword', 'Melee Weapon Attack: +5 to hit. Hit: 10 (2d6 + 3) slashing damage.'],
      ['Heavy Crossbow', 'Ranged Weapon Attack: +2 to hit. Hit: 5 (1d10) piercing damage.']]),
    ['[2× Greatsword +5 10 slashing]', 'Heavy Crossbow +2 5 piercing']);
  });
  it('counts Russian wording by stem', () => {
    assert.deepEqual(show([['Мультиатака', 'Дракон может использовать Ужасающее присутствие. Затем он совершает три атаки: одну укусом, и две когтями.'],
      ['Укус', 'Рукопашная атака оружием: +14 к попаданию. Попадание: Колющий урон 19 (2к10 + 8) плюс урон огнём 7 (2к6).'],
      ['Коготь', 'Рукопашная атака оружием: +14 к попаданию. Попадание: Рубящий урон 15 (2к6 + 8).']]),
    ['[Укус +14 19 piercing + 7 fire + 2× Коготь +14 15 slashing]']);
    const paw = ['Лапа', 'Бросок атаки в ближнем бою: +6. Попадание: 8 (1d6 + 3) Режущего урона.'];
    assert.deepEqual(show([['Мультиатака', 'Зорн совершает одну атаку Укусом и три атаки Лапой.'],
      ['Укус', 'Бросок атаки в ближнем бою: +6. Попадание: 17 (4d6 + 3) Колющего урона.'], paw]),
    ['[Укус +6 17 piercing + 3× Лапа +6 8 slashing]']);
  });
  it('never reads a number inside a hyphenated name', () => {
    assert.deepEqual(show([['Мультиатака', 'Три-крины совершают три атаки Псионическим копьём.'],
      ['Псионическое копьё', 'Бросок атаки: +7. Попадание: 18 (3d8 + 5) Психического урона.']]),
    ['[3× Псионическое копьё +7 18 psychic]']);
  });
  it('matches a name by a later word when the book prints another first one', () => {
    assert.deepEqual(show([['Мультиатака', 'Исчадие совершает одну атаку Укусом и одну атаку Пылающей булавой.'],
      ['Укус', 'Бросок атаки: +4. Попадание: 5 (1d6 + 2) Колющего урона.'], ['Огненная булава', 'Бросок атаки: +4. Попадание: 6 (1d8 + 2) урона Огнём.']]),
    ['[Укус +4 5 piercing + Огненная булава +4 6 fire]']);
  });
  it('names a one-word action over a longer one sharing its first word', () => {
    assert.deepEqual(show([['Multiattack', 'The otyugh makes three attacks: one with its bite and two with its tentacles.'], bite,
      ['Tentacle', 'Melee Weapon Attack: +6 to hit. Hit: 7 (1d8 + 3) bludgeoning damage.'], ['Tentacle Slam', 'Melee Weapon Attack: +6 to hit. Hit: 10 (2d6 + 3) bludgeoning damage.']]),
    ['[Bite +14 19 piercing + 7 fire + 2× Tentacle +6 7 bludgeoning]', 'Tentacle Slam +6 10 bludgeoning']);
  });
  it('matches a whole name over a shared stem, and never a filler word', () => {
    const sword = ['Longsword', 'Melee Weapon Attack: +5 to hit. Hit: 7 (1d8 + 3) slashing damage.'];
    const bow = ['Longbow', 'Ranged Weapon Attack: +3 to hit. Hit: 6 (1d8 + 1) piercing damage.'];
    assert.deepEqual(show([['Multiattack', 'The knight makes two longsword attacks.'], sword, bow]),
      ['[2× Longsword +5 7 slashing]', 'Longbow +3 6 piercing']);
    const wither = ['Withering Touch', 'Melee Spell Attack: +5 to hit. Hit: 9 (2d6 + 2) necrotic damage.'];
    const claw = ['Claw', 'Melee Weapon Attack: +5 to hit. Hit: 6 (1d6 + 3) slashing damage.'];
    assert.deepEqual(show([['Multiattack', 'It makes three attacks: two with its claws and one with its withering touch.'], wither, claw]),
      ['[Withering Touch +5 9 necrotic + 2× Claw +5 6 slashing]']);
  });
  const burst = ['Потусторонняя вспышка', 'Бросок рукопашной или дальнобойной атаки: +12. Попадание: 31 (4к12 + 5) Силового урона.'];
  const touch = ['Парализующее касание', 'Бросок рукопашной атаки: +12. Попадание: 15 (3к6 + 5) урона Холодом.'];
  it('groups a pick in any combination under one count', () => {
    const got = pills([['Мультиатака', 'Лич совершает три атаки Потусторонней вспышкой или Парализующим касанием в любой комбинации.'], burst, touch]);
    assert.deepEqual(got.map(group), ['[3× Потусторонняя вспышка +12 31 force | Парализующее касание +12 15 cold]']);
    assert.equal(got[0].t, 'Лич совершает три атаки Потусторонней вспышкой или Парализующим касанием в любой комбинации.');
    assert.deepEqual(show([['Multiattack', 'The lich makes three attacks, using Eldritch Burst or Paralyzing Touch in any combination.'],
      ['Eldritch Burst', 'Melee or Ranged Attack Roll: +12. Hit: 31 (4d12 + 5) Force damage.'], ['Paralyzing Touch', 'Melee Attack Roll: +12. Hit: 15 (3d6 + 5) Cold damage.']]),
    ['[3× Eldritch Burst +12 31 force | Paralyzing Touch +12 15 cold]']);
    assert.deepEqual(show([['Мультиатака', 'Воитель совершает две атаки либо Двуручным мечом, либо Тяжёлым арбалетом.'],
      ['Двуручный меч', 'Бросок атаки: +5. Попадание: 10 (2d6 + 3) Режущего урона.'], ['Тяжёлый арбалет', 'Бросок атаки: +3. Попадание: 6 (1d10 + 1) Колющего урона.']]),
    ['[2× Двуручный меч +5 10 slashing | Тяжёлый арбалет +3 6 piercing]']);
  });
  it('reads one count over two joined names as a pick', () => {
    const sword = ['Короткий меч', 'Бросок атаки: +4. Попадание: 5 (1d6 + 2) Колющего урона.'];
    const bow = ['Длинный лук', 'Бросок атаки: +4. Попадание: 6 (1d8 + 2) Колющего урона.'];
    assert.deepEqual(show([['Мультиатака', 'Разведчик совершает две атаки Коротким мечом и Длинным луком в любой комбинации.'], sword, bow]),
      ['[2× Короткий меч +4 5 piercing | Длинный лук +4 6 piercing]']);
    assert.deepEqual(show([['Мультиатака', 'Разведчик совершает одну атаку Коротким мечом и одну атаку Длинным луком.'], sword, bow]),
      ['[Короткий меч +4 5 piercing + Длинный лук +4 6 piercing]']);
  });
  it('settles two names that share a first word by the second', () => {
    assert.deepEqual(show([['Мультиатака', 'Джинн совершает три атаки Грозовым клинком или Грозовым разрядом в любой комбинации.'],
      ['Грозовой клинок', 'Бросок атаки: +9. Попадание: 12 (2d6 + 5) Режущего урона.'], ['Грозовой разряд', 'Бросок атаки: +9. Попадание: 13 (3d8 + 5) урона Молнией.'],
      ['Грозовая буря', 'Испытание Ловкости: СЛ 17. Провал: 20 (6d6) урона Молнией.']]),
    ['[3× Грозовой клинок +9 12 slashing | Грозовой разряд +9 13 lightning]', 'Грозовая буря DC 17 Dex 20 lightning']);
  });
  it('keeps a count with its swap', () => {
    const rend = ['Раздирание', 'Бросок атаки: +7. Попадание: 15 (2d10 + 4) Режущего урона.'];
    const breath = ['Отторгающее дыхание', 'Испытание Силы: СЛ 15, каждое существо в 30-футовом Конусе. Провал: цель отталкивается.'];
    assert.deepEqual(show([['Мультиатака', 'Дракон совершает три атаки Раздиранием. Он может заменить одну из этих атак на использование Отторгающего дыхания.'], rend, breath]),
      ['[3× Раздирание +7 15 slashing ⇄ 1 Отторгающее дыхание]']);
    assert.deepEqual(show([['Мультиатака', 'Дракон совершает три атаки Раздиранием. Он может заменить одну из этих атак на (А) использование Отторгающего дыхания или (Б) сотворение заклинания Направляющий луч (2-й круг).'], rend]),
      ['[3× Раздирание +7 15 slashing ⇄ 1 Отторгающего дыхания or Направляющий луч (2-й круг)]']);
    assert.deepEqual(show([['Multiattack', 'The dragon makes three Rend attacks. It can replace one attack with a use of Spellcasting.'], ['Rend', 'Melee Attack Roll: +7. Hit: 14 (2d8 + 5) Slashing damage.']]),
      ['[3× Rend +7 14 slashing ⇄ 1 Spellcasting]']);
  });
  it('reads every wording of a swap', () => {
    const root = ['Корень', 'Бросок атаки: +12. Попадание: 30 (4d10 + 8) Дробящего урона.'];
    const stone = ['Камень', 'Бросок атаки: +12. Попадание: 21 (3d8 + 8) Дробящего урона.'];
    assert.deepEqual(show([['Мультиатака', 'Изба совершает три атаки корнями. Одна из них может быть заменена на атаку камнем.'], root, stone]),
      ['[3× Корень +12 30 bludgeoning ⇄ 1 Камень]', 'Камень +12 21 bludgeoning']);
    const ram = ['Таран', 'Бросок атаки: +7. Попадание: 10 (1d12 + 4) Дробящего урона.'];
    const paw = ['Лапа', 'Бросок атаки: +7. Попадание: 7 (1d6 + 4) Режущего урона.'];
    const fire = ['Огненное дыхание (перезарядка 5–6)', 'Испытание Ловкости: СЛ 15. Провал: 31 (7d8) урона Огнём.'];
    assert.deepEqual(show([['Мультиатака', 'Химера совершает одну атаку Тараном и одну атаку Лапой. Она может заменить атаку Лапой на использование Огненного дыхания, если оно доступно.'], ram, paw, fire]),
      ['[Таран +7 10 bludgeoning + Лапа +7 7 slashing ⇄ 1 Огненное дыхание]', 'Огненное дыхание DC 15 Dex 31 fire']);
    const fork = ['Fork', 'Melee Weapon Attack: +10 to hit. Hit: 15 (2d8 + 6) piercing damage.'];
    const flame = ['Hurl Flame', 'Ranged Spell Attack: +7 to hit. Hit: 14 (4d6) fire damage.'];
    assert.deepEqual(show([['Multiattack', 'The devil makes two melee attacks with its fork. It can use Hurl Flame in place of any melee attack.'], fork, flame]),
      ['[2× Fork +10 15 piercing ⇄ any Hurl Flame]', 'Hurl Flame +7 14 fire']);
  });
  it('reads "only one of which" as a swap, the count kept off the swapped attack', () => {
    const strike = ['Unarmed Strike', 'Melee Weapon Attack: +9 to hit. Hit: 8 (1d8 + 4) bludgeoning damage.'];
    const vbite = ['Bite', 'Melee Weapon Attack: +9 to hit. Hit: 7 (1d6 + 4) piercing damage plus 10 (3d6) necrotic damage.'];
    assert.deepEqual(show([['Multiattack', 'The vampire makes two attacks, only one of which can be a bite attack.'], strike, vbite]),
      ['[2× Unarmed Strike +9 8 bludgeoning ⇄ 1 Bite]', 'Bite +9 7 piercing + 10 necrotic']);
    assert.deepEqual(show([['Мультиатака', 'Страд совершает две атаки, только одна из которых может быть укусом.'],
      ['Безоружный удар', 'Рукопашная атака оружием: +9 к попаданию. Попадание: Рубящий урон 8 (1к8 + 4).'], ['Укус', 'Рукопашная атака оружием: +9 к попаданию. Попадание: Колющий урон 7 (1к6 + 4).']]),
    ['[2× Безоружный удар +9 8 slashing ⇄ 1 Укус]', 'Укус +9 7 piercing']);
  });
  it('reads two full alternatives as one frame', () => {
    const hammer = ['Земляной молот', 'Бросок атаки: +10. Попадание: 20 (3d10 + 4) Дробящего урона.'];
    const blast = ['Взрыв земли', 'Бросок атаки: +10. Попадание: 15 (2d10 + 4) Дробящего урона.'];
    assert.deepEqual(show([['Мультиатака', 'Дао совершает либо три атаки Земляным молотом, либо две атаки Взрывом земли.'], hammer, blast]),
      ['[3× Земляной молот +10 20 bludgeoning OR 2× Взрыв земли +10 15 bludgeoning]']);
    const scim = ['Scimitar', 'Melee Weapon Attack: +5 to hit. Hit: 6 (1d6 + 3) slashing damage.'];
    const dagger = ['Dagger', 'Melee or Ranged Weapon Attack: +5 to hit. Hit: 5 (1d4 + 3) piercing damage.'];
    assert.deepEqual(show([['Multiattack', 'The captain makes three melee attacks: two with its scimitar and one with its dagger. Or the captain makes two ranged attacks with its daggers.'], scim, dagger]),
      ['[2× Scimitar +5 6 slashing + Dagger +5 5 piercing OR 2× Dagger +5 5 piercing]']);
    assert.deepEqual(show([['Multiattack', 'The captain makes either three melee attacks--two with its scimitar and one with its dagger--or two attacks with its dagger.'], scim, dagger]),
      ['[2× Scimitar +5 6 slashing + Dagger +5 5 piercing OR 2× Dagger +5 5 piercing]']);
    const sword = ['Сияющий меч', 'Бросок атаки: +12. Попадание: 14 (2d6 + 7) Режущего урона.'];
    const holy = ['Святая вспышка', 'Испытание Ловкости: СЛ 20. Провал: 24 (7d6) урона Излучением.'];
    assert.deepEqual(show([['Мультиатака', 'Планетар совершает три атаки Сияющим мечом или дважды использует Святую вспышку.'], sword, holy]),
      ['[3× Сияющий меч +12 14 slashing OR 2× Святая вспышка DC 20 Dex 24 radiant]']);
  });
  it('reads rays used N times as a pick of the rays listed under them', () => {
    assert.deepEqual(show([['Мультиатака', 'Бехолдер использует Лучи из глаз трижды.'], ['Укус', 'Бросок атаки: +8. Попадание: 13 (4d6) Колющего урона.'],
      ['Лучи из глаз', 'Бехолдер испускает три луча.'],
      ['1', 'Луч ужаса. Испытание Мудрости: СЛ 16. Провал: 14 (4d6) Психического урона.'],
      ['2', 'Луч смерти. Испытание Ловкости: СЛ 16. Провал: 55 (10d10) Некротического урона.']]),
    ['Укус +8 13 piercing', '[3× Луч ужаса DC 16 Wis 14 psychic | Луч смерти DC 16 Dex 55 necrotic]']);
  });
  it('moves the attack a bonus-action sentence names out of the frame, tagged Bonus', () => {
    assert.deepEqual(show([['Мультиатака', 'Зараза совершает четыре атаки: две своими ветвями и две с помощью опутывающих корней. Если ей удается захватить цель, то Зараза совершает по ней атаку укусом за бонусное действие.'],
      ['Укус', 'Рукопашная атака оружием: +9 к попаданию. Попадание: 19 (3к8 + 6) колющий урон.'],
      ['Ветвь', 'Рукопашная атака оружием: +9 к попаданию. Попадание: 16 (3к6 + 6) дробящий урон.'],
      ['Опутывающие корни', 'Рукопашная атака оружием: +9 к попаданию, одно существо. Существо захвачено (вырваться Сл 15).']]),
    ['[2× Ветвь +9 16 bludgeoning + 2× Опутывающие корни +9 ]', 'Bonus Укус +9 19 piercing']);
  });
  it('falls back on what a frame cannot say', () => {
    const fb = (t, acts) => pills([['Multiattack', t], ...acts])[0].fallback;
    assert.equal(fb('The golem makes two slam attacks, or three if it used Haste this turn.', [claw]), true);
    assert.equal(fb('The aboleth makes two Claw attacks and uses Tail.', [claw, tail]), true);
    assert.equal(fb('The dryad makes one Claw attack and can cast Charm Monster.', [claw]), true);
    assert.equal(fb('The hydra makes as many Bite attacks as it has heads.', [bite]), true);
    assert.equal(fb('The fungus makes 1d4 Claw attacks.', [claw]), true);
    assert.equal(fb('In hybrid form, the weretiger makes two Claw attacks.', [claw]), true);
    assert.equal(fb('The merrow makes two attacks: one with its bite and one with its claw or tail.', [bite, claw, tail]), true);
    assert.equal(pills([['Мультиатака', 'Эсмеральда совершает три атаки: две своей рапирой и одну своим топором или своим мечом.'],
      ['Рапира', 'Бросок атаки: +8. Попадание: 9 (1d8 + 5) Колющего урона.'], ['Топор', 'Бросок атаки: +6. Попадание: 6 (1d6 + 3) Режущего урона.'],
      ['Меч', 'Бросок атаки: +7. Попадание: 7 (1d6 + 4) Колющего урона.']])[0].fallback, true);
    assert.equal(pills([['Мультиатака', 'Дьявол совершает либо одну атаку Лапами и одну атаку Хвостом, либо две атаки Метанием пламени.'],
      ['Лапы', 'Бросок атаки: +2. Попадание: 5 (2d4) Режущего урона.'], ['Хвост', 'Бросок атаки: +2. Попадание: 3 (1d6) Режущего урона.'],
      ['Метание пламени', 'Бросок атаки: +4. Попадание: 10 (3d6) урона Огнём.']])[0].group, true);
  });
  it('falls back when a name matches nothing or the counts do not add up', () => {
    assert.deepEqual(show([['Multiattack', 'The beast makes two attacks: one with its bite and one with its tentacles.'], bite]),
      ['MULTI', 'Bite +14 19 piercing + 7 fire']);
    assert.deepEqual(show([['Multiattack', 'The dragon makes three attacks: one with its bite and one with its claws.'], bite, claw]),
      ['MULTI', 'Bite +14 19 piercing + 7 fire', 'Claw +14 15 slashing']);
    assert.deepEqual(show([['Multiattack', 'The dragon makes two attacks.'], bite, claw]),
      ['MULTI', 'Bite +14 19 piercing + 7 fire', 'Claw +14 15 slashing']);
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
    assert.deepEqual(got.map(a => [a.group ? `${a.x}× ${a.opts.map(brief)}` : brief(a), !!a.ba]), [['2× Ветвь +9 16 bludgeoning', false], ['Щелчок зубами DC 17 Dex 19 piercing', true]]);
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

describe('combatAttacks on 2014 wording', () => {
  it('reads a damage type followed by an aside in brackets', () => {
    const [a] = combatAttacks({ secs: { Actions: [{ n: 'Коготь', t: 'Рукопашная атака оружием: +3 к попаданию. Попадание: Дробящий или рубящий (на выбор руки) урон 3 (1к4+1).' }] } });
    assert.deepEqual(a.parts, [{ dmg: '3', type: 'slashing' }]);
  });
  it('gives each breath the recharge its Breath Weapons entry carries', () => {
    const at = combatAttacks({ secs: { Actions: [
      { n: 'Оружия дыхания (перезарядка 5–6)', t: 'Дракон использует один из следующих видов оружия дыхания.' },
      { n: 'Огненное дыхание', t: 'Все существа в этой области должны совершить спасбросок Ловкости со Сл 21, получая урон огнём 66 (12к10) при провале.' }] } });
    assert.deepEqual(at.map(a => [a.n, a.rc]), [['Огненное дыхание', '5–6']]);
  });
});

describe('combatAttacks on site wording', () => {
  const one = (n, t) => combatAttacks({ secs: { Actions: [{ n, t }] } })[0];
  it('works out the average a site leaves out, "Hit: (2d6 + 5)"', () => {
    assert.deepEqual(one('Bite', 'Melee Weapon Attack: +14 to hit, reach 10 ft. Hit: (2d10 + 8) piercing damage plus (2d6)fire damage.').parts,
      [{ dmg: '19', type: 'piercing' }, { dmg: '7', type: 'fire' }]);
  });
  it('reads Open5e’s 2024 damage with no "Hit:"', () => {
    assert.deepEqual(one('Ice Spear', 'Melee or Ranged Attack Roll: +10, reach 5 ft. or range 30/120 ft. 14 (2d8 + 5) Piercing damage plus 10 (3d6) Cold damage.').parts,
      [{ dmg: '14', type: 'piercing' }, { dmg: '10', type: 'cold' }]);
  });
  it('reads "Сл освобождения от захвата"', () => {
    assert.equal(one('Щупальце', 'Бросок рукопашной атаки: +9, досягаемость 15 фт. Попадание: 12 (2к6 + 5) Дробящего урона. Она становится Схваченной(Сл освобождения от захвата 14).').grab, '14');
  });
  it('links rays listed with no numbers to the action whose text ends in a colon', () => {
    const at = combatAttacks({ secs: { Actions: [{ n: 'Мультиатака', t: 'Бехолдер использует Лучи из глаз трижды.' },
      { n: 'Лучи из глаз', t: 'Бехолдер пускает луч (бросьте 1к10):' },
      { n: 'Луч ужаса', t: 'Спасбросок Мудрости: Сл 16. Провал: 14 (4к6) Психического урона.' },
      { n: 'Луч смерти', t: 'Спасбросок Ловкости: Сл 16. Провал: 55 (10к10) Некротического урона.' }] } });
    assert.deepEqual([at[0].x, at[0].opts.map(p => p.n)], [3, ['Луч ужаса', 'Луч смерти']]);
  });
  it('reads a swap written "использованием Сотворения заклинаний (Палящий луч)"', () => {
    const at = combatAttacks({ secs: { Actions: [{ n: 'Мультиатака', t: 'Дракон совершает три атаки Раздиранием. Он может заменить одну из этих атак использованием Сотворения заклинаний (Палящий луч).' },
      { n: 'Раздирание', t: 'Бросок рукопашной атаки: +14. Попадание: 13 (1к10 + 8) Рубящего урона.' }] } });
    assert.deepEqual(at[0].swap, { k: '1', to: 'Палящий луч' });
  });
  it('joins a part set after "+": "Колющего урона + 7 (2к6) урона Ядом"', () => {
    assert.deepEqual(one('Жало', 'Бросок рукопашной атаки: +5. Попадание: 6 (1к6 + 3) Колющего урона + 7 (2к6) урона Ядом.').parts,
      [{ dmg: '6', type: 'piercing' }, { dmg: '7', type: 'poison' }]);
  });
  const swapOf = (t, acts) => combatAttacks({ secs: { Actions: [{ n: 'Мультиатака', t }, ...acts.map(([n, a]) => ({ n, t: a }))] } })[0].swap;
  const hit = d => `Бросок атаки: +4. Попадание: ${d} Колющего урона.`;
  it('reads "используя A и B в любой комбинации" as a pick', () => {
    const at = combatAttacks({ secs: { Actions: [{ n: 'Мультиатака', t: 'Разведчик совершает две атаки, используя Короткий меч и Длинный лук в любой комбинации.' },
      { n: 'Короткий меч', t: hit('5 (1к6 + 2)') }, { n: 'Длинный лук', t: hit('6 (1к8 + 2)') }] } });
    assert.deepEqual([at[0].x, at[0].opts.map(p => p.n)], [2, ['Короткий меч', 'Длинный лук']]);
  });
  it('keeps a joining word inside a name open: "Штормовым мечом или Громом и молнией"', () => {
    const at = combatAttacks({ secs: { Actions: [{ n: 'Мультиатака', t: 'Великан совершает две атаки Штормовым мечом или Громом и молнией в любой комбинации.' },
      { n: 'Штормовой меч', t: hit('23 (4к6 + 9)') }, { n: 'Гром и молния', t: hit('22 (5к8)') }] } });
    assert.deepEqual(at[0].opts.map(p => p.n), ['Штормовой меч', 'Гром и молния']);
  });
  it('reads rays counted before the verb: "дважды использует Лучи из глаз"', () => {
    const at = combatAttacks({ secs: { Actions: [{ n: 'Мультиатака', t: 'Наблюдатель дважды использует Лучи из глаз.' },
      { n: 'Лучи из глаз', t: 'Наблюдатель пускает луч:' },
      { n: 'Луч ужаса', t: 'Спасбросок Мудрости: Сл 12. Провал: 5 (1к8) Психического урона.' },
      { n: 'Луч ранения', t: 'Спасбросок Телосложения: Сл 12. Провал: 16 (3к10) Некротического урона.' }] } });
    assert.deepEqual([at[0].x, at[0].opts.length], [2, 2]);
  });
  it('reads the site swaps "одну из атак на", "каждую атаку" and "одну атаку Укусом"', () => {
    const acts = [['Удар', hit('7 (1к6 + 4)')], ['Укус', hit('12 (2к8 + 3)')]];
    assert.deepEqual(swapOf('Культист совершает две атаки Ударом. Он может заменить одну из атак на Укус.', acts), { k: '1', to: 'Укус' });
    assert.deepEqual(swapOf('Культист совершает две атаки Ударом. Он может заменить каждую атаку Укусом.', acts), { k: 'any', to: 'Укус' });
    assert.deepEqual(swapOf('Верволк совершает две атаки Ударом. Он может заменить одну атаку Укусом.', acts), { k: '1', to: 'Укус' });
  });
});

describe('combatAttacks on book text layers', () => {
  it('reads a save split across a line break: "Dexterity Saving\\nThrow"', () => {
    assert.equal(brief(read('Dexterity Saving\nThrow: DC 16, each creature in a Line. Failure: 55 (10d10) Lightning damage.')), 'A DC 16 Dex 55 lightning');
  });
  it('reads a type followed by "полем": "урон силовым полем 45 (10к8)"', () => {
    assert.deepEqual(read('Цель должна преуспеть в спасброске Ловкости со Сл 16, иначе получит урон силовым полем 45 (10к8).').parts,
      [{ dmg: '45', type: 'force' }]);
  });
  it('reads Open5e’s damage with no "Hit:" after "feet", flat or with dice', () => {
    assert.deepEqual(read('Melee Attack Roll: +2, reach 5 ft. 1 Bludgeoning damage.').parts, [{ dmg: '1', type: 'bludgeoning' }]);
    assert.deepEqual(read('Melee Attack Roll: +9, reach 5 feet. 12 (2d6 + 5) Slashing damage.').parts, [{ dmg: '12', type: 'slashing' }]);
  });
  it('reads "екротического" with its first letter lost as necrotic', () => {
    assert.equal(combatDamageType('екротического'), 'necrotic');
  });
  const hit = d => `Бросок атаки: +7. Попадание: ${d} Колющего урона.`;
  it('falls back on a count limited "only once"', () => {
    const at = pills([['Мультиатака', 'Юань-ти совершает две дальнобойные атаки или две рукопашные атаки, но Укус может использовать только раз.'],
      ['Укус', hit('5 (1к4 + 3)')], ['Длинный лук', 'Бросок дальнобойной атаки: +4. Попадание: 6 (1к8 + 2) Колющего урона.']]);
    assert.equal(at[0].fallback, true);
  });
  it('names the attack a swap is tied to: "заменить атаку Лапой на"', () => {
    const at = pills([['Мультиатака', 'Химера совершает одну атаку Укусом и одну атаку Лапой. Она может заменить атаку Лапой на использование Огненного дыхания.'],
      ['Укус', hit('11 (2d6 + 4)')], ['Лапа', hit('7 (1d6 + 4)')], ['Огненное дыхание (перезарядка 5–6)', 'Испытание Ловкости: Сл 15. Провал: 31 (7d8) урона Огнём.']]);
    assert.deepEqual(at[0].swap, { k: '1', to: 'Огненное дыхание', of: 'Лапа' });
  });
  it('gives each numbered option its list’s recharge', () => {
    const at = pills([['Катастрофическое событие (перезарядка 4–6)', 'Катаклизм создаёт один из эффектов (бросьте 1d4):'],
      ['1', 'Цепкое пламя. Испытание Ловкости: СЛ 23. Провал: 45 (10d8) урона Огнём.']]);
    assert.deepEqual([at[0].n, at[0].rc], ['Цепкое пламя', '4–6']);
  });
});
