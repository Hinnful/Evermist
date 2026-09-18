'use strict';
// moduleText.js — the published module's text, put inside the room name field.
//
// Called once from initRoomPanel() (DM only). What it must never do, and every parser rule, are
// in the module-text skill; rejected designs in docs/DECISIONS.md.

// ─── Pure kernel: everything above "Storage" is argument-in / value-out, DOM-free ──

// A heading's NAME, not the line: the bound stops wrapped prose passing the shape test.
const MT_HEADING_MAX_NAME = 48;

// A running header is SHORT — without this bound a repeated paragraph is dropped, losing data.
const MT_FURNITURE_MAX_LEN = 90;
// …and more than one word: "10 футов"/"12 футов" share a key and differ only in the number.
const MT_FURNITURE_MIN_WORDS = 2;

// Normalise to one line per line: CRLF, tabs, non-breaking spaces, runs of spaces.
//
// ⚠ THREE OF THE CHARACTERS BELOW ARE INVISIBLE and retyping the lines destroys them: the hyphen
// class holds U+00AD and U+2010, and the whitespace class holds a literal U+00A0 next to the \t.
// Losing the NBSP silently stops non-breaking spaces being normalised.
//
// The hyphens become '-' rather than being stripped, because mtReflow() keys a split word on a
// trailing hyphen. En and em dashes are punctuation, left alone.
function mtSplitLines(raw) {
  return String(raw == null ? '' : raw)
    .replace(/\r\n?/g, '\n')
    .replace(/[­‐]/g, '-')
    .split('\n')
    .map(l => l.replace(/[\t ]+/g, ' ').replace(/ {2,}/g, ' ').trim());
}

// Does this line have the SHAPE of a heading? mtPickHeadings() decides whether it really is one.
//
// ⚠ \p{Lu}, never [A-Z]: one shop's six rooms come out of the book as Cyrillic А, В, С, Е mixed
// with Latin D and F.
//
// The number may carry ONE CAPITAL PREFIX ("К12.") and ONE TRAILING LETTER, a SUB-LOCATION ("N6А"
// is a room inside "N6"). Both reach the room's name, because that is what the DM says out loud.
//
// TWO patterns, because a prefixed key is itself evidence of a heading, so it is allowed a
// lowercase name where a bare-numbered one is not.
// ⚠ A DASH separator only where a PREFIX vouches for the key. Allowing "1 - Clockwork Rats" hands
// the sequence to the first random-encounter table in the book and costs every room after it.
const MT_HEADING_RE      = /^(\p{Lu})(\d{1,3})(\p{L})?(?:[.:]|[ ]?[–—-])[ ](\p{L}.*)$/u;
const MT_HEADING_RE_BARE = /^()(\d{1,3})(\p{Lu})?[.:][ ](\p{L}.*)$/u;

// ⚠ KEEP THIS LIST CLOSED. "Глава 1:" and "Карта 1:" carry the identical shape, so a rule open
// enough to admit one more place word admits a book's whole contents page as rooms.
const MT_AREA_WORDS = /^(area|room|location|область|помещение|комната|локация|зона)$/i;
const MT_HEADING_RE_WORD = /^(\p{Lu}\p{L}+)[ ](\d{1,3})(\p{L})?(?:[.:]|[ ]?[–—-])[ ](\p{L}.*)$/u;

function mtHeadingCandidate(line) {
  const s = String(line == null ? '' : line);
  let m = MT_HEADING_RE.exec(s) || MT_HEADING_RE_BARE.exec(s);
  if (!m) {
    m = MT_HEADING_RE_WORD.exec(s);
    // The space rides in the prefix so the key reads "Area 1" the way the book writes it.
    if (m) m = MT_AREA_WORDS.test(m[1]) ? [m[0], m[1] + ' ', m[2], m[3], m[4]] : null;
  }
  if (!m) return null;
  // A single TRAILING PERIOD is allowed and stripped — the book has headings like "К43. Ванная
  // комната." and rejecting them lost real rooms. Mid-clause endings still disqualify a line.
  const name = m[4].trim().replace(/\.$/, '').trim();
  if (!name || name.length > MT_HEADING_MAX_NAME) return null;
  // A bare number is no evidence, so its name must carry a capital somewhere - prose that opens
  // lower-case does not. Small caps extract lower: "14. theChronometer of Harmony" is a room.
  if (!m[1] && !/\p{Lu}/u.test(name)) return null;
  if (/[,;:!?]$/.test(name)) return null;    // ends mid-clause, so it is prose
  // Two sentences sharing a line. A period after THREE letters or fewer is an abbreviation
  // instead - "Mrs. Peal's Bakery" is one room and rejecting it lost one.
  if (/\p{L}{4,}\.[ ]/u.test(name)) return null;
  return { prefix: m[1], num: parseInt(m[2], 10), letter: m[3] || '', name };
}

