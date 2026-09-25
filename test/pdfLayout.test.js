'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  plGroupLines, plClassify, plPageLines, plDocumentText,
  PL_LINE_TOL, PL_SPAN_MARGIN,
} = require('../src/content/pdfLayout.js');

// ─── Fixtures ─────────────────────────────────────────────────────────────────
//
// A US-Letter-ish page in PDF points: 612 wide, gutter at 306. Left column runs x 50-290, right
// column x 320-560. y descends down the page, as PDF coordinates do.
//
// SYNTHETIC, and the prose is invented — but the GEOMETRY is taken from the real book, because
// geometry is the only thing this file reasons about.
const W = 612;
const run = (str, x, y, w) => ({ str, x, y, w: w == null ? str.length * 5 : w });

// Two columns of body text, each three lines, the left and right lines SHARING baselines. This is
// the arrangement that broke the first implementation: grouping by y first merges each pair.
const twoColumns = {
  width: W,
  items: [
    run('Левая строка один',   50, 700, 200),
    run('Правая строка один', 320, 700, 200),
    run('Левая строка два',    50, 688, 200),
    run('Правая строка два',  320, 688, 200),
    run('Левая строка три',    50, 676, 200),
    run('Правая строка три',  320, 676, 200),
  ],
};

describe('plClassify', () => {
  test('assigns a run to the column it sits in', () => {
    assert.equal(plClassify(run('x', 50, 700, 200), W), 'left');
    assert.equal(plClassify(run('x', 320, 700, 200), W), 'right');
  });

  test('a run crossing the gutter by more than the margin SPANS', () => {
    assert.equal(plClassify(run('x', 50, 700, 500), W), 'span');
  });

  test('a run that merely touches the gutter does not span', () => {
    // Justified text can reach the gutter; that must not read as a full-width heading.
    assert.equal(plClassify(run('x', 50, 700, 256 + PL_SPAN_MARGIN - 1), W), 'left');
  });

  test('a run entirely right of centre is right, however wide', () => {
    assert.equal(plClassify(run('x', 320, 700, 240), W), 'right');
  });
});

describe('plGroupLines', () => {
  test('joins runs sharing a baseline, left to right', () => {
    const lines = plGroupLines([run('мир', 80, 700, 30), run('Привет ', 50, 700, 30)]);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].text, 'Привет мир');
  });

  test('joins runs with NO separator — a PDF splits words at every kerning change', () => {
    // "Ravenloft" arriving as three runs must not become "Rav en loft".
    assert.equal(plGroupLines([run('Rav', 50, 700, 15), run('en', 65, 700, 10), run('loft', 75, 700, 20)])[0].text,
                 'Ravenloft');
  });

  test('separates lines further apart than the tolerance', () => {
    const lines = plGroupLines([run('первая', 50, 700, 30), run('вторая', 50, 688, 30)]);
    assert.deepEqual(lines.map(l => l.text), ['первая', 'вторая']);
  });

  test('tolerates sub-point baseline jitter within one line', () => {
    const lines = plGroupLines([run('одна', 50, 700, 30), run('строка', 90, 700 + PL_LINE_TOL - 0.5, 30)]);
    assert.equal(lines.length, 1);
  });

  test('orders lines top to bottom (descending y, as PDF counts it)', () => {
    const lines = plGroupLines([run('низ', 50, 600, 30), run('верх', 50, 700, 30)]);
    assert.deepEqual(lines.map(l => l.text), ['верх', 'низ']);
  });

  test('reports the line extent, which is what the column split reads', () => {
    const l = plGroupLines([run('a', 50, 700, 100), run('b', 200, 700, 40)])[0];
    assert.equal(l.x0, 50);
    assert.equal(l.x1, 240);
  });

  test('keeps a space that arrived as its OWN run — some books emit one per word gap', () => {
    // Drop these and the whole book comes out as "А1.Тропаимонашескиекельи".
    assert.equal(plGroupLines([run('Тропа', 50, 700, 30), run(' ', 80, 700, 5), run('и', 85, 700, 5)])[0].text,
                 'Тропа и');
  });

  test('drops blank and whitespace-only runs, and survives junk input', () => {
    assert.deepEqual(plGroupLines([run('  ', 50, 700, 5), run('', 60, 700, 5)]), []);
    assert.deepEqual(plGroupLines([]), []);
    assert.deepEqual(plGroupLines(null), []);
    assert.deepEqual(plGroupLines([null, undefined]), []);
  });
});

