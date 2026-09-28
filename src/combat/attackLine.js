'use strict';

// attackLine.js — pure: the fight table's Attacks pills read from a stat block's actions. No DOM.

const MA = (typeof module !== 'undefined' && module.exports) ? require('./multiattack.js')
  : { COMBAT_MULTI, _cbMultiRead };

// ── Damage types ─────────────────────────────────────────────────────────────
// One key per type. A Russian book gives the type in any grammatical case, so Russian reads by stem.
const COMBAT_DAMAGE_TYPES = ['slashing', 'piercing', 'bludgeoning', 'acid', 'cold', 'fire', 'force',
  'lightning', 'necrotic', 'poison', 'psychic', 'radiant', 'thunder'];
const COMBAT_RU_TYPES = [['рубящ', 'slashing'], ['режущ', 'slashing'], ['колющ', 'piercing'], ['дробящ', 'bludgeoning'],
  ['кислот', 'acid'], ['холод', 'cold'], ['огн', 'fire'], ['огон', 'fire'], ['силов', 'force'], ['силой', 'force'],
  ['электр', 'lightning'], ['молни', 'lightning'], ['некрот', 'necrotic'], ['екротич', 'necrotic'], ['яд', 'poison'],
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
// A type can carry a noun after it: "урон некротической энергией 10 (3к6)", "урон силовым полем 45".
const EN = '(?:\\s+(?:энерги[а-яё]*|пол[ея]м?))?';
function _cbDamageParts(text) {
  const out = [];
  for (const m of text.matchAll(/(\d+)(\s*\([^)]*\))?/g)) {
    const at = m.index, end = at + m[0].length, after = text.slice(end), before = text.slice(0, at);
    let type = '', s = at, e = end, q;
    if ((q = after.match(new RegExp(`^\\s+(${W})\\s+(?:damage|урон[а-яё]*)`, 'i'))) && combatDamageType(q[1])) {
      type = combatDamageType(q[1]); e = end + q[0].length;
    } else if ((q = after.match(new RegExp(`^\\s+урон[а-яё]*\\s+(${W})${EN}`, 'i'))) && combatDamageType(q[1])) {
      type = combatDamageType(q[1]); e = end + q[0].length;
    } else if ((q = before.match(new RegExp(`(${W})${EN}(?:\\s*\\([^)]*\\))?\\s+урон[а-яё]*\\s+$`, 'i'))) && combatDamageType(q[1])) {
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
      if (!/^\s*,?\s*(?:plus|and|плюс|и(?:\s+ещ[её])?|\+)\s+$/i.test(gap)) break;
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
  const m = t.match(/DC\s*(\d+)\s+(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+saving\s+throw/i)
    || t.match(/(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+Saving\s+Throw:\s*DC\s*(\d+)/i)
    || t.match(/спасброс[а-яё]*\s+([А-Яа-яЁё]+)[:,]?\s*(?:со\s+)?Сл\.?\s*(\d+)/i)
    || t.match(/Сл\.?\s*(\d+)[^.]{0,30}?спасброс[а-яё]*\s+([А-Яа-яЁё]+)/i)
    || t.match(/Испытани[а-яё]*\s+([А-Яа-яЁё-]+):?\s*Сл\.?\s*(\d+)/i);
  if (!m) return null;
  const [dc, ab] = /^\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
  const ability = _cbAbility(ab);
  return ability ? { hit: `DC ${dc} ${ability}`, at: m.index + m[0].length } : null;
}

const COMBAT_REST = /\(\s*(?:recharges after a (short or )?long rest|перезаряжается после (короткого или )?продолжительного отдыха)\s*\)/i;
const COMBAT_PER_DAY = /\(\s*(\d+)\s*(?:\/\s*(?:day|день)|в день)\s*\)/i;
function _cbRecharge(s) {
  const m = s.match(/\(\s*(?:recharge|перезарядка)\s+(\d(?:\s*[–—-]\s*\d)?)\s*\)/i);
  if (m) return m[1].replace(/\s*[–—-]\s*/, '–');
  const d = s.match(COMBAT_PER_DAY);
  if (d) return `${d[1]}/day`;
  const r = s.match(COMBAT_REST);
  return r ? (r[1] || r[2] ? 'Short rest' : 'Long rest') : '';
}

function _cbGrapple(hit) {
  const m = hit.match(/grappled[^.(]*\(\s*escape\s+DC\s*(\d+)\s*\)/i)
    || hit.match(/(?:схвачен|захвачен)[а-яё]*[^.(]*\(\s*Сл\.?\s+(?:высвобождения|освобождения|выхода|побега)(?:\s+от\s+захвата)?\s*(\d+)\s*\)/i)
    || hit.match(/(?:схвачен|захвачен)[а-яё]*[^.(]*\(\s*(?:вырваться|высвободиться)\s+Сл\.?\s*(\d+)\s*\)/i);
  return m ? m[1] : '';
}

// ── The pills ────────────────────────────────────────────────────────────────
// One per damaging action, by attack roll or save, in book order, any edition or language; bonus actions follow.
function _cbPill(n, t) {
  // A site that prints only the dice, "Hit: (2d6 + 5) bludgeoning", gets the average every book prints.
  t = t.replace(/(^|[^\d\s]\s*)\((\d+)d(\d+)(?:\s*([+\-−–])\s*(\d+))?\)(?=\s*[A-Za-z]+ damage)/g, (m, pre, c, d, s, k) =>
    `${pre}${Math.floor(c * (+d + 1) / 2) + (k ? (s === '+' ? 1 : -1) * k : 0)} (${m.slice(pre.length + 1, -1)})`).replace(/\)(?=[A-Za-z])/g, ') ');
  const rc = _cbRecharge(n) || _cbRecharge(t);
  let name = n.replace(/\s*\(\s*(?:recharge|перезарядка)[^)]*\)/i, '').replace(COMBAT_REST, '').replace(COMBAT_PER_DAY, '').trim();
  // A Beholder's rays arrive named by their die roll, the ray's own name opening the text.
  if (/^\d+$/.test(name)) name = t.split('.')[0].trim();
  const bonus = t.match(/(?:attack|атак)[^:.]*:\s*([+\-−–]\s?\d+)/i);
  // Open5e's 2024 text drops "Hit:" and runs the damage on after the reach.
  const run = bonus && t.slice(bonus.index + bonus[0].length).match(/(?:ft|feet)\.\s*(\d+\s*(?:\(|[A-Za-z]+ damage).*)$/s);
  const hitText = t.split(/Hit:|Попадание:/i)[1] ?? (run ? run[1] : undefined);
  // An attack that only grapples still has a roll and a DC to show.
  const grab = bonus && _cbGrapple(hitText || t);
  if (grab && !_cbHitDamage(hitText || '').length) return { n: name, t, hit: bonus[1].replace(/\s/g, '').replace(/[−–]/, '-'), parts: [], rc, grab, x: 0 };
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

// The frame sits at its first member's place. One attack carries the count on the frame; several
// carry their own.
function _cbApplyMulti(multi, out) {
  const r = MA._cbMultiRead(multi.t, out, multi.actions);
  if (!r) { out.splice(multi.pos, 0, { n: multi.n, t: multi.t, fallback: true }); return; }
  const g = { group: true, n: multi.n, t: multi.t, x: r.x || 0, opts: r.opts || [], or: !!r.or, swap: r.swap || null };
  if (r.counts) {
    const one = r.counts.size === 1;
    for (const [p, c] of r.counts) p.x = !one && c > 1 ? c : 0;
    if (one) g.x = [...r.counts.values()][0] > 1 ? [...r.counts.values()][0] : 0;
  }
  if (r.alts) g.alts = r.alts.map(a => [...a].map(([p, c]) => ({ ...p, x: c > 1 ? c : 0 })));
  const members = r.alts ? r.alts.flatMap(a => [...a.keys()]) : g.opts;
  const at = out.findIndex(p => members.includes(p));
  for (let i = out.length - 1; i >= 0; i--) if (members.includes(out[i]) || r.bonus.includes(out[i])) out.splice(i, 1);
  out.splice(at, 0, g);
  for (const p of r.bonus) out.push({ ...p, ba: true });
}

function combatAttacks(sb) {
  const out = [], secs = (sb && sb.secs) || {};
  let multi = null, list = '', listed = '', breathRc = '', listRc = '';
  for (const en of secs.Actions || []) {
    const n = String(en.n || ''), t = String(en.t || '');
    if (MA.COMBAT_MULTI.test(n)) { multi = { n, t, pos: out.length }; continue; }
    let p = _cbPill(n, t);
    // A 2014 book sets the recharge on "Breath Weapons" and each breath below it.
    if (!p && /breath|дыхани/i.test(n)) breathRc = _cbRecharge(n);
    else if (p && !p.rc && breathRc && /breath|дыхани/i.test(n)) p = { ...p, rc: breathRc };
    // Rays follow their action numbered 1 to 10, or unnumbered after its text ends in a colon.
    if (!p && /:$/.test(t.trim())) listed = n.split('(')[0].trim();
    if (!/^\d+$/.test(n)) { list = p ? '' : n.split('(')[0].trim(); listRc = p ? '' : _cbRecharge(n); }
    if (p && !p.rc && listRc && /^\d+$/.test(n)) p = { ...p, rc: listRc };
    if (p) out.push(list && /^\d+$/.test(n) ? { ...p, of: list } : listed ? { ...p, of: listed } : p);
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
    : a.alts ? a.alts.map(alt => alt.map(_cbLine).join(', ')).join(' or ')
    : `${a.x ? a.x + '× ' : ''}${a.opts.map(_cbLine).join(a.or ? ' or ' : ', ')}${a.swap ? ` (${a.swap.of || a.swap.k} for ${a.swap.to})` : ''}`).join('\n');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { COMBAT_DAMAGE_TYPES, combatDamageType, combatAttacks, combatAttackLine };
}
