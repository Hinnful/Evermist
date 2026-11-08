'use strict';

// sync-first.js - THE FIRST SYNC MERGES TWO FILLED LIBRARIES AND LOSES NOTHING (DoD 8).
//
// Two apps, no sync yet. A makes maps and exports them, then makes one more; B imports that file and adds a map of its
// own. Then each edits the same two maps differently: on Склеп A renames a room, replaces the map picture and writes a
// note, then B writes a newer note; on Мост B replaces the map picture. The campaign note differs too, B's the newer. A
// turns sync on and syncs alone, then B connects through Settings' Connect to Google, as the DM would on the second
// computer, answers the first-sync question Cancel, connects again and answers it yes, and both sync until nothing moves.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   Q. Before B's first sync, Connect asks first, in plain words: B holds 4 maps, the Drive 4 from one other computer,
//      merged with nothing deleted, and nothing syncs while it is open. Cancel signs B out again and leaves everything as it was: no token, Connect back,
//      nothing sent to the Drive, B's maps untouched. Connect again and yes starts the first sync.
//   A. B's first sync deletes nothing and replaces no map file: B keeps its own picture of Склеп though A's is newer,
//      no map leaves B, and no file leaves the Drive.
//   B. Every record the merge of the two libraries changes keeps a copy of what was there before, in `evermist-sync`
//      `copies`: on B, Склеп as it was before A's room name; on A, which synced first, Склеп before B's note.
//   C. Both end up agreeing by the newer-wins rules: every map of either library is on both; on both, Склеп has A's
//      room name and B's note, and the campaign note is B's; once the first syncs are over, each map's newer picture
//      is on both.
//   K. A map picture a sync replaced is kept 30 days in the sync data folder (`sync/kept/<map>.<time>.<ext>`): on A
//      its own picture of Мост, which B's newer one replaced; on B its picture of Склеп, replaced by A's after the
//      first sync. A kept file past 30 days is purged at start, a younger one stays.
//   R. On A's Campaign map, Мост's right-click menu offers "Restore previous picture" between "Export map…" and
//      "Delete map", and a map with no kept picture (Река) offers none; nothing is offered for a kept file of a map the
//      library does not hold. Restore on Мост while it is open shows "Close this map first" and changes nothing.
//      Closed, Restore puts A's own picture back, the picture it replaced becomes a kept file the menu still offers,
//      and after a sync B's Мост carries the restored picture.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const lib = require('../lib');
const kit = require('../backupKit');

