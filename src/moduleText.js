'use strict';
// moduleText.js — the published module's text, put inside the room name field.
//
// THE PROBLEM. Prepping a big dungeon means opening the module, finding a room, copying its
// name, switching to Evermist, pasting, switching back, copying the description, switching
// back, pasting — eighty times for a castle. The expensive part is not the typing, it is the
// round trip into a badly formatted book. So the book comes here: load the file once, and every
// room's name field becomes a searchable list of the module's locations.
//
// WHAT THIS DELIBERATELY DOES NOT DO. There is no auto-assign and no "fill all rooms"
// button, and that is the design rather than a v1 limitation. Real module text has
// sub-locations — room 4 is a kitchen AND a pantry, two polygons under one heading — so any
// 1:1 "next entry goes to the next room you click" mapping desyncs within a few rooms and is
// then worse than nothing. The dropdown wins precisely because it assumes no mapping: the
// human picks. That is the one irreducible step, so it is the only step.
// There is also no LLM and no network. The app works offline from file:// and stays that way.
//
// SCOPE IS CAMPAIGN-LEVEL, NOT PER-SCENE. One module serves every map in it, so the entries
// live in localStorage and are never written into a scene or a backup — the same call as
// fogHalfAlpha and the room card's description height. What DOES belong to a scene is the
// text a room ends up carrying, and that rides the room's own name/desc fields.
//
// Called once from initRoomPanel() (DM mode only). See CLAUDE.md.

// ─── Pure kernel (unit-tested — keep DOM-free) ────────────────────────────────
//
// Everything above the "Storage" divider takes arguments and returns values, with no DOM and
// no global reads. Same split as fogGeometry.js: the parsing and matching is where the bugs
// would hide, so that is what the tests cover.

// A heading's NAME, not the whole line. Real location headings are short ("Вход", "Главный
// холл"); this is the constraint that stops a hard-wrapped numbered list item in body prose
// from passing the shape test.
const MT_HEADING_MAX_NAME = 48;

// A running header is SHORT. Without this bound a paragraph that happened to repeat would be
// dropped, which is real data loss rather than cleanup.
const MT_FURNITURE_MAX_LEN = 90;
// …and it is more than one word. This is what protects a hard-wrapped prose fragment that
// happens to start with a number: two lines reading "10 футов" and "12 футов" share the key
// "футов" with differing numbers, which is the exact shape the page-number rule below looks
// for. A chapter title is several words; a stray measurement is one.
const MT_FURNITURE_MIN_WORDS = 2;

// Normalise to one line per line: CRLF, tabs, non-breaking spaces, runs of spaces.
//
// Soft hyphens (U+00AD) and the Unicode hyphen (U+2010) both become a plain '-' rather than
// being stripped, because mtReflow() keys the "this word was split across lines" rule on a
// trailing hyphen. Stripping them would leave "нако" + "нец" looking like two separate words
// and rejoin them with a space. En and em dashes are left alone — those are punctuation, not
// word breaks.
function mtSplitLines(raw) {
  return String(raw == null ? '' : raw)
    .replace(/\r\n?/g, '\n')
    .replace(/[­‐]/g, '-')
    .split('\n')
    .map(l => l.replace(/[\t ]+/g, ' ').replace(/ {2,}/g, ' ').trim());
}

// Does this line have the SHAPE of a location heading? "12. Название" — a number, a period, a
// space, then a capitalised short name with no trailing sentence punctuation.
//
// \p{Lu} rather than [A-Z] is the whole reason this works on a translation: a Cyrillic
// capital is a capital, and the sample this was built against is Russian. Never reach for
// [A-Z] here — the sub-location suffixes below are the sharpest case, since one shop's six
// rooms come out of the book as Cyrillic А, В, С, Е mixed with Latin D and F.
//
// The number may carry a SINGLE CAPITAL PREFIX: "К12. Часовня". That is how a big module keys a
// named area — the Death House appendix numbers its rooms 1-13, but Castle Ravenloft keys its
// eighty-odd rooms К1-К88, and a digit-only pattern finds exactly nothing in the chapter the DM
// most wants. The prefix is carried through into the room's name, because "К12" is what the DM
// says out loud and what the map's own labels read.
//
// This is a SHAPE test only — it says nothing about whether the line is really a heading.
// mtPickHeadings() decides that; see its comment.
//
// The number may also carry a SINGLE TRAILING LETTER — a SUB-LOCATION. "N6. Лавка гробовщика" is
// an undertaker's shop, and "N6А. Склад гробов" through "N6F. Гнездо вампиров" are the six rooms
// inside it, each with its own read-aloud text and its own polygon on the map. Without this the
// whole shop arrives as one N6 entry the DM has to split by hand, which is the most common shape
// in the town chapters — a building gets one number and its rooms get letters.
//
// TWO patterns, because a prefixed key is itself strong evidence of a heading — a numbered list in
// prose never carries one. So a PREFIXED heading is allowed a lowercase name, and a lowercase
// sub-letter, where a bare-numbered one is not. The real book needs the first: "К3. двор прислуги"
// is a genuine room whose name lost its capital in typesetting, and demanding \p{Lu} of everything
// dropped it. The second is for the books that key sub-locations "N6e." rather than "N6Е." — the
// English original of this very module does.
const MT_HEADING_RE      = /^(\p{Lu})(\d{1,3})(\p{L})?\.[ ](\p{L}.*)$/u;
const MT_HEADING_RE_BARE = /^()(\d{1,3})(\p{Lu})?\.[ ](\p{Lu}.*)$/u;

