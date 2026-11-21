'use strict';

// Spells on the stat block (BACKLOG 304): a spellcasting entry read into its lead and groups, the crystals each group
// carries, what stays a paragraph, and where the spent crystals live. Samples are written for the tests or taken from
// the SRD 5.1 / 5.2 (CC BY 4.0); no book text.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');
const { execFileSync } = require('child_process');
const { spellcastingRead, spellKeys, spellSpent, spellToggle } = require('../src/combat/spellcasting.js');
const cp = require('../src/combat/combatPlan.js');
const fp = require('../src/combat/fightPlan.js');

const shape = r => r && r.groups.map(g => [g.kind, g.n, g.spells.map(s => s.name + (s.note ? ' ' + s.note : '')).join(', ')]);

const SRD_MAGE = 'The mage is a 9th-level spellcaster. Its spellcasting ability is Intelligence (spell save DC 14, +6 to hit with spell attacks). The mage has the following wizard spells prepared:\n'
  + 'Cantrips (at will): fire bolt, light, mage hand, prestidigitation\n1st level (4 slots): detect magic, mage armor, magic missile, shield\n'
  + '2nd level (3 slots): misty step, suggestion\n3rd level (3 slots): counterspell, fireball, fly\n4th level (3 slots): greater invisibility, ice storm\n5th level (1 slot): cone of cold';
const SRD_LICH_2024 = 'The lich casts one of the following spells, using Intelligence as the spellcasting ability (spell save DC 20):\n'
  + 'At Will: Detect Magic, Detect Thoughts, Dispel Magic, Fireball (level 5 version), Invisibility, Lightning Bolt (level 5 version), Mage Hand, Prestidigitation\n'
  + '2/Day Each: Animate Dead, Dimension Door, Plane Shift\n1/Day Each: Chain Lightning, Finger of Death, Power Word Kill, Scrying';
const SRD_DJINNI = "The djinni's innate spellcasting ability is Charisma (spell save DC 17, +9 to hit with spell attacks). It can innately cast the following spells, requiring no material components:\n"
  + 'At will: detect evil and good, detect magic, thunderwave\n3/day each: create food and water (can create wine instead of water), tongues, wind walk\n1/day each: conjure elemental (air elemental only), creation, gaseous form, invisibility, major image, plane shift';
const RU_2014 = 'Колдунья является заклинателем 5 уровня. Её базовой характеристикой является Интеллект (Сл спасброска от заклинания 13, +5 к попаданию атаками заклинаниями). У неё подготовлены следующие заклинания волшебника: '
  + 'Заговоры (неограниченно): свет [light], луч холода [ray of frost] 1-й уровень (4 ячейки): щит [shield], усыпление [sleep] (версия 2-го уровня) 2-й уровень (2 ячейки): паутина [web] 3-й уровень (2 ячейки): огненный шар [fireball]';
const RU_INNATE = 'Базовой характеристикой духа является Харизма (Сл спасброска от заклинания 14). Он может накладывать следующие заклинания:\n'
  + 'Неограниченно: свет [light]\n3/день каждое: туманный шаг [misty step], невидимость [invisibility] (только на себя)\n1/день: полёт [fly]';
const RU_2024 = 'Дух сотворяет одно из описанных ниже заклинаний и использует Мудрость (СЛ испытаний против заклинаний 14) в качестве заклинательной характеристики.\n'
  + 'Неограниченно: Свет, Чудотворство\n2 в день: Огненный шар (4-й круг)\n1 в день каждое: Полёт, Слово силы: смерть,\nТуманный шаг';

