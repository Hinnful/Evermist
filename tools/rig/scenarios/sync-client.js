'use strict';

// sync-client.js - A BUILD MADE WITH A GOOGLE CLIENT SHOWS SYNC AND SIGNS IN WITH IT, WITH NO FILE PLACED.
//
// Run against a packaged app built with GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET set (tools/write-google-client.js
// before electron-builder), with the same GOOGLE_CLIENT_ID in the rig's shell to name the client to expect. The rig
// never hands the shell's client to the app, so only the build can carry it. Nothing here contacts Google.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   A. With no sync config file, Settings shows the Sync section, signed out: Connect, no Disconnect, and sync keeps
//      its index.
//   B. Connect hands the system browser Google's consent page for the built-in client: that client id, the app's hidden
//      Drive folder as the only scope, this computer's loopback as the answer address, PKCE and a state, no secret.
//      (Linux: elsewhere the browser cannot be caught.)

const fs = require('fs');
const path = require('path');
const lib = require('../lib');

module.exports = async function syncClient(rig) {
  const want = (process.env.GOOGLE_CLIENT_ID || '').trim();
  rig.check(!!want, 'setup: GOOGLE_CLIENT_ID is not set in the rig\'s shell, so there is no client to expect');
  rig.check(!fs.existsSync(path.join(rig.profileDir, 'sync', 'config.json')), 'setup: the profile holds a sync config file');
  const browser = rig.catchBrowser();
  const dm = await rig.restart(browser ? { env: browser.env } : undefined);
  const shown = id => dm.evaluate(`(() => { const el = document.getElementById(${JSON.stringify(id)}); return !!el && el.offsetParent !== null && el.offsetHeight > 0; })()`);
  await dm.evaluate(`(() => { if (document.getElementById('dock-pane-settings').hidden) document.getElementById('dock-tab-settings').click(); })()`);

  // A
  const up = await lib.poll(async () => await shown('sy-group') && await shown('sy-connect'), 20000, 200);
  rig.check(!!up, 'A: Settings does not show the Sync section with Connect, with no sync config file');
  rig.check(!(await shown('sy-disconnect')), 'A: a computer never signed in shows Disconnect');
  rig.check(await dm.evaluate('syncIndex.isOn()'), 'A: sync keeps no index with a built-in client');

  // B
  if (!browser) { rig.byEye('B: Connect opens Google\'s consent page for the built-in client (the browser is caught on Linux only)'); return; }
  if (!up || !want) return;
  const url = await lib.connectOpens(dm, browser);
  const faults = lib.consentFaults(url, want);
  rig.check(!faults.length, 'B: Connect did not hand the browser the consent page for the built-in client: ' + faults.join('; '));
};
