'use strict';

// multiattack.js — pure: what a Multiattack line says about the attacks beside it. No DOM.
// A count, plus at most one pick, swap or pair of alternatives. Anything more, and anything the
// reading could get wrong, gives the fallback pill.

const COMBAT_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  одну: 1, один: 1, одной: 1, одним: 1, две: 2, два: 2, двумя: 2, три: 3, тремя: 3, четыре: 4, пять: 5, шесть: 6 };
// A word boundary never matches after a Cyrillic letter, so the name ends on a letter class.
const COMBAT_MULTI = /^(multiattack|мультиатака)(?![a-zа-яё])/i;

// A whole-word match wins over a stem, so "longsword" never also matches Longbow. The stem is for
// Russian cases ("когтями" against "Коготь").
const COMBAT_FILLER = new Set(['with', 'its', 'his', 'her', 'their', 'the', 'using', 'melee', 'ranged',
  'своим', 'своими', 'его', 'её', 'ее', 'ближнем', 'дальнобойные']);
const _cbWords = p => p.n.toLowerCase().replace(/ё/g, 'е').split(/[\s(]+/);
// 2 for a whole word, 1 for a shared stem, 0 for neither.
function _cbWordMatch(t, w) {
  if (!w) return 0;
  if (t.startsWith(w) || w.startsWith(t)) return 2;
  let k = 0;
  while (k < t.length && k < w.length && t[k] === w[k]) k++;
  return k >= 3 && (w.length > 4 || k >= w.length - 1) ? 1 : 0;
}
// A second token settles two names that share a first word: "Грозовым клинком" against "Грозовым разрядом".
function _cbNameMatch(token, pills, next) {
  const t = token.toLowerCase().replace(/ё/g, 'е');
  if (t.length < 3 || COMBAT_FILLER.has(t)) return null;
  const pick = hits => hits.length === 1 ? hits[0] : hits.length ? 'many' : null;
  const n = next && next.replace(/ё/g, 'е');
  const all = pills.filter(p => _cbWordMatch(t, _cbWords(p)[0]));
  if (all.length > 1 && n) {
    const narrow = all.filter(p => _cbWordMatch(n, _cbWords(p)[1]));
    if (narrow.length === 1) return narrow[0];
  }
  const whole = all.filter(p => _cbWordMatch(t, _cbWords(p)[0]) === 2), hits = whole.length ? whole : all;
  // "Tentacles" names Tentacle over Tentacle Slam, unless the next word is Slam.
  const one = hits.filter(p => _cbWords(p).length === 1);
  if (hits.length > 1 && one.length === 1 && !(n && hits.some(p => _cbWordMatch(n, _cbWords(p)[1])))) return one[0];
  if (all.length || t.length < 5) return pick(hits);
  // A book can print another first word than the action's own: "Пылающей булавой" for Огненная булава.
  const later = pills.filter(p => _cbWords(p).slice(1).some(w => _cbWordMatch(t, w)));
  return later.length === 1 ? later[0] : null;
}

// A swap's target by an action's full name, every word close, so a spell never lands on an attack
// that shares its first letters. The name comes back without its bracket.
function _cbActionName(text, actions) {
  const toks = text.toLowerCase().replace(/ё/g, 'е').split(/\s+/);
  const close = (t, w) => {
    if (!t) return false;
    let k = 0;
    while (k < t.length && k < w.length && t[k] === w[k]) k++;
    return k === w.length || k === t.length || k >= Math.max(3, w.length - 3);
  };
  const hits = actions.map(a => a.n.split('(')[0].trim())
    .filter(n => n && n.toLowerCase().replace(/ё/g, 'е').split(/\s+/).every((w, i) => close(toks[i], w)));
  return hits.length === 1 ? hits[0] : '';
}

const COMBAT_JOIN = new Set(['or', 'and', 'или', 'либо', 'и']);
const _cbSkip = tk => /^(attacks?|атак[а-яё]*)$/.test(tk) || COMBAT_FILLER.has(tk);
// "Two attacks with A and B" is a pick, so one count never lands on A alone.
function _cbJoinedName(toks, j, pills) {
  let k = j + 1;
  while (k < toks.length && !COMBAT_JOIN.has(toks[k])) {
    if (/^[.:;]$/.test(toks[k]) || COMBAT_NUMBERS[toks[k]]) return false;
    k++;
  }
  while (++k < toks.length && _cbSkip(toks[k]));
  return k < toks.length && !COMBAT_NUMBERS[toks[k]] && !!_cbNameMatch(toks[k], pills);
}

const COMBAT_MELEE = /melee|рукопаш|ближн/i, COMBAT_RANGED = /ranged|дальнобой/i;
function _cbMultiCounts(text, pills) {
  if (/\b(?:or|either|instead|replaces?|in place of)\b|(?:^|\s)(?:или|либо|вместо|замен[а-яё]*)(?=\s|$)/i.test(text)) return null;
  const toks = text.toLowerCase().match(/[a-zа-яё]+(?:-[a-zа-яё]+)*|[.:;]/g) || [];
  const counts = new Map();
  let total = 0;
  for (let i = 0; i < toks.length; i++) {
    const n = COMBAT_NUMBERS[toks[i]];
    if (!n) continue;
    let found = null, attackWord = false;
    for (let j = i + 1; j <= i + 4 && j < toks.length; j++) {
      const tk = toks[j];
      if (/^[.:;]$/.test(tk) || COMBAT_NUMBERS[tk]) break;
      if (/^(attacks?|атак[а-яё]*)$/.test(tk)) { attackWord = true; continue; }
      const p = _cbNameMatch(tk, pills, toks[j + 1]);
      if (p === 'many') return null;
      if (p && _cbJoinedName(toks, j, pills)) return null;
      if (p) { found = p; break; }
    }
    if (found) counts.set(found, (counts.get(found) || 0) + n);
    else if (attackWord && !total) total = n;
    else return null;
  }
  if (!counts.size) {
    let attacks = pills.filter(p => !p.hit.startsWith('DC'));
    const kind = COMBAT_MELEE.test(text) ? COMBAT_MELEE : COMBAT_RANGED.test(text) ? COMBAT_RANGED : null;
    if (attacks.length > 1 && kind) attacks = attacks.filter(p => kind.test(p.t));
    if (!total || attacks.length !== 1) return null;
    counts.set(attacks[0], total);
  } else if (total && [...counts.values()].reduce((a, b) => a + b, 0) !== total) return null;
  return counts;
}

// "Three attacks with A or B in any combination": one count over a pick of named attacks, in one
// sentence. Words after a matched name belong to that name until a comma or a joining word.
function _cbMultiChoice(text, pills) {
  const s = text.replace(/\s*(?:in any combination|в любой комбинации)/i, '').trim().replace(/\.$/, '');
  if (/[.;:]/.test(s)) return null;
  const toks = s.toLowerCase().match(/[a-zа-яё]+(?:-[a-zа-яё]+)*|,/g) || [];
  const at = toks.findIndex(t => COMBAT_NUMBERS[t]);
  if (at < 0 || toks.slice(0, at).some(t => COMBAT_JOIN.has(t) && t !== 'и')) return null;
  const opts = [];
  let open = false;
  for (let i = at + 1; i < toks.length; i++) {
    const tk = toks[i];
    if (COMBAT_NUMBERS[tk]) return null;
    if (tk === ',' || COMBAT_JOIN.has(tk)) { open = false; continue; }
    if (open || /^(attacks?|атак[а-яё]*)$/.test(tk) || COMBAT_FILLER.has(tk)) continue;
    const p = _cbNameMatch(tk, pills, toks[i + 1]);
    if (!p || p === 'many' || opts.includes(p)) return null;
    opts.push(p);
    open = true;
  }
  return opts.length > 1 ? { x: COMBAT_NUMBERS[toks[at]], opts } : null;
}

// A swap in the last sentence, or "only one of which can be X" in the same one. The base is the
// text before it, and "only one" also keeps the base's count off X.
const COMBAT_SWAP_N = { one: '1', two: '2', any: 'any', одну: '1', одна: '1', две: '2', любую: 'any' };
const COMBAT_SWAPS = [
  /\.\s+(?:it|he|she|он|она|оно)?\s*(?:может заменить|can replace)\s+(?:(one|two|any|одну|две|любую)\s+)?(?:(?:of (?:the|those|these|its) attacks|из этих атак|атак[а-яё]*|attacks?)\s+)?(?:[a-zа-яё]+\s+)??(?:на|with)\s+(.+)$/i,
  /\.\s+(one|одна) (?:of them|of those attacks|of these attacks|из них) (?:can be replaced|может быть заменена) (?:with|by|на)\s+(.+)$/i,
  /\.\s+(?:it|he|she)\s+can use (?:its |the )?(.+?) in place of (one|any)(?: of (?:those|these|its))?(?: (?:melee|ranged))? attacks?$/i,
  /,?\s+(?:only one of which can be|только одна из которых может(?:\s+быть)?(?:\s+сделана)?)\s+(.+)$/i,
];
function _cbMultiSwap(text, actions) {
  const s = text.trim().replace(/\.$/, '');
  let m = null;
  const i = COMBAT_SWAPS.findIndex(re => (m = s.match(re)));
  if (i < 0) return null;
  const [k, raw] = i === 2 ? [m[2], m[1]] : i === 3 ? ['one', m[1]] : [m[1] || 'one', m[2]];
  const names = raw.split(/\s+(?:или|or)\s+/).map(alt => {
    const clean = alt.replace(/\([АБAB]\)\s*/g, '').replace(/,?\s*(?:если оно доступно|if available)$/i, '')
      .replace(/^(?:использование|сотворение|атаку|an? (?:use|casting) of|one use of|casting|an?)\s+/i, '')
      .replace(/^заклинани[ея]\s+/i, '').replace(/\s+(?:attack|атакой)$/i, '').trim();
    return _cbActionName(clean, actions) || clean;
  });
  return { base: s.slice(0, m.index), only: i === 3, names, swap: { k: COMBAT_SWAP_N[k.toLowerCase()], to: names.join(' or ') } };
}

function _cbMultiAlts(text, pills) {
  const sides = text.replace(/(^|\s)(?:either|либо)\s+/i, '$1').split(/\.\s+(?:or|или)\s+|,?\s+(?:or|или|либо)\s+/i);
  if (sides.length < 2) return null;
  const alts = sides.map(side => _cbMultiCounts(side, pills));
  return alts.every(Boolean) ? alts : null;
}

const COMBAT_TIMES = { twice: 2, 'three times': 3, 'four times': 4, дважды: 2, трижды: 3 };
const COMBAT_TIMES_WORD = ['', '', 'two', 'three', 'four'];
const COMBAT_TIMES_RE = 'twice|three times|four times|дважды|трижды';
function _cbMultiRays(text, pills) {
  const m = text.trim().match(new RegExp(`^\\S+(?:\\s\\S+)?\\s+(?:uses|использует)\\s+(?:its\\s+)?(.+?)\\s+(${COMBAT_TIMES_RE})\\.?$`, 'i'));
  const lists = [...new Set(pills.map(p => p.of).filter(Boolean))];
  const name = m && _cbActionName(m[1], lists.map(n => ({ n })));
  const opts = name ? pills.filter(p => p.of === name) : [];
  return opts.length > 1 ? { x: COMBAT_TIMES[m[2].toLowerCase()], opts, or: true } : null;
}

// What a frame may not carry: a condition, a spell, a count the DM tracks, a form to be in.
const COMBAT_TOO_MUCH = /\b(?:if|when|while|unless|spells?|casts?|as many|in \w+ form|each one)\b|\d+[dк]\d+|(?:^|\s)(?:если|когда|пока|заклинани[а-яё]*|сотвор[а-яё]*|столько|в облике)(?=[\s.,]|$)/i;
const COMBAT_BONUS = /bonus action|бонусн[а-яё]* действи/i;

// { opts, counts }, { x, opts, or } or { alts }, with its swap and bonus pills; null is the fallback pill.
function _cbMultiRead(text, pills, actions) {
  const rays = _cbMultiRays(text, pills);
  if (rays) return { ...rays, bonus: [] };
  const sents = text.trim().split(/(?<=\.)\s+/);
  const bonusText = sents.filter(t => COMBAT_BONUS.test(t)).join(' ');
  let base = sents.filter(t => !COMBAT_BONUS.test(t)).join(' ')
    .replace(new RegExp(`(?:uses|использует)\\s+(?:its\\s+)?(.+?)\\s+(${COMBAT_TIMES_RE})`, 'gi'), (_, n, t) => `${COMBAT_TIMES_WORD[COMBAT_TIMES[t.toLowerCase()]]} ${n}`)
    .replace(new RegExp(`(${COMBAT_TIMES_RE})\\s+(?:uses|использует)\\s+`, 'gi'), (_, t) => `${COMBAT_TIMES_WORD[COMBAT_TIMES[t.toLowerCase()]]} `);
  const sw = _cbMultiSwap(base, actions);
  const target = sw && pills.find(p => sw.names.includes(p.n.split('(')[0].trim()));
  if (sw) base = sw.base;
  if (!base || COMBAT_TOO_MUCH.test(base)) return null;
  const pool = sw && sw.only ? pills.filter(p => p !== target) : pills;
  let r = null;
  const counts = _cbMultiCounts(base, pool);
  if (counts) r = { opts: pills.filter(p => counts.has(p)), counts };
  else {
    const pick = _cbMultiChoice(base, pool);
    if (pick) r = { x: pick.x, opts: pick.opts, or: true };
    else if (!sw) { const alts = _cbMultiAlts(base, pills); if (alts) r = { alts }; }
  }
  if (!r) return null;
  // A pill the text names outside the reading is an extra action on top of the attacks.
  const inside = r.alts ? r.alts.flatMap(a => [...a.keys()]) : r.opts;
  const rest = pills.filter(p => !inside.includes(p) && p !== target);
  const toks = base.toLowerCase().match(/[a-zа-яё]+(?:-[a-zа-яё]+)*/g) || [];
  // Five shared letters at least, so the monster's own name never reads as an action.
  const extra = t => rest.some(p => _cbWords(p).some(w => w.length > 2 && (t.startsWith(w) || w.startsWith(t) || t.slice(0, 5) === w.slice(0, 5))));
  if (rest.length && toks.some(t => t.length > 2 && !COMBAT_FILLER.has(t) && extra(t) && !_cbNameMatch(t, inside))) return null;
  if (sw) r.swap = sw.swap;
  const btoks = bonusText.toLowerCase().match(/[a-zа-яё]+/g) || [];
  r.bonus = pills.filter(p => !inside.includes(p) && btoks.some(t => _cbNameMatch(t, [p]) === p));
  return r;
}


if (typeof module !== 'undefined' && module.exports) {
  module.exports = { COMBAT_MULTI, _cbMultiRead };
}
