'use strict';
// moduleText.js — the published module's text, put inside the room name field.
//
// No auto-assign and no "fill all rooms": real module text has sub-locations, so any 1:1
// mapping desyncs within a few rooms. No LLM and no network — the app works offline.
//
// Scope is CAMPAIGN-LEVEL: entries live in localStorage, never in a scene or a backup. What a
// scene carries is the text a room ends up with, which rides the room's own fields.
//
// Called once from initRoomPanel() (DM only). Parser rules in CLAUDE.md, rejected designs in
// docs/DECISIONS.md.

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
const MT_HEADING_RE      = /^(\p{Lu})(\d{1,3})(\p{L})?\.[ ](\p{L}.*)$/u;
const MT_HEADING_RE_BARE = /^()(\d{1,3})(\p{Lu})?\.[ ](\p{Lu}.*)$/u;

function mtHeadingCandidate(line) {
  const s = String(line == null ? '' : line);
  const m = MT_HEADING_RE.exec(s) || MT_HEADING_RE_BARE.exec(s);
  if (!m) return null;
  // A single TRAILING PERIOD is allowed and stripped — the book has headings like "К43. Ванная
  // комната." and rejecting them lost real rooms. Mid-clause endings still disqualify a line.
  const name = m[4].trim().replace(/\.$/, '').trim();
  if (!name || name.length > MT_HEADING_MAX_NAME) return null;
  if (/[,;:!?]$/.test(name)) return null;    // ends mid-clause, so it is prose
  if (/\.[ ]/.test(name)) return null;       // two sentences sharing a line
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
  return out;
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
// Two exemptions: a heading-shaped line is never counted, and a line too long to be a header, or
// shorter than MT_FURNITURE_MIN_WORDS, is left alone.
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
//   a short line before a capital → paragraph break, when wrapWidth is known
//
// The lowercase test is imperfect: a genuine compound wrapping at its own hyphen loses it. That
// leaves a wrong hyphen the DM can see, far cheaper than every long word glued to the next.
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
  const cands = mtHeadingCandidates(lines);
  const heads = mtPickHeadings(cands);
  // Measured over the WHOLE document: a short room would take its width from three lines.
  const wrap = mtWrapWidth(lines);
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
// NOT IndexedDB: sceneStore.js is keyed by scene id, so a campaign-level store there means a
// version bump and an upgrade path on the database holding the user's maps.
// Only PARSED ENTRIES are stored, never the raw file — keeping a copy of a commercial module is not
// this app's business.

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
// The book is CAMPAIGN-level, so it rides in the backup zip as one entry at the root, never as
// per-scene metadata. These three functions are the whole contract: backup.js never learns the
// serialised format and never touches MT_KEY.

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

// ─── Import panel ─────────────────────────────────────────────────────────────
// THREE CONTROLS: Choose file, Remove, Close. Do not add a fourth — see DECISIONS.
//
// IMPORTING HAPPENS ON CHOOSE, with no confirm step, and three things keep that safe: an empty
// parse never writes, the list shows what is loaded whenever the panel opens, and Remove is right
// there. All three must stay.
//
// No drag-and-drop: the drop handler belongs to map loading, and a second meaning for the same
// gesture would make dropping a file ambiguous.

function _mtEl(id) { return document.getElementById(id); }

// `status` overrides the "what is loaded" line, so an error shows without hiding the module.
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
  // Focus the panel itself (tabindex="-1") so Escape has somewhere to land.
  modal.focus();
}

function closeModuleTextModal() {
  _mtEl('mt-backdrop').style.display = 'none';
  _mtEl('mt-modal').style.display = 'none';
}

// Bytes → text, UTF-8 first and Windows-1251 second. `fatal: true` turns silent mojibake into a
// signal, and UTF-8 goes first because UTF-8 bytes are also valid-looking CP1251 — the ORDER is
// the safeguard.
const MT_ENCODINGS = ['utf-8', 'windows-1251'];

