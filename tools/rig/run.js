'use strict';

// run.js — the rig: launch the REAL app, attach to both its windows over the DevTools protocol,
// run scenarios against them, print one verdict.
//
//   npm run rig                        the smoke set
//   npm run rig -- regression          every acceptance scenario
//   npm run rig -- fog-reaches-the-player
//   npm run rig -- --exe "dist/Evermist.exe"          drive a built installer instead
//   npm run rig -- --shot "#sm-panel" --shot-setup "openDropdown()"
//
// When to run it, when not to, how to write a scenario, and the traps: the `rig` skill.
// What it is and how the pieces fit: docs/ARCHITECTURE.md.
//
// ONE APP INSTANCE PER SCENARIO, on its own throwaway profile. Scenarios import maps, switch
// scenes (which autosaves the outgoing one) and restore backups, so sharing an instance would
// make each file's result depend on which ones ran before it.
//
// ⚠ NEVER LEAVE THE APP RUNNING. An orphaned Electron with a window on screen and no output was
// a real failure mode of the seed, so the watchdog, the exit hooks and the catch-all below all
// route through one kill.

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const cdp = require('./cdp');

const ROOT = path.join(__dirname, '..', '..');

// ⚠ NO RIG OUTPUT INSIDE THE WORKING TREE. Screenshots, generated maps and the isolated profile
// are all regenerable and one of them is a video file, which .gitignore already refuses. Output
// lives under the OS temp dir; the .gitignore entry below is the backstop for a --out that is
// pointed into the repo anyway.
const OUT_DIRNAME = '.rig';
const TEMP_ROOT = path.join(os.tmpdir(), 'evermist-rig');

const HARD_TIMEOUT_MS = 900000;

// initControlPanel is the LAST thing the init chain runs (called from toolbar.js), and
// _cpFogPicker is the last thing it assigns — so this is the app saying it is fully up. Polled,
// never slept through: boot takes about ten seconds here and a fixed wait is either a lie or a
// waste.
const DM_READY = 'typeof _cpFogPicker !== "undefined" && !!_cpFogPicker';
const PLAYER_READY = 'typeof isPlayer !== "undefined" && isPlayer && !!pixiApp';

// ─── Arguments ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const a = { scenarios: [], exe: null, out: null, shot: null, shotSetup: '', visible: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--exe') a.exe = argv[++i];
    else if (t === '--out') a.out = argv[++i];
    else if (t === '--shot') a.shot = argv[++i];
    else if (t === '--shot-setup') a.shotSetup = argv[++i] || '';
    else if (t === '--visible') a.visible = true;
    else if (t.startsWith('--')) throw new Error('unknown flag ' + t);
    else a.scenarios.push(t);
  }
  return a;
}

// ─── Which scenarios ─────────────────────────────────────────────────────────

const SCEN_DIR = path.join(__dirname, 'scenarios');
const ACC_DIR = path.join(SCEN_DIR, 'acceptance');

function resolveScenarios(names) {
  if (!names.length) return [path.join(SCEN_DIR, 'smoke.js')];
  const out = [];
  for (const n of names) {
    if (n === 'regression') {
      out.push(...fs.readdirSync(ACC_DIR).filter(f => f.endsWith('.js')).sort()
                 .map(f => path.join(ACC_DIR, f)));
      continue;
    }
    const bare = n.replace(/\.js$/, '');
    const hit = [path.join(SCEN_DIR, bare + '.js'), path.join(ACC_DIR, bare + '.js')]
      .find(p => fs.existsSync(p));
    if (!hit) throw new Error('no scenario named "' + n + '" — looked in scenarios/ and scenarios/acceptance/');
    out.push(hit);
  }
  return out;
}

// ─── The output directory, and the guard that keeps it out of git ────────────

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// The rig's own startup assertion, so the ignore rule cannot silently rot: if someone deletes the
// pattern, or points --out into the repo under a name git would happily track, the run stops here
// rather than committing a screenshot three sessions later.
function assertOutputCannotBeCommitted(outDir) {
  const text = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  if (!/^\.rig\/$/m.test(text)) {
    throw new Error('.gitignore no longer carries the "' + OUT_DIRNAME + '/" line. Rig output is ' +
                    'regenerable and one artefact is a video file — put the line back before running.');
  }
  if (isInside(ROOT, outDir) && path.basename(outDir) !== OUT_DIRNAME) {
    throw new Error('--out points inside the repo at ' + outDir + ', which git would track. ' +
                    'Use a path outside the working tree, or name the directory "' + OUT_DIRNAME + '".');
  }
}

