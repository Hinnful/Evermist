'use strict';

// statBlockParse.js — pure kernel: stat block text, English or Russian, into the popup's block.
// Unit-tested; see test/statBlockParse.test.js.
// The line protocol: the first line is the name. A line starting "## " is a heading the source
// marked; an unmarked line matching a section name is read as a heading too.

const SB_LABELS = [
  ['ac', ['armor class', 'класс доспеха', 'класс защиты', 'класс брони', 'кд', 'кб', 'ac']],
  ['hp', ['hit points', 'хиты', 'пз', 'hp']],
  ['speed', ['speed', 'скорость']],
  ['saves', ['saving throws', 'спасброски']],
  ['skills', ['skills', 'навыки']],
  ['vuln', ['damage vulnerabilities', 'vulnerabilities', 'уязвимость к урону', 'уязвимости к урону', 'уязвимости', 'уязвимость']],
  ['resist', ['damage resistances', 'resistances', 'сопротивление урону', 'сопротивление к урону', 'сопротивления урону', 'сопротивления', 'сопротивление', 'устойчивости', 'устойчивость']],
  ['immune', ['damage immunities', 'condition immunities', 'immunities', 'иммунитет к урону',
    'иммунитет к состоянию', 'иммунитет к состояниям', 'иммунитеты', 'иммунитет', 'невосприимчивости', 'невосприимчивость']],
  ['senses', ['senses', 'чувства', 'восприятие']],
  ['languages', ['languages', 'языки']],
  ['cr', ['challenge', 'уровень опасности', 'опасность', 'по', 'ко', 'cr']],
  // Read so they are not mistaken for traits, and dropped: the popup has no place for them.
  [null, ['proficiency bonus', 'бонус мастерства', 'initiative', 'инициатива', 'habitat', 'среда обитания',
    'местность обитания', 'места обитания', 'treasure', 'сокровища', 'gear', 'снаряжение', 'инвентарь', 'источник']],
];
const SB_LABEL_LIST = SB_LABELS.flatMap(([f, ls]) => ls.map(l => [f, l])).sort((a, b) => b[1].length - a[1].length);

const SB_SECTIONS = [
  ['Traits', ['traits', 'особенности', 'умения']],
  ['Actions', ['actions', 'действия']],
  ['Bonus actions', ['bonus actions', 'бонусные действия']],
  ['Reactions', ['reactions', 'реакции', 'ответные действия']],
  ['Legendary actions', ['legendary actions', 'легендарные действия']],
  ['Lair actions', ['lair actions', 'действия логова', 'действия в логове']],
];

const SB_ABIL = [['STR', 'СИЛ', 'Str', 'Сил'], ['DEX', 'ЛОВ|ЛВК', 'Dex', 'Лов'], ['CON', 'ТЕЛ|ВЫН', 'Con', 'Тел'],
  ['INT', 'ИНТ', 'Int', 'Инт'], ['WIS', 'МДР', 'Wis', 'Мдр'], ['CHA', 'ХАР', 'Cha', 'Хар']];
