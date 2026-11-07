'use strict';

// sync-notes-gone.js - A FACTION OR LORE ENTRY DELETED ON ONE COMPUTER LEAVES THE OTHER, AND STAYS GONE.
//
// Two apps on one fake Drive. A writes a faction and a lore entry and both sync them; then each deletes one.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   A. A faction deleted on A leaves B at B's next sync, and the lore entry nobody deleted stays on both.
//   B. It does not come back on A once B's own record has gone up and A has synced again.
//   C. A lore entry deleted on B leaves A the same way.

const lib = require('../lib');

module.exports = async function syncNotesGone(rig) {
  const drive = await rig.fakeDrive();
  const b = await rig.second('b');
  rig.writeSyncConfig(rig.profileDir, drive);
  rig.writeSyncConfig(b.profileDir, drive);
  const dmA = await rig.restart();
  const dmB = await b.restart();
  const q = JSON.stringify;
  const tick = dm => dm.evaluate('syncEngine.now()', 120000);
  const ids = dm => dm.evaluate('notesEntriesAll().map(e => e.id)');
  const status = async () => 'A ' + q(await dmA.evaluate('syncEngine.status()')) + ' B ' + q(await dmB.evaluate('syncEngine.status()'));

  const made = await dmA.evaluate(`(() => {
    const f = notesEntryAdd('faction', 'Гильдия воров', 'faction');
    const l = notesEntryAdd('lore', 'Пророчество', 'lore');
    return { faction: f.id, lore: l.id };
  })()`);
  const both = await lib.poll(async () => {
    await tick(dmA); await tick(dmB);
    const got = await ids(dmB);
    return got.includes(made.faction) && got.includes(made.lore);
  }, 120000, 200);
  rig.check(!!both, 'setup: the two entries did not reach B: ' + await status());
  if (!both) return;

  // A
  await dmA.evaluate(`notesEntryDelete(${q(made.faction)}); 0`);
  await tick(dmA);
  const left = await lib.poll(async () => { await tick(dmB); return !(await ids(dmB)).includes(made.faction); }, 60000, 200);
  rig.check(!!left, 'A: a faction deleted on A is still on B after B synced: ' + q(await ids(dmB)) + ' ' + await status());
  rig.check((await ids(dmA)).includes(made.lore) && (await ids(dmB)).includes(made.lore), 'A: the lore entry nobody deleted left a computer');

  // B
  await tick(dmB); await tick(dmA); await tick(dmB); await tick(dmA);
  rig.check(!(await ids(dmA)).includes(made.faction), 'B: the deleted faction came back on A after the two synced again: ' + q(await ids(dmA)));

  // C
  await dmB.evaluate(`notesEntryDelete(${q(made.lore)}); 0`);
  await tick(dmB);
  const leftA = await lib.poll(async () => { await tick(dmA); return !(await ids(dmA)).includes(made.lore); }, 60000, 200);
  rig.check(!!leftA, 'C: a lore entry deleted on B is still on A after A synced: ' + q(await ids(dmA)) + ' ' + await status());
};
