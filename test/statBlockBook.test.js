'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { statBlocksInText, statBlockHeadAt, statBlockUnclean } = require('../src/combat/statBlockBook.js');

// Synthetic text in the shapes the real books take; the books themselves stay out of the repo.
// "L" is the lore font, "S" the stat block font, "N" an entry name's font, as pdfLayout emits them.
const book = rows => rows.map(([f, t]) => `${f}\u0001${t}`).join('\n');
const lore = n => Array.from({ length: n }, (_, i) => ['L', `Строка описания номер ${i} продолжает долгий рассказ о чудище`]);

const MM_BLOCK = [
  ['H', 'Болотный зверь'],
  ['S', 'Крупная Бестия, Хаотичная Злая'],
  ['S', 'КБ 15 Инициатива +2 (12)'],
  ['S', 'ПЗ 45 (6d10 + 12)'],
  ['S', 'Скорость 30 футов, плавание 30 футов'],
  ['S', 'МОД ИСП МОД ИСП МОД ИСП'],
  ['S', 'Сил 18 +4 +4 Лвк 12 +1 +1 Вын 14 +2 +4'],
  ['S', 'Инт 3 −4 −4 Мдр 12 +1 +1 Хар 6 −2 −2'],
  ['S', 'Устойчивости Яд'],
  ['S', 'Невосприимчивости Испуг'],
  ['S', 'Восприятие Ночное зрение 60 футов;'],
  ['S', 'пассивное Внимание 11'],
  ['S', 'КО 2 (450 ПО; БУ +2)'],
  ['S', 'Особенности'],
  ['S', 'Задержка дыхания. Зверь может задерживать дыхание на 1 час.'],
  ['S', 'Действия'],
  ['N', 'Укус. Бросок атаки в ближнем бою: +6, зона досягае-'],
  ['S', 'мости 5 футов. Попадание: 9 (1d10 + 4) Колющего урона'],
  ['S', 'Силой.ИВАН ПЕТРОВ'],
  ['S', 'Ответные действия'],
  ['S', 'Нырок. Зверь уходит под воду.'],
];

describe('statBlocksInText on a 2024 Russian book', () => {
  // The lore after the block has no heading of its own, so only the font change can end the block.
  const text = book([['H', 'Болотные звери'], ...lore(40), ...MM_BLOCK, ...lore(40)]);
  const blocks = statBlocksInText(text);
  const b = blocks[0];
  it('finds the one block and names it from the line above its size line', () => {
    assert.equal(blocks.length, 1);
    assert.equal(b.name, 'Болотный зверь');
    assert.equal(b.meta, 'Крупная Бестия, Хаотичная Злая');
  });
  it('reads the 2024 labels and both ability rows', () => {
    assert.equal(b.ac, '15');
    assert.equal(b.hp, '45 (6d10 + 12)');
    assert.deepEqual(b.abil, ['18', '12', '14', '3', '12', '6']);
    assert.equal(b.resist, 'Яд');
    assert.equal(b.immune, 'Испуг');
    assert.equal(b.senses, 'Ночное зрение 60 футов; пассивное Внимание 11');
    assert.equal(b.cr, '2 (450 ПО; БУ +2)');
  });
  it('joins a wrapped entry and cuts the artist credit off its end', () => {
    assert.equal(b.secs.Actions.length, 1);
    assert.equal(b.secs.Actions[0].t, 'Бросок атаки в ближнем бою: +6, зона досягаемости 5 футов. Попадание: 9 (1d10 + 4) Колющего урона Силой.');
  });
  it('files Ответные действия as reactions and stops before the next monster', () => {
    assert.equal(b.secs.Reactions[0].n, 'Нырок');
    assert.equal(b.secs.Reactions[0].t, 'Зверь уходит под воду.');
    assert.ok(!JSON.stringify(b).includes('Строка описания'));
    assert.equal(statBlockUnclean(b), '');
  });
});