// Every shape-matching line, MINUS the ones local context exposes as list items.
//
// A numbered list in prose is shaped exactly like a heading. Two language-neutral signals separate
// them: the previous non-blank line ends with a COLON, and the line above is itself a flagged list
// item numbered one lower. ⚠ Rooted in the colon, never in any adjacent pair, which would eat an
// ordinary run of headings.
//
// KNOWN LIMITATION: a numbered list before the first real heading, not introduced by a colon, is
// indistinguishable from the room sequence. The import panel's list shows the DM that.
//
// A third signal, and the strongest: a heading is typeset on its own line and stops short, while
// wrapped prose FILLS THE COLUMN. A candidate reaching the wrap margin is a numbered sentence,
// and one of those costs every room after it by pushing the sequence past them.
//
// ⚠ wrapWidth is the CALLER'S, like mtEndsParagraph's, and the rule is OFF below MT_WRAP_MIN:
// a document of nothing but headings measures its margin off the longest of them, and would then
// reject it. Real books here wrap between 49 and 66 characters; narrower is not a typeset column.
const MT_HEADING_LINE_FRACTION = 0.85;
const MT_WRAP_MIN = 40;

function mtHeadingCandidates(lines, wrapWidth) {
  const out = [];
  const isList = new Array(lines.length).fill(false);
  const full = wrapWidth >= MT_WRAP_MIN ? wrapWidth * MT_HEADING_LINE_FRACTION : Infinity;
  for (let i = 0; i < lines.length; i++) {
    const c = mtHeadingCandidate(lines[i]);
    if (!c) continue;
    // ⚠ FLAG it, never merely skip it: a numbered sentence IS a list item, and dropping it
    // silently breaks the chain below, so the short items after it read as headings.
    if (lines[i].length >= full) { isList[i] = true; continue; }

    let prev = i - 1;
    while (prev >= 0 && !lines[prev]) prev--;      // skip blanks to the last line with text
    const introduced = prev >= 0 && /:$/.test(lines[prev]);
    const above = i > 0 ? mtHeadingCandidate(lines[i - 1]) : null;
    const continues = !!(above && isList[i - 1] && above.prefix === c.prefix &&
                         above.letter === c.letter && above.num === c.num - 1);

    if (introduced || continues) { isList[i] = true; continue; }
    out.push({ prefix: c.prefix, num: c.num, letter: c.letter, name: c.name, i });
  }
  return out;
}

// Which candidates are ACTUALLY headings: each one continuing the sequence FOR ITS OWN PREFIX.
//
// ⚠ Greedy continuation, never longest-increasing-subsequence: a list restarting at 1 between rooms
// 12 and 13 forms a longer chain than the rooms, so LIS picks the list. A number that does not
// exceed the last heading is a restart, and a restart is never a heading.
//
// Per-prefix, because a module keys each area separately and one shared counter would reject К1 and
// lose the chapter. Two UNPREFIXED chapters still collide — import one chapter at a time.
//
// The prefix is CANONICALISED for sequencing, never for display, or the same chapter keyed with
// both Cyrillic К and Latin K becomes two sequences that reject each other's numbers.

// Lookahead for the sequence's successor. Small: the false heading sits in the current room.
const MT_SUCCESSOR_LOOKAHEAD = 5;

function mtSuccessorAhead(list, i, p, want) {
  for (let j = i + 1, seen = 0; j < list.length && seen < MT_SUCCESSOR_LOOKAHEAD; j++) {
    if (mtCanonPrefix(list[j].prefix) !== p) continue;
    seen++;
    if (list[j].num === want) return true;
  }
  return false;
}

