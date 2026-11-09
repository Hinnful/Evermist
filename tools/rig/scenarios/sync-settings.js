'use strict';

// sync-settings.js - SETTINGS' GOOGLE DRIVE LINE, SHOWN ONLY WITH A GOOGLE CLIENT, AND RECENTLY DELETED WITH SYNC: EVERY BUTTON WORKS.
//
// One app with no Google client, then the same app with one from the environment as a dev run reads it, then two apps
// on one fake Drive through the sync config file. Every action goes through the line's own button and the Recently
// deleted pop-out's. Run from the
// repo: a build that carries a client is sync-client.js's.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   A. Without a Google client (no built-in file, no environment, no sync config file) Settings shows no Google Drive
//      line, and sync keeps no index. The Trash shows all the same: it is this computer's trash too.
//   A2. With a client in GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and no sync config file, Settings shows the line
//      signed out: Connect, no Disconnect, and no index until this computer connects, so a DM who never connects pays
//      nothing on a save. Connect hands the system browser Google's consent
//      page for that client, the hidden Drive folder its only scope, answered on the loopback. (The browser is caught on
//      Linux only.)
//   B. With the sync config file, Settings shows the Google Drive line signed in: Disconnect, no Connect, no Sync now.
//   C. The status line under the name moves to a new sync's time.
//   D. Disconnect signs this computer out: the line says so, Connect comes back, the Trash stays and the token
//      is gone.
//      Connect signs it in again through the consent page and the loopback, PKCE checked, and sync resumes.
//   E. A map deleted on A shows in B's Trash pop-out with its name and date, the line counting it; Restore
//      there brings it back on B.
//   F. Empty now asks first, "Everything in the Trash is deleted for good, on every computer. This cannot be undone.",
//      its button's title saying "on every computer" too, and on yes removes the map from the list for good, and its
//      files from the Drive.
//   G. Campaign ends with one deleted map listed on A, for the screenshot (--shot "#wm-bg-group").

const fs = require('fs');
const path = require('path');
const lib = require('../lib');
const kit = require('../backupKit');