function mtHeadingCandidate(line) {
  const s = String(line == null ? '' : line);
  const m = MT_HEADING_RE.exec(s) || MT_HEADING_RE_BARE.exec(s);
  if (!m) return null;
  // A single TRAILING PERIOD is allowed and stripped. The .txt sample had none on any of its
  // thirteen headings, which made "ends with a period, so it is a sentence" look safe — the full
  // book falsifies it ("К43. Ванная комната.", "К48. Лестница."), and rejecting those lost real
  // rooms. What still disqualifies a line is ending mid-clause, or carrying two sentences.
  const name = m[4].trim().replace(/\.$/, '').trim();
  if (!name || name.length > MT_HEADING_MAX_NAME) return null;
  if (/[,;:!?]$/.test(name)) return null;    // ends mid-clause, so it is prose
  if (/\.[ ]/.test(name)) return null;       // two sentences sharing a line
  return { prefix: m[1], num: parseInt(m[2], 10), letter: m[3] || '', name };
}

// Every shape-matching line, MINUS the ones local context exposes as list items.
//
// A numbered list in body prose ("Чтобы открыть тайник: / 1. Поверните канделябр / 2. Нажмите
// на камень") is shaped exactly like a heading and cannot be told apart line by line. Two
// context signals do tell it apart, and both are language-neutral:
//
//   • the previous non-blank line ends with a COLON — that is what introduces a list, in any
//     language that uses the punctuation;
//   • the line directly above is itself an already-flagged list item numbered one lower —
//     which is how the flag propagates down the rest of the list.
//
// The propagation is deliberately rooted in the colon rather than applied to any adjacent
// pair. "1. Вход" followed immediately by "2. Главный холл" is a perfectly ordinary pair of
// headings in a module with terse locations, and an unrooted adjacency rule would eat it.
//
// KNOWN LIMITATION: a numbered list that appears BEFORE the first real heading and is not
// introduced by a colon is indistinguishable from the room sequence, and the greedy pass below
// will take it and lose the rooms it collides with. That is what the import PREVIEW is for —
// the DM reads "Found 3 locations: 1. Поверните канделябр…" and trims the paste.
function mtHeadingCandidates(lines) {
  const out = [];
  const isList = new Array(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    const c = mtHeadingCandidate(lines[i]);
    if (!c) continue;

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

// Which of the surviving candidates are ACTUALLY headings: walk them in document order and
// keep each one whose number continues the sequence FOR ITS OWN PREFIX.
//
// Greedy continuation rather than a longest-increasing-subsequence pass, which was tried and
// is WRONG here: a three-item list restarting at 1 between rooms 12 and 13 forms the chain
// 1→2→3→13, which is LONGER than 11→12→13, so LIS picks the list and drops two real rooms.
// Continuation cannot be fooled that way — a number that does not exceed the last heading is a
// restart, and a restart is never a heading.
//
// Per-prefix, because a module keys each area separately: К1-К88 for the castle after 1-13 for
// the appendix. One shared counter would reject К1 for not exceeding 13 and lose the whole
// chapter. Sequences interleave freely, which also means a document pasted with two UNPREFIXED
// chapters still collides on its second one — paste one chapter at a time, and the import
// preview is what says whether that happened.
//
// The prefix is CANONICALISED for sequencing (never for display). Measured on the real book: the
// castle chapter comes out as 40 rooms keyed Cyrillic "К" plus 2 keyed Latin "K", and the amber
// temple as 15 "Х" plus 1 "X". Those are the same chapters — the glyphs are indistinguishable on
// the page and the mix is a typesetting or extraction artifact — but as separate Map keys each
// sequence rejects the other's numbers and rooms vanish. Two rooms is a straggler, not a chapter.
// How far ahead to look for the sequence's immediate successor. Small on purpose: the false
// heading it defends against sits INSIDE the current room's text, so its successor is a handful of
// candidates away at most.
const MT_SUCCESSOR_LOOKAHEAD = 5;

// Is the sequence's immediate successor sitting just ahead of candidate `i`? See the call site.
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

    // A SUB-LOCATION ("N6А") sequences on its LETTER, under its parent number, and the test is
    // "this letter is not taken yet" rather than "this letter comes after the last one".
    //
    // Ordering was tried first and it cannot be made to work: the letters arrive in mixed
    // alphabets (Cyrillic А, В, С, Е next to Latin D and F in one six-room shop), so any ordinal
    // has to pick a scale, and a book keyed purely Cyrillic А, Б, В then folds А and В onto the
    // Latin scale while Б stays on the Cyrillic one — В lands BELOW Б and the room vanishes.
    // Uniqueness needs no scale, and the false positive ordering defends against does not exist
    // here anyway: the thing that fools a NUMBER is a numbered list in prose, and a lettered list
    // is written "а)", never "N6а.".
    //
    // The parent is what bounds it instead. A sub may sit on the number the sequence has ALREADY
    // reached (the ordinary case — the rooms follow their building), or open a number the sequence
    // is ready to advance to (the parent heading was lost in extraction, so its first room opens
    // it). A sub numbered BELOW the current room is a cross-reference in body text — "(на верхнем
    // этаже, в гардеробе спальни, область N6e)" is in this very sample — and never a heading.
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

    // PREFER THE IMMEDIATE SUCCESSOR, but only once the sequence has STARTED (prev > 0). A
    // cross-reference inside a room's own text is shaped exactly like a heading, and one of them is
    // expensive: the real book has "К7. Широкое, разбитое окно…" sitting inside К1's description,
    // which pushed the sequence to 7 and cost К2-К6 outright plus the real К7's name. A forward JUMP
    // is therefore only taken when nothing just ahead continues the sequence properly. Plain gaps
    // still work — "1, 4, 9" has no 2 or 5 to prefer.
    //
    // The prev > 0 guard is load-bearing and was a real regression without it: applied to the FIRST
    // candidate it means "prefer whatever starts at 1", so a numbered list ahead of rooms keyed from
    // 11 beat the rooms and the chapter was lost. Before the sequence exists there is nothing to
    // continue, so the first candidate is simply taken.
    if (prev > 0 && c.num > prev + 1 && mtSuccessorAhead(list, i, p, prev + 1)) return;
    last.set(p, c.num);
    out.push(c);
  });
  return out;
}

