'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const P = require('../src/combat/statBlockParse.js');

// Real pages saved from each site, so a reader is checked against the markup it will meet. They are
// the sites' own pages, so they stay out of the repo, and these tests skip where they are absent.
const PAGES = path.join(__dirname, '..', '.claude', 'private', 'fixtures', 'statblocks');
const HAVE_PAGES = fs.existsSync(PAGES);
const fixture = f => fs.readFileSync(path.join(PAGES, f), 'utf8');
const page = f => P.statBlockFromPage(fixture(f));

describe('statBlockFromLines on plain English text', () => {
  const b = P.statBlockFromLines([
    'Goblin', 'Small humanoid (goblinoid), neutral evil',
    'Armor Class 15 (leather armor, shield)', 'Hit Points 7 (2d6)', 'Speed 30 ft.',
    'STR', '8 (-1)', 'DEX', '14 (+2)', 'CON', '10 (+0)', 'INT', '10 (+0)', 'WIS', '8 (-1)', 'CHA', '8 (-1)',
    'Skills Stealth +6', 'Senses darkvision 60 ft., passive Perception 9', 'Languages Common, Goblin',
    'Challenge 1/4 (50 XP)',
    'Nimble Escape. The goblin can take the Disengage or Hide action as a bonus action on each of its turns.',
    'Actions',
    'Scimitar. Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage.',
  ]);
  it('reads the labelled lines', () => {
    assert.equal(b.name, 'Goblin');
    assert.equal(b.meta, 'Small humanoid (goblinoid), neutral evil');
    assert.equal(b.ac, '15 (leather armor, shield)');
    assert.equal(b.hp, '7 (2d6)');
    assert.equal(b.cr, '1/4 (50 XP)');
  });
  it('joins abilities spread one per line', () => {
    assert.deepEqual(b.abil, ['8', '14', '10', '10', '8', '8']);
  });
  it('files an unheaded entry under Traits and names each entry', () => {
    assert.equal(b.secs.Traits[0].n, 'Nimble Escape');
    assert.equal(b.secs.Actions[0].n, 'Scimitar');
    assert.match(b.secs.Actions[0].t, /^Melee Weapon Attack/);
  });
});

describe('statBlockFromLines on the 2024 layout', () => {
  const b = P.statBlockFromLines(['Mage', 'Medium or Small Humanoid (Wizard), Neutral',
    'AC 15 Initiative +2 (12)', 'HP 81 (18d8)', 'STR 9 −1 −1 DEX 14 +2 +2 CON 11 +0 +0 INT 17 +3 +6 WIS 12 +1 +4 CHA 11 +0 +0']);
  it('drops the initiative that shares the AC line', () => assert.equal(b.ac, '15'));
  it('writes saves from the save column where it differs from the modifier', () => assert.equal(b.saves, 'Int +6, Wis +4'));
});

describe('statBlockFromLines refusals', () => {
  it('returns null for text with no stat block in it', () => {
    assert.equal(P.statBlockFromLines(['Comments', 'Great monster, used it last week.']), null);
  });
  it('skips a section the source marked but the popup has no place for', () => {
    const b = P.statBlockFromLines(['Wolf', 'Hit Points 11 (2d8 + 2)', '## Description', 'Wolves hunt in packs.']);
    assert.deepEqual(b.secs, {});
  });
});

