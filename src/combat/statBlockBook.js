'use strict';

// statBlockBook.js — cuts a book into stat blocks for statBlockParse.js and judges each one. Lines
// arrive as "font\u0001lead\u0001text" (plDocumentBlockText); plain text has shapes but no fonts.

const SBB = (typeof module !== 'undefined' && module.exports) ? require('./statBlockParse.js')
  : { statBlockFromLines, statBlockTypes, _sbLabel, _sbSection, _sbEntry, SB_SIZE, SB_ABIL_TOKEN };

const BK_BRACKET = /^\[[^\]]*\]$/;
const BK_HEADER_SKIP = 15;
const BK_MAX_LINES = 250;
const BK_HEADER_LINES = 12;
const BK_LORE_LIFT = 0.3;
const BK_ASIDE_LINES = 12;
const BK_ASIDE_LONG = 60;
const BK_RESUME = 10;
const BK_NAME_CAPS = 0.7;
const BK_NAME_BACK = 80;

function _bkStat(t) {
  const lab = SBB._sbLabel(t);
  return lab && (lab.field === 'ac' || lab.field === 'hp') && /\d/.test(lab.value) ? lab.field : null;
}

// AC and HP within three lines: prose such as "КД 15, 25 хитами" has only one of them.
function _bkAnchor(texts, i) {
  const f = _bkStat(texts[i]);
  if (!f) return false;
  for (let k = i + 1; k <= i + 3 && k < texts.length; k++) {
    const g = _bkStat(texts[k]);
    if (g && g !== f) return true;
  }
  return false;
}

// A stat block's name: a short line with its size line below it, then AC or HP.
function statBlockHeadAt(texts, i) {
  const t = texts[i] || '';
  if (t.length < 2 || t.length > 60 || /[.:]$/.test(t) || SBB._sbLabel(t) || BK_BRACKET.test(t)) return false;
  const j = BK_BRACKET.test(texts[i + 1] || '') ? i + 2 : i + 1;
  if (!SBB.SB_SIZE.test(texts[j] || '')) return false;
  for (let k = j + 1; k <= j + 3 && k < texts.length; k++) if (_bkStat(texts[k])) return true;
  return false;
}

// Running heads: words with a page number that climbs, "12 аболет", "аболет13", "273System Reference
// Document 5.2.1", alone or run onto a line; in the body's own font only if seen on ten pages.
const _bkHeadKey = w => w.toLowerCase().replace(/[\d.\s]+$/, '').replace(/\s+/g, '');
function _bkFurniture(lines) {
  const tally = new Map();
  lines.forEach(l => { if (l.f) tally.set(l.f, (tally.get(l.f) || 0) + 1); });
  const common = new Set([...tally].sort((x, y) => y[1] - x[1]).slice(0, 2).map(e => e[0]));
  const keyOf = (t, f) => {
    if (t.length > 50 || SBB._sbLabel(t) || SBB._sbSection(t)) return null;
    const m = t.match(/^(\d{1,3})\s*(\p{L}[^\d]*(?:\d[\d. ]*)?)$/u) || t.match(/^(\p{L}[^\d]*?(?:\d+(?:\.\d+)+)?)\s*(\d{1,3})$/u);
    if (!m) return null;
    const words = /^\d/.test(m[1]) ? m[2] : m[1];
    return (words.match(/\p{L}/gu) || []).length >= 4 ? [_bkHeadKey(words), +(/^\d/.test(m[1]) ? m[1] : m[2]), common.has(f)] : null;
  };
  const nums = new Map(), bodyFont = new Set();
  for (const l of lines) {
    const k = keyOf(l.t, l.f);
    if (k) nums.set(k[0], (nums.get(k[0]) || []).concat(k[1]));
    if (k && k[2]) bodyFont.add(k[0]);
  }
  const heads = new Set();
  for (const [key, ns] of nums) {
    let climbs = 0;
    for (let i = 1; i < ns.length; i++) if (ns[i] > ns[i - 1] && ns[i] - ns[i - 1] <= 30) climbs++;
    if (bodyFont.has(key) && ns.length < 10) continue;
    // Seen only twice, a head sits on facing pages; "Внимание 9" and "Внимание 13" is text.
    if (ns.length === 2 ? ns[1] - ns[0] >= 1 && ns[1] - ns[0] <= 2 : ns.length > 2 && climbs >= 0.8 * (ns.length - 1)) heads.add(key);
  }
  lines = lines.filter(l => { const k = keyOf(l.t, l.f); return !k || !heads.has(k[0]); });
  for (const l of lines) {
    const m = heads.size && (l.t.match(/(?<!\d)\d{1,3}(\p{Lu}[\p{L}\d. ]{3,48})$/u) || l.t.match(/(\p{Lu}[\p{L}\d. ]{3,48}?) \d{1,3}$/u));
    if (m && m.index && heads.has(_bkHeadKey(m[1]))) l.t = l.t.slice(0, m.index).trim();
  }
  return lines.filter(l => l.t);
}

