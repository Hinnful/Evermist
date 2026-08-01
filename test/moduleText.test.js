'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  mtSplitLines, mtHeadingCandidate, mtHeadingCandidates, mtCanonPrefix, mtPickHeadings,
  mtFurniturePart, mtDropFurniture,
  mtWrapWidth, mtEndsParagraph, mtReflow,
  parseModuleText, mtFold, mtFilterEntries, mtPlacedTitles, mtProgress,
  mtSerialize, mtDeserialize,
  MT_HEADING_MAX_NAME,
} = require('../src/moduleText.js');

// ─── Fixtures ─────────────────────────────────────────────────────────────────
//
// SYNTHETIC, deliberately. These mimic the structure observed in a real PDF-extracted module
// — numbered headings, hard wrapping at ~60 chars with words split across lines by hyphens, a
// running header fused to different page numbers, a sidebar interleaved between two rooms,
// and Cyrillic sub-location letters — but not a line of the actual copyrighted text. The
// STRUCTURE is what the parser sees; the prose is invented.
//
// Cyrillic is used because that is what the parser must survive: a Cyrillic capital has to
// pass the heading test, and the sub-location letters А and В here are CYRILLIC, visually
// identical to Latin A and B. If someone reaches for [A-Z] anywhere in this module, the
// sub-location tests are what should start behaving oddly.

const CH = 'ГЛАВА 4: ЗАМОК ТУМАНОВ';   // the running header, page number stuck to it

// A sub-heading that recurs because three rooms share one feature — the shape that the first
// (count-based) furniture rule silently deleted from the real book. It carries no page number,
// which is the whole reason it must survive.
const SUB = 'Кухонный лифт';

const SAMPLE = [
  '1. Вход',
  'Тяжёлые двери из потемневшего дуба стоят при-',
  'открытыми, и сквозь щель тянет холодом. Пол',
  'усыпан сухими листьями.',
  '',
  'Над входом висит герб, расколотый надвое.',
  '31 ' + CH,
  '2. Главный холл',
  'Зал поднимается на две высоты. Спираль-',
  'ная лестница уходит во тьму верхнего этажа.',
  '',
  '3. Кухня',
  'Очаг давно остыл. На крюках висит утварь.',
  SUB,
  'Шахта соединяет два этажа.',
  'Сюда ведут две двери: 3А из холла и 3В из',
  'кладовой.',
  '45 ' + CH,
  '4. Часовня',
  'Витражи выбиты, и ветер гуляет по скамьям.',
  SUB,
  'Тот же подъёмник, снизу.',
  '52' + CH,                 // page number FUSED to the header, no space — as in the real book
  '5. Склеп',
  'Каменные саркофаги стоят в два ряда.',
  SUB,
  'И здесь тоже.',
].join('\n');

// A sidebar: a page of general rules sitting between two room headings. v1 absorbs it into
// the preceding room's description on purpose — the DM deletes it. This fixture is here to
// PIN that behaviour, so a future sidebar classifier changes a failing test rather than
// silently changing what the DM's descriptions contain.
const WITH_SIDEBAR = [
  '1. Вход',
  'Двери приоткрыты.',
  '',
  'ПРОВЕРКИ НА СТРАХ',
  'Каждый раз, когда персонаж впервые видит',
  'нечто ужасное, он проходит проверку.',
  '',
  '2. Главный холл',
  'Зал поднимается на две высоты.',
].join('\n');

// A numbered list inside body prose. It restarts at 1 after room 12, so it cannot extend the
// room sequence — which is the only signal that tells it apart from a heading.
const WITH_LIST = [
  '11. Библиотека',
  'Полки тянутся до потолка.',
  '',
  '12. Кабинет',
  'Чтобы открыть тайник, сделайте следующее:',
  '1. Поверните канделябр',
  '2. Нажмите на камень',
  '3. Отступите назад',
  '',
  '13. Балкон',
  'Отсюда видно всю долину.',
].join('\n');

// ─── mtSplitLines ─────────────────────────────────────────────────────────────

describe('mtSplitLines', () => {
  test('normalises CRLF, tabs and runs of spaces', () => {
    const out = mtSplitLines('a\r\n\tb  c\r\n');
    assert.deepEqual(out, ['a', 'b c', '']);
  });

  test('maps soft hyphens and Unicode hyphens to a plain hyphen', () => {
    // Both must survive as '-' so mtReflow can see "this word was split across lines".
    assert.deepEqual(mtSplitLines('при­\nоткрыт'), ['при-', 'открыт']);
    assert.deepEqual(mtSplitLines('при‐\nоткрыт'), ['при-', 'открыт']);
  });

  test('leaves en and em dashes alone — those are punctuation, not word breaks', () => {
    assert.deepEqual(mtSplitLines('а — б'), ['а — б']);
  });

  test('handles empty and null input', () => {
    assert.deepEqual(mtSplitLines(''), ['']);
    assert.deepEqual(mtSplitLines(null), ['']);
    assert.deepEqual(mtSplitLines(undefined), ['']);
  });
});

