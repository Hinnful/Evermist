'use strict';

// own-sounds.js - THE DM'S OWN SOUND FILES ON THE SOUNDBOARD: ADD, PLAY, RENAME, TRASH WITH UNDO, THE 10 MB LIMIT, SYNC.
//
// Two apps on one fake Drive, as sync-music.js. A gets sounds the way the DM adds them, round the native picker
// (`_sbAddFiles` is the picker's own handler past the dialog); B is the other computer. Every sound is a WAV written
// here, and every check on a folder reads the profile's own `sounds` folder from disk.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   1. With no sound added, "My sounds" is not shown and the "+ Add" button is.
//   2. Added files are copied into userData/sounds and show at once as rows at the top of Ungrouped, the first section.
//   3. An added sound plays like a built-in one: it decodes, a left click adds a copy (×2), a right click stops the
//      newest, and the copies run through the pane's volume.
//   4. A sound renamed with Rename in its ⋯ keeps its file's name on disk, and the new name is the row's after a restart.
//   5. ⋯ > Delete sends the sound to userData/trash/sounds with '"Шестерни" moved to Trash'; Undo brings it back under
//      its name.
//   6. A file over 10 MB is refused with "That sound is too long", pointing to the Music pane, and nothing is copied.
//   7. The sounds reach B and play there, the renamed one under its new name; a sound deleted on A leaves B and sits in
//      B's Trash; Restore on B brings it back on both. No sound shows in either Music pane.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const lib = require('../lib');

const q = JSON.stringify;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const BELL = 'Колокол.wav', GEARS = 'Шестерни.wav', BIG = 'Длинный.wav', RENAMED = 'Хрустальный звон';