// An artist's credit in capitals, fused onto its neighbour: "КЕВ УОЛКЕРаболета".
function _bkUncredit(t, before) {
  // A credit that swallowed the label after it: "ДЖОДИ МЬЮИРКО 4 (1 100 ПО…)".
  t = t.replace(/^(?:\p{Lu}{2,}\.?[ ,]+)+\p{Lu}*?(?=(?:КО|ПО|КБ|КД|ПЗ|CR|AC|HP) [\d\p{Ll}])/u, '')
    // A text layer that sets "З" as the digit: "3атаптывание".
    .replace(/(^|[\s(])3(?=[а-яё]{3})/g, '$1З');
  if (!/\p{Ll}/u.test(t) || SBB.SB_ABIL_TOKEN.test(t)) return t;
  // After a comma, colon or full stop the fused word starts with a capital, and keeps it.
  return t.replace(/(?:(?:\p{Lu}{2,}|\p{Lu}\.)\.?[ ,]+)+\p{Lu}{2,}(?:[-‑–]\p{Lu}{2,})?[-‑–]?(?=[\p{Ll}\d]|$)|\p{Lu}{3,}[-‑–]?(?=\p{Ll})/gu, (m, at, s) => {
    if (!/\p{Lu}{3}/u.test(m)) return m;
    return /[,:.(]\s*$/.test(at ? s.slice(0, at) : before) && /\p{Lu}$/u.test(m) && /^\p{Ll}{3}/u.test(s.slice(at + m.length)) ? m.slice(-1) : '';
  }).replace(/([.!?])\p{Lu}+$/u, '$1').replace(/(\p{Script=Cyrillic}.*) [a-z]$/u, '$1').replace(/\s{2,}/g, ' ').trim();
}

// A score line, small caps split or not: "Str 14 +2 +2 D ex 13 +1 +1".
const _bkScores = t => SBB.SB_ABIL_TOKEN.test(t.replace(/\b([SDCIW]) (tr|ex|on|nt|is|ha)\b/gi, '$1$2'));

function _bkLines(text) {
  let before = '';
  let lines = String(text || '').split('\n').map(raw => {
    const parts = raw.split('\u0001');
    const t = _bkUncredit(parts[parts.length - 1].replace(/\s+/g, ' ').replace(/^•\s*|\s*•$/g, '').trim(), before);
    before = t || before;
    return { f: parts.length > 1 ? parts[0] : '', lead: parts.length > 2 ? parts[1] : '', t };
  }).filter(l => l.t).flatMap(l => {
    const lab = SBB._sbLabel(l.t), m = lab && lab.field === 'ac' && l.t.match(/ (?=(?:Хиты|Hit Points|HP|ПЗ) \d)/);
    return m ? [{ ...l, t: l.t.slice(0, m.index) }, { ...l, t: l.t.slice(m.index + 1) }] : [l];
  });
  // A caption printed twice over, whole or in pieces: "Квазит.Квазит."; a score line repeats by nature.
  // A name printed twice over above its size line keeps one copy, wrapped or not: "Giant…" / "SnakeSnake".
  const twice = t => t.length >= 4 && t.slice(0, t.length / 2) === t.slice(t.length / 2);
  const half = t => t.slice(0, t.length / 2);
  lines.forEach((l, i) => {
    if (!twice(l.t) || !SBB.SB_SIZE.test((lines[i + 1] || {}).t || '')) return;
    l.t = (i && twice(lines[i - 1].t) ? half(lines[i - 1].t) + ' ' : '') + half(l.t);
  });
  lines.forEach((l, i) => { if (twice(l.t) && lines[i + 1]) lines[i + 1].cut = true; });
  lines = lines.filter(l => _bkScores(l.t) || !twice(l.t) &&
    l.t.replace(/(.{3,40}?)\1/g, '$1').length > l.t.length * 0.65);
  lines = _bkFurniture(lines);
  // The publisher's legal footer on every page; a count of repeats cannot find it, attack lines repeat too.
  lines = lines.filter(l => !/\bNot for resale\b|Permission granted to (?:print|photocopy)/i.test(l.t));
  // A running footer split by a bar, word for word on page after page: "Princes of the Apocalypse v0.1 | Monsters".
  const bars = new Map();
  for (const l of lines) if (/\S \| \S/.test(l.t)) bars.set(l.t, (bars.get(l.t) || 0) + 1);
  lines = lines.filter(l => !(bars.get(l.t) >= 5));
  // A score run onto its header row: "STR DEX CON INT WIS CHA 4" / "(−3)16 (+3) …".
  lines.forEach((l, i) => {
    const m = l.t.match(/^((?:STR|СИЛ)(?: \p{L}+){5}) (\d{1,2})$/u);
    if (m && /^\(/.test((lines[i + 1] || {}).t || '')) { l.t = m[1]; lines[i + 1].t = (m[2] + ' ' + lines[i + 1].t).replace(/\)(?=\d)/g, ') '); }
  });
  // A compound keeps its hyphen across a line break: both halves are words elsewhere, "волка-оборотня".
  const words = new Map();
  for (const l of lines) {
    for (const w of (l.t.toLowerCase().match(/\p{L}+/gu) || []).slice(1, -1)) words.set(w, (words.get(w) || 0) + 1);
  }
  const out = [];
  for (const [i, l] of lines.entries()) {
    // A margin callout on the baseline, mid-sentence: "вампир может5" / "общаться…".
    if (/^\p{Ll}/u.test((lines[i + 1] || {}).t || '')) l.t = l.t.replace(/([а-йл-яё]-?)\d{1,2}$/, '$1');
    const prev = out[out.length - 1];
    if (prev && /\p{L}[-‑]$/u.test(prev.t) && /^\p{Ll}/u.test(l.t)) {
      const a = (prev.t.match(/(\p{L}+)[-‑]$/u) || [])[1].toLowerCase(), b = (l.t.match(/^\p{L}+/u) || [''])[0];
      prev.t = prev.t.slice(0, -1) + (a.length > 2 && words.get(a) > 1 && words.get(b) > 1 ? '-' : '') + l.t;
    } else out.push(l);
  }
  return out;
}

// Lore fonts: common in the book, almost never just under an AC line. A block ends at one.
function _bkLoreFonts(lines, anchors) {
  const total = new Map(), near = new Map();
  lines.forEach(l => { if (l.f) total.set(l.f, (total.get(l.f) || 0) + 1); });
  const zone = new Set();
  for (const a of anchors) for (let k = a; k < a + BK_HEADER_LINES && k < lines.length; k++) zone.add(k);
  for (const k of zone) if (lines[k].f) near.set(lines[k].f, (near.get(lines[k].f) || 0) + 1);
  // Lore runs for paragraphs; an action's name font takes one line between stat block lines.
  const runs = new Map();
  lines.forEach((l, k) => { if (l.f && (!k || lines[k - 1].f !== l.f)) runs.set(l.f, (runs.get(l.f) || 0) + 1); });
  const fonts = new Set();
  if (!zone.size) return fonts;
  for (const [f, n] of total) {
    const lift = ((near.get(f) || 0) / zone.size) / (n / lines.length);
    if (lift < BK_LORE_LIFT && n / lines.length >= 0.01 && n / runs.get(f) >= 2.5) fonts.add(f);
  }
  return fonts;
}

// A closing bracket is no full stop: "Hit: 10 (2d6 + 3)" goes on with its damage type.
const _bkEnds = t => /[.!?…»]$/.test(t);

// An English name is in Title Case: "These effects last for 1 minute." is a sentence.
const _bkProse = n => /^[A-Z]/.test(n) && (n.replace(/\([^)]*\)/g, '').match(/ (?!(?:of|the|and|a|an|to|in|on|with|for|or|by|at|from)\b)[a-z]+/g) || []).length >= 2;

// A name alone on its line, text on the next, once the sentence above has ended: "Укус (только в форме волка)."
const _bkNameOnly = t => /^[\p{Lu}\d+][^.:]{0,90}\.$/u.test(t) &&
  t.replace(/\([^)]*\)/g, '').trim().split(/\s+/).length <= 6;