// Cyrillic capitals that are visually identical to a Latin one, folded onto the Latin. Only these
// twelve — the pairs a reader cannot tell apart, which is exactly the set that can be mixed
// without anyone noticing. Everything else is left alone.
const MT_HOMOGLYPHS = { 'А':'A','В':'B','Е':'E','К':'K','М':'M','Н':'H','О':'O','Р':'P','С':'C','Т':'T','У':'Y','Х':'X' };

function mtCanonPrefix(prefix) {
  const p = String(prefix == null ? '' : prefix);
  return MT_HOMOGLYPHS[p] || p;
}

// Same fold for a SUB-LOCATION's letter, plus a case fold on top: a prefix is always a capital by
// the pattern, but a sub-letter may be written either way, and "N6e" and "N6Е" are the same room.
function mtCanonLetter(letter) {
  return mtCanonPrefix(String(letter == null ? '' : letter).toUpperCase());
}

// Split a line into the page number a PDF extractor stuck on it and the text that remains.
// Either end, because which end the number lands on depends on the page's layout. `num` is
// null when the line carries no number at all — and a line with no number can never be page
// furniture, which is most of the protection this whole pass needs.
//
// `fused` means the digits ran STRAIGHT into a capital with no space ("209Приложение"). That
// shape is page furniture with certainty in any language — no prose puts a digit against a
// capital letter — and it is the one signal strong enough to condemn a single sighting. The
// capital matters: "1к10 дней" at the start of a wrapped line is digits against a LOWERCASE
// letter, and it is ordinary text.
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

// Drop page furniture: bare page numbers, and running headers.
//
// THE RULE IS "the same text seen with a DIFFERENT number attached", not "the same text seen
// three times". That distinction came from the real book and it matters in both directions —
// the count-based version, which is what this was first written as, got the live sample
// exactly backwards:
//   • it DELETED "Кухонный лифт" from three rooms. That is a legitimate sub-heading that
//     recurs because three rooms share a dumbwaiter shaft. Silent loss of the DM's content is
//     the worst failure this parser has available, and a count can't tell a repeated
//     sub-heading from a running header.
//   • it KEPT "209Приложение B: Дом смерти" and "210 Приложение B: Дом смерти", because a
//     two-page excerpt only sees the header twice.
// The number is what a sub-heading structurally never has. So a key is condemned when two of
// its sightings carry different numbers, or when any one sighting is `fused` — and a key with
// no number attached is untouchable no matter how often it recurs.
//
// Two further exemptions: a heading-shaped line is never counted (that is also what stops two
// rooms called "Кладовая" under different numbers from condemning each other), and a line
// longer than a running header plausibly is, or shorter than MT_FURNITURE_MIN_WORDS, is left
// alone.
//
// KNOWN GAP, and deliberately left: a ONE-WORD running header separated from its page number
// by a space is not caught. It survives into a description as visible noise the DM deletes,
// which is the failure worth having — the alternative bar is low enough to start eating real
// one-word sub-headings.
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
    // e.fused condemns every sighting of the key, not just the fused one — that is how
    // "210 Приложение…" goes with "209Приложение…" rather than surviving on a space.
    return !(e && (e.fused || e.nums.size >= 2));
  });
}

// The document's hard-wrap MARGIN — the 90th percentile of its non-blank line lengths.
//
// A high percentile, not the median, and the real text is what settled that. The wrap margin is
// where lines get CUT, so it lives at the top of the distribution: measured on the sample, the
// median is 47 while lines run to 57, because a line breaks anywhere from 43 to 57 depending on
// how long the next word is. So the median measures a TYPICAL FILLED LINE, not the margin, and a
// threshold derived from it sat ~8 characters below the real boundary and missed most paragraph
// ends. p90 lands at 51 there — near the margin, but robust to one freak long line in a way the
// maximum is not.
const MT_WRAP_PERCENTILE = 0.9;

function mtWrapWidth(lines) {
  const lens = (Array.isArray(lines) ? lines : [])
    .filter(l => l && String(l).trim())
    .map(l => String(l).trim().length)
    .sort((a, b) => a - b);
  if (!lens.length) return 0;
  return lens[Math.min(lens.length - 1, Math.floor(lens.length * MT_WRAP_PERCENTILE))];
}

// A line noticeably SHORTER than the wrap width, whose NEXT line starts something new, is the
// last line of a paragraph. This is the only paragraph signal the real book gives — its
// extraction contains no blank lines whatsoever, so without this rule every room arrives as one
// undifferentiated wall of text, in a 270px card, mid-scene, that the DM reads aloud from.
//
// Both halves are doing work. Hard wrapping FILLS every line to the margin, so a short line can
// only be a line that ended early; and a new paragraph starts a new sentence, so its first
// character is a capital (or a quote, or a digit). The length bound is also what stops an
// abbreviation from splitting a paragraph — "…алхимии и т.д." ends in a period but runs the full
// width, so it is not a break.
//
// Deliberately NOT requiring the line to end in a full stop, which an earlier version did: that
// version glued every sub-heading onto the paragraph below it ("Тайный люк В юго-западном
// углу…"), because a sub-heading is exactly a short line with no terminator. Dropping the
// terminator test costs nothing — the next-line-starts-new test already carries that weight —
// and it gives each sub-heading its own paragraph, which is how the book reads.
//
// The fraction is measured, not guessed. On the real text the two populations separate cleanly:
// filled lines cluster at 43-57 characters, paragraph-final lines at 15-30. Against a p90 margin
// of 51 that puts the boundary at 0.8 — about 41 characters, comfortably between the two. Erring
// low is the safe direction: under-splitting is invisible, over-splitting chops sentences apart.
const MT_PARA_LINE_FRACTION = 0.8;