module.exports = async function syncSettings(rig) {
  const q = JSON.stringify;
  const openSettings = dm => dm.evaluate(`(() => { if (document.getElementById('dock-pane-settings').hidden) document.getElementById('dock-tab-settings').click(); return !document.getElementById('dock-pane-settings').hidden; })()`);
  const shown = (dm, id) => dm.evaluate(`(() => { const el = document.getElementById(${q(id)}); return !!el && el.offsetParent !== null && el.offsetHeight > 0; })()`);
  const line = dm => dm.evaluate(`document.getElementById('sy-line').textContent`);
  const click = (dm, sel) => dm.evaluate(`document.querySelector(${q(sel)}).click(); 0`);
  const rows = dm => dm.evaluate(`Array.from(document.querySelectorAll('#sy-trash .dk-trash-row')).map(r => ({ name: r.querySelector('.nm').textContent, date: r.querySelector('.mt').textContent, id: r.querySelector('[data-restore]').dataset.restore }))`);

  // A
  let dmA = rig.dm;
  rig.check(await openSettings(dmA), 'A: Settings did not open');
  rig.check(!(await shown(dmA, 'sy-group')) && await dmA.evaluate(`document.getElementById('sy-group').hidden`), 'A: Settings shows the Google Drive line without a Google client');
  rig.check(await shown(dmA, 'sy-trash-open'), 'A: Settings hides the Trash without a Google client');
  rig.check(await dmA.evaluate('!syncIndex.isOn()'), 'A: sync keeps an index without a Google client');

  // A2
  const ENV_ID = 'rig-env-id.apps.googleusercontent.com';
  const browser = rig.catchBrowser();
  dmA = await rig.restart({ env: Object.assign({ GOOGLE_CLIENT_ID: ENV_ID, GOOGLE_CLIENT_SECRET: 'rig-env-secret' }, browser ? browser.env : {}) });
  await openSettings(dmA);
  const envUp = await lib.poll(async () => await shown(dmA, 'sy-group') && await shown(dmA, 'sy-connect'), 20000, 200);
  rig.check(!!envUp, 'A2: with a client in the environment, Settings does not show the Google Drive line with Connect');
  rig.check(!(await shown(dmA, 'sy-disconnect')) && !(await dmA.evaluate('syncIndex.isOn()')), 'A2: signed out, Disconnect shows or sync keeps an index before any Connect');
  if (!browser) rig.byEye('A2: Connect opens Google\'s consent page for the client in the environment (the browser is caught on Linux only)');
  else if (envUp) {
    const faults = lib.consentFaults(await lib.connectOpens(dmA, browser), ENV_ID);
    rig.check(!faults.length, 'A2: Connect did not hand the browser the consent page for the environment\'s client: ' + faults.join('; '));
  }

  const drive = await rig.fakeDrive();
  const b = await rig.second('b');
  rig.writeSyncConfig(rig.profileDir, drive);
  rig.writeSyncConfig(b.profileDir, drive);
  dmA = await rig.restart();
  const dmB = await b.restart();
  const status = async () => 'A ' + q(await dmA.evaluate('syncEngine.status()')) + ' B ' + q(await dmB.evaluate('syncEngine.status()'));
  const tick = dm => dm.evaluate('syncEngine.now()', 120000);
  const has = (dm, id) => dm.evaluate(`allScenes.some(s => s.id === ${q(id)})`);

  // B
  for (const dm of [dmA, dmB]) await openSettings(dm);
  const up = await lib.poll(async () => await shown(dmB, 'sy-group') && await shown(dmA, 'sy-group'), 20000, 200);
  rig.check(!!up, 'B: the Google Drive line did not show with the sync config file');
  rig.check(await shown(dmB, 'sy-disconnect') && !(await shown(dmB, 'sy-connect')) && !(await dmB.evaluate(`!!document.getElementById('sy-now')`)), 'B: a signed-in computer does not show Disconnect alone, without Connect and Sync now');

  // C
  await kit.install(dmA);
  const ids = await dmA.evaluate(`(async () => {
    const out = [];
    for (const [i, n] of ['Склеп', 'Пещера', 'Башня'].entries()) {
      const f = await __bk.noiseFile(n, 800, 600, i + 1, 0.8);
      out.push((await addMapsToLibrary([f], { x: i * 300, y: 0 }, true)).ids[0]);
    }
    return out;
  })()`, 120000);
  await lib.poll(async () => (await dmB.evaluate('syncEngine.status().state')) !== 'syncing', 60000, 200);
  const before = await dmB.evaluate('syncEngine.status().last');
  await tick(dmB);
  const moved = await lib.poll(async () => {
    const st = await dmB.evaluate('syncEngine.status()');
    return st.state === 'idle' && st.last > before && /^Last synced /.test(await line(dmB));
  }, 60000, 200);
  rig.check(!!moved, 'C: a sync did not move the status line to its time: ' + q(await line(dmB)) + ' ' + await status());

  // D
  await click(dmB, '#sy-disconnect');
  const out = await lib.poll(async () => /^Signed out/.test(await line(dmB)) && await shown(dmB, 'sy-connect'), 30000, 200);
  rig.check(!!out, 'D: Disconnect did not sign B out: ' + q(await line(dmB)) + ' ' + await status());
  rig.check(!(await shown(dmB, 'sy-disconnect')) && await shown(dmB, 'sy-trash-open'), 'D: signed out, Disconnect still shows or the Trash hides');
  rig.check(['token.json', 'token.enc'].every(f => !fs.existsSync(path.join(b.profileDir, 'sync', f))), 'D: Disconnect left the token on disk');
  const consents = drive.stats.consents;
  await click(dmB, '#sy-connect');
  const back = await lib.poll(async () => await shown(dmB, 'sy-disconnect') && /^Last synced /.test(await line(dmB)), 30000, 200);
  rig.check(!!back, 'D: Connect did not sign B back in and sync: ' + q(await line(dmB)) + ' ' + await status());
  rig.check(drive.stats.consents === consents + 1, 'D: Connect did not go through the consent page once: ' + (drive.stats.consents - consents));

  const synced = await lib.poll(async () => {
    await tick(dmA); await tick(dmB);
    return (await Promise.all(ids.map(id => has(dmB, id)))).every(Boolean);
  }, 120000, 200);
  rig.check(!!synced, 'setup: the three maps did not reach B: ' + await status());
  if (!synced) return;

  const deleteOnA = async id => {
    await dmA.evaluate(`deleteScenesWithUndo([${q(id)}]); commitPendingDelete(); 0`);
    await lib.poll(async () => !(await dmA.evaluate(`sceneStore.loadScene(${q(id)}).then(r => !!r)`, 20000)), 20000);
    await tick(dmA);
    return lib.poll(async () => { await tick(dmB); return !(await has(dmB, id)); }, 60000, 200);
  };

  // E
  rig.check(!!(await deleteOnA(ids[0])), 'E: a map deleted on A is still on B: ' + await status());
  const listed = await lib.poll(async () => { const r = await rows(dmB); return r.length === 1 && r[0].id === ids[0] && r; }, 30000, 200);
  rig.check(!!listed && listed[0].name === 'Склеп' && /\d/.test(listed[0].date), 'E: B\'s Trash does not list the map with its name and date: ' + q(await rows(dmB)));
  const counted = await lib.poll(async () => (await dmB.evaluate(`(() => { const b = document.getElementById('sy-trash-open'); return !b.disabled && document.getElementById('sy-trash-count').textContent === '1'; })()`)), 10000, 200);
  rig.check(!!counted, 'E: B\'s Trash line does not count one map: ' + q(await dmB.evaluate(`document.getElementById('sy-trash-count').textContent`)));
  await click(dmB, '#sy-trash-open');
  rig.check(await shown(dmB, 'sy-trash-pop'), 'E: clicking the Trash line did not open its pop-out');
  await click(dmB, `#sy-trash [data-restore="${ids[0]}"]`);
  const restored = await lib.poll(async () => await has(dmB, ids[0]) && (await rows(dmB)).length === 0, 60000, 200);
  rig.check(!!restored, 'E: Restore in B\'s Trash did not bring the map back on B: ' + q(await rows(dmB)) + ' ' + await status());

  // F
  rig.check(!!(await deleteOnA(ids[1])), 'F: the second map deleted on A is still on B: ' + await status());
  await lib.poll(async () => (await rows(dmB)).length === 1, 30000, 200);
  await click(dmB, '#sy-empty');
  const asked = await lib.poll(async () => dmB.evaluate(`!!document.getElementById('cd-ok') && document.getElementById('cd-ok').offsetParent !== null`), 10000, 100);
  rig.check(!!asked, 'F: Empty now did not ask first');
  const emptyQ = await dmB.evaluate(`document.getElementById('cd-msg').textContent`);
  rig.check(emptyQ === 'Everything in the Trash is deleted for good, on every computer. This cannot be undone.', 'F: signed in, Empty now\'s question reads ' + q(emptyQ));
  const emptyTitle = await dmB.evaluate(`document.getElementById('sy-empty').title`);
  rig.check(emptyTitle === 'Delete everything in the Trash for good, on every computer.', 'F: signed in, Empty now\'s title reads ' + q(emptyTitle));
  rig.check((await rows(dmB)).length === 1, 'F: Empty now emptied the list before the DM answered');
  if (asked) await click(dmB, '#cd-ok');
  const emptied = await lib.poll(async () => (await rows(dmB)).length === 0 && !!(await dmB.evaluate(`syncIndex.raw.get('gone', ${q(ids[1])}).then(g => !!(g && g.purged))`, 20000)), 60000, 200);
  rig.check(!!emptied, 'F: Empty now did not empty B\'s list for good: ' + q(await rows(dmB)) + ' ' + await status());
  const left = drive.files().filter(f => f.name === 'scene~' + ids[1] + '.json' || f.name.startsWith(ids[1] + '.'));
  rig.check(left.length === 0, 'F: the emptied map\'s files are still on the Drive: ' + q(left.map(f => f.name)));
  rig.check(!(await has(dmB, ids[1])), 'F: the emptied map came back on B');

  // G
  await deleteOnA(ids[2]);
  await openSettings(dmA);
  const one = await lib.poll(async () => { const r = await rows(dmA); return r.length === 1 && r[0].id === ids[2]; }, 30000, 200);
  rig.check(!!one, 'G: A\'s Trash does not list just the map deleted last: ' + q(await rows(dmA)) + ' trash() ' + q(await dmA.evaluate('syncEngine.trash()', 30000)) + ' gone ' + q(await dmA.evaluate('syncIndex.raw.all("gone")', 20000)) + ' ids ' + q(ids));
  await dmA.evaluate(`document.getElementById('wm-bg-group').scrollIntoView(); 0`);
};