function _bkName(t) {
  const n = t.replace(/\s*\[[^\]]*\]?\s*$/, '').trim();
  // Small caps arrive in lower case, a stray capital inside a word: "блуждающий оГонёк", "ГиГантская Гиена".
  if (/^\p{Ll}/u.test(n) || /[а-яё]Г/.test(n)) return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
  if (/\p{Ll}/u.test(n) || !/\p{Lu}/u.test(n)) return n;
  return n.toLowerCase().replace(/(^|[\s(-])(\p{L})/gu, (m, a, c) => a + c.toUpperCase());
}

function statBlocksInText(text) {
  const lines = _bkLines(text);
  const texts = lines.map(l => l.t);
  const anchors = [];
  for (let i = 0; i < texts.length; i++) if (_bkAnchor(texts, i) && !(anchors.length && i - anchors[anchors.length - 1] <= 3)) anchors.push(i);
  const lore = _bkLoreFonts(lines, anchors);
  // A sidebar is often another monster's; its title is set in the "вариант :" font, in small caps read as lower case.
  const sidebar = new Set(lines.filter(l => l.f && /^(?:вариант|разновидность|variant)\s*:/.test(l.t)).map(l => l.f));
  const caps = new Map(), seen = new Map();
  for (const l of lines) if (l.f) { seen.set(l.f, (seen.get(l.f) || 0) + 1); if (/^\p{Lu}/u.test(l.t)) caps.set(l.f, (caps.get(l.f) || 0) + 1); }
  for (const [f, c] of caps) caps.set(f, c / seen.get(f));

  const blocks = [];
  let done = -1;
  for (const a of anchors) {
    if (a <= done) continue;
    let top = a;
    for (let k = a - 1; k >= Math.max(0, a - 3); k--) if (SBB.SB_SIZE.test(texts[k])) { top = k; break; }
    if (top === a && a > 0 && texts[a - 1].length <= 60 && /,/.test(texts[a - 1]) && !_bkStat(texts[a - 1])) top = a - 1;
    let n = top - 1;
    while (n > done && (BK_BRACKET.test(texts[n]) || /^\d{1,2}$/.test(texts[n]))) n--;
    // A name wrapped onto a second line: "Некроколония фиолетовых" / "сморчков", "Samulkin Farcaster" / "(Illusionist)".
    const two = n - 1 > done && /^[\p{Ll}(]/u.test(texts[n] || '') && /^\p{Lu}/u.test(texts[n - 1]) && texts[n - 1].length <= 40 &&
      (!lines[n].f || lines[n - 1].f === lines[n].f) ? texts[n - 1] + ' ' : '';
    // A name's first half in the other column: the nearest line above in its font, past other names.
    let lost = '';
    if (!two && n > 0 && /^\p{Ll}/u.test(texts[n]) && lines[n].f && (caps.get(lines[n].f) || 0) > BK_NAME_CAPS) {
      for (let j = n - 1; j > Math.max(0, n - BK_NAME_BACK); j--) {
        if (lines[j].f !== lines[n].f || statBlockHeadAt(texts, j)) continue;
        if (/^\p{Lu}/u.test(texts[j]) && texts[j].length <= 40 && !_bkEnds(texts[j])) lost = texts[j] + ' ';
        break;
      }
    }
    const name = n > done && n >= 0 && texts[n].length <= 60 ? _bkName((two || lost) + texts[n]) : '';
    const nameFont = name && lines[n].f !== lines[a].f ? lines[n].f : '';

    // A block set in the lore font itself (a summon inside a spell) ends by the shape of its lines.
    const own = [a, a + 1, a + 2].some(k => lines[k] && lore.has(lines[k].f));
    const foreign = l => !own && lore.has(l.f);
    const lone = k => lines[k].f && lines[k].f !== (lines[k - 1] || {}).f && lines[k].f !== (lines[k + 1] || {}).f;
    // An entry's name starts in a font of its own; a sentence shaped like one starts in the body's.
    const tally = new Map();
    for (let k = a + 1; k < a + BK_HEADER_LINES && k < lines.length; k++) tally.set(lines[k].f, (tally.get(lines[k].f) || 0) + 1);
    const bodyFont = [...tally].sort((x, y) => y[1] - x[1]).map(e => e[0])[0];
    const body = [name];
    let pageNo = false, head = true, scored = false, skipped = 0, last = '', end = top, lastList = false, lastName = false, from = -1;
    const leads = new Set();
    let fresh = false, firstLead = '';
    const knownEntry = j => lines[j].lead !== bodyFont && leads.has(lines[j].lead) && SBB._sbEntry(lines[j].t);
    // Where the block reads on past lore, or 0: past a page number, its own text or its own name; lore then a lair entry is the lair's.
    const stop = m => m >= lines.length || _bkAnchor(texts, m) || statBlockHeadAt(texts, m) || SBB._sbSection(texts[m]) || sidebar.has(lines[m].f);
    const resumes = k => {
      let m = k, paged = _bkName(texts[k]).toLowerCase() === name.toLowerCase();
      while (m - k < BK_ASIDE_LONG && !stop(m) && lines[m].f !== bodyFont && !knownEntry(m)) if (/^\d{1,3}$/.test(texts[m++])) paged = true;
      let j = m;
      while (j - m < BK_RESUME && !stop(j) && lines[j].f === bodyFont && !knownEntry(j)) j++;
      if ((paged || j > m) && !stop(j) && knownEntry(j) && lines[j].lead === firstLead) return m;
      // A sentence cut by a page of lore goes on in lower case: "…урона. Если" / "цель — существо…".
      if (_bkEnds(last)) return 0;
      for (m = k; m - k < BK_ASIDE_LONG && !stop(m); m++) {
        if (lines[m].f !== bodyFont || !/^\p{Ll}/u.test(texts[m])) continue;
        for (j = m + 1; j - m < BK_RESUME && !stop(j) && !knownEntry(j); j++);
        return !stop(j) && knownEntry(j) && lines[j].lead === firstLead ? m : 0;
      }
      return 0;
    };
    const aside = k => {
      if (body.some(x => SBB._sbSection(x) === 'Actions')) return 0;
      for (let m = k + 1; m - k < BK_ASIDE_LONG && m < lines.length; m++) {
        if (_bkAnchor(texts, m) || statBlockHeadAt(texts, m)) return 0;
        if (SBB._sbSection(texts[m]) === 'Actions') return lines[m + 1] && SBB._sbEntry(texts[m + 1]) ? m : 0;
      }
      return 0;
    };
    const used = new Set();
    for (let k = top; k < lines.length && k < top + BK_MAX_LINES; k++) {
      const l = lines[k], t = l.t;
      if (k > a + 3 && (_bkAnchor(texts, k) || statBlockHeadAt(texts, k))) break;
      // The next monster's name over its lore: a short line in the font this block's name is set in.
      if (!head && nameFont && l.f === nameFont && t.length <= 60 && !_bkEnds(t) && !/\.\s/.test(t) &&!SBB._sbSection(t) && !SBB._sbLabel(t)) {
        const back = resumes(k);
        if (back > 0) { k = back - 1; continue; }
        break;
      }
      const heading = SBB._sbSection(t);
      // An artist's credit on a line of its own, in capitals.
      if (/^(?:(?:\p{Lu}{2,}|\p{Lu}\.)[ ,.-]*)+$/u.test(t) && !heading && k > a && !SBB.SB_ABIL_TOKEN.test(t)) continue;
      // A running head where a block crosses a page; "дао89", fused and lower case, anywhere.
      const head2 = !l.f || l.f !== bodyFont;
      if (/^\d{1,3} [^|]{1,40}\|/.test(t)) continue;
      if ((head2 && /^\p{Ll}[^\d]*\p{L}\d{1,3}$/u.test(t) || (!head || foreign(l)) && (foreign(l) || _bkEnds(last) || lone(k))) && !SBB._sbLabel(t) && !heading && !_bkEnds(t) && t.split(' ').length <= 4 &&/^\d{1,3}\s*\p{L}[^\d]*$|^\p{L}[^\d]*?\d{1,3}$/u.test(t)) continue;
      // A page number alone, or a running head in lower case after it: "250 ракшаса".
      if (!head && head2 && (/^\d{1,3}$/.test(t) || /^\d{1,3} \p{Ll}[^\d:]*[^\d:.,;!?)]$/u.test(t) && t.split(' ').length <= 4)) continue;
      // Printed twice or as "27 | 36", and a chapter head: "Chapter 12: Monsters 122122". Only here: lore fonts count them.
      if (!head && /^(\d{1,3})\1$|^\d{1,3} ?\| ?\d{1,3}$|^(?:\d{1,3} ?)?(?:Chapter|Глава) \d+ ?[:|] [^.]{3,50}?(?: ?\d{1,6})?$/u.test(t)) continue;
      // A chapter's tab letter, and a head on its own line above its page number: "Е", "Единорог", "152".
      if (pageNo && /^\d{1,3}$/.test(t)) { pageNo = false; continue; }
      if (head2 && (/^\p{Lu}$/u.test(t) || t.length <= 40 && !_bkEnds(t) && lines[k + 1] && lines[k + 1].f !== bodyFont && /^\d{1,3}$/.test(lines[k + 1].t))) { pageNo = !/^\p{Lu}$/u.test(t); continue; }
      // Flavour text after the last entry, two lines in fonts the block never used: "A frog has no effective attacks."
      const unused = m => lines[m] && !used.has(lines[m].f) && !used.has(lines[m].lead) && !SBB._sbSection(lines[m].t) &&
        /\p{L}{3}/u.test(lines[m].t) && !/^(?:Hit|Miss|Попадание|Промах):/.test(lines[m].t) &&
        !(e => e && !_bkProse(e.n) && e.n.replace(/\([^)]*\)/g, '').trim().split(/\s+/).length <= 7)(SBB._sbEntry(lines[m].t));
      if (!head && !heading && _bkEnds(last) && unused(k) && unused(k + 1)) {
        let m = k;
        while (m - k < BK_ASIDE_LINES && lines[m] && !used.has(lines[m].f)) m++;
        if (!(lines[m] && leads.has(lines[m].lead) && SBB._sbEntry(lines[m].t))) break;   // a quote between entries reads on
      }
      let joins = false, opened = false;
      if (head) {
        // Text from the column beside a block's header is skipped, not read as its end.
        if (foreign(l) && !heading && k > a && !_bkScores(t)) { if (++skipped > BK_HEADER_SKIP) break; continue; }
        // Only past the scores can an entry start: a wrapped "30 фт.; лазая…" has the same shape.
        if (SBB.SB_ABIL_TOKEN.test(t) || /(?:STR|СИЛ)\s*\d/i.test(t)) scored = true;
        // A marked name may wrap: "Зов безголового (перезаряжается после короткого" / "или продолжительного отдыха). Если…".
        const wraps = l.lead && l.lead !== bodyFont && /^\p{Ll}/u.test(texts[k + 1] || '') && SBB._sbEntry(t + ' ' + texts[k + 1]);
        if (heading || (scored && /^\p{Lu}/u.test(t) && (SBB._sbEntry(t) || wraps) && !SBB._sbLabel(t) && !SBB.SB_ABIL_TOKEN.test(t))) { head = false; opened = true; }
      }
      if (!head && !heading) {
        // "Hit: 2 (1d4) piercing damage." set in its own font goes on with the attack above it.
        const hit = /^(?:Hit|Miss|Попадание|Промах):/.test(t);
        const list = /^[\p{Lu}\d][\p{L}\d/ ,–-]{0,39}:\s/u.test(t) || /^[•\-–]/.test(t);
        // A quote set between two entries: the block goes on at a name in a font it already used.
        if (foreign(l) && !list) {
          let m = k;
          while (m < lines.length && m - k < BK_ASIDE_LINES && foreign(lines[m])) m++;
          const r = lines[m];
          if (r && !foreign(r) && r.lead && r.lead !== bodyFont && leads.has(r.lead) && SBB._sbEntry(r.t)) { k = m - 1; continue; }
          const back = resumes(k);
          if (back > 0) { k = back - 1; continue; }
        }
        // Lore after the block's last line; a lone line in another font just before it was a sidebar's lead-in.
        if (foreign(l) && !list) { if (from === k - 1 && lines[from].f !== bodyFont && fresh && body.length > 2 && !SBB._sbSection(body[body.length - 2])) body.pop(); break; }
        if (/^(Время накладывания|Накладывание более высокой|Casting Time|Using a Higher-Level)/.test(t)) break;
        if (/^(?:вариант|разновидность|variant)\s*:/i.test(t) || sidebar.has(l.f) && /^\p{Ll}/u.test(t)) break;
        const marked = l.lead ? l.lead !== bodyFont : null;
        const named = marked && _bkNameOnly(t) && (_bkEnds(last) || SBB._sbSection(last) || /[:)]$/.test(last));
        const e = SBB._sbEntry(t);
        const long = e && e.n.replace(/\([^)]*\)/g, '').trim().split(/\s+/).length > 7;
        const prose = e && _bkProse(e.n);
        const shape = (!long && !prose && e) || named;
        // A habitat line, or a short heading after a full stop or a spell list: the next monster.
        const lab = SBB._sbLabel(t);
        // A list's wrapped line keeps its font: "1/Day Each: …, Power" / "Word Kill, Scrying".
        const listDone = lastList && !/[,;:]$/.test(last) &&
          !(l.f && l.f === lines[k - 1].f && l.f !== bodyFont) && !/^[\p{Lu}\d][\p{L}\d/ ,–-]{0,39}:\s/u.test(texts[k + 1] || '') &&
          !(/\p{L}$/u.test(last) && /[,()]/.test(t));
        // A line after a heading printed twice over, "CreditsCredits", once the last sentence ended.
        if (l.cut && _bkEnds(last) && !shape && !list) break;
        if ((lab && lab.field === null) || (!shape && !list && (_bkEnds(last) || listDone) && t.length < 35 && !_bkEnds(t) && /^\p{Lu}/u.test(t))) {
          // A sidebar set between a block's traits and its actions: "Customizing NPCs", then "Actions".
          const m = aside(k);
          if (m) { k = m - 1; continue; }
          break;
        }
        // An entry starts at a name its font marks, or else one after a full stop or a spell list.
        const after = opened || _bkEnds(last) || listDone || SBB._sbSection(last) || /:$/.test(last) && /^\d+\.\s/.test(t);
        const known = marked === true && leads.has(l.lead) && /^\p{Lu}/u.test(t);
        // The first entry past the header starts even with its name unmarked: "Двуглавость. Пёс…".
        const starts = !hit && (list || (shape && (opened || (marked === true || marked === null) && (after || known))) || (marked === true && after && !long && !prose && /^\p{Lu}/u.test(t)));
        const open = (last.match(/\(/g) || []).length > (last.match(/\)/g) || []).length;
        joins = body.length > 1 && !SBB._sbSection(last) && (lastName || open || !starts);
        if (joins && l.f !== bodyFont && /^\p{Lu}[^.:]{0,39}$/u.test(t) && !e && !_bkEnds(last)) {
          const back = resumes(k);
          if (back > k) { k = back - 1; continue; }
        }
        if (!joins) { fresh = !leads.has(l.lead); if (shape) leads.add(l.lead); if (shape && marked && !firstLead) firstLead = l.lead; lastList = list; lastName = named; from = k; } else lastName = false;
      }
      if (joins) body[body.length - 1] += ' ' + t;
      else body.push(t);
      last = body[body.length - 1];
      end = k;
      used.add(l.f).add(l.lead);
    }
    const b = SBB.statBlockFromLines(body);
    // A number set as its own text run arrives fused: "пассивное Внимание24".
    if (b) b.senses = b.senses.replace(/(\p{L})(\d)/gu, '$1 $2');
    if (b && b.name) blocks.push(...SBB.statBlockTypes(b));
    done = end;
  }
  return blocks;
}

