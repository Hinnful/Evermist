'use strict';

// attackLine.js — pure: the fight table's Attacks pills read from a stat block's actions. No DOM.

const MA = (typeof module !== 'undefined' && module.exports) ? require('./multiattack.js')
  : { COMBAT_MULTI, _cbMultiCounts, _cbMultiChoice, _cbMultiSwap };

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
// Psychic and necrotic can carry "энергией" after the type: "урон некротической энергией 10 (3к6)".
const EN = '(?:\\s+энерги[а-яё]*)?';
function _cbDamageParts(text) {
  const out = [];
  for (const m of text.matchAll(/(\d+)(\s*\([^)]*\))?/g)) {
    const at = m.index, end = at + m[0].length, after = text.slice(end), before = text.slice(0, at);
    let type = '', s = at, e = end, q;
    if ((q = after.match(new RegExp(`^\\s+(${W})\\s+(?:damage|урон[а-яё]*)`, 'i'))) && combatDamageType(q[1])) {
      type = combatDamageType(q[1]); e = end + q[0].length;
    } else if ((q = after.match(new RegExp(`^\\s+урон[а-яё]*\\s+(${W})${EN}`, 'i'))) && combatDamageType(q[1])) {
      type = combatDamageType(q[1]); e = end + q[0].length;
    } else if ((q = before.match(new RegExp(`(${W})${EN}\\s+урон[а-яё]*\\s+$`, 'i'))) && combatDamageType(q[1])) {
      type = combatDamageType(q[1]); s = at - q[0].length;
    } else if ((q = before.match(new RegExp(`урон[а-яё]*\\s+(${W})${EN}\\s+$`, 'i'))) && combatDamageType(q[1])) {
      type = combatDamageType(q[1]); s = at - q[0].length;
    }
    if (type) out.push({ dmg: m[1], type, s, e });
  }
  return out;
}

// The hit's damage: the first part, then each one joined to it by "plus" or "and". A part that holds
// only under a condition ("if the attack roll had Advantage") or an alternative ("or 9 with two
// hands") stops the run. An alternative set off by dashes is blanked, so the "plus" after it still joins.
function _cbHitDamage(text) {
  text = text.replace(/[—–]\s*(?:or|или)\s[^—–]*[—–]/gi, m => ' '.repeat(m.length));
  const parts = _cbDamageParts(text), out = [];
  for (const p of parts) {
    if (out.length) {
      const gap = text.slice(out[out.length - 1].e, p.s);
      if (!/^\s*,?\s*(?:plus|and|плюс|и(?:\s+ещ[её])?)\s+$/i.test(gap)) break;
      if (/^[^.;]*?\b(?:if|when)\b|^[^.;]*?(?:^|\s)(?:если|когда)\s/i.test(text.slice(p.e))) break;
    }
    out.push(p);
  }
  return out.map(p => ({ dmg: p.dmg, type: p.type }));
}

// ── Saves, recharge, grapple ─────────────────────────────────────────────────
const COMBAT_ABILITIES = [['str', 'Str', 'сил'], ['dex', 'Dex', 'ловк'], ['con', 'Con', 'телосл', 'вынос'],
  ['int', 'Int', 'интел'], ['wis', 'Wis', 'мудр'], ['cha', 'Cha', 'хариз']];
// A PDF line break can leave a hyphen inside the word: "Лов-кости".
const _cbAbility = w => {
  const l = w.toLowerCase().replace(/-/g, ''), a = COMBAT_ABILITIES.find(([en, , ...ru]) => l.startsWith(en) || ru.some(r => l.startsWith(r)));
  return a ? a[1] : '';
};