// ─── mtHeadingCandidate ───────────────────────────────────────────────────────

describe('mtHeadingCandidate', () => {
  test('accepts a Cyrillic heading — \\p{Lu}, not [A-Z]', () => {
    assert.deepEqual(mtHeadingCandidate('2. Главный холл'), { prefix: '', num: 2, name: 'Главный холл' });
  });

  test('accepts a Latin heading too', () => {
    assert.deepEqual(mtHeadingCandidate('12. Chapel'), { prefix: '', num: 12, name: 'Chapel' });
  });

  test('accepts a single CAPITAL PREFIX on the number — Castle Ravenloft keys К1-К88', () => {
    assert.deepEqual(mtHeadingCandidate('К12. Часовня'), { prefix: 'К', num: 12, name: 'Часовня' });
    assert.deepEqual(mtHeadingCandidate('K12. Chapel'),   { prefix: 'K', num: 12, name: 'Chapel' });
  });

  test('the prefix must touch the digits — "В 1. Комнате" is prose, not a key', () => {
    assert.equal(mtHeadingCandidate('В 1. Комнате стоит стол'), null);
  });

  test('rejects a lowercase name', () => {
    assert.equal(mtHeadingCandidate('2. главный холл'), null);
  });

  test('allows and STRIPS a single trailing period', () => {
    // The .txt sample had none on any of its thirteen headings, which made "ends with a period, so
    // it is a sentence" look safe. The full book falsifies it — "К43. Ванная комната." and
    // "К48. Лестница." are real rooms — so the period is stripped and the line kept. What guards a
    // period-terminated LIST item is the context and sequence passes, not this shape test.
    assert.deepEqual(mtHeadingCandidate('К43. Ванная комната.'),
                     { prefix: 'К', num: 43, name: 'Ванная комната' });
  });

  test('still rejects a line ending mid-clause, or shouting', () => {
    assert.equal(mtHeadingCandidate('1. Дверь заперта,'), null);
    assert.equal(mtHeadingCandidate('1. Готово!'), null);
    assert.equal(mtHeadingCandidate('1. Открыть?'), null);
  });

  test('a PREFIXED key may have a lowercase name; a bare-numbered one may not', () => {
    // "К3. двор прислуги" is a real room whose name lost its capital in typesetting. The prefix is
    // what makes it safe to accept — a numbered list in prose never carries one.
    assert.deepEqual(mtHeadingCandidate('К3. двор прислуги'),
                     { prefix: 'К', num: 3, name: 'двор прислуги' });
    assert.equal(mtHeadingCandidate('3. двор прислуги'), null);
  });

  test('rejects two sentences sharing a line', () => {
    assert.equal(mtHeadingCandidate('1. Дверь заперта. Ключ у смотрителя'), null);
  });

  test('rejects a name longer than MT_HEADING_MAX_NAME', () => {
    assert.equal(mtHeadingCandidate('1. ' + 'Я'.repeat(MT_HEADING_MAX_NAME + 1)), null);
    assert.ok(mtHeadingCandidate('1. ' + 'Я'.repeat(MT_HEADING_MAX_NAME)));
  });

  test('rejects lines without the number-period-space shape', () => {
    ['Вход', '1 Вход', '1.Вход', '1) Вход', '', '   ', '1234. Вход']
      .forEach(l => assert.equal(mtHeadingCandidate(l), null, JSON.stringify(l)));
  });

  test('rejects a running header with a page number fused on', () => {
    assert.equal(mtHeadingCandidate('31 ' + CH), null);
  });

  test('survives null and undefined', () => {
    assert.equal(mtHeadingCandidate(null), null);
    assert.equal(mtHeadingCandidate(undefined), null);
  });
});

// ─── mtHeadingCandidates ──────────────────────────────────────────────────────

