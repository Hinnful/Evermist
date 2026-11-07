'use strict';

// sync-settings.js - SETTINGS' SYNC SECTION: SHOWN ONLY WITH A GOOGLE CLIENT, AND EVERY BUTTON IN IT WORKS.
//
// One app with no Google client, then the same app with one from the environment as a dev run reads it, then two apps
// on one fake Drive through the sync config file. Every action goes through the section's own buttons. Run from the
// repo: a build that carries a client is sync-client.js's.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   A. Without a Google client (no built-in file, no environment, no sync config file) Settings shows nothing new, and
//      sync keeps no index.
//   A2. With a client in GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and no sync config file, Settings shows the section
//      signed out: Connect, no Disconnect, and no index until this computer connects, so a DM who never connects pays
//      nothing on a save. Connect hands the system browser Google's consent
//      page for that client, the hidden Drive folder its only scope, answered on the loopback. (The browser is caught on
//      Linux only.)
//   B. With the sync config file, Settings shows the Sync section, signed in: Disconnect and Sync now, no Connect.
//   C. Sync now runs a sync: the button calls the engine's own sync (the 30 s tick does not count), and the status
//      line moves to the new sync's time.
//   D. Disconnect signs this computer out: the line says so, Connect comes back, Sync now greys and the token is gone.
//      Connect signs it in again through the consent page and the loopback, PKCE checked, and sync resumes.
//   E. A map deleted on A shows in B's Recently deleted with its name and date; Restore there brings it back on B.
//   F. Empty now asks first, and on yes removes the map from the list for good, and its files from the Drive.
//   G. The section ends with one deleted map listed on A, for the screenshot (--shot "#sy-group").

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
  const rows = dm => dm.evaluate(`Array.from(document.querySelectorAll('#sy-trash .dk-r')).map(r => ({ name: r.querySelector('.nm').textContent, date: r.querySelector('.mt').textContent, id: r.querySelector('[data-restore]').dataset.restore }))`);

  // A
  let dmA = rig.dm;
  rig.check(await openSettings(dmA), 'A: Settings did not open');
  rig.check(!(await shown(dmA, 'sy-group')) && await dmA.evaluate(`document.getElementById('sy-group').hidden`), 'A: Settings shows the Sync section without the sync config file');
  rig.check(await dmA.evaluate('!syncIndex.isOn()'), 'A: sync keeps an index without a Google client');

  // A2
  const ENV_ID = 'rig-env-id.apps.googleusercontent.com';
  const browser = rig.catchBrowser();
  dmA = await rig.restart({ env: Object.assign({ GOOGLE_CLIENT_ID: ENV_ID, GOOGLE_CLIENT_SECRET: 'rig-env-secret' }, browser ? browser.env : {}) });
  await openSettings(dmA);
  const envUp = await lib.poll(async () => await shown(dmA, 'sy-group') && await shown(dmA, 'sy-connect'), 20000, 200);
  rig.check(!!envUp, 'A2: with a client in the environment, Settings does not show the Sync section with Connect');
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
  rig.check(!!up, 'B: the Sync section did not show with the sync config file');
  rig.check(await shown(dmB, 'sy-disconnect') && await shown(dmB, 'sy-now') && !(await shown(dmB, 'sy-connect')), 'B: a signed-in computer does not show Disconnect and Sync now without Connect');

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
  // The timers call the engine from inside it; only a caller outside goes through the property.
  await dmB.evaluate(`window.__syNow = syncEngine.now; window.__syCalls = []; syncEngine.now = () => { const p = __syNow(); __syCalls.push(p); return p; }; 0`);
  await click(dmB, '#sy-now');
  const moved = await lib.poll(async () => {
    const st = await dmB.evaluate('syncEngine.status()');
    return st.state === 'idle' && st.last > before && /^Last synced /.test(await line(dmB));
  }, 60000, 200);
  const called = await dmB.evaluate(`(async () => { const n = __syCalls.length; if (n) await __syCalls[0]; syncEngine.now = __syNow; return n; })()`, 120000);
  rig.check(called === 1, 'C: Sync now did not call the engine\'s sync once: ' + called);
  rig.check(!!moved, 'C: Sync now did not move the status line to a new sync: ' + q(await line(dmB)) + ' ' + await status());

  // D
  await click(dmB, '#sy-disconnect');
  const out = await lib.poll(async () => /^Signed out/.test(await line(dmB)) && await shown(dmB, 'sy-connect'), 30000, 200);
  rig.check(!!out, 'D: Disconnect did not sign B out: ' + q(await line(dmB)) + ' ' + await status());
  rig.check(!(await shown(dmB, 'sy-disconnect')) && await dmB.evaluate(`document.getElementById('sy-now').disabled`), 'D: signed out, Disconnect still shows or Sync now is not greyed');
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
  rig.check(!!listed && listed[0].name === 'Склеп' && /\d/.test(listed[0].date), 'E: B\'s Recently deleted does not list the map with its name and date: ' + q(await rows(dmB)));
  await click(dmB, `#sy-trash [data-restore="${ids[0]}"]`);
  const restored = await lib.poll(async () => await has(dmB, ids[0]) && (await rows(dmB)).length === 0, 60000, 200);
  rig.check(!!restored, 'E: Restore in B\'s Recently deleted did not bring the map back on B: ' + q(await rows(dmB)) + ' ' + await status());

  // F
  rig.check(!!(await deleteOnA(ids[1])), 'F: the second map deleted on A is still on B: ' + await status());
  await lib.poll(async () => (await rows(dmB)).length === 1, 30000, 200);
  await click(dmB, '#sy-empty');
  const asked = await lib.poll(async () => dmB.evaluate(`!!document.getElementById('cd-ok') && document.getElementById('cd-ok').offsetParent !== null`), 10000, 100);
  rig.check(!!asked, 'F: Empty now did not ask first');
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
  rig.check(!!one, 'G: A\'s Recently deleted does not list just the map deleted last: ' + q(await rows(dmA)) + ' trash() ' + q(await dmA.evaluate('syncEngine.trash()', 30000)) + ' gone ' + q(await dmA.evaluate('syncIndex.raw.all("gone")', 20000)) + ' ids ' + q(ids));
  await dmA.evaluate(`document.getElementById('sy-group').scrollIntoView(); 0`);
};