// ─── Launching the app ───────────────────────────────────────────────────────

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Every live child, so one kill can reach all of them however the run ends.
const live = new Set();

function killApp(proc) {
  if (!proc || !live.has(proc)) return;
  live.delete(proc);
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try { process.kill(-proc.pid, 'SIGKILL'); } catch (_) {}
    try { proc.kill('SIGKILL'); } catch (_) {}
  }
}

function killAll() { for (const p of Array.from(live)) killApp(p); }

// ─── Getting the run off the screen ──────────────────────────────────────────
// A run used to own the machine: both windows opened in front and stayed there, so nobody could
// work while one was going. offscreen.ps1 parks every window this run opens at -9000,-9000,
// without activating any of them.
//
// ⚠ ONE PARKER FOR THE WHOLE RUN, STARTED BEFORE THE FIRST APP, AND AWAITED. PowerShell needs
// ~1s to start and compile the parker's C#. A parker started per app spends that second watching
// a window that is already on screen holding focus, so a regression showed one window and stole
// focus once PER SCENARIO. The parker signals through a ready file and startParker waits for it.
//
// ⚠ IT MATCHES ON THIS RUN'S OUTPUT DIRECTORY, which is on every app's --user-data-dir, so it
// can only ever move this run's windows. Matching on the process name would park the DM's real
// Evermist off their own screen mid-session.
//
// ⚠ THIS DEPENDS ON KEEP_PAINTING BELOW. A parked window is the strongest case of "nobody can
// see this", and without those switches Chromium would stop painting it and every measurement
// would read zero. Do not remove one without the other.
//
// Windows only, and best-effort by design: if PowerShell is missing or refuses, the run still
// works, it is just visible. `--visible` turns it off for when someone wants to watch.
const OFFSCREEN_PS1 = path.join(__dirname, 'offscreen.ps1');
const PARKER_READY_MS = 5000;

async function startParker(args, outDir) {
  if (args.visible || process.platform !== 'win32') return null;
  const readyFile = path.join(outDir, '.parker-ready');
  let ps;
  try {
    ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', OFFSCREEN_PS1, outDir, String(Math.ceil(HARD_TIMEOUT_MS / 1000)), readyFile],
      { stdio: 'ignore', windowsHide: true });
    ps.on('error', () => {});
  } catch (_) { return null; }

  // Bounded: a parker that never reports ready leaves the run visible, which is worth far less
  // than a run that refuses to start.
  const deadline = Date.now() + PARKER_READY_MS;
  while (Date.now() < deadline) {
    if (fs.existsSync(readyFile)) return ps;
    if (ps.exitCode !== null) return null;
    await new Promise(r => setTimeout(r, 50));
  }
  return ps;
}

// ─── Keeping both windows painting while they are not in front ───────────────
// Windows tells Chromium when a window is covered, and Chromium then stops painting it. That is
// correct for a real app and wrong for a test: the rig reads pixels, so a covered window makes
// every measurement read zero and the run fails with nothing wrong. It is also what makes a run
// unusable while anyone works on the machine, because any other window in front stops the app.
//
// These are CHROMIUM switches passed at launch, not app changes: nothing in src/ knows about
// them and the shipped .exe never sees them. What they cost is that the rig no longer exercises
// the app's own occluded and backgrounded behaviour — which no scenario asserts, and which the
// DM's real setup (two windows, one per screen, both visible) does not enter either.
// PROVEN, not assumed. With these three removed and the windows held at the back of the z-order,
// the Player fails with exactly the long-standing "never became visible" error and its exact
// diagnostic — outer 1200x800, inner 2560x1440, focus true. With them, the same run passes.
// That was the cause all along: something else in front of the window, most often a person
// working on the machine while a run is going.
const KEEP_PAINTING = [
  '--disable-features=CalculateNativeWinOcclusion',  // stop Windows reporting the window covered
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
];

