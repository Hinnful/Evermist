'use strict';

// sync-music.js - MUSIC SYNCS BETWEEN TWO COMPUTERS, AND SETTINGS SAYS HOW FULL THE DRIVE IS (BACKLOG 274).
//
// Two apps on one fake Drive. A gets tracks the way the DM adds them; B is the other computer. Every track is a WAV
// written here, and every check on a folder reads the profile's own music folder from disk.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   1. A track added on A plays on B after a sync: one landed as the downloader leaves it, one added from a file.
//   2. A track's group and the group order show the same on both computers, and the later edit wins.
//   5. Two different tracks with the same name are both kept; the incoming one gets " (2)".
//   4. A track playing on B is not removed while it plays; it leaves once B plays another.
//   3. A deleted track leaves B and shows in the Trash beside a deleted map; Restore brings it back on both
//      computers; Empty now and the 30 days each remove its file from the Drive.
//   6. A map goes up before a long track in the same tick, and comes down before it on the other computer.
//   7. Settings' Google Drive line shows " · N% full" from 70% in amber, from 90% in red, nothing below 70%, and the
//      full Drive's own message as it was.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const lib = require('../lib');
const kit = require('../backupKit');

const DAY = 86400000;
const q = JSON.stringify;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

const wav = lib.wav;

const T1 = 'Битва в склепе [dQw4w9WgXcQ].wav';
const T2 = 'Тихий зал.wav';
const THEME = 'Тема.wav';