function mtEndsParagraph(line, next, wrapWidth) {
  if (!wrapWidth) return false;
  const s = String(line == null ? '' : line).trim();
  if (!s || s.length >= wrapWidth * MT_PARA_LINE_FRACTION) return false;
  const n = String(next == null ? '' : next).trim();
  if (!n) return true;                                  // a blank line breaks it anyway
  return /^[\p{Lu}\d«"'(\[]/u.test(n);
}

// Undo the PDF's hard wrapping. The source is broken at ~60 characters with words split
// across lines, so rendered raw it is unreadable in a 270px card.
//
//   "…нако-" + "нец"       → "…наконец"        hyphen + next line lowercase = split word
//   "…слово" + "дальше"    → "…слово дальше"   plain wrap = one space
//   ""                     → paragraph break, kept as a blank line
//   a short line before a capital → paragraph break as well, when wrapWidth is known
//
// The lowercase test is the standard heuristic and it is not perfect: a genuinely hyphenated
// compound that happens to wrap at its own hyphen loses it. Keeping the hyphen when the next
// line starts with a capital covers the case that matters (proper-noun compounds), and the
// remainder is a wrong hyphen in prose the DM can see and fix — much cheaper than the
// alternative failure, which is every long word in the book glued to the next one.
//
// wrapWidth is optional: omit it and only explicit blank lines break paragraphs.
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
    // Tested on the LINE and its successor, not on the paragraph built so far: it is this line's
    // own length that says whether the extractor wrapped it or it ended early.
    if (mtEndsParagraph(line, src[i + 1], wrapWidth)) flush();
  }
  flush();
  return paras.join('\n\n');
}

// The whole pipeline: raw pasted text → the entries the dropdown offers.
//
// Order is load-bearing. Furniture goes first, so a running header cannot be glued into the
// middle of a paragraph by the reflow. Reflow goes last, per entry, so a heading never gets
// absorbed into the paragraph above it.
//
// KNOWN AND ACCEPTED: a sidebar (a page of general rules sitting between two room headings)
// is absorbed into the preceding room's description — roughly one room in thirteen. There is
// deliberately no sidebar classifier; every signal for one is either language-specific or
// indistinguishable from a long room description, and the cost of a false positive is
// silently losing real prep. The DM deletes it from the description, which is a keystroke on
// text they are already reading.
function parseModuleText(raw) {
  const lines = mtDropFurniture(mtSplitLines(raw));
  const cands = mtHeadingCandidates(lines);
  const heads = mtPickHeadings(cands);
  // Measured once over the WHOLE document, not per entry: a short room would otherwise take its
  // wrap width from three lines and get a meaningless one.
  const wrap = mtWrapWidth(lines);
  const entries = heads.map((h, k) => ({
    // `num` carries the prefix and the sub-letter: it is the key the DM says out loud ("К12",
    // "N6А"), it is what the search box matches, and it is what the map label reads. Both are
    // written EXACTLY as the book has them — the homoglyph fold above is for sequencing only, so
    // a room the page calls "N6С" never turns into "N6C" on the map.
    num:   (h.prefix || '') + h.num + (h.letter || ''),
    name:  h.name,
    title: (h.prefix || '') + h.num + (h.letter || '') + '. ' + h.name,
    body:  mtReflow(lines.slice(h.i + 1, k + 1 < heads.length ? heads[k + 1].i : lines.length), wrap),
  }));
  // { entries } rather than a bare array, so a future field has somewhere to go. It used to also
  // report lineCount / candidateCount / wrapWidth, which nothing ever read — not the app, not the
  // tests. They were diagnostics from building the parser, kept as API by accident.
  return { entries };
}

// Case- and diacritic-insensitive fold for matching.
//
// The diacritic strip is scoped to LATIN base letters, and that scope is the whole point: a
// blanket "NFD then drop every combining mark" also decomposes Cyrillic, where й is и + breve
// and ё is е + diaeresis — so it silently merges й into и. Those are different letters that
// distinguish real words (мой / мои), unlike é and e. Caught by a test.
//
// ё → е is then folded back in explicitly, because that one IS worth having: ё is routinely
// typed as е, so a DM searching "елка" must still find "Ёлка".
function mtFold(s) {
  return String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/(\p{Script=Latin})\p{M}+/gu, '$1')
    .normalize('NFC')
    .replace(/[ёЁ]/g, 'е')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

