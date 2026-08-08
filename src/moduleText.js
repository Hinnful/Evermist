'use strict';
// moduleText.js — the published module's text, put inside the room name field.
//
// Load the book once and every room's name field becomes a searchable list of its locations.
// The expensive part of prep was never the typing, it was the round trip into a badly
// formatted book eighty times.
//
// No auto-assign and no "fill all rooms": real module text has sub-locations, so any 1:1
// mapping desyncs within a few rooms. The human picking is the one irreducible step. No LLM
// and no network — the app works offline from file:// and stays that way.
//
// Scope is CAMPAIGN-LEVEL: entries live in localStorage, never in a scene or a backup. What
// belongs to a scene is the text a room ends up carrying, which rides the room's own fields.
//
// Called once from initRoomPanel() (DM only). Parser rules in CLAUDE.md, rejected designs in
// docs/DECISIONS.md.

// ─── Pure kernel (unit-tested — keep DOM-free) ────────────────────────────────
// Everything above the "Storage" divider takes arguments and returns values. Same split as
// fogGeometry.js: parsing is where the bugs hide, so that is what the tests cover.

// A heading's NAME, not the whole line. Real headings are short, and this bound is what stops
// a hard-wrapped numbered list item in prose from passing the shape test.
const MT_HEADING_MAX_NAME = 48;

// A running header is SHORT — without this bound a repeated paragraph would be dropped, which
// is data loss rather than cleanup.
const MT_FURNITURE_MAX_LEN = 90;
// …and more than one word. This protects a wrapped prose fragment starting with a number:
// "10 футов" and "12 футов" share the key "футов" with differing numbers, which is exactly the
// shape the page-number rule looks for.
const MT_FURNITURE_MIN_WORDS = 2;

// Normalise to one line per line: CRLF, tabs, non-breaking spaces, runs of spaces.
//
// ⚠ THREE OF THE CHARACTERS BELOW ARE INVISIBLE and retyping the lines destroys them: the
// hyphen class holds U+00AD and U+2010, and the whitespace class holds a literal U+00A0 next
// to the \t. Losing the NBSP silently stops non-breaking spaces being normalised.
//
// The hyphens become a plain '-' rather than being stripped, because mtReflow() keys "this word
// was split across lines" on a trailing hyphen. En and em dashes are left alone: punctuation,
// not word breaks.
function mtSplitLines(raw) {
  return String(raw == null ? '' : raw)
    .replace(/\r\n?/g, '\n')
    .replace(/[­‐]/g, '-')
    .split('\n')
    .map(l => l.replace(/[\t ]+/g, ' ').replace(/ {2,}/g, ' ').trim());
}

// Does this line have the SHAPE of a heading? A SHAPE test only — mtPickHeadings() decides
// whether it really is one.
//
// \p{Lu} rather than [A-Z] is the whole reason this works on a translation. Never reach for
// [A-Z] here: one shop's six rooms come out of the book as Cyrillic А, В, С, Е mixed with
// Latin D and F.
//
// The number may carry ONE CAPITAL PREFIX ("К12. Часовня") — a digit-only pattern finds nothing
// in a chapter keyed К1-К88 — and ONE TRAILING LETTER, a SUB-LOCATION ("N6А" is a room inside
// the shop keyed "N6"). Both are carried into the room's name, because that is what the DM says
// out loud and what the map label reads.
//
// TWO patterns, because a prefixed key is itself evidence of a heading: a numbered list in prose
// never carries one. So a prefixed heading is allowed a lowercase name and a lowercase
// sub-letter, where a bare-numbered one is not. The real book needs both.
const MT_HEADING_RE      = /^(\p{Lu})(\d{1,3})(\p{L})?\.[ ](\p{L}.*)$/u;
const MT_HEADING_RE_BARE = /^()(\d{1,3})(\p{Lu})?\.[ ](\p{Lu}.*)$/u;