describe('statBlocksInText on plain text with no fonts', () => {
  const text = [
    'Зомби Страда', 'Средний нежить, без мировоззрения', 'Класс Доспеха 8', 'Хиты 30 (4к8 + 12)', 'Скорость 20 фт.',
    'СИЛ ЛОВ ТЕЛ ИНТ МДР ХАР', '13 ( +1 ) 6 ( –2 ) 16 ( +3 ) 3 ( –4 ) 6 ( –2 ) 5 ( –3 )',
    'Навыки Обман +8, Проницательность +7,', 'Восприятие +11, Скрытность +14',
    'Опасность 1 (200 опыта)', 'Действия',
    'Удар. Рукопашная атака оружием: +3 к попаданию. Попадание: 4 дробящего урона.',
    'Охотник', 'Охотник на монстров пришёл в долину давным-давно, и никто не помнит зачем.',
  ].join('\n');
  const [b] = statBlocksInText(text);
  it('keeps a wrapped skills line in the skills, not the senses', () => {
    assert.equal(b.skills, 'Обман +8, Проницательность +7, Восприятие +11, Скрытность +14');
    assert.equal(b.senses, '');
  });
  it('ends at a short heading after a finished sentence', () => {
    assert.equal(b.secs.Actions.length, 1);
    assert.ok(!JSON.stringify(b).includes('Охотник'));
  });
});

describe('statBlocksInText edge cases', () => {
  it('names a block from the line above an English name in brackets', () => {
    const [b] = statBlocksInText(['Барсук', '[Badger]', 'Крошечный Зверь, Без мировоззрения',
      'КД 11 Инициатива: +0', 'Хиты 5 (1к4 + 3)', 'Действия', 'Укус. Атака: +2.'].join('\n'));
    assert.equal(b.name, 'Барсук');
    assert.equal(b.ac, '11');
  });
  it('title-cases a name set in capitals', () => {
    const [b] = statBlocksInText(['ANIMATED OBJECT', 'Huge or Smaller Construct, Unaligned', 'AC 15',
      'HP 10 (Medium or smaller)', 'Actions', 'Slam. Melee Attack Roll: +5.'].join('\n'));
    assert.equal(b.name, 'Animated Object');
  });
  it('finds nothing in prose that mentions an AC', () => {
    assert.deepEqual(statBlocksInText('У сумки КД 15, 25 хитами и иммунитетом к яду.\nОна рассыпается.'), []);
    assert.deepEqual(statBlocksInText(''), []);
  });
  it('drops running heads whose page numbers climb, and keeps a repeated line with other numbers', () => {
    const rows = ['12 чудища', 'Волк', 'Средний Зверь, Без мировоззрения', 'КБ 12', 'ПЗ 11 (2d8 + 2)',
      'Восприятие пассивное Внимание 13', 'пассивное Внимание 13', 'Действия', 'Укус. Бросок атаки: +4.',
      '13 чудища', 'Рысь', 'Средний Зверь, Без мировоззрения', 'КБ 13', 'ПЗ 9 (2d8)',
      'Восприятие пассивное Внимание 11', 'пассивное Внимание 11', 'Действия', 'Укус. Бросок атаки: +3.'];
    const blocks = statBlocksInText(rows.join('\n'));
    assert.deepEqual(blocks.map(b => b.name), ['Волк', 'Рысь']);
    assert.match(blocks[1].senses, /пассивное Внимание 11$/);
  });
  it('calls a block with no actions or scores unclean, so the import skips it', () => {
    const [b] = statBlocksInText(['Гриб', 'Средний Растение, Без мировоззрения', 'КБ 5', 'ПЗ 13 (3d8)',
      'Ответные действия', 'Визг. Гриб визжит.'].join('\n'));
    assert.equal(!!statBlockUnclean(b), true);
  });
});

describe('statBlockHeadAt', () => {
  it('marks a name with a size line and an AC below it', () => {
    const t = ['Болотный зверь', 'Крупная Бестия, Хаотичная Злая', 'КБ 15 Инициатива +2 (12)'];
    assert.equal(statBlockHeadAt(t, 0), true);
    assert.equal(statBlockHeadAt(t, 1), false);
    assert.equal(statBlockHeadAt(['Логова', 'Крупные пещеры тянутся далеко.', 'Там темно.'], 0), false);
  });
});

