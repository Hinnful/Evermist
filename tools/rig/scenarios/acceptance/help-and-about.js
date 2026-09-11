'use strict';

// help-and-about.js — THE ONE "WHAT IS THIS" BUTTON.
//
// THE GOAL OF THIS FEATURE: the DM presses one button in the corner and gets the keyboard
// shortcuts, with the app's name, version and repo underneath. It is the only place the app
// explains itself, and the Player screen must never show any of it.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks directly beneath it, in order.
//
//   A. The help button opens the panel and its backdrop, and pressing it again shuts both.
//   B. The ? key opens it, Escape shuts it, and so does a click on the backdrop.
//   C. Every key the panel advertises does something. A shortcut listed here and ignored by the
//      app is worse than one that was never listed.
//   D. The About footer carries the mark, the wordmark and the repo, and its version is the one
//      the build was cut with — never a literal in the page that goes stale on the next bump.
//   E. The Player screen carries neither the button nor the panel.
//
// ⚠ THE VERSION IS HELD AGAINST package.json, WHICH IS WHAT main HANDS THE PAGE. Checking that
// the line is merely non-empty passes on a hard-coded string, which is the one failure this is
// for.
//
// ⚠ C DRIVES EACH KEY AND WATCHES THE APP, rather than reading the panel's own markup back to
// itself. A check that finds the letter E in the HTML passes whether or not E picks a tool.
//
// ⚠ EVERY KEY CARRIES THE SETUP THAT GIVES IT WORK TO DO, and nothing is restored afterwards.
// A toggle is read as having CHANGED, never as landing on a particular value, so a key pressed
// after another one flipped something still reports what it itself did. Adding a key that reads
// an absolute value would need its own setup here; there is no restore for it to lean on.

const MAP_W = 1600, MAP_H = 1000;

const LEGEND = '#shortcut-legend';
const BACKDROP = '#legend-backdrop';

// ⚠ WHETHER IT HAS A BOX, never its own computed `display`. The help button is hidden by
// `body.player-mode #help-corner { display: none }` on its CONTAINER, and a child of a hidden
// parent still computes its own display as `block` — so reading the button reports the Player as
// showing a button it does not show.
const SHOWN = `(sel => { const el = document.querySelector(sel);
  return !!el && el.getClientRects().length > 0; })`;

const HELPERS = `
globalThis.__rigKey = (k, mods) => document.dispatchEvent(new KeyboardEvent('keydown',
  Object.assign({ key: k, bubbles: true, cancelable: true }, mods || {})));
globalThis.__rigShown = ${SHOWN};
globalThis.__rigPanel = () => ({ panel: __rigShown('${LEGEND}'), back: __rigShown('${BACKDROP}') });
// Everything a listed shortcut could move. One blob, so a key that changes nothing is visible
// without naming what each one was supposed to touch.
globalThis.__rigKeyState = () => ({
  shape: shape, tool: tool, snap: snapToGrid, grid: gridEnabled,
  anim: fogAnimEnabled, labels: showRoomLabels, brush: brushSize,
  zoom: +zoom.toFixed(4), panX: Math.round(panX), panY: Math.round(panY),
  rooms: polygons.length,
});
0`;