function mtHeadingCandidate(line) {
  const s = String(line == null ? '' : line);
  const m = MT_HEADING_RE.exec(s) || MT_HEADING_RE_BARE.exec(s);
  if (!m) return null;
  // A single TRAILING PERIOD is allowed and stripped — the full book has headings like
  // "К43. Ванная комната." and rejecting them lost real rooms. What still disqualifies a line
  // is ending mid-clause, or carrying two sentences.
  const name = m[4].trim().replace(/\.$/, '').trim();
  if (!name || name.length > MT_HEADING_MAX_NAME) return null;
  if (/[,;:!?]$/.test(name)) return null;    // ends mid-clause, so it is prose
  if (/\.[ ]/.test(name)) return null;       // two sentences sharing a line
  return { prefix: m[1], num: parseInt(m[2], 10), letter: m[3] || '', name };
}

// Every shape-matching line, MINUS the ones local context exposes as list items.
//
// A numbered list in prose is shaped exactly like a heading and cannot be told apart line by
// line. Two language-neutral context signals do it: the previous non-blank line ends with a
// COLON, which is what introduces a list; and the line above is itself a flagged list item
// numbered one lower, which propagates the flag down the rest of it.
//
// Rooted in the colon rather than applied to any adjacent pair, deliberately: "1. Вход"
// followed by "2. Главный холл" is an ordinary pair of headings, and an unrooted adjacency
// rule would eat it.
//
// KNOWN LIMITATION: a numbered list before the first real heading, not introduced by a colon,
// is indistinguishable from the room sequence. The import panel's list is what shows the DM
// that happened.
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

// Which candidates are ACTUALLY headings: walk them in document order and keep each one whose
// number continues the sequence FOR ITS OWN PREFIX.
//
// Greedy continuation, not longest-increasing-subsequence, which was tried and is wrong here: a
// three-item list restarting at 1 between rooms 12 and 13 forms a longer chain than the rooms
// do, so LIS picks the list. A number that does not exceed the last heading is a restart, and a
// restart is never a heading.
//
// Per-prefix, because a module keys each area separately (К1-К88 after 1-13). One shared
// counter would reject К1 for not exceeding 13 and lose the chapter. Two UNPREFIXED chapters in
// one file still collide on the second — import one chapter at a time.
//
// The prefix is CANONICALISED for sequencing, never for display: the same chapter arrives keyed
// with both Cyrillic К and Latin K, and as separate sequences each rejects the other's numbers.

// How far ahead to look for the sequence's immediate successor. Small on purpose: the false
// heading this defends against sits inside the current room's own text.
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

    // A SUB-LOCATION sequences on UNIQUENESS of its letter under its parent number, never on
    // letter order. Ordering cannot work: the letters arrive in mixed alphabets, so any ordinal
    // has to pick a scale, and a chapter keyed purely Cyrillic А/Б/В folds А and В onto the
    // Latin scale while Б stays Cyrillic — В lands below Б and the room vanishes. Uniqueness
    // needs no scale, and the false positive ordering would defend against does not exist: a
    // lettered list in prose is written "а)", never "N6а.".
    //
    // The parent bounds it instead. A sub may sit on the number the sequence has reached, or
    // open the next one (its parent heading was lost in extraction). A sub numbered BELOW the
    // current room is a body-text cross-reference.
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
    // inside a room's text is shaped exactly like a heading, and one of them is expensive: a
    // stray "К7." inside К1's description pushed the sequence to 7 and cost six rooms. So a
    // forward JUMP is only taken when nothing just ahead continues properly; plain gaps still
    // work, since "1, 4, 9" has no 2 or 5 to prefer.
    //
    // The prev > 0 guard is load-bearing and was a real regression without it: on the FIRST
    // candidate it means "prefer whatever starts at 1", so a numbered list beat rooms keyed
    // from 11 and the chapter was lost.
    if (prev > 0 && c.num > prev + 1 && mtSuccessorAhead(list, i, p, prev + 1)) return;
    last.set(p, c.num);
    out.push(c);
  });
  return out;
}

// Cyrillic capitals visually identical to a Latin one, folded onto the Latin. Only these twelve
// — the pairs a reader cannot tell apart, which is exactly the set that gets mixed unnoticed.
const MT_HOMOGLYPHS = { 'А':'A','В':'B','Е':'E','К':'K','М':'M','Н':'H','О':'O','Р':'P','С':'C','Т':'T','У':'Y','Х':'X' };