describe('mtHeadingCandidates', () => {
  test('finds every heading in the sample, with its line index', () => {
    const got = mtHeadingCandidates(mtDropFurniture(mtSplitLines(SAMPLE)));
    assert.deepEqual(got.map(g => g.num), [1, 2, 3, 4, 5]);
    got.forEach(g => assert.equal(typeof g.i, 'number'));
  });

  test('excludes a list introduced by a colon, and the items that follow it', () => {
    const lines = mtSplitLines([
      'Чтобы открыть тайник, сделайте следующее:',
      '1. Поверните канделябр',
      '2. Нажмите на камень',
      '3. Отступите назад',
    ].join('\n'));
    assert.deepEqual(mtHeadingCandidates(lines), []);
  });

  test('the list flag needs a colon to root it — two terse headings in a row survive', () => {
    // An unrooted "adjacent candidate numbered one lower" rule would eat this pair, and a
    // module with one-line locations is full of them.
    const got = mtHeadingCandidates(mtSplitLines('1. Вход\n2. Главный холл'));
    assert.deepEqual(got.map(g => g.num), [1, 2]);
  });

  test('the colon may be separated from the list by blank lines', () => {
    const got = mtHeadingCandidates(mtSplitLines('Сделайте так:\n\n1. Поверните\n2. Нажмите'));
    assert.deepEqual(got, []);
  });

  test('a heading after an ordinary sentence is kept — the page header that used to sit\n' +
       '     between them is already gone by this point', () => {
    const got = mtHeadingCandidates(mtSplitLines('Над входом висит герб.\n2. Главный холл'));
    assert.deepEqual(got.map(g => g.num), [2]);
  });

  test('handles no lines at all', () => {
    assert.deepEqual(mtHeadingCandidates([]), []);
    assert.deepEqual(mtHeadingCandidates(['', '  ']), []);
  });
});

// ─── mtCanonPrefix ────────────────────────────────────────────────────────────

describe('mtCanonPrefix', () => {
  test('folds the twelve Cyrillic capitals a reader cannot tell from Latin', () => {
    assert.equal(mtCanonPrefix('К'), 'K');
    assert.equal(mtCanonPrefix('Х'), 'X');
    assert.equal(mtCanonPrefix('А'), 'A');
    assert.equal(mtCanonPrefix('Е'), 'E');
  });

  test('leaves a Latin prefix, a distinguishable Cyrillic one, and nothing, alone', () => {
    assert.equal(mtCanonPrefix('K'), 'K');
    assert.equal(mtCanonPrefix('Ж'), 'Ж');    // no Latin lookalike
    assert.equal(mtCanonPrefix('Д'), 'Д');
    assert.equal(mtCanonPrefix(''), '');
    assert.equal(mtCanonPrefix(null), '');
  });

  test('is used for SEQUENCING only — the displayed key keeps its own glyph', () => {
    const { entries } = parseModuleText('К1. Ворота\nДве башни.\nK2. Портик\nНавес.');
    assert.deepEqual(entries.map(e => e.num), ['К1', 'K2']);
  });
});

// ─── mtPickHeadings ───────────────────────────────────────────────────────────

describe('mtPickHeadings', () => {
  const c = (num, i) => ({ num, name: 'n' + num, i });

  test('keeps a clean increasing run whole', () => {
    const got = mtPickHeadings([c(1, 0), c(2, 5), c(3, 9)]);
    assert.deepEqual(got.map(g => g.num), [1, 2, 3]);
  });

  test('rejects a restart — a number that does not continue the sequence', () => {
    // The case that ruled out a longest-increasing-subsequence pass: 1→2→3→13 is a LONGER
    // chain than 11→12→13, so LIS would have picked the list and dropped two real rooms.
    const got = mtPickHeadings([c(11, 0), c(12, 4), c(1, 6), c(2, 7), c(3, 8), c(13, 10)]);
    assert.deepEqual(got.map(g => g.num), [11, 12, 13]);
  });

  test('a repeat of the last number is a restart too, not a heading', () => {
    const got = mtPickHeadings([c(1, 0), c(2, 1), c(1, 5), c(2, 6)]);
    assert.deepEqual(got.map(g => g.i), [0, 1]);
  });

  test('gaps in the numbering are fine — only the direction matters', () => {
    assert.deepEqual(mtPickHeadings([c(1, 0), c(4, 2), c(9, 5)]).map(g => g.num), [1, 4, 9]);
  });

  test('handles a single candidate, none at all, and garbage', () => {
    assert.deepEqual(mtPickHeadings([c(7, 3)]).map(g => g.num), [7]);
    assert.deepEqual(mtPickHeadings([]), []);
    assert.deepEqual(mtPickHeadings(null), []);
  });

  test('each PREFIX runs its own sequence — К1 after 13 is not a restart', () => {
    // One shared counter rejected К1 for not exceeding 13 and lost the entire castle chapter.
    const k = (prefix, num, i) => ({ prefix, num, name: 'n', i });
    const got = mtPickHeadings([k('', 12, 0), k('', 13, 1), k('К', 1, 2), k('К', 2, 3), k('К', 3, 4)]);
    assert.deepEqual(got.map(g => (g.prefix || '') + g.num), ['12', '13', 'К1', 'К2', 'К3']);
  });

  test('a forward JUMP loses to the sequence\'s immediate successor just ahead', () => {
    // The real book's most expensive single line: a cross-reference "К7. Широкое, разбитое окно…"
    // sitting inside К1's own description. Taken as a heading it pushed the sequence to 7, which
    // cost К2-К6 outright and gave the real К7 the wrong name — six rooms for one bad line.
    const k = (num, i) => ({ prefix: 'К', num, name: 'n' + num, i });
    const got = mtPickHeadings([k(1, 0), k(7, 1), k(2, 2), k(3, 3), k(4, 4), k(5, 5), k(6, 6), k(7, 7)]);
    assert.deepEqual(got.map(g => g.num), [1, 2, 3, 4, 5, 6, 7]);
    assert.equal(got[6].i, 7, 'the REAL К7 should win, not the cross-reference at index 1');
  });

  test('but a genuine gap is still taken — there is no successor to prefer', () => {
    const k = (num, i) => ({ prefix: 'К', num, name: 'n', i });
    assert.deepEqual(mtPickHeadings([k(1, 0), k(4, 1), k(9, 2)]).map(g => g.num), [1, 4, 9]);
  });

  test('the successor preference does NOT apply before the sequence starts', () => {
    // Without that guard it means "prefer whatever starts at 1", so a numbered list ahead of rooms
    // keyed from 11 beat the rooms and took the chapter with it. Caught by a test, not by the book.
    const k = (num, i) => ({ prefix: '', num, name: 'n', i });
    const got = mtPickHeadings([k(11, 0), k(12, 1), k(1, 2), k(2, 3), k(3, 4), k(13, 5)]);
    assert.deepEqual(got.map(g => g.num), [11, 12, 13]);
  });

  test('a Cyrillic and a Latin prefix that LOOK the same are one sequence', () => {
    // Measured on the real book: the castle chapter arrives as 40 rooms keyed Cyrillic К plus 2
    // keyed Latin K. Treated as separate chapters, each sequence rejects the other's numbers.
    const k = (prefix, num, i) => ({ prefix, num, name: 'n', i });
    const got = mtPickHeadings([k('К', 1, 0), k('K', 2, 1), k('К', 3, 2)]);
    assert.deepEqual(got.map(g => g.num), [1, 2, 3]);
  });

  test('a restart across the homoglyph pair is still a restart', () => {
    const k = (prefix, num, i) => ({ prefix, num, name: 'n', i });
    assert.deepEqual(mtPickHeadings([k('К', 5, 0), k('K', 2, 1)]).map(g => g.num), [5]);
  });

  test('a restart WITHIN a prefix is still rejected', () => {
    const k = (prefix, num, i) => ({ prefix, num, name: 'n', i });
    const got = mtPickHeadings([k('К', 11, 0), k('К', 12, 1), k('К', 1, 2), k('К', 13, 3)]);
    assert.deepEqual(got.map(g => g.num), [11, 12, 13]);
  });
});