describe('a monster page on any site', { skip: !HAVE_PAGES && 'the saved pages are kept on the developer machine only' }, () => {
  it('reads a dnd.su goblin, its name without the English name or the source badges', () => {
    const b = page('dndsu-4-goblin.html');
    assert.equal(b.name, 'Гоблин');
    assert.equal(b.ac, '15 (кожаный доспех, щит)');
    assert.equal(b.hp, '7 (2к6)');
    assert.deepEqual(b.abil, ['8', '14', '10', '10', '8', '8']);
    assert.deepEqual(Object.keys(b.secs), ['Traits', 'Actions']);
    assert.equal(b.secs.Actions.length, 2);
  });
  it('keeps the legendary intro and the lair list, and drops the lore and comments after them', () => {
    const b = page('dndsu-216-lich.html');
    assert.equal(b.secs['Legendary actions'][0].n, '');
    assert.equal(b.secs['Legendary actions'].length, 5);
    assert.equal(b.secs['Lair actions'].length, 1);
    assert.ok(!JSON.stringify(b).includes('Описание'));
  });
  it('reads a next.dnd.su 2024 lich, saves from its table', () => {
    const b = page('nextdndsu-21430-lich.html');
    assert.equal(b.name, 'Лич');
    assert.equal(b.ac, '20');
    assert.deepEqual(b.abil, ['11', '16', '16', '21', '14', '16']);
    assert.equal(b.saves, 'Лов +10, Тел +10, Инт +12, Мдр +9');
    assert.equal(b.secs.Actions.length, 4);
  });
  it('reads D&D Beyond, and stops where its stat block box closes, before the comments', () => {
    const old = page('ddb14-goblin.html');
    assert.equal(old.name, 'Goblin');
    assert.equal(old.secs.Actions.length, 2);
    const now = page('ddb24-owlbear.html');
    assert.equal(now.ac, '13');
    assert.deepEqual(now.abil, ['20', '12', '17', '3', '12', '7']);
    assert.deepEqual(now.secs.Actions.map(e => e.n), ['Multiattack', 'Rend']);
    assert.ok(!now.secs.Actions[1].t.includes('Join Date'));
  });
  it('reads a score table and drops the site footer after the block', () => {
    const b = page('srd5-lich.html');
    assert.deepEqual(b.abil, ['11', '16', '16', '20', '14', '16']);
    assert.equal(b.secs['Legendary actions'].length, 5);
    assert.ok(!JSON.stringify(b).includes('GitHub'));
  });
  it('reads aidedd, both rule sets, and a homebrew block on dandwiki', () => {
    assert.equal(page('aidedd-lich.html').secs['Legendary actions'].length, 5);
    const w = page('aidedd24-goblinwarrior.html');
    assert.deepEqual(Object.keys(w.secs), ['Actions', 'Bonus actions']);
    assert.equal(w.secs['Bonus actions'].length, 1);
    const s = page('dandwiki-goblin-shaman.html');
    assert.equal(s.name, 'Goblin Shaman');
    assert.deepEqual(Object.keys(s.secs), ['Traits', 'Actions', 'Bonus actions', 'Reactions']);
  });
  it('keeps a dnd.su description as lore, and stops at its comments', () => {
    const b = page('dndsu-216-lich.html');
    assert.ok(b.lore.startsWith('Личи — это бывшие великие волшебники'));
    assert.ok(!/комментари/i.test(b.lore));
  });
});


// Lines as statBlockFind cut them from the rendered pages; both sites draw with scripts, so a
// saved page holds no stat block at all.
describe('statBlockFind refusals', () => {
  it('finds nothing on a page with no stat block', () => {
    assert.deepEqual(P.statBlockFind(P.statBlockHtmlLines('<h1>Shop</h1><p>Monster Manual $59.95</p>')), []);
  });
});