function mtPickHeadings(cands) {
  const list = Array.isArray(cands) ? cands : [];
  const out = [];
  const last = new Map();
  const subs = new Map();                            // "prefix#number" → the letters already taken
  list.forEach((c, i) => {
    const p = mtCanonPrefix(c.prefix);
    const prev = last.has(p) ? last.get(p) : 0;

    // ⚠ A SUB-LOCATION sequences on UNIQUENESS of its letter under its parent number, never on
    // letter order, which cannot work across mixed alphabets: folding Cyrillic А/Б/В onto the Latin
    // scale lands В below Б and the room vanishes.
    //
    // The parent bounds it instead: a sub may sit on the number the sequence has reached, or open
    // the next one. A sub numbered BELOW the current room is a body-text cross-reference.
    if (c.letter) {
      if (c.num < prev) return;
      if (c.num > prev) {
        if (prev > 0 && c.num > prev + 1 && mtSuccessorAhead(list, i, p, prev + 1)) return;
        last.set(p, c.num);
      }
      const key = p + '#' + c.num;
      let taken = subs.get(key);
      if (!taken) { taken = new Set(); subs.set(key, taken); }
      const L = mtCanonLetter(c.letter);
      if (taken.has(L)) return;
      taken.add(L);
      out.push(c);
      return;
    }

    if (c.num <= prev) return;                       // a restart is never a heading

    // PREFER THE IMMEDIATE SUCCESSOR, but only once the sequence has STARTED. A cross-reference
    // inside a room's text is shaped exactly like a heading, and a stray "К7." inside К1 pushes
    // the sequence to 7 and costs six rooms. So a forward JUMP is only taken when nothing just
    // ahead continues properly; plain gaps still work, since "1, 4, 9" has no 2 to prefer.
    //
    // ⚠ Keep the prev > 0 guard. Without it the FIRST candidate means "prefer whatever starts at
    // 1", so a numbered list beats rooms keyed from 11 and the chapter is lost.
    if (prev > 0 && c.num > prev + 1 && mtSuccessorAhead(list, i, p, prev + 1)) return;
    last.set(p, c.num);
    out.push(c);
  });

  // ⚠ "proceed to Area 6: Storeroom." is a sentence, and it opens a sequence of its own where
  // nothing can contradict it. A keyed chapter RUNS and it is KEYED FROM 1; two references to the
  // same book make a run on their own, so the count alone lets both in. Letter prefixes need
  // neither check - prose does not write "K12." at the start of a line.
  const runs = new Map();
  out.forEach(c => {
    const p = mtCanonPrefix(c.prefix);
    const r = runs.get(p) || { n: 0, first: Infinity };
    runs.set(p, { n: r.n + 1, first: Math.min(r.first, c.num) });
  });
  return out.filter(c => {
    if (!MT_AREA_WORDS.test(String(c.prefix).trim())) return true;
    const r = runs.get(mtCanonPrefix(c.prefix));
    return r.n > 1 && r.first === 1;
  });
}

// Cyrillic capitals a reader cannot tell from a Latin one, folded onto the Latin. Only these.
const MT_HOMOGLYPHS = { 'А':'A','В':'B','Е':'E','К':'K','М':'M','Н':'H','О':'O','Р':'P','С':'C','Т':'T','У':'Y','Х':'X' };

function mtCanonPrefix(prefix) {
  const p = String(prefix == null ? '' : prefix);
  return MT_HOMOGLYPHS[p] || p;
}

// Same fold plus a case fold: a sub-letter may be written either way, so "N6e" is "N6Е".
function mtCanonLetter(letter) {
  return mtCanonPrefix(String(letter == null ? '' : letter).toUpperCase());
}

// Split a line into the page number a PDF extractor stuck on it and the text that remains, at
// either end. A line with no number can never be page furniture, which is most of the protection
// this pass needs.
//
// `fused` means digits ran STRAIGHT into a capital, which is page furniture in any language and the
// one signal strong enough to condemn a single sighting. ⚠ The capital matters: digits against a
// lowercase letter are prose.
function mtFurniturePart(line) {
  const s = String(line == null ? '' : line);
  let num = null, rest = s, fused = false;
  const lead = /^(\d+)[ ]*/.exec(rest);
  if (lead) {
    num = lead[1];
    fused = /^\p{Lu}/u.test(s.slice(lead[1].length));
    rest = rest.slice(lead[0].length);
  }
  const tail = /[ ]*(\d+)$/.exec(rest);
  if (tail) {
    if (num == null) num = tail[1];
    rest = rest.slice(0, rest.length - tail[0].length);
  }
  return { num, fused, key: rest.trim().toLowerCase() };
}

