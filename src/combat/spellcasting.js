'use strict';

// spellcasting.js — a spellcasting trait or action read into its lead sentence and its groups of spells, by level or
// how often, in either language and either edition. Null for anything it cannot read whole, which the page then
// shows as the paragraph it is. Pure. Unit-tested; see test/spellcasting.test.js.

const SC_NAME = /spell|заклин|колдов/i;

// Each label ends at its colon. ⚠ A word inside a spell list ("(5-й круг)", "Слово силы: смерть") must never match.
const SC_LABEL = new RegExp('(?<=^|[\\s.:;])(?:'
  + '(?<will>(?:Заговоры|Cantrips)(?:\\s*\\(\\s*(?:неограниченно|at will)\\s*\\))?|Неограниченно|At[\\s-]*w\\s*i\\s*l\\s*l)'
  + '|(?<lvl>\\d|l(?=st))(?:-?й|st|nd|rd|th)?[\\s-]+(?:уровень|круг|level)\\.?\\s*\\(\\s*(?<slots>\\d+)\\s+(?:яч[а-яё]*|slots?)\\s*\\)'
  + '|(?<day>\\d+|[lI](?=\\s*[\\/fjJlI]\\s*d))\\s*(?:[\\/fjJlI]\\s*(?:день|d\\s*a\\s*y)|в\\s+день)(?<each>\\s+(?:каждое|each))?'
  + ')(?<qual>\\s*\\([^()]*\\))?\\s*:', 'giu');

// A line that starts a new sentence is not the spell list wrapping onto it.
function _scContinues(prev, line) {
  return /,\s*$/.test(prev) || /^[a-zа-яё(]/u.test(line);
}

// Commas inside brackets belong to a spell's note or its English name.
function _scSplit(body) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of body) {
    if (ch === '(' || ch === '[') depth++;
    else if ((ch === ')' || ch === ']') && depth) depth--;
    if (ch === ',' && !depth) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim().replace(/^[.;]+|[.;]+$/g, '').trim()).filter(Boolean);
}

// A Russian book prints the English name in square brackets: the label keeps the Russian one.
function _scSpell(raw) {
  let s = raw.replace(/\s+/g, ' ');
  if (/[а-яё]/i.test(s.replace(/\[[^\]]*\]/g, ''))) s = s.replace(/\s*\[[^\]]*\]/g, '');
  const m = s.match(/^(.*?)\s*((?:\([^()]*\)\s*)+)$/);
  const name = (m ? m[1] : s).trim(), note = m ? m[2].trim() : '';
  // A sentence, or the next monster's heading run into the last spell, is no spell name: two capitals inside a
  // Russian name are a heading, as a Russian name capitalises only its first word and a person's name.
  const words = name.split(' ').filter(w => w.length > 2), cyr = /[а-яё]/i.test(name);
  if (!name || name.length > 60 || words.length > 5 || /^[(\[]|:$|[.!?]\s+\S|[^\p{L}\s'’\-/&*:]|[\dlI]\s*[/fjJlI]\s*day/iu.test(name)
    || /\):/.test(note) || (cyr && words.slice(1).filter(w => /^[А-ЯЁ]/.test(w)).length > 1)) return null;
  return { name, note };
}

function _scGroup(m, body) {
  const g = m.groups;
  const kind = g.will ? 'will' : g.lvl ? 'slots' : g.each ? 'dayEach' : 'day';
  const n = kind === 'will' ? 0 : +(g.slots || g.day.replace(/^[lI]$/, '1'));
  const spells = _scSplit(body).map(_scSpell);
  if (!spells.length || spells.some(s => !s) || (kind !== 'will' && !n)) return null;
  return { label: m[0].replace(/\s*:$/, '').trim(), qual: (g.qual || '').trim(), kind, n, spells };
}

// The last group's lines run until one starts a sentence of its own; that line and the rest are the tail, as is a
// footnote ("*… before combat") the book prints after the list.
function _scBodyAndTail(body, last) {
  const lines = body.split('\n');
  let i = 1;
  while (i < lines.length && _scContinues(lines[i - 1], lines[i].trim())) i++;
  let list = lines.slice(0, i).join(' '), tail = lines.slice(i).join('\n').trim();
  if (tail && !last) return null;
  const foot = list.search(/\s\*(?=[A-ZА-ЯЁ])/u);
  if (foot >= 0) { if (!last) return null; tail = (list.slice(foot).trim() + (tail ? '\n' + tail : '')); list = list.slice(0, foot); }
  return { list, tail };
}

function spellcastingRead(name, text) {
  const t = String(text || '');
  if (!SC_NAME.test(String(name || ''))) return null;
  const ms = [...t.matchAll(SC_LABEL)];
  if (!ms.length) return null;
  const groups = [];
  let tail = '';
  for (let i = 0; i < ms.length; i++) {
    const start = ms[i].index + ms[i][0].length, end = i + 1 < ms.length ? ms[i + 1].index : t.length;
    const part = _scBodyAndTail(t.slice(start, end).trim(), i === ms.length - 1);
    if (!part) return null;
    const g = _scGroup(ms[i], part.list);
    if (!g) return null;
    groups.push(g);
    tail = part.tail;
  }
  const out = { lead: t.slice(0, ms[0].index).trimEnd(), groups };
  if (tail) out.tail = tail;
  return out;
}

// The crystals' keys for an entry's groups, free of positions so an edit that moves a group keeps them: innate or
// cast, then the slot level, the count a day or at will, and for "each" the spell's name. A second group of the same
// label takes its index. A count past a group's cells is clamped.
function spellKeys(entryName, groups) {
  const base = /innate|врожд/i.test(String(entryName || '')) ? 'innate' : 'cast', seen = new Set();
  return groups.map((g, gi) => {
    let key = base + '|' + (g.kind === 'slots' ? 'slots:' + (g.label.replace(/^l/, '1').match(/\d+/) || [''])[0] : g.kind === 'will' ? 'will' : 'day:' + g.n);
    if (seen.has(g.kind + key)) key += ':' + gi;
    seen.add(g.kind + key);
    return { key, spells: g.kind === 'dayEach' ? g.spells.map(sp => key + ':' + sp.name.toLowerCase()) : null };
  });
}

function spellSpent(spent, key, n) {
  const v = spent && Number(spent[key]);
  return Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), n) : 0;
}

// A full crystal spends one; an empty one gives one back. A key back at 0 goes, so a store never grows from clicks.
function spellToggle(spent, key, n, wasFull) {
  const out = Object.assign({}, spent);
  const v = Math.max(0, Math.min(n, spellSpent(spent, key, n) + (wasFull ? 1 : -1)));
  if (v) out[key] = v; else delete out[key];
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { spellcastingRead, spellKeys, spellSpent, spellToggle };
}
