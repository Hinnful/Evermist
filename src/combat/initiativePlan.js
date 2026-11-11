'use strict';

// initiativePlan.js — pure kernel for the turn order on the TV: the open fight's rows as the slots the
// players read, how many columns a sheet of them takes, and when the last monster going down ends the fight.
// No DOM. Unit-tested.

function _inpPlan() {
  return typeof combatRowHpState === 'function' ? { combatRowHpState, combatFirstNum } : require('./combatPlan.js');
}

function _inpDown(cp, r) {
  return cp.combatRowHpState(cp.combatFirstNum(r.sb && r.sb.hp), r.hp).down;
}

// Every row, in the fight table's own order, by the DM's call: no initiative and 0 HP leave nothing off. An
// ally shows its name as typed; enemies back to back are one nameless slot with a count. Slot numbers count slots.
function initiativeSlots(rows) {
  const out = [];
  for (const r of rows || []) {
    const ally = r.side === 'ally';
    const last = out[out.length - 1];
    if (!ally && last && last.count) last.count++;
    else out.push(ally ? { name: String(r.name == null ? '' : r.name).trim() } : { count: 1 });
  }
  return out.map((s, i) => Object.assign({ n: i + 1 }, s));
}

// The enemies still standing, which decides when the fight ends by itself.
function initiativeLivingMonsters(rows) {
  const cp = _inpPlan();
  return (rows || []).filter(r => r.side !== 'ally' && !_inpDown(cp, r)).length;
}

// prev and next are { fight, living }. The fight ends only when the same fight goes from a living monster to none:
// a fight started before any monster stays started, and another fight opened is a new count.
function initiativeFightOver(prev, next) {
  return !!prev && prev.fight === next.fight && prev.living > 0 && next.living === 0;
}

// One column up to ten slots; past that, balanced columns, never smaller type.
const INITIATIVE_COLUMN_MAX = 10;
function initiativeColumns(count) {
  const cols = Math.max(1, Math.ceil(count / INITIATIVE_COLUMN_MAX));
  return { cols, per: Math.max(1, Math.ceil(count / cols)) };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { initiativeSlots, initiativeColumns, initiativeLivingMonsters, initiativeFightOver, INITIATIVE_COLUMN_MAX };
}
