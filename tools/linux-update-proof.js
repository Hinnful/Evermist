'use strict';

// linux-update-proof.js — proves the AppImage update on a Linux CI runner, against two built AppImages.
//
//   node tools/linux-update-proof.js <dir of this version> <dir of an older version>
//
// Each dir holds Evermist.AppImage and latest-linux.yml, built with their update feed pointed at
// FEED_PORT on this machine. The script installs this version, walks it back to the older one and
// forward again through the Restart button, and checks a quit installs nothing. Fails hard: exit 1
// with what broke.
//
// ⚠ LINUX CI ONLY, under a display (xvfb-run). It kills every Evermist process on the machine.

const { spawn, execFileSync } = require('child_process');
const crypto = require('crypto');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const cdp = require('./rig/cdp.js');

if (process.platform !== 'linux') {
  console.error('linux-update-proof runs on a Linux CI runner only.');
  process.exit(1);
}

const [NEW_DIR, OLD_DIR] = process.argv.slice(2).map(d => path.resolve(d || ''));
// ⚠ Fixed, because the feed URL is baked into each AppImage at build time (update-proofs.yml).
const FEED_PORT = 8765;
const PORT = 9333;
const APP = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'evermist-appimage-')), 'Evermist.AppImage');
const READY = "(document.querySelector('#about-update .about-update-btn') || {}).textContent === 'Restart to update'";
const MATCH = 'Evermist.AppImage|mount_Evermi';

const pointerVersion = dir =>
  /^version:\s*['"]?([^'"\s]+)/m.exec(fs.readFileSync(path.join(dir, 'latest-linux.yml'), 'utf8'))[1];
const NEW = pointerVersion(NEW_DIR);
const OLD = pointerVersion(OLD_DIR);

// The AppImage carries no readable version, so the installed file is named by the build it matches.
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const BUILDS = { [sha(path.join(NEW_DIR, 'Evermist.AppImage'))]: NEW, [sha(path.join(OLD_DIR, 'Evermist.AppImage'))]: OLD };
const installed = () => { try { return BUILDS[sha(APP)] || 'an unknown file'; } catch (_) { return 'nothing'; } };

const pids = () => {
  try { return execFileSync('pgrep', ['-f', MATCH], { encoding: 'utf8' }).trim().split('\n').filter(Boolean); }
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

async function launch() {
  // No GPU on the runner; see SOFTWARE_GL in rig/run.js.
  const proc = spawn(APP, ['--enable-unsafe-swiftshader', '--remote-debugging-port=' + PORT], { stdio: 'ignore' });
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
  const { proc, dm } = await launch();
  await dm.waitFor(READY, 600000, 'version ' + want + ' to be ready');
  await dm.evaluate("document.querySelector('#about-update .about-update-btn').click()");
  await waitFor(() => installed() === want, 120000, 'the swap to ' + want);
  expect(installed(), want, 'Restart swaps in ' + want);
  await exited(proc);
  await waitFor(() => pids().length > 0, 60000, 'the swapped copy to open');
  await cdp.sleep(10000);
  expect(pids().length > 0, true, 'the swapped copy is still running 10s later');
  await killAll();
  const again = await launch();
  expect(await again.dm.evaluate('window.electronAPI.getAppVersion()'), want, 'the app reports ' + want);
  await killAll();
}

async function main() {
  await new Promise(r => server.listen(FEED_PORT, '127.0.0.1', r));
  await killAll();
  fs.copyFileSync(path.join(NEW_DIR, 'Evermist.AppImage'), APP);
  fs.chmodSync(APP, 0o755);
  expect(installed(), NEW, 'installed ' + NEW);

  // A quit with an update ready installs nothing.
  feedDir = OLD_DIR;
  const first = await launch();
  await first.dm.waitFor(READY, 600000, 'version ' + OLD + ' to be ready');
  first.proc.kill('SIGTERM');
  await exited(first.proc);
  await cdp.sleep(5000);
  expect(installed(), NEW, 'a quit leaves ' + NEW + ' in place');
  await killAll();

  // Older first: a pulled release walks installed copies back the same way.
  await hop(OLD);
  feedDir = NEW_DIR;
  await hop(NEW);
}

main().then(() => { server.close(); console.log('Linux update proof: all green'); process.exit(0); })
  .catch(async err => { console.error('FAIL ' + err.message); await killAll(); process.exit(1); });
