'use strict';

// attackLine.js — pure: the fight table's Attacks line read from a stat block's actions. No DOM.
// Unit-tested; see test/attackLine.test.js.

// ── The Attacks line ─────────────────────────────────────────────────────────
// Every action with a to-hit bonus and a hit's damage, as name, bonus, average damage and type.
// English 2014 and 2024 and Russian (dnd.su, the 2024 books) all read, flat damage too. A Russian
// type keeps the book's case ("рубящего", "холодом"); item 126 gives the types one vocabulary.
function combatDamageType(hit) {
  const m = hit.match(/\d+(?:\s*\([^)]*\))?\s+([A-Za-zА-Яа-яЁё]+)\s+(?:damage|урона)/i)
    || hit.match(/([А-Яа-яЁё]+)\s+урон[а-яё]*\s+\d+/i)
    || hit.match(/урон[а-яё]*\s+([а-яё]+)\s+\d+/i);
  return m ? m[1].toLowerCase() : '';
}

function combatAttacks(sb) {
  const out = [];
  for (const en of (sb && sb.secs && sb.secs.Actions) || []) {
    const t = String(en.t || '');
    const bonus = t.match(/(?:attack|атак)[^:.]*:\s*([+\-−–]\s?\d+)/i);
    const hit = t.split(/Hit:|Попадание:/i)[1];
    const dmg = hit && hit.match(/^\D*?(\d+)/);
    if (!bonus || !dmg) continue;
    out.push({ n: en.n, hit: bonus[1].replace(/\s/g, '').replace(/[−–]/, '-'), dmg: dmg[1], type: combatDamageType(hit) });
  }
  return out;
}

function combatAttackLine(sb) {
  return combatAttacks(sb).map(a => `${a.n} ${a.hit} ${a.dmg}${a.type ? ' ' + a.type : ''}`).join('\n');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { combatDamageType, combatAttacks, combatAttackLine };
}