module.exports = async function ownSounds(rig) {
  const drive = await rig.fakeDrive();
  const b = await rig.second('b');
  rig.writeSyncConfig(rig.profileDir, drive);
  rig.writeSyncConfig(b.profileDir, drive);
  let dmA = await rig.restart();
  const dmB = await b.restart();
  const dirA = path.join(rig.profileDir, 'sounds'), dirB = path.join(b.profileDir, 'sounds');
  const trashA = path.join(rig.profileDir, 'trash', 'sounds');
  const src = path.join(rig.outDir, 'sounds-src');
  fs.mkdirSync(src, { recursive: true });

  const files = d => { try { return fs.readdirSync(d).filter(n => !n.startsWith('.')).sort(); } catch (_) { return []; } };
  const folder = d => files(d).map(n => ({ name: n, hash: sha(fs.readFileSync(path.join(d, n))) }));
  const nameOf = (d, h) => (folder(d).find(t => t.hash === h) || {}).name || null;
  const tick = async dm => { await lib.settle(dm, "syncEngine.status().state !== 'off'", 30000); return dm.evaluate('syncEngine.now()', 180000); };
  const both = async () => { await tick(dmA); await tick(dmB); };
  const until = (fn, ms) => lib.poll(async () => { await both(); return fn(); }, ms || 45000, 200);
  const status = async () => 'A ' + q(await dmA.evaluate('syncEngine.status()')) + ' B ' + q(await dmB.evaluate('syncEngine.status()'));
  const openPane = dm => dm.evaluate(`(() => { if (document.getElementById('dock-pane-sounds').hidden) document.getElementById('dock-tab-sounds').click(); return !document.getElementById('dock-pane-sounds').hidden; })()`);
  const tiles = dm => dm.evaluate(`soundboardRefreshOwn().then(() => [...document.querySelectorAll('#sb-cols .sb-row')].filter(r => r.dataset.file.startsWith('my/')).map(r => r.querySelector('.lib-name').textContent))`, 20000);
  const tile = name => `document.querySelector('#sb-cols [data-file=' + CSS.escape(${q('my/' + name)}) + ']')`;
  const menuPick = (dm, name, label) => dm.evaluate(`(() => { ${tile(name)}.querySelector('.lib-more').click();
    const b = [...document.querySelectorAll('.lib-menu .sm-mi')].find(x => x.querySelector('.nm').textContent === ${q(label)}); if (b) b.click(); return !!b; })()`);
  const decoded = (dm, name) => dm.evaluate(`(async () => { _sbEnsureCtx(); try { return (await _sbBuffer(${q('my/' + name)})).duration; } catch (_) { return 0; } })()`, 20000);
  const toast = dm => dm.evaluate(`(() => { const t = document.getElementById('scene-undo-toast'); return t.style.display === 'none' ? null : t.querySelector('.undo-msg').textContent; })()`);
  const dialog = dm => dm.evaluate(`(() => { const ok = document.getElementById('cd-ok'); return ok && ok.offsetParent !== null ? { title: document.getElementById('cd-title').textContent, msg: document.getElementById('cd-msg').textContent } : null; })()`);
  const firstDone = dm => dm.evaluate(`syncIndex.raw.get('synced', '$first').then(x => !!x)`, 20000);

  const ready = await lib.poll(async () => { await both(); return await firstDone(dmA) && await firstDone(dmB); }, 120000, 200);
  rig.check(!!ready, 'setup: a first sync did not finish: ' + await status());
  if (!ready) return;

  const bell = lib.wav(3, 8), gears = lib.wav(3, 11), hBell = sha(bell), hGears = sha(gears);
  fs.writeFileSync(path.join(src, BELL), bell);
  fs.writeFileSync(path.join(src, GEARS), gears);

  // 1
  await lib.step(rig, '1', async () => {
    rig.check(await openPane(dmA), '1 setup: the Sounds pane did not open');
    const look = await dmA.evaluate(`({ own: [...document.querySelectorAll('#sb-cols .lib-gh .lib-name')].some(n => n.textContent === 'My sounds'),
      add: !!document.getElementById('btn-sb-add') && document.getElementById('btn-sb-add').offsetParent !== null && document.getElementById('btn-sb-add').textContent.trim() === 'Add' })`);
    rig.check(!look.own && look.add, '1: with no sound added, "My sounds" shows or "+ Add" does not: ' + q(look));
  });

  // 2
  await lib.step(rig, '2', async () => {
    await dmA.evaluate(`_sbAddFiles([${q(path.join(src, BELL))}, ${q(path.join(src, GEARS))}]).then(() => 0)`, 30000);
    rig.check(nameOf(dirA, hBell) === BELL && nameOf(dirA, hGears) === GEARS, '2: the files were not copied into userData/sounds: ' + q(files(dirA)));
    rig.check(q(await tiles(dmA)) === q(['Колокол', 'Шестерни']), '2: "My sounds" does not show the two tiles: ' + q(await tiles(dmA)));
    const first = await dmA.evaluate(`(() => { const s = document.querySelector('#sb-cols > .lib-sec'); return s && s.dataset.libGroup === '' ? [...s.querySelectorAll('.sb-row')].slice(0, 2).map(r => r.dataset.file) : null; })()`);
    rig.check(q(first) === q(['my/Колокол.wav', 'my/Шестерни.wav']), '2: the added sounds are not at the top of Ungrouped, the first section: ' + q(first));
  });

  // 3
  await lib.step(rig, '3', async () => {
    const secs = await decoded(dmA, BELL);
    rig.check(secs > 2.5 && secs < 3.5, '3: the added sound did not decode to its 3 seconds: ' + secs);
    const key = q('my/' + BELL);
    await dmA.evaluate(`${tile(BELL)}.click(); 0`);
    await lib.settle(dmA, `(_sbPlaying[${key}] || []).length === 1`, 10000);
    await dmA.evaluate(`${tile(BELL)}.click(); 0`);
    await lib.settle(dmA, `(_sbPlaying[${key}] || []).length === 2`, 10000);
    const two = await dmA.evaluate(`({ n: (_sbPlaying[${key}] || []).length, count: ${tile(BELL)}.querySelector('.sb-count').textContent, on: ${tile(BELL)}.classList.contains('sb-row-on') })`);
    rig.check(two.n === 2 && two.count === '×2' && two.on, '3: two left clicks did not play two copies: ' + q(two));
    await dmA.evaluate(`${tile(BELL)}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); 0`);
    rig.check(await dmA.evaluate(`(_sbPlaying[${key}] || []).length`) === 1, '3: a right click did not stop the newest copy');
    await dmA.evaluate(`document.getElementById('sb-vol').value = '20'; document.getElementById('sb-vol').dispatchEvent(new Event('input')); 0`);
    const vol = await dmA.evaluate(`({ master: _sbMaster.gain.value, ctx: _sbPlaying[${key}][0].gain.context === _sbMaster.context })`);
    rig.check(Math.abs(vol.master - 0.2) < 0.001 && vol.ctx, '3: the pane\'s volume does not reach the added sound: ' + q(vol));
    await dmA.evaluate(`while (_sbPlaying[${key}]) _sbStopNewest(${key}); 0`);
  });

  // 4
  await lib.step(rig, '4', async () => {
    rig.check(await menuPick(dmA, BELL, 'Rename'), '4 setup: the ⋯ has no Rename');
    await dmA.evaluate(`(() => { const f = document.querySelector('#sb-cols .lib-edit'); f.value = ${q(RENAMED)}; f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 0; })()`);
    const kept = await lib.poll(async () => (await tiles(dmA)).includes(RENAMED), 10000, 100);
    rig.check(!!kept && nameOf(dirA, hBell) === BELL, '4: the rename did not change the name alone, the file keeping its own: ' + q(files(dirA)));
    dmA = await rig.restart();
    await openPane(dmA);
    const after = await tiles(dmA);
    rig.check(after.includes(RENAMED) && !after.includes('Колокол'), '4: the new name did not survive a restart: ' + q(after));
    rig.check(await decoded(dmA, BELL) > 2.5, '4: the renamed sound does not decode');
  });

  // 5
  await lib.step(rig, '5', async () => {
    await menuPick(dmA, GEARS, 'Delete');
    const gone = await lib.poll(async () => !nameOf(dirA, hGears) && files(trashA).length === 1 && await toast(dmA), 15000, 100);
    rig.check(!!gone, '5: × did not move the sound to the Trash: sounds ' + q(files(dirA)) + ', trash ' + q(files(trashA)));
    rig.check(await toast(dmA) === '"Шестерни" moved to Trash', '5: the toast reads ' + q(await toast(dmA)));
    rig.check(!(await tiles(dmA)).includes('Шестерни'), '5: the deleted sound still has a tile');
    await dmA.evaluate(`document.querySelector('#scene-undo-toast .undo-btn').click(); 0`);
    const back = await lib.poll(() => nameOf(dirA, hGears) === GEARS && !files(trashA).length, 15000, 100);
    rig.check(!!back, '5: Undo did not bring the sound back under its name: ' + q(files(dirA)));
    rig.check((await tiles(dmA)).includes('Шестерни'), '5: the sound Undo brought back has no tile');
    rig.check(!(await dmA.evaluate('sceneTrash.list()', 20000)).length, '5: the Trash still lists the sound after Undo');
  });

  // 6
  await lib.step(rig, '6', async () => {
    fs.writeFileSync(path.join(src, BIG), Buffer.alloc(10 * 1024 * 1024 + 1));
    await dmA.evaluate(`_sbAddFiles([${q(path.join(src, BIG))}]).then(() => 0)`, 30000);
    const d = await lib.poll(() => dialog(dmA), 10000, 100);
    rig.check(!!d && d.title === 'That sound is too long' && /Длинный\.wav/.test(d.msg) && /Music pane/.test(d.msg), '6: no "too long" message pointing to the Music pane: ' + q(d));
    rig.check(!files(dirA).includes(BIG), '6: the file over 10 MB was copied: ' + q(files(dirA)));
    if (d) await dmA.evaluate(`document.getElementById('cd-ok').click(); 0`);
  });

  // 7
  await lib.step(rig, '7', async () => {
    const got = await until(() => nameOf(dirB, hBell) && nameOf(dirB, hGears));
    rig.check(!!got, '7: the sounds did not reach B: ' + q(files(dirB)) + ' ' + await status());
    if (!got) return;
    await openPane(dmB);
    const onB = await until(async () => (await tiles(dmB)).includes(RENAMED));
    rig.check(!!onB && (await tiles(dmB)).length === 2, '7: B does not show the two sounds, the renamed one by its new name: ' + q(await tiles(dmB)));
    rig.check(await decoded(dmB, nameOf(dirB, hGears)) > 2.5, '7: a sound that reached B does not decode there');
    const music = async dm => dm.evaluate('_muRefreshTracks().then(() => _muTracks.length)', 30000);
    rig.check(await music(dmA) === 0 && await music(dmB) === 0, '7: a sound shows in a Music pane');

    await menuPick(dmA, GEARS, 'Delete');
    await lib.poll(() => !nameOf(dirA, hGears), 15000, 100);
    const left = await until(async () => !nameOf(dirB, hGears) && (await dmB.evaluate('sceneTrash.list()', 20000)).some(e => e.kind === 'sounds' && e.hash === hGears));
    rig.check(!!left, '7: the sound deleted on A did not leave B for its Trash: ' + q(files(dirB)) + ' ' + q(await dmB.evaluate('sceneTrash.list()', 20000)));
    if (!left) return;
    const row = (await dmB.evaluate('sceneTrash.list()', 20000)).find(e => e.hash === hGears);
    await dmB.evaluate(`(async () => {
      if (document.getElementById('dock-pane-settings').hidden) document.getElementById('dock-tab-settings').click();
      await trashPanelRefresh();
      document.querySelector('#sy-trash [data-restore=' + CSS.escape(${q(row.id)}) + ']').click();
      return 0;
    })()`, 20000);
    const restored = await until(() => nameOf(dirA, hGears) && nameOf(dirB, hGears));
    rig.check(!!restored, '7: Restore on B did not bring the sound back on both: A ' + q(files(dirA)) + ' B ' + q(files(dirB)));
  });
};
