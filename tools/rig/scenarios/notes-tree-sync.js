'use strict';

// notes-tree-sync.js - THE NOTES TREE'S ORDER AND GROUPS TRAVEL (spec notes-tree, DoD 10).
//
// The map "Замок" holds "Зал", "Кухня", an unnamed room and "Без", a room stored with no uid (Claude's first order of
// the map gives it one in the store); on B it gains "Новая", stored with no uid. "Лес" and "Луг" are two more maps; "Волк", "Гоблин" and "Дракон" are monsters with a note. Orders are set through Claude's set_notes_order,
// the drags themselves being notes-tree.js's. One library plays both ends of a backup, then two apps share a fake Drive.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//  12.  Claude's set_notes_order makes a Notes group of the rooms it names, in the order it names them, where the first
//       of them stands.
//  10a. The rooms' order and Notes group, the monsters' and the Campaign's survive a restart.
//  10b. They travel in Export and Import: a wiped library imports the file and shows the same order and groups.
//  10c. On a fake Drive, A reorders the monsters and B, holding "Замок" in a two-map column, reorders its rooms with
//       "Новая" first, and the column saves its whole record; after a sync both computers show A's monsters and B's
//       rooms, and B's stored "Замок" keeps its rooms' own order with "Новая" under the uid the order names.

const fs = require('fs');
const path = require('path');
const lib = require('../lib');
const kit = require('../backupKit');

const q = JSON.stringify;
const box = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const ROOMS = [
  { id: 1, uid: 'uH', name: 'Зал', mode: 'shroud', cornerRadius: 0, vertices: box(100, 100, 400, 400) },
  { id: 2, uid: 'uK', name: 'Кухня', mode: 'reveal', cornerRadius: 0, vertices: box(500, 100, 800, 400) },
  { id: 3, uid: 'uA', name: '', mode: 'shroud', cornerRadius: 0, vertices: box(100, 500, 400, 700) },
  { id: 4, name: 'Без', mode: 'shroud', cornerRadius: 0, vertices: box(500, 500, 800, 700) },
];

// The order each list shows, read from a tree built as the window builds it.
const SHOWN = `(async () => {
  await searchReadScenes();
  const root = ntBuild(), flat = n => n.children.filter(c => c.kind !== 'section').map(c => c.kind === 'ngroup' ? c.name + '[' + c.children.map(m => m.name).join(',') + ']' : c.name);
  const map = root.children.find(c => c.kind === 'map' && c.name === 'Замок');
  return { rooms: map ? flat(map) : null, monsters: flat(notesTreeFind(root, 'sec:monster')), campaign: flat(root) };
})()`;

