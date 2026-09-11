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
//   E. What's new opens from the About footer, sits ABOVE its own dimmer so the DM can reach
//      it, marks the version they are running, opens any release to the full note it
//      shipped with, and closes every way it offers.
//   F. A ready update announces itself on screen, in the corner and not over the map, and the
//      restart after it says what version arrived. A first-ever run announces nothing.
//   G. The Player screen carries neither the button nor the panel.
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

  // ── E. The What's new panel ───────────────────────────────────────────────
  // ⚠ REACHABILITY IS READ WITH elementFromPoint, never from the panel being in the DOM. The
  // panel and its dimmer share one stacking context, so a dimmer painting over the panel leaves
  // every check on markup, size and position passing while no click can land on it.
  await dm.evaluate('document.getElementById("btn-help").click(); 0');
  rig.check(await dm.evaluate('__rigShown("#about-whatsnew")'),
            'the About footer carries no What\'s new link, so the changelog has no way in');

  await dm.evaluate('document.getElementById("about-whatsnew").click(); 0');
  await dm.waitFor('!!document.getElementById("cl-modal")', 10000, 'the What\'s new panel to build');

  const panel = await dm.evaluate(`(() => {
    const modal = document.getElementById('cl-modal');
    const r = modal.getBoundingClientRect();
    const hitAt = (x, y) => { const el = document.elementFromPoint(x, y); return !!(el && modal.contains(el)); };
    const rows = Array.from(document.querySelectorAll('#cl-body .cl-entry'));
    const first = rows[0] ? rows[0].getBoundingClientRect() : null;
    const closeBox = document.getElementById('cl-close').getBoundingClientRect();
    const chip = document.querySelector('#cl-body .cl-chip');
    return {
      shown: r.width > 0 && r.height > 0,
      centreHit: hitAt(r.left + r.width / 2, r.top + r.height / 2),
      headHit: hitAt(r.left + r.width / 2, r.top + 6),
      rowHit: first ? hitAt(first.left + first.width / 2, first.top + first.height / 2) : false,
      closeHit: hitAt(closeBox.left + closeBox.width / 2, closeBox.top + closeBox.height / 2),
      rows: rows.length,
      entries: typeof CHANGELOG !== 'undefined' ? CHANGELOG.length : -1,
      chips: document.querySelectorAll('#cl-body .cl-chip').length,
      chipOn: chip ? chip.closest('.cl-entry').querySelector('.cl-ver').textContent : '',
    };
  })()`);
  rig.note('What\'s new: ' + JSON.stringify(panel));

  rig.check(panel.shown, 'the What\'s new link opened nothing the DM can see');
  rig.check(panel.centreHit && panel.headHit && panel.rowHit && panel.closeHit,
            'the What\'s new panel is on screen and a click at it lands on something else, so the ' +
            'DM gets a darkened panel they cannot use: ' + JSON.stringify(panel));
  rig.check(panel.rows === panel.entries && panel.rows > 0,
            'the panel lists ' + panel.rows + ' releases out of ' + panel.entries + ' the app carries');
  rig.check(panel.chips === 1 && panel.chipOn.indexOf(pkgVersion) === 0,
            'the panel marks ' + JSON.stringify(panel.chipOn) + ' as installed while this build is ' +
            pkgVersion + ', so the DM cannot tell which releases they already have');


  // ⚠ THE BODY IS HELD AGAINST changelogData.js, not merely found non-empty. A row that expands
  // to the summary again would pass a length check and tell the DM nothing new.
  const expanded = await dm.evaluate(`(() => {
    const row = document.querySelector('#cl-body .cl-entry');
    row.querySelector('.cl-head-btn').click();
    const full = row.querySelector('.cl-full');
    const hitAt = (el) => { const b = el.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return !!(hit && (hit === el || el.contains(hit))); };
    const gh = row.querySelector('.cl-github');
    return {
      open: !full.hidden && full.getClientRects().length > 0,
      text: (row.querySelector('.cl-text') || {}).textContent || '',
      want: CHANGELOG[0].body,
      tag: CHANGELOG[0].tag || '',
      github: !!gh,
      githubHit: gh ? hitAt(gh) : false,
      collapsed: (() => { row.querySelector('.cl-head-btn').click(); return full.hidden; })(),
    };
  })()`);
  rig.check(expanded.open,
            'a release in the panel does not open, so the DM sees one line and never the rest of ' +
            'what that version changed');
  rig.check(expanded.text.length > 0 && expanded.text === expanded.want,
            'an opened release shows text that is not its own description: ' +
            JSON.stringify(expanded.text.slice(0, 80)));
  rig.check(!expanded.tag || (expanded.github && expanded.githubHit),
            'release ' + expanded.tag + ' has a page on GitHub and the panel offers no way to it');
  rig.check(expanded.collapsed, 'an opened release does not close again, so the list only ever grows');

  // ⚠ THE CARET IS A ::after ON THE ROW, so it has no box to read. Its lane is the row's right
  // padding, and the check is that the date ends before that lane starts.
  const lane = await dm.evaluate(`(() => {
    const row = document.querySelector('#cl-body .cl-entry');
    const rowBox = row.getBoundingClientRect();
    const dateBox = row.querySelector('.cl-date').getBoundingClientRect();
    return { gap: +(rowBox.right - dateBox.right).toFixed(2) };
  })()`);
  rig.check(lane.gap >= 8,
            'the date runs under the dropdown arrow: it ends ' + lane.gap + 'px from the row edge, ' +
            'and the arrow needs 8');

  // ⚠ DISPATCHED AT THE PANEL, never at the document. The guard is a CAPTURE listener on the
  // document, so an event whose target IS the document skips the capture phase entirely and the
  // check would report a guard that works as broken.
  const keys = await dm.evaluate(`(() => {
    setShape('select');
    document.getElementById('cl-modal').dispatchEvent(new KeyboardEvent('keydown',
      { key: 'e', bubbles: true, cancelable: true }));
    const whileOpen = shape;
    closeChangelog();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true, cancelable: true }));
    return { whileOpen: whileOpen, whenShut: shape };
  })()`);
  rig.check(keys.whileOpen === 'select',
            'a map shortcut fires through the open What\'s new panel, so Delete while the DM ' +
            'reads takes out the room they had selected: shape became ' + keys.whileOpen);
  rig.check(keys.whenShut === 'rect',
            'the key does nothing with the panel shut either, so the check above passes for the ' +
            'wrong reason: shape is ' + keys.whenShut);

  await dm.evaluate('document.getElementById("cl-close").click(); 0');
  rig.check(!(await dm.evaluate('__rigShown("#cl-modal")')),
            'the panel\'s close button does not shut it');

  await dm.evaluate('document.getElementById("about-whatsnew").click(); document.getElementById("cl-backdrop").click(); 0');
  rig.check(!(await dm.evaluate('__rigShown("#cl-modal")')),
            'a click beside the What\'s new panel does not shut it');

  // ⚠ ESCAPE IS DISPATCHED AT THE PANEL, not the document. Its handler stops the event so the
  // legend underneath stays open, which means a document-level keydown never reaches it.
  await dm.evaluate(`(() => {
    document.getElementById('about-whatsnew').click();
    document.getElementById('cl-modal').dispatchEvent(new KeyboardEvent('keydown',
      { key: 'Escape', bubbles: true, cancelable: true }));
    return 0;
  })()`);
  rig.check(!(await dm.evaluate('__rigShown("#cl-modal")')),
            'Escape does not shut the What\'s new panel');
  rig.check(await dm.evaluate('__rigShown("' + LEGEND + '")'),
            'Escape shut the help panel underneath as well, so one press closed two things');

  // ── F. The update toast ───────────────────────────────────────────────────
  // ⚠ DRIVEN THROUGH upToast AND announceInstalledVersion THEMSELVES. main only reaches the page
  // when a real newer release exists on GitHub, and `npm start` never even checks, so a scenario
  // that waited for a status would be waiting for something that cannot happen here.
  await dm.evaluate('hideUpdateToast(); 0');

  const ready = await dm.evaluate(`(() => {
    upToast('Version 9.9.9 is ready to install', 'Restart now', () => { globalThis.__rigRestart = 1; }, 0);
    const t = document.getElementById('up-toast');
    const b = t.getBoundingClientRect();
    const cta = t.querySelector('.up-cta').getBoundingClientRect();
    const hit = document.elementFromPoint(cta.left + cta.width / 2, cta.top + cta.height / 2);
    return {
      shown: b.width > 0 && b.height > 0,
      msg: t.querySelector('.up-msg').textContent,
      ctaHit: !!(hit && t.contains(hit)),
      // The map fills the window, so a toast over the middle of it would take clicks meant for fog.
      offMap: b.top < 120 && b.right > document.documentElement.clientWidth - 200,
    };
  })()`);
  rig.note('update toast: ' + JSON.stringify(ready));
  rig.check(ready.shown && ready.msg.indexOf('9.9.9') > 0,
            'a ready update puts nothing on screen, so the DM only finds it by opening the help panel');
  rig.check(ready.ctaHit, 'the toast is on screen and its button cannot be clicked');
  rig.check(ready.offMap, 'the toast sits over the map instead of the corner: ' + JSON.stringify(ready));

  await dm.evaluate('document.querySelector("#up-toast .up-x").click(); 0');
  rig.check(!(await dm.evaluate('__rigShown("#up-toast")')), 'the toast cannot be dismissed');

  // ⚠ A FIRST-EVER RUN MUST SAY NOTHING. The app cannot tell "freshly installed" from "just
  // updated" except by the version it stored last time, and announcing an update to someone who
  // has never run it before is a lie.
  const firstRun = await dm.evaluate(`(() => {
    localStorage.removeItem('evermistSeenVersion');
    announceInstalledVersion();
    return 0;
  })()`);
  await dm.waitFor('localStorage.getItem("evermistSeenVersion") !== null', 10000,
                   'the app to record the version it is running');
  rig.check(!(await dm.evaluate('__rigShown("#up-toast")')),
            'a first run announces an update that never happened');

  // Now the same call with an older version on record, which is what a real install leaves behind.
  await dm.evaluate(`(() => {
    localStorage.setItem('evermistSeenVersion', '0.0.1');
    announceInstalledVersion();
    return 0;
  })()`);
  await dm.waitFor('__rigShown("#up-toast")', 10000, 'the toast that follows an update');
  const installed = await dm.evaluate(`(() => {
    const t = document.getElementById('up-toast');
    return { msg: t.querySelector('.up-msg').textContent, cta: t.querySelector('.up-cta').textContent };
  })()`);
  rig.note('after update: ' + JSON.stringify(installed));
  rig.check(installed.msg === 'Updated to ' + pkgVersion,
            'the toast after an update says ' + JSON.stringify(installed.msg) + ' on a ' +
            pkgVersion + ' build');

  await dm.evaluate('document.querySelector("#up-toast .up-cta").click(); 0');
  try { await dm.waitFor('__rigShown("#cl-modal")', 10000, 'What\'s new to open from the toast'); } catch (_) {}
  rig.check(await dm.evaluate('__rigShown("#cl-modal")'),
            'the toast offers What\'s new and pressing it opens nothing, so the DM is told a ' +
            'version arrived and never what it changed');
  await dm.evaluate('closeChangelog(); hideUpdateToast(); 0');

  rig.check(await dm.evaluate('localStorage.getItem("evermistSeenVersion") === ' + JSON.stringify(pkgVersion)),
            'the app did not record the version it is running, so the same update is announced ' +
            'again on every start');

  // ── G. None of it reaches the Player ──────────────────────────────────────
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

  // ⚠ WHAT F DRIVES IS THE PAGE'S OWN upToast. The line under About renders inside a closure on
  // an IPC message from main, and `npm start` never checks for an update at all, so the handoff
  // from main is the half no scenario can reach.
  rig.byEye('a real download arriving from main: the line under About reading "Version X is ' +
            'ready" beside the toast, and macOS showing the manual line instead');
  rig.byEye('the Player window landing on a SECOND real display, which is what display.js reads ' +
            'and sizes the window from. The rig runs both windows on one screen and parks them ' +
            'off it, so there is no second display for it to find');
};