// ⚠ THIS IS WHAT MAKES THE SANDBOXED-RENDERER FILTER SAFE (cdp.js NOISE). That filter swallows
// two messages that Electron logs when a renderer's bootstrap is cut short, because the splash
// window produces them on roughly one boot in thirty and they cost a full re-run. A REAL preload
// failure logs the same words, and the app degrades quietly when it happens: every electronAPI
// call is behind a truthiness guard, so the DM still boots, still reaches DM_READY, and still
// answers every check that needs no disk. The run would go green with no IPC at all.
//
// So the preload is checked directly on every boot, not inferred from the absence of a message.
// `electronAPI` is on `window` for real — contextBridge puts it there — which is the one case
// where `window.x` is right in this codebase.
function assertPreloadRan(dm) {
  return dm.evaluate('window.electronAPI ? Object.keys(window.electronAPI).length : -1')
    .then(n => {
      if (n < 1) {
        throw new Error('the preload did not run: window.electronAPI is ' +
          (n === -1 ? 'missing' : 'empty') + '. Every disk and IPC path is dead, and the app hides ' +
          'that behind truthiness guards rather than failing — so the run would otherwise pass. ' +
          'Do NOT filter this away in cdp.js.');
      }
    });
}

// ─── Giving the Player the screen it has at the table ────────────────────────
// The Player used to be forced fullscreen, so every scenario measured it at the real display
// size. It is windowed now (see showPlayer), which would leave every Player check reading a
// 1200x800 canvas the table never sees — and Player rendering is size-dependent: its fog is a
// Canvas-2D layer composited over the PixiJS map with an edge margin, and that seam took a long
// time to settle (docs/DECISIONS.md).
//
// Emulation.setDeviceMetricsOverride resizes the RENDERER only. The OS window stays parked
// off-screen, so this costs nothing back. Best-effort: a Player at the wrong size is worth less
// coverage, not a failed run, so a refusal here is reported and stepped over.
async function sizePlayerToScreen(session) {
  try {
    const s = await session.evaluate('({ w: screen.width, h: screen.height })');
    if (!s || !(s.w > 0) || !(s.h > 0)) return null;
    await session.send('Emulation.setDeviceMetricsOverride',
      { width: s.w, height: s.h, deviceScaleFactor: 1, mobile: false });
    await session.evaluate('syncSize(); viewportDirty = true; scheduleRender(); 0');
    return s;
  } catch (_) { return null; }
}

// Boots the app, attaches to the DM, and hands back everything a scenario needs.
async function startInstance(args, profileDir) {
  fs.mkdirSync(profileDir, { recursive: true });
  const port = await freePort();

  // --exe drives a built installer, for the packaging bug class `npm start` cannot see. It is
  // NOT the default: a build per run is minutes, and a rig that slow stops being used.
  const bin = args.exe ? path.resolve(args.exe) : require(path.join(ROOT, 'node_modules', 'electron'));
  const argv = (args.exe ? [] : ['.'])
    .concat(KEEP_PAINTING)
    .concat(['--remote-debugging-port=' + port, '--user-data-dir=' + profileDir]);
  const proc = spawn(bin, argv, {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',   // so the whole group can be killed at once
  });
  live.add(proc);
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  let diedEarly = null;
  proc.once('exit', code => { live.delete(proc); diedEarly = code; });

  // The splash window is a page target too, so match on the DM's own document and exclude the
  // Player's query string. This wait is also the app's boot: the debug endpoint does not answer
  // at all until Chromium is up, so it polls rather than sleeping a guess.
  let dmTarget;
  try {
    dmTarget = await cdp.waitForTarget(port,
      t => t.url.includes('index.html') && !t.url.includes('mode=player'), 90000, 'the DM window');
  } catch (err) {
    if (diedEarly != null) throw new Error('the app exited on its own (code ' + diedEarly + ')');
    throw err;
  }
  const browser = await cdp.connectBrowser(port);
  const dm = await cdp.connect(dmTarget.webSocketDebuggerUrl, 'dm');
  await dm.watch();
  await dm.waitFor(DM_READY, 90000, 'the DM init chain');
  await assertPreloadRan(dm);

  // ⚠ REFUSE TO RUN AGAINST A LIBRARY THAT ALREADY HAS SCENES IN IT. Scenarios import maps,
  // switch scenes (which autosaves the outgoing one) and restore backups, so a rig run on real
  // data damages it. The isolated --user-data-dir normally guarantees an empty library, but the
  // portable build calls app.setPath('userData', …) from PORTABLE_EXECUTABLE_DIR and overrides
  // the flag entirely — so with `--exe dist/Evermist.exe` the rig lands in the library beside
  // that .exe. An empty library is the observable proof that isolation held; check it, do not
  // assume it.
  // Retried, because the scene database comes up inside initScenes and can still be null when
  // the control panel (the DM_READY signal) has already been built.
  const existing = await dm.evaluate(`(async () => {
    for (let i = 0; i < 75; i++) {
      try { return (await sceneStore.listScenes()).length; }
      catch (_) { await new Promise(r => setTimeout(r, 200)); }
    }
    throw new Error('the scene database never came up');
  })()`, 60000);
  if (existing > 0) {
    throw new Error('the app opened a library that already holds ' + existing + ' scenes, so the ' +
      'isolated profile did not take and a run would damage real maps. A portable build ignores ' +
      '--user-data-dir and keeps its data beside the .exe; point --exe at dist/win-unpacked/' +
      'Evermist.exe instead, which honours it.');
  }

  return { proc, port, browser, dm, dmTargetId: dmTarget.id, player: null };
}