describe('reading a spellcasting entry', () => {
  it('keeps the lead sentence word for word', () => {
    for (const [n, t] of [['Spellcasting', SRD_MAGE], ['Spellcasting', SRD_LICH_2024], ['Innate Spellcasting', SRD_DJINNI],
      ['Использование заклинаний', RU_2014], ['Врождённое колдовство', RU_INNATE], ['Заклинания', RU_2024]]) {
      const r = spellcastingRead(n, t);
      const lead = t.slice(0, t.search(/(Cantrips|At [Ww]ill|Заговоры|Неограниченно)/)).trimEnd();
      assert.equal(r.lead, lead, n);
    }
  });

  it('puts each spell under its level with one crystal per slot', () => {
    assert.deepEqual(shape(spellcastingRead('Spellcasting', SRD_MAGE)), [
      ['will', 0, 'fire bolt, light, mage hand, prestidigitation'], ['slots', 4, 'detect magic, mage armor, magic missile, shield'],
      ['slots', 3, 'misty step, suggestion'], ['slots', 3, 'counterspell, fireball, fly'], ['slots', 3, 'greater invisibility, ice storm'],
      ['slots', 1, 'cone of cold']]);
  });

  it('reads a Russian 2014 list run into one paragraph, dropping the English names and keeping a note', () => {
    assert.deepEqual(shape(spellcastingRead('Использование заклинаний', RU_2014)), [
      ['will', 0, 'свет, луч холода'], ['slots', 4, 'щит, усыпление (версия 2-го уровня)'], ['slots', 2, 'паутина'], ['slots', 2, 'огненный шар']]);
  });

  it('gives "N/day" N crystals and "N/day each" N on every spell, in both languages and editions', () => {
    assert.deepEqual(shape(spellcastingRead('Spellcasting', SRD_LICH_2024)), [
      ['will', 0, 'Detect Magic, Detect Thoughts, Dispel Magic, Fireball (level 5 version), Invisibility, Lightning Bolt (level 5 version), Mage Hand, Prestidigitation'],
      ['dayEach', 2, 'Animate Dead, Dimension Door, Plane Shift'], ['dayEach', 1, 'Chain Lightning, Finger of Death, Power Word Kill, Scrying']]);
    assert.deepEqual(shape(spellcastingRead('Innate Spellcasting', SRD_DJINNI)).map(g => [g[0], g[1]]), [['will', 0], ['dayEach', 3], ['dayEach', 1]]);
    assert.deepEqual(shape(spellcastingRead('Врождённое колдовство', RU_INNATE)), [
      ['will', 0, 'свет'], ['dayEach', 3, 'туманный шаг, невидимость (только на себя)'], ['day', 1, 'полёт']]);
    assert.deepEqual(shape(spellcastingRead('Заклинания', RU_2024)), [
      ['will', 0, 'Свет, Чудотворство'], ['day', 2, 'Огненный шар (4-й круг)'], ['dayEach', 1, 'Полёт, Слово силы: смерть, Туманный шаг']]);
  });

  it('reads "N в день каждое", "N круг (K ячеек)" and a footnote after the list', () => {
    const r = spellcastingRead('Заклинания', 'Маг творит заклинания.\nЗаговоры: Свет\n1 круг (4 ячейки): Щит*\n3 в день каждое: Полёт\n*Наложено до боя.');
    assert.deepEqual(shape(r), [['will', 0, 'Свет'], ['slots', 4, 'Щит*'], ['dayEach', 3, 'Полёт']]);
    assert.equal(r.tail, '*Наложено до боя.');
  });

  it('returns the qualifier the book prints after a label, and none when it has none', () => {
    const r = spellcastingRead('Spellcasting', 'Lead:\nAt will: light\n1/Day Each (Sage form only): fly, haste\n2nd level (3 slots): web');
    assert.deepEqual(r.groups.map(g => g.qual), ['', '(Sage form only)', '']);
    assert.equal(r.groups[1].label, '1/Day Each (Sage form only)');
    assert.equal(spellcastingRead('Заклинания', 'Вступление.\n1 в день (только Мудрец): Полёт').groups[0].qual, '(только Мудрец)');
  });

  it('labels each group with the text the book printed', () => {
    assert.deepEqual(spellcastingRead('Использование заклинаний', RU_2014).groups.map(g => g.label),
      ['Заговоры (неограниченно)', '1-й уровень (4 ячейки)', '2-й уровень (2 ячейки)', '3-й уровень (2 ячейки)']);
  });
});

describe('what stays a paragraph', () => {
  it('answers null for an entry that is not spellcasting or holds no list', () => {
    assert.equal(spellcastingRead('Multiattack', 'At will: it makes two attacks.'), null);
    assert.equal(spellcastingRead('Counterspell', 'The mage casts Counterspell in response to that spell\'s trigger.'), null);
    assert.equal(spellcastingRead('Контрзаклинание (2 в день)', 'Культист сотворяет Контрзаклинание.'), null);
    assert.equal(spellcastingRead('Spellcasting', ''), null);
  });

  it('answers null when text outside the list would join a spell', () => {
    assert.equal(spellcastingRead('Заклинания', 'Вступление.\nНеограниченно: Свет\n1 в день каждое: Полёт, Огненная стена Йети Пугающие хищники'), null);
    assert.equal(spellcastingRead('Spellcasting', 'Lead:\nAt will: light\nThe mage keeps a spellbook. It holds more.\n1/day: fly'), null);
    assert.equal(spellcastingRead('Spellcasting', 'Lead:\n1/day: (Sage only): fly'), null);
    assert.equal(spellcastingRead('Spellcasting', 'Lead:\n1st level (4 slots):'), null);
  });
});

