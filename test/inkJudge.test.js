'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');
const { judgeRow, measureRow, sizesApart, BOX_LIMIT, PLATE_STEP } = require('../tools/rig/ink.js');

// Chromium lands a text's baseline and an svg's top on whole pixels each on its own. A row read where it lands
// at `at`, moved down by each of the sweep's four offsets: every item's centre snapped from where the code put it. A
// text's baseline is `base` when given, else 4px under its caps middle.
const OFFSETS = [0, 0.25, 0.5, 0.75];
function readings(items, at) {
  return OFFSETS.map((d) => ({ scale: 4, lost: [], items: items.map((it, j) => {
    // A block stands where its line boxes are laid out, which no snap moves.
    const c = it.block ? at + it.y : Math.round(at + d + it.y) - d, base = it.base === undefined ? c + 4 : Math.round(at + d + it.base) - d;
    return { j, what: it.what, box: !!it.box, block: !!it.block, size: it.size, c, base: it.box || it.block ? undefined : base };
  }) }));
}
const LANDINGS = [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9];
const verdicts = (items) => LANDINGS.map((at) => !!judgeRow({ row: 'r', items: [] }, readings(items, at)).fault);

describe('the design sweep judges a row the same wherever it lands', () => {
  it('passes an icon that sits on its text, though one reading alone flips', () => {
    const row = [{ what: 'icon', box: true, y: 10.4 }, { what: '"Reset"', size: 12, y: 10.5 }];
    assert.deepEqual(verdicts(row), LANDINGS.map(() => false));
    const single = LANDINGS.map((at) => Math.abs(readings(row, at)[0].items[0].c - readings(row, at)[0].items[1].c));
    assert.ok(single.includes(0) && single.includes(1), 'one reading reads 0 or 1px depending on the landing');
  });

  it('fails an icon half a pixel off its text at every landing', () => {
    assert.deepEqual(verdicts([{ what: 'icon', box: true, y: 11 }, { what: '"Reset"', size: 12, y: 10.5 }]), LANDINGS.map(() => true));
  });

  it('fails two texts of one size half a pixel apart at every landing, and passes them on one baseline', () => {
    assert.deepEqual(verdicts([{ what: '"a"', size: 12, y: 10.2 }, { what: '"b"', size: 12, y: 10.7 }]), LANDINGS.map(() => true));
    assert.deepEqual(verdicts([{ what: '"a"', size: 12, y: 10.2 }, { what: '"b"', size: 12, y: 10.2 }]), LANDINGS.map(() => false));
  });

  it('fails a box over 1.5px off at one position, whatever its mean', () => {
    const rd = readings([{ what: 'icon', box: true, y: 10 }, { what: '"t"', size: 12, y: 10 }], 0);
    rd[0].items[0].c += 2; rd[1].items[0].c -= 2;
    const j = judgeRow({ row: 'r', items: [] }, rd);
    assert.ok(Math.abs(j.box) <= BOX_LIMIT && /at one position/.test(j.fault), j.fault);
  });
});

describe('the design sweep stands texts of any size on one baseline', () => {
  it('passes a 24px name and an 11px tag on one baseline, and fails them half a pixel apart with their capitals level', () => {
    // On one baseline the tag's caps middle stands 4.5px under the name's.
    assert.deepEqual(verdicts([{ what: '"Name"', size: 24, y: 10, base: 18.5 }, { what: '"MM14"', size: 11, y: 14.5, base: 18.5 }]), LANDINGS.map(() => false));
    assert.deepEqual(verdicts([{ what: '"Name"', size: 24, y: 10, base: 18.5 }, { what: '"MM14"', size: 11, y: 10, base: 18 }]), LANDINGS.map(() => true));
  });

  it('keeps bare texts within 1.5x of each other in size and no further', () => {
    for (const ok of [[12, 11], [13, 12, 12], [18, 12], [14]]) assert.equal(sizesApart(ok), false, ok.join(' and '));
    for (const bad of [[24, 11], [22, 11], [12, 24], [19, 12]]) assert.equal(sizesApart(bad), true, bad.join(' and '));
  });

  it('judges a box against the capitals of the row\'s main text, not a smaller text beside it', () => {
    const row = (iconAt) => [{ what: '"Name"', size: 24, y: 10, base: 14 }, { what: '"tag"', size: 16, y: 12, base: 14 }, { what: 'icon', box: true, y: iconAt }];
    assert.deepEqual(verdicts(row(10)), LANDINGS.map(() => false));
    assert.deepEqual(verdicts(row(12)), LANDINGS.map(() => true));
    assert.deepEqual(verdicts(row(10.5)), LANDINGS.map(() => true));
  });
});

