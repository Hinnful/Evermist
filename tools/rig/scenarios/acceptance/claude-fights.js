'use strict';

// claude-fights.js — CLAUDE WORKS THE FIGHTS TAB AND THE BESTIARY.
//
// THE GOAL: Claude's fight and bestiary tools (src/mcp/mcpFights.js and src/mcp/mcpCombatPlan.js: duplicate_fight, edit_fight rows;
// src/mcp/mcpBestiary.js: edit_monster, duplicate_monster, delete_monster, import_monsters) change the DM's fights
// and monsters the way the DM's own panels would, each call is one step undo_last_change takes back, a delete asks
// first, and the fight open at the table is never changed under the DM. Fights and the bestiary are not a map, so the
// Player window has no part.
//
//   A. duplicate_fight copies a fight with all its rows under the name given, and undo removes the copy.
//   B. edit_fight rows sets one row's hp, AC and initiative on a fight that is not open, leaves the original alone,
//      and undo puts the row back.
//   C. edit_fight rows on the fight open at the table is refused, and the table is unchanged.
//   D. edit_monster replaces a bestiary stat block with new text, and undo puts the old one back.
//   E. duplicate_monster copies a monster under a new name, and undo removes the copy.
//   F. delete_monster without confirmed only says what would go; with confirmed it deletes; undo brings it back.
//   G. import_monsters from an Evermist bestiary .json adds its monster, and undo takes it out again.
//
// ⚠ THE .json IS WRITTEN FROM THE APP'S OWN EXPORT (bsExportFile) INTO THE RUN'S OUTPUT FOLDER, so it cannot drift from
// what the app writes and nothing binary or copyrighted is committed.

const fs = require('fs');
const path = require('path');
const lib = require('../../lib');

const STAT = name => [name, 'Medium humanoid (gnoll), chaotic evil', 'Armor Class 17 (chain shirt, shield)', 'Hit Points 22 (5d8)', 'Speed 30 ft.',
  'STR', '14 (+2)', 'DEX', '12 (+1)', 'CON', '11 (+0)', 'INT', '6 (-2)', 'WIS', '10 (+0)', 'CHA', '7 (-2)',
  'Senses darkvision 60 ft., passive Perception 10', 'Languages Gnoll', 'Challenge 1/2 (100 XP)',
  'Rampage. When the gnoll reduces a creature to 0 hit points with a melee attack, it can take a bonus action to move up to half its speed.', 'Actions',
  'Spear. Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) piercing damage.'].join('\n');