function mtCanonPrefix(prefix) {
  const p = String(prefix == null ? '' : prefix);
  return MT_HOMOGLYPHS[p] || p;
}

// Same fold for a sub-letter, plus a case fold: a prefix is always a capital by the pattern,
// but a sub-letter may be written either way and "N6e" is "N6Е".
function mtCanonLetter(letter) {
  return mtCanonPrefix(String(letter == null ? '' : letter).toUpperCase());
}

// Split a line into the page number a PDF extractor stuck on it and the text that remains.
// Either end, since which end depends on the page layout. `num` is null when the line carries
// no number — and a line with no number can never be page furniture, which is most of the
// protection this pass needs.
//
// `fused` means digits ran STRAIGHT into a capital ("209Приложение"). That is page furniture
// with certainty in any language, and the one signal strong enough to condemn a single
// sighting. The capital matters: "1к10 дней" is digits against a lowercase letter, and prose.
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
// THE RULE IS "the same text with a DIFFERENT number attached", never "seen three times". The
// count-based version got the live sample backwards in both directions: it deleted a legitimate
// sub-heading that recurs because three rooms share a dumbwaiter, and it kept a running header
// that a two-page excerpt only sees twice. The number is what a sub-heading structurally never
// has. A key with no number attached is untouchable however often it recurs.
//
// Two exemptions: a heading-shaped line is never counted (which also stops two rooms called
// "Кладовая" from condemning each other), and a line too long to be a header, or shorter than
// MT_FURNITURE_MIN_WORDS, is left alone.
//
// KNOWN GAP, deliberately left: a ONE-WORD running header separated from its page number by a
// space survives into a description as visible noise. The alternative bar is low enough to
// start eating real one-word sub-headings.
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
    // e.fused condemns every sighting of the key, not just the fused one, so the spaced
    // siblings go with it rather than surviving on a space.
    return !(e && (e.fused || e.nums.size >= 2));
  });
}

// The document's hard-wrap MARGIN — the 90th percentile of its non-blank line lengths.
//
// A high percentile, not the median, and the real text settled it: the wrap margin is where
// lines get CUT, so it lives at the top of the distribution. The median measures a typical
// FILLED line and sits ~8 characters below the real boundary, which misses most paragraph ends.
// p90 is near the margin and robust to one freak long line in a way the maximum is not.
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
// paragraph. This is the only paragraph signal the real book gives — its extraction contains no
// blank lines at all, so without this rule every room arrives as one wall of text.
//
// Both halves work. Hard wrapping fills every line to the margin, so a short line ended early;
// and a new paragraph starts a new sentence, so its first character is a capital, quote or
// digit. The length bound is also what stops an abbreviation from splitting a paragraph.
//
// Deliberately NOT requiring a full stop: that version glued every sub-heading onto the
// paragraph below it, because a sub-heading is exactly a short line with no terminator.
//
// The fraction is measured. On the real text filled lines cluster at 43-57 characters and
// paragraph-final ones at 15-30, which puts the boundary comfortably between them. Erring low
// is the safe direction: under-splitting is invisible, over-splitting chops sentences apart.
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
//   a short line before a capital → paragraph break, when wrapWidth is known
//
// The lowercase test is the standard heuristic and is not perfect: a genuine compound that
// wraps at its own hyphen loses it. Keeping the hyphen before a capital covers proper-noun
// compounds, and the remainder is a wrong hyphen the DM can see — far cheaper than the
// alternative failure, every long word glued to the next one.
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
    // Tested on the LINE and its successor, not the paragraph built so far: it is this line's
    // own length that says whether the extractor wrapped it or it ended early.
    if (mtEndsParagraph(line, src[i + 1], wrapWidth)) flush();
  }
  flush();
  return paras.join('\n\n');
}

