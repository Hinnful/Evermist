'use strict';

// gallery.js — THE GALLERY, THE ONLY SOURCE OF PICTURES.
//
// THE GOAL OF THIS FEATURE: the DM keeps portraits, monsters and letters in one place, tied to no
// room, finds one by name, and one click puts it on the TV over the dimmed map. A room holds no
// pictures any more, and the ones rooms used to hold are in the gallery on the first launch.
//
//   A. Pictures are added by the "+" or by a drop on the pane: named from the file without its
//      extension, shrunk to the Compression size, JPEG unless they have transparency, and a file
//      that is not a picture is named in one dialog. A picture dropped elsewhere makes no scene.
//   B. The find field narrows the grid by name, and says so when nothing matches.
//   C. A click puts the picture on the Player window, as that window's own picture; a second
//      click, or Escape, takes it down; removing the picture that is up takes it down.
//   D. A Player that reloads gets the picture that is up.
//   E. The room card shows no picture strip and no Add a picture button.
//   F. Rename and remove (after the question) persist across the app being started again.
//   G. Rooms' pictures survive in their scenes through a save and a scene switch, untouched,
//      so the previous release still shows them.
//   H. The first launch with the gallery copies every picture any scene's room holds into it,
//      once by id and named without the extension, and leaves the scenes as they were. A picture
//      the DM removes afterwards does not come back.
//   I. A backup of the gallery restores what is missing, removes nothing, and a zip without a
//      gallery restores as it always did.
//   J. With Two maps on, a click in the DM window puts the picture over both halves of the shared
//      Player window, and Escape takes it down.
//   (The save dialog of a real backup is native and cannot be driven: byEye below.)

const lib = require('../../lib');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAP_W = 1600, MAP_H = 1000;
const FLAG = 'evermist.galleryMigrated';

const OWN_HELPERS = `
globalThis.__gaFile = (name, w, h, alpha) => new Promise(r => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (!alpha) { g.fillStyle = '#7a0f18'; g.fillRect(0, 0, w, h); }
  g.fillStyle = '#d9c9b8'; g.fillRect(w / 4, h / 4, w / 2, h / 2);
  c.toBlob(b => r(new File([b], name, { type: 'image/png' })), 'image/png');
});
globalThis.__gaPick = files => {
  const inp = document.getElementById('ga-input');
  const dt = new DataTransfer(); files.forEach(f => dt.items.add(f));
  inp.files = dt.files;
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  return 0;
};
globalThis.__gaDrop = (target, files) => {
  const dt = new DataTransfer(); files.forEach(f => dt.items.add(f));
  target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  return 0;
};
globalThis.__gaTileOf = name => Array.from(document.querySelectorAll('#ga-grid .ga-tile'))
  .find(t => t.querySelector('.ga-name').textContent === name);
globalThis.__gaNames = () => Array.from(document.querySelectorAll('#ga-grid .ga-tile .ga-name')).map(n => n.textContent);
globalThis.__gaClick = name => { __gaTileOf(name).querySelector('.ga-th').click(); return 0; };
globalThis.__gaFilter = v => {
  const f = document.getElementById('ga-filter');
  f.value = v; f.dispatchEvent(new Event('input', { bubbles: true }));
  return 0;
};
globalThis.__gaEsc = () => { document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true })); return 0; };
0`;

