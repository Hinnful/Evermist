'use strict';

// trash-music.js - A DELETED MUSIC TRACK WAITS 30 DAYS IN THE TRASH ON THIS COMPUTER, CLAUDE'S DELETE INCLUDED,
// AND THE PREVIOUS RELEASE NEVER SEES IT (backlog 283, Part 3: DoD 14, 16, 18, 19; Part 4: DoD 20, 24).
// (DoD 15, the question's wording, is gone: Part 4 took the question away.)
//
// One app with no Google client. Three WAV tracks written into the profile's music folder: "Битва", "Тема", "Дорога".
// Every check on a folder reads the profile's own `music` and `trash/music` folders from disk. The rollback leg opens
// the profile with the previous release's packaged build under ~/.cache/evermist-rig/prev/, as trash-local.js does.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   A. Deleting the playing "Битва" asks nothing: no dialog shows, the track stops, and the undo toast reads
//      '"Битва" moved to Trash'. Its Undo puts "Битва.wav" back whole and leaves the Trash empty.
//   B. Deleted again, "Битва" leaves the music folder for userData/trash/music, and the Trash lists it by its name
//      with "30 days left".
//   C. Restore puts "Битва.wav" back in the music folder with the same content, and the list and the trash folder
//      are empty again.
//   D. A track restored while its name is taken comes back as "Тема (2).wav", and the new "Тема.wav" is untouched.
//   E. Claude's delete_music moves "Дорога" to the Trash (listed, its file in the trash folder), and Claude's
//      undo_last_change brings it back to the music pane.
//   F. Claude's deleted track is still in the Trash, with its file, after Evermist quits and starts again.
//   G. Rollback: with "Дорога" in the trash, the previous release's music list has the other tracks and not
//      "Дорога"; back on this build the trash still lists it and Restore brings it back.
//   H. 31 days on (the entries' times moved back, then a restart), the trashed tracks are gone for good and the trash
//      folder is empty.
//   I. Empty now asks first, "Everything in the Trash is deleted for good. This cannot be undone." with no "every
//      computer" in it or in the button's title, and on yes empties the list and the trash folder of a trashed track.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const lib = require('../lib');

const PREV = path.join(os.homedir(), '.cache', 'evermist-rig', 'prev', 'squashfs-root', 'evermist');
const DAY = 86400000;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

const wav = lib.wav;

