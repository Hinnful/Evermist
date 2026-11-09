'use strict';

// settings-pane.js - SETTINGS AS RESTYLED (BACKLOG 282): THE SEAT, THE BACKGROUND, EXPORT, RECENTLY DELETED, CLAUDE.
//
// One app, restarted on its own profile: first with no Google client, then with a fake Drive through the sync config
// file and the browser caught (Linux), so Claude's Connect hands its extension to a stand-in and opens nothing.
// Claude's calls go through the bridge's own HTTP door, with the port and key in userData/mcp.json, as Claude's do.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   2. "Your seat at the TV" is four icons with tooltips; each sets seatTurn and evermist.seatTurn and lights alone.
//   5. Settings has no Size, Opacity or Position field and no Move on the map. A backdrop's stored place, size and
//      opacity still apply after a restart; choosing a picture again fits it again.
//   6. Export reads "Export" with nothing picked on the Campaign map and "Export 2 maps" with two picked.
//   8. Without a Google client the Trash shows, reading "Empty", greyed, and the Google Drive line is hidden. Signed in
//      to a Drive it reads "Empty", greyed; a map deleted and synced makes it read 1, and a click opens the pop-out
//      beside the dock with the map's name, "30 days left" and Restore, "Kept for 30 days" and Empty now. With the
//      Drive unreachable, and signed out, it still reads 1: this computer holds the map.
//   10. Claude starts "Not connected"; a call served marks it "Connected" with Disconnect. Disconnect makes the bridge
//      refuse every call with the plain reason, and the refusal survives a restart. Connect hands Claude the extension,
//      ends the refusal, reads "Connected", and that survives a restart too.

const fs = require('fs');
const path = require('path');
const http = require('http');
const lib = require('../lib');
const kit = require('../backupKit');

const OFF_TEXT = 'The Claude connection is turned off in Evermist\'s Settings. Press Connect there to turn it back on.';