// A screenshot at 4 device px per CSS px: a surface with rectangles painted on it, as [x0, x1, y0, y1, rgb] in device px.
function shot(w, h, surface, rects) {
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let c = surface;
    for (const [x0, x1, y0, y1, rgb] of rects) if (x >= x0 && x < x1 && y >= y0 && y < y1) c = rgb;
    px.set([...c, 255], (y * w + x) * 4);
  }
  return { img: { w, h, px }, clip: { x: 0, y: 0, width: w / 4, height: h / 4 } };
}
const token = (name) => {
  const v = fs.readFileSync(path.join(__dirname, '../src/css/base.css'), 'utf8').match(new RegExp(name + ':\\s*([^;]+);'))[1].trim();
  return v.startsWith('#') ? [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)) : v.match(/[\d.]+/g).map(Number);
};

describe('the design sweep reads a faint plate by its edges', () => {
  const bg = token('--g-bg'), INK = [228, 230, 234];
  const over = (lay) => bg.map((c, i) => Math.round(lay[i] * lay[3] + c * (1 - lay[3])));
  const fills = { '--g-field': token('--g-field'), '--g-lay-field': over(token('--g-lay-field')),
    '--g-raised': token('--g-raised'), '--g-lay-raised': over(token('--g-lay-raised')) };

  it('steps under the faintest plate the design system paints', () => {
    for (const [name, f] of Object.entries(fills)) assert.ok(Math.max(...f.map((c, i) => Math.abs(c - bg[i]))) > PLATE_STEP, name);
  });

  for (const [name, fill] of Object.entries(fills)) it('finds a ' + name + ' key cap\'s middle, not its letters\' ink with a tail under it', () => {
    // The plate spans CSS 5..15; its letters stand high and one hangs to the plate's foot.
    const { img, clip } = shot(80, 80, bg, [[0, 80, 20, 60, fill], [30, 34, 28, 52, INK], [36, 40, 30, 58, INK]]);
    const m = measureRow(img, clip, { items: [{ kind: 'plate', what: 'kbd', x0: 0, x1: 20, y0: 5, y1: 15 }] });
    assert.ok(Math.abs(m.items[0].c - 10) < 0.05, name + ' plate read at ' + m.items[0].c);
  });

  it('leaves a box of its surface\'s own colour to its ink', () => {
    const { img, clip } = shot(80, 80, bg, [[0, 80, 20, 60, bg.map((c) => c + 4)], [30, 34, 28, 58, INK]]);
    const m = measureRow(img, clip, { items: [{ kind: 'plate', what: 'kbd', x0: 0, x1: 20, y0: 5, y1: 15 }] });
    assert.ok(Math.abs(m.items[0].c - 10) > 0.2, 'read by its ink at ' + m.items[0].c);
  });
});

describe('the design sweep reads a text\'s cap line from flat capitals only', () => {
  // Baseline at device 40, cap height 7 CSS px (28 device): flat capitals top out at 12, a round one or a digit at 11.
  const text = (what, x, letters) => {
    const rects = [], chars = [];
    letters.forEach(([ch, top, bottom], i) => { const x0 = x + i * 12; rects.push([x0, x0 + 8, top, bottom, [255, 255, 255]]); chars.push([x0 / 4, (x0 + 8) / 4, ch]); });
    return { rects, item: { kind: 'text', what, x0: x / 4, x1: (x + letters.length * 12) / 4, y0: 2, y1: 12, chars, capH: 7, size: 12 } };
  };
  const centre = (letters) => {
    const t = text('t', 0, letters), { img, clip } = shot(60, 56, [0, 0, 0], t.rects);
    return measureRow(img, clip, { items: [t.item] }).items[0];
  };
  const flat = centre([['Н', 12, 40], ['ш', 20, 40], ['ш', 20, 40]]).c;

  for (const [why, first] of [['a round О', 'О'], ['a round С', 'С'], ['a Q', 'Q'], ['a digit', '5']]) it('stands a text whose only capital is ' + why + ' where a flat one stands', () => {
    const it2 = centre([[first, 11, 41], ['ш', 20, 40], ['ш', 20, 40]]);
    assert.equal(it2.capsFrom, 'font');
    assert.ok(Math.abs(it2.c - flat) < 0.01, why + ' read at ' + it2.c + ', flat at ' + flat);
  });

  it('still reads a flat capital that stands off the cap line', () => {
    assert.ok(Math.abs(centre([['Н', 10, 40], ['ш', 20, 40]]).c - flat) >= 0.25);
  });
});