module.exports = async function helpAndAboutFeature(rig) {
  const dm = rig.dm;

  await dm.evaluate(HELPERS);

  // ── A. The button opens it and shuts it ───────────────────────────────────
  const shut = await dm.evaluate('__rigPanel()');
  rig.check(!shut.panel && !shut.back,
            'the shortcut panel is already up before anything was pressed, so opening it cannot ' +
            'be told from it having been open: ' + JSON.stringify(shut));

  await dm.evaluate('document.getElementById("btn-help").click(); 0');
  const opened = await dm.evaluate('__rigPanel()');
  rig.check(opened.panel,
            'the help button did not open the shortcut panel, which is the app\'s only way in ' +
            'to what its keys do');
  rig.check(opened.back,
            'the panel came up without its backdrop, so the map behind it still takes clicks ' +
            'meant for the panel');

  await dm.evaluate('document.getElementById("btn-help").click(); 0');
  const toggled = await dm.evaluate('__rigPanel()');
  rig.check(!toggled.panel && !toggled.back,
            'the help button does not shut the panel it opened: ' + JSON.stringify(toggled));

  // ── B. ? opens, Escape shuts, the backdrop shuts ──────────────────────────
  await dm.evaluate('__rigKey("?")');
  rig.check((await dm.evaluate('__rigPanel()')).panel,
            'the ? key did not open the panel, though the button it sits on advertises it');

  await dm.evaluate('__rigKey("Escape")');
  rig.check(!(await dm.evaluate('__rigPanel()')).panel,
            'Escape did not shut the panel, so the DM is left pressing keys at a sheet over ' +
            'the map');

  await dm.evaluate('__rigKey("?"); document.getElementById("legend-backdrop").click(); 0');
  const afterBackdrop = await dm.evaluate('__rigPanel()');
  rig.check(!afterBackdrop.panel && !afterBackdrop.back,
            'clicking beside the panel did not shut it: ' + JSON.stringify(afterBackdrop));

  // ── C. Every key the panel lists does something ───────────────────────────
  // A map and a room first: four of the keys below do nothing without one, and a key that is
  // inert for want of a map looks exactly like a key that is dead.
  const map = await rig.fixtures.tableMap(dm, rig.fixtureDir, { w: MAP_W, h: MAP_H });
  await dm.evaluate('createNewScene(' + (await rig.fixtures.asFileExpr(dm, map)) + ')', 120000);
  await dm.waitFor('currentScene && currentScene.mapType === "video" && mapWidth === ' + MAP_W,
                   120000, 'the map to load on the DM');

  // The keys the panel advertises, each with the field it has to move. `setup` puts the app in
  // the one state where the key has work to do.
  const KEYS = [
    { key: 'e', field: 'shape',  setup: 'setShape("select")' },
    { key: 'p', field: 'shape',  setup: 'setShape("select")' },
    { key: 'c', field: 'shape',  setup: 'setShape("select")' },
    { key: 'v', field: 'shape',  setup: 'setShape("rect")' },
    { key: 'r', field: 'tool',   setup: 'document.getElementById("btn-shroud").click()' },
    { key: 's', field: 'tool',   setup: 'document.getElementById("btn-reveal").click()' },
    { key: 'n', field: 'snap',   setup: '0' },
    { key: 'g', field: 'grid',   setup: '0' },
    { key: 'a', field: 'anim',   setup: '0' },
    { key: 'l', field: 'labels', setup: '0' },
    { key: '[', field: 'brush',  setup: 'brushSize = 100' },
    { key: ']', field: 'brush',  setup: 'brushSize = 100' },
    // Fit has nothing to do from a fitted view, so the camera is moved off first.
    { key: 'f', field: 'zoom',   setup: 'zoom = 0.2; panX = 40; panY = 40; viewportDirty = true; scheduleRender()' },
  ];

  const dead = [];
  for (const k of KEYS) {
    const before = await dm.evaluate('(() => { ' + k.setup + '; return __rigKeyState(); })()');
    await dm.evaluate('__rigKey(' + JSON.stringify(k.key) + ')');
    const after = await dm.evaluate('__rigKeyState()');
    if (before[k.field] === after[k.field]) dead.push(k.key.toUpperCase() + ' (' + k.field + ')');
  }
  rig.check(dead.length === 0,
            'the shortcut panel lists ' + dead.length + ' key(s) the app does nothing with, so ' +
            'the DM presses them at the table and nothing happens: ' + dead.join(', '));

  // Undo and redo are listed too, and they need something done first to have anything to take
  // back. Drawing is the shortest thing that leaves a record.
  await dm.evaluate(`(() => {
    setShape('rect'); setShapeOp('new');
    document.getElementById('btn-reveal').click();
    const r = container.getBoundingClientRect();
    const at = (mx, my) => ({ clientX: mx * zoom + panX + r.left, clientY: my * zoom + panY + r.top,
                              bubbles: true, cancelable: true, button: 0 });
    container.dispatchEvent(new MouseEvent('mousedown', at(300, 300)));
    container.dispatchEvent(new MouseEvent('mousemove', at(500, 500)));
    container.dispatchEvent(new MouseEvent('mouseup', at(500, 500)));
    setShape('select');
    return 0;
  })()`);
  const drawn = await dm.evaluate('polygons.length');
  rig.check(drawn > 0, 'nothing was drawn, so Undo below has nothing to take back and proves nothing');

  await dm.evaluate('__rigKey("z", { ctrlKey: true })');
  const undone = await dm.evaluate('polygons.length');
  rig.check(undone < drawn,
            'Ctrl+Z is on the panel and took nothing back: ' + drawn + ' rooms before, ' +
            undone + ' after');
  await dm.evaluate('__rigKey("y", { ctrlKey: true })');
  rig.check(await dm.evaluate('polygons.length') === drawn,
            'Ctrl+Y is on the panel and put nothing back');

  // ── D. The About footer, and a version that came from the build ───────────
  await dm.waitFor('!!document.getElementById("about-version")', 10000, 'the About block to build');
  // ⚠ POLLED. The version arrives over IPC after init, so a single read lands before it on a
  // slow machine and reports the app as having no version at all.
  try { await dm.waitFor('document.getElementById("about-version").textContent.trim() !== ""',
                         15000, 'the version to arrive from main'); } catch (_) {}
  const about = await dm.evaluate(`(() => {
    const slot = document.getElementById('legend-about');
    const v = document.getElementById('about-version');
    return {
      mark: !!slot.querySelector('svg.about-mark'),
      wordmark: (slot.querySelector('.about-wordmark') || {}).textContent || '',
      repo: (slot.querySelector('.about-repo') || {}).textContent || '',
      version: (v ? v.textContent : '').trim(),
      versionShown: !!v && getComputedStyle(v).display !== 'none',
    };
  })()`);
  rig.note('About: ' + JSON.stringify(about));
  rig.check(about.mark, 'the About block has no app mark, so the panel names the app without showing it');
  rig.check(about.wordmark === 'EVERMIST',
            'the About block does not carry the wordmark: ' + JSON.stringify(about.wordmark));
  rig.check(about.repo === 'github.com/Hinnful/Evermist',
            'the About block points somewhere other than the repo: ' + JSON.stringify(about.repo));

  const pkgVersion = require(require('path').join(rig.root, 'package.json')).version;
  rig.check(about.versionShown,
            'the version line is hidden, so the DM cannot tell which build they are running');
  rig.check(about.version === 'Version ' + pkgVersion,
            'the About block shows ' + JSON.stringify(about.version) + ' while this build is ' +
            pkgVersion + ', so the version is not the one main handed the page');

  // ── E. None of it reaches the Player ──────────────────────────────────────
  const player = await rig.player();
  const tv = await player.evaluate(`(() => {
    const el = (s) => document.querySelector(s);
    const vis = ${SHOWN};
    return { helpThere: !!el('#btn-help'), helpShown: vis('#btn-help'),
             cornerShown: vis('#help-corner'),
             panelShown: vis('${LEGEND}'), aboutText: ((el('#legend-about') || {}).innerText || '').trim() };
  })()`);
  rig.check(!tv.helpShown && !tv.cornerShown,
            'the Player screen shows the help button, and the Player screen carries no UI at all');
  rig.check(!tv.panelShown,
            'the Player screen shows the shortcut panel in front of the players');
  rig.check(tv.aboutText === '',
            'the Player screen carries the About text, so the app names itself on the TV: ' +
            JSON.stringify(tv.aboutText));

  // ⚠ THE UPDATE LINE UNDER ABOUT CANNOT BE DRIVEN FROM HERE. updater.js renders on an IPC
  // message from main, its render function is a closure, and electronAPI comes through
  // contextBridge and cannot be stubbed. Reaching it needs main to send a status, which no
  // scenario can ask for.
  rig.byEye('the update line under About: that a new version shows as "Version X is ready" with ' +
            'a Restart to update button, and that macOS shows the manual line instead');
  rig.byEye('the Player window landing on a SECOND real display, which is what display.js reads ' +
            'and sizes the window from. The rig runs both windows on one screen and parks them ' +
            'off it, so there is no second display for it to find');
};