module.exports = async function claudeFights(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: 1200, h: 800 });
  const call = await lib.mcpClient(rig);
  rig.check(!!call, 'the app wrote no mcp.json with a port and a key into its profile');
  if (!call) return;
  const ev = expr => dm.evaluate(expr);

  await ev('cbState.blocks.b900 = Object.assign(combatBlankBlock("b900", "Goblin"), { ac: "15", hp: "7 (2d6)", cr: "1/4" }); ' +
           'cbState.blocks.b901 = Object.assign(combatBlankBlock("b901", "Orc"), { ac: "13", hp: "15 (2d8+6)", cr: "1/2" }); cbSave(); 0');
  const made = await call('create_fight', { name: 'Raid', monsters: [{ name: 'Goblin', count: 2 }, { name: 'Orc' }] });
  const rows = name => ev('(() => { const f = cbState.fights.find(x => x.name === ' + JSON.stringify(name) + '); return f ? (f.rows || []).map(r => ({ id: r.id, name: r.name, hp: r.hp || "", ac: r.ac || "", init: r.init || "" })) : null; })()');
  const raid = await rows('Raid');
  rig.check(!made.isError && !!raid && raid.length === 3, 'the fight the tests start from was not made: ' + JSON.stringify({ made, raid }));
  if (!raid) return;

  // ── A ──
  // RED BY DESIGN: written against the feature, never re-proved
  const copy = await call('duplicate_fight', { name: 'Raid', newName: 'Raid B' });
  const raidB = await rows('Raid B');
  rig.check(!copy.isError && !!raidB && raidB.map(r => r.name).join() === 'Goblin,Goblin 2,Orc' && raidB.every(r => !raid.some(o => o.id === r.id)),
            'A: duplicate_fight did not copy the fight with its three rows under their own ids: ' + JSON.stringify({ copy, raidB }));
  // ── B ──
  // RED BY DESIGN: written against the feature, never re-proved
  const edit = await call('edit_fight', { name: 'Raid B', rows: [{ row: 'Goblin 2', hp: '30', ac: '13', init: '7' }] });
  const edited = (await rows('Raid B')).find(r => r.name === 'Goblin 2');
  rig.check(!edit.isError && edited.hp === '30' && edited.ac === '13' && edited.init === '7' && (await rows('Raid')).every(r => r.hp !== '30'),
            'B: edit_fight did not set the row\'s hp, AC and initiative on the copy alone: ' + JSON.stringify({ edit, edited }));
  const undoneRow = await call('undo_last_change');
  const reverted = (await rows('Raid B')).find(r => r.name === 'Goblin 2');
  rig.check(!undoneRow.isError && reverted.hp !== '30' && reverted.init !== '7', 'B: undo_last_change did not put the row back: ' + JSON.stringify({ undoneRow, reverted }));
  const undoneCopy = await call('undo_last_change');
  rig.check(!undoneCopy.isError && !(await rows('Raid B')), 'A: undo_last_change did not remove the copied fight: ' + JSON.stringify(undoneCopy));

  // ── C ──
  // RED BY DESIGN: written against the feature, never re-proved
  const openName = await ev('cbState.fights.find(f => f.id === cbState.openId).name');
  const tableBefore = await ev('JSON.stringify(cbState.rows)');
  const refused = await call('edit_fight', { name: openName, rows: [{ row: 'Goblin', hp: '99' }] });
  rig.check(refused.isError && /open at the table/.test(refused.text) && await ev('JSON.stringify(cbState.rows)') === tableBefore,
            'C: edit_fight rows on the open fight was not refused or changed the table: ' + JSON.stringify(refused));

  // ── D ──
  // RED BY DESIGN: written against the feature, never re-proved
  const replaced = await call('edit_monster', { name: 'Goblin', text: STAT('Goblin') });
  const goblinAc = () => ev('cbState.blocks.b900 ? cbState.blocks.b900.ac : null');
  rig.check(!replaced.isError && /^17/.test(await goblinAc()), 'D: edit_monster did not put the new stat block on the Goblin: ' + JSON.stringify({ replaced, ac: await goblinAc() }));
  const undoneEdit = await call('undo_last_change');
  rig.check(!undoneEdit.isError && await goblinAc() === '15', 'D: undo_last_change did not put the old Goblin back: ' + JSON.stringify({ undoneEdit, ac: await goblinAc() }));

  // ── E ──
  // RED BY DESIGN: written against the feature, never re-proved
  const named = n => ev('Object.values(cbState.blocks).filter(b => b.name === ' + JSON.stringify(n) + ').map(b => b.ac)');
  const dup = await call('duplicate_monster', { name: 'Orc', newName: 'Orc Chief' });
  rig.check(!dup.isError && (await named('Orc Chief')).join() === '13' && (await named('Orc')).length === 1, 'E: duplicate_monster did not copy the Orc as Orc Chief: ' + JSON.stringify(dup));
  const undoneDup = await call('undo_last_change');
  rig.check(!undoneDup.isError && (await named('Orc Chief')).length === 0, 'E: undo_last_change did not remove the copy: ' + JSON.stringify(undoneDup));

  // ── F ──
  // RED BY DESIGN: written against the feature, never re-proved
  const dry = await call('delete_monster', { name: 'Orc' });
  rig.check(!dry.isError && /Would delete the monster "Orc"/.test(dry.text) && (await named('Orc')).length === 1,
            'F: delete_monster without confirmed changed something or did not say what goes: ' + JSON.stringify(dry));
  const gone = await call('delete_monster', { name: 'Orc', confirmed: true });
  rig.check(!gone.isError && (await named('Orc')).length === 0, 'F: delete_monster with confirmed left the monster: ' + JSON.stringify(gone));
  const undoneDelete = await call('undo_last_change');
  rig.check(!undoneDelete.isError && (await named('Orc')).join() === '13', 'F: undo_last_change did not bring the Orc back: ' + JSON.stringify(undoneDelete));

  // ── G ──
  // RED BY DESIGN: written against the feature, never re-proved
  const file = path.join(rig.outDir, 'bestiary-export.json');
  fs.writeFileSync(file, await ev('bsExportFile([statBlockFromLines(' + JSON.stringify(STAT('Cave Gnoll')) + '.split("\\n"))])'));
  const imported = await call('import_monsters', { path: file });
  rig.check(!imported.isError && (await named('Cave Gnoll')).length === 1, 'G: import_monsters did not add the monster from the .json: ' + JSON.stringify(imported));
  const undoneImport = await call('undo_last_change');
  rig.check(!undoneImport.isError && (await named('Cave Gnoll')).length === 0, 'G: undo_last_change did not take the imported monster out: ' + JSON.stringify(undoneImport));
};