// ─── The rig handed to a scenario ────────────────────────────────────────────

// THE PLAYER USED TO BE FORCED FULLSCREEN, and it no longer is. It opens inside the DM's
// rectangle, so Chromium marked it occluded and stopped giving it frames — `document.hidden`
// true, no requestAnimationFrame, and everything the app defers to a frame silently never
// happening. Fullscreen was the only thing that cleared it, and a fullscreen Player then covered
// the DM, so any scenario needing both windows had to drive them in turns.
//
// KEEP_PAINTING removes the cause, so none of that applies now: a Player that is covered, behind,
// or parked off-screen keeps painting. Not asking for fullscreen is what lets the whole run sit
// off-screen (offscreen.ps1) instead of taking the machine away from whoever is using it.
//
// The retry loop stays. It is now only about a Player that has not finished coming up, so it
// simply waits and re-checks rather than throwing fullscreen transitions at the window.
// `Page.bringToFront` is gone with the rest: it cannot raise a separate OS window anyway,
// because Electron does not expose the CDP Browser domain (cdp.js).
async function showPlayer(session, budgetMs) {
  const deadline = Date.now() + budgetMs;
  let asked = 0;
  for (;;) {
    if (asked > 0) await cdp.sleep(500);
    asked++;
    try {
      // Short per-attempt wait, so a dropped request is retried rather than sat out.
      await session.waitFor('!document.hidden', 5000, 'the Player window to become visible');
      return asked;
    } catch (_) {
      // Named plainly, so a display that is asleep does not read as a fog bug.
      if (Date.now() > deadline) {
        // What the window itself says, so the failure names a cause instead of a symptom.
        let diag = '';
        try {
          diag = JSON.stringify(await session.evaluate(`({
            visibility: document.visibilityState, hidden: document.hidden,
            outer: window.outerWidth + 'x' + window.outerHeight,
            inner: window.innerWidth + 'x' + window.innerHeight,
            screen: screen.width + 'x' + screen.height,
            avail: screen.availWidth + 'x' + screen.availHeight,
            devicePixelRatio, focus: document.hasFocus(),
          })`));
        } catch (e) { diag = 'could not be read: ' + e.message; }
        throw new Error('the Player window never became visible after ' + asked + ' checks over ' +
          Math.round(budgetMs / 1000) + 's — while it is hidden it renders nothing and every ' +
          'measurement reads zero. The known cause of this was Windows reporting the window ' +
          'occluded, which KEEP_PAINTING now switches off; if it is back, check those switches ' +
          'still reach the app. The window reports ' + diag);
      }
    }
  }
}