// Three-part lines, "font\u0001first run's font\u0001text", as a PDF delivers them.
describe('statBlocksInText with the font each line starts in', () => {
  const pdf = rows => rows.map(([f, lead, t]) => `${f}\u0001${lead}\u0001${t}`).join('\n');
  const head = [['H', 'H', 'Волк-оборотень'], ['S', 'S', 'Средний Монстр (Ликантроп), Хаотичный'], ['S', 'S', 'Злой'],
    ['S', 'S', 'КБ 15'], ['S', 'S', 'ПЗ 71 (11d8 + 22)'], ['S', 'S', 'Сил 16 +3 +3 Лвк 14 +2 +2 Вын 14 +2 +2'],
    ['S', 'S', 'Инт 10 +0 +0 Мдр 11 +0 +0 Хар 10 +0 +0'], ['S', 'S', 'Восприятие Ночное зрение 60 футов; пассивное'],
    ['S', 'S', 'Внимание 14'], ['S', 'S', 'КО 3 (700 ПО; БУ +2)']];
  const [b] = statBlocksInText(pdf([...head,
    ['T', 'T', 'Действия'],
    ['S', 'N', 'Мультиатака. Волк-оборотень совершает две атаки.'],
    ['N', 'N', 'Укус (только в форме волка или гибридной форме).'],
    ['S', 'I', 'Бросок атаки в ближнем бою: +5. Если цель - Гуманоид, она проклята.'],
    ['S', 'S', 'Отрезанные части имеют КД 8. Их можно атаковать отдельно.'],
    ['S', 'N', 'Легендарная устойчивость (3 в день или 4 в день'],
    ['S', 'S', 'в логове). Если он проваливает испытание, он преуспевает.'],
    ['S', 'S', 'Квазит.Квазит.'],
    ['H', 'H', 'Барсук'], ['S', 'S', 'Среда обитания: Лес']]));
  it('finishes a wrapped size line and a senses line whose tail starts in capitals', () => {
    assert.equal(b.meta, 'Средний Монстр (Ликантроп), Хаотичный Злой');
    assert.equal(b.senses, 'Ночное зрение 60 футов; пассивное Внимание 14');
  });
  it('splits entries at names set in their own font, and a name alone on its line', () => {
    assert.deepEqual(b.secs.Actions.map(e => e.n), ['Мультиатака', 'Укус (только в форме волка или гибридной форме)',
      'Легендарная устойчивость (3 в день или 4 в день в логове)']);
  });
  it('keeps a sentence shaped like a name, but set in the body font, inside its entry', () => {
    assert.match(b.secs.Actions[1].t, /Отрезанные части имеют КД 8\./);
  });
  it('drops a doubled caption and stops at the next monster', () => {
    assert.ok(!JSON.stringify(b).includes('Квазит'));
    assert.ok(!JSON.stringify(b).includes('Среда обитания'));
    assert.equal(statBlockUnclean(b), '');
  });
});

describe('statBlockUnclean', () => {
  const base = () => statBlocksInText(['Гиена', 'Среднее Животное, Без мировоззрения', 'КБ 11', 'ПЗ 5 (1d8 + 1)',
    'Сил 11 +0 +0 Лвк 13 +1 +1 Вын 12 +1 +1', 'Инт 2 −4 −4 Мдр 12 +1 +1 Хар 5 −3 −3', 'КО 0 (10 ПО; БУ +2)',
    'Действия', 'Укус. Бросок атаки: +2. Попадание: 3 Колющего урона.'].join('\n'))[0];
  it('passes a clean block and fails one carrying page leftovers', () => {
    assert.equal(statBlockUnclean(base()), '');
    const b = base(); b.secs.Actions[0].t += ' КАЙО МОНТЕЙРА, НИЛЬС ХАММ';
    assert.equal(statBlockUnclean(b), 'page text inside it');
    const c = base(); c.hp += '2'; c.hp = '5 (1d8 + 1)2';
    assert.equal(statBlockUnclean(c), 'page text inside it');
  });
  it('fails a block with no challenge rating or no actions', () => {
    const b = base(); b.cr = '';
    assert.equal(statBlockUnclean(b), 'no challenge rating');
    const c = base(); delete c.secs.Actions;
    assert.equal(statBlockUnclean(c), 'no actions');
  });
});