module.exports = async function galleryFeature(rig) {
  let dm = rig.dm;
  await lib.openMap(rig, { w: MAP_W, h: MAP_H });
  await dm.evaluate(OWN_HELPERS);
  await dm.waitFor('fogCoverT === 0', 30000, 'the scene cover to lift');
  await dm.evaluate("localStorage.setItem(MAP_COMPRESS_KEY, '1080');" +
    " polygons = [{ id: 1, vertices: [{ x: 200, y: 200 }, { x: 700, y: 200 }, { x: 700, y: 600 }," +
    " { x: 200, y: 600 }], mode: 'reveal', cornerRadius: 0, name: 'Parlour' }]; nextPolygonId = 2;" +
    ' selectedPolygonId = 1; rebuildFogFromPolygons(); refreshRoomPanel(); scheduleRender(); dockOpen("gallery"); 0');
  const sceneA = await dm.evaluate('currentScene.id');
  let tv = await rig.player();
  await dm.evaluate('sendToPlayer(); 0');
  await tv.waitFor('mapWidth > 0 && fogCoverT === 0', 30000, 'the map to reach the TV');

  const tvUp = () => tv.evaluate(`(() => { const el = document.getElementById('tv-picture');
    const img = el && Array.from(el.querySelectorAll('img')).find(i => i.getAttribute('src'));
    return { up: !!el && el.classList.contains('up'), w: img ? img.naturalWidth : 0 }; })()`);
  const waitTv = async want => lib.poll(async () => {
    const s = await tvUp().catch(() => ({ up: false, w: 0 }));
    return s.up === want ? { s } : null;
  }, 10000);
  const stored = () => dm.evaluate(`galleryStore.all().then(a =>
    a.map(p => ({ id: p.id, name: p.name, type: p.blob.type })).sort((x, y) => x.id < y.id ? -1 : 1))`);
  const flag = () => dm.evaluate('localStorage.getItem(' + JSON.stringify(FLAG) + ')');

  // The first launch ran the migration over an empty library and marked it done.
  await lib.settle(dm, 'localStorage.getItem(' + JSON.stringify(FLAG) + ') === "1"', 20000);
  rig.check(await flag() === '1', 'the first launch did not mark the migration done');

  // ── A. adding ──────────────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(await dm.evaluate("!!document.querySelector('#ga-grid.ga-empty')"), 'an empty gallery does not show its drop well');
  await dm.evaluate(`(async () => { const a = await __gaFile('portrait.png', 3000, 4000, false);
    const b = await __gaFile('token.png', 400, 400, true);
    const c = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    __gaPick([a, b, c]); return 0; })()`);
  await lib.settle(dm, '_gaPics.length === 2', 20000);
  const added = await dm.evaluate(`(async () => {
    const out = [];
    for (const p of _gaPics) {
      const bmp = await createImageBitmap(p.blob);
      out.push({ name: p.name, type: p.blob.type, w: bmp.width, h: bmp.height }); bmp.close();
    }
    return out.sort((x, y) => x.name < y.name ? -1 : 1); })()`);
  rig.note('added: ' + JSON.stringify(added));
  rig.check(added.length === 2 && added[0].name === 'portrait' && added[1].name === 'token',
            'two pictures and a text file did not add exactly two pictures named without their extension: ' + JSON.stringify(added));
  rig.check(added[0] && added[0].type === 'image/jpeg' && added[0].h === 1080 && added[0].w === 810,
            'a 3000x4000 picture was not shrunk to 1080 high as a JPEG: ' + JSON.stringify(added[0]));
  rig.check(added[1] && added[1].type === 'image/png' && added[1].w === 400,
            'a transparent picture lost its transparency or its size: ' + JSON.stringify(added[1]));
  await lib.settle(dm, "document.getElementById('cd-anchor').style.display === 'flex'", 6000);
  rig.check(await dm.evaluate("document.getElementById('cd-msg').textContent.includes('notes.txt')"),
            'the file that is not a picture was not named');
  await dm.evaluate("document.getElementById('cd-ok').click(); 0");

  const scenes0 = await dm.evaluate('allScenes.length');
  await dm.evaluate(`(async () => { const f = await __gaFile('letter.png', 600, 800, false);
    __gaDrop(document.getElementById('dock-pane-gallery'), [f]); return 0; })()`);
  await lib.settle(dm, '_gaPics.length === 3', 20000);
  rig.check(await dm.evaluate('_gaPics.length === 3'), 'a picture dropped on the pane was not added');
  await dm.evaluate(`(async () => { const f = await __gaFile('stray.png', 600, 800, false);
    __gaDrop(document.body, [f]); return 0; })()`);
  await lib.hold(1500, 'long enough for a dropped picture to have started a map import, then prove it did not');
  rig.check(await dm.evaluate('allScenes.length') === scenes0, 'a picture dropped off the pane became a scene');
  rig.check(await dm.evaluate('_gaPics.length === 3'), 'a picture dropped off the pane was added to the gallery');

  // ── B. find ────────────────────────────────────────────────────────────────
  // RED ON: `const shown = _gaPics` in place of the name filter in _gaRender (gallery.js) - 2026-10-16
  await dm.evaluate('__gaFilter("port"); 0');
  rig.check((await dm.evaluate('__gaNames()')).join() === 'portrait', 'the find field did not narrow the grid to the name: ' + await dm.evaluate('__gaNames().join()'));
  await dm.evaluate('__gaFilter("zzz"); 0');
  rig.check(await dm.evaluate("!!document.querySelector('#ga-grid .ga-none') && __gaNames().length === 0"),
            'a find with no match did not say so');
  await dm.evaluate('__gaFilter(""); 0');
  rig.check(await dm.evaluate('__gaNames().length === 3'), 'clearing the find field did not bring every picture back');

  // ── C. click, click; Escape; remove while up ───────────────────────────────
  // RED ON: the playerWindow branch of _gaSend gated off with `else if (false)` (gallery.js) - 2026-10-16
  await dm.evaluate('__gaClick("portrait"); 0');
  const shown = await waitTv(true);
  rig.check(!!shown && shown.s.w === 810, 'a click on a tile did not put that picture on the Player window: ' + JSON.stringify(shown));
  rig.check(await dm.evaluate('__gaTileOf("portrait").classList.contains("on")'), 'the tile on the TV is not marked');
  await dm.evaluate('__gaClick("portrait"); 0');
  rig.check(!!(await waitTv(false)), 'a second click did not take the picture down');
  rig.byEye('the picture sits centred over a dimmed map and comes and goes in patches of fog');

  // RED ON: galleryTakeDown gated off with `false &&` in the Escape case (input.js) - 2026-10-16
  await dm.evaluate('__gaClick("letter"); 0');
  rig.check(!!(await waitTv(true)), 'a second picture did not reach the Player window');
  await dm.evaluate('__gaEsc()');
  rig.check(!!(await waitTv(false)), 'Escape did not take the picture down');
  rig.check(await dm.evaluate('selectedPolygonId === 1 && _gaLive === null'),
            'Escape closed the room card before it took the picture down, or left the tile marked');

  // ── D. a Player that reloads ───────────────────────────────────────────────
  // RED ON: galleryResend gated off with `if (false)` on PLAYER_READY (toolbar.js) - 2026-10-16
  await dm.evaluate('__gaClick("token"); 0');
  await waitTv(true);
  await tv.evaluate('location.reload(); 0').catch(() => {});
  await lib.installHelpers(tv).catch(() => {});
  rig.check(!!(await lib.poll(async () => {
    const s = await tvUp().catch(() => ({ up: false }));
    return s.up ? { s } : null;
  }, 20000)), 'a Player that reloaded did not get the picture that is up');
  await dm.evaluate('__gaClick("token"); 0');
  await waitTv(false);

  // ── E. the room card carries no pictures ───────────────────────────────────
  await lib.settle(dm, '!document.getElementById("notes-panel").hidden && document.getElementById("panel-room").offsetParent !== null', 8000);
  // RED ON: <div id="rp-pics"> put back in index.html's #panel-room - 2026-10-16
  const card = await dm.evaluate(`({ parts: ['rp-pics', 'rp-pic-add', 'rp-pic-input'].filter(id => document.getElementById(id)),
    room: !!document.getElementById('panel-room') && document.getElementById('panel-room').offsetParent !== null })`);
  rig.check(card.parts.length === 0, 'the room card still carries a picture strip or an Add a picture button: ' + JSON.stringify(card.parts));
  rig.check(card.room, 'the room card did not show for the selected room, so the check above read nothing');

  // ── F. rename and remove, before the restart below ─────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await dm.evaluate(`(() => { const n = __gaTileOf('token').querySelector('.ga-name');
    n.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return 0; })()`);
  await dm.evaluate(`(() => { const i = document.querySelector('#ga-grid .ga-name-edit'); i.value = 'Gold coin';
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 0; })()`);
  await lib.poll(async () => (await stored()).some(p => p.name === 'Gold coin') ? { ok: 1 } : null, 8000);
  rig.check((await stored()).some(p => p.name === 'Gold coin') && await dm.evaluate('__gaNames().includes("Gold coin")'),
            'a double-click rename did not stick');
  await dm.evaluate("__gaTileOf('letter').querySelector('.ga-x').click(); 0");
  await lib.settle(dm, "document.getElementById('cd-anchor').style.display === 'flex'", 6000);
  await dm.evaluate("document.getElementById('cd-cancel').click(); 0");
  rig.check(await dm.evaluate('_gaPics.length === 3'), 'Cancel on the remove question still removed the picture');
  await dm.evaluate('__gaClick("letter"); 0');
  await waitTv(true);
  await dm.evaluate("__gaTileOf('letter').querySelector('.ga-x').click(); 0");
  await lib.settle(dm, "document.getElementById('cd-anchor').style.display === 'flex'", 6000);
  await dm.evaluate("document.getElementById('cd-ok').click(); 0");
  await lib.settle(dm, '_gaPics.length === 2', 8000);
  rig.check(await dm.evaluate('_gaPics.length === 2 && !__gaNames().includes("letter")'), 'removing a picture after the question left it in the gallery');
  rig.check(!!(await waitTv(false)), 'removing the picture that was up left it on the TV');

  // ── G. rooms keep their pictures, untouched ────────────────────────────────
  // RED ON: `pictureBlobs: {}` in place of picturesReferenced(...) in doAutoSave (scenes.js) - 2026-10-16
  const seed = await dm.evaluate(`(async () => {
    const mk = (w) => new Promise(r => { const c = document.createElement('canvas'); c.width = w; c.height = 40;
      c.getContext('2d').fillRect(0, 0, w, 40); c.toBlob(r, 'image/png'); });
    const king = await mk(70), banner = await mk(90), letter = await mk(50);
    pictureBlobs.seedking = king; pictureBlobs.seedbanner = banner;
    polygons[0].pictures = [{ id: 'seedking', name: 'Old King.png' }, { id: 'seedbanner', name: 'Banner.jpg' }];
    // A second scene, written as the previous release wrote one: a room with refs, the bytes beside it.
    await sceneStore.saveScene({ id: 'rig-seed-scene', name: 'Seeded', mapType: 'image', mapWidth: 100, mapHeight: 100,
      polygons: [{ id: 1, vertices: [{ x: 1, y: 1 }, { x: 9, y: 1 }, { x: 9, y: 9 }], mode: 'shroud', name: 'Archive',
                   pictures: [{ id: 'seedbanner', name: 'Banner.jpg' }, { id: 'seedletter', name: 'Letter' }] }],
      nextPolygonId: 2, pictureBlobs: { seedbanner: banner, seedletter: letter }, sortOrder: 99, createdAt: 1 });
    await doAutoSave();
    return true; })()`);
  rig.check(seed === true, 'the seed scenes were not written');
  const roomsHold = async () => dm.evaluate(`(async () => {
    const a = await sceneStore.loadScene(${JSON.stringify(sceneA)}), b = await sceneStore.loadScene('rig-seed-scene');
    return { a: Object.keys(a.pictureBlobs || {}).sort().join(), aRefs: (a.polygons[0].pictures || []).map(p => p.id + ':' + p.name).join(),
             b: Object.keys(b.pictureBlobs || {}).sort().join(), bRefs: (b.polygons[0].pictures || []).map(p => p.id).join() }; })()`);
  const held0 = await roomsHold();
  rig.check(held0.a === 'seedbanner,seedking' && held0.aRefs === 'seedking:Old King.png,seedbanner:Banner.jpg',
            'a save dropped the pictures a room still holds: ' + JSON.stringify(held0));
  await lib.openMap(rig, { w: 1200, h: 800, kind: 'still' });
  await lib.settle(dm, 'currentScene && currentScene.id !== ' + JSON.stringify(sceneA), 60000);
  await dm.evaluate('switchScene(' + JSON.stringify(sceneA) + ')');
  await lib.settle(dm, 'currentScene && currentScene.id === ' + JSON.stringify(sceneA) + ' && fogCoverT === 0', 60000);
  await dm.evaluate('scheduleAutoSave(); doAutoSave(); 0');
  await lib.poll(async () => (await roomsHold()).a ? { ok: 1 } : null, 8000);
  const held1 = await roomsHold();
  rig.check(held1.a === held0.a && held1.aRefs === held0.aRefs,
            'a scene switch away and back dropped the pictures a room still holds: ' + JSON.stringify(held1));

  // ── H. the migration, on the real start ────────────────────────────────────
  // RED ON: the galleryMigrate() call in initScenes gated off with `if (false)` (sceneList.js) - 2026-10-16
  await dm.evaluate('localStorage.removeItem(' + JSON.stringify(FLAG) + '); 0');
  dm = await rig.restart();
  await lib.installHelpers(dm);
  await dm.evaluate(OWN_HELPERS);
  await lib.poll(async () => (await stored()).length >= 5 ? { ok: 1 } : null, 30000);
  const migrated = await stored();
  rig.note('the gallery after the migration: ' + JSON.stringify(migrated.map(p => p.id + ':' + p.name)));
  rig.check(migrated.length === 5, 'the gallery holds ' + migrated.length + ' pictures after the migration, not the two of its own and three from the rooms');
  const byId = id => migrated.find(p => p.id === id);
  rig.check(byId('seedking') && byId('seedking').name === 'Old King' && byId('seedbanner') && byId('seedbanner').name === 'Banner' &&
            byId('seedletter') && byId('seedletter').name === 'Letter',
            'the pictures rooms held did not arrive named without their extension: ' + JSON.stringify(migrated));
  rig.check(await flag() === '1', 'the migration did not mark itself done');
  const held2 = await roomsHold();
  rig.check(held2.a === held0.a && held2.aRefs === held0.aRefs && held2.b === 'seedbanner,seedletter' && held2.bRefs === 'seedbanner,seedletter',
            'the migration changed the scenes it copied from: ' + JSON.stringify(held2));
  // RED BY DESIGN: written against the feature, never re-proved
  await dm.evaluate('localStorage.removeItem(' + JSON.stringify(FLAG) + '); 0');
  const rerun = await dm.evaluate('galleryMigrate()');
  rig.check(rerun === 0 && (await stored()).length === 5, 'running the migration again duplicated pictures: ' + rerun);

  // ── F. what the restart kept ───────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(migrated.some(p => p.name === 'Gold coin') && migrated.some(p => p.name === 'portrait') && !migrated.some(p => p.name === 'letter' || p.name === 'token'),
            'the renamed and removed pictures did not persist across a restart: ' + JSON.stringify(migrated.map(p => p.name)));

  // ── H. a removed picture stays removed ─────────────────────────────────────
  // RED ON: the flag check at the top of galleryMigrate deleted (galleryMigrate.js) - 2026-10-16
  await dm.evaluate('galleryStore.remove("seedletter").then(galleryReload)');
  dm = await rig.restart();
  await lib.installHelpers(dm);
  await dm.evaluate(OWN_HELPERS);
  await lib.settle(dm, '_gaPics.length >= 1', 20000);
  await lib.hold(2500, 'long enough for a migration to have run on the start, then prove it did not');
  const afterRemove = await stored();
  rig.check(afterRemove.length === 4 && !afterRemove.some(p => p.id === 'seedletter'),
            'a picture removed from the gallery came back at the next start: ' + JSON.stringify(afterRemove.map(p => p.id)));

  // ── I. the gallery in a backup ─────────────────────────────────────────────
  // RED ON: galleryAdoptBackup's list replaced by [] in its addMissing call (gallery.js) - 2026-10-16
  const zipOf = n => path.join(os.tmpdir(), 'evermist-rig-gallery-' + process.pid + '-' + n + '.zip');
  const zipFull = zipOf('full'), zipPlain = zipOf('plain');
  const made = await dm.evaluate(`(async () => {
    const payload = await galleryBackupPayload();
    await window.electronAPI.createBackupZip(${JSON.stringify(zipFull)}, [], null, null, null, null, payload);
    await window.electronAPI.createBackupZip(${JSON.stringify(zipPlain)}, [], null, null, null, null, null);
    return { listed: JSON.parse(payload.meta).length, files: payload.files.length }; })()`);
  rig.check(made.listed === 4 && made.files === 4, 'the backup did not carry every picture in the gallery: ' + JSON.stringify(made));
  rig.check(fs.existsSync(zipFull) && fs.statSync(zipFull).size > 0, 'the backup archiver wrote no file');
  const snap = await stored();
  await dm.evaluate(`(async () => { await galleryStore.remove('seedbanner'); await galleryStore.remove('seedking');
    await galleryStore.put({ id: 'ownnewpic', name: 'Made after', blob: _gaPics[0].blob, added: Date.now() });
    await galleryReload(); return 0; })()`);
  const addedBack = await dm.evaluate(`galleryAdoptBackup(${JSON.stringify(zipFull)})`);
  const restored = await stored();
  rig.check(addedBack === 2, 'a restore added ' + addedBack + ' pictures, not the two that were missing');
  rig.check(snap.every(p => restored.some(r => r.id === p.id && r.name === p.name && r.type === p.type)),
            'a restore did not bring back the pictures with their names: ' + JSON.stringify(restored));
  rig.check(restored.some(p => p.id === 'ownnewpic'), 'a restore removed a picture the backup did not hold');
  const none = await dm.evaluate(`galleryAdoptBackup(${JSON.stringify(zipPlain)})`);
  rig.check(none === 0 && (await stored()).length === 5, 'a backup with no gallery in it changed the gallery: ' + none);
  rig.byEye('a backup exported and restored through the real save dialog brings the gallery back');
  for (const f of [zipFull, zipPlain]) fs.rmSync(f, { force: true });

  // ── J. two maps ────────────────────────────────────────────────────────────
  // RED ON: the panesActive branch of _gaSend gated off with `if (false)` (gallery.js) - 2026-10-16
  await lib.settle(dm, 'currentScene && fogCoverT === 0', 60000);
  await dm.evaluate('dockOpen("gallery"); 0');
  tv = await rig.player();
  await dm.evaluate('document.getElementById("btn-two-maps").click(); 0');
  await dm.waitFor('panesActive && panes.A.ready && panes.B.ready', 180000, 'both columns to come up');
  const tvA = await rig.player('A');
  await lib.settle(tvA, 'typeof applyTvPicture === "function"', 20000);
  const shell = () => tvA.evaluate(`(() => { const el = parent.document.getElementById('tv-picture');
    const imgs = el ? Array.from(el.querySelectorAll('img')).filter(i => i.getAttribute('src')) : [];
    const r = el && el.getBoundingClientRect();
    return { up: !!el && el.classList.contains('up'), widths: imgs.map(i => i.naturalWidth),
             covers: !!r && r.width >= parent.innerWidth - 1 && r.height >= parent.innerHeight - 1,
             inHalf: !!document.getElementById('tv-picture') }; })()`);
  // ⚠ THE EMPTY COLUMN OPENS THE WORLD MAP, which used to keep Escape for itself.
  // RED ON: the galleryTakeDown line in worldMapKeys removed (worldMap.js) - 2026-10-16
  await dm.waitFor('worldMapOpen', 20000, 'the world map to open over the empty column');
  await dm.evaluate('__gaClick("portrait"); 0');
  rig.check(!!(await lib.poll(async () => { const s = await shell(); return s.up ? { s } : null; }, 15000)),
            'a picture did not reach the TV with the world map open');
  await dm.evaluate('__gaEsc()');
  rig.check(!!(await lib.poll(async () => { const s = await shell(); return s.up ? null : { s }; }, 8000)),
            'Escape did not take the picture off the TV while the world map held it');
  rig.check(await dm.evaluate('worldMapOpen && _gaLive === null'),
            'Escape closed the world map or left the tile marked while a picture was up');
  // Now fill it, so the click below runs with both columns holding a scene.
  const other = await dm.evaluate('allScenes.find(s => s.id !== panes.A.sceneId && s.id !== "rig-seed-scene").id');
  await dm.evaluate('worldMapColumnFill(' + JSON.stringify(other) + '); 0');
  await dm.waitFor('panes.B.sceneId === ' + JSON.stringify(other) + ' && panes.B.mapW > 0', 60000, 'the second map to land in column B');
  await dm.evaluate('__gaClick("portrait"); 0');
  const two = await lib.poll(async () => { const s = await shell(); return s.up && s.widths.includes(810) ? { s } : null; }, 15000);
  rig.note('with two maps on: ' + JSON.stringify(two && two.s));
  rig.check(!!two, 'a gallery click in the DM window never reached the two-map Player window');
  rig.check(!!two && two.s.covers && !two.s.inHalf, 'the picture sits inside one half instead of covering the whole TV');
  await dm.evaluate('__gaEsc()');
  rig.check(!!(await lib.poll(async () => { const s = await shell(); return s.up ? null : { s }; }, 8000)),
            'Escape in the DM window did not take the picture off the two-map TV');
};
