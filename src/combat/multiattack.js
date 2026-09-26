'use strict';

// multiattack.js — pure: what a Multiattack line says about the attacks beside it. No DOM.
// A plain count, a pick in any combination, or a count with a swap. Anything else, and anything
// the reading could get wrong, gives the fallback pill.

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
  const all = pills.filter(p => _cbWordMatch(t, _cbWords(p)[0]));
  if (all.length > 1 && next) {
    const n = next.replace(/ё/g, 'е'), narrow = all.filter(p => _cbWordMatch(n, _cbWords(p)[1]));
    if (narrow.length === 1) return narrow[0];
  }
  const whole = all.filter(p => _cbWordMatch(t, _cbWords(p)[0]) === 2);
  return pick(whole.length ? whole : all);
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
      const p = _cbNameMatch(tk, pills);
      if (p === 'many') return null;
      if (p) { found = p; break; }
    }
    if (found) counts.set(found, (counts.get(found) || 0) + n);
    else if (attackWord && !total) total = n;
    else return null;
  }
  if (!counts.size) {
    const attacks = pills.filter(p => !p.hit.startsWith('DC'));
    if (!total || attacks.length !== 1) return null;
    counts.set(attacks[0], total);
  } else if (total && [...counts.values()].reduce((a, b) => a + b, 0) !== total) return null;
  return counts;
}

// "Three attacks with A or B in any combination": one count over a pick of named attacks, in one
// sentence. Words after a matched name belong to that name until a comma or a joining word.
const COMBAT_JOIN = new Set(['or', 'and', 'или', 'либо', 'и']);
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

// "It can replace one attack with X" after a plain count: the count holds, and the swap is named.
const COMBAT_SWAP_N = { one: '1', two: '2', any: 'any', одну: '1', две: '2', любую: 'any' };
function _cbMultiSwap(text, pills, actions) {
  const sents = text.trim().replace(/\.$/, '').split(/\.\s+/);
  const m = sents.pop().match(/(?:может заменить|can replace)\s+([a-zа-яё]+)(?:\s+(?:из этих атак|of (?:the|those|these) attacks|атак[а-яё]*|attacks?))?\s+(?:на|with)\s+(.+)$/i);
  const k = m && COMBAT_SWAP_N[m[1].toLowerCase()];
  const base = k && sents.length ? sents.join('. ') : '';
  const counts = base && _cbMultiCounts(base, pills), pick = base && !counts && _cbMultiChoice(base, pills);
  if (!counts && !pick) return null;
  const to = m[2].split(/\s+(?:или|or)\s+/).map(alt => {
    const clean = alt.replace(/\([АБAB]\)\s*/g, '').replace(/,?\s*(?:если оно доступно|if available)$/i, '')
      .replace(/^(?:использование|сотворение|атаку|an? (?:use|casting) of|one use of|casting)\s+/i, '')
      .replace(/^заклинани[ея]\s+/i, '').trim();
    return _cbActionName(clean, actions) || clean;
  }).join(' or ');
  return { counts, pick, swap: { k, to } };
}


if (typeof module !== 'undefined' && module.exports) {
  module.exports = { COMBAT_MULTI, _cbMultiCounts, _cbMultiChoice, _cbMultiSwap };
}
