'use strict';

// ink.js — where a row's items stand as rendered, read off a screenshot's pixels (lib.inkSweep). The font's metrics
// say where a text should sit; Chromium lands each text's baseline on a whole pixel on its own, and a glyph with no
// capitals sits wherever its font put it, so only the ink says what the eye sees.

const zlib = require('zlib');

// A PNG as { w, h, px } with px RGBA. Chromium writes 8-bit RGB or RGBA, never interlaced.
function decodePng(buf) {
  let w = 0, h = 0, type = 0;
  const idat = [];
  for (let at = 8; at < buf.length;) {
    const len = buf.readUInt32BE(at), kind = buf.toString('ascii', at + 4, at + 8), data = buf.subarray(at + 8, at + 8 + len);
    if (kind === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4); type = data[9];
      if (data[8] !== 8 || data[12] !== 0 || (type !== 2 && type !== 6)) throw new Error('ink.js reads 8-bit RGB(A) PNGs only');
    } else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    at += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), bpp = type === 6 ? 4 : 3, stride = w * bpp;
  const px = Buffer.alloc(w * h * 4), prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    raw.copy(cur, 0, y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let p = 0;
      if (f === 1) p = a; else if (f === 2) p = b; else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = (cur[i] + p) & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      px[o] = cur[x * bpp]; px[o + 1] = cur[x * bpp + 1]; px[o + 2] = cur[x * bpp + 2]; px[o + 3] = bpp === 4 ? cur[x * bpp + 3] : 255;
    }
    cur.copy(prev);
  }
  return { w, h, px };
}

// Per column of a region: the top and bottom edge of its ink to a fraction of a pixel, and how solid it gets. Ink is
// anything off the region's commonest colour, in proportion to the strongest such pixel.
function columns(img, X0, X1, Y0, Y1) {
  const hist = new Map();
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
    const o = (y * img.w + x) * 4, k = (img.px[o] >> 3) << 10 | (img.px[o + 1] >> 3) << 5 | img.px[o + 2] >> 3;
    const e = hist.get(k); if (e) { e.n++; e.r += img.px[o]; e.g += img.px[o + 1]; e.b += img.px[o + 2]; } else hist.set(k, { n: 1, r: img.px[o], g: img.px[o + 1], b: img.px[o + 2] });
  }
  let bg = null;
  for (const e of hist.values()) if (!bg || e.n > bg.n) bg = e;
  const br = bg.r / bg.n, bgG = bg.g / bg.n, bb = bg.b / bg.n;
  const d = new Float32Array((X1 - X0) * (Y1 - Y0));
  let max = 0;
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
    const o = (y * img.w + x) * 4, v = Math.max(Math.abs(img.px[o] - br), Math.abs(img.px[o + 1] - bgG), Math.abs(img.px[o + 2] - bb));
    d[(y - Y0) * (X1 - X0) + x - X0] = v; if (v > max) max = v;
  }
  // Too faint to be anything drawn: a spacer, or a box of the surface's own colour.
  if (max < 24) return [];
  const out = [];
  for (let x = X0; x < X1; x++) {
    let top = null, bottom = null, solid = 0;
    for (let y = Y0; y < Y1; y++) {
      const c = Math.min(1, d[(y - Y0) * (X1 - X0) + x - X0] / (max * 0.9));
      if (c > solid) solid = c;
      if (c > 0.1) { if (top === null) top = y + 1 - c; bottom = y + c; }
    }
    if (top !== null) out.push({ x, top, bottom, solid });
  }
  return out;
}

// The edge most columns share: the commonest whole pixel, then the mean of the edges that round to it.
function shared(vals) {
  if (!vals.length) return null;
  const n = new Map();
  for (const v of vals) n.set(Math.round(v), (n.get(Math.round(v)) || 0) + 1);
  let best = null;
  for (const [k, c] of n) if (best === null || c > n.get(best)) best = k;
  const near = vals.filter((v) => Math.abs(v - best) <= 0.5);
  return near.reduce((a, b) => a + b, 0) / near.length;
}

// The least a fill must step off what it lies on, per channel, to be read by its edges. The faintest plates the
// design system paints, --g-raised/--g-lay-raised and --g-field/--g-lay-field on --g-bg, step 9-14; below 8 a row is
// one surface, and the colour binning's own noise stays under it.
const PLATE_STEP = 8;

