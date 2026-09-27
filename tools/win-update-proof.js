'use strict';

// win-update-proof.js — proves the Windows update on a Windows CI runner, against two built installers.
//
//   node tools/win-update-proof.js <dir of this version> <dir of an older version>
//
// Each dir holds Evermist-Setup-<version>.exe and latest.yml, built with their update feed pointed
// at FEED_PORT on this machine. The script installs this version, walks it back to the older one
// and forward again through the Restart button, and checks a quit installs nothing. Fails hard:
// exit 1 with what broke.
//
// ⚠ CI ONLY. It installs over whatever Evermist the machine has, so it refuses to run outside
// GitHub Actions: on the DM's machine it would replace their real install.

const { spawn, execFileSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cdp = require('./rig/cdp.js');

if (process.platform !== 'win32' || !process.env.GITHUB_ACTIONS) {
  console.error('win-update-proof runs on a Windows CI runner only.');
  process.exit(1);
}

const [NEW_DIR, OLD_DIR] = process.argv.slice(2).map(d => path.resolve(d || ''));
// ⚠ Fixed, because the feed URL is baked into each installer at build time (update-proofs.yml).
const FEED_PORT = 8765;
const PORT = 9333;
// The per-user one-click install location.
const APP = path.join(process.env.LOCALAPPDATA, 'Programs', 'evermist', 'Evermist.exe');
const READY = "(document.querySelector('#about-update .about-update-btn') || {}).textContent === 'Restart to update'";

const pointerVersion = dir =>
  /^version:\s*['"]?([^'"\s]+)/m.exec(fs.readFileSync(path.join(dir, 'latest.yml'), 'utf8'))[1];
const NEW = pointerVersion(NEW_DIR);
const OLD = pointerVersion(OLD_DIR);
const installer = (dir, v) => path.join(dir, 'Evermist-Setup-' + v + '.exe');

const ps = cmd => execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();
const installed = () => {
  if (!fs.existsSync(APP)) return 'nothing';
  try {
    const v = ps(`(Get-Item -LiteralPath '${APP}').VersionInfo.ProductVersion`);
    return (/^\d+\.\d+\.\d+/.exec(v) || [v])[0];
  } catch (_) { return 'unreadable'; }
};
// By path, never by name: the installer is an Evermist*.exe too, and killing it mid-swap would
// fail the proof on something the app never did.
const pids = () => {
  try {
    return ps(`Get-CimInstance Win32_Process -Filter "Name='Evermist.exe'" | ` +
      `Where-Object { $_.ExecutablePath -ieq '${APP}' } | ForEach-Object { $_.ProcessId }`)
      .split(/\s+/).filter(Boolean);
  } catch (_) { return []; }
};
const killAll = async () => {
  for (const p of pids()) { try { execFileSync('taskkill', ['/pid', p, '/T', '/F'], { stdio: 'ignore' }); } catch (_) {} }
  while (pids().length) await cdp.sleep(500);
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
  const proc = spawn(APP, ['--remote-debugging-port=' + PORT], { stdio: 'ignore' });
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
  while (Date.now() < deadline) { if (test()) return; await cdp.sleep(1000); }
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
  await exited(proc);
  await waitFor(() => installed() === want, 180000, 'the swap to ' + want);
  expect(installed(), want, 'Restart swaps in ' + want);
  await waitFor(() => pids().length > 0, 90000, 'the swapped copy to open');
  await cdp.sleep(10000);
  expect(pids().length > 0, true, 'the swapped copy is still running 10s later');
  await killAll();
  const again = await launch();
  expect(await again.dm.evaluate('window.electronAPI.getAppVersion()'), want, 'the app reports ' + want);
  await killAll();
}

async function main() {
  await new Promise(r => server.listen(FEED_PORT, '127.0.0.1', r));
  execFileSync(installer(NEW_DIR, NEW), ['/S'], { stdio: 'ignore' });
  await waitFor(() => installed() === NEW, 120000, 'the first install');
  expect(installed(), NEW, 'installed ' + NEW);
  await killAll();

  // A quit with an update ready installs nothing. Closing the window is the DM's own quit.
  feedDir = OLD_DIR;
  const first = await launch();
  await first.dm.waitFor(READY, 600000, 'version ' + OLD + ' to be ready');
  try { await first.dm.evaluate('window.close(); 0'); } catch (_) {}
  await exited(first.proc);
  await cdp.sleep(15000);
  expect(installed(), NEW, 'a quit leaves ' + NEW + ' in place');
  await killAll();

  // Older first: a pulled release walks installed copies back the same way.
  await hop(OLD);
  feedDir = NEW_DIR;
  await hop(NEW);
}

main().then(() => { server.close(); console.log('Windows update proof: all green'); process.exit(0); })
  .catch(async err => { console.error('FAIL ' + err.message); await killAll(); process.exit(1); });
