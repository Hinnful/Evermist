'use strict';

// claude-import.js — CLAUDE LOADS A MODULE'S TEXT, LINKS ROOMS TO IT, AND MERGES AN EXPORT ZIP.
//
// THE GOAL: Claude's import tools (src/mcp/mcpImport.js and src/mcp/mcpImportPlan.js: load_module_text, list_module_entries, link_room,
// import_maps_zip) go through the app's own import paths, each call is one step undo_last_change takes back, and an
// import asks before it changes anything. Module text and the library are the DM's, not the TV's, so the Player has no part.
//
//   A. load_module_text loads a text module, and list_module_entries lists its entries by heading.
//   B. link_room gives a room an entry's heading as its name and its text as notes.
//   C. undo_last_change puts the room's name and notes back, and undoing the load clears the module text.
//   D. import_maps_zip without confirmed only says what would be added; nothing changes. (The zip holds three maps:
//      the one the module tests used, Zip A and Zip B; all three are deleted before the import so none is "updated".)
//   E. With confirmed it brings the maps back and merges the campaign note.
//   F. undo_last_change takes the maps away again and puts the campaign note back, and the map left open is untouched.
//
// ⚠ NOT DRIVEN: load_floor_plan (floor-plan.js and claude-floor-plan.js own it) and import_maps_zip's refusals.
// ⚠ THE MODULE TEXT IS SYNTHETIC, WRITTEN INTO THE RUN'S OUTPUT FOLDER. THE ZIP IS THE APP'S OWN EXPORT: doExport with its
// destPath, the way transfer.js writes one, because the native save dialog cannot be driven.

const fs = require('fs');
const path = require('path');
const lib = require('../../lib');

const MODULE = [
  'K1. The Gatehouse',
  'Two guards stand here, bored and cold. They have not been paid in a month and will talk',
  'for coin.',
  '',
  'K2. The Long Hall',
  'Banners hang from the rafters, each one from a house that no longer exists.',
  '',
  'K3. The Chapel',
  'A font of black water sits at the far end. Drinking from it is a very bad idea, and the',
  'acolytes will not say why.',
].join('\n');