// The whole pipeline: raw text → the entries the dropdown offers.
//
// Order is load-bearing. Furniture first, so a running header cannot be glued into the middle
// of a paragraph by the reflow. Reflow last, per entry, so a heading is never absorbed into the
// paragraph above it.
//
// KNOWN AND ACCEPTED: a sidebar between two headings is absorbed into the preceding room,
// roughly one room in thirteen. There is deliberately no sidebar classifier — see DECISIONS.
function parseModuleText(raw) {
  const lines = mtDropFurniture(mtSplitLines(raw));
  const cands = mtHeadingCandidates(lines);
  const heads = mtPickHeadings(cands);
  // Measured over the WHOLE document, not per entry: a short room would otherwise take its wrap
  // width from three lines and get a meaningless one.
  const wrap = mtWrapWidth(lines);
  const entries = heads.map((h, k) => ({
    // `num` carries the prefix and sub-letter EXACTLY as the book writes them — the homoglyph
    // fold is for sequencing only, so a room the page calls "N6С" never becomes "N6C".
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
// The diacritic strip is scoped to LATIN base letters, which is the whole point: a blanket
// "NFD then drop combining marks" also decomposes Cyrillic, where й is и + breve, silently
// merging two letters that distinguish real words (мой / мои). Caught by a test.
//
// ё → е is folded back in explicitly, because ё is routinely typed as е and a DM searching
// "елка" must find "Ёлка".
function mtFold(s) {
  return String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/(\p{Script=Latin})\p{M}+/gu, '$1')
    .normalize('NFC')
    .replace(/[ёЁ]/g, 'е')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

// Filter + rank for the dropdown. Every query token must appear in the title, so "гл холл"
// finds "Главный холл"; ranking then floats an exact room number first, then a name starting
// with the query, then a word that does. Returns entries, not indices — the caller has no
// business knowing the storage order.
function mtFilterEntries(entries, query) {
  const list = Array.isArray(entries) ? entries : [];
  const q = mtFold(query);
  if (!q) return list.slice();
  const toks = q.split(' ').filter(Boolean);
  const hits = [];
  list.forEach((e, i) => {
    // The key is FOLDED before comparing, because it can carry a capital prefix while the query
    // has already been lowercased. Comparing raw made an exact key match unrankable.
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

// Which entries are already on the map, matched on the folded title so whitespace or case
// doesn't read as unplaced. A placed entry stays SELECTABLE: one heading legitimately serves
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
// NOT IndexedDB: sceneStore.js is keyed by scene id at DB_VERSION 1, so a campaign-level store
// there means a version bump and an upgrade path on the database holding the user's maps, to
// buy nothing for a few hundred KB.
//
// Only PARSED ENTRIES are stored, never the raw file — it is 2-3× the size, trivially
// re-obtainable, and keeping a copy of a commercial module is not this app's business.

const MT_KEY = 'evermist.moduleText';
// Deliberately loose rather than safe: this is a sanity check, NOT the quota guard. A whole
// 255-page module is ~900K chars stored, i.e. 2.3× under this limit — so a file big enough to
// pass here and still blow Chrome's ~5MB budget is possible, which is why mtStore() catches the
// write and reports it instead of trusting this number.
const MT_MAX_CHARS = 2 * 1024 * 1024;
const MT_FORMAT = 1;

// Compact on purpose: three-element arrays rather than objects, because key names would be ~20%
// of the payload and nothing outside this file reads the serialised form.
function mtSerialize(entries, sourceName) {
  return JSON.stringify({
    v: MT_FORMAT,
    src: String(sourceName || ''),
    at: Date.now(),
    e: (Array.isArray(entries) ? entries : []).map(x => [x.num, x.name, x.body]),
  });
}

// Tolerant by design: anything unrecognised returns null and the app behaves as if no module
// were loaded. A corrupt key must never wedge the room card.
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

// Returns { ok, error } rather than throwing: the caller is a panel that has to say something
// useful, and a failed write is a normal outcome when storage is full or disabled.
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

// Names of every room in the CURRENT scene — the input to the placed count. Reads the global
// `polygons`, so it is the boundary between the pure kernel above and the app.
function mtCurrentRoomNames() {
  if (typeof polygons === 'undefined' || !Array.isArray(polygons)) return [];
  return polygons.map(p => (p.name != null ? p.name : ''));
}

// ─── Import panel ─────────────────────────────────────────────────────────────
//
// THREE CONTROLS: Choose file, Remove, Close. Do not add a fourth. The paste box, the Preview
// button and the explanatory paragraph were all cut — see DECISIONS for why each was wrong.
//
// IMPORTING HAPPENS ON CHOOSE, with no confirm step, and three things keep that safe: an empty
// parse never writes, the list below shows what is loaded every time the panel opens, and
// Remove is right there. All three must stay.
//
// No drag-and-drop: the app's existing drop handler belongs to map loading, and a second
// meaning for the same gesture would make dropping a file ambiguous.

function _mtEl(id) { return document.getElementById(id); }

// `status` overrides the default "what is loaded" line, which is how an error shows WITHOUT
// hiding the module still loaded underneath it.
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
  // Focus the panel itself (tabindex="-1") so Escape has somewhere to land — there is no text
  // field in here to hold focus.
  modal.focus();
}

function closeModuleTextModal() {
  _mtEl('mt-backdrop').style.display = 'none';
  _mtEl('mt-modal').style.display = 'none';
}

// Bytes → text, UTF-8 first and Windows-1251 second.
//
// A CP1251 .txt decodes as UTF-8 into replacement characters rather than an error, so the DM
// would see mojibake and not know why; `fatal: true` turns that silent corruption into a signal.
// UTF-8 goes first because UTF-8 bytes are also valid-looking CP1251, so the ORDER is the
// safeguard.
const MT_ENCODINGS = ['utf-8', 'windows-1251'];

function _mtDecode(buf) {
  if (!buf) return null;
  for (const enc of MT_ENCODINGS) {
    try { return new TextDecoder(enc, { fatal: true }).decode(buf); } catch (_) {}
  }
  // Last resort: decode leniently rather than refusing outright. A handful of bad bytes in an
  // otherwise readable book should not block the import.
  try { return new TextDecoder('utf-8').decode(buf); } catch (_) { return null; }
}

// Is this a PDF? Decided on RAW BYTES before any decode, since a PDF's body is compressed
// binary no text decoder should be asked about. Scanned in the first kilobyte rather than
// required at byte 0, because a file can carry a few bytes of preamble and every reader
// tolerates that.
function _mtIsPdf(buf) {
  if (!buf || !buf.byteLength) return false;
  const head = new Uint8Array(buf, 0, Math.min(1024, buf.byteLength));
  for (let i = 0; i + 4 < head.length; i++) {
    if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 && head[i + 3] === 0x46) return true;
  }
  return false;
}

// Name the container format if this is obviously not prose, else null. The point is to say
// "that's a .docx" rather than preview its compressed streams. PDFs never reach here (converted
// upstream); the branch stays as a backstop.
function _mtBinaryKind(text) {
  const head = String(text || '').slice(0, 8);
  if (head.startsWith('%PDF')) return 'a PDF';
  if (head.startsWith('PK') && head.charCodeAt(2) === 3) return 'a .docx or .zip';
  if (head.startsWith('{\\rtf')) return 'an RTF file';
  if (head.charCodeAt(0) === 0xD0 && head.charCodeAt(1) === 0xCF) return 'an old .doc file';
  // Catch-all: C0 control characters other than tab/newline/return. Prose contains none, a
  // binary read as text is full of them, and 2% sits far above one stray byte. Written as
  // escapes on purpose - the literal characters would make this file register as binary to
  // grep and every other tool.
  const sample = String(text || '').slice(0, 4000);
  if (!sample) return null;
  const CTRL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]', 'g');
  const ctrl = (sample.match(CTRL) || []).length;
  return ctrl / sample.length > 0.02 ? 'a binary file' : null;
}

// Parse and STORE in one step. An empty parse deliberately writes nothing: the likely cause is
// the wrong file or chapter, and losing a good import to that is the one unrecoverable thing
// this panel could do.
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

  // Floats over the map like every other panel: a click inside, or a keystroke typed into it,
  // must never reach the canvas handlers or the global shortcuts.
  const modal = _mtEl('mt-modal');
  modal.addEventListener('mousedown', e => e.stopPropagation());
  modal.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') closeModuleTextModal();
  });

  // Clear the input BEFORE opening the dialog, every time. A file input fires no `change` when
  // the same file is picked again, so without this the second pick is silently dead — which is
  // exactly what happens after a parse the DM didn't like. Clearing on panel-open alone left
  // the hole open for as long as the panel stayed up.
  _mtEl('btn-mt-file').addEventListener('click', () => {
    const input = _mtEl('mt-file-input');
    input.value = '';
    input.click();
  });

  // Its own <input type=file>, NOT the app's #file-input: that one belongs to the map loader
  // and accepts images, video and .zip. Reading it here would be a silent way to feed a .webm
  // to the parser.
  _mtEl('mt-file-input').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = async () => {
      const buf = rd.result;

      // A PDF is CONVERTED, not refused — a campaign module ships as a PDF and the DM should
      // not have to prepare a file. The conversion is main-process work (pdfjs-dist is
      // ESM-only), so it is Electron-only, the same as backup.
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
      // Anything else that isn't prose gets NAMED rather than parsed as prose. The dialog's
      // "All files" option lets a .docx through the filter, and without this the DM gets a list
      // of binary garbage and no idea why.
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
  // confirmation that it worked.
  _mtEl('btn-mt-remove').addEventListener('click', () => {
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
// #rp-name keeps working EXACTLY as before when nothing matches or nothing is loaded. The list
// is additive: it opens on focus, filters as the DM types, and picking fills name and
// description together.
//
// It lives INSIDE the card (absolutely positioned in .rp-ident) rather than floating over the
// page, which buys two things free: #panel-room's `zoom: var(--ui-zoom)` applies to it, so there
// is no repeat of the screen-px problem _rpScreenToStyle() exists to solve, and it cannot be
// orphaned when the card moves. It overlays the description while open, which is the right
// trade — the DM is naming the room at that moment, not reading it.
//
// The FOOTER ROW is the only entry point to the import panel.

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

  // TWO listeners, and the split is load-bearing.
  //
  // mousedown only PREVENTS THE DEFAULT: the pointer going down in the list would otherwise
  // blur the name field, closing the list out from under itself.
  //
  // The act waits for CLICK, one event later, which keeps a dialog out of the middle of a mouse
  // gesture. Picking can raise the "replace your description?" confirm, and a dialog opened
  // from mousedown blocks before the matching mouseup is delivered — the browser then believes
  // the button is still down and the next click on the field never lands a caret. It takes two
  // picks in a row to see, since the first has no description to replace.
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
  // The write is roomPanel's — it owns the room's fields, the undo entry and the autosave.
  // This module owns the book, not the room.
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
  // holds — otherwise opening the card on "4. Кухня" shows one row, the entry that is already
  // there, and hides the list the DM opened it to see.
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
    // Marked but still selectable — one heading can legitimately serve several polygons.
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
    none.textContent = 'No match. Press Enter to keep what you typed';
    list.appendChild(none);
  }

  _mtEl('rp-mt-load').textContent = mtEntries.length
    ? 'Replace module text…' : 'Load module text…';
}

// Opening an already-open list RE-RENDERS rather than returning early: the progress count and
// the placed dots derive from the current scene's room names, so an early return kept the state
// the list was built in.
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
// second press, so dismissing an accidental dropdown doesn't throw away what was typed.
function mtNameKeyDown(e) {
  if (!_mtDD) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!_mtOpen) mtOpenDropdown();
    if (!_mtShown.length) return true;
    e.preventDefault();
    const n = _mtShown.length;
    const d = e.key === 'ArrowDown' ? 1 : -1;
    // Nothing highlighted yet: Down enters at the top, Up at the bottom. After that it wraps.
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
  // The field's own blur commits the typed value. The list goes with it, and a frame of delay
  // is what lets a mousedown on a row land before the list disappears.
  _mtNameEl.addEventListener('blur', () => setTimeout(mtCloseDropdown, 0));
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
