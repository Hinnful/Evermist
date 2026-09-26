'use strict';

// attackLine.js — pure: the fight table's Attacks pills read from a stat block's actions. No DOM.
// Unit-tested; see test/attackLine.test.js.

// ── Damage types ─────────────────────────────────────────────────────────────
// One key per type. A Russian book gives the type in any grammatical case, so Russian reads by stem.
const COMBAT_DAMAGE_TYPES = ['slashing', 'piercing', 'bludgeoning', 'acid', 'cold', 'fire', 'force',
  'lightning', 'necrotic', 'poison', 'psychic', 'radiant', 'thunder'];
const COMBAT_RU_TYPES = [['рубящ', 'slashing'], ['режущ', 'slashing'], ['колющ', 'piercing'], ['дробящ', 'bludgeoning'],
  ['кислот', 'acid'], ['холод', 'cold'], ['огн', 'fire'], ['огон', 'fire'], ['силов', 'force'], ['силой', 'force'],
  ['электр', 'lightning'], ['молни', 'lightning'], ['некрот', 'necrotic'], ['яд', 'poison'],
  ['психич', 'psychic'], ['излуч', 'radiant'], ['лучист', 'radiant'], ['звук', 'thunder'], ['гром', 'thunder']];

function combatDamageType(word) {
  const w = String(word || '').toLowerCase().replace(/ё/g, 'е');
  if (COMBAT_DAMAGE_TYPES.includes(w)) return w;
  const ru = COMBAT_RU_TYPES.find(([s]) => w.startsWith(s));
  return ru ? ru[1] : '';
}

// ── Damage parts ─────────────────────────────────────────────────────────────
// Every "N (dice) type" in the text, with where its phrase starts and ends. A number no known type
// sits beside (a reach, a DC) is not damage.
const W = '[A-Za-zА-Яа-яЁё]+';
function _cbDamageParts(text) {
  const out = [];
  for (const m of text.matchAll(/(\d+)(\s*\([^)]*\))?/g)) {
    const at = m.index, end = at + m[0].length, after = text.slice(end), before = text.slice(0, at);
    let type = '', s = at, e = end, q;
    if ((q = after.match(new RegExp(`^\\s+(${W})\\s+(?:damage|урон[а-яё]*)`, 'i'))) && combatDamageType(q[1])) {
      type = combatDamageType(q[1]); e = end + q[0].length;
    } else if ((q = after.match(new RegExp(`^\\s+урон[а-яё]*\\s+(${W})`, 'i'))) && combatDamageType(q[1])) {
      type = combatDamageType(q[1]); e = end + q[0].length;
    } else if ((q = before.match(new RegExp(`(${W})\\s+урон[а-яё]*\\s+$`, 'i'))) && combatDamageType(q[1])) {
      type = combatDamageType(q[1]); s = at - q[0].length;
    } else if ((q = before.match(new RegExp(`урон[а-яё]*\\s+(${W})\\s+$`, 'i'))) && combatDamageType(q[1])) {
      type = combatDamageType(q[1]); s = at - q[0].length;
    }
    if (type) out.push({ dmg: m[1], type, s, e });
  }
  return out;
}

// The hit's damage: the first part, then each one joined to it by "plus" or "and". A part that holds
// only under a condition ("if the attack roll had Advantage") or an alternative ("or 9 with two
// hands") stops the run.
function _cbHitDamage(text) {
  const parts = _cbDamageParts(text), out = [];
  for (const p of parts) {
    if (out.length) {
      const gap = text.slice(out[out.length - 1].e, p.s);
      if (!/^\s*,?\s*(?:plus|and|плюс|и)\s+$/i.test(gap)) break;
      if (/^[^.;]*?\b(?:if|when)\b|^[^.;]*?(?:^|\s)(?:если|когда)\s/i.test(text.slice(p.e))) break;
    }
    out.push(p);
  }
  return out.map(p => ({ dmg: p.dmg, type: p.type }));
}

// ── Saves, recharge, grapple ─────────────────────────────────────────────────
const COMBAT_ABILITIES = [['str', 'Str', 'сил'], ['dex', 'Dex', 'ловк'], ['con', 'Con', 'телосл'],
  ['int', 'Int', 'интел'], ['wis', 'Wis', 'мудр'], ['cha', 'Cha', 'хариз']];
const _cbAbility = w => {
  const l = w.toLowerCase(), a = COMBAT_ABILITIES.find(([en, , ru]) => l.startsWith(en) || l.startsWith(ru));
  return a ? a[1] : '';
};