// ─── Page furniture ───────────────────────────────────────────────────────────

describe('mtFurniturePart', () => {
  test('splits the page number off either end, folding the rest', () => {
    assert.deepEqual(mtFurniturePart('31 ' + CH), { num: '31', fused: false, key: CH.toLowerCase() });
    assert.deepEqual(mtFurniturePart(CH + ' 31'), { num: '31', fused: false, key: CH.toLowerCase() });
  });

  test('flags a number fused straight against a CAPITAL as certain furniture', () => {
    assert.equal(mtFurniturePart('209Приложение B: Дом смерти').fused, true);
  });

  test('does NOT flag a number against a lowercase letter — "1к10 дней" is prose', () => {
    assert.equal(mtFurniturePart('1к10 дней дом восстановит себя').fused, false);
  });

  test('a line with no number gets num null — it can never be furniture', () => {
    assert.equal(mtFurniturePart(SUB).num, null);
    assert.equal(mtFurniturePart(SUB).key, SUB.toLowerCase());
  });

  test('a bare page number reduces to an empty key', () => {
    assert.equal(mtFurniturePart('31').key, '');
  });
});

describe('mtDropFurniture', () => {
  test('drops a running header seen with two DIFFERENT page numbers', () => {
    const lines = mtSplitLines(['1. Вход', '3 ' + CH, 'текст', '4 ' + CH].join('\n'));
    assert.equal(mtDropFurniture(lines).filter(l => l.includes(CH)).length, 0);
  });

  test('one fused sighting condemns the key, including its spaced siblings', () => {
    // The real book's exact shape: page 209 fused, page 210 spaced. Both must go, and the
    // count-based rule kept both because two sightings was "too little evidence".
    const lines = mtSplitLines(['209Приложение B: Дом смерти', 'текст',
                                '210 Приложение B: Дом смерти'].join('\n'));
    assert.deepEqual(mtDropFurniture(lines), ['текст']);
  });

  test('NEVER drops a recurring sub-heading — it carries no page number', () => {
    // The regression that made this rule what it is: "Кухонный лифт" appears in three rooms of
    // the real book and the first implementation deleted all three. No count, however high, may
    // condemn a line with no number attached.
    const lines = [SUB, 'a', SUB, 'b', SUB, 'c', SUB, 'd', SUB];
    assert.equal(mtDropFurniture(lines).filter(l => l === SUB).length, 5);
  });

  test('never drops a wrapped prose fragment that starts with a number', () => {
    // Same text, different leading numbers — the page-number shape exactly — but one word, so
    // MT_FURNITURE_MIN_WORDS protects it.
    assert.equal(mtDropFurniture(['10 футов', 'текст', '12 футов']).length, 3);
  });

  test('drops a bare page number on its own line', () => {
    assert.deepEqual(mtDropFurniture(['текст', '31', 'ещё']), ['текст', 'ещё']);
  });

  test('never drops a heading, even two rooms sharing a name under different numbers', () => {
    // "4. Кладовая" and "9. Кладовая" have the same key with differing numbers, which is the
    // condemning shape — the heading exemption is what saves them.
    const lines = ['4. Кладовая', 'a', '9. Кладовая', 'b'];
    assert.equal(mtDropFurniture(lines).filter(l => /Кладовая/.test(l)).length, 2);
  });

  test('never drops a repeated line too long to be a running header', () => {
    const long = '1 ' + 'Э'.repeat(120);
    assert.equal(mtDropFurniture([long, '2 ' + 'Э'.repeat(120)]).length, 2);
  });

  test('keeps every content line of the sample', () => {
    const out = mtDropFurniture(mtSplitLines(SAMPLE));
    assert.ok(out.includes('1. Вход'));
    assert.ok(out.includes('5. Склеп'));
    assert.ok(out.includes('Каменные саркофаги стоят в два ряда.'));
    assert.equal(out.filter(l => l === SUB).length, 3);
    assert.equal(out.filter(l => l.includes(CH)).length, 0);
  });
});

