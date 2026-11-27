'use strict';

// limitedUses.js — a monster's limited abilities read off the stat block: "(2/день)" and its kin in an entry's
// name, the after-rest recharges, and the legendary action pool from its section's opening sentence. Pure.
// Unit-tested; see test/limitedUses.test.js.

// The first count wins, so a lair's or a domain's higher count after it is ignored.
const LU_DAY = /(\d+)\s*(?:\/\s*(?:день|day)|в\s+день)/i;
// ⚠ "Перезарядка 5–6" is a roll, not a counter: only "after a rest" reads.
const LU_REST = /(?:перезаряжается|перезарядка)\s+после|recharges?\s+after/i;
const LU_SHORT = /коротк|short/i;

const LU_POOL = [
  /(?:Использования\s+легендарных\s+действий|Legendary\s+Action\s+Uses)\s*:\s*(\d+)/i,
  /(?:может|can)\s+(?:совершить|выполнить|take)\s+(\d+)\s+(?:легендарн|legendary)/i,
];

function usesFromName(name) {
  const s = String(name || '');
  for (const m of s.matchAll(/\s*\(([^()]*)\)/g)) {
    const inner = m[1], day = inner.match(LU_DAY);
    let n = 0, kind = '';
    if (day && +day[1] > 0) { n = +day[1]; kind = 'day'; } else if (LU_REST.test(inner)) { n = 1; kind = LU_SHORT.test(inner) ? 'shortRest' : 'longRest'; }
    if (!kind) continue;
    const rest = (s.slice(0, m.index) + s.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
    return { n, kind, name: rest, printed: inner.trim() };
  }
  return null;
}

function legendaryPool(introText) {
  const s = String(introText || '');
  for (const re of LU_POOL) {
    const m = s.match(re);
    if (m && +m[1] > 0) return +m[1];
  }
  return null;
}

const LU_POOL_KEY = 'legendary';

// Content keys, never positions, so an edit that moves an entry keeps its crystals; a repeated name takes its index.
function usesKeys(names) {
  const seen = new Set();
  return names.map((nm, i) => {
    let key = 'use|' + String(nm || '').toLowerCase();
    if (seen.has(key)) key += ':' + i;
    seen.add(key);
    return key;
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { usesFromName, legendaryPool, usesKeys, LU_POOL_KEY };
}