// Filter + rank for the dropdown. Every query token must appear somewhere in the title, so
// "гл холл" finds "Главный холл"; the ranking then floats the tightest matches up — an exact
// room number first, then a name that starts with the query, then a word that does, then the
// rest. Returns entries, not indices: the caller has no business knowing the storage order.
function mtFilterEntries(entries, query) {
  const list = Array.isArray(entries) ? entries : [];
  const q = mtFold(query);
  if (!q) return list.slice();
  const toks = q.split(' ').filter(Boolean);
  const hits = [];
  list.forEach((e, i) => {
    // The key is FOLDED before comparing, because it can carry a capital prefix ("К12") while
    // the query has already been lowercased. Comparing raw made an exact key match unrankable.
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

// Which entries are already on the map. "Placed" means an entry's title matches the name of
// some polygon in the current scene — matched on the folded title, so trailing whitespace or
// a case difference doesn't read as unplaced.
//
// A placed entry stays SELECTABLE. Sub-locations are why: one heading legitimately serves
// several polygons, so "already used" is information, not a lock.
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
//
// NOT IndexedDB. sceneStore.js is one object store keyed by scene id at DB_VERSION 1, so a
// campaign-level store there means a version bump and an upgrade path on the database holding
// the user's maps — a real risk to buy nothing, since 88 rooms of prose is a few hundred KB
// and sits comfortably in a localStorage budget.
//
// Only PARSED ENTRIES are stored, never the raw file: the raw is 2-3× the size, it is the one
// thing that is trivially re-obtainable (the DM still has the book), and keeping a copy of a
// commercial module in app storage is not this app's business.

const MT_KEY = 'evermist.moduleText';
// Chrome's localStorage budget is ~5MB per origin, counted in UTF-16 code units, and the whole
// app shares it with the UI scale, the fog dials and the card's description height (all together
// well under a kilobyte). So this ceiling is ~4MB of that 5MB — deliberately loose rather than
// safe, because it is a sanity check and NOT the quota guard.
//
// The measured numbers, so nobody has to re-derive them: a whole 255-page module is ~900K chars
// stored, i.e. ~1.8MB in the browser's accounting. That is 2.3× under this limit, not the 10× an
// earlier version of this comment claimed by measuring one chapter and calling it a book. A file
// big enough to pass here and still blow the quota is therefore possible, which is why mtStore()
// catches the write and reports it rather than relying on this number.
const MT_MAX_CHARS = 2 * 1024 * 1024;
const MT_FORMAT = 1;

// Compact on purpose: three-element arrays rather than {num,name,body} objects, because the
// key names would otherwise be ~20% of the payload for zero benefit — nothing outside this
// file reads the serialised form.
function mtSerialize(entries, sourceName) {
  return JSON.stringify({
    v: MT_FORMAT,
    src: String(sourceName || ''),
    at: Date.now(),
    e: (Array.isArray(entries) ? entries : []).map(x => [x.num, x.name, x.body]),
  });
}

// Tolerant by design: anything unrecognised returns null and the app behaves as if no module
// were loaded. A corrupt key must never be able to wedge the room card.
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
let mtSourceName = '';   // the file's own name, e.g. 'ravenloft.pdf' — shown in the modal

function mtLoadStored() {
  let raw = null;
  try { raw = localStorage.getItem(MT_KEY); } catch (_) { return; }
  const got = raw && mtDeserialize(raw);
  if (!got) return;
  mtEntries = got.entries;
  mtSourceName = got.sourceName;
}

// Returns { ok, error } rather than throwing — the caller is a modal that has to say
// something useful, and "the write failed" is a normal outcome when a disk is full or the
// user is browsing in a mode with storage disabled.
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
    return { ok: false, error: 'Could not save the module text — browser storage is full. ' +
      'Free some space or import a smaller chapter. (' + (err && err.name ? err.name : 'error') + ')' };
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

// Names of every room in the CURRENT scene — the input to the placed count. Reads the global
// `polygons`, so it is the boundary between the pure kernel above and the app.
function mtCurrentRoomNames() {
  if (typeof polygons === 'undefined' || !Array.isArray(polygons)) return [];
  return polygons.map(p => (p.name != null ? p.name : ''));
}

// ─── Import modal ─────────────────────────────────────────────────────────────
//
// THREE CONTROLS: Choose file, Remove, Close. Everything else that was here has been cut, and
// each cut is worth naming because each was a plausible idea that the real thing disproved.
//
//   • The PASTE BOX went because nobody pastes a 300-page module into a text area. A module is
//     a file, the app reads the file (including the PDF, see pdfLayout.js), so the file picker
//     was always the real path and the textarea was a second, worse one sitting next to it.
//   • The PREVIEW BUTTON went because choosing a file already parses and shows the result, so
//     the button's only remaining job was to re-parse the textarea — which meant that with a
//     file loaded it reported "paste some text first", the exact opposite of what it looked
//     like it would do.
//   • The EXPLANATION went because it asked the DM to think about the parser's rules, and there
//     is nothing they can do with that: they are not going to re-typeset a published book. When
//     the parse fails the status line says so in a sentence, which is where that belongs.
//
// WHAT REPLACES THE CONFIRM STEP. The old flow stored nothing until a Save click, on the
// grounds that a bad parse the DM saw beats one that silently replaced their module. The panel
// now imports on choose, and the safety comes from three things instead: an EMPTY parse never
// writes (so a wrong file cannot wipe a good import), the list below shows what is loaded every
// time the panel opens rather than only after a paste, and Remove is right there. What a
// discarded import costs is one more click on a file the DM still has open.
//
// No drag-and-drop. The app already has a drop handler and it belongs to map loading
// (toolbar.js) — a second meaning for the same gesture would make dropping a file ambiguous.

function _mtEl(id) { return document.getElementById(id); }

// The panel's whole render. `status` overrides the default "what is loaded" line — that is how
// an error or a progress message is shown WITHOUT hiding the module that is still loaded
// underneath it, which is the honest thing to show when an import was refused.
function _mtRenderModal(status, isError) {
  const n = mtEntries.length;

  const st = _mtEl('mt-status');
  if (st) {
    st.textContent = status != null ? status : (n
      ? n + ' location' + (n === 1 ? '' : 's') + (mtSourceName ? ' from ' + mtSourceName : '')
      : 'No module text loaded.');
    st.classList.toggle('mt-err', !!isError);
  }

  const list = _mtEl('mt-list');
  if (list) {
    list.innerHTML = '';
    list.style.display = n ? '' : 'none';
    mtEntries.forEach(e => {
      const row = document.createElement('div');
      row.className = 'mt-row';
      const num = document.createElement('span');
      num.className = 'mt-num';
      num.textContent = e.num + '.';
      const nm = document.createElement('span');
      nm.className = 'mt-name';
      nm.textContent = e.name;
      const ch = document.createElement('span');
      ch.className = 'mt-chars' + (e.body ? '' : ' mt-empty');
      ch.textContent = e.body ? e.body.length + ' chars' : 'empty';
      row.appendChild(num); row.appendChild(nm); row.appendChild(ch);
      list.appendChild(row);
    });
  }

  const lbl = _mtEl('mt-file-label');
  if (lbl) lbl.textContent = n ? 'Choose another file…' : 'Choose file…';
  const foot = _mtEl('mt-foot');
  if (foot) foot.style.display = n ? '' : 'none';
}

function openModuleTextModal() {
  _mtRenderModal();
  _mtEl('mt-backdrop').style.display = '';
  const modal = _mtEl('mt-modal');
  modal.style.display = '';
  // Focus the panel itself (tabindex="-1"), which is what gives Escape somewhere to land now
  // that there is no text field in here to hold focus.
  modal.focus();
}

function closeModuleTextModal() {
  _mtEl('mt-backdrop').style.display = 'none';
  _mtEl('mt-modal').style.display = 'none';
}

// Bytes → text, UTF-8 first and Windows-1251 as the fallback.
//
// Not a nicety for a Russian-translation module: a .txt exported by an older PDF tool is often
// CP1251, and decoding those bytes as UTF-8 yields a page of replacement characters rather than
// an error — so the DM would see mojibake in the preview and have no idea why. `fatal: true` is
// what turns that silent corruption into a signal we can act on. UTF-8 is tried first because a
// UTF-8 file is also valid-looking CP1251 (it just decodes to nonsense), so the order is the
// whole safeguard. Anything neither decoder accepts returns null and says so.
const MT_ENCODINGS = ['utf-8', 'windows-1251'];

function _mtDecode(buf) {
  if (!buf) return null;
  for (const enc of MT_ENCODINGS) {
    try { return new TextDecoder(enc, { fatal: true }).decode(buf); } catch (_) {}
  }
  // Last resort: decode UTF-8 leniently rather than refusing the file outright. A handful of bad
  // bytes in an otherwise readable book should not block the import — the preview shows what
  // came through.
  try { return new TextDecoder('utf-8').decode(buf); } catch (_) { return null; }
}

// Is this a PDF? Decided on the RAW BYTES, before any decode is attempted — a PDF's body is
// compressed binary that no text decoder should be asked about.
//
// The signature is scanned for in the first kilobyte rather than required at byte 0: a PDF that has
// been through an email gateway or a careless download can carry a few bytes of preamble, and every
// reader in the world tolerates that.
function _mtIsPdf(buf) {
  if (!buf || !buf.byteLength) return false;
  const head = new Uint8Array(buf, 0, Math.min(1024, buf.byteLength));
  for (let i = 0; i + 4 < head.length; i++) {
    if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 && head[i + 3] === 0x46) return true;
  }
  return false;
}

// Name the container format if this is obviously not prose, else null. Magic bytes for the formats a
// DM plausibly reaches for, plus a control-character density check as the catch-all — the point is
// to say "that's a .docx" rather than to show a preview of its compressed streams. PDFs never reach
// here (they are converted upstream); the branch stays as a backstop.
function _mtBinaryKind(text) {
  const head = String(text || '').slice(0, 8);
  if (head.startsWith('%PDF')) return 'a PDF';
  if (head.startsWith('PK') && head.charCodeAt(2) === 3) return 'a .docx or .zip';
  if (head.startsWith('{\\rtf')) return 'an RTF file';
  if (head.charCodeAt(0) === 0xD0 && head.charCodeAt(1) === 0xCF) return 'an old .doc file';
  // Catch-all: C0 control characters other than tab/newline/carriage-return. Prose contains none
  // of these; a binary read as text is full of them, and 2% sits far above the noise one stray
  // byte would make. Written as escapes on purpose - the literal characters in a source file make
  // the whole file register as binary to grep and every other tool.
  const sample = String(text || '').slice(0, 4000);
  if (!sample) return null;
  const CTRL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]', 'g');
  const ctrl = (sample.match(CTRL) || []).length;
  return ctrl / sample.length > 0.02 ? 'a binary file' : null;
}

// Parse and STORE, in one step. An empty parse deliberately writes nothing: the most likely
// reason for zero locations is the wrong file or the wrong chapter, and losing a good import to
// that would be the one unrecoverable thing this panel could do.
function _mtImport(text, sourceName) {
  const res = parseModuleText(text);
  const n = res.entries.length;
  if (!n) {
    _mtRenderModal('No numbered locations in that file. Evermist splits the text at headings ' +
                   'like “K12. Chapel”, so try one chapter at a time.', true);
    return;
  }
  const st = mtStore(res.entries, sourceName || 'Module text');
  if (!st.ok) { _mtRenderModal(st.error, true); return; }
  _mtRenderModal();
}

function _mtInitModal() {
  const backdrop = _mtEl('mt-backdrop');
  if (!backdrop) return;   // markup absent (player mode strips nothing, but be safe)

  backdrop.addEventListener('click', closeModuleTextModal);
  _mtEl('btn-mt-close').addEventListener('click', closeModuleTextModal);

  // The modal floats over the map like every other panel: a click inside it, or a keystroke
  // typed into it, must never reach the canvas handlers or the global shortcuts.
  const modal = _mtEl('mt-modal');
  modal.addEventListener('mousedown', e => e.stopPropagation());
  modal.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') closeModuleTextModal();
  });

  // Clear the input BEFORE opening the dialog, every time. A file input does not fire `change`
  // when the same file is picked again, so without this the second pick of one file is silently
  // dead — and picking the same file twice is exactly what happens after a parse the DM didn't
  // like, or after they fix the .txt and try again. Clearing on modal-open only was not enough:
  // it left the hole open for as long as the panel stayed up.
  _mtEl('btn-mt-file').addEventListener('click', () => {
    const input = _mtEl('mt-file-input');
    input.value = '';
    input.click();
  });

  // Its own <input type=file>, NOT the app's #file-input: that one is the map loader's and
  // accepts images, video and .zip. Reading it here as text would be a silent way to feed a
  // .webm to the parser.
  _mtEl('mt-file-input').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = async () => {
      const buf = rd.result;

      // A PDF is CONVERTED, not refused. A campaign module ships as a PDF and the DM should not
      // have to export and "prepare" a file to use one. The conversion is main-process work
      // (pdfjs-dist is ESM-only — see main.js), so it is Electron-only, the same as backup.
      if (_mtIsPdf(buf)) {
        if (!window.electronAPI || !window.electronAPI.extractPdfText) {
          _mtRenderModal('Reading a PDF needs the desktop app. Save the text as .txt and load that.', true);
          return;
        }
        _mtRenderModal('Reading the PDF…');
        let res = null;
        try { res = await window.electronAPI.extractPdfText(buf); }
        catch (err) { res = { ok: false, error: String((err && err.message) || err) }; }
        if (!res || !res.ok) {
          _mtRenderModal('Could not read that PDF' + (res && res.error ? ': ' + res.error : '.'), true);
          return;
        }
        _mtImport(res.text, f.name);
        return;
      }

      const text = _mtDecode(buf);
      if (text == null) { _mtRenderModal('Could not read that file as text.', true); return; }
      // Anything else that isn't prose gets NAMED rather than parsed as one. The dialog's "All
      // files" option lets a .docx or an .rtf through the filter, and without this the DM gets a
      // list full of binary garbage and no idea why.
      const kind = _mtBinaryKind(text);
      if (kind) {
        _mtRenderModal('That looks like ' + kind + ', not plain text. Save it as .txt first, ' +
                       'then load that.', true);
        return;
      }
      _mtImport(text, f.name);
    };
    rd.onerror = () => _mtRenderModal('Could not read that file.', true);
    // ArrayBuffer, not readAsText: the encoding has to be decided by looking at the bytes.
    rd.readAsArrayBuffer(f);
  });

  // Removing does NOT close the panel: the DM stays looking at the empty state, which is the
  // confirmation that it worked. Closing on success would leave them wondering.
  _mtEl('btn-mt-remove').addEventListener('click', () => {
    // confirmDialog, never the native confirm() — see the header of confirmDialog.js. This one
    // is raised from inside a panel rather than from the room card, but the broken input state a
    // native dialog leaves behind is the page's, not the caller's.
    confirmDialog({
      title: 'Remove module text?',
      message: 'The locations Evermist parsed are discarded. Room names and descriptions ' +
               'already written to the map stay as they are.',
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      danger: true,
      onConfirm: () => {
        mtClearStored();
        _mtEl('mt-file-input').value = '';
        _mtRenderModal();
      },
    });
  });
}