// Drop page furniture: bare page numbers and running headers.
//
// ⚠ THE RULE IS "the same text with a DIFFERENT number attached", never "seen three times". A count
// deletes a sub-heading three rooms legitimately share, and keeps a header a short excerpt sees
// twice. A key with no number attached is untouchable however often it recurs.
//
// KNOWN GAP: a ONE-WORD running header separated from its page number by a space survives as
// visible noise, and a lower bar starts eating real one-word sub-headings.
function mtDropFurniture(lines) {
  const seen = new Map();   // key → { nums: Set, fused: boolean }
  const parts = lines.map(l => {
    if (!l || l.length > MT_FURNITURE_MAX_LEN || mtHeadingCandidate(l)) return null;
    const p = mtFurniturePart(l);
    if (!p.key || p.num == null) return p;
    if (p.key.split(' ').filter(Boolean).length < MT_FURNITURE_MIN_WORDS) return p;
    let e = seen.get(p.key);
    if (!e) { e = { nums: new Set(), fused: false }; seen.set(p.key, e); }
    e.nums.add(p.num);
    if (p.fused) e.fused = true;
    return p;
  });
  return lines.filter((l, i) => {
    if (/^\d{1,4}$/.test(l)) return false;               // a page number alone on its line
    const p = parts[i];
    if (!p || !p.key || p.num == null) return true;
    const e = seen.get(p.key);
    // e.fused condemns every sighting of the key, so the spaced siblings go with it.
    return !(e && (e.fused || e.nums.size >= 2));
  });
}

// The document's hard-wrap MARGIN — the 90th percentile of its non-blank line lengths.
//
// A high percentile, never the median: the wrap margin is where lines get CUT, so it lives at
// the top of the distribution. p90 is near the margin and survives one freak long line.
const MT_WRAP_PERCENTILE = 0.9;

function mtWrapWidth(lines) {
  const lens = (Array.isArray(lines) ? lines : [])
    .filter(l => l && String(l).trim())
    .map(l => String(l).trim().length)
    .sort((a, b) => a - b);
  if (!lens.length) return 0;
  return lens[Math.min(lens.length - 1, Math.floor(lens.length * MT_WRAP_PERCENTILE))];
}

// A line noticeably SHORTER than the wrap width, whose next line starts something new, ends a
// paragraph. The real book's extraction has no blank lines at all, so without this rule every room
// arrives as one wall of text.
//
// Hard wrapping fills every line to the margin, so a short line ended early, and a new paragraph
// opens with a capital, quote or digit. The length bound also stops an abbreviation splitting one.
//
// ⚠ Never require a full stop: that glues every sub-heading onto the paragraph below it.
//
// Err LOW on the fraction: under-splitting is invisible, over-splitting chops sentences apart.
const MT_PARA_LINE_FRACTION = 0.8;