function makeRig(inst, dirs, tally) {
  const rig = {
    dm: inst.dm,
    outDir: dirs.scenario,
    fixtureDir: dirs.fixtures,
    profileDir: dirs.profile,
    root: ROOT,
    fixtures: require('./fixtures'),
    sleep: cdp.sleep,

    // The collector every scenario asserts through. A message reads as the failure, not the
    // expectation, because it is what lands in the FAIL line.
    check(condition, message) {
      tally.checked++;
      if (!condition) tally.fails.push(message);
      return !!condition;
    },
    // A criterion nobody can automate. It stays in the scenario file and the report lists it as
    // unchecked, rather than being dropped silently.
    byEye(message) { tally.byEye.push(message); },
    note(message) { tally.notes.push('  ' + message); },

    // The Player window, attached the first time a scenario asks for it. Opening it is the DM's
    // own button, so this is the app's real path and not a second window the rig conjured.
    //
    // ⚠ THE "PLAYER COMES UP INVISIBLE" FAULT IS SOLVED, and the recovery below is now a
    // backstop rather than a workaround. The cause was Windows reporting the window occluded, so
    // Chromium stopped painting it and the page reported itself hidden; KEEP_PAINTING switches
    // that off and a run survives being parked off-screen for its whole length. If the recovery
    // fires, something has gone wrong with those switches — do not treat it as normal.
    //
    // What the recovery does, when it does fire: press the DM's Player button to CLOSE the window
    // (the button toggles), wait for the target to go, and open a fresh one.
    async player() {
      if (inst.player) return inst.player;

      const openOne = async () => {
        const already = (await cdp.listTargets(inst.port)).some(t => t.url.includes('mode=player'));
        if (!already) await inst.dm.evaluate('document.getElementById("btn-player").click(); 0');
        const target = await cdp.waitForTarget(inst.port, t => t.url.includes('mode=player'), 30000,
                                               'the Player window');
        const session = await cdp.connect(target.webSocketDebuggerUrl, 'player');
        await session.watch();
        await session.waitFor(PLAYER_READY, 30000, 'the Player runtime');
        // ⚠ THE PLAYER'S PRELOAD IS CHECKED TOO, and for the same reason as the DM's: cdp.js
        // filters the two messages a failed preload logs. Nothing else here touches the Player's
        // electronAPI any more, so without this a Player with no IPC would run green and quietly
        // lose readVideoFile on every animated map.
        await assertPreloadRan(session);
        // The TV is a big screen and the window is parked off-screen at its default size, so the
        // renderer's viewport is overridden to the real display instead. Player rendering is
        // size-dependent — its fog is a Canvas-2D layer composited over the map with an edge
        // margin — so measuring it at 1200x800 would test a size the table never uses. This
        // changes the renderer only; the OS window stays parked.
        await sizePlayerToScreen(session);
        return session;
      };

      const closeOne = async session => {
        session.close();
        await inst.dm.evaluate('(() => { const b = document.getElementById("btn-player");' +
          ' if (playerWindow && !playerWindow.closed) b.click(); return 0; })()');
        try {
          await cdp.waitForTarget(inst.port, t => !t.url.includes('mode=player'), 1, 'x');
        } catch (_) { /* the poll below is the real wait */ }
        const gone = Date.now() + 10000;
        while (Date.now() < gone) {
          const still = (await cdp.listTargets(inst.port)).some(t => t.url.includes('mode=player'));
          if (!still) break;
          await cdp.sleep(200);
        }
      };

      // First attempt gets the short budget, so a stuck window is abandoned quickly rather than
      // burning the whole timeout on transitions that cannot work.
      let session = await openOne();
      try {
        const asked = await showPlayer(session, 12000);
        if (asked > 1) tally.notes.push('  the Player took ' + asked + ' checks to report visible');
      } catch (first) {
        tally.notes.push('  the Player came up invisible and was reopened — ' + first.message);
        await closeOne(session);
        session = await openOne();
        const asked = await showPlayer(session, 30000);
        tally.notes.push('  the reopened Player took ' + asked + ' check(s) to report visible');
      }
      inst.player = session;
      return session;
    },
  };
  return rig;
}