// ─── Paragraph recovery ───────────────────────────────────────────────────────
//
// The real book's extraction has NO blank lines, so this is the only thing standing between a
// room and one wall of text. A fixture with a realistic wrap width lives here for that reason.

// Hard-wrapped at ~46, with a SUB-HEADING and paragraph-final lines that end well short of the
// margin. Those proportions are measured, not invented: in the real text the wrap width sits at
// 47 and paragraph-final lines run 15-30 chars. An earlier version of this fixture had them at
// 41-44, which no real extraction produces, and it made the threshold look wrong when the
// fixture was.
const WRAPPED = [
  'Украшенные железные ворота, с петлями с одной',
  'стороны и замком с другой окружены небольшой',
  'каменной галереей. Ворота незапертые и петли',
  'издают жуткий скрип, когда их открывают. С',
  'крыши галереи свешиваются лампы.',
  'На южной стене фойе висит щит с изображением',
  'герба, а по обе стороны от него портреты в',
  'рамах, изображающие аристократов.',
  'Тайный люк',
  'В юго-западном углу, в полу скрыт люк. Его',
  'невозможно заметить или открыть, если только',
  'герои не окажутся снизу.',
];

describe('mtWrapWidth', () => {
  test('sits near the top of the distribution, not in the middle', () => {
    // A document is a third short lines. The median would report ~40 here — a typical filled
    // line, not the margin — which is the mistake this replaced.
    const lines = ['x'.repeat(50), 'x'.repeat(48), 'x'.repeat(46), 'x'.repeat(44),
                   'x'.repeat(42), 'x'.repeat(40), 'ab', 'cd', 'ef', 'gh'];
    assert.ok(mtWrapWidth(lines) >= 46, 'got ' + mtWrapWidth(lines));
  });

  test('is robust to one freak long line in a way the maximum is not', () => {
    const lines = [...Array(20).fill('x'.repeat(45)), 'x'.repeat(400)];
    assert.equal(mtWrapWidth(lines), 45);
  });

  test('ignores blank lines, and returns 0 when there is nothing to measure', () => {
    assert.equal(mtWrapWidth(['', '  ', 'x'.repeat(30)]), 30);
    assert.equal(mtWrapWidth([]), 0);
    assert.equal(mtWrapWidth(null), 0);
  });
});

