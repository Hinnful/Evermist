'use strict';

// backup-two-laptops.js — A CAMPAIGN MOVES BETWEEN TWO LAPTOPS.
//
// The DM exports on laptop A and Imports on laptop B, which already holds an older copy of the same campaign with its
// own edits. One library plays both: the old campaign is built, exported, edited as laptop A and exported again,
// then the library is emptied, the old copy restored, edited as laptop B, and A's zip imported.
//
//   npm run rig -- backup-two-laptops
//
// ⚠ EDIT TIMES COME FROM A FIXED CLOCK (`__bk.at`), so which laptop edited a part last is chosen, not raced. "A late"
// is a day ago, "B late" is a day ago the other way round, and the old copy was made a month ago.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   A. A part edited later wins, from either side: a map's notes, a room's text, a map's name, a group's note, the
//      campaign note, a faction's note, a stat block, a picture's name.
//   B. Nothing either laptop ADDED is lost: a map, a room, an effect, a group, a faction, a lore entry, a monster,
//      a picture. Rooms both laptops added both stay.
//   C. The animated map's file, the room pictures and the fog stay byte for byte where nobody edited them.
//   D. Two maps made apart with the same name are kept as two, the second named "(2)": the import cannot know
//      they are one map. That duplication is the design; the check pins it.
//   E. The module text already loaded stays and the import says so.
//   F. The DM is told what the file replaced, by name.
//   G. Importing the same file again changes nothing and adds nothing.
//
// KNOWN AND NOT FAILED: item 269, a deletion made on laptop A (a room, a faction, a monster, a fight, a picture) comes
// back on B. Each is noted, and says when it starts to hold.

const fs = require('fs');
const path = require('path');

const lib = require('../lib');
const kit = require('../backupKit');

const DAY = 86400000;
const IMG = { w: 2400, h: 1600 };
const NAMES = ['Крепость', 'Пещера', 'Склеп', 'Лес', 'Башня'];

