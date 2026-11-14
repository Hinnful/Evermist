'use strict';

// initiativePlan.js — pure kernel for the turn order on the TV: the open fight's rows as the slots the
// players read, and how many columns a sheet of them takes. No DOM. Unit-tested.

function _inpPlan() {
  return typeof combatRowHpState === 'function' ? { combatRowHpState, combatFirstNum } : require('./combatPlan.js');
}

function _inpDown(cp, r) {
  return cp.combatRowHpState(cp.combatFirstNum(r.sb && r.sb.hp), r.hp).down;
}

// The fight table's own order. Every ally shows, by its name as typed; an enemy shows once it has an initiative
// and until it is down, and enemies back to back are one nameless slot with a count. Slot numbers count slots.
function initiativeSlots(rows) {
  const cp = _inpPlan(), out = [];
  for (const r of rows || []) {
    const ally = r.side === 'ally';
    if (!ally && (Number.isNaN(parseInt(r.init, 10)) || _inpDown(cp, r))) continue;
    const last = out[out.length - 1];
    if (!ally && last && last.count) last.count++;
    else out.push(ally ? { name: String(r.name == null ? '' : r.name).trim() } : { count: 1 });
  }
  return out.map((s, i) => Object.assign({ n: i + 1 }, s));
}

// One column up to ten slots; past that, balanced columns, never smaller type.
const INITIATIVE_COLUMN_MAX = 10;
function initiativeColumns(count) {
  const cols = Math.max(1, Math.ceil(count / INITIATIVE_COLUMN_MAX));
  return { cols, per: Math.max(1, Math.ceil(count / cols)) };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { initiativeSlots, initiativeColumns, INITIATIVE_COLUMN_MAX };
}