module.exports = async function notesTreeSync(rig) {
  let dm = rig.dm;
  await lib.installHelpers(dm);
  await kit.install(dm);
  const ids = await dm.evaluate(`(async () => {
    const out = {};
    for (const [i, n] of ['Замок', 'Лес', 'Луг'].entries()) {
      const f = await __bk.noiseFile(n, i ? 400 : 1000, i ? 300 : 800, i + 5, 0.8);
      out[n] = (await addMapsToLibrary([f], { x: i * 400, y: 0 }, true)).ids[0];
    }
    await __bk.editScene(out['Замок'], s => { s.polygons = ${q(ROOMS)}; s.nextPolygonId = 5; });
    for (const n of ['Волк', 'Гоблин', 'Дракон']) { const b = cbNewBlock(n); b.notes = 'заметка'; }
    cbSave();
    return out;
  })()`, 240000);
  const claude = (d, tool, args) => d.evaluate(`_mcpAnswer(${q({ tool, args })})`, 60000);
  const shown = d => d.evaluate(SHOWN, 60000);

  await lib.step(rig, '12', async () => {
    const s = await claude(dm, 'set_notes_order', { level: 'map', name: 'Замок', order: ['Зал'], groups: [{ name: 'Подвал', items: ['Без', 'Кухня'] }] });
    const got = await shown(dm);
    rig.check(!s.isError && q(got.rooms) === q(['Зал', 'Подвал[Без,Кухня]', 'Room 3']), '12: set_notes_order shows ' + q(got.rooms) + ': ' + s.text);
  });

  let want = null;
  await lib.step(rig, '10a', async () => {
    const r = await claude(dm, 'set_notes_order', { level: 'map', name: 'Замок', order: ['Кухня', 'Room 3', 'Зал'], groups: [{ name: 'Крыло', items: ['Room 3', 'Зал'] }] });
    const m = await claude(dm, 'set_notes_order', { level: 'monsters', order: ['Дракон', 'Волк'] });
    const c = await claude(dm, 'set_notes_order', { level: 'campaign', order: ['Луг', 'Замок'] });
    rig.check(!r.isError && !m.isError && !c.isError, '10a setup: the order was not set: ' + [r.text, m.text, c.text].join(' / '));
    want = await shown(dm);
    rig.check(q(want.rooms) === q(['Кухня', 'Крыло[Room 3,Зал]', 'Без']) && q(want.monsters) === q(['Дракон', 'Волк', 'Гоблин']) && want.campaign[0] === 'Луг',
      '10a setup: the tree does not show the order set: ' + q(want));
    dm = await rig.restart();
    await lib.installHelpers(dm);
    const after = await shown(dm);
    rig.check(q(after) === q(want), '10a: after a restart the tree shows ' + q(after) + ', not ' + q(want));
  });

  await lib.step(rig, '10b', async () => {
    const dir = path.join(rig.outDir, 'порядок');
    fs.mkdirSync(dir, { recursive: true });
    const zip = path.join(dir, 'заметки.zip');
    await kit.install(dm);
    await dm.evaluate(`doExport(${q(Object.values(ids))}, { destPath: ${q(zip)} })`, 300000);
    rig.check(fs.existsSync(zip), '10b setup: the file was not exported');
    await dm.evaluate('__bk.wipe()', 120000);
    dm = await rig.restart();
    await lib.installHelpers(dm);
    await kit.install(dm);
    rig.check(await dm.evaluate(`allScenes.length === 0 && localStorage.getItem('evermist.notesOrder') === null`), '10b setup: the wipe left a library');
    await dm.evaluate(`restoreFromZipPath(${q(zip)}, __bk.say)`, 300000);
    const got = await shown(dm);
    rig.check(q(got) === q(want), '10b: after Import the tree shows ' + q(got) + ', not ' + q(want));
  });

  const drive = await rig.fakeDrive();
  const b = await rig.second('b');
  rig.writeSyncConfig(rig.profileDir, drive);
  rig.writeSyncConfig(b.profileDir, drive);
  const dmA = await rig.restart();
  const dmB = await b.restart();
  for (const d of [dmA, dmB]) { await lib.installHelpers(d); await lib.settle(d, 'typeof syncEngine !== "undefined" && syncEngine.status().state !== "off"', 60000); }
  const tick = d => d.evaluate('syncEngine.now()', 60000);

  await lib.step(rig, '10c', async () => {
    const landed = await lib.poll(async () => { await tick(dmA); await tick(dmB); const s = await shown(dmB); return s.rooms && q(s.rooms) === q(want.rooms) ? s : null; }, 120000, 500);
    rig.check(!!landed, '10c setup: B did not get the library with its order: ' + q(await shown(dmB)));

    const ma = await claude(dmA, 'set_notes_order', { level: 'monsters', order: ['Гоблин', 'Дракон', 'Волк'] });
    rig.check(!ma.isError, '10c setup: A\'s monster order failed: ' + ma.text);
    await kit.install(dmB);
    await dmB.evaluate(`__bk.editScene(${q(ids['Замок'])}, s => { s.polygons.push(${q({ id: 5, name: 'Новая', mode: 'shroud', cornerRadius: 0, vertices: box(850, 100, 950, 300) })}); s.nextPolygonId = 6; })`, 30000);
    await dmB.evaluate(`enterPanes(${q(ids['Замок'])}, ${q(ids['Лес'])})`, 60000);
    await lib.settle(dmB, 'panesActive && livePanes().length === 2 && livePanes().every(id => panes[id].ready)', 60000);
    await lib.poll(async () => (await dmB.evaluate(`(async () => { await searchReadScenes(); return (searchRoomsOf(${q(ids['Замок'])}) || []).some(r => r.name === 'Новая'); })()`, 30000)) || null, 20000, 300);
    const noUid = await dmB.evaluate(`((searchRoomsOf(${q(ids['Замок'])}) || []).find(r => r.name === 'Новая') || {}).uid === ''`);
    rig.note('10c: "Новая" reached the tree ' + (noUid ? 'with no uid, so its column was asked for one' : 'with a uid already: the column saved first'));
    const rb = await claude(dmB, 'set_notes_order', { level: 'map', name: 'Замок', order: ['Новая', 'Кухня'] });
    rig.check(!rb.isError, '10c setup: B\'s room order failed: ' + rb.text);
    const col = await dmB.evaluate(`paneColumnOf(${q(ids['Замок'])})`);
    const key = await dmB.evaluate(`notesOrderFlat(notesOrderGet(${q('map:' + ids['Замок'])}))[0]`);
    const uid = String(key).split(':')[1];
    await lib.settle(dmB, `panes[${q(col)}].frame.contentWindow.eval('polygons.find(p => p.name === "Новая").uid') === ${q(uid)}`, 10000);
    await dmB.evaluate(`flushPaneScene(${q(col)})`, 60000);
    const rec = await dmB.evaluate(`sceneStore.loadScene(${q(ids['Замок'])}).then(r => r.polygons.map(p => [p.name, p.uid || '']))`, 20000);
    rig.check(q(rec.map(r => r[0])) === q(['Зал', 'Кухня', '', 'Без', 'Новая']) && rec[4][1] === uid && rec.every(r => r[1]),
      '10c: the column\'s save holds ' + q(rec) + ', not its own room order with "Новая" under ' + uid);
    const wantB = await shown(dmB);
    rig.check(wantB.rooms[0] === 'Новая' && wantB.rooms[1] === 'Кухня', '10c: after the column saved, B shows ' + q(wantB.rooms));
    const both = await lib.poll(async () => {
      await tick(dmA); await tick(dmB); await tick(dmA);
      const a = await shown(dmA), bb = await shown(dmB);
      return q(a.monsters) === q(['Гоблин', 'Дракон', 'Волк']) && q(bb.monsters) === q(a.monsters) && q(a.rooms) === q(wantB.rooms) && q(bb.rooms) === q(wantB.rooms) ? { a, bb } : null;
    }, 120000, 500);
    rig.check(!!both, '10c: the two lists did not both survive: A ' + q(await shown(dmA)) + ', B ' + q(await shown(dmB)));
  });
};