function _cbSave(t) {
  const m = t.match(/DC\s*(\d+)\s+(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+saving throw/i)
    || t.match(/(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+Saving Throw:\s*DC\s*(\d+)/i)
    || t.match(/спасброс[а-яё]*\s+([А-Яа-яЁё]+)[:,]?\s*(?:со\s+)?Сл\s*(\d+)/i)
    || t.match(/Сл\s*(\d+)[^.]{0,30}?спасброс[а-яё]*\s+([А-Яа-яЁё]+)/i)
    || t.match(/Испытани[а-яё]*\s+([А-Яа-яЁё-]+):?\s*Сл\s*(\d+)/i);
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

// ── The pills ────────────────────────────────────────────────────────────────
// One per action that deals damage, by attack roll or by save, in the book's order. English 2014 and
// 2024 and Russian (dnd.su, the 2024 books) all read, flat damage too. Bonus actions follow, marked.
function _cbPill(n, t) {
  const rc = _cbRecharge(n) || _cbRecharge(t);
  let name = n.replace(/\s*\(\s*(?:recharge|перезарядка)[^)]*\)/i, '').trim();
  // A Beholder's rays arrive named by their die roll, the ray's own name opening the text.
  if (/^\d+$/.test(name)) name = t.split('.')[0].trim();
  const bonus = t.match(/(?:attack|атак)[^:.]*:\s*([+\-−–]\s?\d+)/i);
  const hitText = t.split(/Hit:|Попадание:/i)[1];
  if (bonus && hitText) {
    let parts = _cbHitDamage(hitText);
    if (!parts.length) {
      const flat = hitText.match(/^\D*?(\d+)(?:\s*\([^)]*\))?[^.\d]*?(?:damage|урон)/i);
      if (!flat) return null;
      parts = [{ dmg: flat[1], type: '' }];
    }
    return { n: name, t, hit: bonus[1].replace(/\s/g, '').replace(/[−–]/, '-'), parts, rc, grab: _cbGrapple(hitText), x: 0 };
  }
  const save = _cbSave(t);
  const parts = save ? _cbHitDamage(t.slice(save.at)) : [];
  return parts.length ? { n: name, t, hit: save.hit, parts, rc, grab: '', x: 0 } : null;
}

// A pick or a swap becomes one group at its first member's place, its members inside it.
function _cbApplyMulti(multi, out) {
  const counts = MA._cbMultiCounts(multi.t, out);
  if (counts) { for (const [p, c] of counts) p.x = c > 1 ? c : 0; return; }
  const swap = MA._cbMultiSwap(multi.t, out, multi.actions), pick = swap ? swap.pick : MA._cbMultiChoice(multi.t, out);
  if (!pick && !swap) { out.splice(multi.pos, 0, { n: multi.n, t: multi.t, fallback: true }); return; }
  const opts = pick ? pick.opts : [...swap.counts.keys()];
  const one = !pick && swap.counts.size === 1;
  if (!pick) for (const [p, c] of swap.counts) p.x = !one && c > 1 ? c : 0;
  const g = { group: true, n: multi.n, t: multi.t, x: pick ? pick.x : one ? [...swap.counts.values()][0] : 0,
    opts, or: !!pick, swap: swap ? swap.swap : null };
  const at = out.findIndex(p => opts.includes(p));
  for (let i = out.length - 1; i >= 0; i--) if (opts.includes(out[i])) out.splice(i, 1);
  out.splice(at, 0, g);
}

function combatAttacks(sb) {
  const out = [], secs = (sb && sb.secs) || {};
  let multi = null;
  for (const en of secs.Actions || []) {
    const n = String(en.n || ''), t = String(en.t || '');
    if (MA.COMBAT_MULTI.test(n)) { multi = { n, t, pos: out.length }; continue; }
    const p = _cbPill(n, t);
    if (p) out.push(p);
  }
  if (multi) _cbApplyMulti({ ...multi, actions: secs.Actions.map(a => ({ n: String(a.n || '') })) }, out);
  for (const en of secs['Bonus actions'] || []) {
    const p = _cbPill(String(en.n || ''), String(en.t || ''));
    if (p) out.push({ ...p, ba: true });
  }
  return out;
}

// The plain line a double-click starts the DM's own line from.
const _cbLine = a => `${a.x ? a.x + '× ' : ''}${a.n} ${a.hit} ${a.parts.map(p => p.dmg + (p.type ? ' ' + p.type : '')).join(' + ')}`;
function combatAttackLine(sb) {
  return combatAttacks(sb).filter(a => !a.fallback).map(a => !a.group ? (a.ba ? 'Bonus: ' : '') + _cbLine(a)
    : `${a.x ? a.x + '× ' : ''}${a.opts.map(_cbLine).join(a.or ? ' or ' : ', ')}${a.swap ? ` (${a.swap.k} for ${a.swap.to})` : ''}`).join('\n');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { COMBAT_DAMAGE_TYPES, combatDamageType, combatAttacks, combatAttackLine };
}