// ─── The name field as a combobox ─────────────────────────────────────────────
//
// #rp-name keeps working EXACTLY as before when nothing matches or nothing is loaded: it is a
// text input, the DM types a name, blur commits it. The list is additive — it opens on focus,
// filters as they type, and picking an entry fills the name and the description together.
//
// It lives INSIDE the card (absolutely positioned in .rp-ident) rather than floating over the
// page, which buys two things for free: #panel-room's `zoom: var(--ui-zoom)` applies to it
// like everything else, so there is no repeat of the screen-px-vs-pre-zoom-px problem
// _rpScreenToStyle() exists to solve; and it cannot be left orphaned on screen when the card
// moves or closes. It overlays the description while open, which is the right trade — the DM
// is naming the room at that moment, not reading it.
//
// The FOOTER ROW is the only entry point to the import modal. No button anywhere else: the
// card's space is settled and its scarcest resource is description height, and the one moment
// a DM wants the module is the moment they are looking at this list.

let _mtDD = null;        // the dropdown element, built once
let _mtNameEl = null;
let _mtOpen = false;
let _mtShown = [];       // entries currently listed, in displayed order
let _mtActive = -1;      // keyboard-highlighted row

function _mtBuildDropdown(identEl) {
  const dd = document.createElement('div');
  dd.className = 'rp-mt-dd';
  dd.id = 'rp-mt-dd';
  dd.style.display = 'none';
  dd.innerHTML =
    '<div class="rp-mt-head" id="rp-mt-head"></div>' +
    '<div class="rp-mt-list" id="rp-mt-list"></div>' +
    '<div class="rp-mt-foot"><button type="button" id="rp-mt-load"></button></div>';
  identEl.appendChild(dd);

  // TWO listeners, and the split between them is load-bearing.
  //
  // mousedown only PREVENTS THE DEFAULT. The pointer going down inside the list would otherwise
  // blur the name field, which closes the list out from under the pointer before it comes back
  // up; preventDefault keeps focus where it is, and the list with it.
  //
  // The act itself waits for CLICK, one event later, and that is what keeps a modal dialog out
  // of the middle of a mouse gesture. Picking an entry can raise the "replace your description?"
  // confirm (roomPanel), and a native dialog opened from mousedown blocks the page before the
  // matching mouseup is delivered: the browser is left believing the button is still down, and
  // the next click on the name field reads as a continuation of that gesture rather than a fresh
  // one, so the caret never lands and the field looks dead. It took two picks in a row to see —
  // the first has no description to replace, so it raises no dialog and never broke. By click
  // time the mousedown/mouseup pair is complete and the dialog can block for as long as it likes.
  dd.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
  dd.addEventListener('click', e => {
    e.stopPropagation();
    const load = e.target.closest('#rp-mt-load');
    if (load) { mtCloseDropdown(); openModuleTextModal(); return; }
    const row = e.target.closest('.rp-mt-opt');
    if (!row) return;
    _mtPick(parseInt(row.dataset.idx, 10));
  });

  return dd;
}