module.exports = async function trashMusic(rig) {
  const q = JSON.stringify;
  let dm = rig.dm;
  const dir = path.join(rig.profileDir, 'music'), trashDir = path.join(rig.profileDir, 'trash', 'music');
  const files = d => { try { return fs.readdirSync(d).filter(n => !n.startsWith('.')).sort(); } catch (_) { return []; } };
  const hashIn = (d, n) => { try { return sha(fs.readFileSync(path.join(d, n))); } catch (_) { return null; } };
  const listed = () => dm.evaluate('sceneTrash.list()', 20000);
  const refresh = () => dm.evaluate('_muRefreshTracks().then(() => 0)', 30000);
  const inPane = name => dm.evaluate(`_muTracks.some(t => t.name === ${q(name)})`);
  const openSettings = () => dm.evaluate(`(() => { if (document.getElementById('dock-pane-settings').hidden) document.getElementById('dock-tab-settings').click(); return !document.getElementById('dock-pane-settings').hidden; })()`);
  const rows = () => dm.evaluate(`trashPanelRefresh().then(() => Array.from(document.querySelectorAll('#sy-trash .dk-trash-row')).map(r => ({ name: r.querySelector('.nm').textContent, left: r.querySelector('.mt').textContent, id: r.querySelector('[data-restore]').dataset.restore })))`, 20000);
  const dialogUp = () => lib.poll(async () => dm.evaluate(`!!document.getElementById('cd-ok') && document.getElementById('cd-ok').offsetParent !== null`), 10000, 100);
  const del = name => dm.evaluate(`(() => { _muDelete(_muTracks.find(t => t.name === ${q(name)})); return 0; })()`);
  const toast = () => dm.evaluate(`(() => { const t = document.getElementById('scene-undo-toast'); return t.style.display === 'none' ? null : t.querySelector('.undo-msg').textContent; })()`);
  const dmDelete = async name => {
    await del(name);
    return lib.poll(async () => !files(dir).includes(name) && (await listed()).some(e => e.name === name.replace(/\.wav$/, '')), 20000, 200);
  };
  const restoreRow = async name => {
    const r = (await rows()).find(x => x.name === name);
    if (!r) return false;
    await dm.evaluate(`document.querySelector('#sy-trash [data-restore=${q(r.id)}]').click(); 0`);
    return lib.poll(async () => !(await listed()).some(e => e.id === r.id), 20000, 200);
  };

  // Setup
  const w = { 'Битва.wav': wav(4, 7), 'Тема.wav': wav(4, 9), 'Дорога.wav': wav(4, 11) };
  fs.mkdirSync(dir, { recursive: true });
  for (const n of Object.keys(w)) fs.writeFileSync(path.join(dir, n), w[n]);
  await refresh();
  rig.check(await inPane('Битва.wav') && await inPane('Тема.wav') && await inPane('Дорога.wav'), 'setup: the music pane does not list the three tracks');

  // A
  await dm.evaluate(`(() => { _muPlay(_muTracks.find(t => t.name === 'Битва.wav')); return 0; })()`);
  rig.check(await dm.evaluate(`_muPlaying === 'Битва.wav'`), 'A setup: "Битва" is not playing');
  // The row's own delete button, so a question in front of the delete would show.
  const clicked = await dm.evaluate(`(() => {
    const n = Array.from(document.querySelectorAll('.mu-row-name')).find(x => x.textContent === 'Битва');
    const b = n && n.parentElement.querySelector('.mu-row-del');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  rig.check(clicked, 'A setup: the music pane has no delete button on the "Битва" row');
  const toasted = await lib.poll(async () => { const m = await toast(); return m && !files(dir).includes('Битва.wav') ? { m } : null; }, 20000, 200);
  rig.check(!(await dm.evaluate(`!!document.getElementById('cd-ok') && document.getElementById('cd-ok').offsetParent !== null`)), 'A: deleting a track asked a question');
  rig.check(!!toasted && toasted.m === '"Битва" moved to Trash', 'A: the toast does not read \'"Битва" moved to Trash\': ' + q(toasted));
  rig.check(await dm.evaluate(`_muPlaying === null`), 'A: the deleted track is still playing');
  await dm.evaluate(`document.querySelector('#scene-undo-toast .undo-btn').click(); 0`);
  const undoneA = await lib.poll(async () => hashIn(dir, 'Битва.wav') === sha(w['Битва.wav']) && await inPane('Битва.wav') && !(await listed()).length && !files(trashDir).length, 20000, 200);
  rig.check(!!undoneA, 'A: Undo on the toast did not bring "Битва" back: music ' + q(files(dir)) + ' trash ' + q(await listed()));

  // B
  await del('Битва.wav');
  const moved = await lib.poll(async () => !files(dir).includes('Битва.wav') && files(trashDir).length === 1, 20000, 200);
  rig.check(!!moved, 'B: the deleted track did not move from the music folder to userData/trash/music: music ' + q(files(dir)) + ' trash ' + q(files(trashDir)));
  rig.check(files(trashDir).length === 1 && hashIn(trashDir, files(trashDir)[0]) === sha(w['Битва.wav']), 'B: the trash folder does not hold the deleted track\'s content');
  rig.check(await openSettings(), 'B: Settings did not open');
  const r1 = await rows();
  rig.check(r1.length === 1 && r1[0].name === 'Битва' && r1[0].left === '30 days left' && r1[0].id.startsWith('track:'),
    'B: the Trash does not list "Битва" with "30 days left": ' + q(r1));

  // C
  rig.check(!!(await restoreRow('Битва')), 'C: Restore on the "Битва" row did not take it off the list');
  rig.check(hashIn(dir, 'Битва.wav') === sha(w['Битва.wav']) && await inPane('Битва.wav'), 'C: Restore did not put "Битва.wav" back whole: ' + q(files(dir)));
  rig.check((await listed()).length === 0 && files(trashDir).length === 0, 'C: after Restore the list or the trash folder is not empty: ' + q(await listed()) + ' ' + q(files(trashDir)));

  // D
  rig.check(!!(await dmDelete('Тема.wav')), 'D setup: "Тема" did not go to the Trash');
  const fresh = wav(4, 13);
  fs.writeFileSync(path.join(dir, 'Тема.wav'), fresh);
  await refresh();
  rig.check(!!(await restoreRow('Тема')), 'D: Restore on the "Тема" row did not take it off the list');
  rig.check(hashIn(dir, 'Тема (2).wav') === sha(w['Тема.wav']) && hashIn(dir, 'Тема.wav') === sha(fresh) && await inPane('Тема (2).wav'),
    'D: with its name taken, the restored track is not "Тема (2).wav" beside the untouched new one: ' + q(files(dir)));

  // E
  const said = await dm.evaluate(`_mcpAnswer({ tool: 'delete_music', args: { name: 'Дорога', confirmed: true } })`, 60000);
  const inTrash = await lib.poll(async () => !files(dir).includes('Дорога.wav') && files(trashDir).length === 1 && (await listed()).some(e => e.name === 'Дорога'), 20000, 200);
  rig.check(!!inTrash, 'E: Claude\'s delete did not move "Дорога" to the Trash: ' + q(said) + ' trash ' + q(files(trashDir)));
  const undone = await dm.evaluate(`_mcpAnswer({ tool: 'undo_last_change', args: {} })`, 60000);
  const unback = await lib.poll(async () => hashIn(dir, 'Дорога.wav') === sha(w['Дорога.wav']) && await inPane('Дорога.wav') && !(await listed()).length && !files(trashDir).length, 20000, 200);
  rig.check(!!unback, 'E: Claude\'s undo did not bring "Дорога" back: ' + q(undone) + ' music ' + q(files(dir)));

  // F
  await dm.evaluate(`_mcpAnswer({ tool: 'delete_music', args: { name: 'Дорога', confirmed: true } })`, 60000);
  await lib.poll(async () => (await listed()).some(e => e.name === 'Дорога'), 20000, 200);
  dm = await rig.restart();
  const kept = await lib.poll(async () => (await listed()).some(e => e.name === 'Дорога') && files(trashDir).length === 1 ? true : null, 20000, 200);
  rig.check(!!kept && hashIn(trashDir, files(trashDir)[0]) === sha(w['Дорога.wav']) && !files(dir).includes('Дорога.wav'),
    'F: after a restart Claude\'s deleted track is not in the Trash with its file: ' + q(await listed()) + ' trash ' + q(files(trashDir)));

  // G
  if (rig.check(fs.existsSync(PREV), 'G: the previous release is not extracted at ' + PREV)) {
    const dmOld = await rig.restart({ exe: PREV });
    rig.check(await dmOld.evaluate('typeof sceneTrash === "undefined"'), 'setup: the swapped build is not the previous release');
    const oldList = (await dmOld.evaluate('window.electronAPI.listMusicFiles()', 20000)).map(t => t.name).sort();
    rig.check(q(oldList) === q(['Битва.wav', 'Тема (2).wav', 'Тема.wav'].sort()), 'G: the previous release lists ' + q(oldList) + ', not the three tracks outside the trash');
    dm = await rig.restart({ exe: null });
    const still = await lib.poll(async () => (await listed()).some(e => e.name === 'Дорога'), 20000, 200);
    rig.check(!!still && files(trashDir).length === 1, 'G: back on this build, the trash no longer holds "Дорога": ' + q(await listed()) + ' ' + q(files(trashDir)));
    await openSettings();
    rig.check(!!(await restoreRow('Дорога')) && hashIn(dir, 'Дорога.wav') === sha(w['Дорога.wav']), 'G: back on this build, "Дорога" did not restore: ' + q(files(dir)));
  }

  // H
  await refresh();
  rig.check(!!(await dmDelete('Битва.wav')) && !!(await dmDelete('Дорога.wav')), 'H setup: the two tracks did not go to the Trash');
  const aged = await dm.evaluate(`(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('evermist-trash'); r.onsuccess = e => res(e.target.result); r.onerror = rej; });
    const all = await new Promise(res => { const r = db.transaction('tracks').objectStore('tracks').getAll(); r.onsuccess = () => res(r.result); });
    await new Promise((res, rej) => { const tx = db.transaction('tracks', 'readwrite'); for (const v of all) { v.at -= ${31 * DAY}; tx.objectStore('tracks').put(v); } tx.oncomplete = res; tx.onerror = rej; });
    db.close();
    return all.length;
  })()`, 30000);
  rig.check(aged === 2, 'setup: the trash held ' + aged + ' tracks, not 2');
  dm = await rig.restart();
  const purged = await lib.poll(async () => (await listed()).length === 0 && files(trashDir).length === 0, 20000, 200);
  rig.check(!!purged, 'H: 31 days on, the trash still holds ' + q(await listed()) + ' files ' + q(files(trashDir)));
  rig.check(!files(dir).includes('Битва.wav') && !files(dir).includes('Дорога.wav'), 'H: a purged track is back in the music folder: ' + q(files(dir)));

  // I
  await refresh();
  rig.check(!!(await dmDelete('Тема.wav')), 'I setup: "Тема" did not go to the Trash');
  await openSettings();
  await rows();
  await dm.evaluate(`document.getElementById('sy-empty').click(); 0`);
  const askedEmpty = await dialogUp();
  rig.check(!!askedEmpty && (await listed()).length === 1, 'I: Empty now did not ask first');
  const emptyQ = askedEmpty ? await dm.evaluate(`document.getElementById('cd-msg').textContent`) : '';
  rig.check(emptyQ === 'Everything in the Trash is deleted for good. This cannot be undone.', 'I: Empty now\'s question reads ' + q(emptyQ));
  const emptyTitle = await dm.evaluate(`document.getElementById('sy-empty').title`);
  rig.check(emptyTitle === 'Delete everything in the Trash for good.', 'I: Empty now\'s title reads ' + q(emptyTitle));
  if (askedEmpty) await dm.evaluate(`document.getElementById('cd-ok').click(); 0`);
  const emptied = await lib.poll(async () => (await listed()).length === 0 && files(trashDir).length === 0, 20000, 200);
  rig.check(!!emptied, 'I: Empty now left a track: ' + q(await listed()) + ' files ' + q(files(trashDir)));
};