// A filled box's middle, from its painted edges: per row the commonest colour across the box (a text inside it is
// the minority), against the surface one CSS px outside its top and its bottom. A fill or a border all round reads
// the same way; a rounded end shortens the first rows on both sides alike, so the middle holds. Null when the box
// shows no edge against its surface.
function plateMiddle(img, X0, X1, Y0, Y1, pad) {
  const top = Y0 - pad, bot = Y1 + pad;
  if (top < 0 || bot > img.h || X1 - X0 < 1) return null;
  const prof = [];
  for (let y = top; y < bot; y++) {
    const hist = new Map();
    for (let x = X0; x < X1; x++) {
      const o = (y * img.w + x) * 4, k = (img.px[o] >> 3) << 10 | (img.px[o + 1] >> 3) << 5 | img.px[o + 2] >> 3;
      const e = hist.get(k); if (e) { e.n++; e.r += img.px[o]; e.g += img.px[o + 1]; e.b += img.px[o + 2]; } else hist.set(k, { n: 1, r: img.px[o], g: img.px[o + 1], b: img.px[o + 2] });
    }
    let m = null;
    for (const e of hist.values()) if (!m || e.n > m.n) m = e;
    prof.push([m.r / m.n, m.g / m.n, m.b / m.n]);
  }
  const dist = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  const dT = prof.map((c) => dist(c, prof[0])), dB = prof.map((c) => dist(c, prof[prof.length - 1]));
  const mT = Math.max(...dT), mB = Math.max(...dB);
  if (mT < PLATE_STEP || mB < PLATE_STEP) return null;
  const first = dT.findIndex((d) => d >= mT / 2), last = dB.length - 1 - [...dB].reverse().findIndex((d) => d >= mB / 2);
  if (last <= first) return null;
  // The edge row and the one outside it are each covered in proportion to their colour's way to the fill's.
  const refT = Math.max(dT[first], dT[first + 1] || 0), refB = Math.max(dB[last], dB[last - 1] || 0);
  const cov = (d, ref) => Math.min(1, d / ref);
  const edgeT = first + 1 - cov(dT[first], refT) - (first > 0 ? cov(dT[first - 1], refT) : 0);
  const edgeB = last + cov(dB[last], refB) + (last + 1 < dB.length ? cov(dB[last + 1], refB) : 0);
  return top + (edgeT + edgeB) / 2;
}

// Capitals whose top is flat on the cap line. A round one (О, С, Q, G) and a digit overshoot it, so a text read by
// them stands higher than one of the same size read by flat ones; Й, Ё and Ф reach above it.
const FLAT_CAPS = /[A-BD-FH-NPRT-ZАБВГДЕЖИК-НПРТУХ-ЬЯ]/;
// Digits whose top is flat on the cap line, for a text of digits alone; a round 0, 3 or 8 overshoots it.
const FLAT_DIGITS = /[1457]/;
// Letters whose ink hangs below the baseline.
const TAILS = /[QДЦЩgjpqyдруфцщ]/;

