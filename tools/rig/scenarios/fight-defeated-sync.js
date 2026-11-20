'use strict';

// fight-defeated-sync.js - A CLEANED-UP ROW TRAVELS THROUGH EXPORT, IMPORT AND SYNC (spec fight-table-296, DoD 11).
//
// One fight: a live Zombie and a Goblin at 0 HP that Clean up put in the Defeated line. One library first, through a
// backup; then two apps on one fake Drive.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   11a. Export and Import: the DM cleans the Goblin up, exports, and restores the file into an emptied library: the
//        Goblin comes back with the flag, in the Defeated line.
//   11b. Sync: B gets the fight with the Goblin cleaned up, shown in the Defeated line.
//   11c. Sync back: the DM on B picks "Return to fight" on the Goblin; A gets the row without the flag.

const fs = require('fs');
const path = require('path');
const lib = require('../lib');
const kit = require('../backupKit');

const q = JSON.stringify;
const SAVED = `(JSON.parse(localStorage.getItem('evermist.combat') || '{}').rows || []).map(r => r.name + (r.cleaned ? ':cleaned' : ''))`;
const SHOWN = `(() => { cbSetOpen(true); const out = [...document.querySelectorAll('#cb-list .cb-row, #cb-list .cb-fold')]
  .map(e => e.classList.contains('cb-fold') ? '|' : e.querySelector('[data-f=name]').value); cbSetOpen(false); return out; })()`;
const CLEANED = ['Zombie', 'Goblin:cleaned'];

module.exports = async function fightDefeatedSync(rig) {
  let dm = rig.dm;
  await lib.installHelpers(dm);
  await kit.install(dm);
  const K = await dm.evaluate(`(async () => {
    const f = await __bk.noiseFile('Таверна', 1200, 800, 3, 0.85);
    return (await addMapsToLibrary([f], { x: 0, y: 400 }, true)).ids[0];
  })()`, 240000);

  await lib.step(rig, '11a: export and import', async () => {
    await dm.evaluate(`(() => {
      for (const [n, hp] of [['Zombie', '22'], ['Goblin', '7']]) {
        const b = combatAddEntry(cbState.blocks, Object.assign(combatBlankBlock('', n), { hp, ac: '12' }));
        const r = { id: cbState.nextId++, init: '', name: '', hp: '', ac: '', conds: [], side: 'enemy', sbChanged: false };
        combatPickInto(r, b, cbState.rows);
        cbState.rows.splice(combatAddIndex(cbState.rows), 0, r);
      }
      cbState.rows.find(r => r.name === 'Goblin').hp = '-7';
      cbSetOpen(true); document.getElementById('cb-clean').click(); cbSetOpen(false); cbSave(); return 0; })()`);
    rig.check(q(await dm.evaluate(SAVED)) === q(CLEANED), '11a setup: Clean up should flag the Goblin, holds ' + q(await dm.evaluate(SAVED)));
    const zip = path.join(rig.outDir, 'таверна.zip');
    await dm.evaluate(`doExport(${q([K])}, { destPath: ${q(zip)} })`, 300000);
    rig.check(fs.existsSync(zip), '11a setup: the backup was not written');
    await dm.evaluate('__bk.wipe()', 120000);
    dm = await rig.restart();
    await lib.installHelpers(dm);
    await kit.install(dm);
    await lib.settle(dm, 'typeof sceneStore !== "undefined"', 30000);
    rig.check(!(await dm.evaluate(SAVED)).length, '11a setup: the wipe left rows behind');
    await dm.evaluate(`restoreFromZipPath(${q(zip)}, __bk.say)`, 300000);
    rig.check(q(await dm.evaluate(SAVED)) === q(CLEANED), '11a: the restored fight should hold the Goblin cleaned up, holds ' + q(await dm.evaluate(SAVED)));
    rig.check(q(await dm.evaluate(SHOWN)) === q(['Zombie', '|']), '11a: the restored table should show the Goblin in the Defeated line, shows ' + q(await dm.evaluate(SHOWN)));
  });

  const drive = await rig.fakeDrive();
  const b = await rig.second('b');
  rig.writeSyncConfig(rig.profileDir, drive);
  rig.writeSyncConfig(b.profileDir, drive);
  const dmA = await rig.restart();
  const dmB = await b.restart();
  await lib.installHelpers(dmA);
  await lib.installHelpers(dmB);
  for (const d of [dmA, dmB]) await lib.settle(d, 'typeof syncEngine !== "undefined" && syncEngine.status().state !== "off"', 60000);
  const pulled = (d, want) => lib.poll(async () => {
    await d.evaluate('syncEngine.now()', 60000);
    const n = await d.evaluate(SAVED);
    return q(n) === q(want) ? n : null;
  }, 120000, 500);

  await lib.step(rig, '11b: sync', async () => {
    await dmA.evaluate('syncEngine.now()', 60000);
    rig.check(!!(await pulled(dmB, CLEANED)), '11b: B should get the Goblin cleaned up, holds ' + q(await dmB.evaluate(SAVED)));
    rig.check(q(await dmB.evaluate(SHOWN)) === q(['Zombie', '|']), '11b: B\'s table should show the Goblin in the Defeated line, shows ' + q(await dmB.evaluate(SHOWN)));
  });

  await lib.step(rig, '11c: sync back', async () => {
    await dmB.evaluate(`(() => { cbSetOpen(true); document.querySelector('#cb-list .cb-fold').click();
      const row = [...document.querySelectorAll('#cb-list .cb-row')].find(e => e.querySelector('[data-f=name]').value === 'Goblin'), r = row.getBoundingClientRect();
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 }));
      [...document.querySelectorAll('#cb-menu [data-i]')].find(d => d.textContent === t('Return to fight')).click();
      cbSave(); cbSetOpen(false); return 0; })()`);
    rig.check(q(await dmB.evaluate(SAVED)) === q(['Zombie', 'Goblin']), '11c: on B the Goblin should be back in the fight, holds ' + q(await dmB.evaluate(SAVED)));
    await dmB.evaluate('syncEngine.now()', 60000);
    rig.check(!!(await pulled(dmA, ['Zombie', 'Goblin'])), '11c: A should get the Goblin back in the fight, holds ' + q(await dmA.evaluate(SAVED)));
  });
};