function _mtPick(i) {
  const entry = _mtShown[i];
  if (!entry) return;
  // The write itself is roomPanel's — it owns the room's fields, the undo entry and the
  // autosave. This module owns the book, not the room.
  if (typeof applyModuleEntryToRoom === 'function') applyModuleEntryToRoom(entry);
  mtCloseDropdown();
  if (_mtNameEl) _mtNameEl.blur();
}

function _mtRender() {
  if (!_mtDD) return;
  const q = _mtNameEl ? _mtNameEl.value : '';
  const names = mtCurrentRoomNames();
  const prog = mtProgress(mtEntries, names);
  const placed = mtPlacedTitles(mtEntries, names);

  const head = _mtEl('rp-mt-head');
  head.textContent = mtEntries.length
    ? prog.placed + ' of ' + prog.total + ' placed'
    : 'No module text loaded';

  // Filter against the typed text, but ONLY once it differs from the name the field already
  // holds. Opening the card on "4. Кухня" and filtering by "4. Кухня" would show one row —
  // the entry that is already there — and hide the list the DM opened it to see.
  const poly = (typeof polygons !== 'undefined' && typeof selectedPolygonId !== 'undefined')
    ? polygons.find(p => p.id === selectedPolygonId) : null;
  const isExisting = poly && q === (poly.name != null ? poly.name : '');
  _mtShown = mtFilterEntries(mtEntries, isExisting ? '' : q);

  const list = _mtEl('rp-mt-list');
  list.innerHTML = '';
  _mtShown.forEach((e, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rp-mt-opt' + (i === _mtActive ? ' active' : '') +
                  (placed.has(e.title) ? ' placed' : '');
    b.dataset.idx = String(i);
    const num = document.createElement('span');
    num.className = 'rp-mt-num';
    num.textContent = e.num + '.';
    const nm = document.createElement('span');
    nm.className = 'rp-mt-name';
    nm.textContent = e.name;
    b.appendChild(num); b.appendChild(nm);
    // A placed entry is marked but stays selectable — one heading can legitimately serve
    // several polygons (a kitchen and its pantry under one number).
    if (placed.has(e.title)) {
      const dot = document.createElement('span');
      dot.className = 'rp-mt-dot';
      dot.title = 'Already on this map';
      b.appendChild(dot);
    }
    list.appendChild(b);
  });

  if (mtEntries.length && !_mtShown.length) {
    const none = document.createElement('div');
    none.className = 'rp-mt-none';
    none.textContent = 'No match — press Enter to keep what you typed';
    list.appendChild(none);
  }

  _mtEl('rp-mt-load').textContent = mtEntries.length
    ? 'Replace module text…' : 'Load module text…';
}

