'use strict';

// library-upgrade.js - THE LIBRARY PANES OVER A 5.12.0 PROFILE, AND BACK (spec library-panes, DoD 13, 14).
//
// One profile. The previous release, 5.12.0, extracted under ~/.cache/evermist-rig/prev/, makes it; this build opens
// it; then 5.12.0 opens it again. A scenario run against any other previous release fails on its first line, since
// the upgrade it checks starts from 5.12.0's data.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   0. The previous release under the cache is 5.12.0.
//  13. On 5.12.0: music groups "Бой" (with a track) and "Пусто" (empty), two own sounds, one renamed by its name, and
//      three pictures. Opened in this build, in English and then in Russian: "Бой" kept with its track, "Пусто" gone,
//      both own sounds in "My sounds" under their names, the pictures newest first.
//  14. Here a picture and the built-in "Bell" are deleted to the Trash and a track renamed. On 5.12.0 again the Music,
//      Sounds and Pictures panes and the Trash open, "Bell" shows, the track reads by its file name, and a map delete
//      and a track delete still reach 5.12.0's Trash.

const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('../lib');

const PREV = path.join(os.homedir(), '.cache', 'evermist-rig', 'prev', 'squashfs-root', 'evermist');
const q = JSON.stringify;

module.exports = async function libraryUpgrade(rig) {
  if (!rig.check(fs.existsSync(PREV), '0: no previous release is extracted at ' + PREV)) return;
  let dm = await rig.restart({ exe: PREV });
  const ver = await dm.evaluate('window.electronAPI.getAppVersion()');
  if (!rig.check(ver === '5.12.0', '0: the previous release under ' + PREV + ' is ' + ver + ', not 5.12.0; refresh the cache')) return;

  const music = path.join(rig.profileDir, 'music'), src = path.join(rig.outDir, 'up-src');
  fs.mkdirSync(music, { recursive: true });
  fs.mkdirSync(src, { recursive: true });
  for (const n of ['Битва.wav', 'Тема.wav', 'Дорога.wav']) fs.writeFileSync(path.join(music, n), lib.wav(2, 5 + n.length));
  for (const n of ['Колокол.wav', 'Скрип.wav']) fs.writeFileSync(path.join(src, n), lib.wav(1, 9));

  // 13: 5.12.0's data.
  await lib.step(rig, '13 on 5.12.0', async () => {
    // The rig's first boot was this build, which wrote its own layouts on the empty profile; a real 5.12.0 profile
    // has none, and with them the upgrade would rightly treat the library as already upgraded.
    await dm.evaluate(`(async () => {
      for (const k of ['evermist.musicOrder', 'evermist.soundsLayout', 'evermist.picturesLayout']) localStorage.removeItem(k);
      await _muRefreshTracks();
      putMusicGroup('Бой', 0, ['Битва.wav']); putMusicGroup('Пусто', 1, []);
      await window.electronAPI.copyOwnSounds(${q([path.join(src, 'Колокол.wav'), path.join(src, 'Скрип.wav')])});
      await window.electronAPI.renameOwnSound('Скрип.wav', 'Скрип двери');
      for (const [n, at] of [['Старый', 1000], ['Средний', 2000], ['Новый', 3000]]) {
        const c = document.createElement('canvas'); c.width = 32; c.height = 32;
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        await galleryStore.put({ id: 'up' + at, name: n, blob, added: at });
      }
      return 0;
    })()`, 60000);
    rig.check(q(await dm.evaluate('musicGroupNames()')) === q(['Бой', 'Пусто']), '13 setup: 5.12.0 did not keep both music groups');
  });

  const look = d => d.evaluate(`(async () => { await _muRefreshTracks(); await soundboardRefreshOwn(); await galleryReload();
    const L = soundsLayoutNow(), my = L.groups['builtin:My sounds'];
    return { groups: musicGroupNames(), boy: musicGroupOf('Битва.wav'), my: my ? my.members.map(soundLabel) : null,
      myHead: [...document.querySelectorAll('#sb-cols .lib-gh .lib-name')].filter(n => n.offsetParent !== null).map(n => n.textContent)[0] || null,
      pics: libSections(galleryLayoutNow(), galleryList().map(p => p.id)).flatMap(s => s.items).map(id => galleryList().find(p => p.id === id).name) }; })()`, 60000);
  const want = { groups: ['Бой'], boy: 'Бой', my: ['Колокол', 'Скрип двери'], pics: ['Новый', 'Средний', 'Старый'] };
  for (const lang of ['en', 'ru']) {
    await lib.step(rig, '13 in ' + lang, async () => {
      if (lang === 'ru') dm = await lib.inRussian(rig); else dm = await rig.restart({ exe: null });
      await dm.evaluate(`dockOpen('sounds'); 0`);
      const got = await look(dm);
      const head = lang === 'ru' ? 'Мои звуки' : 'My sounds';
      rig.check(q({ ...got, myHead: undefined }) === q({ ...want, myHead: undefined }) && got.myHead === head,
        '13: in ' + lang + ' the upgrade reads ' + q(got) + ', not ' + q(want) + ' under "' + head + '"');
    });
  }

  // 14: the new build's own deletions, then 5.12.0 again.
  await lib.step(rig, '14 here', async () => {
    await dm.evaluate(`(async () => {
      await soundsDelete('builtin:bell.mp3');
      await sceneTrash.putPicture(_gaPics.find(p => p.name === 'Средний'), Date.now()); await galleryDrop(_gaPics.find(p => p.name === 'Средний').id);
      setMusicLabel('Тема.wav', 'Главная тема');
      return 0;
    })()`, 30000);
    const kinds = (await dm.evaluate('sceneTrash.list()', 20000)).map(e => e.kind).sort();
    rig.check(q(kinds) === q(['builtin', 'picture']), '14 setup: the Trash here holds ' + q(kinds));
  });
  await lib.step(rig, '14 on 5.12.0', async () => {
    dm = await rig.restart({ exe: PREV });
    await lib.installHelpers(dm);
    const old = await dm.evaluate(`(async () => {
      for (const p of ['music', 'sounds', 'gallery', 'settings']) dockOpen(p);
      await _muRefreshTracks(); await soundboardRefreshOwn();
      const trash = await sceneTrash.list();
      return { bell: !!document.querySelector('#sb-cols [data-file="bell.mp3"]'), tema: [...document.querySelectorAll('#mu-list .mu-row-name')].map(n => n.textContent).includes('Тема'),
        trash: trash.length, pics: galleryList().length };
    })()`, 60000);
    rig.check(old.bell && old.tema && old.trash === 0 && old.pics === 2, '14: 5.12.0 reads the panes or its Trash wrong: ' + q(old));
    const base = await rig.fixtures.tableMap(dm, rig.fixtureDir, { w: 640, h: 480 });
    const file = await rig.fixtures.asFileExpr(dm, Object.assign({}, base, { name: 'Склеп.mp4' }));
    await dm.evaluate('createNewScene(' + file + ')', 240000);
    await dm.waitFor('allScenes.length === 1', 120000, 'the map on 5.12.0');
    await dm.evaluate(`(async () => { deleteScenesWithUndo([allScenes[0].id]); commitPendingDelete(); await sceneTrash.trashTrack('Дорога.wav'); return 0; })()`, 60000);
    const listed = await lib.poll(async () => { const l = await dm.evaluate('sceneTrash.list()', 20000); return l.length === 2 ? l : null; }, 20000, 200);
    rig.check(!!listed, '14: on 5.12.0 a map delete and a track delete did not both reach its Trash');
  });
};