describe('the design sweep judges a box against texts on one baseline by their shared caps middle', () => {
  // Two texts of one size on one baseline whose cap middles read a quarter pixel apart, and a box between them.
  const rows = (boxAt) => OFFSETS.map(() => ({ scale: 4, lost: [], items: [
    { j: 0, what: '"5.14.3"', box: false, size: 12, c: 10.0, base: 14 },
    { j: 1, what: '"15 нояб."', box: false, size: 12, c: 10.27, base: 14 },
    { j: 2, what: 'chev', box: true, c: boxAt }] }));

  it('passes a box on their shared middle', () => {
    const j = judgeRow({ row: 'r', items: [] }, rows(10.0));
    assert.equal(j.fault, undefined, j.fault);
  });

  it('fails a box half a pixel off their shared middle', () => {
    assert.match(judgeRow({ row: 'r', items: [] }, rows(10.64)).fault || '', /a box stands/);
  });

  it('judges a box against each text when their baselines part', () => {
    const rd = rows(10.0);
    for (const r of rd) r.items[1].base = 14.5;
    assert.match(judgeRow({ row: 'r', items: [] }, rd).fault || '', /baselines/);
  });
});

describe('the design sweep centres a box beside a two-line block on the block as laid out', () => {
  // A name over its source: the block's middle runs from its first line's line box top to its last line's line box
  // bottom, as `align-items: center` places a button beside it.
  it('passes a box on the block\'s middle and fails one half a pixel off, wherever the row lands', () => {
    const row = (boxAt) => [{ what: '"Name" over "Source"', block: true, y: 14 }, { what: 'button', box: true, y: boxAt }];
    for (const at of LANDINGS) {
      const j = judgeRow({ row: 'r', items: [] }, readings(row(14), at));
      assert.ok(j.pairs.some((p) => p.kind === 'box') && !j.fault, 'judged and passed at ' + at + ': ' + JSON.stringify(j.pairs) + ' ' + j.fault);
    }
    assert.deepEqual(verdicts(row(14.5)), LANDINGS.map(() => true));
    assert.deepEqual(verdicts(row(13.5)), LANDINGS.map(() => true));
  });

  // At 4 device px per CSS px: the first line's capitals 12..40 under a line box from 4, the last line's 72..100 with
  // its line box trimmed to the baseline at 100 and a у hanging to 112. The line boxes' middle is 52 (13 CSS px); the
  // ink, capitals to baseline, would put it at 56 (14), and the first line's capitals at 26 (6.5).
  const W = [255, 255, 255];
  const block = { kind: 'block', what: '"Name"', x0: 0, x1: 20, y0: 1, y1: 29, top: 1, bottom: 25 };
  const judged = (iconTop) => {
    const { img, clip } = shot(80, 120, [0, 0, 0], [[0, 8, 12, 40], [12, 20, 12, 40], [0, 8, 72, 100], [12, 20, 72, 100], [24, 32, 80, 112], [50, 66, iconTop, iconTop + 20]].map((r) => r.concat([W])));
    const m = measureRow(img, clip, { items: [block, { kind: 'icon', what: 'button', x0: 12.5, x1: 16.5, y0: iconTop / 4 - 2, y1: iconTop / 4 + 7 }] });
    return judgeRow({ row: 'r', items: [] }, [m]);
  };
  const pair = (j) => j.pairs.find((x) => x.kind === 'box' && x.a === '"Name"');

  it('passes a box on the middle of the block\'s line boxes, though its ink\'s middle stands a pixel lower', () => {
    const j = judged(42), p = pair(j);
    assert.ok(p && Math.abs(p.mean) < 0.05 && !j.fault, JSON.stringify(j.pairs) + ' ' + j.fault);
  });

  it('fails a box half a pixel off the middle of the block\'s line boxes, either way', () => {
    for (const [top, mean] of [[44, -0.5], [40, 0.5]]) {
      const j = judged(top), p = pair(j);
      assert.ok(p && Math.abs(p.mean - mean) < 0.05, 'the box judged ' + mean + 'px off the block: ' + JSON.stringify(j.pairs));
      assert.match(j.fault || '', /a box stands/);
    }
  });

  it('fails a box on the middle of the block\'s ink', () => {
    const j = judged(46), p = pair(j);
    assert.ok(p && Math.abs(p.mean + 1) < 0.05, 'the box judged 1px below the block: ' + JSON.stringify(j.pairs));
    assert.match(j.fault || '', /a box stands/);
  });

  it('fails a box on the first line\'s capitals', () => {
    const j = judged(16), p = pair(j);
    assert.ok(p && Math.abs(p.mean - 6.5) < 0.05, 'the box judged 6.5px above the block: ' + JSON.stringify(j.pairs));
    assert.match(j.fault || '', /a box stands/);
  });
});