function mtEndsParagraph(line, next, wrapWidth) {
  if (!wrapWidth) return false;
  const s = String(line == null ? '' : line).trim();
  if (!s || s.length >= wrapWidth * MT_PARA_LINE_FRACTION) return false;
  const n = String(next == null ? '' : next).trim();
  if (!n) return true;                                  // a blank line breaks it anyway
  return /^[\p{Lu}\d«"'(\[]/u.test(n);
}

// Undo the PDF's hard wrapping — the source is broken at ~60 characters with words split across
// lines, so raw it is unreadable in a 270px card.
//
//   "…нако-" + "нец"       → "…наконец"        hyphen + next line lowercase = split word
//   "…слово" + "дальше"    → "…слово дальше"   plain wrap = one space
//   ""                     → paragraph break
//
// The lowercase test is imperfect: a genuine compound wrapping at its own hyphen loses it. That
// leaves a wrong hyphen the DM can see, far cheaper than every long word glued to the next.
function mtReflow(lines, wrapWidth) {
  const src = Array.isArray(lines) ? lines : [];
  const paras = [];
  let cur = '';
  const flush = () => { const t = cur.trim(); if (t) paras.push(t); cur = ''; };
  for (let i = 0; i < src.length; i++) {
    const line = String(src[i] == null ? '' : src[i]).trim();
    if (!line) { flush(); continue; }
    if (!cur) cur = line;
    else if (/[-]$/.test(cur)) cur = /^\p{Ll}/u.test(line) ? cur.slice(0, -1) + line : cur + line;
    else cur += ' ' + line;
    // Tested on the LINE and its successor: its own length says whether it was wrapped.
    if (mtEndsParagraph(line, src[i + 1], wrapWidth)) flush();
  }
  flush();
  return paras.join('\n\n');
}

// The whole pipeline: raw text → the entries the dropdown offers.
//
// ⚠ Keep this order. Furniture first, so the reflow cannot glue a running header into the middle of
// a paragraph. Reflow last, per entry, so a heading is never absorbed into the paragraph above it.
//
// KNOWN AND ACCEPTED: a sidebar between two headings is absorbed into the preceding room, and there
// is deliberately no sidebar classifier — see DECISIONS.
function parseModuleText(raw) {
  const lines = mtDropFurniture(mtSplitLines(raw));
  // Measured over the WHOLE document: a short room would take its width from three lines.
  const wrap = mtWrapWidth(lines);
  const cands = mtHeadingCandidates(lines, wrap);
  const heads = mtPickHeadings(cands);
  const entries = heads.map((h, k) => ({
    // `num` is EXACTLY as the book writes it: the homoglyph fold is for sequencing only.
    num:   (h.prefix || '') + h.num + (h.letter || ''),
    name:  h.name,
    title: (h.prefix || '') + h.num + (h.letter || '') + '. ' + h.name,
    body:  mtReflow(lines.slice(h.i + 1, k + 1 < heads.length ? heads[k + 1].i : lines.length), wrap),
  }));
  // { entries } rather than a bare array, so a future field has somewhere to go.
  return { entries };
}

// Case- and diacritic-insensitive fold for matching.
//
// ⚠ Keep the diacritic strip scoped to LATIN base letters. A blanket "NFD then drop combining
// marks" also decomposes Cyrillic, where й is и + breve, silently merging two letters that
// distinguish real words (мой / мои).
//
// ё → е is folded explicitly, because ё is routinely typed as е.
function mtFold(s) {
  return String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/(\p{Script=Latin})\p{M}+/gu, '$1')
    .normalize('NFC')
    .replace(/[ёЁ]/g, 'е')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

// Filter + rank for the dropdown. Every query token must appear in the title, so "гл холл"
// finds "Главный холл". Returns entries, not indices — the caller has no business knowing the
// storage order.
function mtFilterEntries(entries, query) {
  const list = Array.isArray(entries) ? entries : [];
  const q = mtFold(query);
  if (!q) return list.slice();
  const toks = q.split(' ').filter(Boolean);
  const hits = [];
  list.forEach((e, i) => {
    // The key is FOLDED before comparing, or its capital prefix makes an exact match unrankable.
    const name = mtFold(e.name), title = mtFold(e.title), num = mtFold(e.num);
    if (!toks.every(t => title.includes(t) || num.startsWith(t))) return;
    let score = 3;
    if (num === q) score = 0;
    else if (name.startsWith(q) || title.startsWith(q)) score = 1;
    else if (name.includes(' ' + q)) score = 2;
    hits.push({ e, score, i });
  });
  hits.sort((a, b) => a.score - b.score || a.i - b.i);
  return hits.map(h => h.e);
}

// Which entries are already on the map, matched on the folded title. A placed entry stays
// SELECTABLE: one heading legitimately serves several polygons, so "already used" is
// information, not a lock.
function mtPlacedTitles(entries, roomNames) {
  const have = new Set((Array.isArray(roomNames) ? roomNames : []).map(mtFold).filter(Boolean));
  const placed = new Set();
  (Array.isArray(entries) ? entries : []).forEach(e => {
    if (have.has(mtFold(e.title))) placed.add(e.title);
  });
  return placed;
}

function mtProgress(entries, roomNames) {
  const total = Array.isArray(entries) ? entries.length : 0;
  return { placed: mtPlacedTitles(entries, roomNames).size, total };
}

// ─── Storage (localStorage, campaign-level) ───────────────────────────────────
// Why not sceneStore.js, and why only parsed entries: the module-text skill.

const MT_KEY = 'evermist.moduleText';
// A sanity check, NOT the quota guard — mtStore() catches the write rather than trusting this.
const MT_MAX_CHARS = 2 * 1024 * 1024;
const MT_FORMAT = 1;

// Arrays rather than objects: key names would be a fifth of the payload, and only this file reads it.
function mtSerialize(entries, sourceName) {
  return JSON.stringify({
    v: MT_FORMAT,
    src: String(sourceName || ''),
    at: Date.now(),
    e: (Array.isArray(entries) ? entries : []).map(x => [x.num, x.name, x.body]),
  });
}

// Anything unrecognised returns null: a corrupt key must never wedge the room card.
function mtDeserialize(json) {
  let o = null;
  try { o = JSON.parse(json); } catch (_) { return null; }
  if (!o || o.v !== MT_FORMAT || !Array.isArray(o.e)) return null;
  const entries = o.e
    .filter(a => Array.isArray(a) && a.length >= 3)
    .map(a => ({
      num: String(a[0]), name: String(a[1]), title: a[0] + '. ' + a[1], body: String(a[2]),
    }));
  return { entries, sourceName: String(o.src || ''), savedAt: Number(o.at) || 0 };
}

// ─── Runtime state ────────────────────────────────────────────────────────────

let mtEntries = [];      // the loaded module's locations, in book order
let mtSourceName = '';   // the file's own name, shown in the panel

function mtLoadStored() {
  let raw = null;
  try { raw = localStorage.getItem(MT_KEY); } catch (_) { return; }
  const got = raw && mtDeserialize(raw);
  if (!got) return;
  mtEntries = got.entries;
  mtSourceName = got.sourceName;
}

// Returns { ok, error } rather than throwing: a failed write is normal when storage is full.
function mtStore(entries, sourceName) {
  const json = mtSerialize(entries, sourceName);
  if (json.length > MT_MAX_CHARS) {
    return { ok: false, error: 'That module text is too large to store (' +
      Math.round(json.length / 1024) + ' KB, limit ' + Math.round(MT_MAX_CHARS / 1024) +
      ' KB). Import one chapter at a time.' };
  }
  try {
    localStorage.setItem(MT_KEY, json);
  } catch (err) {
    return { ok: false, error: 'Browser storage is full, so nothing was saved. Free some space ' +
      'or import a smaller chapter. (' + (err && err.name ? err.name : 'error') + ')' };
  }
  mtEntries = entries;
  mtSourceName = sourceName;
  return { ok: true };
}

function mtClearStored() {
  try { localStorage.removeItem(MT_KEY); } catch (_) {}
  mtEntries = [];
  mtSourceName = '';
}

// ─── The backup bridge ────────────────────────────────────────────────────────
// These three functions are the whole contract with backup.js; the rules are in the skill.

// What mtStore() writes, or null. An absent zip entry means the backup carries no module text.
function mtBackupPayload() {
  if (!mtEntries.length) return null;
  return mtSerialize(mtEntries, mtSourceName);
}

// What is loaded, for a caller asking before it replaces. Null means adopt without asking.
function mtLoadedSourceName() {
  return mtEntries.length ? (mtSourceName || 'Module text') : null;
}

// Adopt a payload read out of a backup. Returns { ok, error } like mtStore.
//
// Replace or keep, never merge: two books share no key space, so a merged one would be neither.
function mtRestorePayload(json) {
  const got = mtDeserialize(json);
  if (!got || !got.entries.length) {
    return { ok: false, error: 'The module text in that backup could not be read.' };
  }
  const st = mtStore(got.entries, got.sourceName || 'Module text');
  if (!st.ok) return st;
  // The same refresh an import does, so the panel and dropdown update without a reload.
  _mtRenderModal();
  return { ok: true };
}

// Every room name in the CURRENT scene. Reads `polygons`, so it is the kernel's boundary.
function mtCurrentRoomNames() {
  if (typeof polygons === 'undefined' || !Array.isArray(polygons)) return [];
  return polygons.map(p => (p.name != null ? p.name : ''));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    mtSplitLines, mtHeadingCandidate, mtHeadingCandidates, mtCanonPrefix, mtCanonLetter,
    mtPickHeadings,
    mtFurniturePart, mtDropFurniture,
    mtWrapWidth, mtEndsParagraph, mtReflow,
    parseModuleText, mtFold, mtFilterEntries, mtPlacedTitles, mtProgress,
    mtSerialize, mtDeserialize,
    MT_HEADING_MAX_NAME, MT_FURNITURE_MIN_WORDS, MT_FURNITURE_MAX_LEN, MT_MAX_CHARS,
    MT_PARA_LINE_FRACTION, MT_WRAP_PERCENTILE,
  };
}