function _mtDecode(buf) {
  if (!buf) return null;
  for (const enc of MT_ENCODINGS) {
    try { return new TextDecoder(enc, { fatal: true }).decode(buf); } catch (_) {}
  }
  // Last resort: a handful of bad bytes should not block an otherwise readable book.
  try { return new TextDecoder('utf-8').decode(buf); } catch (_) { return null; }
}

// Is this a PDF? RAW BYTES, before any decode, scanned in the first kilobyte for a preamble.
function _mtIsPdf(buf) {
  if (!buf || !buf.byteLength) return false;
  const head = new Uint8Array(buf, 0, Math.min(1024, buf.byteLength));
  for (let i = 0; i + 3 < head.length; i++) {
    if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 && head[i + 3] === 0x46) return true;
  }
  return false;
}

// Name the container format if this is obviously not prose, else null — so the panel says "that's
// a .docx" rather than previewing compressed streams. PDFs are converted upstream; the branch
// stays as a backstop.
function _mtBinaryKind(text) {
  const head = String(text || '').slice(0, 8);
  if (head.startsWith('%PDF')) return 'a PDF';
  if (head.startsWith('PK') && head.charCodeAt(2) === 3) return 'a .docx or .zip';
  if (head.startsWith('{\\rtf')) return 'an RTF file';
  if (head.charCodeAt(0) === 0xD0 && head.charCodeAt(1) === 0xCF) return 'an old .doc file';
  // Catch-all: C0 control characters other than tab/newline/return, which prose never contains.
  // ⚠ Written as escapes — the literal characters make this file register as binary to grep.
  const sample = String(text || '').slice(0, 4000);
  if (!sample) return null;
  const CTRL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]', 'g');
  const ctrl = (sample.match(CTRL) || []).length;
  return ctrl / sample.length > 0.02 ? 'a binary file' : null;
}

// Parse and STORE in one step. ⚠ An empty parse writes nothing: that loss is unrecoverable.
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

  // Floats over the map: a click or keystroke inside must never reach the canvas handlers.
  const modal = _mtEl('mt-modal');
  modal.addEventListener('mousedown', e => e.stopPropagation());
  modal.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') closeModuleTextModal();
  });

  // ⚠ Clear the input BEFORE opening the dialog, every time. A file input fires no `change` when
  // the same file is picked again, so without this the second pick is silently dead.
  _mtEl('btn-mt-file').addEventListener('click', () => {
    const input = _mtEl('mt-file-input');
    input.value = '';
    input.click();
  });

  // ⚠ Its own <input type=file>, never #file-input, which is a silent way to feed it a .webm.
  _mtEl('mt-file-input').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = async () => {
      const buf = rd.result;

      // A PDF is CONVERTED, not refused. Main-process work, so Electron-only like backup.
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
      // Anything else that isn't prose gets NAMED, or a .docx lists as binary garbage.
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

  // Removing does NOT close the panel: the empty state is the confirmation that it worked.
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
// #rp-name keeps working EXACTLY as before when nothing matches or nothing is loaded. The list is
// additive: it opens on focus, filters as the DM types, and picking fills name and description.
//
// ⚠ It lives INSIDE the card (absolutely positioned in .rp-ident), never floating over the page, so
// #panel-room's `zoom: var(--ui-zoom)` applies and it cannot be orphaned when the card moves.
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

  // ⚠ TWO listeners, and the split matters. mousedown only PREVENTS THE DEFAULT, or the pointer
  // going down in the list blurs the name field and closes the list out from under itself.
  //
  // The act waits for CLICK, one event later, which keeps a dialog out of the middle of a mouse
  // gesture: a dialog opened from mousedown blocks before the matching mouseup is delivered.
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
  // The write is roomPanel's: it owns the room's fields, the undo entry and the autosave.
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

  // Filter on the typed text ONLY once it differs from the field's own, or one row shows.
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

// Opening an already-open list RE-RENDERS, or the count and placed dots go stale.
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

// True when the key was consumed. Escape closes the LIST first, reverting only on a second press.
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

// Called once from initRoomPanel(). DM-only: that init returns early in player mode.
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
  // The field's blur commits; the frame of delay lets a mousedown on a row land first.
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