// One reading of a row: each item's centre in CSS px from the viewport's top, less `dy[j]`, how far the shift under
// way moved that item. A text by the middle of its capitals, with its baseline beside it; a block of several lines by
// its line boxes; a glyph or an icon by its ink; a filled box by its painted edges, or by its text's capitals when its
// fill is too faint to read. An icon, a box's text and a plate not read by its edges also carry `lay`, the middle of its
// box as laid out, which judgeRow compares in a row with no text.
function measureRow(img, clip, row, dy) {
  const S = img.w / clip.width;
  const items = [], lost = [];
  const at = (j) => (dy ? dy[j] : 0);
  const region = (it, j, padY) => [Math.max(0, Math.floor((it.x0 - clip.x) * S)), Math.min(img.w, Math.ceil((it.x1 - clip.x) * S)),
    Math.max(0, Math.floor((it.y0 + at(j) - padY - clip.y) * S)), Math.min(img.h, Math.ceil((it.y1 + at(j) + padY - clip.y) * S))];
  const inkMiddle = (X0, X1, Y0, Y1) => {
    const cols = X1 - X0 >= 2 && Y1 - Y0 >= 2 ? columns(img, X0, X1, Y0, Y1) : [];
    return cols.length ? (Math.min(...cols.map((k) => k.top)) + Math.max(...cols.map((k) => k.bottom))) / 2 : null;
  };
  const css = (v, j) => v / S + clip.y - at(j);
  // A line of text, in device px of the shot: its baseline from the glyph bottoms most columns share, its cap top from
  // its flat capitals' tops, or the font's cap height when it has none. Null when its ink cannot be read.
  const readText = (it, j) => {
    const [X0, X1, Y0, Y1] = region(it, j, 0);
    const cols = X1 - X0 >= 2 && Y1 - Y0 >= 2 ? columns(img, X0, X1, Y0, Y1) : [];
    if (!cols.length) return null;
    // Per letter: its lowest solid ink (a letter with no tail stands on the baseline) and, for a capital, its highest. The
    // half-lit columns at a stroke's sides carry no edge.
    const solid = cols.filter((k) => k.solid >= 0.9), bottoms = [], tops = [];
    const flat = it.chars.length && it.chars.every((c) => /\d/.test(c[2])) ? FLAT_DIGITS : FLAT_CAPS;
    for (const [a, b, ch] of it.chars) {
      const mine = solid.filter((k) => k.x + 0.5 >= (a - clip.x) * S && k.x + 0.5 <= (b - clip.x) * S);
      if (!mine.length) continue;
      if (!TAILS.test(ch)) bottoms.push(Math.max(...mine.map((k) => k.bottom)));
      if (flat.test(ch)) tops.push(Math.min(...mine.map((k) => k.top)));
    }
    const base = shared(bottoms);
    if (base === null) return null;
    const capTop = shared(tops);
    return { base, top: capTop === null ? base - it.capH * S : capTop, capsFrom: capTop === null ? 'font' : 'ink' };
  };
  row.items.forEach((it, j) => {
    // A block of two or more lines stands as laid out, by the middle of its first line box's top and its last one's
    // bottom (lib.alignSweep reads them), which no snap moves; its ink is not where align-items centres a box on it.
    if (it.kind === 'block') { items.push({ j, what: it.what, block: true, c: (it.top + it.bottom) / 2 }); return; }
    if (it.kind === 'plate') {
      const X0 = Math.max(0, Math.round((it.x0 - clip.x) * S)), X1 = Math.min(img.w, Math.round((it.x1 - clip.x) * S));
      let c = plateMiddle(img, X0, X1, Math.round((it.y0 + at(j) - clip.y) * S), Math.round((it.y1 + at(j) - clip.y) * S), Math.round(S));
      let lay;
      if (c === null) {
        lay = (it.y0 + it.y1) / 2;
        const t = it.text && readText(it.text, j);
        c = t ? (t.top + t.base) / 2 : inkMiddle(...region(it, j, 1));
      }
      if (c === null) lost.push(it.what); else items.push({ j, what: it.what, box: true, c: css(c, j), lay });
      return;
    }
    if (it.kind !== 'text') {
      const c = inkMiddle(...region(it, j, it.kind === 'icon' ? 1 : 0));
      if (c !== null) items.push({ j, what: it.what, box: true, c: css(c, j), lay: it.kind === 'icon' ? (it.y0 + it.y1) / 2 : undefined });
      return;
    }
    const t = readText(it, j);
    if (!t) { lost.push(it.what); return; }
    items.push({ j, what: it.what, box: !!it.box, size: it.size, c: css((t.top + t.base) / 2, j), base: css(t.base, j), capsFrom: t.capsFrom, lay: it.lay });
  });
  return { scale: S, items, lost };
}

// Bare texts more than 1.5x apart in size do not share a row: the smaller one goes on its own line. Also run in the
// page, as source (lib.alignSweep).
function sizesApart(sizes) {
  return sizes.length > 1 && Math.max(...sizes) > 1.5 * Math.min(...sizes) + 1e-6;
}

