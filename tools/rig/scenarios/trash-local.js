'use strict';

// trash-local.js - THE TRASH WITHOUT GOOGLE DRIVE: A DELETED MAP WAITS 30 DAYS ON THIS COMPUTER AND COMES BACK
// WHOLE, CLAUDE'S DELETE INCLUDED, AND THE PREVIOUS RELEASE NEVER SEES IT (backlog 283, Part 1; Part 4: DoD 21, 22, 24).
//
// One app with no Google client. Three maps: "Склеп" (a picture, with rooms, effects, lights, notes and fog, in the
// group "Север", a road from it to "Мост"), "Мост" (a picture) and "Пещера" (animated). The rollback leg opens the
// profile with the previous release's packaged build under ~/.cache/evermist-rig/prev/, as sync-rollback.js does.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   A. The DM deletes "Склеп" and "Пещера"; once the undo toast closes by itself both leave the library, the
//      animated map's file leaves userData/maps for userData/trash, and the road's end at "Склеп" opens.
//   B. Settings > Campaign shows the Trash line with no Google client, counting 2; the pop-out lists both
//      by name with "30 days left".
//   C. Restore on each row brings both back: "Склеп" with its record exactly as it was (fog, rooms, effects, lights,
//      notes, group, place on the Campaign), "Пещера" with its file back in userData/maps, and it plays when opened.
//   D. The road from "Мост" ends at "Склеп" again, and "Склеп" is on its list again.
//   E. Claude's delete_scene moves the animated map to the Trash (listed, its file in userData/trash), and
//      Claude's undo_last_change brings it back with its file.
//   F. Rollback: with "Склеп" in the trash, the previous release lists only the other two maps, each unchanged; back
//      on this build the trash still lists "Склеп" and restores it whole.
//   G. 31 days on (the entries' times moved back, then a restart), both trashed maps are gone for good, and the
//      trash folder is empty.
//   H. Empty now asks first: "Everything in the Trash is deleted for good. This cannot be undone.", and with sync off
//      neither its question nor its button's title says "every computer"; on yes the list is empty.
//   I. Two maps deleted together toast "2 maps moved to Trash". Delete on a map in the Notes window asks nothing: the
//      map leaves the library, the toast reads '"Зал" moved to Trash', and its Undo brings the map back. Delete on a
//      room of the open map in the Notes window still asks, and Cancel keeps the room.

const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('../lib');
const kit = require('../backupKit');

const PREV = path.join(os.homedir(), '.cache', 'evermist-rig', 'prev', 'squashfs-root', 'evermist');
const DAY = 86400000;