describe('mtEndsParagraph', () => {
  const W = 47;

  test('a short line before a capital ends a paragraph', () => {
    assert.equal(mtEndsParagraph('крыши галереи свешиваются лампы.', 'На южной стене фойе висит щит', W), true);
  });

  test('a full-width line ending in a full stop does NOT — that is just a wrap', () => {
    // The abbreviation case: ends in a period, but it runs the whole margin.
    assert.equal(mtEndsParagraph('разным темам: истории, военному делу, алхимии и т.д.', 'Несколько шкафов заняты', W), false);
  });

  test('a SUB-HEADING ends a paragraph even with no terminator', () => {
    // The regression this rule exists for: requiring a full stop glued "Тайный люк" onto the
    // paragraph below it.
    assert.equal(mtEndsParagraph('Тайный люк', 'В юго-западном углу, в полу скрыт люк', W), true);
  });

  test('a short line before a LOWERCASE line does not break — the sentence continues', () => {
    assert.equal(mtEndsParagraph('и вот так.', 'продолжается эта мысль дальше', W), false);
  });

  test('a paragraph starting with a quote or a digit still counts as new', () => {
    assert.equal(mtEndsParagraph('короткая строка.', '«Роза» Дёрст', W), true);
    assert.equal(mtEndsParagraph('короткая строка.', '12 футов высотой', W), true);
  });

  test('a short line at the very end of the input ends its paragraph', () => {
    assert.equal(mtEndsParagraph('последняя строка.', undefined, W), true);
  });

  test('with no wrap width known, nothing ends a paragraph', () => {
    assert.equal(mtEndsParagraph('короткая строка.', 'Следующая', 0), false);
    assert.equal(mtEndsParagraph('короткая строка.', 'Следующая', undefined), false);
  });
});

// ─── mtReflow ─────────────────────────────────────────────────────────────────

describe('mtReflow', () => {
  test('rejoins a word split by a hyphen at the line break', () => {
    assert.equal(mtReflow(['при-', 'открытыми']), 'приоткрытыми');
  });

  test('keeps the hyphen when the next line starts with a capital', () => {
    // A proper-noun compound that happens to wrap at its own hyphen.
    assert.equal(mtReflow(['Сен-', 'Жермен']), 'Сен-Жермен');
  });

  test('joins an ordinary wrap with exactly one space', () => {
    assert.equal(mtReflow(['Пол', 'усыпан листьями.']), 'Пол усыпан листьями.');
  });

  test('a blank line becomes a paragraph break', () => {
    assert.equal(mtReflow(['первый', '', 'второй']), 'первый\n\nвторой');
  });

  test('collapses runs of blank lines to a single break', () => {
    assert.equal(mtReflow(['a', '', '', '', 'b']), 'a\n\nb');
  });

  test('drops leading and trailing blank lines', () => {
    assert.equal(mtReflow(['', '', 'a', '', '']), 'a');
  });

  test('empty and garbage input yield an empty string', () => {
    assert.equal(mtReflow([]), '');
    assert.equal(mtReflow(['', '  ', '']), '');
    assert.equal(mtReflow([null, undefined]), '');
    assert.equal(mtReflow([], 46), '');
  });

  test('without a wrap width, blank-line-free input is ONE paragraph', () => {
    assert.equal(mtReflow(WRAPPED).split('\n\n').length, 1);
  });

  test('with a wrap width, the same input recovers its paragraphs and sub-heading', () => {
    const paras = mtReflow(WRAPPED, mtWrapWidth(WRAPPED)).split('\n\n');
    assert.equal(paras.length, 4);
    assert.match(paras[0], /^Украшенные железные ворота/);
    assert.match(paras[0], /свешиваются лампы\.$/);
    assert.match(paras[1], /^На южной стене фойе/);
    assert.equal(paras[2], 'Тайный люк');          // its own paragraph, not glued below
    assert.match(paras[3], /^В юго-западном углу/);
  });

  test('paragraph recovery does not break a word split across the break', () => {
    const out = mtReflow(['слово разбито попо-', 'лам вот так.', 'Новый абзац.'], 20);
    assert.match(out, /пополам/);
  });
});

// ─── parseModuleText ──────────────────────────────────────────────────────────