module.exports = async function syncMusic(rig) {
  const drive = await rig.fakeDrive();
  const b = await rig.second('b');
  rig.writeSyncConfig(rig.profileDir, drive);
  rig.writeSyncConfig(b.profileDir, drive);
  let dmA = await rig.restart();
  const dmB = await b.restart();
  await kit.install(dmA);
  const dirA = path.join(rig.profileDir, 'music'), dirB = path.join(b.profileDir, 'music');
  const src = path.join(rig.outDir, 'tracks');
  fs.mkdirSync(src, { recursive: true });

  const tick = async dm => { await lib.settle(dm, "syncEngine.status().state !== 'off'", 30000); return dm.evaluate('syncEngine.now()', 180000); };
  const both = async () => { await tick(dmA); await tick(dmB); };
  const status = async () => 'A ' + q(await dmA.evaluate('syncEngine.status()')) + ' B ' + q(await dmB.evaluate('syncEngine.status()'));
  const folder = dir => { try { return fs.readdirSync(dir).filter(n => !n.startsWith('.')).map(n => ({ name: n, hash: sha(fs.readFileSync(path.join(dir, n))) })); } catch (_) { return []; } };
  const nameOf = (dir, h) => (folder(dir).find(t => t.hash === h) || {}).name || null;
  const until = (fn, ms) => lib.poll(async () => { await both(); return fn(); }, ms || 45000, 200);
  const firstDone = dm => dm.evaluate(`syncIndex.raw.get('synced', '$first').then(x => !!x)`, 20000);
  const refresh = dm => dm.evaluate('_muRefreshTracks().then(() => 0)', 30000);
  const machineOf = dm => dm.evaluate('syncEngine.status().machine');
  const drop = (dm, name) => dm.evaluate(`(async () => {
    await window.electronAPI.deleteMusicFile(${q(name)}); forgetMusicTrack(${q(name)}); await _muRefreshTracks(); return 0;
  })()`, 30000);
  const play = async (dm, name) => {
    await refresh(dm);
    await dm.evaluate(`_muEnsureDecks(); _muDecks.forEach(d => { d.el.muted = true; }); _muPlay(_muTracks.find(t => t.name === ${q(name)})); 0`);
    return lib.settle(dm, '_muPlaying === ' + q(name) + ' && _muDecks[_muActive].el.currentTime > 0.05', 20000);
  };
  // A track on its way up waits for its hash, which is made as it lands.
  const hashedOn = (dm, name) => lib.poll(() => dm.evaluate(`window.electronAPI.syncDrive('musicTracks', {}).then(r => !!(r.ok && r.v.tracks.some(t => t.name === ${q(name)} && t.hash)))`), 20000, 200);

  const ids = await dmA.evaluate(`(async () => {
    const out = [];
    for (const [i, n] of ['Склеп', 'Башня'].entries()) out.push((await addMapsToLibrary([await __bk.noiseFile(n, 640, 480, i + 1, 0.8)], { x: i * 300, y: 0 }, true)).ids[0]);
    return out;
  })()`, 120000);
  const ready = await lib.poll(async () => { await both(); return ids.every(Boolean) && await firstDone(dmA) && await firstDone(dmB) && await dmB.evaluate(`allScenes.length === 2`); }, 120000, 200);
  rig.check(!!ready, 'setup: the maps did not reach B, or a first sync did not finish: ' + await status());
  if (!ready) return;

  const w1 = wav(20, 8), w2 = wav(20, 11), h1 = sha(w1), h2 = sha(w2);

  // 1
  await lib.step(rig, '1', async () => {
    fs.writeFileSync(path.join(dirA, T1), w1);
    await refresh(dmA);
    fs.writeFileSync(path.join(src, T2), w2);
    await dmA.evaluate(`_muAddFiles([${q(path.join(src, T2))}]).then(() => 0)`, 30000);
    const got = await until(() => nameOf(dirB, h1) === T1 && nameOf(dirB, h2) === T2);
    rig.check(!!got, '1: the tracks added on A did not reach B by their names: ' + q(folder(dirB).map(t => t.name)) + ' ' + await status());
    if (!got) return;
    rig.check(await play(dmB, T1), '1: the downloaded track does not play on B');
    rig.check(await play(dmB, T2), '1: the track added from a file does not play on B');
  });

  // 2
  await lib.step(rig, '2', async () => {
    await dmA.evaluate(`putMusicGroup('Тишина', 0, []); putMusicGroup('Битвы', 0, [${q(T1)}]); setMusicGroup([${q(T2)}], 'Тишина'); 0`);
    const look = dm => dm.evaluate(`({ order: musicGroupNames(), t1: musicGroupOf(${q(T1)}), t2: musicGroupOf(${q(T2)}) })`);
    const same = await until(async () => q(await look(dmB)) === q({ order: ['Битвы', 'Тишина'], t1: 'Битвы', t2: 'Тишина' }));
    rig.check(!!same, '2: B does not show A\'s groups: ' + q(await look(dmB)));
    // An edit on A, then a later one on B before either syncs: B's stands on both.
    await dmA.evaluate(`setMusicGroup([${q(T1)}], 'Тишина'); 0`);
    await dmB.evaluate(`setMusicGroup([${q(T2)}], 'Битвы'); putMusicGroup('Тишина', 0, []); 0`);
    const want = q({ order: ['Тишина', 'Битвы'], t1: 'Битвы', t2: 'Битвы' });
    const later = await until(async () => q(await look(dmA)) === want && q(await look(dmB)) === want);
    rig.check(!!later, '2: the later edit (B\'s) does not stand on both: A ' + q(await look(dmA)) + ' B ' + q(await look(dmB)));
  });

  // 5
  const x = wav(10, 5), y = wav(10, 6), hx = sha(x), hy = sha(y);
  await lib.step(rig, '5', async () => {
    fs.writeFileSync(path.join(dirA, THEME), x);
    fs.writeFileSync(path.join(dirB, THEME), y);
    await refresh(dmA); await refresh(dmB);
    const ok = await until(() => nameOf(dirA, hx) === THEME && nameOf(dirA, hy) === 'Тема (2).wav' && nameOf(dirB, hy) === THEME && nameOf(dirB, hx) === 'Тема (2).wav');
    rig.check(!!ok, '5: the two "Тема.wav" are not both kept with " (2)" on the incoming one: A ' + q(folder(dirA).map(t => t.name)) + ' B ' + q(folder(dirB).map(t => t.name)));
  });

  // 4
  await lib.step(rig, '4', async () => {
    if (!rig.check(await play(dmB, T1), '4 setup: the track does not play on B')) return;
    await drop(dmA, T1);
    await tick(dmA);
    await tick(dmB);
    const held = await dmB.evaluate('syncEngine.status().held');
    await tick(dmB);
    rig.check(held >= 1 && nameOf(dirB, h1) === T1 && await dmB.evaluate('_muPlaying') === T1,
      '4: the playing track was not held on B: held ' + held + ', on disk ' + q(nameOf(dirB, h1)) + ', playing ' + q(await dmB.evaluate('_muPlaying')));
    await play(dmB, T2);
    await lib.settle(dmB, `!_muDecks.some(d => (d.el.getAttribute('src') || '').includes(${q(encodeURIComponent('Битва'))}))`, 20000);
    const left = await lib.poll(async () => { await tick(dmB); return !nameOf(dirB, h1); }, 30000, 200);
    rig.check(!!left, '4: the track did not leave B once B played another: ' + await status());
  });

  // 3
  await lib.step(rig, '3', async () => {
    if (!rig.check(!nameOf(dirA, h1), '3 setup: the track is still on A')) return;
    await dmA.evaluate(`deleteScenesWithUndo([${q(ids[1])}]); commitPendingDelete(); 0`);
    await lib.poll(async () => !(await dmA.evaluate(`sceneStore.loadScene(${q(ids[1])}).then(r => !!r)`, 20000)), 20000);
    const listed = await until(async () => {
      const t = await dmB.evaluate('syncEngine.trash()', 30000);
      return t.some(r => r.id === ids[1]) && t.some(r => r.name === 'Битва в склепе') ? t : null;
    });
    rig.check(!!listed, '3: B\'s Trash does not list the track beside the map: ' + q(await dmB.evaluate('syncEngine.trash()', 30000)));
    const rows = await dmB.evaluate(`trashPanelRefresh().then(() => [...document.querySelectorAll('#sy-trash .nm')].map(e => e.textContent))`, 30000);
    rig.check(rows.includes('Битва в склепе') && rows.includes('Башня'), '3: Settings\' Trash does not show the track and the map: ' + q(rows));
    const onA = (await dmA.evaluate('syncEngine.trash()', 30000)).find(r => r.name === 'Битва в склепе');
    rig.check(!!onA && onA.at > Date.now() - 10 * 60000, '3: A\'s Trash does not list the track with its time: ' + q(onA));
    rig.check(drive.files().some(f => f.name.endsWith('.' + h1)), '3: the deleted track\'s file left the Drive before its 30 days');

    const id = onA ? onA.id : 'music:' + h1;
    await dmB.evaluate(`syncEngine.restore(${q(id)})`, 120000);
    const back = await until(() => nameOf(dirA, h1) && nameOf(dirB, h1));
    rig.check(!!back, '3: Restore on B did not bring the track back on both: A ' + q(nameOf(dirA, h1)) + ' B ' + q(nameOf(dirB, h1)));
    rig.check((await dmB.evaluate('syncEngine.trash()', 30000)).every(r => r.id !== id), '3: the restored track is still in the Trash');

    await drop(dmA, nameOf(dirA, h1));
    const gone = await until(async () => !nameOf(dirB, h1) && (await dmB.evaluate('syncEngine.trash()', 30000)).some(r => r.id === id));
    rig.check(!!gone, '3: the track deleted again did not leave B: ' + q(folder(dirB).map(t => t.name)));
    await dmB.evaluate('syncEngine.emptyNow()', 120000);
    rig.check(!drive.files().some(f => f.name.endsWith('.' + h1)), '3: Empty now left the track\'s file on the Drive');
    rig.check((await dmB.evaluate('syncEngine.trash()', 30000)).every(r => r.id !== id), '3: Empty now left the track in the Trash');

    // Past 30 days: A's own "Тема.wav" deleted, then A's clock moved on.
    await drop(dmA, THEME);
    await tick(dmA);
    rig.check(drive.files().some(f => f.name.endsWith('.' + hx)), '3 setup: the deleted track\'s file is not on the Drive in its 30 days');
    await dmA.evaluate(`globalThis.__rigNow = Date.now; Date.now = () => __rigNow() + ${31 * DAY}; 0`);
    try { await tick(dmA); } finally { await dmA.evaluate('Date.now = __rigNow; 0'); }
    rig.check(!drive.files().some(f => f.name.endsWith('.' + hx)), '3: 31 days on, the deleted track\'s file is still on the Drive');
  });

  // 6
  await lib.step(rig, '6', async () => {
    const big = wav(3000, 9), hb = sha(big), BIG = 'Долгая ночь.wav';
    fs.writeFileSync(path.join(src, BIG), big);
    const mA = await machineOf(dmA);
    const upFrom = drive.stats.uploads.length, from = drive.stats.requests.length;
    const id = await dmA.evaluate(`(async () => {
      await _muAddFiles([${q(path.join(src, BIG))}]);
      return (await addMapsToLibrary([await __bk.noiseFile('Мост', 640, 480, 7, 0.8)], { x: 600, y: 0 }, true)).ids[0];
    })()`, 120000);
    await hashedOn(dmA, BIG);
    await tick(dmA);
    const ups = drive.stats.uploads.slice(upFrom).map(u => u.name);
    const rec = ups.indexOf('scene~' + id + '.json'), mapFile = ups.findIndex(n => n.startsWith(id + '.')), track = ups.indexOf(mA + '.' + hb);
    rig.check(rec >= 0 && mapFile >= 0 && track >= 0 && rec < track && mapFile < track, '6: on A the map did not go up before the long track: ' + q(ups.map(n => n.slice(0, 24))));

    const recFile = drive.files().find(f => f.name === 'scene~' + id + '.json'), trackFile = drive.files().find(f => f.name === mA + '.' + hb);
    await tick(dmB);
    const reqs = drive.stats.requests.slice(from);
    const gotRec = recFile ? reqs.indexOf('GET /drive/v3/files/' + recFile.id) : -1, gotTrack = trackFile ? reqs.indexOf('GET /drive/v3/files/' + trackFile.id) : -1;
    rig.check(gotRec >= 0 && gotTrack >= 0 && gotRec < gotTrack && nameOf(dirB, hb) === BIG, '6: on B the map did not come down before the long track: map at ' + gotRec + ', track at ' + gotTrack + ', on disk ' + q(nameOf(dirB, hb)));
  });

  // 7
  await lib.step(rig, '7', async () => {
    const line = async () => {
      await tick(dmA);
      return dmA.evaluate(`(() => { _ssStatus(); const l = document.getElementById('sy-line'), s = l.querySelector('.sp');
        return { text: l.textContent, sp: s ? s.textContent : null, color: s ? getComputedStyle(s).color : null }; })()`);
    };
    const G = 1024 ** 3;
    drive.quotaLimit = 100 * G;
    drive.quotaUsed = 48 * G;
    const low = await line();
    rig.check(low.sp === null && !/% full/.test(low.text), '7: under 70% the line shows a percentage: ' + q(low));
    drive.quotaUsed = 74 * G;
    const amber = await line();
    rig.check(/ · 74% full$/.test(amber.text) && amber.color === 'rgb(242, 196, 109)', '7: at 74% the line is not " · 74% full" in amber: ' + q(amber));
    drive.quotaUsed = 93 * G;
    const red = await line();
    rig.check(/ · 93% full$/.test(red.text) && red.color === 'rgb(255, 138, 138)', '7: at 93% the line is not " · 93% full" in red: ' + q(red));
    drive.quotaFull = true;
    await dmA.evaluate(`(async () => { await addMapsToLibrary([await __bk.noiseFile('Пирс', 320, 240, 9, 0.8)], { x: 900, y: 0 }, true); return 0; })()`, 120000);
    const full = await line();
    drive.quotaFull = false;
    rig.check(full.text.startsWith('Your Google Drive is full. Free some space there to keep syncing.') && full.sp === null, '7: a full Drive does not keep its own message alone: ' + q(full));
  });
};