module.exports = async function settingsPane(rig) {
  const q = JSON.stringify;
  let dm = rig.dm;
  const openSettings = () => dm.evaluate(`(() => { if (document.getElementById('dock-pane-settings').hidden) document.getElementById('dock-tab-settings').click(); return !document.getElementById('dock-pane-settings').hidden; })()`);
  // Shut and opened again, as the DM does to see it read afresh.
  const reopenSettings = async () => { await dm.evaluate(`dockOpen(null); 0`); return openSettings(); };
  const shown = id => dm.evaluate(`(() => { const el = document.getElementById(${q(id)}); return !!el && el.offsetParent !== null && el.offsetHeight > 0; })()`);
  const text = id => dm.evaluate(`(document.getElementById(${q(id)}) || {}).textContent`);

  // One tool call through the bridge's door, as the shim makes it: the answer, or null while the app is starting.
  const call = () => new Promise(resolve => {
    let at;
    try { at = JSON.parse(fs.readFileSync(path.join(rig.profileDir, 'mcp.json'), 'utf8')); } catch (_) { resolve(null); return; }
    const body = JSON.stringify({ tool: 'list_campaign', args: {} });
    const req = http.request({ host: '127.0.0.1', port: at.port, path: '/call', method: 'POST',
      headers: { 'content-type': 'application/json', 'x-evermist-token': at.token, 'content-length': Buffer.byteLength(body) } }, res => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', c => { out += c; });
      res.on('end', () => { try { const r = JSON.parse(out); resolve(r.starting ? null : r); } catch (_) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.end(body);
  });
  const answered = () => lib.poll(call, 30000, 300);
  const claude = async () => ({ line: await text('mcp-line'), connect: await shown('mcp-connect'), disconnect: await shown('mcp-disconnect') });

  rig.check(await openSettings(), 'setup: Settings did not open');

  // 2
  const seats = await dm.evaluate(`Array.from(document.querySelectorAll('#cp-seat-row [data-seat]')).map(b => ({ turn: +b.dataset.seat, title: b.title }))`);
  rig.check(q(seats) === q([{ turn: 0, title: 'Below the TV' }, { turn: 180, title: 'Above the TV' }, { turn: 270, title: 'Left of the TV' }, { turn: 90, title: 'Right of the TV' }]),
    '2: the seat segment is not four icons below, above, left, right with their tooltips: ' + q(seats));
  for (const s of [90, 270, 180, 0]) {
    await dm.evaluate(`document.querySelector('#cp-seat-row [data-seat="${s}"]').click(); 0`);
    const got = await dm.evaluate(`({ turn: seatTurn, stored: localStorage.getItem('evermist.seatTurn'), lit: Array.from(document.querySelectorAll('#cp-seat-row .active')).map(b => +b.dataset.seat) })`);
    rig.check(got.turn === s && got.stored === String(s) && q(got.lit) === q([s]), '2: the seat icon for ' + s + ' did not set the seat and light alone: ' + q(got));
  }

  // 10, before any call
  rig.check((await claude()).line === 'Not connected' && await shown('mcp-connect'), '10: a fresh profile does not read Not connected with Connect: ' + q(await claude()));
  const first = await answered();
  rig.check(!!first && first.text !== OFF_TEXT, '10: the bridge did not serve a call before any Disconnect: ' + q(first));
  await reopenSettings();
  const seen = await lib.poll(async () => { const c = await claude(); return c.line === 'Connected' && c.disconnect && !c.connect ? c : null; }, 10000, 200);
  rig.check(!!seen, '10: a served call did not mark Claude Connected with Disconnect: ' + q(await claude()));
  await dm.evaluate(`document.getElementById('mcp-disconnect').click(); 0`);
  const off = await lib.poll(async () => { const c = await claude(); return c.line === 'Not connected' && c.connect && !c.disconnect ? c : null; }, 10000, 200);
  rig.check(!!off, '10: Disconnect did not turn the line to Not connected with Connect: ' + q(await claude()));
  const refused = await answered();
  rig.check(!!refused && refused.text === OFF_TEXT && refused.isError === true, '10: after Disconnect the bridge did not refuse with the plain reason: ' + q(refused));

  // 8, without a client
  const bare = await dm.evaluate(`(() => { const b = document.getElementById('sy-trash-open'); return { disabled: b.disabled, count: document.getElementById('sy-trash-count').textContent }; })()`);
  rig.check(await shown('sy-trash-open') && bare.count === 'Empty' && bare.disabled, '8: without a Google client the Trash does not show, reading Empty, greyed: ' + q(bare));
  rig.check(!(await shown('sy-group')), '8: without a Google client the Google Drive line shows');

  // 6
  await kit.install(dm);
  const ids = await dm.evaluate(`(async () => {
    const out = [];
    for (const [i, n] of ['Склеп', 'Башня'].entries()) {
      const f = await __bk.noiseFile(n, 800, 600, i + 1, 0.8);
      out.push((await addMapsToLibrary([f], { x: i * 300, y: 0 }, true)).ids[0]);
    }
    return out;
  })()`, 120000);
  await dm.evaluate(`worldMapShow(); worldMapPickSet([], null); worldBackupSync(); 0`);
  rig.check(await text('wm-bk-export-label') === 'Export', '6: with nothing picked Export does not read Export: ' + q(await text('wm-bk-export-label')));
  await dm.evaluate(`worldMapPickSet(${q(ids)}, ${q(ids[0])}); worldBackupSync(); 0`);
  rig.check(await text('wm-bk-export-label') === 'Export 2 maps', '6: with two maps picked Export does not read Export 2 maps: ' + q(await text('wm-bk-export-label')));
  await dm.evaluate(`worldMapPickSet([], null); worldMapHide(); 0`);

  // 5, the fields
  const fields = await dm.evaluate(`['wm-bg-controls', 'wm-bg-scale-num', 'wm-bg-alpha-num', 'wm-bg-move'].filter(id => document.getElementById(id))`);
  rig.check(fields.length === 0, '5: Settings still holds the background\'s ' + q(fields));
  await dm.evaluate(`(async () => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 300;
    const g = c.getContext('2d'); g.fillStyle = '#7a5'; g.fillRect(0, 0, 400, 300);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    await worldBackgroundPut({ blob, meta: { x: 123, y: 45, scale: 1.5, alpha: 0.33, w: 400, h: 300, name: 'old.png', at: Date.now() } });
  })()`, 30000);

  // A restart with a fake Drive signed in and the browser caught.
  const drive = await rig.fakeDrive();
  rig.writeSyncConfig(rig.profileDir, drive);
  const browser = rig.catchBrowser();
  const env = browser ? browser.env : {};
  dm = await rig.restart({ env });
  await lib.installHelpers(dm);
  await openSettings();

  // 5, after the restart
  const bgAt = () => dm.evaluate(`(() => { const el = document.getElementById('wm-bgimg'); return { opacity: el.style.opacity, transform: el.style.transform, name: (document.getElementById('wm-bg-name') || {}).textContent, line: !document.getElementById('wm-bg-line').hidden, pick: !document.getElementById('wm-bg-pick').hidden }; })()`);
  const kept = await lib.poll(async () => { const b = await bgAt(); return b.line ? b : null; }, 20000, 200);
  rig.check(!!kept && kept.opacity === '0.33' && /scale\(1\.5\)/.test(kept.transform) && /translate\(-177px, ?-180px\)/.test(kept.transform) && kept.name === 'old.png' && !kept.pick,
    '5: the stored place, size and opacity did not apply after a restart, or the line does not show the name: ' + q(kept || await bgAt()));
  await dm.evaluate(`(async () => {
    const c = document.createElement('canvas'); c.width = 200; c.height = 100;
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'new.png', { type: 'image/png' }));
    const input = document.getElementById('wm-bg-file'); input.files = dt.files; input.dispatchEvent(new Event('change'));
  })()`, 30000);
  const fitted = await lib.poll(async () => { const b = await bgAt(); return b.name === 'new.png' ? b : null; }, 20000, 200);
  rig.check(!!fitted && fitted.opacity === '0.6' && !/scale\(1\.5\)/.test(fitted.transform), '5: choosing a picture again did not fit it again: ' + q(fitted || await bgAt()));

  // 10, after the restart
  rig.check((await claude()).line === 'Not connected', '10: Disconnect did not survive a restart: ' + q(await claude()));
  const stillOff = await answered();
  rig.check(!!stillOff && stillOff.text === OFF_TEXT, '10: after a restart the bridge serves calls Disconnect turned off: ' + q(stillOff));
  if (!browser) rig.byEye('10: Connect hands Claude the extension (the browser is caught on Linux only, so Connect is not pressed here)');
  else {
    await dm.evaluate(`document.getElementById('mcp-connect').click(); 0`);
    const on = await lib.poll(async () => { const c = await claude(); return c.line === 'Connected' && c.disconnect ? c : null; }, 30000, 200);
    rig.check(!!on, '10: Connect did not turn the line to Connected with Disconnect: ' + q(await claude()));
    const handed = await lib.poll(async () => browser.opened().find(a => /Evermist\.mcpb$/.test(a)), 20000, 200);
    rig.check(!!handed, '10: Connect did not hand the extension over: ' + q(browser.opened()));
    const back = await answered();
    rig.check(!!back && back.text !== OFF_TEXT, '10: after Connect the bridge still refuses: ' + q(back));
  }

  // 8, signed in
  await lib.settle(dm, "syncEngine.status().state !== 'off'", 30000);
  await dm.evaluate('syncEngine.now()', 120000);
  const trashLine = () => dm.evaluate(`(() => { const b = document.getElementById('sy-trash-open'); return { shown: !!b.offsetParent, disabled: b.disabled, count: document.getElementById('sy-trash-count').textContent }; })()`);
  const empty = await lib.poll(async () => { const l = await trashLine(); return l.shown && l.count === 'Empty' ? l : null; }, 30000, 200);
  rig.check(!!empty && empty.disabled, '8: signed in with nothing deleted, the Trash does not read Empty, greyed: ' + q(await trashLine()));
  await dm.evaluate(`deleteScenesWithUndo([${q(ids[0])}]); commitPendingDelete(); 0`);
  await lib.poll(async () => !(await dm.evaluate(`sceneStore.loadScene(${q(ids[0])}).then(r => !!r)`, 20000)), 20000);
  await dm.evaluate('syncEngine.now()', 120000);
  const one = await lib.poll(async () => { const l = await trashLine(); return l.count === '1' && !l.disabled ? l : null; }, 30000, 200);
  rig.check(!!one, '8: a deleted and synced map does not make the Trash read 1: ' + q(await trashLine()));
  await dm.evaluate(`document.getElementById('sy-trash-open').click(); 0`);
  const pop = await dm.evaluate(`(() => {
    const p = document.getElementById('sy-trash-pop'), r = p.getBoundingClientRect(), d = document.getElementById('dock').getBoundingClientRect();
    const rows = Array.from(p.querySelectorAll('.dk-trash-row')).map(x => ({ name: x.querySelector('.nm').textContent, date: x.querySelector('.mt').textContent, restore: x.querySelector('[data-restore]').textContent }));
    return { shown: !p.hidden && r.width > 0, left: r.right <= d.left, rows, foot: p.querySelector('.dk-trash-foot .cp-hint').textContent, empty: document.getElementById('sy-empty').textContent.trim(), emptyOn: !document.getElementById('sy-empty').disabled };
  })()`);
  rig.check(pop.shown && pop.left, '8: the Trash did not open its pop-out beside the dock: ' + q(pop));
  rig.check(pop.rows.length === 1 && pop.rows[0].name === 'Склеп' && pop.rows[0].date === '30 days left' && pop.rows[0].restore === 'Restore', '8: the pop-out does not list the map with "30 days left" and Restore: ' + q(pop.rows));
  rig.check(pop.foot === 'Kept for 30 days' && pop.empty === 'Empty now' && pop.emptyOn, '8: the pop-out does not end with Kept for 30 days and Empty now: ' + q(pop));
  await dm.evaluate(`dockClosePop(); 0`);
  drive.down();
  await reopenSettings();
  await dm.evaluate('trashPanelRefresh()', 60000);
  const offline = await trashLine();
  rig.check(offline.shown && offline.count === '1' && !offline.disabled, '8: with the Drive unreachable the Trash does not still read 1: ' + q(offline));
  drive.up();
  await dm.evaluate(`document.getElementById('sy-disconnect').click(); 0`);
  await lib.poll(async () => await shown('sy-connect'), 30000, 200);
  await dm.evaluate('trashPanelRefresh()', 60000);
  const out = await trashLine();
  rig.check(out.shown && out.count === '1' && !out.disabled, '8: signed out, the Trash does not still read 1: ' + q(out));

  // 10, Connect survives a restart
  if (browser) {
    dm = await rig.restart({ env });
    await openSettings();
    const still = await lib.poll(async () => { const c = await claude(); return c.line === 'Connected' ? c : null; }, 20000, 200);
    rig.check(!!still, '10: Connected did not survive a restart: ' + q(await claude()));
    const served = await answered();
    rig.check(!!served && served.text !== OFF_TEXT, '10: after a restart the bridge refuses a call Connect allowed: ' + q(served));
  }
};
