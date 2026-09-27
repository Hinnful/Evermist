'use strict';

// mac-update-proof.js — proves the Mac update on a macOS CI runner, against two built zips.
//
//   node tools/mac-update-proof.js <dir of this version> <dir of an older version>
//
// Each dir holds Evermist.zip and latest-mac.yml, built with their update feed pointed at FEED_PORT
// on this machine. The script installs this version, walks it back
// to the older one and forward again through the Restart button, and checks a quit installs
// nothing and a copy outside Applications offers the move. Fails hard: exit 1 with what broke.
//
// ⚠ MAC CI ONLY. It installs into /Applications and opens windows on the screen it runs on.

const { spawn, execFileSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cdp = require('./rig/cdp.js');

if (process.platform !== 'darwin') {
  console.error('mac-update-proof runs on a macOS CI runner only.');
  process.exit(1);
}

const [NEW_DIR, OLD_DIR] = process.argv.slice(2).map(d => path.resolve(d || ''));
const APP = '/Applications/Evermist.app';
const BIN = 'Contents/MacOS/Evermist';
// ⚠ Fixed, because the feed URL is baked into each build (update-proofs.yml).
const FEED_PORT = 8765;
const PORT = 9333;
const READY = "(document.querySelector('#about-update .about-update-btn') || {}).textContent === 'Restart to update'";

const pointerVersion = dir =>
  /^version:\s*['"]?([^'"\s]+)/m.exec(fs.readFileSync(path.join(dir, 'latest-mac.yml'), 'utf8'))[1];
const NEW = pointerVersion(NEW_DIR);
const OLD = pointerVersion(OLD_DIR);

const bundleVersion = app =>
  execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-',
    path.join(app, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
const pids = () => {
  try { return execFileSync('/usr/bin/pgrep', ['-f', BIN], { encoding: 'utf8' }).trim().split('\n').filter(Boolean); }
  catch (_) { return []; }
};
const killAll = async () => {
  for (const p of pids()) { try { process.kill(Number(p), 'SIGKILL'); } catch (_) {} }
  while (pids().length) await cdp.sleep(200);
};

// The feed the app reads from, switched between the two dirs as the proof walks.
let feedDir = OLD_DIR;
const server = http.createServer((req, res) => {
  const file = path.join(feedDir, path.basename(decodeURIComponent(req.url.split('?')[0])));
  if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Length': fs.statSync(file).size });
  fs.createReadStream(file).pipe(res);
});

async function launch(app) {
  const proc = spawn(path.join(app, BIN), ['--remote-debugging-port=' + PORT], { stdio: 'ignore' });
  const target = await cdp.waitForTarget(PORT,
    t => t.url.includes('index.html') && !t.url.includes('mode=player'), 90000, 'the DM window');
  const dm = await cdp.connect(target.webSocketDebuggerUrl, 'dm');
  // The target is listed before the preload runs.
  await dm.waitFor("window.electronAPI && document.readyState === 'complete'", 90000, 'the DM page');
  return { proc, dm };
}

const exited = proc => new Promise(r => proc.exitCode != null ? r() : proc.once('exit', r));

async function waitFor(test, ms, what) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (test()) return; await cdp.sleep(250); }
  throw new Error('timed out after ' + ms / 1000 + 's waiting for ' + what);
}

function expect(got, want, what) {
  if (got !== want) throw new Error(what + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
  console.log('PASS ' + what);
}

// One hop: the installed copy offers `want`, Restart swaps it in, and the swapped copy opens.
async function hop(want) {
  const { proc, dm } = await launch(APP);
  await dm.waitFor(READY, 600000, 'version ' + want + ' to be ready');
  await dm.evaluate("document.querySelector('#about-update .about-update-btn').click()");
  await exited(proc);
  await waitFor(() => { try { return bundleVersion(APP) === want; } catch (_) { return false; } },
    60000, 'the swap to ' + want);
  expect(bundleVersion(APP), want, 'Restart swaps in ' + want);
  await waitFor(() => pids().length > 0, 60000, 'the swapped copy to open');
  await cdp.sleep(10000);
  expect(pids().length > 0, true, 'the swapped copy is still running 10s later');
  await killAll();
  const again = await launch(APP);
  expect(await again.dm.evaluate('window.electronAPI.getAppVersion()'), want, 'the app reports ' + want);
  await killAll();
}

async function main() {
  await new Promise(r => server.listen(FEED_PORT, '127.0.0.1', r));
  await killAll();
  fs.rmSync(APP, { recursive: true, force: true });
  execFileSync('/usr/bin/ditto', ['-x', '-k', path.join(NEW_DIR, 'Evermist.zip'), '/Applications']);
  expect(bundleVersion(APP), NEW, 'installed ' + NEW);

  // A quit with an update ready installs nothing.
  feedDir = OLD_DIR;
  const first = await launch(APP);
  await first.dm.waitFor(READY, 600000, 'version ' + OLD + ' to be ready');
  first.proc.kill('SIGTERM');
  await exited(first.proc);
  await cdp.sleep(5000);
  expect(bundleVersion(APP), NEW, 'a quit leaves ' + NEW + ' in place');
  await killAll();

  // Older first: a pulled release walks installed copies back the same way.
  await hop(OLD);
  feedDir = NEW_DIR;
  await hop(NEW);

  // A copy outside Applications offers the move, and the move lands it there.
  const away = fs.mkdtempSync('/tmp/evermist-move-');
  execFileSync('/usr/bin/ditto', [APP, path.join(away, 'Evermist.app')]);
  const loose = await launch(path.join(away, 'Evermist.app'));
  await loose.dm.waitFor("(document.getElementById('about-update') || {}).textContent.includes('Move to Applications')",
    60000, 'the move offer');
  console.log('PASS a copy outside Applications offers the move');
  await loose.dm.evaluate("document.querySelector('#about-update .about-update-btn').click()");
  await waitFor(() => !fs.existsSync(path.join(away, 'Evermist.app')) && fs.existsSync(APP), 60000, 'the move');
  expect(bundleVersion(APP), NEW, 'the moved copy sits in Applications');
  await killAll();
}

main().then(() => { server.close(); console.log('Mac update proof: all green'); process.exit(0); })
  .catch(async err => { console.error('FAIL ' + err.message); await killAll(); process.exit(1); });