// ─── --shot: crop a screenshot to a CSS selector ─────────────────────────────
// So a change can be LOOKED AT rather than reasoned about. The panels here move with content, so
// a fixed crop misses them.

async function takeShot(rig, dm, selector, setup) {
  if (setup) { await dm.evaluate(setup + '; 0'); await cdp.sleep(400); }
  const r = await dm.evaluate('(() => { const el = document.querySelector(' + JSON.stringify(selector) + ');' +
    ' if (!el) return null; const b = el.getBoundingClientRect();' +
    ' return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; })()');
  if (!r) return rig.check(false, 'no element matches ' + selector);
  if (!r.w || !r.h) return rig.check(false, selector + ' has no size — it is probably inside a ' +
    'display:none parent. Pass --shot-setup to reveal it first.');
  const PAD = 26;
  const dest = path.join(rig.outDir, 'shot.png');
  await dm.screenshot(dest, {
    x: Math.max(0, r.x - PAD), y: Math.max(0, r.y - PAD),
    width: r.w + PAD * 2, height: r.h + PAD * 2,
  });
  rig.note('wrote ' + dest + '  (' + selector + ' at ' + r.x + ',' + r.y + ' ' + r.w + 'x' + r.h + ')');
  return true;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = args.out ? path.resolve(args.out) : path.join(TEMP_ROOT, stamp);
  assertOutputCannotBeCommitted(outDir);

  const fixtureDir = path.join(outDir, 'fixtures');
  fs.mkdirSync(fixtureDir, { recursive: true });

  const files = (args.shot && !args.scenarios.length) ? [] : resolveScenarios(args.scenarios);
  const tally = { checked: 0, fails: [], byEye: [], notes: [], consoleErrors: [] };

  // --shot with no scenario named still needs an app to photograph.
  const plan = files.length ? files : [null];

  // Before the first app, so no window is ever on screen long enough to take focus.
  const parker = await startParker(args, outDir);
  const stopParker = () => { if (parker) try { parker.kill(); } catch (_) {} };
  process.once('exit', stopParker);

  for (const file of plan) {
    const name = file ? path.basename(file, '.js') : 'shot';
    const dirs = {
      fixtures: fixtureDir,
      scenario: path.join(outDir, name),
      profile: path.join(outDir, name, 'profile'),
    };
    fs.mkdirSync(dirs.scenario, { recursive: true });

    tally.notes.push('── ' + name);
    const inst = await startInstance(args, dirs.profile);
    const rig = makeRig(inst, dirs, tally);
    try {
      if (file) await require(file)(rig);
      if (args.shot && file === plan[plan.length - 1]) await takeShot(rig, inst.dm, args.shot, args.shotSetup);
    } finally {
      for (const s of [inst.dm, inst.player]) if (s) tally.consoleErrors.push(...s.errors);
      for (const s of [inst.dm, inst.player]) if (s) s.close();
      killApp(inst.proc);
    }
  }

  for (const n of tally.notes) console.log(n);
  if (tally.consoleErrors.length) console.log('CONSOLE ERRORS:\n  ' + tally.consoleErrors.join('\n  '));

  const fails = tally.fails.concat(tally.consoleErrors.length ? ['console errors during the run'] : []);
  if (fails.length) console.log('FAIL ' + fails.join('; '));
  else console.log('PASS — ' + tally.checked + ' checks');
  for (const item of tally.byEye) console.log('UNCHECKED (yours to judge): ' + item);
  console.log('output: ' + outDir);

  killAll();
  process.exit(fails.length ? 1 : 0);
}

const watchdog = setTimeout(() => {
  console.log('FAIL the rig timed out after ' + (HARD_TIMEOUT_MS / 1000) + 's');
  killAll();
  process.exit(1);
}, HARD_TIMEOUT_MS);
watchdog.unref();

function die(err) {
  console.log('FAIL the rig threw: ' + (err && err.stack ? err.stack : err));
  killAll();
  process.exit(1);
}
process.on('unhandledRejection', die);
process.on('uncaughtException', die);
process.on('SIGINT', () => { killAll(); process.exit(130); });
process.on('exit', killAll);

main().catch(die);