describe('the design sweep judges a row with no text by its boxes as laid out', () => {
  // Tool buttons of one size, centred alike: each icon's drawing sits differently inside its viewBox, so their ink
  // middles part while their boxes do not.
  const row = (lays, inks) => OFFSETS.map(() => ({ scale: 4, lost: [], items: lays.map((lay, j) => ({ j, what: 'tool' + j, box: true, c: inks[j], lay })) }));

  it('passes buttons whose boxes share a middle, though their icons\' ink parts by a pixel', () => {
    const j = judgeRow({ row: 'r', items: [] }, row([20, 20, 20], [20, 19.5, 20.5]));
    assert.equal(j.fault, undefined, j.fault);
  });

  it('fails a button half a pixel off the others, whatever its icon\'s ink', () => {
    assert.match(judgeRow({ row: 'r', items: [] }, row([20, 20.5, 20], [20, 20, 20])).fault || '', /a box stands/);
  });

  it('still judges an icon beside text by its ink', () => {
    const rd = OFFSETS.map(() => ({ scale: 4, lost: [], items: [
      { j: 0, what: '"Reset"', box: false, size: 12, c: 20, base: 24 }, { j: 1, what: 'icon', box: true, c: 20.5, lay: 20 }] }));
    assert.match(judgeRow({ row: 'r', items: [] }, rd).fault || '', /a box stands/);
  });

  it('gives an icon and a plate read by its ink their layout middle, and a painted plate none', () => {
    const { img, clip } = shot(80, 80, [0, 0, 0], [[8, 24, 22, 50, [255, 255, 255]], [40, 72, 20, 60, [60, 60, 60]]]);
    const m = measureRow(img, clip, { items: [{ kind: 'icon', what: 'ic', x0: 1, x1: 7, y0: 4, y1: 16 }, { kind: 'plate', what: 'pl', x0: 10, x1: 18, y0: 5, y1: 15 }] });
    assert.equal(m.items[0].lay, 10);
    assert.equal(m.items[1].lay, undefined);
  });
});

describe('the design sweep reads a text in a plate too faint to read by its capitals', () => {
  // A plate under the fill step, CSS 5..15; its text's capitals 6..14 (device 24..56) and an р hanging to device 66.
  const faint = [40, 40, 40], INK = [228, 230, 234];
  const plateWith = (capTop) => {
    const rects = [[0, 80, 20, 60, faint.map((c) => c + 4)], [20, 28, capTop, 56, INK], [32, 40, 32, 66, INK], [44, 52, capTop, 56, INK]];
    const { img, clip } = shot(80, 80, faint, rects);
    const text = { kind: 'text', what: '"Нрт"', x0: 4, x1: 14, y0: 5, y1: 15, capH: 8, size: 12, chars: [[5, 7, 'Н'], [8, 10, 'р'], [11, 13, 'Т']] };
    return measureRow(img, clip, { items: [{ kind: 'plate', what: 'save', x0: 0, x1: 20, y0: 5, y1: 15, text }] }).items[0];
  };

  it('stands it on its capitals\' middle, not its whole ink with the tail', () => {
    const it = plateWith(24);
    assert.ok(Math.abs(it.c - 10) < 0.05, 'read at ' + it.c);
  });

  it('still reads its capitals half a pixel high', () => {
    const it = plateWith(20);
    assert.ok(Math.abs(it.c - 9.5) < 0.05, 'read at ' + it.c);
  });
});

describe('the design sweep reads an all-digit text\'s cap line from its flat-topped digits', () => {
  // Baseline at device 40; the font's cap height says 7.25 CSS px (top at 11), the digits stand 7 (top at 12), and a
  // round 0 overshoots to 11.
  const digits = (letters) => {
    const rects = [], chars = [];
    letters.forEach(([ch, top], i) => { const x0 = i * 12; rects.push([x0, x0 + 8, top, 40, [255, 255, 255]]); chars.push([x0 / 4, (x0 + 8) / 4, ch]); });
    const { img, clip } = shot(60, 56, [0, 0, 0], rects);
    return measureRow(img, clip, { items: [{ kind: 'text', what: 't', x0: 0, x1: letters.length * 3, y0: 2, y1: 12, chars, capH: 7.25, size: 11 }] }).items[0];
  };

  it('takes "50" by its 5', () => {
    const it = digits([['5', 12], ['0', 11]]);
    assert.equal(it.capsFrom, 'ink');
    assert.ok(Math.abs(it.c - 6.5) < 0.01, 'read at ' + it.c);
  });

  it('still reads a flat digit half a pixel off the cap line', () => {
    assert.ok(Math.abs(digits([['5', 10], ['0', 11]]).c - 6.5) >= 0.25);
  });

  it('takes "80" by the font\'s cap height', () => {
    const it = digits([['8', 11], ['0', 11]]);
    assert.equal(it.capsFrom, 'font');
    assert.ok(Math.abs(it.c - 6.375) < 0.01, 'read at ' + it.c);
  });
});