// A row judged on its readings, each taken with the row moved by a different fraction of a pixel. Chromium snaps a
// text's baseline and an svg's top to whole pixels on their own, so one reading of two items is their offset plus or
// minus a snap that depends on where the row landed; the mean over N evenly spread fractions is the offset the code
// put there, to within 1/N wherever it lands. Texts compare baselines whatever their sizes, within one device pixel at
// 4x. A box compares its middle with the caps middle of the row's main (largest) text within BOX_LIMIT, and no single
// reading of it may stand over SNAP_LIMIT apart (a mean within the limit reads under 1 + BOX_LIMIT); a row with no
// bare text compares its boxes with each other, each by its box as laid out (`lay`) where it has one: an icon's
// drawing sits wherever its viewBox puts it, and the rule centres it by its box. `near` says a mean lies within 1/N of a limit, where the landing could
// still tip it: inkSweep then reads it at more fractions.
const BOX_LIMIT = 0.25, SNAP_LIMIT = 1.5;
function judgeRow(row, readings) {
  const S = readings[0].scale, TEXT_LIMIT = 1 / S + 1e-6;
  const byJ = new Map();
  readings.forEach((r, k) => { for (const i of r.items) { if (!byJ.has(i.j)) byJ.set(i.j, { what: i.what, box: i.box, block: i.block, size: i.size, at: [] }); byJ.get(i.j).at[k] = i; } });
  const its = [...byJ.values()];
  const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
  // Each item's mean centre, for the line that names the fault.
  for (const it of its) it.mean = mean(it.at.filter(Boolean).map((x) => x.c));
  const out = { row: row.row, scale: S, items: its.map((i) => ({ what: i.what, box: i.box, c: +i.mean.toFixed(3), readings: i.at.map((x) => (x ? +x.c.toFixed(3) : null)),
    bases: i.box || i.block ? undefined : i.at.map((x) => (x ? +x.base.toFixed(3) : null)), size: i.size })),
    lost: [...new Set(readings.flatMap((r) => r.lost))], pairs: [] };
  if (its.length < 2) return out;
  let text = 0, box = 0, snap = 0, near = false;
  const tip = (m, limit) => { if (Math.abs(Math.abs(m) - limit) < 1 / readings.length) near = true; };
  const pairOf = (A, B) => readings.map((r, k) => A.at[k] && B.at[k] ? [A.at[k], B.at[k]] : null).filter(Boolean);
  const texts = its.filter((i) => !i.box && !i.block), apart = new Set();
  for (let a = 0; a < texts.length; a++) for (let b = a + 1; b < texts.length; b++) {
    const A = texts[a], B = texts[b], both = pairOf(A, B);
    if (!both.length) continue;
    const m = mean(both.map(([x, y]) => x.base - y.base));
    out.pairs.push({ a: A.what, b: B.what, kind: 'baseline', mean: +m.toFixed(3) });
    tip(m, TEXT_LIMIT);
    if (Math.abs(m) > TEXT_LIMIT) { apart.add(A); apart.add(B); }
    text = Math.max(text, Math.abs(m));
  }
  // Beside a block of two or more lines a box centres on the block. Otherwise the main text is the row's largest.
  // Several of it on one baseline share one cap line, though each one's cap top is read from other letters: a box is
  // judged against their shared caps middle, or against each when they part.
  const main = texts.filter((i) => i.size === Math.max(...texts.map((t) => t.size)));
  const boxes = its.filter((i) => i.box), sides = [], blocks = its.filter((i) => i.block);
  if (blocks.length) sides.push(...blocks);
  else if (main.length > 1 && !main.some((i) => apart.has(i))) {
    sides.push({ what: main.map((i) => i.what).join(' + '), at: readings.map((r, k) => (main.every((i) => i.at[k]) ? { c: mean(main.map((i) => i.at[k].c)) } : null)) });
  } else sides.push(...main);
  const versus = sides.length ? boxes.flatMap((B) => sides.map((A) => [A, B])) : boxes.flatMap((A, a) => boxes.slice(a + 1).map((B) => [A, B]));
  const at = (x) => (sides.length || x.lay === undefined ? x.c : x.lay);
  if (!sides.length) for (const it of boxes) it.mean = mean(it.at.filter(Boolean).map(at));
  for (const [A, B] of versus) {
    const both = pairOf(A, B);
    if (!both.length) continue;
    const v = both.map(([x, y]) => at(x) - at(y)), m = mean(v);
    out.pairs.push({ a: A.what, b: B.what, kind: 'box', mean: +m.toFixed(3), readings: v.map((x) => +x.toFixed(3)) });
    box = Math.max(box, Math.abs(m));
    tip(m, BOX_LIMIT);
    snap = Math.max(snap, ...v.map(Math.abs));
  }
  out.text = +text.toFixed(3); out.box = +box.toFixed(3); out.snap = +snap.toFixed(3); out.n = readings.length; out.near = near;
  const bad = [], off = blocks.length ? 'off the middle of its block of text' : sides.length ? 'off the main text\'s capitals' : 'off another box';
  if (text > TEXT_LIMIT) bad.push('texts\' baselines differ by ' + (text * S).toFixed(1) + ' device px at ' + Math.round(S) + 'x (' + text.toFixed(2) + 'px; limit 1 device px)');
  if (box > BOX_LIMIT) bad.push('a box stands ' + box.toFixed(2) + 'px ' + off + ' on average over ' + readings.length + ' positions (limit ' + BOX_LIMIT + 'px)');
  if (snap > SNAP_LIMIT) bad.push('a box stands ' + snap.toFixed(2) + 'px ' + off + ' at one position (limit ' + SNAP_LIMIT + 'px)');
  if (bad.length) {
    const cs = its.map((i) => i.mean).sort((x, y) => x - y), mid = cs[Math.floor((cs.length - 1) / 2)];
    out.fault = row.row + ': rendered centres: ' + bad.join('; ') + ': ' +
      its.map((i) => (i.box ? '[box] ' : i.block ? '[block] ' : '') + i.what + ' ' + (i.mean - mid >= 0 ? '+' : '') + (i.mean - mid).toFixed(2) + 'px').join(', ');
  }
  return out;
}

module.exports = { decodePng, measureRow, judgeRow, sizesApart, BOX_LIMIT, PLATE_STEP };