// Why a block cannot be trusted, or ''. The import skips it: a gap beats a wrong monster.
function statBlockUnclean(b) {
  if (!b.name || /^[\d(]/.test(b.name) || SBB.SB_SIZE.test(b.name)) return 'no name';
  if (!/\d/.test(b.ac) || !/\d/.test(b.hp)) return 'no AC or HP';
  if ((b.abilRead || 0) !== 6) return 'ability scores';
  if (!b.cr) return 'no challenge rating';
  // A challenge rating that runs into a sentence took the text beside it: "0 (XP 0; PB +2) figurine or both. Each…".
  if (/\.\s+\p{Lu}/u.test(b.cr)) return 'page text inside it';
  const entries = Object.values(b.secs || {}).flat();
  // A legendary or lair section opens with an unnamed paragraph of rules.
  const intro = e => ['Legendary actions', 'Mythic actions', 'Lair actions'].some(s => e === (b.secs[s] || [])[0]);
  for (const e of entries) {
    if ((!e.n && !intro(e)) || !e.t) return 'an entry without a name or text';
    if (e.n.replace(/\([^)]*\)/g, '').trim().split(/\s+/).length > 7) return 'an entry name that is a sentence';
  }
  const all = [b.meta, b.ac, b.hp, b.speed, b.saves, b.skills, b.senses, b.languages, b.cr, ...entries.map(e => e.n + ' ' + e.t)].join('\n');
  // Page leftovers: a credit, a fused callout number, a web footer, a doubled caption.
  if (/\p{Lu}{3,}(?:[ ,]+\p{Lu}{2,})+|[а-йл-яё]\d|\)\d|\p{L}-\d+ \p{Ll}|©|https?:|www\.|Художник|Click the link|(\S.{6,}\S)\1/u.test(all)) return 'page text inside it';
  return '';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { statBlocksInText, statBlockHeadAt, statBlockUnclean };
}