describe('plPageLines', () => {
  test('reads the LEFT column fully before the right — never interleaved', () => {
    // THE regression test for this file. Grouping into lines before splitting columns merges each
    // baseline pair into one wide line and yields the columns interleaved sentence by sentence.
    assert.deepEqual(plPageLines(twoColumns), [
      'Левая строка один', 'Левая строка два', 'Левая строка три',
      'Правая строка один', 'Правая строка два', 'Правая строка три',
    ]);
  });

  test('lines keep a single-column width — the interleaving tell is a doubled width', () => {
    const lens = plPageLines(twoColumns).map(t => t.length);
    assert.ok(Math.max(...lens) < 25, 'longest line ' + Math.max(...lens) + ' looks like two merged');
  });

  test('a spanning heading splits the page into bands, and rooms stay under it', () => {
    const page = {
      width: W,
      items: [
        run('Первая колонка сверху',  50, 700, 200),
        run('Вторая колонка сверху', 320, 700, 200),
        run('ГЛАВА 4: ЗАМОК',         50, 650, 500),   // spans the gutter
        run('Первая колонка снизу',   50, 600, 200),
        run('Вторая колонка снизу',  320, 600, 200),
      ],
    };
    assert.deepEqual(plPageLines(page), [
      'Первая колонка сверху', 'Вторая колонка сверху',
      'ГЛАВА 4: ЗАМОК',
      'Первая колонка снизу', 'Вторая колонка снизу',
    ]);
  });

  test('without banding a mid-page heading would land after both columns — it does not', () => {
    const page = {
      width: W,
      items: [
        run('текст до заголовка', 50, 700, 200),
        run('К15. Часовня',       50, 650, 500),
        run('текст после',        50, 600, 200),
      ],
    };
    const out = plPageLines(page);
    assert.ok(out.indexOf('К15. Часовня') < out.indexOf('текст после'));
    assert.ok(out.indexOf('текст до заголовка') < out.indexOf('К15. Часовня'));
  });

  test('a single-column page comes out in plain top-to-bottom order', () => {
    const page = { width: W, items: [
      run('строка один', 50, 700, 500), run('строка два', 50, 688, 500), run('строка три', 50, 676, 500),
    ] };
    assert.deepEqual(plPageLines(page), ['строка один', 'строка два', 'строка три']);
  });

  test('an empty or malformed page yields nothing rather than throwing', () => {
    assert.deepEqual(plPageLines({ width: W, items: [] }), []);
    assert.deepEqual(plPageLines({ width: 0, items: [run('x', 1, 1, 1)] }), []);
    assert.deepEqual(plPageLines({}), []);
    assert.deepEqual(plPageLines(null), []);
  });

  test('spanMargin and lineTol are overridable for an unusual layout', () => {
    // A narrow gutter margin makes a merely-wide left-column line read as spanning.
    const page = { width: W, items: [run('широкая строка', 50, 700, 270)] };
    assert.equal(plPageLines(page, { spanMargin: 1 }).length, 1);
  });
});

describe('plDocumentText', () => {
  test('concatenates pages in order, one line per line', () => {
    const p = w => ({ width: W, items: [run('стр ' + w, 50, 700, 100)] });
    assert.equal(plDocumentText([p(1), p(2)]), 'стр 1\nстр 2');
  });

  test('leaves page furniture in for moduleText.js to remove', () => {
    // Deliberate: a running header is not reliably at a fixed coordinate, but it IS reliably the
    // same text with a different page number — which is what the module parser keys on.
    const page = n => ({ width: W, items: [
      run(n + ' ГЛАВА 4: ЗАМОК ТУМАНОВ', 50, 760, 200),
      run('текст страницы', 50, 700, 200),
    ] });
    const out = plDocumentText([page(31), page(32)]);
    assert.match(out, /31 ГЛАВА/);
    assert.match(out, /32 ГЛАВА/);
  });

  test('survives an empty document', () => {
    assert.equal(plDocumentText([]), '');
    assert.equal(plDocumentText(null), '');
  });
});

// ─── The two layers together ──────────────────────────────────────────────────