describe('ttg.club, which sets names and labels as headings', () => {
  it('reads new.ttg.club: "КД:", "ПО:", and each action name a heading of its own', () => {
    const b = P.statBlockFromLines(['Гоблин воин', 'Маленькая фея (гоблиноид), хаотичная нейтральная', 'Рейтинг', '4.56',
      'Оценок: 4', 'КД: 15', 'Инициатива: +2 (12)', 'Хиты: 10 (3к6)', 'Скорость: 30 фт.', 'Мод', 'Спас', 'Мод', 'Спас',
      'Сил', '8', '-1', '-1', 'Лов', '15', '+2', '+2', 'Тел', '10', '+0', '+0', 'Инт', '10', '+0', '+0', 'Мдр', '8', '-1', '-1',
      'Хар', '8', '-1', '-1', 'Навыки: Скрытность +6', 'Инвентарь: Кожаный доспех, Скимитар, Щит, Короткий лук',
      'Чувства: тёмное зрение 60 фт., пассивная внимательность 9', 'Языки: общий, гоблинский', 'ПО: 1/4 (Опыт 50; БМ +2)',
      '## Действия', '## Скимитар.', 'Бросок рукопашной атаки: +4, досягаемость 5 фт. Попадание: 5 (1к6 + 2) рубящего урона.',
      '## Короткий лук.', 'Бросок дальнобойной атаки: +4, дистанция 80/320 фт. Попадание: 5 (1к6 + 2) колющего урона.',
      '## Бонусные действия', '## Ловкий побег.', 'Гоблин совершает действие Отход или Засада.',
      '## Описание', 'Гоблины воины мастерски создают хаос.']);
    assert.equal(b.ac, '15');
    assert.equal(b.cr, '1/4 (Опыт 50; БМ +2)');
    assert.deepEqual(b.abil, ['8', '15', '10', '10', '8', '8']);
    assert.equal(b.senses, 'тёмное зрение 60 фт., пассивная внимательность 9');
    assert.deepEqual(b.secs.Actions.map(e => e.n), ['Скимитар', 'Короткий лук']);
    assert.ok(b.secs.Actions[0].t.startsWith('Бросок рукопашной атаки'));
    assert.deepEqual(b.secs['Bonus actions'], [{ n: 'Ловкий побег', t: 'Гоблин совершает действие Отход или Засада.' }]);
    assert.ok(!JSON.stringify(b).includes('Инвентарь'));
    assert.equal(b.lore, 'Гоблины воины мастерски создают хаос.');
  });
  it('reads 5e14.ttg.club: ability names and the first trait as headings, the source on the size line', () => {
    const b = P.statBlockFromLines(['Гоблин', 'Маленький гуманоид (гоблиноид), нейтрально-злой / small 1 клетка Источник: MM',
      'Класс доспеха 15 (кожаный доспех, щит)', 'Хиты 7 (2к6)', 'Скорость 30 фт.', '## СИЛ', '8 (−1)', '## ЛОВ', '14 (+2)',
      '## ТЕЛ', '10 (+0)', '## ИНТ', '10 (+0)', '## МДР', '8 (−1)', '## ХАР', '8 (−1)', 'Навыки Скрытность +6',
      'Сопротивление к урону холод', 'Уровень опасности 1/4 (50 опыта)', 'Бонус мастерства 2',
      '## Острое зрение и тонкий нюх.', 'Гоблин совершает с преимуществом проверки Мудрости.',
      '## Действия', '## Мультиатака.', 'Гоблин совершает две атаки Скимитаром.',
      '## Скимитар.', 'Рукопашная атака оружием: +4 к попаданию. Попадание: 5 (1к6 + 2) рубящего урона.',
      '## Места обитания', 'лес, равнина/луг, холмы, подземье', 'Описание', 'Гоблиноиды. Гоблины принадлежат к семейству.']);
    assert.equal(b.meta, 'Маленький гуманоид (гоблиноид), нейтрально-злой / small 1 клетка');
    assert.deepEqual(b.abil, ['8', '14', '10', '10', '8', '8']);
    assert.equal(b.resist, 'холод');
    assert.equal(b.cr, '1/4 (50 опыта)');
    assert.deepEqual(b.secs.Traits.map(e => e.n), ['Острое зрение и тонкий нюх']);
    // A text that is one short sentence is still the text, never a second action.
    assert.deepEqual(b.secs.Actions.map(e => e.n), ['Мультиатака', 'Скимитар']);
    assert.equal(b.secs.Actions[0].t, 'Гоблин совершает две атаки Скимитаром.');
    assert.ok(!JSON.stringify(b.secs).includes('Гоблиноиды'));
    assert.equal(b.lore, 'Гоблиноиды. Гоблины принадлежат к семейству.');
  });
  it('reads a lair set inside the description as lair actions, and keeps the rest as lore', () => {
    const b = P.statBlockFromLines(['Страд фон Зарович', 'Средняя нежить (вампир), законопослушная злая', 'КД: 16', 'Хиты: 204 (24к8 + 96)',
      '## Действия', '## Удар смерти.', 'Бросок рукопашной атаки: +9. Попадание: 8 (1к8 + 4) рубящего урона.',
      '## Описание', 'Суровый аристократ.', '## Логово Страда', 'Присутствие Страда изменяет Баровию:',
      '## Закрытие границ.', 'Страд может закрывать границы Баровии.', 'Существо совершает этот спасбросок раз за ход.',
      '## Ужасающая тьма.', 'Все существа получают помеху.', '## Страд в игре', 'Граф редко покидает замок.']);
    assert.equal(b.secs.Actions[0].t, 'Бросок рукопашной атаки: +9. Попадание: 8 (1к8 + 4) рубящего урона.');
    assert.deepEqual(b.secs['Lair actions'].map(e => e.n), ['', 'Закрытие границ', 'Ужасающая тьма']);
    assert.equal(b.secs['Lair actions'][1].t, 'Страд может закрывать границы Баровии.\nСущество совершает этот спасбросок раз за ход.');
    assert.equal(b.lore, 'Суровый аристократ.\n\nСтрад в игре\n\nГраф редко покидает замок.');
  });
  it('names a translated page by its own name, not the original under it', () => {
    const lines = P.statBlockHtmlLines('<div>Гоблин</div><div>Goblin</div><div>Маленький гуманоид</div><div>Класс доспеха 15</div><p>Действия</p><p>Скимитар. Атака.</p>');
    assert.equal(P.statBlockFind(lines)[0], 'Гоблин');
  });
});