describe('the crystals', () => {
  const keys = (n, t) => spellKeys(n, spellcastingRead(n, t).groups);

  it('are keyed by innate or cast, the group\'s level or count, and for "each" the spell\'s name', () => {
    assert.deepEqual(keys('Spellcasting', SRD_MAGE).map(k => k.key),
      ['cast|will', 'cast|slots:1', 'cast|slots:2', 'cast|slots:3', 'cast|slots:4', 'cast|slots:5']);
    const dj = keys('Innate Spellcasting', SRD_DJINNI);
    assert.deepEqual(dj.map(k => k.key), ['innate|will', 'innate|day:3', 'innate|day:1']);
    assert.equal(dj[1].spells[0], 'innate|day:3:create food and water');
    assert.equal(keys('Врождённое колдовство', RU_INNATE)[2].key, 'innate|day:1');
    assert.equal(keys('Spellcasting', SRD_MAGE)[0].spells, null);
  });

  it('keep their keys when the groups are reordered or the trait renamed', () => {
    const lines = SRD_LICH_2024.split('\n'), swapped = [lines[0], lines[1], lines[3], lines[2]].join('\n');
    const by = ks => Object.fromEntries(ks.map(k => [k.key, k.spells]));
    assert.deepEqual(by(keys('Spellcasting', swapped)), by(keys('Spellcasting', SRD_LICH_2024)));
    assert.deepEqual(keys('Spellcasting (Arcane)', SRD_LICH_2024), keys('Spellcasting', SRD_LICH_2024));
    assert.equal(keys('Spellcasting', SRD_LICH_2024)[1].spells[2], 'cast|day:2:plane shift');
  });

  it('tell two groups apart that print the same label', () => {
    const k = keys('Spellcasting', 'Lead:\n1/day: fly\n1/day: haste').map(x => x.key);
    assert.equal(k[0], 'cast|day:1');
    assert.notEqual(k[1], k[0]);
  });

  it('spend from full and come back, clamped to the cells and dropping a key at 0', () => {
    let s = {};
    s = spellToggle(s, 'k', 2, true);
    s = spellToggle(s, 'k', 2, true);
    s = spellToggle(s, 'k', 2, true);
    assert.deepEqual(s, { k: 2 });
    s = spellToggle(s, 'k', 2, false);
    s = spellToggle(s, 'k', 2, false);
    assert.deepEqual(s, {});
    assert.equal(spellSpent({ k: 9 }, 'k', 3), 3);
    assert.equal(spellSpent({ k: 'x' }, 'k', 3), 0);
    assert.equal(spellSpent(undefined, 'k', 3), 0);
  });
});

describe('a fight row\'s spent crystals', () => {
  const entry = { name: 'Mage', ac: '12', hp: '40', secs: { Traits: [{ n: 'Spellcasting', t: SRD_MAGE }] } };
  const row = () => Object.assign(cp.combatRowFromEntry(entry, []), { id: 1, spent: { 'cast|slots:1': 2 } });

  it('start full on a duplicated row, a duplicated fight and a new copy from the Bestiary', () => {
    assert.equal(cp.combatDuplicateRow(row(), [row()], 2).spent, undefined);
    const st = { openId: 'f1', fights: [{ id: 'f1', name: 'F' }], rows: [row()], nextId: 2 };
    fp.combatDuplicateFight(st, 'f1', () => 'f2');
    assert.equal(st.fights[1].rows[0].spent, undefined);
    assert.deepEqual(st.rows[0].spent, { 'cast|slots:1': 2 });
    assert.equal(cp.combatRowFromEntry(entry, []).spent, undefined);
    const picked = row();
    cp.combatPickInto(picked, entry, []);
    assert.equal(picked.spent, undefined);
  });

  it('count in the fight\'s hash but never as a change to its copy', () => {
    const a = row(), b = Object.assign(row(), { spent: {} });
    assert.notEqual(fp.combatFightKey('F', [a]), fp.combatFightKey('F', [b]));
    assert.equal(a.sbChanged, false);
    assert.deepEqual(cp.combatCopyDiffs(a.sb, entry), {});
  });

  it('survive this build\'s cleaning and the previous release\'s (5.18.1)', () => {
    const src = execFileSync('git', ['show', '4874037:src/combat/combatPlan.js'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
    const old = new Module('combatPlan-5.18.1', module);
    old.paths = module.paths;
    old._compile(src, path.join(__dirname, '..', 'src', 'combat', 'combatPlan-5.18.1.js'));
    for (const clean of [old.exports.combatCleanRow, cp.combatCleanRow]) assert.deepEqual(clean(row()).spent, { 'cast|slots:1': 2 });
  });
});