module.exports = async function syncFirst(rig) {
  const q = JSON.stringify;
  let dmA = rig.dm;
  await kit.install(dmA);
  const add = (dm, name, seed) => dm.evaluate(`(async () => {
    const f = await __bk.noiseFile(${q(name)}, 800, 600, ${seed}, 0.85);
    const id = (await addMapsToLibrary([f], { x: ${seed * 300}, y: 0 }, true)).ids[0];
    await __bk.decorate(id, ${seed}, {});
    return id;
  })()`, 120000);
  const m = {};
  for (const [i, n] of ['Склеп', 'Мост', 'Башня'].entries()) m[n] = await add(dmA, n, i + 1);
  await dmA.evaluate(`notesCampaignSet('Кампания: общая')`);
  const zip = path.join(rig.outDir, 'sync-first-a.zip');
  await dmA.evaluate(`doExport(allScenes.map(s => s.id), { destPath: ${q(zip)} })`, 300000);
  rig.check(fs.existsSync(zip), 'setup: A was not exported');
  m['Река'] = await add(dmA, 'Река', 5);

  const b = await rig.second('b');
  let dmB = b.dm;
  await kit.install(dmB);
  await dmB.evaluate(`restoreFromZipPath(${q(zip)}, __bk.say)`, 300000);
  m['Порт'] = await add(dmB, 'Порт', 4);
  rig.check(await dmB.evaluate('allScenes.length') === 4, 'setup: B does not hold A\'s three maps and its own');

  const swapMap = (dm, id, seed) => dm.evaluate(`(async () => {
    const f = await __bk.noiseFile('новая', 960, 720, ${seed}, 0.85);
    await __bk.editScene(${q(id)}, s => { s.mapBlob = new Blob([f], { type: 'image/jpeg' }); s.mapWidth = 960; s.mapHeight = 720; });
  })()`, 60000);
  // In this order, so B's note and campaign note are the newer and A's room name has no rival.
  await dmA.evaluate(`__bk.editScene(${q(m['Склеп'])}, s => { s.polygons[0].name = 'A: зал'; s.notes = 'A: заметка (старая)'; })`, 20000);
  await swapMap(dmA, m['Склеп'], 11);
  await dmA.evaluate(`notesCampaignSet('Кампания: A'); 0`);
  await dmB.evaluate(`__bk.editScene(${q(m['Склеп'])}, s => { s.notes = 'B: заметка (новая)'; })`, 20000);
  await dmB.evaluate(`notesCampaignSet('Кампания: B'); 0`);
  await swapMap(dmB, m['Мост'], 12);

  const maps = dm => dm.evaluate(`(async () => { const o = {}; for (const s of allScenes) { const r = await sceneStore.loadScene(s.id); o[s.id] = r && r.mapBlob ? await __bk.hash(r.mapBlob) : null; } return o; })()`, 60000);
  const beforeA = await maps(dmA), beforeB = await maps(dmB);
  const roomA = await dmB.evaluate(`sceneStore.loadScene(${q(m['Склеп'])}).then(r => r.polygons[0].name)`, 20000);

  // A first, then B, each restarted with the config file as Connect leaves it.
  const drive = await rig.fakeDrive();
  rig.writeSyncConfig(rig.profileDir, drive);
  const keptA = path.join(rig.profileDir, 'sync', 'kept');
  const old = 'zz.' + (Date.now() - 31 * 864e5) + '.jpg', young = 'zz.' + (Date.now() - 864e5) + '.jpg';
  fs.mkdirSync(keptA, { recursive: true });
  for (const n of [old, young]) fs.writeFileSync(path.join(keptA, n), 'x');
  dmA = await rig.restart();
  await kit.install(dmA);
  // A tick asked for before the engine has started does nothing, so every first tick waits for it.
  const tick = async dm => { await lib.settle(dm, "syncEngine.status().state !== 'off'", 30000); return dm.evaluate('syncEngine.now()', 180000); };
  const status = async () => 'A ' + q(await dmA.evaluate('syncEngine.status()')) + ' B ' + q(await dmB.evaluate('syncEngine.status()'));
  await dmA.evaluate(`switchScene(${q(m['Река'])})`, 30000);
  await tick(dmA);
  rig.check(drive.files().some(f => f.name === 'scene~' + m['Склеп'] + '.json'), 'setup: A\'s first sync sent nothing: ' + await status());
  rig.writeSyncConfig(b.profileDir, drive);
  const tokenB = path.join(b.profileDir, 'sync', 'token.json');
  fs.unlinkSync(tokenB);
  dmB = await b.restart();
  await kit.install(dmB);
  await dmB.evaluate(`switchScene(${q(m['Порт'])})`, 30000);

  // Q
  const shown = id => dmB.evaluate(`(() => { const el = document.getElementById(${q(id)}); return !!el && el.offsetParent !== null && el.offsetHeight > 0; })()`);
  await dmB.evaluate(`(() => { if (document.getElementById('dock-pane-settings').hidden) document.getElementById('dock-tab-settings').click(); })()`);
  const ask = async () => {
    await lib.poll(async () => shown('sy-connect'), 20000, 200);
    await dmB.evaluate(`document.getElementById('sy-connect').click(); 0`);
    return lib.poll(async () => (await shown('cd-ok')) && dmB.evaluate(`document.getElementById('cd-msg').textContent`), 30000, 200);
  };
  const driveBefore = q(drive.files().map(f => f.name + f.modifiedTime).sort());
  const said = await ask();
  rig.note('the first-sync question: ' + q(said));
  rig.check(!!said && said.includes('This computer holds 4 maps.') && said.includes('Your Google Drive holds 4 maps.') && said.includes('Sent from one other computer.') && said.includes('nothing is deleted'),
    'Q: the first-sync question does not say B holds 4 maps and the Drive 4 from one other computer, nothing deleted: ' + q(said));
  rig.check(drive.stats.consents === 1, 'Q: Connect did not go through the consent page: ' + drive.stats.consents);
  await dmB.evaluate('syncEngine.now()', 60000);
  rig.check(q(drive.files().map(f => f.name + f.modifiedTime).sort()) === driveBefore, 'Q: B synced while the question was open');
  if (said) await dmB.evaluate(`document.getElementById('cd-cancel').click(); 0`);
  const out = await lib.poll(async () => await shown('sy-connect') && !(await shown('cd-ok')) && (await dmB.evaluate('syncEngine.status().state')) === 'signedOut', 30000, 200);
  rig.check(!!out, 'Q: Cancel did not sign B out: ' + await status());
  rig.check(['token.json', 'token.enc'].every(f => !fs.existsSync(path.join(b.profileDir, 'sync', f))), 'Q: Cancel left B\'s token on disk');
  rig.check(q(drive.files().map(f => f.name + f.modifiedTime).sort()) === driveBefore, 'Q: Connect and Cancel changed the Drive');
  rig.check(q(await maps(dmB)) === q(beforeB) && !(await dmB.evaluate(`syncIndex.raw.get('synced', '$first').then(x => !!x)`, 20000)), 'Q: Connect and Cancel changed B\'s library or ran its first sync');
  const again = await ask();
  rig.check(!!again, 'Q: the second Connect did not ask again');
  if (!again) return;
  await dmB.evaluate(`document.getElementById('cd-ok').click(); 0`);
  const firstDone = dm => dm.evaluate(`syncIndex.raw.get('synced', '$first').then(x => !!x)`, 20000);
  const bFirst = await lib.poll(async () => { await tick(dmB); return (await dmB.evaluate('syncEngine.status().pending')) === 0 && await firstDone(dmB); }, 120000, 300);
  rig.check(!!bFirst, 'setup: B\'s first sync did not finish: ' + await status());
  if (!bFirst) return;

  // A
  const afterB = await maps(dmB);
  rig.check(afterB[m['Склеп']] === beforeB[m['Склеп']], 'A: B\'s first sync replaced its picture of Склеп: ' + beforeB[m['Склеп']] + ' -> ' + afterB[m['Склеп']]);
  rig.check(Object.keys(beforeB).every(id => id in afterB), 'A: B\'s first sync removed a map');
  rig.check(!drive.stats.deletes.some(n => !n.endsWith('.json')), 'A: a first sync removed files from the Drive: ' + q(drive.stats.deletes));

  const settled = await lib.poll(async () => {
    await tick(dmA); await tick(dmB);
    const [sa, sb] = [await dmA.evaluate('syncEngine.status()'), await dmB.evaluate('syncEngine.status()')];
    if (sa.pending || sb.pending) return false;
    const [ma, mb] = [await maps(dmA), await maps(dmB)];
    return Object.keys(ma).length === 5 && Object.keys(ma).every(id => ma[id] === mb[id]);
  }, 180000, 300);
  rig.check(!!settled, 'C: the two libraries did not come to agree: ' + await status() + ' A ' + q(await maps(dmA)) + ' B ' + q(await maps(dmB)));

  // B
  const copies = dm => dm.evaluate(`syncIndex.raw.all('copies').then(l => l.map(c => ({ of: c.of, at: c.at, room: c.copy && c.copy.polygons ? c.copy.polygons[0].name : null, notes: c.copy && c.copy.notes })))`, 20000);
  const [ca, cb] = [await copies(dmA), await copies(dmB)];
  rig.note('copies on A ' + q(ca.map(c => c.of)) + ', on B ' + q(cb.map(c => c.of)));
  const sk = 'scene:' + m['Склеп'];
  rig.check(cb.some(c => c.of === sk && c.room === roomA && c.notes === 'B: заметка (новая)'), 'B: B kept no copy of Склеп as it was before A\'s room name: ' + q(cb));
  rig.check(ca.some(c => c.of === sk && c.notes === 'A: заметка (старая)' && c.room === 'A: зал'), 'B: A kept no copy of Склеп as it was before B\'s note: ' + q(ca));
  rig.check(ca.concat(cb).every(c => Date.now() - c.at < 600000), 'B: a copy carries no time to purge it by');

  // C
  for (const [who, dm] of [['A', dmA], ['B', dmB]]) {
    const ids = await dm.evaluate('allScenes.map(s => s.id)');
    rig.check(Object.values(m).every(id => ids.includes(id)), 'C: ' + who + ' lacks a map: ' + q(ids));
    const s = await dm.evaluate(`sceneStore.loadScene(${q(m['Склеп'])}).then(r => ({ room: r.polygons[0].name, notes: r.notes }))`, 20000);
    rig.check(s.room === 'A: зал' && s.notes === 'B: заметка (новая)', 'C: Склеп on ' + who + ' is not A\'s room name with B\'s note: ' + q(s));
    rig.check(await dm.evaluate('notesCampaignGet()') === 'Кампания: B', 'C: the campaign note on ' + who + ' is not B\'s newer one: ' + q(await dm.evaluate('notesCampaignGet()')));
  }
  const end = await maps(dmA);

  // K
  const hashOf = buf => crypto.createHash('sha256').update(buf).digest().subarray(0, 10).toString('hex') + ':' + buf.length;
  const kept = (profile, id) => { try { return fs.readdirSync(path.join(profile, 'sync', 'kept')).filter(n => n.startsWith(id + '.')).map(n => hashOf(fs.readFileSync(path.join(profile, 'sync', 'kept', n)))); } catch (_) { return []; } };
  rig.check(kept(rig.profileDir, m['Мост']).includes(beforeA[m['Мост']]), 'K: A did not keep its own picture of Мост in sync/kept: ' + q(kept(rig.profileDir, m['Мост'])) + ' want ' + beforeA[m['Мост']]);
  rig.check(kept(b.profileDir, m['Склеп']).includes(beforeB[m['Склеп']]), 'K: B did not keep its own picture of Склеп in sync/kept: ' + q(kept(b.profileDir, m['Склеп'])) + ' want ' + beforeB[m['Склеп']]);
  rig.check(!fs.existsSync(path.join(keptA, old)) && fs.existsSync(path.join(keptA, young)), 'K: the kept file past 30 days was not purged at start, or the younger one went too: ' + q(fs.readdirSync(keptA)));
  rig.check(end[m['Склеп']] === beforeA[m['Склеп']] && end[m['Мост']] === beforeB[m['Мост']], 'C: the newer pictures did not win: Склеп ' + end[m['Склеп']] + ' (A\'s ' + beforeA[m['Склеп']] + '), Мост ' + end[m['Мост']] + ' (B\'s ' + beforeB[m['Мост']] + ')');

  // R
  const mo = m['Мост'];
  const keptHere = () => fs.readdirSync(keptA).filter(n => n.startsWith(mo + '.'));
  const own = keptHere().find(n => hashOf(fs.readFileSync(path.join(keptA, n))) === beforeA[mo]);
  if (!own) return;
  // The menu a right-click on a map's card opens, as its rows' words with '|' for a separator; `pick` clicks one.
  const menu = (id, pick) => dmA.evaluate(`(() => {
    worldMapMenuClose();
    const card = _wmEls.get('c' + ${q(id)});
    if (!card) return null;
    const r = card.getBoundingClientRect();
    card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    const m = document.querySelector('.wm-menu');
    if (!m) return null;
    const rows = Array.from(m.children).map(c => c.classList.contains('sm-msep') ? '|' : c.textContent);
    const hit = ${q(pick || null)} && Array.from(m.querySelectorAll('.sm-mi')).find(b => b.textContent === ${q(pick || null)});
    if (hit) hit.click(); else worldMapMenuClose();
    return rows;
  })()`);
  const mapHash = dm => dm.evaluate(`sceneStore.loadScene(${q(mo)}).then(r => r && r.mapBlob ? __bk.hash(r.mapBlob) : null)`, 20000);
  const shownA = id => dmA.evaluate(`(() => { const el = document.getElementById(${q(id)}); return !!el && el.offsetParent !== null && el.offsetHeight > 0; })()`);
  await dmA.evaluate(`worldMapShow(); 0`);
  const offered = await lib.poll(async () => { const r = await menu(mo); return r && r.includes('Restore previous picture') ? r : null; }, 20000, 300);
  rig.check(!!offered, 'R: Мост\'s menu on the Campaign map does not offer Restore previous picture: ' + q(await menu(mo)));
  if (!offered) return;
  const at = offered.indexOf('Restore previous picture');
  rig.check(offered[at - 1] === 'Export map…' && offered[at + 1] === '|' && offered[at + 2] === 'Delete map', 'R: Restore previous picture does not sit between Export map… and Delete map: ' + q(offered));
  rig.check(!(await menu(m['Река'])).includes('Restore previous picture'), 'R: Река, with no kept picture, offers Restore previous picture: ' + q(await menu(m['Река'])));
  rig.check(await dmA.evaluate(`_wmKeptPics.get(${q(mo)}) === ${q(own)} && Array.from(_wmKeptPics.keys()).every(id => allScenes.some(s => s.id === id))`), 'R: the menu would restore something other than A\'s own picture of Мост, or offers a map the library does not hold: ' + q(await dmA.evaluate('Array.from(_wmKeptPics)')));
  await dmA.evaluate(`worldMapHide(); 0`);

  await dmA.evaluate(`switchScene(${q(mo)})`, 30000);
  const filesBefore = q(keptHere().sort());
  // ⚠ The map flies to the open scene first, and a right-click during the fly opens no menu.
  await dmA.evaluate(`worldMapShow(); 0`);
  await lib.settle(dmA, '!_wmAnim', 10000);
  rig.check(!!(await menu(mo, 'Restore previous picture')), 'R: Мост\'s menu did not open to press Restore previous picture');
  const told = await lib.poll(async () => (await shownA('cd-ok')) && dmA.evaluate(`document.getElementById('cd-title').textContent`), 20000, 200);
  rig.check(told === 'Close this map first', 'R: Restore on the open Мост did not say to close it first: ' + q(told));
  rig.check(await mapHash(dmA) === beforeB[mo] && q(keptHere().sort()) === filesBefore, 'R: Restore on the open Мост changed its picture or the kept files');
  if (told) await dmA.evaluate(`document.getElementById('cd-ok').click(); 0`);
  await dmA.evaluate(`worldMapHide(); 0`);
  await dmA.evaluate(`switchScene(${q(m['Река'])})`, 30000);

  // ⚠ The map flies to the open scene first, and a right-click during the fly opens no menu.
  await dmA.evaluate(`worldMapShow(); 0`);
  await lib.settle(dmA, '!_wmAnim', 10000);
  rig.check(!!(await menu(mo, 'Restore previous picture')), 'R: Мост\'s menu did not open to press Restore previous picture');
  const back = await lib.poll(async () => (await mapHash(dmA)) === beforeA[mo], 30000, 300);
  rig.check(!!back, 'R: Restore did not put A\'s own picture of Мост back: ' + await mapHash(dmA) + ' want ' + beforeA[mo]);
  const theirs = keptHere().find(n => n !== own && hashOf(fs.readFileSync(path.join(keptA, n))) === beforeB[mo]);
  rig.check(!!theirs, 'R: the picture Restore replaced was not kept: ' + q(keptHere().map(n => n + ' ' + hashOf(fs.readFileSync(path.join(keptA, n))))));
  const newRow = await lib.poll(async () => (await dmA.evaluate(`_wmKeptPics.get(${q(mo)})`)) === theirs && (await menu(mo)).includes('Restore previous picture'), 20000, 200);
  rig.check(!!newRow, 'R: the picture Restore replaced is not what Мост\'s menu now offers back: ' + q(await dmA.evaluate('Array.from(_wmKeptPics)')));
  await dmA.evaluate(`worldMapHide(); 0`);
  const onB = await lib.poll(async () => { await tick(dmA); await tick(dmB); return (await mapHash(dmB)) === beforeA[mo]; }, 120000, 300);
  rig.check(!!onB, 'R: after a sync B\'s Мост does not carry the restored picture: ' + await mapHash(dmB) + ' want ' + beforeA[mo] + ' ' + await status());
  rig.check(await mapHash(dmA) === beforeA[mo], 'R: the sync took the restored picture back off A: ' + await mapHash(dmA));
};
