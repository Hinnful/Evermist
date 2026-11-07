'use strict';

// sync-harness.js - THE RIG CAN RUN TWO COMPUTERS AGAINST ONE FAKE DRIVE.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   A. A second app starts on a profile of its own while the first is still running, and both answer.
//   B. Each profile holds the sync config file that names the fake Drive, and the fake answers a token request.
//   C. A restart that swaps nothing keeps the profile: the app comes back on the same library folder.

const fs = require('fs');
const path = require('path');

module.exports = async function syncHarness(rig) {
  const first = rig.dm;
  const second = await rig.second('b');

  const sum = async s => s.evaluate('1 + 1');
  rig.check(await sum(first) === 2 && await sum(second.dm) === 2, 'both apps answer while both run');
  rig.check(rig.profileDir !== second.profileDir, 'the second app has a profile of its own');
  const ports = new Set([(await rig.targets()).length > 0, (await second.targets()).length > 0]);
  rig.check(ports.size === 1 && ports.has(true), 'each app lists its own windows');

  const drive = await rig.fakeDrive();
  rig.writeSyncConfig(rig.profileDir, drive);
  rig.writeSyncConfig(second.profileDir, drive);
  for (const r of [rig, second]) {
    const cfg = JSON.parse(fs.readFileSync(path.join(r.profileDir, 'sync', 'config.json'), 'utf8'));
    rig.check(cfg.apiBase === drive.url, 'the profile config names the fake Drive');
  }
  const t = await (await fetch(drive.url + '/token', { method: 'POST', body: 'grant_type=refresh_token' })).json();
  rig.check(!!t.access_token, 'the fake Drive hands out a token');

  const marker = await first.evaluate('localStorage.setItem("harness", "kept"); 1');
  const again = await rig.restart({ exe: null });
  const kept = await again.evaluate('localStorage.getItem("harness")');
  rig.check(marker === 1 && kept === 'kept', 'a restart that swaps nothing keeps the profile: ' + kept);
  rig.check(await sum(second.dm) === 2, 'the other app is untouched by the first one restarting');
};
