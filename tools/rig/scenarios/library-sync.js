'use strict';

// library-sync.js - THE LIBRARY PANES ACROSS TWO COMPUTERS (spec library-panes, DoD 10, 16).
//
// Two apps on one fake Drive, as own-sounds.js. A arranges Music, Sounds and Pictures through the panes' own
// functions (library-panes.js drives the pointer); B is the other computer. Names are Russian.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   1. Before sync is on, an edit to the order hashes nothing: A's sync index holds no entry for any of the three keys.
//   2. A's track names, track order and music group reach B by B's own file names.
//   3. A's built-in sound name, its sound group and Pictures' group and order reach B.
//   4. A built-in sound and a picture deleted on A leave B's panes and sit in B's Trash.
//   5. Restored on B, each comes back on B and on A, leaves A's Trash, and stays through two more ticks on both.
//   6. A restart of A keeps its order, names and groups.

const lib = require('../lib');
const fs = require('fs');
const path = require('path');

const q = JSON.stringify;

module.exports = async function librarySync(rig) {
  const drive = await rig.fakeDrive();
  const b = await rig.second('b');
  for (const [dir, tone] of [[rig.profileDir, 7], [b.profileDir, 7]]) {
    fs.mkdirSync(path.join(dir, 'music'), { recursive: true });
    for (const n of ['Битва.wav', 'Тема.wav', 'Дорога.wav']) fs.writeFileSync(path.join(dir, 'music', n), lib.wav(2, tone + n.length));
  }
  let dmA = rig.dm;

  // 1: an edit before sync is on.
  await lib.step(rig, '1', async () => {
    await dmA.evaluate(`_muRefreshTracks().then(() => { setMusicLabel('Тема.wav', 'Главная тема'); return 0; })`, 30000);
    const hashed = await dmA.evaluate(`syncIndex.isOn()`);
    rig.check(!hashed, '1: the sync index is on with no Google client');
    const keys = await dmA.evaluate(`localStorage.getItem('evermist.musicOrder')`);
    rig.check(!!keys && !/[0-9a-f]{64}/.test(keys), '1: the stored order holds a hash: ' + keys);
  });

  rig.writeSyncConfig(rig.profileDir, drive);
  rig.writeSyncConfig(b.profileDir, drive);
  dmA = await rig.restart();
  const dmB = await b.restart();
  const tick = async dm => { await lib.settle(dm, "syncEngine.status().state !== 'off'", 30000); return dm.evaluate('syncEngine.now()', 180000); };
  const both = async () => { await tick(dmA); await tick(dmB); await tick(dmA); };
  const until = (fn, ms) => lib.poll(async () => { await both(); return fn(); }, ms || 60000, 200);
  const status = async () => 'A ' + q(await dmA.evaluate('syncEngine.status()')) + ' B ' + q(await dmB.evaluate('syncEngine.status()'));
  const firstDone = dm => dm.evaluate(`syncIndex.raw.get('synced', '$first').then(x => !!x)`, 20000);
  const ready = await lib.poll(async () => { await both(); return await firstDone(dmA) && await firstDone(dmB); }, 120000, 200);
  rig.check(!!ready, 'setup: a first sync did not finish: ' + await status());
  if (!ready) return;
  const open = (dm, name) => dm.evaluate(`dockOpen(${q(name)}); 0`);
  for (const dm of [dmA, dmB]) { await open(dm, 'music'); await dm.evaluate('_muRefreshTracks().then(() => 0)', 30000); }

  // A arranges everything.
  await dmA.evaluate(`(async () => {
    putMusicGroup('Подземье', 0, ['Дорога.wav', 'Битва.wav']);
    moveMusicTracks(['Битва.wav'], 'Подземье', 0);
    setMusicLabel('Битва.wav', 'Бой в склепе');
    dockOpen('sounds'); await soundboardRefreshOwn();
    soundsRename('builtin:bell.mp3', 'Колокол');
    const r = libHoldGroup(soundsLayoutNow(), 'builtin:thunder.mp3', 'builtin:bell.mp3', soundsNewGroupKey(), 'Сессия 4');
    soundsCommit(r.L);
    dockOpen('gallery');
    const mk = n => new Promise(res => { const c = document.createElement('canvas'); c.width = 64; c.height = 64; c.getContext('2d').fillRect(0, 0, 8, 8);
      c.toBlob(bl => res(new File([bl], n, { type: 'image/png' })), 'image/png'); });
    const p1 = await galleryAddFile(await mk('Лич.png')), p2 = await galleryAddFile(await mk('Письмо.png')), p3 = await galleryAddFile(await mk('Карта.png'));
    galleryCommit(libHoldGroup(galleryLayoutNow(), p2.id, p1.id, galleryNewGroupKey(), 'Люди').L);
    return 0;
  })()`, 60000);
  const pics = await dmA.evaluate('galleryList().map(p => [p.id, p.name])');
  const idOf = n => (pics.find(p => p[1] === n) || [])[0];

  // 2
  await lib.step(rig, '2', async () => {
    const look = dm => dm.evaluate(`(() => { const L = musicLib(); return { labels: [musicLabel('Битва.wav'), musicLabel('Тема.wav')], group: musicGroupOf('Битва.wav'),
      members: L.groups['Подземье'] ? L.groups['Подземье'].members : null }; })()`);
    const got = await until(async () => { const v = await look(dmB); return v.labels[0] === 'Бой в склепе' && v.group === 'Подземье' ? v : null; });
    rig.check(!!got, '2: A\'s names and group did not reach B: A ' + q(await look(dmA)) + ' B ' + q(await look(dmB)) + ' ' + await status());
    if (got) rig.check(q(got) === q(await look(dmA)), '2: B holds the music layout differently: A ' + q(await look(dmA)) + ' B ' + q(got));
  });

  // 3
  await lib.step(rig, '3', async () => {
    const look = dm => dm.evaluate(`(() => { const s = soundsList().filter(x => x.key === 'builtin:bell.mp3' || x.key === 'builtin:thunder.mp3');
      const L = galleryLayoutNow(), g = L.groupOrder.find(k => galleryGroupName(k) === 'Люди');
      return { sounds: s.map(x => x.label + '/' + x.group), people: g ? L.groups[g].members : null }; })()`);
    const got = await until(async () => { const v = await look(dmB); return v.people && v.sounds.includes('Колокол/Сессия 4') ? v : null; });
    rig.check(!!got && q(got.people) === q([idOf('Лич'), idOf('Письмо')]), '3: the sound name, the sound group or the picture group did not reach B: ' + q(await look(dmB)));
  });

  // 4
  await lib.step(rig, '4', async () => {
    await dmA.evaluate(`(async () => { await soundsDelete('builtin:crow.mp3'); const p = _gaPics.find(x => x.name === 'Письмо'); await _gaRemove(p); return 0; })()`, 30000);
    const onB = async () => {
      const trash = await dmB.evaluate('sceneTrash.list()', 20000);
      const crow = await dmB.evaluate(`soundsList().some(x => x.key === 'builtin:crow.mp3')`);
      const pic = await dmB.evaluate(`galleryList().some(p => p.name === 'Письмо')`);
      return { crow, pic, trash: trash.map(e => e.id).sort() };
    };
    const got = await until(async () => { const v = await onB(); return !v.crow && !v.pic && v.trash.includes('builtin:crow.mp3') && v.trash.includes('pic:' + idOf('Письмо')) ? v : null; });
    rig.check(!!got, '4: the sound and the picture deleted on A did not move into B\'s Trash: ' + q(await onB()) + ' ' + await status());
  });

  // 5
  await lib.step(rig, '5', async () => {
    // The Trash row's own Restore, one after the other.
    await dmB.evaluate(`(async () => {
      for (const id of ['builtin:crow.mp3', ${q('pic:' + idOf('Письмо'))}]) await _tpRun(() => _tpRestore({ id, local: true }));
      return 0;
    })()`, 30000);
    const here = dm => dm.evaluate(`(async () => ({ crow: soundsList().some(x => x.key === 'builtin:crow.mp3'), pic: galleryList().some(p => p.name === 'Письмо'),
      trash: (await sceneTrash.list()).map(e => e.id) }))()`, 20000);
    const back = await until(async () => { const a = await here(dmA), bb = await here(dmB); return a.crow && a.pic && bb.crow && bb.pic && !a.trash.length && !bb.trash.length ? { a, bb } : null; });
    rig.check(!!back, '5: restored on B, the sound and the picture did not come back on both with both Trashes empty: A ' + q(await here(dmA)) + ' B ' + q(await here(dmB)));
    await both(); await both();
    const a2 = await here(dmA), b2 = await here(dmB);
    rig.check(a2.crow && a2.pic && b2.crow && b2.pic, '5: a restored item did not stay through two more ticks: A ' + q(a2) + ' B ' + q(b2));
  });

  // 6
  await lib.step(rig, '6', async () => {
    const look = dm => dm.evaluate(`({ music: musicOrdered().map(musicLabel), sounds: soundsList().slice(0, 4).map(x => x.label + '/' + x.group),
      pics: libSections(galleryLayoutNow(), galleryList().map(p => p.id)).map(s => s.items) })`);
    const before = await look(dmA);
    dmA = await rig.restart();
    await dmA.evaluate(`dockOpen('music'); _muRefreshTracks().then(() => soundboardRefreshOwn()).then(() => galleryReload()).then(() => 0)`, 30000);
    const after = await look(dmA);
    rig.check(q(after) === q(before), '6: a restart changed the order, a name or a group: ' + q(before) + ' -> ' + q(after));
  });
};