describe('pdfLayout feeding moduleText', () => {
  const M = require('../src/content/moduleText.js');

  test('a two-column page of rooms parses into the right rooms, not interleaved ones', () => {
    // End to end over the seam that matters: geometry in, locations out. Left column holds room 1
    // and the start of room 2; the right column continues room 2.
    const page = { width: W, items: [
      run('1. Вход',                        50, 700, 60),
      run('Двери приоткрыты, и сквозь щель', 50, 688, 200),
      run('тянет холодом.',                  50, 676, 100),
      run('2. Главный холл',                 50, 650, 110),
      run('Зал поднимается на две высоты,',  50, 638, 200),
      run('а лестница уходит во тьму',      320, 700, 200),
      run('верхнего этажа.',                320, 688, 110),
    ] };
    const { entries } = M.parseModuleText(plDocumentText([page]));
    assert.deepEqual(entries.map(e => e.title), ['1. Вход', '2. Главный холл']);
    assert.match(entries[0].body, /Двери приоткрыты/);
    assert.match(entries[1].body, /лестница уходит во тьму верхнего этажа/);
    // The failure mode this guards: room 1's text swallowing the right column's continuation.
    assert.doesNotMatch(entries[0].body, /верхнего этажа/);
  });
});

// ─── The stat block copy of the text ──────────────────────────────────────────
//
// Geometry from the 2024 Monster Manual: lore in both columns up top, then a wide stat block box
// whose own two columns start lower down, leaving a gap in the right column at the box's name.
describe('plDocumentBlockText', () => {
  const { plDocumentBlockText } = require('../src/content/pdfLayout.js');
  const { statBlockHeadAt } = require('../src/combat/statBlockBook.js');
  const f = (str, x, y, font) => Object.assign(run(str, x, y, 200), { f: font });
  const box = {
    width: W,
    items: [
      f('Лор слева один', 50, 700, 'L'), f('Лор слева два', 50, 689, 'L'),
      f('Лор справа один', 320, 700, 'L'), f('Лор справа два', 320, 689, 'L'),
      f('Болотный зверь', 50, 640, 'H'), f('Крупная Бестия, Хаотичная Злая', 50, 626, 'S'),
      f('КБ 15', 50, 613, 'S'), f('ПЗ 45 (6d10 + 12)', 50, 603, 'S'),
      f('Действия', 320, 610, 'S'), f('Укус. Бросок атаки: +6.', 320, 596, 'S'),
    ],
  };
  const texts = s => s.split('\n').map(l => l.split('\u0001').pop());
  test('reads the lore above a wide box before the box, each column in turn', () => {
    assert.deepEqual(texts(plDocumentBlockText([box], statBlockHeadAt)), [
      'Лор слева один', 'Лор слева два', 'Лор справа один', 'Лор справа два',
      'Болотный зверь', 'Крупная Бестия, Хаотичная Злая', 'КБ 15', 'ПЗ 45 (6d10 + 12)',
      'Действия', 'Укус. Бросок атаки: +6.',
    ]);
  });
  test('tags each line with the font most of its letters use, then the font it starts in', () => {
    const name = Object.assign(run('Укус.', 320, 580, 30), { f: 'B' });
    const rest = Object.assign(run(' Бросок атаки: +6.', 350, 580, 150), { f: 'S' });
    const out = plDocumentBlockText([{ width: W, items: [name, rest] }], statBlockHeadAt);
    assert.equal(out, 'S\u0001B\u0001Укус. Бросок атаки: +6.');
  });
  test('leaves the rooms text alone', () => {
    assert.equal(plDocumentText([box]).split('\n')[2], 'Болотный зверь');
  });
  test('cuts no band beside a block inside one column, where the other column runs on', () => {
    const inColumn = { width: W, items: box.items.slice(4, 8).concat(
      [700, 689, 678, 667, 656, 645, 634, 623, 612, 601].map((y, i) => f(`Текст справа ${i}`, 320, y, 'L'))) };
    const out = texts(plDocumentBlockText([inColumn], statBlockHeadAt));
    assert.deepEqual(out.slice(0, 4), ['Болотный зверь', 'Крупная Бестия, Хаотичная Злая', 'КБ 15', 'ПЗ 45 (6d10 + 12)']);
  });
});