// Opening an already-open list RE-RENDERS it rather than returning early. The early return was
// there first and it kept stale content: the progress count and the placed dots are derived from
// the current scene's room names, so a list that opened before an import — or before a room was
// renamed elsewhere — would keep showing the state it was built in.
function mtOpenDropdown() {
  if (!_mtDD) return;
  if (!_mtOpen) {
    _mtOpen = true;
    _mtActive = -1;
    _mtDD.style.display = 'block';
  }
  _mtRender();
}

function mtCloseDropdown() {
  if (!_mtDD || !_mtOpen) return;
  _mtOpen = false;
  _mtActive = -1;
  _mtDD.style.display = 'none';
}

function _mtScrollActiveIntoView() {
  const row = _mtEl('rp-mt-list') && _mtEl('rp-mt-list').children[_mtActive];
  if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
}

// Returns true when the key was consumed, which is how roomPanel's field wiring knows to skip
// its own Enter/Escape handling. Escape closes the LIST first and only reverts the field on a
// second press — otherwise dismissing an accidentally-opened dropdown would also throw away
// whatever the DM had typed.
function mtNameKeyDown(e) {
  if (!_mtDD) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!_mtOpen) mtOpenDropdown();
    if (!_mtShown.length) return true;
    e.preventDefault();
    const n = _mtShown.length;
    const d = e.key === 'ArrowDown' ? 1 : -1;
    // Nothing highlighted yet: Down enters at the top, Up enters at the bottom. After that it
    // wraps, so holding Down never dead-ends at the last row.
    _mtActive = _mtActive < 0 ? (d > 0 ? 0 : n - 1) : (_mtActive + d + n) % n;
    _mtRender();
    _mtScrollActiveIntoView();
    return true;
  }
  if (e.key === 'Enter' && _mtOpen && _mtActive >= 0 && _mtActive < _mtShown.length) {
    e.preventDefault();
    _mtPick(_mtActive);
    return true;
  }
  if (e.key === 'Escape' && _mtOpen) {
    e.preventDefault();
    mtCloseDropdown();
    return true;
  }
  return false;
}

// Called once from initRoomPanel(), with the name input. DM-only by inheritance: that init
// already returns early in player mode.
function initModuleText(nameEl) {
  mtLoadStored();
  _mtInitModal();

  _mtNameEl = nameEl;
  if (!_mtNameEl) return;
  const ident = _mtNameEl.parentElement;
  if (!ident) return;
  _mtDD = _mtBuildDropdown(ident);

  _mtNameEl.addEventListener('focus', mtOpenDropdown);
  _mtNameEl.addEventListener('input', () => {
    if (!_mtOpen) mtOpenDropdown();
    _mtActive = -1;
    _mtRender();
  });
  // The field's own blur commits the typed value (roomPanel). The list has to go with it, and
  // a frame of delay is what lets a mousedown on a row land before the list disappears.
  _mtNameEl.addEventListener('blur', () => setTimeout(mtCloseDropdown, 0));
}

// ─── Node.js export guard (unit tests only) ──────────────────────────────────
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