function _cbSave(t) {
  const m = t.match(/DC\s*(\d+)\s+(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+saving throw/i)
    || t.match(/(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+Saving Throw:\s*DC\s*(\d+)/i)
    || t.match(/спасброс[а-яё]*\s+([А-Яа-яЁё]+)[:,]?\s*(?:со\s+)?Сл\s*(\d+)/i)
    || t.match(/Сл\s*(\d+)[^.]{0,30}?спасброс[а-яё]*\s+([А-Яа-яЁё]+)/i);
  if (!m) return null;
  const [dc, ab] = /^\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
  const ability = _cbAbility(ab);
  return ability ? { hit: `DC ${dc} ${ability}`, at: m.index + m[0].length } : null;
}

function _cbRecharge(s) {
  const m = s.match(/\(\s*(?:recharge|перезарядка)\s+(\d(?:\s*[–—-]\s*\d)?)\s*\)/i);
  return m ? m[1].replace(/\s*[–—-]\s*/, '–') : '';
}

function _cbGrapple(hit) {
  const m = hit.match(/grappled[^.(]*\(\s*escape\s+DC\s*(\d+)\s*\)/i)
    || hit.match(/(?:схвачен|захвачен)[а-яё]*[^.(]*\(\s*Сл\s+(?:высвобождения|освобождения|выхода|побега)\s*(\d+)\s*\)/i);
  return m ? m[1] : '';
}

// ── Multiattack ──────────────────────────────────────────────────────────────
// Counts per named attack. Anything the counts could get wrong - a choice, a swap, a name that
// matches no attack, a total the named counts do not add up to - gives the fallback pill instead.
const COMBAT_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  одну: 1, один: 1, одной: 1, одним: 1, две: 2, два: 2, двумя: 2, три: 3, тремя: 3, четыре: 4, пять: 5, шесть: 6 };
// A word boundary never matches after a Cyrillic letter, so the name ends on a letter class.
const COMBAT_MULTI = /^(multiattack|мультиатака)(?![a-zа-яё])/i;

// A whole-word match wins over a stem, so "longsword" never also matches Longbow. The stem is for
// Russian cases ("когтями" against "Коготь").
const COMBAT_FILLER = new Set(['with', 'its', 'his', 'her', 'their', 'the', 'using', 'melee', 'ranged',
  'своим', 'своими', 'его', 'её', 'ее', 'ближнем', 'дальнобойные']);
function _cbNameMatch(token, pills) {
  const t = token.toLowerCase().replace(/ё/g, 'е');
  if (t.length < 3 || COMBAT_FILLER.has(t)) return null;
  const first = p => p.n.toLowerCase().replace(/ё/g, 'е').split(/[\s(]+/)[0];
  const pick = hits => hits.length === 1 ? hits[0] : hits.length ? 'many' : null;
  const whole = pills.filter(p => t.startsWith(first(p)) || first(p).startsWith(t));
  if (whole.length) return pick(whole);
  return pick(pills.filter(p => {
    const w = first(p);
    let k = 0;
    while (k < t.length && k < w.length && t[k] === w[k]) k++;
    return k >= 3 && w.length > 4;
  }));
}

function _cbMultiCounts(text, pills) {
  if (/\b(?:or|instead|replaces?|in place of)\b|(?:^|\s)(?:или|вместо|замен[а-яё]*)(?=\s|$)/i.test(text)) return null;
  const toks = text.toLowerCase().match(/[a-zа-яё]+|[.:;]/g) || [];
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

// ── The pills ────────────────────────────────────────────────────────────────
// One per action that deals damage, by attack roll or by save, in the book's order. English 2014 and
// 2024 and Russian (dnd.su, the 2024 books) all read, flat damage too.
function combatAttacks(sb) {
  const out = [];
  let multi = null;
  for (const en of (sb && sb.secs && sb.secs.Actions) || []) {
    const n = String(en.n || ''), t = String(en.t || '');
    if (COMBAT_MULTI.test(n)) { multi = { n, t, fallback: true, pos: out.length }; continue; }
    const rc = _cbRecharge(n) || _cbRecharge(t);
    const name = n.replace(/\s*\(\s*(?:recharge|перезарядка)[^)]*\)/i, '').trim();
    const bonus = t.match(/(?:attack|атак)[^:.]*:\s*([+\-−–]\s?\d+)/i);
    const hitText = t.split(/Hit:|Попадание:/i)[1];
    if (bonus && hitText) {
      let parts = _cbHitDamage(hitText);
      if (!parts.length) {
        const flat = hitText.match(/^\D*?(\d+)(?:\s*\([^)]*\))?[^.\d]*?(?:damage|урон)/i);
        if (!flat) continue;
        parts = [{ dmg: flat[1], type: '' }];
      }
      out.push({ n: name, t, hit: bonus[1].replace(/\s/g, '').replace(/[−–]/, '-'), parts, rc, grab: _cbGrapple(hitText), x: 0 });
      continue;
    }
    const save = _cbSave(t);
    const parts = save ? _cbHitDamage(t.slice(save.at)) : [];
    if (parts.length) out.push({ n: name, t, hit: save.hit, parts, rc, grab: '', x: 0 });
  }
  if (multi) {
    const counts = _cbMultiCounts(multi.t, out);
    if (counts) for (const [p, c] of counts) p.x = c > 1 ? c : 0;
    else out.splice(multi.pos, 0, { n: multi.n, t: multi.t, fallback: true });
  }
  return out;
}

// The plain line a double-click starts the DM's own line from.
function combatAttackLine(sb) {
  return combatAttacks(sb).filter(a => !a.fallback).map(a => `${a.x ? a.x + '× ' : ''}${a.n} ${a.hit} ${
    a.parts.map(p => p.dmg + (p.type ? ' ' + p.type : '')).join(' + ')}`).join('\n');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { COMBAT_DAMAGE_TYPES, combatDamageType, combatAttacks, combatAttackLine };
}