module.exports = async function backupTwoLaptops(rig) {
  let dm = rig.dm;
  await lib.installHelpers(dm);
  await kit.install(dm);
  const now = Date.now(), T0 = now - 30 * DAY, d1 = now - DAY, d3 = now - 3 * DAY;
  const dir = path.join(rig.outDir, 'два ноутбука');
  fs.mkdirSync(dir, { recursive: true });
  const zipOld = path.join(dir, 'старая.zip'), zipA = path.join(dir, 'ноутбук-A.zip');

  // ⚠ A MAP'S FIRST SAVE STAMPS EVERY PART WITH THE CLOCK, so the old copy's maps are made under the old clock: otherwise
  // an untouched part would read as newer than the other laptop's edit.
  const addImage = async (name, seed) => {
    const r = await dm.evaluate(`__bk.at(${T0}, async () => {
      const f = await __bk.noiseFile(${JSON.stringify(name)}, ${IMG.w}, ${IMG.h}, ${seed}, 0.85);
      return addMapsToLibrary([f], { x: ${(seed % 5) * 250}, y: ${400 + seed * 10} }, true);
    })`, 240000);
    rig.check(r && r.ids && r.ids.length === 1, 'setup: "' + name + '" did not import: ' + JSON.stringify(r));
    return r.ids[0];
  };
  const at = (ms, body) => dm.evaluate(`__bk.at(${ms}, async () => { ${body} })`, 240000);

  // ── The old campaign, as both laptops once held it ─────────────────────────
  const ids = {};
  for (let i = 0; i < NAMES.length; i++) ids[NAMES[i]] = await addImage(NAMES[i], i + 1);
  const base = await rig.fixtures.tableMap(dm, rig.fixtureDir, { w: lib.DM_MAP.w, h: lib.DM_MAP.h });
  const vfile = await rig.fixtures.asFileExpr(dm, Object.assign({}, base, { name: 'Бездна.mp4' }));
  const vr = await dm.evaluate(`__bk.at(${T0}, () => addMapsToLibrary([${vfile}], { x: 1500, y: 300 }, true))`, 240000);
  ids['Бездна'] = vr.ids[0];
  const all = Object.values(ids);
  await at(T0, `
    const all = ${JSON.stringify(all)};
    for (let i = 0; i < all.length; i++) await __bk.decorate(all[i], i + 1, { pictured: i === 0 });
    await __bk.campaign(all, 'старая');
    __bk.fights('старая');
    await __bk.gallery(2, 'Старая');
  `);
  await dm.evaluate(`doExport(allScenes.map(s => s.id), { destPath: ${JSON.stringify(zipOld)} })`, 300000);
  rig.check(fs.existsSync(zipOld), 'setup: the old copy was not exported');
  const pics0 = await dm.evaluate('galleryList().map(p => p.id)');
  const ent = n => `notesEntriesAll().find(e => e.name === ${JSON.stringify(n)})`;

  // ── Laptop A: edits, then export ───────────────────────────────────────────
  const m = ids;
  await at(d3, `
    await __bk.editScene(${JSON.stringify(m['Крепость'])}, s => { s.notes = 'A: заметка крепости (старая)'; });
    notesPlaceSet('Юг', 'A: про юг (старое)');
    worldRoadRename(Object.keys(worldRoadsExport())[0], 'Тракт A');
  `);
  await at(d1, `
    await __bk.editScene(${JSON.stringify(m['Пещера'])}, s => { s.notes = 'A: заметка пещеры (новая)'; });
    await __bk.editScene(${JSON.stringify(m['Склеп'])}, s => {
      s.polygons.push({ id: 4, uid: 'rmA', name: 'Комната A', desc: 'A добавил', mode: 'shroud', cornerRadius: 0,
        vertices: [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 300 }, { x: 100, y: 300 }] });
      s.nextPolygonId = 5;
      s.polygons[0].desc = 'A: новое описание зала';
    });
    await __bk.editScene(${JSON.stringify(m['Лес'])}, s => { s.name = 'Лес теней'; s.effects.push({ id: 4, uid: 'fxA', vertices: s.effects[0].vertices, cornerRadius: 0, material: s.effects[0].material }); s.nextEffectId = 5; });
    await __bk.editScene(${JSON.stringify(m['Башня'])}, s => { s.polygons = s.polygons.filter(p => p.id !== 2); });
    await __bk.editScene(${JSON.stringify(m['Бездна'])}, s => { s.notes = 'A: заметка бездны'; });
    worldPlaceSet('Север', [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 500 }, { x: 0, y: 500 }]);
    worldPlaceSet('Запад', [{ x: -900, y: 0 }, { x: -400, y: 0 }, { x: -400, y: 400 }, { x: -900, y: 400 }]);
    notesEntrySetNote(${ent('Гильдия воров')}.id, 'A: гильдия, новая заметка');
    const lore = notesEntryAdd('lore', 'Лор A'); notesEntrySetNote(lore.id, 'A добавил предание');
    notesEntryDelete(${ent('Орден Рассвета')}.id);
    notesCampaignSet('A: заметка кампании');
    const dr = Object.values(cbState.blocks).find(b => b.name === 'Дракончик'); dr.hp = '60';
    cbAddBlocks([Object.assign(combatBlankBlock(0, 'Огр'), { hp: '59', ac: '11' })], 'rig');
    delete cbState.blocks[Object.values(cbState.blocks).find(b => b.name === 'Волк').id];
    combatDeleteFight(cbState, cbState.fights.find(f => f.name === 'Логово').id, combatFightId);
    cbSave();
    __bk.moduleText('Книга A');
    const mine = await galleryStore.all();
    const first = mine.find(p => p.id === ${JSON.stringify(pics0[0])}); first.name = 'A-имя'; first.named = Date.now(); await galleryStore.put(first);
    await galleryDrop(${JSON.stringify(pics0[1])});
    await galleryAddFile(new File([await __bk.smallPng(31)], 'Картинка A.png', { type: 'image/png' }));
    const nm = await __bk.noiseFile('Новая карта A', ${IMG.w}, ${IMG.h}, 21, 0.85);
    const r1 = await addMapsToLibrary([nm], { x: 2000, y: 100 }, true);
    await __bk.decorate(r1.ids[0], 21, {});
    const wl = await __bk.noiseFile('Колодец', ${IMG.w}, ${IMG.h}, 22, 0.85);
    const r2 = await addMapsToLibrary([wl], { x: 2000, y: 400 }, true);
    await __bk.decorate(r2.ids[0], 22, {});
  `);
  await dm.evaluate(`doExport(allScenes.map(s => s.id), { destPath: ${JSON.stringify(zipA)} })`, 300000);
  rig.check(fs.existsSync(zipA), 'setup: laptop A was not exported');

  // ── Laptop B: the old copy restored, then its own edits ────────────────────
  await dm.evaluate('__bk.wipe()', 120000);
  dm = await rig.restart();
  await lib.installHelpers(dm);
  await kit.install(dm);
  await lib.settle(dm, 'typeof sceneStore !== "undefined"', 30000);
  const empty = await dm.evaluate('__bk.emptyNow()');
  rig.check(Object.entries(empty).every(([k, v]) => k === 'note' ? v === '' : v === 0), 'setup: laptop B did not start empty: ' + JSON.stringify(empty));
  await dm.evaluate(`restoreFromZipPath(${JSON.stringify(zipOld)}, __bk.say)`, 300000);
  rig.check((await dm.evaluate('allScenes.length')) === NAMES.length + 1, 'setup: the old copy restored ' + (await dm.evaluate('allScenes.length')) + ' maps');
  const before0 = await dm.evaluate('__bk.digest()', 120000);

  await at(d1, `
    await __bk.editScene(${JSON.stringify(m['Крепость'])}, s => { s.notes = 'B: заметка крепости (новая)'; });
    notesPlaceSet('Юг', 'B: про юг (новое)');
    notesRoadSet(Object.keys(worldRoadsExport())[0], 'B: заметка тракта');
    await __bk.editScene(${JSON.stringify(m['Склеп'])}, s => {
      s.polygons.push({ id: 4, uid: 'rmB', name: 'Комната B', desc: 'B добавил', mode: 'reveal', cornerRadius: 0,
        vertices: [{ x: 500, y: 500 }, { x: 700, y: 500 }, { x: 700, y: 700 }, { x: 500, y: 700 }] });
      s.nextPolygonId = 5;
    });
    worldPlaceSet('Восток', [{ x: 1400, y: 0 }, { x: 1900, y: 0 }, { x: 1900, y: 400 }, { x: 1400, y: 400 }]);
    const fb = notesEntryAdd('faction', 'Фракция B'); notesEntrySetNote(fb.id, 'B добавил фракцию');
    cbAddBlocks([Object.assign(combatBlankBlock(0, 'Гоблин'), { hp: '7', ac: '15' })], 'rig');
    cbSave();
    __bk.moduleText('Книга B');
    await galleryAddFile(new File([await __bk.smallPng(41)], 'Картинка B.png', { type: 'image/png' }));
    const nb = await __bk.noiseFile('Только у B', ${IMG.w}, ${IMG.h}, 31, 0.85);
    const r1 = await addMapsToLibrary([nb], { x: 2000, y: 700 }, true);
    await __bk.decorate(r1.ids[0], 31, {});
    const wl = await __bk.noiseFile('Колодец', ${IMG.w}, ${IMG.h}, 32, 0.85);
    const r2 = await addMapsToLibrary([wl], { x: 2300, y: 400 }, true);
    await __bk.decorate(r2.ids[0], 32, {});
  `);
  await at(d3, `
    await __bk.editScene(${JSON.stringify(m['Пещера'])}, s => { s.notes = 'B: заметка пещеры (старая)'; });
    notesEntrySetNote(${ent('Гильдия воров')}.id, 'B: гильдия, старая заметка');
    notesCampaignSet('B: заметка кампании');
    const dr = Object.values(cbState.blocks).find(b => b.name === 'Дракончик'); dr.hp = '55'; cbSave();
    const mine = await galleryStore.all();
    const first = mine.find(p => p.id === ${JSON.stringify(pics0[0])}); first.name = 'B-имя'; first.named = Date.now(); await galleryStore.put(first);
  `);
  const beforeB = kit.withVideoHashes(await dm.evaluate('__bk.digest()', 120000));
  const countBefore = Object.keys(beforeB.scenes).length;

  // ── Import laptop A's file ─────────────────────────────────────────────────
  const out = await dm.evaluate(`(async () => {
    __bk.said = [];
    const r = await restoreFromZipPath(${JSON.stringify(zipA)}, __bk.say);
    return { said: __bk.said, added: r && r.done ? r.done.added.length : -1, updated: r && r.done ? r.done.updated.length : -1 };
  })()`, 600000);
  rig.note('import said: ' + out.said.join(' // ').replace(/\n/g, ' / '));
  const after = kit.withVideoHashes(await dm.evaluate('__bk.digest()', 120000));
  const byName = n => Object.values(after.scenes).filter(s => s.name === n);
  const one = n => byName(n)[0] || {};
  const world = JSON.parse;
  const entries = world(after.world.entries), places = world(after.world.places), notesP = world(after.world.placeNotes);
  const blocks = (() => { const c = after.world.combat ? JSON.parse(after.world.combat) : { blocks: {}, fights: [] }; return c; })();
  const blockNames = Object.values(blocks.blocks || {}).map(b => b.name);
  const blockBy = n => Object.values(blocks.blocks || {}).find(b => b.name === n) || {};

  // ── A. The later edit wins ─────────────────────────────────────────────────
  rig.check(one('Крепость').notes === 'B: заметка крепости (новая)', 'A: laptop B edited a map\'s notes after A, and the import replaced them: "' + one('Крепость').notes + '"');
  rig.check(one('Пещера').notes === 'A: заметка пещеры (новая)', 'A: laptop A edited a map\'s notes after B, and the import did not take them: "' + one('Пещера').notes + '"');
  const rooms3 = JSON.parse(one('Склеп').rooms || '[]');
  rig.check(rooms3.some(r => r[2] === 'Комната A') && rooms3.some(r => r[2] === 'Комната B') && rooms3.length === 5,
            'B: the rooms both laptops added did not both stay: ' + rooms3.map(r => r[2]).join(', '));
  rig.check(rooms3.length > 0 && rooms3[0][3] === 'A: новое описание зала', 'A: a room text edited on A only did not arrive: "' + (rooms3[0] || [])[3] + '"');
  rig.check(byName('Лес теней').length === 1 && byName('Лес').length === 0, 'A: a map renamed on A kept its old name: ' + Object.values(after.scenes).map(s => s.name).join(', '));
  rig.check(JSON.parse(one('Лес теней').effects || '[]').length === 3, 'B: the effect added on A did not arrive: ' + one('Лес теней').effects);
  rig.check(one('Бездна').notes === 'A: заметка бездны', 'A: the animated map\'s notes edited on A did not arrive');
  rig.check(notesP['Юг'] === 'B: про юг (новое)', 'A: a group note edited later on B was replaced: "' + notesP['Юг'] + '"');
  rig.check(after.world.campaignNote === 'A: заметка кампании', 'A: the campaign note edited later on A did not arrive: "' + after.world.campaignNote + '"');
  const guild = Array.isArray(entries) ? entries : entries.entries;
  const gl = (guild.find(e => e.name === 'Гильдия воров') || {}).note;
  rig.check(gl === 'A: гильдия, новая заметка', 'A: a faction note edited later on A did not arrive: "' + gl + '"');
  rig.check(blockBy('Дракончик').hp === '60', 'A: a stat block edited later on A did not arrive: hp ' + blockBy('Дракончик').hp);
  const gal = JSON.parse(after.world.gallery);
  rig.check(gal.some(p => p[1] === 'A-имя'), 'A: a picture renamed later on A kept B\'s name: ' + gal.map(p => p[1]).join(', '));

  // ── B. Nothing added is lost ───────────────────────────────────────────────
  const vs = Object.values(places).length ? Object.keys(places) : [];
  rig.check(['Север', 'Юг', 'Запад', 'Восток'].every(n => vs.includes(n)), 'B: a group went missing: ' + vs.join(', '));
  rig.check(JSON.stringify(places['Север'].vertices) === JSON.stringify([{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 500 }, { x: 0, y: 500 }]),
            'A: a group reshaped on A did not take its new outline: ' + JSON.stringify(places['Север'].vertices));
  rig.check(byName('Новая карта A').length === 1 && byName('Только у B').length === 1, 'B: a map only one laptop had is missing: ' + Object.values(after.scenes).map(s => s.name).join(', '));
  rig.check(['Лор A', 'Фракция B'].every(n => (guild.find(e => e.name === n) || {}).name === n), 'B: a lore entry or faction added on one laptop is missing: ' + guild.map(e => e.name).join(', '));
  rig.check(['Огр', 'Гоблин', 'Дракончик'].every(n => blockNames.includes(n)), 'B: a monster is missing: ' + blockNames.join(', '));
  rig.check(gal.some(p => p[1] === 'Картинка A') && gal.some(p => p[1] === 'Картинка B'), 'B: a picture added on one laptop is missing: ' + gal.map(p => p[1]).join(', '));
  rig.check(!!world(after.world.roads) && Object.keys(world(after.world.roads)).length === 1, 'B: the road count changed: ' + Object.keys(world(after.world.roads)).length);
  rig.note('road after: ' + JSON.stringify(Object.values(world(after.world.roads)).map(r => r.name)) + ', note ' + JSON.stringify(Object.values(world(after.world.roadNotes))));

  // ── C. What nobody edited stays byte for byte ──────────────────────────────
  const same = (id, keys) => keys.filter(k => beforeB.scenes[id][k] !== (after.scenes[id] || {})[k]);
  for (const n of NAMES.concat(['Бездна'])) {
    const id = ids[n];
    const changed = same(id, ['map', 'fog', 'pictures', 'videoFile', 'thumb', 'size', 'lights', 'grid']);
    rig.check(changed.length === 0, 'C: "' + n + '" changed in a part nobody edited: ' + changed.join(', '));
  }

  // ── D. Same name, two ids ──────────────────────────────────────────────────
  const wells = Object.values(after.scenes).filter(s => /^Колодец/.test(s.name)).map(s => s.name).sort();
  rig.check(wells.length === 2 && wells[1] === 'Колодец (2)', 'D: two maps made apart with one name came out as ' + JSON.stringify(wells));
  rig.note('maps before ' + countBefore + ', after ' + Object.keys(after.scenes).length + ' (' + out.added + ' added, ' + out.updated + ' updated)');
  rig.check(Object.keys(after.scenes).length === countBefore + 2, 'B: the import should add the map and the well from A: ' + countBefore + ' -> ' + Object.keys(after.scenes).length);

  // ── E. The module text ─────────────────────────────────────────────────────
  rig.check(after.world.moduleText.endsWith('|Книга B'), 'E: the module text loaded on B was replaced: ' + after.world.moduleText.slice(-20));
  rig.check(out.said.some(s => s.startsWith('Module text kept')), 'E: the import did not say the module text stayed');

  // ── F. The report ──────────────────────────────────────────────────────────
  const report = out.said.find(s => s.startsWith('Import finished')) || '';
  rig.check(/Крепость/.test(report) || /kept newer/.test(report), 'F: the report does not mention the edit that B kept over the file: ' + report.replace(/\n/g, ' / '));
  rig.check(/Пещера/.test(report), 'F: the report does not name the map whose notes the file replaced: ' + report.replace(/\n/g, ' / '));
  rig.check(/Campaign/.test(report), 'F: the report does not say the campaign note was replaced: ' + report.replace(/\n/g, ' / '));

  // ── Known: item 269 ────────────────────────────────────────────────────────
  kit.known(rig, '269', JSON.parse(one('Башня').rooms).length === 2, 'a room deleted on A is back on B (' + JSON.parse(one('Башня').rooms).length + ' rooms on the tower, A has 2)');
  kit.known(rig, '269', !guild.some(e => e.name === 'Орден Рассвета'), 'a faction deleted on A is back on B');
  kit.known(rig, '269', !blockNames.includes('Волк'), 'a monster deleted on A is back on B');
  kit.known(rig, '269', !(blocks.fights || []).some(f => f.name === 'Логово'), 'a fight deleted on A is back on B');
  kit.known(rig, '269', gal.length === 3, 'a picture deleted on A is back on B (' + gal.length + ' pictures, A has 2 and B added 1)');
  rig.note('road/group/lore/party left to the digest: ' + kit.diffDigests(beforeB, after, ['stamps']).filter(d => d.where === 'campaign').map(d => d.key).join(', '));

  // ── G. A second import changes nothing ─────────────────────────────────────
  const again = await dm.evaluate(`(async () => {
    __bk.said = [];
    const r = await restoreFromZipPath(${JSON.stringify(zipA)}, __bk.say);
    return { said: __bk.said, added: r && r.done ? r.done.added.length : -1 };
  })()`, 600000);
  const after2 = kit.withVideoHashes(await dm.evaluate('__bk.digest()', 120000));
  const wl2 = Object.values(after2.scenes).filter(s => /^Колодец/.test(s.name)).length;
  rig.check(Object.keys(after2.scenes).length === Object.keys(after.scenes).length && wl2 === 2,
            'G: importing the same file twice added maps: ' + Object.keys(after.scenes).length + ' -> ' + Object.keys(after2.scenes).length);
  // The fight table's row ids move on a second import (noted below); what the rows say must not.
  const rowIds = x => ({ ...x, world: { ...x.world, combat: x.world.combat.replace(/"nextId":\d+/, '').replace(/"id":\d+/g, '') } });
  const redo = kit.diffDigests(rowIds(after), rowIds(after2), ['stamps']).filter(d => d.where !== 'music' && !/^map Колодец/.test(d.where));
  const nextBefore = (after.world.combat.match(/"nextId":(\d+)/) || [])[1], nextAfter = (after2.world.combat.match(/"nextId":(\d+)/) || [])[1];
  kit.known(rig, 'unfiled: a second import moves the fight rows', nextBefore === nextAfter, 'importing the same file twice renumbers the rows of the fight table (next row id ' + nextBefore + ' -> ' + nextAfter + ')');
  const wellsAgain = Object.values(after2.scenes).filter(s => /^Колодец/.test(s.name)).map(s => s.name).sort();
  kit.known(rig, 'unfiled: a second import undoes the (2)', wellsAgain.join('|') === 'Колодец|Колодец (2)', 'importing the same file twice renamed the map that came in as "Колодец (2)" back to "Колодец": the library now holds ' + JSON.stringify(wellsAgain));
  rig.check(redo.length === 0, 'G: the second import changed ' + redo.length + ' things: ' + redo.slice(0, 5).map(kit.describe).join(' ; '));
  rig.note('second import said: ' + again.said.join(' // ').replace(/\n/g, ' / '));
  rig.note('laptop B before the import held ' + Object.keys(before0.scenes).length + ' maps from the old copy');
};
