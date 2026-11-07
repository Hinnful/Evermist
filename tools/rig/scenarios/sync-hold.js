'use strict';

// sync-hold.js - A CHANGE FROM THE OTHER COMPUTER NEVER LANDS UNDER THE DM'S HANDS.
//
// Two apps on one fake Drive. A makes five small maps and a place, both sync; then A edits while B has things on screen.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   A. A change for the map open on B waits while it is open, and lands once B opens another.
//   B. A change for the map on B's TV (Manual, another map open) waits while the TV shows it, and lands once it does not.
//   C. A fight change waits while B's fight table is shown, and lands once it is closed.
//   D. A place's note change waits while that note is open in B's notes window, and lands once the window closes.
//   E. With Two maps on, a change for either column's map waits, a change for another map lands, Two maps stays on and
//      no column reloads; both waiting changes land once Two maps is off.
//   F. A pending delete on B keeps its undo toast through a sync, nothing lands while it can be undone, and what waited
//      lands after the undo.
//   G. Nothing on B's screen reloads for sync: no map switch B did not ask for, and the open map is the same object.

const lib = require('../lib');
const kit = require('../backupKit');

module.exports = async function syncHold(rig) {
  const drive = await rig.fakeDrive();
  const b = await rig.second('b');
  rig.writeSyncConfig(rig.profileDir, drive);
  rig.writeSyncConfig(b.profileDir, drive);
  const dmA = await rig.restart();
  const dmB = await b.restart();
  await kit.install(dmA);
  const q = JSON.stringify;
  const tick = dm => dm.evaluate('syncEngine.now()', 120000);
  const both = async () => { await tick(dmA); await tick(dmB); };
  const status = async () => 'A ' + q(await dmA.evaluate('syncEngine.status()')) + ' B ' + q(await dmB.evaluate('syncEngine.status()'));
  const notesOn = (dm, id) => dm.evaluate(`sceneStore.loadScene(${q(id)}).then(r => r ? r.notes || '' : null)`, 20000);
  const editA = (id, text) => dmA.evaluate(`__bk.editScene(${q(id)}, s => { s.notes = ${q(text)}; })`, 20000);

  const ids = await dmA.evaluate(`(async () => {
    const out = [];
    for (const [i, n] of ['Склеп', 'Пещера', 'Башня', 'Мост', 'Порт'].entries()) {
      const f = await __bk.noiseFile(n, 640, 480, i + 1, 0.8);
      out.push((await addMapsToLibrary([f], { x: i * 300, y: 0 }, true)).ids[0]);
    }
    worldPlaceSet('Север', [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 500 }, { x: 0, y: 500 }]);
    return out;
  })()`, 120000);
  const [mOpen, mTv, mCol1, mCol2, mOther] = ids;
  const ready = await lib.poll(async () => {
    await both();
    const here = await dmB.evaluate(`${q(ids)}.every(id => allScenes.some(s => s.id === id)) && !!worldPlaceByName('Север')`);
    return here && await dmB.evaluate(`syncIndex.raw.get('synced', '$first').then(x => !!x)`, 20000);
  }, 120000, 200);
  rig.check(!!ready, 'setup: the maps and the place did not reach B: ' + await status());
  if (!ready) return;

  // B's screen: the TV on one map in Manual, another map open. Every switch from here on is counted.
  await dmB.evaluate(`switchScene(${q(mTv)})`, 30000);
  await b.player();
  await lib.settle(dmB, `tvSceneId === ${q(mTv)}`, 20000);
  await dmB.evaluate(`if (autoSync) document.getElementById('btn-auto-sync').click(); 0`);
  await dmB.evaluate(`switchScene(${q(mOpen)})`, 30000);
  await dmB.evaluate(`window.__switches = 0; const __sw = switchScene; switchScene = (...a) => { window.__switches++; return __sw(...a); };
    window.__cur = currentScene; cbSetOpen(true); nwShow(); ntGoKey('place:Север'); 0`);
  const screen = await dmB.evaluate(`({ open: currentScene && currentScene.id, tv: tvSceneId, auto: autoSync, fight: document.getElementById('cb-fight').style.display,
    note: syncMerge.context().openNoteKey })`);
  rig.check(screen.open === mOpen && screen.tv === mTv && !screen.auto && screen.fight === 'block' && screen.note === 'campaign',
    'setup: B\'s screen is not as the scenario set it: ' + q(screen));

  await editA(mOpen, 'A: открытая');
  await editA(mTv, 'A: на ТВ');
  await dmA.evaluate(`cbAddBlocks([Object.assign(combatBlankBlock(0, 'Огр'), { hp: '59', ac: '11' })], 'rig'); cbSave(); notesPlaceSet('Север', 'A: про север'); 0`);
  await tick(dmA);
  const waiting = await lib.poll(async () => {
    await tick(dmB);
    const p = await dmB.evaluate('syncEngine.pending()');
    return p.length >= 4 ? p : null;
  }, 60000, 300);
  const fightB = () => dmB.evaluate(`(localStorage.getItem('evermist.combat') || '').includes('Огр')`);
  const placeB = () => dmB.evaluate(`notesPlaceGet('Север')`);
  rig.note('held on B: ' + q(waiting));

  // A
  rig.check(await notesOn(dmB, mOpen) === '', 'A: the change for the open map landed while it was open');
  // B
  rig.check(await notesOn(dmB, mTv) === '', 'B: the change for the TV map landed while the TV showed it');
  // C
  rig.check(!(await fightB()), 'C: the fight change landed while the fight table was shown');
  // D
  rig.check(await placeB() === '', 'D: the place note changed while it was open in the notes window');

  await dmB.evaluate('cbSetOpen(false); 0');
  const fightIn = await lib.poll(async () => { await tick(dmB); return await fightB(); }, 30000, 300);
  rig.check(!!fightIn, 'C: the fight change did not land after the fight table closed: ' + await status());
  await dmB.evaluate('nwHide(); 0');
  const placeIn = await lib.poll(async () => { await tick(dmB); return await placeB() === 'A: про север'; }, 30000, 300);
  rig.check(!!placeIn, 'D: the place note did not land after the notes window closed: ' + q(await placeB()));
  // Auto back on sends the open map to the TV: the TV's own map is let go, the open one is still held.
  await dmB.evaluate(`if (!autoSync) document.getElementById('btn-auto-sync').click(); 0`);
  await lib.settle(dmB, `tvSceneId === ${q(mOpen)}`, 20000);
  const tvIn = await lib.poll(async () => { await tick(dmB); return await notesOn(dmB, mTv) === 'A: на ТВ'; }, 30000, 300);
  rig.check(!!tvIn, 'B: the TV map\'s change did not land once the TV left it');
  rig.check(await notesOn(dmB, mOpen) === '', 'A: the change for the open map landed while it was open on the TV and the DM\'s screen');

  // G (before B switches itself)
  const g = await dmB.evaluate('({ switches: window.__switches, same: currentScene === window.__cur })');
  rig.check(g.switches === 0 && g.same, 'G: sync reloaded B\'s open map: ' + q(g));

  await dmB.evaluate(`switchScene(${q(mOther)})`, 30000);
  const openIn = await lib.poll(async () => { await tick(dmB); return await notesOn(dmB, mOpen) === 'A: открытая'; }, 30000, 300);
  rig.check(!!openIn, 'A: the open map\'s change did not land once B opened another');

  // E
  await dmB.evaluate(`enterPanes(${q(mCol1)}, ${q(mCol2)})`, 60000);
  await lib.settle(dmB, 'panesActive && livePanes().length === 2 && livePanes().every(id => panes[id].ready)', 60000);
  await dmB.evaluate(`for (const id of livePanes()) panes[id].frame.contentWindow.__rigMark = id; window.__switches = 0; 0`);
  await editA(mCol1, 'A: колонка 1');
  await editA(mCol2, 'A: колонка 2');
  await editA(mTv, 'A: при двух картах');
  await tick(dmA);
  const otherIn = await lib.poll(async () => { await tick(dmB); return await notesOn(dmB, mTv) === 'A: при двух картах'; }, 30000, 300);
  rig.check(!!otherIn, 'E: a change for a map in no column did not land while Two maps was on');
  rig.check(await notesOn(dmB, mCol1) === '' && await notesOn(dmB, mCol2) === '', 'E: a column\'s map changed under it');
  const cols = await dmB.evaluate(`({ on: panesActive, n: livePanes().length, marks: livePanes().map(id => panes[id].frame.contentWindow.__rigMark === id), switches: window.__switches })`);
  rig.check(cols.on && cols.n === 2 && cols.marks.every(Boolean), 'E: Two maps did not stay on, or a column reloaded: ' + q(cols));
  await dmB.evaluate('exitPanes()', 60000);
  const colsIn = await lib.poll(async () => {
    await tick(dmB);
    return await notesOn(dmB, mCol1) === 'A: колонка 1' && await notesOn(dmB, mCol2) === 'A: колонка 2';
  }, 30000, 300);
  rig.check(!!colsIn, 'E: the columns\' changes did not land once Two maps was off: ' + await status());

  // F
  const open = await dmB.evaluate('currentScene && currentScene.id');
  const victim = ids.find(id => id !== open && id !== mTv);
  const target = ids.find(id => id !== open && id !== victim && id !== mTv);
  // The delete comes first, so nothing A sends can have landed before it; its 4 s commit timer is stopped so the
  // two apps' syncs fit inside the undo window on a slow machine.
  await dmB.evaluate(`deleteScenesWithUndo([${q(victim)}]); clearTimeout(smUndoTimer); 0`);
  await editA(target, 'A: во время удаления');
  await tick(dmA);
  const during = await dmB.evaluate(`(async () => {
    await syncEngine.now();
    const toast = document.getElementById('scene-undo-toast');
    const out = { pending: !!smPending, toast: !!toast && toast.style.display !== 'none' && toast.getClientRects().length > 0,
      notes: (await sceneStore.loadScene(${q(target)})).notes || '', waiting: syncEngine.pending() };
    undoDelete();
    return out;
  })()`, 30000);
  rig.check(during.pending && during.toast, 'F: a sync took away the pending delete or its undo toast: ' + q(during));
  rig.check(during.notes !== 'A: во время удаления', 'F: a change landed while a delete could still be undone: ' + q(during));
  const afterUndo = await lib.poll(async () => { await tick(dmB); return await notesOn(dmB, target) === 'A: во время удаления'; }, 30000, 300);
  rig.check(!!afterUndo, 'F: the change that waited did not land after the undo');
  rig.check(await dmB.evaluate(`allScenes.some(s => s.id === ${q(victim)})`), 'F: the undo did not bring the map back');
};