// The page's description is kept as lore; its comments end the block.
const SB_LORE = /^(description|lore|описание)$/i;
const SB_END = /^(comments?|комментарии)$/i;
const SB_LAIR = /^(логово|lair)(\s|$)|['’]s lair$/i;
const SB_SIGN = '[+\\-−–]';
const SB_SIZE = /^(tiny|small|medium|large|huge|gargantuan|крошечн|маленьк|небольш|средн|больш|крупн|огромн|громадн|исполинск)/i;

function _sbBlank() {
  return { name: '', meta: '', ac: '', hp: '', speed: '', abil: ['10', '10', '10', '10', '10', '10'],
    saves: '', skills: '', vuln: '', resist: '', immune: '', senses: '', languages: '', cr: '', secs: {}, lore: '' };
}

function _sbLabel(line) {
  const low = line.toLowerCase();
  for (const [field, label] of SB_LABEL_LIST) {
    if (!low.startsWith(label)) continue;
    const rest = line.slice(label.length);
    if (rest && !/^[\s:.]/.test(rest)) continue;
    const value = rest.replace(/^[\s:.]+/, '').trim();
    // The 2024 Russian senses line is "Восприятие", and so is a skill wrapped onto the next line.
    if (label === 'восприятие' && /^[+\-−]\d/.test(value)) return null;
    // "Устойчивость к магии. У беса…" is a trait that shares its first word with a label.
    if ((field === 'resist' || field === 'immune' || field === 'vuln') && /^[^.:;,]{1,40}\.\s+\p{Lu}/u.test(line)) return null;
    return { field, value };
  }
  return null;
}

function _sbSection(line) {
  const low = line.replace(/^##\s*/, '').replace(/[:.]\s*$/, '').trim().toLowerCase();
  const hit = SB_SECTIONS.find(([, names]) => names.includes(low));
  return hit ? hit[0] : null;
}

// Abilities arrive as one line ("STR 12 (+1) DEX 15 (+2) ..."), as a table with a save column
// ("СИЛ 11 +0 +0"), or a label and its number per line; the runs are joined before this reads them.
function _sbAbilities(text) {
  const found = [];
  const saves = [];
  SB_ABIL.forEach(([en, ru, enShow, ruShow], i) => {
    const re = new RegExp(`(?:^|[^\\p{L}])(${en}|${ru})[\\s:]*(\\d+)\\s*(?:\\(\\s*(${SB_SIGN}?\\d+)\\s*\\))?(?:\\s*(${SB_SIGN}\\d+)\\s+(${SB_SIGN}\\d+))?`, 'iu');
    const m = text.match(re);
    if (!m) return;
    found[i] = m[2];
    if (m[4] && m[5] && m[4].replace(/[−–]/, '-') !== m[5].replace(/[−–]/, '-')) {
      saves.push(`${/^[a-z]/i.test(m[1]) ? enShow : ruShow} ${m[5].replace(/[−–]/, '-')}`);
    }
  });
  if (found.filter(Boolean).length < 3) {
    // A table: the six labels in a row, then the six scores.
    const labels = SB_ABIL.map(([en, ru]) => `(?:${en}|${ru})`).join('\\s+');
    const scores = Array(6).fill(`(\\d+)(?:\\s*\\(\\s*${SB_SIGN}?\\d+\\s*\\))?`).join('\\s+');
    const t = text.match(new RegExp(`${labels}\\s+${scores}`, 'iu'));
    if (t) t.slice(1, 7).forEach((v, i) => { found[i] = v; });
  }
  return found.filter(Boolean).length >= 3 ? { found, saves } : null;
}

const SB_ABIL_TOKEN = new RegExp(`^(?:${SB_ABIL.flatMap(a => a.slice(0, 2)).join('|')}|\\d+|\\(\\s*${SB_SIGN}?\\d+\\s*\\)|${SB_SIGN}\\d+|mod|save|мод|спас|спасбросок|бросок|исп|[\\s,])+$`, 'iu');

// "Bite. Melee Weapon Attack: ..." names its entry up to the first full stop. A long first
// sentence, or one with a colon in it, is text: a legendary intro or a spell list.
function _sbEntry(line, alone) {
  const m = line.match(/^(.{1,110}?)\.\s+(.*)$/s);
  if (m && !/:/.test(m[1]) && m[1].replace(/\([^)]*\)/g, '').trim().split(/\s+/).length <= 9 && /^[\p{Lu}\d+]/u.test(m[1])) {
    return { n: m[1].trim(), t: m[2].trim() };
  }
  // A name alone on its line, of at most `alone` words: a short sentence has the same shape, and
  // so does "Speed 30 ft." in the header, which is why only a section asks for this.
  const a = alone && line.match(/^([^.:]{1,70})\.$/);
  if (a && a[1].split(/\s+/).length <= alone && /^[\p{Lu}\d]/u.test(a[1])) return { n: a[1].trim(), t: '' };
  return null;
}

function statBlockFromLines(input) {
  const lines = [];
  for (const raw of input) {
    let l = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
    if (!l) continue;
    // A site that sets each ability's name, or a label, as a heading has marked nothing.
    if (l.startsWith('## ') && (SB_ABIL_TOKEN.test(l.slice(3)) || (_sbLabel(l.slice(3)) || {}).field)) l = l.slice(3);
    const prev = lines[lines.length - 1];
    if (SB_ABIL_TOKEN.test(l) && prev !== undefined && lines.length > 1 && SB_ABIL_TOKEN.test(prev)) lines[lines.length - 1] = prev + ' ' + l;
    else lines.push(l);
  }
  if (!lines.length) return null;

  const b = _sbBlank();
  b.name = lines[0].replace(/^#+\s*/, '').replace(/\s*\[[^\]]*\]\s*$/, '').trim();
  let sec = null, skipping = false, entry = null, seenAbil = false, derivedSaves = [], lore = null, lair = false;
  let lastField = null, lastVal = '', abilRead = 0;
  const add = (field, value) => { b[field] = b[field] ? `${b[field]}; ${value}` : value; };

  for (let i = 1; i < lines.length; i++) {
    let line = lines[i];
    const bare = line.replace(/^##\s*/, '');
    if (SB_END.test(bare)) break;
    if (SB_LORE.test(bare)) { lore = []; continue; }
    // Habitat and treasure ride along in some descriptions; they are labels, not lore.
    if (lore && !lair && line.startsWith('## ') && SB_LAIR.test(bare)) {
      lair = true; sec = 'Lair actions'; entry = null;
      b.secs[sec] = b.secs[sec] || [];
      continue;
    }
    // The lair's first heading that names no effect hands the rest back to the lore.
    if (lair && line.startsWith('## ') && !_sbEntry(bare, 9)) lair = false;
    if (lore && !lair) { if (!_sbLabel(bare)) lore.push(bare); continue; }
    const heading = _sbSection(line);
    if (heading) {
      sec = heading; skipping = false; entry = null;
      if (!b.secs[sec]) b.secs[sec] = [];
      continue;
    }
    // Some sites mark each action's name as a heading of its own.
    const named = (sec || b.ac || b.hp || seenAbil) && line.startsWith('## ') && _sbEntry(line.slice(3).trim(), 9);
    if (named && !named.t) {
      if (!sec) sec = 'Traits';
      b.secs[sec] = b.secs[sec] || [];
      entry = named; b.secs[sec].push(named); skipping = false; continue;
    }
    if (line.startsWith('## ')) { skipping = true; entry = null; continue; }
    if (skipping) continue;

    if (!sec) {
      // A source badge can ride on the size line: "... нейтрально-злой Источник: MM".
      if (!b.meta && !b.ac && SB_SIZE.test(line)) { b.meta = line.replace(/\s+(источник|source):.*$/i, ''); lastField = 'meta'; lastVal = b.meta; continue; }
      const abil = !seenAbil && _sbAbilities(line);
      if (abil) {
        abil.found.forEach((v, k) => { if (v) b.abil[k] = v; });
        abilRead = abil.found.filter(Boolean).length;
        derivedSaves = abil.saves;
        seenAbil = true;
        lastField = null;
        continue;
      }
      // "Armor Class 17 Initiative +3 (13)": a newer layout sets two labels on one line.
      line = line.replace(/\s+(initiative|инициатива|proficiency bonus|бонус мастерства)[\s:]+\S.*$/i, '');
      // A label word alone in lower case is the wrapped end of the line above: "понимает известные вам" / "языки".
      const lab = !(lastField && !lastVal.endsWith('.') && /^\p{Ll}+$/u.test(line)) && _sbLabel(line);
      if (lab) {
        if (lab.field && lab.value) add(lab.field, lab.value);
        // A label the popup drops still owns the lines it wraps onto.
        lastField = lab.field || '-';
        lastVal = lab.value;
        continue;
      }
      // A book wraps a long header line: the rest starts in lower case, follows a comma or a sign,
      // finishes the size line, or is the value of a label left alone on its line.
      const open = (lastVal.match(/\(/g) || []).length > (lastVal.match(/\)/g) || []).length;
      const tail = /\p{Ll}$/u.test(lastVal) && (line.split(' ').length <= 3 || /^\d/.test(line)) && !(/^\p{L}/u.test(line) && _sbEntry(line));
      if (lastField && (lastField === 'meta' || !lastVal || open || tail || /^[\p{Ll}[(]/u.test(line) || /[,;+×—–-]$/.test(lastVal))) {
        lastVal = lastVal ? `${lastVal} ${line}` : line;
        if (lastField !== '-') b[lastField] = b[lastField] ? `${b[lastField]} ${line}` : line;
        if (lastField === 'meta') lastField = null;
        continue;
      }
      if (!b.ac && !b.hp && !seenAbil) continue;
      sec = 'Traits';
      b.secs[sec] = b.secs[sec] || [];
    }

    // Lair actions are an intro and a bullet list, and a short bullet would read as a name.
    // A name alone on its line takes the next line as its text, whatever that line looks like.
    if (entry && entry.n && !entry.t) { entry.t = line; continue; }
    const e = sec !== 'Lair actions' && _sbEntry(line, 4);
    if (e) { entry = e; b.secs[sec].push(e); }
    else if (entry) entry.t = entry.t ? `${entry.t}\n${line}` : line;
    else { entry = { n: '', t: line }; b.secs[sec].push(entry); }
  }

  if (!b.saves && derivedSaves.length) b.saves = derivedSaves.join(', ');
  if (lore) b.lore = lore.join('\n\n');
  for (const s of Object.keys(b.secs)) if (!b.secs[s].length) delete b.secs[s];
  if (!b.ac && !b.hp && !seenAbil) return null;
  // Not enumerable, so it never reaches a saved entry.
  Object.defineProperty(b, 'abilRead', { value: abilRead });
  return b;
}

// A whole page: the block opens at the size line and name above its first AC or HP line.
function statBlockFind(page) {
  const lines = page.map(l => String(l).replace(/\s+/g, ' ').trim()).filter(Boolean);
  const at = lines.findIndex(l => { const lab = _sbLabel(l); return lab && (lab.field === 'ac' || lab.field === 'hp') && /\d/.test(lab.value); });
  if (at < 0) return [];
  let top = at;
  for (let i = at - 1; i >= Math.max(0, at - 4); i--) if (SB_SIZE.test(lines[i].replace(/^##\s*/, ''))) { top = i; break; }
  // A marked heading names it; failing that, the nearest short line above.
  const near = lines.slice(Math.max(0, top - 10), top).reverse();
  const head = near.find(l => l.startsWith('## ') && l.length <= 80);
  const short = near.filter(l => l.length <= 60 && !_sbLabel(l));
  // A translated page puts the original name under its own: "Гоблин", then "Goblin".
  const own = /^\p{Script=Latin}[^\p{Script=Cyrillic}]*$/u.test(short[0] || '') && /\p{Script=Cyrillic}/u.test(short[1] || '') ? short[1] : short[0];
  const name = (head || own || '').replace(/^##\s*/, '');
  // The page's own box ends the block: the smallest element around the size and AC lines that
  // also holds a trait or an action. A newer layout boxes the header lines on their own.
  let end = lines.length;
  const paths = page.paths;
  if (paths) {
    const a = paths[top], b = paths[at];
    let n = 0;
    while (n < a.length && a[n] === b[n]) n++;
    for (let d = n; d > 0; d--) {
      const stop = paths.findIndex((p, i) => i > at && p[d - 1] !== b[d - 1]);
      const last = stop < 0 ? lines.length : stop;
      if (lines.slice(at + 1, last).some(l => _sbSection(l) || _sbEntry(l))) { end = last; break; }
    }
  }
  // Source badges ride along in some headings: "Goblin [Goblin] PH14 MM14".
  return [name.replace(/(\s*[A-Z]{2,6}\d{2})+$/, '')].concat(lines.slice(top, end));
}

const SB_BLOCK_TAGS = /^(p|li|ul|ol|tr|br|table|div|section|article|main|dl|dt|dd|h[1-6])$/;
const SB_VOID_TAGS = /^(br|img|hr|input|meta|link|source|wbr|col|area|base)$/;

// Page markup into the line protocol: a block tag ends a line, a heading becomes "## ", and a
// table cell is a space so a row stays one line. `.paths` holds each line's chain of open
// elements, which statBlockFind reads to see where the stat block's box closes.
function statBlockHtmlLines(html) {
  const src = String(html || '').replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|svg|sup|noscript|nav|footer|header|aside|form|button)\b[\s\S]*?<\/\1>/gi, '');
  const lines = [], paths = [], stack = [];
  let text = '', path = null, heading = false, id = 0;
  const flush = () => {
    const t = statBlockDecode(text).replace(/\s+/g, ' ').trim();
    if (t) { lines.push(heading ? `## ${t}` : t); paths.push(path); }
    text = ''; path = null;
  };
  for (const m of src.matchAll(/<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>|[^<]+|</g)) {
    if (!m[2]) {
      if (!path) path = stack.map(e => e.id);
      text += m[0];
      continue;
    }
    const tag = m[2].toLowerCase();
    if (SB_BLOCK_TAGS.test(tag)) flush();
    if (/^h[1-6]$/.test(tag)) heading = !m[1];
    if (/^t[dh]$/.test(tag)) text += ' ';
    if (m[1]) {
      const at = stack.map(e => e.tag).lastIndexOf(tag);
      if (at >= 0) stack.length = at;
    } else if (!m[3] && !SB_VOID_TAGS.test(tag)) {
      // An unclosed <p> or <li> ends where the next one starts.
      if ((tag === 'p' || tag === 'li') && stack.length && stack[stack.length - 1].tag === tag) stack.pop();
      stack.push({ tag, id: ++id });
    }
  }
  flush();
  lines.paths = paths;
  return lines;
}

const SB_ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", mdash: '—', ndash: '–',
  laquo: '«', raquo: '»', hellip: '…', minus: '−', times: '×', thinsp: ' ', ensp: ' ', emsp: ' ', shy: '', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };
function statBlockDecode(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return SB_ENTITIES[e.toLowerCase()] !== undefined ? SB_ENTITIES[e.toLowerCase()] : m;
  });
}

function statBlockFromPage(html) {
  return statBlockFromLines(statBlockFind(statBlockHtmlLines(html)));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { statBlockFromLines, statBlockFind, statBlockHtmlLines, statBlockFromPage,
    _sbLabel, _sbSection, _sbEntry, SB_SIZE, SB_ABIL_TOKEN };
}
