'use strict';

// combatPlan.js — pure kernel for the fight table: the HP line's arithmetic, the name a stat
// block is filed under, initiative order, ability modifiers. No DOM. Unit-tested; see
// test/combatPlan.test.js.

// The HP cell holds what the DM typed, "45 - 9 - 12", and the table shows what it adds up to.
// null = nothing typed; NaN = something that is not a sum, which the cell shows as "?".
function combatHpSum(expr) {
  const s = String(expr || '').replace(/\s+/g, '');
  if (!s) return null;
  if (!/^[+-]?\d+([+-]\d+)*$/.test(s)) return NaN;
  return s.match(/[+-]?\d+/g).reduce((a, t) => a + Number(t), 0);
}

// The first number typed is the creature's maximum, so a heal past it still reads as a share of it.
function combatHpState(expr) {
  const value = combatHpSum(expr);
  const max = parseInt((String(expr || '').match(/\d+/) || [])[0], 10);
  if (value === null || Number.isNaN(value) || !max) return { value, share: null, bloodied: false, down: false };
  const share = Math.max(0, Math.min(1, value / max));
  return { value, share, bloodied: share <= 0.5, down: value <= 0 };
}

// Numbered copies share one stat block: "Skeleton 3" is filed under "Skeleton".
function combatBaseName(name) {
  return String(name || '').trim().replace(/\s+\d+$/, '');
}

// Highest first; a row with no initiative sinks to the bottom; ties keep the order they had.
function combatSortByInit(rows) {
  const key = r => {
    const n = parseInt(r.init, 10);
    return Number.isNaN(n) ? -Infinity : n;
  };
  return rows.map((r, i) => ({ r, i }))
    .sort((a, b) => (key(b.r) - key(a.r)) || (a.i - b.i))
    .map(x => x.r);
}

function combatAbilityMod(score) {
  const n = parseInt(score, 10);
  if (Number.isNaN(n)) return '';
  const m = Math.floor((n - 10) / 2);
  return (m >= 0 ? '+' : '') + m;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { combatHpSum, combatHpState, combatBaseName, combatSortByInit, combatAbilityMod };
}