module.exports = async function trashLocal(rig) {
  const q = JSON.stringify;
  let dm = rig.dm;
  await kit.install(dm);
  const mapsDir = path.join(rig.profileDir, 'maps'), trashDir = path.join(rig.profileDir, 'trash');
  const fileIn = (dir, id) => fs.existsSync(dir) && fs.readdirSync(dir).some(n => n.startsWith(id + '.'));
  const has = id => dm.evaluate(`allScenes.some(s => s.id === ${q(id)})`);
  const stored = id => dm.evaluate(`sceneStore.loadScene(${q(id)}).then(r => !!r)`, 20000);
  const listed = () => dm.evaluate('sceneTrash.list()', 20000);
  const digest = id => dm.evaluate(`__bk.sceneDigest(${q(id)}).then(x => x.d)`, 30000);
  // The parts both releases read the same way, for the rollback leg: the previous release's own code computes it.
  const plain = (session, id) => session.evaluate(`sceneStore.loadScene(${q(id)}).then(async r => ({ name: r.name, group: r.group || '', notes: r.notes || '',
    rooms: JSON.stringify((r.polygons || []).map(p => [p.id, p.name, p.mode, p.vertices])), effects: JSON.stringify(r.effects || []),
    map: r.mapType === 'video' ? 'video' : await __bk.hash(r.mapBlob), fog: await __bk.hash(r.baseFogBlob) }))`, 30000);
  const diff = (a, b) => Object.keys(a).filter(k => a[k] !== (b || {})[k]);
  const shown = id => dm.evaluate(`(() => { const el = document.getElementById(${q(id)}); return !!el && el.offsetParent !== null && el.offsetHeight > 0; })()`);
  const openSettings = () => dm.evaluate(`(() => { if (document.getElementById('dock-pane-settings').hidden) document.getElementById('dock-tab-settings').click(); return !document.getElementById('dock-pane-settings').hidden; })()`);
  const rows = () => dm.evaluate(`Array.from(document.querySelectorAll('#sy-trash .dk-trash-row')).map(r => ({ name: r.querySelector('.nm').textContent, left: r.querySelector('.mt').textContent, id: r.querySelector('[data-restore]').dataset.restore }))`);
  const road = uid => dm.evaluate(`(() => { const r = worldRoadByUid(${q(uid)}); return r && { ends: r.ends, scenes: r.scenes.map(s => s.id) }; })()`);
  const dmDelete = async ids => {
    await dm.evaluate(`deleteScenesWithUndo(${q(ids)}); 0`);
    return lib.poll(async () => {
      if (await dm.evaluate('!!smPending')) return null;
      for (const id of ids) if (await stored(id) || !(await listed()).some(e => e.id === id)) return null;
      return true;
    }, 30000, 200);
  };

  // Setup
  const anim = await rig.fixtures.tableMap(dm, rig.fixtureDir, { w: 800, h: 500 });
  const animFile = await rig.fixtures.asFileExpr(dm, Object.assign({}, anim, { name: 'Пещера.mp4' }));
  const ids = await dm.evaluate(`(async () => {
    const a = (await addMapsToLibrary([await __bk.noiseFile('Склеп', 800, 600, 1, 0.85)], { x: 0, y: 0 }, true)).ids[0];
    const c = (await addMapsToLibrary([await __bk.noiseFile('Мост', 800, 600, 2, 0.85)], { x: 0, y: 0 }, true)).ids[0];
    const v = (await addMapsToLibrary([${animFile}], { x: 0, y: 0 }, true)).ids[0];
    await __bk.decorate(a, 1, {});
    worldPlaceSet('Север', [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 500 }, { x: 0, y: 500 }]);
    const place = async (id, group, pos) => {
      await __bk.editScene(id, sc => { sc.group = group; sc.worldPos = pos; });
      const m = allScenes.find(s => s.id === id); m.group = group; m.worldPos = pos;
    };
    await place(a, 'Север', { x: 150, y: 150 });
    await place(c, '', { x: 900, y: 150 });
    await place(v, '', { x: 900, y: 500 });
    const uid = worldRoadCreate([{ x: 900, y: 150 }, { x: 500, y: 300 }, { x: 150, y: 150 }], [{ kind: 'scene', ref: c }, { kind: 'scene', ref: a }]);
    return { a, c, v, uid };
  })()`, 240000);
  const { a: mImg, c: mBridge, v: mAnim, uid } = ids;
  rig.check(await dm.evaluate('allScenes.length') === 3 && await dm.evaluate(`sceneStore.loadScene(${q(mAnim)}).then(r => r.mapType)`, 20000) === 'video', 'setup: three maps with "Пещера" animated were not made');
  rig.check(fileIn(mapsDir, mAnim), 'setup: the animated map has no file in userData/maps');
  const imgBefore = await digest(mImg), animBefore = await digest(mAnim);
  const roadBefore = await road(uid);

  // A
  const gone = await dmDelete([mImg, mAnim]);
  rig.check(!!gone, 'A: once the toast closed, the two maps did not leave the library for the Trash: ' + q(await listed()));
  rig.check(!(await has(mImg)) && !(await has(mAnim)), 'A: a deleted map is still in the list');
  rig.check(!fileIn(mapsDir, mAnim) && fileIn(trashDir, mAnim), 'A: the animated map\'s file did not move from userData/maps to userData/trash');
  const opened = await road(uid);
  rig.check(!!opened && opened.ends[1].kind === null && !opened.scenes.includes(mImg), 'A: the road\'s end at "Склеп" did not open: ' + q(opened));

  // B
  rig.check(await openSettings(), 'B: Settings did not open');
  rig.check(await shown('sy-trash-open'), 'B: Settings > Campaign shows no Trash line without Google Drive');
  const counted = await lib.poll(async () => await dm.evaluate(`document.getElementById('sy-trash-count').textContent`) === '2', 10000, 200);
  rig.check(!!counted, 'B: the Trash line does not count 2: ' + q(await dm.evaluate(`document.getElementById('sy-trash-count').textContent`)));
  await dm.evaluate(`document.getElementById('sy-trash-open').click(); 0`);
  rig.check(await shown('sy-trash-pop'), 'B: clicking the Trash line did not open its pop-out');
  const r2 = await rows();
  const names = r2.map(r => r.name).sort().join(',');
  rig.check(r2.length === 2 && names === ['Склеп', 'Пещера'].sort().join(',') && r2.every(r => r.left === '30 days left'), 'B: the pop-out does not list both maps with "30 days left": ' + q(r2));

  // C
  for (const id of [mImg, mAnim]) {
    await dm.evaluate(`document.querySelector('#sy-trash [data-restore="${id}"]').click(); 0`);
    await lib.poll(async () => await has(id) && !(await rows()).some(r => r.id === id), 20000, 200);
  }
  const back = await lib.poll(async () => await has(mImg) && await has(mAnim) && (await rows()).length === 0 && (await listed()).length === 0, 30000, 200);
  rig.check(!!back, 'C: Restore did not bring both maps back: ' + q(await rows()));
  const imgAfter = await digest(mImg), animAfter = await digest(mAnim);
  rig.check(!diff(imgBefore, imgAfter).length, 'C: "Склеп" came back changed in: ' + diff(imgBefore, imgAfter).join(', ') + ' ' + q(diff(imgBefore, imgAfter).map(k => [imgBefore[k], imgAfter[k]])));
  rig.check(await dm.evaluate(`(() => { const s = allScenes.find(x => x.id === ${q(mImg)}); return s.group === 'Север' && s.worldPos.x === 150 && s.worldPos.y === 150; })()`), 'C: "Склеп" is not back in its group at its place on the Campaign');
  rig.check(!diff(animBefore, animAfter).length, 'C: "Пещера" came back changed in: ' + diff(animBefore, animAfter).join(', '));
  rig.check(fileIn(mapsDir, mAnim) && !fileIn(trashDir, mAnim), 'C: the animated map\'s file is not back in userData/maps');
  await dm.evaluate(`switchScene(${q(mAnim)})`, 60000);
  const t0 = await lib.poll(async () => dm.evaluate('mapVideo && mapVideo.readyState >= 2 ? { t: mapVideo.currentTime } : null'), 30000, 200);
  const plays = t0 && await lib.poll(async () => dm.evaluate(`mapVideo && !mapVideo.paused && mapVideo.currentTime !== ${t0.t}`), 15000, 200);
  rig.check(!!plays, 'C: the restored animated map does not play: ' + q(await dm.evaluate('mapVideo && { paused: mapVideo.paused, t: mapVideo.currentTime, rs: mapVideo.readyState, err: mapVideo.error && mapVideo.error.code }')));

  // D
  const rejoined = await road(uid);
  rig.check(!!rejoined && q(rejoined.ends) === q(roadBefore.ends) && rejoined.scenes.join() === roadBefore.scenes.join(), 'D: the road did not come back to "Склеп": ' + q(rejoined) + ' was ' + q(roadBefore));

  // E
  await dm.evaluate(`switchScene(${q(mBridge)})`, 60000);
  const said = await dm.evaluate(`_mcpAnswer({ tool: 'delete_scene', args: { name: 'Пещера', confirmed: true } })`, 60000);
  const inTrash = await lib.poll(async () => !(await has(mAnim)) && !(await stored(mAnim)) && (await listed()).some(e => e.id === mAnim), 20000, 200);
  rig.check(!!inTrash, 'E: Claude\'s delete did not move the animated map to the Trash: ' + q(said));
  rig.check(!fileIn(mapsDir, mAnim) && fileIn(trashDir, mAnim), 'E: after Claude\'s delete the animated map\'s file is not in userData/trash');
  const undone = await dm.evaluate(`_mcpAnswer({ tool: 'undo_last_change', args: {} })`, 60000);
  const unback = await lib.poll(async () => await has(mAnim) && await stored(mAnim) && !(await listed()).some(e => e.id === mAnim), 20000, 200);
  rig.check(!!unback && fileIn(mapsDir, mAnim), 'E: Claude\'s undo did not bring the animated map back with its file: ' + q(undone));

  // F
  if (rig.check(fs.existsSync(PREV), 'F: the previous release is not extracted at ' + PREV)) {
    rig.check(!!(await dmDelete([mImg])), 'F: "Склеп" did not go to the Trash');
    // The open map's fog is first written by its autosave, so a digest taken before it reads a fog the quit then replaces.
    await dm.evaluate('doAutoSave()', 30000);
    const keep = { [mBridge]: await plain(dm, mBridge), [mAnim]: await plain(dm, mAnim) };
    const dmOld = await rig.restart({ exe: PREV });
    rig.check(await dmOld.evaluate('typeof sceneTrash === "undefined"'), 'setup: the swapped build is not the previous release');
    await kit.install(dmOld);
    const oldIds = await dmOld.evaluate('allScenes.map(s => s.id)');
    rig.check(oldIds.length === 2 && !oldIds.includes(mImg), 'F: the previous release lists ' + q(oldIds) + ', not the two maps outside the trash');
    for (const id of [mBridge, mAnim]) {
      const d = await plain(dmOld, id);
      rig.check(!diff(keep[id], d).length, 'F: the previous release reads ' + keep[id].name + ' differently in: ' + diff(keep[id], d).join(', '));
    }
    dm = await rig.restart({ exe: null });
    await kit.install(dm);
    const still = await lib.poll(async () => (await listed()).some(e => e.id === mImg), 20000, 200);
    rig.check(!!still, 'F: back on this build, the trash no longer lists "Склеп": ' + q(await listed()));
    rig.check(await dm.evaluate(`sceneTrash.restore(${q(mImg)})`, 30000) === true && await has(mImg), 'F: back on this build, "Склеп" did not restore');
    const d = await digest(mImg);
    rig.check(!diff(imgBefore, d).length, 'F: "Склеп" restored after the rollback trip changed in: ' + diff(imgBefore, d).join(', '));
  }

  // G
  await dm.evaluate(`switchScene(${q(mBridge)})`, 60000);
  rig.check(!!(await dmDelete([mImg, mAnim])), 'G: the two maps did not go to the Trash');
  const moved = await dm.evaluate(`(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('evermist-trash'); r.onsuccess = e => res(e.target.result); r.onerror = rej; });
    const all = await new Promise(res => { const out = []; const c = db.transaction('maps').objectStore('maps').openCursor(); c.onsuccess = e => { const k = e.target.result; if (!k) return res(out); out.push(k.value); k.continue(); }; });
    await new Promise((res, rej) => { const tx = db.transaction('maps', 'readwrite'); for (const v of all) { v.at -= ${31 * DAY}; tx.objectStore('maps').put(v); } tx.oncomplete = res; tx.onerror = rej; });
    db.close();
    return all.length;
  })()`, 30000);
  rig.check(moved === 2, 'setup: the trash held ' + moved + ' entries, not 2');
  dm = await rig.restart();
  await kit.install(dm);
  const purged = await lib.poll(async () => (await listed()).length === 0 && !fileIn(trashDir, mAnim), 20000, 200);
  rig.check(!!purged, 'G: 31 days on, the trash still holds ' + q(await listed()));
  rig.check(!(await has(mImg)) && !(await has(mAnim)) && !(await stored(mImg)) && !(await stored(mAnim)), 'G: a purged map is back in the library');
  rig.check(fs.readdirSync(trashDir).length === 0, 'G: the trash folder is not empty: ' + q(fs.readdirSync(trashDir)));

  // H
  rig.check(!!(await dmDelete([mBridge])), 'H: "Мост" did not go to the Trash');
  await openSettings();
  await lib.poll(async () => (await rows()).length === 1, 10000, 200);
  const title = await dm.evaluate(`document.getElementById('sy-empty').title`);
  await dm.evaluate(`document.getElementById('sy-empty').click(); 0`);
  const asked = await lib.poll(async () => dm.evaluate(`!!document.getElementById('cd-ok') && document.getElementById('cd-ok').offsetParent !== null`), 10000, 100);
  rig.check(!!asked, 'H: Empty now did not ask first');
  rig.check((await rows()).length === 1, 'H: Empty now emptied the list before the DM answered');
  const question = await dm.evaluate(`document.getElementById('cd-msg').textContent`);
  rig.check(question === 'Everything in the Trash is deleted for good. This cannot be undone.', 'H: with sync off the question reads ' + q(question));
  rig.check(title === 'Delete everything in the Trash for good.', 'H: with sync off the button\'s title reads ' + q(title));
  if (asked) await dm.evaluate(`document.getElementById('cd-ok').click(); 0`);
  const emptied = await lib.poll(async () => (await rows()).length === 0 && (await listed()).length === 0, 20000, 200);
  rig.check(!!emptied, 'H: Empty now did not empty the list: ' + q(await rows()));
  rig.check(await dm.evaluate(`document.getElementById('sy-trash-count').textContent`) === 'Empty', 'H: the emptied line does not read "Empty"');

  // I
  const toast = () => dm.evaluate(`(() => { const t = document.getElementById('scene-undo-toast'); return t.style.display === 'none' ? null : t.querySelector('.undo-msg').textContent; })()`);
  const dialogShown = () => dm.evaluate(`!!document.getElementById('cd-ok') && document.getElementById('cd-ok').offsetParent !== null`);
  const undo = () => dm.evaluate(`document.querySelector('#scene-undo-toast .undo-btn').click(); 0`);
  const made = await dm.evaluate(`(async () => {
    const a = (await addMapsToLibrary([await __bk.noiseFile('Зал', 800, 600, 3, 0.85)], { x: 0, y: 0 }, true)).ids[0];
    const b = (await addMapsToLibrary([await __bk.noiseFile('Башня', 800, 600, 4, 0.85)], { x: 0, y: 0 }, true)).ids[0];
    await __bk.decorate(a, 2, {});
    return { a, b };
  })()`, 120000);
  const { a: mHall, b: mTower } = made;
  await dm.evaluate(`deleteScenesWithUndo(${q([mHall, mTower])}); 0`);
  const both = await lib.poll(async () => { const m = await toast(); return m ? { m } : null; }, 10000, 100);
  rig.check(!!both && both.m === '2 maps moved to Trash', 'I: two maps deleted together toast ' + q(both));
  await undo();
  rig.check(!!(await lib.poll(async () => await has(mHall) && await has(mTower), 10000, 200)), 'I setup: Undo did not bring both maps back');
  await dm.evaluate(`switchScene(${q(mHall)})`, 60000);
  await dm.evaluate('nwShow(); refreshRoomPanel(); 0');
  const findNode = pred => `(() => { const f = n => (${pred}) ? n : n.children.reduce((r, c) => r || f(c), null); return _ntRoot && f(_ntRoot); })()`;
  const mapNode = findNode(`n.kind === 'map' && n.id === ${q(mHall)}`);
  const roomNode = findNode(`n.kind === 'room' && n.scene === ${q(mHall)}`);
  rig.check(!!(await lib.poll(async () => dm.evaluate(`(() => { refreshRoomPanel(); return !!${mapNode} && !!${roomNode}; })()`), 20000, 200)), 'I setup: the Notes window\'s tree does not show "Зал" and its rooms');
  await dm.evaluate(`ntDelete(${mapNode}); 0`);
  const mapAsked = await dialogShown();
  rig.check(!mapAsked, 'I: Delete on a map in the Notes window asked a question');
  if (mapAsked) await dm.evaluate(`document.getElementById('cd-ok').click(); 0`);
  const hallToast = await lib.poll(async () => { const m = await toast(); return m && !(await has(mHall)) ? { m } : null; }, 10000, 100);
  rig.check(!!hallToast && hallToast.m === '"Зал" moved to Trash', 'I: the Notes window\'s map delete did not leave the library with the toast \'"Зал" moved to Trash\': ' + q(hallToast));
  await undo();
  rig.check(!!(await lib.poll(async () => await has(mHall) && !(await dm.evaluate('!!smPending')), 10000, 200)), 'I: Undo on the toast did not bring "Зал" back');
  await dm.evaluate(`switchScene(${q(mHall)})`, 60000);
  const rooms = () => dm.evaluate('polygons.length');
  const roomsBefore = await rooms();
  await dm.evaluate(`(() => { refreshRoomPanel(); ntDelete(${roomNode}); return 0; })()`);
  const roomAsked = await lib.poll(async () => dialogShown(), 10000, 100);
  rig.check(!!roomAsked, 'I: Delete on a room in the Notes window no longer asks');
  if (roomAsked) await dm.evaluate(`document.getElementById('cd-cancel').click(); 0`);
  rig.check(roomsBefore > 0 && await rooms() === roomsBefore, 'I: Cancel on the room\'s question did not keep the room: ' + roomsBefore + ' then ' + await rooms());
};
