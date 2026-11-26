#!/usr/bin/env node
'use strict';

// board-check.js — a mockup board measured against design-system.md's "Alignment" before the DM sees it:
// the rig's own sweep (lib.alignSweep, lib.inkSweep) over the whole page, at the zoom the page sets. The board's own
// prose (a p, heading or list item that is no flex or grid row) is left out: a caption may write "31 × 22" in a
// sentence, and the rule is about rows. The sweep starts under it, so a text standing loose beside prose is not read.
//
//   node tools/board-check.js <board.html>
//
// Exit 0 clean, 1 with one line per faulty row, 3 when the check could not run (the publish hook lets the board
// through on 3). Run from Node it starts Electron on this same file; inside Electron it does the work.
//
// ⚠ NO WINDOW MAY REACH THE DM'S SCREEN. The window is never shown, and on Linux Chromium runs on its headless
// ozone platform with no display in its environment, so no process of it connects to the desktop's Wayland or X
// server at all. It paints offscreen and without the GPU, which a headless Chromium cannot open.

const path = require('path');
const fs = require('fs');
const os = require('os');

const WIDTH = 1280;
// Chromium's largest texture side; a taller board is measured down to here and the rest is named as unchecked.
const MAX_HEIGHT = 16000;
const ROOTS = `(() => {
  const PROSE = 'p, h1, h2, h3, h4, h5, h6, li, dt, dd, blockquote, figcaption, pre';
  const prose = (e) => e.matches(PROSE) && !/flex|grid/.test(getComputedStyle(e).display);
  // An option marked data-as-is shows today's look on purpose, its faults included.
  const skip = (e) => prose(e) || e.matches('[data-as-is]');
  const mark = (e) => {
    if (skip(e)) return;
    if (![...e.querySelectorAll(PROSE + ', [data-as-is]')].some(skip)) e.setAttribute('data-board-check-root', '');
    else for (const c of e.children) mark(c);
  };
  mark(document.body);
  return 1;
})()`;

if (!process.versions.electron) {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) {
    console.error('board-check: no such file: ' + (file || '(none given)'));
    process.exit(3);
  }
  let electron;
  try { electron = require('electron'); } catch (e) {
    console.error('board-check: could not run: Electron is not installed (' + e.message.split('\n')[0] + ')');
    process.exit(3);
  }
  const env = Object.assign({}, process.env);
  // No display to reach: Chromium cannot open a connection to the desktop it was never told about.
  for (const k of ['ELECTRON_RUN_AS_NODE', 'WAYLAND_DISPLAY', 'DISPLAY']) delete env[k];
  const run = require('child_process').spawnSync(electron, ['--ozone-platform=headless', __filename, path.resolve(file)],
    { env, stdio: ['ignore', 'inherit', 'pipe'], encoding: 'utf8', timeout: 120000 });
  // 0 and 1 are verdicts, and 3 has said why already.
  if (run.status === 0 || run.status === 1 || run.status === 3) process.exit(run.status);
  const why = run.error ? run.error.message : run.signal ? 'killed by ' + run.signal : 'exit ' + run.status;
  console.error('board-check: could not run: ' + why + (run.stderr ? '\n' + run.stderr.trim().split('\n').slice(-5).join('\n') : ''));
  process.exit(3);
} else {
  const { app, BrowserWindow } = require('electron');
  const lib = require('./rig/lib');
  const file = process.argv[process.argv.length - 1];
  app.disableHardwareAcceleration();
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'evermist-board-check-')));
  const quit = (code, text) => { process.stdout.write(text); fs.rmSync(app.getPath('userData'), { recursive: true, force: true }); app.exit(code); };
  app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: WIDTH, height: 900, webPreferences: { offscreen: true, backgroundThrottling: false } });
    const dbg = win.webContents.debugger;
    dbg.attach('1.3');
    const session = {
      send: (method, params) => dbg.sendCommand(method, params || {}),
      evaluate: async (expression) => {
        const r = await dbg.sendCommand('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
        return r.result.value;
      },
    };
    await win.loadFile(file);
    await session.evaluate('document.fonts.ready.then(() => 1)');
    // The whole page in one viewport: the sweep reads only what is on screen.
    const height = await session.evaluate('Math.ceil(document.documentElement.scrollHeight)');
    await session.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: Math.min(height, MAX_HEIGHT), deviceScaleFactor: 1, mobile: false });
    await session.evaluate('document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1)))))');
    await session.evaluate(ROOTS);
    const swept = await lib.alignSweep(session, '[data-board-check-root]');
    const inked = await lib.inkSweep(session, swept.ink);
    const faults = swept.faults.concat(inked.faults);
    const notes = inked.unmoved.map((u) => 'unchecked: no layout offset moved the page (' + u + '), so its rows were judged at one position');
    if (height > MAX_HEIGHT) notes.push('unchecked: everything below ' + MAX_HEIGHT + 'px of a ' + height + 'px page');
    const head = path.basename(file) + ': ' + swept.rows + ' rows, ' + inked.measured.length + ' inked, ' + faults.length + ' faults\n';
    quit(faults.length ? 1 : 0, head + faults.map((f) => '  ' + f + '\n').join('') + notes.map((n) => '  ' + n + '\n').join(''));
  }).catch((e) => quit(3, 'board-check: could not run: ' + e.message + '\n'));
}