describe('parseModuleText', () => {
  test('splits the sample into its five locations, in book order', () => {
    const { entries } = parseModuleText(SAMPLE);
    assert.deepEqual(entries.map(e => e.title), [
      '1. Вход', '2. Главный холл', '3. Кухня', '4. Часовня', '5. Склеп',
    ]);
    assert.deepEqual(entries.map(e => e.num), ['1', '2', '3', '4', '5']);
    assert.equal(entries[1].name, 'Главный холл');
  });

  test('every entry gets a non-empty body', () => {
    parseModuleText(SAMPLE).entries.forEach(e =>
      assert.ok(e.body.length > 0, e.title + ' came through empty'));
  });

  test('bodies are dehyphenated and reflowed', () => {
    const e = parseModuleText(SAMPLE).entries;
    assert.match(e[0].body, /приоткрытыми/);      // "при-" + "открытыми" rejoined
    assert.match(e[1].body, /Спиральная лестница/); // "Спираль-" + "ная" rejoined
    assert.doesNotMatch(e[0].body, /-\n/);         // no hyphen left dangling at a break
  });

  test('the running header is gone from every body', () => {
    parseModuleText(SAMPLE).entries.forEach(e =>
      assert.doesNotMatch(e.body, /ЗАМОК ТУМАНОВ/, e.title + ' kept the running header'));
  });

  test('a sub-heading shared by three rooms reaches all three', () => {
    const e = parseModuleText(SAMPLE).entries;
    ['3', '4', '5'].forEach(num => {
      const room = e.find(x => x.num === num);
      assert.match(room.body, new RegExp(SUB), room.title + ' lost its sub-heading');
    });
  });

  test('paragraph breaks inside a room survive', () => {
    assert.match(parseModuleText(SAMPLE).entries[0].body, /\n\n/);
  });

  test('CYRILLIC sub-location references pass through untouched', () => {
    // А and В here are Cyrillic. They are not parsed in v1 — the requirement is only that
    // they do not break anything and reach the DM's description intact.
    const kitchen = parseModuleText(SAMPLE).entries[2];
    assert.match(kitchen.body, /3А из холла и 3В из кладовой/);
  });

  test('a numbered list in body prose is not mistaken for a heading', () => {
    const { entries } = parseModuleText(WITH_LIST);
    assert.deepEqual(entries.map(e => e.title), ['11. Библиотека', '12. Кабинет', '13. Балкон']);
    // …and the list stays where it belongs, in the body of room 12.
    assert.match(entries[1].body, /Поверните канделябр/);
    assert.match(entries[1].body, /Отступите назад/);
  });

  test('a sidebar is absorbed into the preceding room — pinned, not endorsed', () => {
    // v1 does NOT detect sidebars. If a future version does, this test should be the one that
    // fails and gets rewritten, rather than the change landing unnoticed in DM descriptions.
    const { entries } = parseModuleText(WITH_SIDEBAR);
    assert.equal(entries.length, 2);
    assert.match(entries[0].body, /ПРОВЕРКИ НА СТРАХ/);
    assert.doesNotMatch(entries[1].body, /ПРОВЕРКИ НА СТРАХ/);
  });

  test('empty and garbage input parse to no entries rather than throwing', () => {
    ['', '   ', '\n\n\n', null, undefined, 'просто абзац без заголовков',
     '!!!\n???\n ', '1\n2\n3'].forEach(bad => {
      const r = parseModuleText(bad);
      assert.deepEqual(r.entries, [], JSON.stringify(bad));
    });
  });

  test('a letter-keyed chapter parses, and the key reaches the room name', () => {
    // Castle Ravenloft's shape. The key is in `num` and in `title`, because "К12" is what the DM
    // says out loud and what the map label has to read.
    const { entries } = parseModuleText([
      'К1. Передние ворота',
      'Две башни стоят по обе стороны.',
      'К2. Портик',
      'Каменный навес защищает от дождя.',
      'К88. Склеп Страда',
      'Здесь стоит его гроб.',
    ].join('\n'));
    assert.deepEqual(entries.map(e => e.num), ['К1', 'К2', 'К88']);
    assert.equal(entries[0].title, 'К1. Передние ворота');
    assert.match(entries[2].body, /гроб/);
  });

  test('an appendix and a letter-keyed chapter pasted together both survive', () => {
    const { entries } = parseModuleText([
      '1. Вход', 'Двери приоткрыты.',
      '2. Холл', 'Зал в две высоты.',
      'К1. Ворота', 'Две башни.',
      'К2. Портик', 'Каменный навес.',
    ].join('\n'));
    assert.deepEqual(entries.map(e => e.num), ['1', '2', 'К1', 'К2']);
  });

  test('a letter-keyed room is findable by its key, typed in either case', () => {
    const { entries } = parseModuleText('К12. Часовня\nВитражи выбиты.');
    assert.equal(mtFilterEntries(entries, 'к12')[0].num, 'К12');
    assert.equal(mtFilterEntries(entries, 'К12')[0].num, 'К12');
    assert.equal(mtFilterEntries(entries, '12')[0].num, 'К12');
  });

  test('a document that is nothing but headings still yields entries with empty bodies', () => {
    const { entries } = parseModuleText('1. Вход\n2. Холл');
    assert.equal(entries.length, 2);
    assert.equal(entries[0].body, '');
  });
});

// ─── Search and matching ──────────────────────────────────────────────────────

describe('mtFold', () => {
  test('folds case and whitespace', () => {
    assert.equal(mtFold('  Главный   Холл '), 'главный холл');
  });

  test('strips Latin diacritics', () => {
    assert.equal(mtFold('Café'), 'cafe');
    assert.equal(mtFold('Naïve'), 'naive');
  });

  test('folds ё to е — it is routinely typed that way', () => {
    assert.equal(mtFold('Ёлка'), mtFold('Елка'));
  });

  test('does NOT decompose Cyrillic й into и', () => {
    // The bug a blanket NFD mark-strip introduced: й is и + breve, so "главный" folded to
    // "главныи" and мой/мои became the same word.
    assert.equal(mtFold('Главный'), 'главный');
    assert.notEqual(mtFold('мой'), mtFold('мои'));
  });

  test('survives null', () => {
    assert.equal(mtFold(null), '');
  });
});

