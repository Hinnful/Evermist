'use strict';

// fight-table-safety.js — WHAT THE FIGHT TABLE HOLDS SURVIVES A CLOSE, AND WHAT IT IS HANDED NEVER RUNS.
//
// THE GOAL OF THIS FEATURE: a note on a monster is never lost to closing the app, and a fight that came
// in from someone else's zip shows its rows and nothing else.
//
// Drives src/combat/combatTracker.js.
//
// THE CRITERIA ARE THIS HEADER. Each check sits under its letter.
//
//   A. A row whose side came in as markup shows as an ordinary row, with nothing added to the page.
//   B. A monster note committed just before the app closes is there after a restart.

const lib = require('../../lib');

module.exports = async function fightTableSafety(rig) {
  let dm = rig.dm;
  await lib.openMap(rig, { w: 1200, h: 800, kind: 'still', name: 'fight-safety.png' });

  // ── A. A crafted side adds nothing to the page ────────────────────────────
  // RED ON: r.side written raw into the row's class (combatTracker.js) — 2026-11-04
  await dm.evaluate('(() => { cbState.rows.push({ id: cbState.nextId++, init: "", name: "Stranger", hp: "", ac: "", conds: [],' +
    ' side: "x\\"><img id=\\"rig-injected\\" src=\\"x\\">", sbChanged: false }); cbRender(); return 0; })()');
  const injected = await dm.evaluate('!!document.getElementById("rig-injected")');
  rig.check(!injected, 'a fight row\'s side from an import added an element to the page');
  await dm.evaluate('cbState.rows = cbState.rows.filter(r => r.name !== "Stranger"); cbRender(); cbSave(); 0');

  // ── B. A note on the save timer survives a close ──────────────────────────
  // RED ON: the pagehide flush removed (combatTracker.js) — 2026-11-04
  await dm.evaluate('cbState.blocks.rigwolf = Object.assign({}, cbState.blocks.rigwolf, { name: "Rig Wolf", notes: "saved earlier" }); cbSave(); 0');
  await dm.evaluate('cbState.blocks.rigwolf.notes = "typed right before closing"; cbSaveSoon(); 0');
  dm = await rig.restart();
  const after = await dm.evaluate('JSON.stringify((((JSON.parse(localStorage.getItem(CB_KEY)) || {}).blocks) || {}).rigwolf || null)');
  rig.check(/typed right before closing/.test(after), 'a monster note committed just before closing was lost: ' + after);
};
