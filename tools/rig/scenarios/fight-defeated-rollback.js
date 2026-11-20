'use strict';

// fight-defeated-rollback.js - A FIGHT WITH A CLEANED-UP ROW OPENS ON THE PREVIOUS RELEASE AND COMES BACK (spec
// fight-table-296, DoD 11).
//
// One profile, in English. The previous release, 5.16.0, sits under ~/.cache/evermist-rig/prev-5.16.0/: `evermist`
// there runs the source of commit c6d2065 (`git archive`, the generated changelogData.js copied in, node_modules
// linked) on the dev Electron. A run against any other version fails on its version line. Console errors fail it.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   0.  The previous release under the cache is 5.16.0.
//   1.  Here a Goblin at 0 HP is cleaned up beside a live Zombie: the table shows it in the Defeated line, and the
//       save holds the flag.
//   2.  On 5.16.0 the table opens with no error and shows the Goblin as an ordinary row, both rows there.
//   3.  On 5.16.0 the Goblin's HP is typed back above 0 and the fight saves; the flag rides along untouched.
//   4.  Back on this build the table opens with no error and the Goblin is a live row again: no Defeated line, and
//       the flag gone from the save once the table has drawn it.

const fs = require('fs');
const path = require('path');
const os = require('os');
const lib = require('../lib');

const PREV = path.join(os.homedir(), '.cache', 'evermist-rig', 'prev-5.16.0', 'evermist');
const q = JSON.stringify;
const DIALOG = '(typeof _cdOpen !== "undefined" && _cdOpen ? (document.getElementById("cd-msg") || {}).textContent || "a dialog" : "")';

const ROWS = `[...document.querySelectorAll('#cb-list .cb-row, #cb-list .cb-fold')].map(e => e.classList.contains('cb-fold') ? '|' : e.querySelector('[data-f=name]').value)`;
const SAVED = `(JSON.parse(localStorage.getItem('evermist.combat') || '{}').rows || []).map(r => r.name + (r.cleaned ? ':cleaned' : ''))`;
const open = async dm => {
  await dm.evaluate('cbSetOpen(true); 0');
  await lib.settle(dm, 'document.getElementById("cb-fight").style.display === "block"', 15000);
  return dm.evaluate(ROWS);
};
const faults = async dm => {
  const dialog = await dm.evaluate(DIALOG);
  return (dm.errors || []).slice().concat(dialog ? ['dialog: ' + dialog] : []);
};

module.exports = async function fightDefeatedRollback(rig) {
  if (!rig.check(fs.existsSync(PREV), '0: no previous release is set up at ' + PREV)) return;
  let dm = rig.dm;
  await dm.evaluate('localStorage.setItem("evermist-lang", "en"); 0');
  dm = await rig.restart();
  await lib.installHelpers(dm);

  await lib.step(rig, '1 here', async () => {
    await dm.evaluate(`(() => {
      for (const [n, hp] of [['Zombie', '22'], ['Goblin', '7']]) {
        const b = combatAddEntry(cbState.blocks, Object.assign(combatBlankBlock('', n), { hp, ac: '12' }));
        const r = { id: cbState.nextId++, init: '', name: '', hp: '', ac: '', conds: [], side: 'enemy', sbChanged: false };
        combatPickInto(r, b, cbState.rows);
        cbState.rows.splice(combatAddIndex(cbState.rows), 0, r);
      }
      cbState.rows.find(r => r.name === 'Goblin').hp = '-7';
      cbSave(); return 0; })()`);
    await open(dm);
    await dm.evaluate('document.getElementById("cb-clean").click(); cbSave(); 0');
    const shown = await dm.evaluate(ROWS), saved = await dm.evaluate(SAVED);
    rig.check(q(shown) === q(['Zombie', '|']), '1: the Goblin should fold into the Defeated line, got ' + q(shown));
    rig.check(q(saved) === q(['Zombie', 'Goblin:cleaned']), '1: the save should hold the flag, holds ' + q(saved));
    await dm.evaluate('cbSetOpen(false); 0');
  });

  dm = await rig.restart({ exe: PREV });
  const ver = await dm.evaluate('window.electronAPI.getAppVersion()');
  if (!rig.check(ver === '5.16.0', '0: the previous release under ' + PREV + ' is ' + ver + ', not 5.16.0; set it up again')) return;
  await lib.installHelpers(dm);
  await lib.step(rig, '2 and 3 on 5.16.0', async () => {
    const then = await open(dm);
    const bad = await faults(dm);
    rig.check(!bad.length, '2: on 5.16.0 the table should open without error, got ' + q(bad));
    rig.check(q(then) === q(['Zombie', 'Goblin']), '2: on 5.16.0 the Goblin should be an ordinary row, got ' + q(then));
    await dm.evaluate(`(() => { const row = [...document.querySelectorAll('#cb-list .cb-row')].find(e => e.querySelector('[data-f=name]').value === 'Goblin');
      const i = row.querySelector('[data-f=hp]'); i.focus(); i.value = '-7 + 3';
      i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      cbSave(); cbSetOpen(false); return 0; })()`);
    const saved = await dm.evaluate(`(JSON.parse(localStorage.getItem('evermist.combat') || '{}').rows || []).map(r => r.name + ':' + r.hp + (r.cleaned ? ':cleaned' : ''))`);
    rig.check(q(saved) === q(['Zombie:', 'Goblin:-7 + 3:cleaned']), '3: on 5.16.0 the HP should save above 0 with the flag riding along, holds ' + q(saved));
  });

  dm = await rig.restart({ exe: null });
  await lib.installHelpers(dm);
  await lib.step(rig, '4 back here', async () => {
    const back = await open(dm);
    const bad = await faults(dm);
    rig.check(!bad.length, '4: back on this build the table should open without error, got ' + q(bad));
    rig.check(q(back) === q(['Zombie', 'Goblin']), '4: the Goblin should be a live row again, got ' + q(back));
    await dm.evaluate('cbSave(); 0');
    const saved = await dm.evaluate(SAVED);
    rig.check(q(saved) === q(['Zombie', 'Goblin']), '4: the flag should be gone from the save, holds ' + q(saved));
  });
};