module.exports = async function claudeImport(rig) {
  const dm = rig.dm;
  const ev = (expr, ms) => dm.evaluate(expr, ms || 120000);
  await lib.openMap(rig, { w: 1200, h: 800 });
  const sceneName = await ev('currentScene.name');
  const firstId = await ev('currentScene.id');
  const call = await lib.mcpClient(rig);
  rig.check(!!call, 'the app wrote no mcp.json with a port and a key into its profile');
  if (!call) return;

  // ── A ──
  // RED BY DESIGN: written against the feature, never re-proved
  const modFile = path.join(rig.outDir, 'rig-module.txt');
  fs.writeFileSync(modFile, MODULE);
  const loaded = await call('load_module_text', { path: modFile });
  const listed = await call('list_module_entries', {});
  let entries = [];
  try { entries = JSON.parse(listed.text).entries.map(e => e.heading); } catch { entries = []; }
  rig.check(!loaded.isError && await ev('mtEntries.length') === 3 && entries.length === 3 && entries.some(h => /Chapel/.test(h)),
            'A: load_module_text and list_module_entries did not load and list the three entries: ' + JSON.stringify({ loaded, entries }));

  // ── B ──
  // RED BY DESIGN: written against the feature, never re-proved
  const room = await call('create_room', { name: sceneName, room: 'Hall', outline: [[10, 10], [30, 10], [30, 30], [10, 30]] });
  const roomNow = () => ev('({ name: polygons[0] && polygons[0].name, desc: polygons[0] && (polygons[0].desc || "") })');
  rig.check(!room.isError && (await roomNow()).name === 'Hall', 'B: the room the link tests start from was not drawn: ' + JSON.stringify(room));
  const link = await call('link_room', { name: sceneName, links: [{ room: 'Hall', heading: 'K3' }] });
  const linked = await roomNow();
  rig.check(!link.isError && /Chapel/.test(linked.name) && /black water/.test(linked.desc),
            'B: link_room did not give the room the Chapel heading and text: ' + JSON.stringify({ link, linked }));

  // ── C ──
  // RED BY DESIGN: written against the feature, never re-proved
  const undoneLink = await call('undo_last_change');
  const unlinked = await roomNow();
  rig.check(!undoneLink.isError && unlinked.name === 'Hall' && !/black water/.test(unlinked.desc), 'C: undo_last_change did not put the room\'s name and notes back: ' + JSON.stringify({ undoneLink, unlinked }));
  await call('undo_last_change');
  const undoneLoad = await call('undo_last_change');
  rig.check(!undoneLoad.isError && await ev('mtEntries.length') === 0, 'C: undo_last_change did not clear the loaded module text: ' + JSON.stringify(undoneLoad));

  // ── The library the zip is made from: two maps and a campaign note, exported, then both maps gone and the note changed ──
  const nameOf = async n => {
    await lib.openMap(rig, { w: 1000, h: 700 });
    const id = await ev('currentScene.id');
    await ev('renameScene(' + JSON.stringify(id) + ', ' + JSON.stringify(n) + '); 0');
    return id;
  };
  const idA = await nameOf('Zip A'), idB = await nameOf('Zip B');
  await ev('notesCampaignSet("Home note."); 0');
  const zip = path.join(rig.outDir, 'rig-export.zip');
  await ev('doExport(allScenes.map(s => s.id), { destPath: ' + JSON.stringify(zip) + ' })', 300000);
  rig.check(fs.existsSync(zip) && fs.statSync(zip).size > 0, 'doExport produced no zip at ' + zip + ', so nothing below is about an import');
  await lib.openMap(rig, { w: 900, h: 600 });
  const keptId = await ev('currentScene.id');
  await ev('renameScene(' + JSON.stringify(keptId) + ', "Zip Kept"); 0');
  await ev(`(async () => {
    const ids = [${JSON.stringify(firstId)}, ${JSON.stringify(idA)}, ${JSON.stringify(idB)}];
    deleteScenesWithUndo(ids); commitPendingDelete();
    for (const id of ids) { await sceneStore.deleteScene(id); await window.electronAPI.deleteVideoFile(id).catch(() => {}); }
    notesCampaignSet('Laptop note.');
    return 0;
  })()`, 120000);
  const names = () => ev('allScenes.map(s => s.name).sort().join()');
  rig.check(!(await names()).includes('Zip A') && !(await names()).includes('Zip B') && (await names()).includes('Zip Kept'),
            'the laptop library was not prepared (every map but Zip Kept gone), so nothing below is about an import: ' + await names());

  // ── D ──
  // RED BY DESIGN: written against the feature, never re-proved
  const preview = await call('import_maps_zip', { path: zip });
  rig.check(!preview.isError && /Nothing changed yet/.test(preview.text) && /Zip A/.test(preview.text) && /Zip B/.test(preview.text)
            && !(await names()).includes('Zip A') && await ev('notesCampaignGet()') === 'Laptop note.',
            'D: import_maps_zip without confirmed changed something or did not say what would be added: ' + JSON.stringify(preview));

  // ── E ──
  // RED BY DESIGN: written against the feature, never re-proved
  const done = await call('import_maps_zip', { path: zip, confirmed: true });
  rig.check(!done.isError && (await names()).includes('Zip A') && (await names()).includes('Zip B') && /Home note\./.test(await ev('notesCampaignGet()')),
            'E: import_maps_zip with confirmed did not bring Zip A and Zip B back and merge the note: ' + JSON.stringify({ done, names: await names(), note: await ev('notesCampaignGet()') }));

  // ── F ──
  // RED BY DESIGN: written against the feature, never re-proved
  const undone = await call('undo_last_change');
  rig.check(!undone.isError && !(await names()).includes('Zip A') && !(await names()).includes('Zip B') && (await names()).includes('Zip Kept')
            && await ev('notesCampaignGet()') === 'Laptop note.' && await ev('currentScene.id') === keptId,
            'F: undo_last_change did not take the imported maps away, put the note back and leave the open map alone: ' + JSON.stringify({ undone, names: await names(), note: await ev('notesCampaignGet()') }));
};