describe('mtFilterEntries', () => {
  const entries = parseModuleText(SAMPLE).entries;

  test('an empty query returns everything, in book order', () => {
    assert.equal(mtFilterEntries(entries, '').length, 5);
    assert.equal(mtFilterEntries(entries, '   ')[0].title, '1. Вход');
  });

  test('matches on a name substring, case-insensitively', () => {
    assert.deepEqual(mtFilterEntries(entries, 'холл').map(e => e.num), ['2']);
    assert.deepEqual(mtFilterEntries(entries, 'ХОЛЛ').map(e => e.num), ['2']);
  });

  test('matches on the room number', () => {
    assert.equal(mtFilterEntries(entries, '4')[0].num, '4');
  });

  test('every token must appear — "гл холл" finds "Главный холл"', () => {
    assert.deepEqual(mtFilterEntries(entries, 'гл холл').map(e => e.num), ['2']);
    assert.deepEqual(mtFilterEntries(entries, 'гл склеп'), []);
  });

  test('ranks an exact number, then a prefix, ahead of a mid-word hit', () => {
    const list = [
      { num: '1', name: 'Кладовая кухни', title: '1. Кладовая кухни', body: '' },
      { num: '2', name: 'Кухня',          title: '2. Кухня',          body: '' },
    ];
    assert.equal(mtFilterEntries(list, 'кухня')[0].num, '2');   // startsWith beats contains
  });

  test('no match returns an empty list, not everything', () => {
    assert.deepEqual(mtFilterEntries(entries, 'сокровищница'), []);
  });

  test('survives a null entry list', () => {
    assert.deepEqual(mtFilterEntries(null, 'x'), []);
    assert.deepEqual(mtFilterEntries(undefined, ''), []);
  });
});

describe('mtPlacedTitles / mtProgress', () => {
  const entries = parseModuleText(SAMPLE).entries;

  test('an entry counts as placed when a room carries its title', () => {
    const placed = mtPlacedTitles(entries, ['1. Вход', 'Room 7', '4. Часовня']);
    assert.deepEqual([...placed].sort(), ['1. Вход', '4. Часовня']);
  });

  test('matching is folded, so case and stray whitespace still count', () => {
    assert.equal(mtPlacedTitles(entries, ['  1.   вход  ']).size, 1);
  });

  test('one entry serving several rooms counts once — sub-locations', () => {
    assert.deepEqual(mtProgress(entries, ['3. Кухня', '3. Кухня']), { placed: 1, total: 5 });
  });

  test('progress with nothing placed, and with no entries at all', () => {
    assert.deepEqual(mtProgress(entries, []), { placed: 0, total: 5 });
    assert.deepEqual(mtProgress([], ['1. Вход']), { placed: 0, total: 0 });
    assert.deepEqual(mtProgress(null, null), { placed: 0, total: 0 });
  });

  test('an empty room name never matches an entry', () => {
    assert.equal(mtPlacedTitles(entries, ['', '   ']).size, 0);
  });
});

// ─── Serialisation ────────────────────────────────────────────────────────────

describe('mtSerialize / mtDeserialize', () => {
  const entries = parseModuleText(SAMPLE).entries;

  test('round-trips entries and the source name', () => {
    const got = mtDeserialize(mtSerialize(entries, 'castle.txt'));
    assert.equal(got.sourceName, 'castle.txt');
    assert.deepEqual(got.entries.map(e => e.title), entries.map(e => e.title));
    assert.deepEqual(got.entries.map(e => e.body), entries.map(e => e.body));
    assert.ok(got.savedAt > 0);
  });

  test('rebuilds the derived title rather than storing it', () => {
    assert.doesNotMatch(mtSerialize([{ num: '1', name: 'Вход', body: 'x' }], ''), /title/);
    assert.equal(mtDeserialize(mtSerialize([{ num: '1', name: 'Вход', body: 'x' }], '')).entries[0].title, '1. Вход');
  });

  test('a corrupt, empty or foreign payload deserialises to null, never a throw', () => {
    ['', '{', 'null', '[]', '{"v":99,"e":[]}', '{"v":1}', '{"v":1,"e":"nope"}']
      .forEach(bad => assert.equal(mtDeserialize(bad), null, JSON.stringify(bad)));
    assert.equal(mtDeserialize(null), null);
    assert.equal(mtDeserialize(undefined), null);
  });

  test('skips malformed rows instead of failing the whole payload', () => {
    const got = mtDeserialize('{"v":1,"src":"","at":1,"e":[["1","Вход","x"],["bad"],null]}');
    assert.equal(got.entries.length, 1);
  });

  test('an empty entry list round-trips as an empty list', () => {
    assert.deepEqual(mtDeserialize(mtSerialize([], '')).entries, []);
    assert.deepEqual(mtDeserialize(mtSerialize(null, null)).entries, []);
  });
});
