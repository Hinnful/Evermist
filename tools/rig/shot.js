'use strict';

// Screenshots a piece of the running DM view, so a change can be LOOKED AT rather than reasoned
// about. Takes a CSS selector and crops to that element plus a margin, because the panels here
// move with content and a fixed crop misses them.
//
//   npx electron tools/rig/shot.js "#scene-dd-foot" out.png ["<setup js>"]
//
// The optional third argument runs in the page before the capture — that is how you open a panel
// or set a state first, e.g. "openDropdown()".
//
// ⚠ SEED FOR BACKLOG ITEM 7, NOT ITEM 7. The real rig attaches over --remote-debugging-port with
// an isolated --user-data-dir and drives the BUILT .exe. This loads the repo's index.html in a
// plain window. Grow it into that rather than writing a fifth throwaway.
//
// Traps this file already encodes, all of which cost a debugging round to find:
//   - backgroundThrottling MUST be false, or Chromium suspends rAF the moment the window is
//     occluded and the harness hangs forever with no error.
//   - An element inside display:none has ZERO-sized rects, which silently pass any centring or
//     spacing assertion. Run the setup that reveals it first.
//   - An ancestor `zoom` IS folded into getBoundingClientRect in this Chromium, so its numbers
//     match capturePage's coordinates directly. Do not multiply by the zoom yourself.

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const argv = process.argv.slice(2).filter(a => !a.startsWith('--') && !a.endsWith('shot.js'));
const SELECTOR = argv[0] || 'body';
const OUTFILE = argv[1] || 'shot.png';
const SETUP = argv[2] || '';
const PAD = 26;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1500, height: 950, show: true,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, backgroundThrottling: false,
      preload: path.join(ROOT, 'preload.js'),
    },
  });
  win.setMenu(null);
  await win.loadFile(path.join(ROOT, 'index.html'));
  // The init chain finishes with initControlPanel, called last from toolbar.js.
  await new Promise(r => setTimeout(r, 2500));

  if (SETUP) {
    await win.webContents.executeJavaScript(SETUP);
    await new Promise(r => setTimeout(r, 400));
  }

  const r = await win.webContents.executeJavaScript(`(function () {
    const el = document.querySelector(${JSON.stringify(SELECTOR)});
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  })()`);

  if (!r) { console.log('FAIL no element matches ' + SELECTOR); app.exit(1); return; }
  if (!r.w || !r.h) {
    console.log('FAIL ' + SELECTOR + ' has no size — it is probably inside a display:none parent. ' +
                'Pass setup js as the third argument to reveal it first.');
    app.exit(1);
    return;
  }

  const img = await win.webContents.capturePage({
    x: Math.max(0, r.x - PAD), y: Math.max(0, r.y - PAD),
    width: r.w + PAD * 2, height: r.h + PAD * 2,
  });
  const dest = path.isAbsolute(OUTFILE) ? OUTFILE : path.join(process.cwd(), OUTFILE);
  fs.writeFileSync(dest, img.toPNG());
  console.log('wrote ' + dest + '  (' + SELECTOR + ' at ' + r.x + ',' + r.y + ' ' + r.w + 'x' + r.h + ')');
  app.exit(0);
});
