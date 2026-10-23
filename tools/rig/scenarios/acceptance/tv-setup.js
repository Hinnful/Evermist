'use strict';

// tv-setup.js — TV SETUP: ONE WINDOW FOR EVERYTHING ABOUT THE TV, OPENED ONCE PER LAUNCH.
//
// THE GOAL OF THIS FEATURE: the first Show on TV of a launch explains the TV in one centred window
// (screen, updates, turn) and then gets out of the way; the settings stay a click away on the
// minimap's ··· button. Under --offscreen no window is placed, so the map takes the window route.
//
//   A. The first Show on TV of a launch opens TV setup instead of going live. It holds the screen
//      (name and resolution), Updates, and three Turn pictures; no Fullscreen row while the screen is
//      a TV, and Cancel with Show on TV in its footer.
//   B. Picking a turn there turns the open scene at once; picking A window adds the Fullscreen row.
//   C. Show on TV in the window goes live and closes it; the ··· button glows afterwards.
//   D. The second Show on TV of the same launch goes straight to the TV, with no window.
//   E. ··· opens it again, live or not, and the screen name under Show on TV opens it too. Live, its
//      footer holds Done. Esc closes it.
//   F. Changing Updates there reaches the app's Auto / Manual.
//
// Unchecked here: the flight into ··· (by eye), and a window that opens fullscreen.

const lib = require('../../lib');

const q = sel => 'document.querySelector(' + JSON.stringify(sel) + ')';

module.exports = async function tvSetup(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: 900, h: 600 });
  await lib.settle(dm, '!minimapDirty', 10000);
  // The machine's own screens never decide a check: the list is the laptop and one TV.
  await dm.evaluate(`(() => {
    _tvLoadDisplays = async () => {};
    _tvDmId = 1;
    _tvDisplays = [
      { id: 1, label: 'Laptop', internal: true, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, size: { width: 1920, height: 1080 } },
      { id: 2, label: 'LG TV', internal: false, bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, size: { width: 1920, height: 1080 } },
    ];
    localStorage.removeItem(TV_SCREEN_KEY);
    _tvSetupSeen = false; _tvScreenPick = null; _tvKey = ''; tvRefresh(); return 0;
  })()`);
  const open = () => dm.evaluate('!!document.getElementById("tv-setup")');
  const closed = () => lib.settle(dm, '!document.getElementById("tv-setup")', 4000);
  const subs = () => dm.evaluate('[...document.querySelectorAll("#tv-setup .sm-sub")].map(e => e.textContent)');

  // ── A ──
  // RED BY DESIGN: written against item 217, never re-proved
  await dm.evaluate(q('#tv-ui .tv-go') + '.click(); 0');
  await lib.settle(dm, '!!document.getElementById("tv-setup")', 6000);
  rig.check(await open() && !(await dm.evaluate('_tvLive()')), 'A: the first Show on TV of a launch did not open TV setup instead of going live');
  const a = await dm.evaluate(`(() => ({
    title: ${q('#tv-setup .sm-wtitle')}.textContent,
    screen: ${q('#tv-setup [data-tv-screen]')}.textContent,
    tiles: document.querySelectorAll('#tv-setup [data-tv-turn]').length,
    foot: [...document.querySelectorAll('#tv-setup .sm-wfoot button')].map(b => b.textContent),
    segs: [...document.querySelectorAll('#tv-setup .cp-segtab')].map(b => b.textContent) }))()`);
  rig.check(a.title === 'TV setup' && /LG TV/.test(a.screen) && /1920×1080/.test(a.screen),
            'A: TV setup has the wrong title, or the screen row lacks the name and resolution: ' + JSON.stringify(a));
  rig.check(a.tiles === 3 && a.foot.join() === 'Cancel,Show on TV' && a.segs.join() === 'Auto,Manual',
            'A: TV setup lacks three Turn pictures, its footer, or Updates alone (no Fullscreen for a TV): ' + JSON.stringify(a));
  const subA = await subs();
  rig.check(subA.join() === 'Screen,Updates,Turn', 'A: TV setup has the wrong sections for a TV: ' + JSON.stringify(subA));

  // ── B ──
  // RED BY DESIGN: written against item 217, never re-proved
  await dm.evaluate(q('#tv-setup [data-tv-turn="1"]') + '.click(); 0');
  rig.check(await dm.evaluate('tvFit.step === 1 && tvFit.turn === 270'), 'B: the first turned picture did not turn the open scene');
  await dm.evaluate(q('#tv-setup [data-tv-turn="0"]') + '.click(); 0');
  rig.check(await dm.evaluate('tvFit.step === 0'), 'B: the upright picture did not put the scene back');
  await dm.evaluate(q('#tv-setup [data-tv-screen]') + '.click(); 0');
  const list = await dm.evaluate('[...document.querySelectorAll("#tb-dd .dd-it .nm")].map(e => e.textContent)');
  rig.check(list.join() === 'LG TV,A window', 'B: the screen list is not every candidate screen, then "A window": ' + JSON.stringify(list));
  await dm.evaluate('document.querySelectorAll("#tb-dd .dd-it")[1].click(); 0');
  rig.check(await dm.evaluate('!_tvLive()') && (await subs()).join() === 'Screen,Fullscreen,Updates,Turn',
            'B: picking A window went live, or did not add the Fullscreen row');

  // ── C ──
  // RED BY DESIGN: written against item 217, never re-proved
  await dm.evaluate(q('#tv-setup .sm-wfoot .primary') + '.click(); 0');
  await lib.settle(dm, '_tvLive()', 15000);
  await closed();
  rig.check(await dm.evaluate('_tvLive() && _tvRoute === "window"') && !(await open()), 'C: Show on TV in TV setup did not go live in a window and close it');
  const hot = await lib.settle(dm, '!!document.querySelector("#tv-ui [data-tv-more].hot")', 3000);
  rig.check(hot, 'C: the ··· button did not glow after the window closed');
  rig.byEye('the window shrinking into the ··· button');

  // ── D ──
  // RED BY DESIGN: written against item 217, never re-proved
  await dm.evaluate(q('#tv-ui .tv-grp .lv') + '.click(); 0');
  await lib.settle(dm, '!_tvLive()', 8000);
  await dm.evaluate('_tvKey = ""; tvRefresh(); 0');
  await dm.evaluate(q('#tv-ui .tv-go') + '.click(); 0');
  await lib.settle(dm, '_tvLive()', 15000);
  rig.check(await dm.evaluate('_tvLive()') && !(await open()), 'D: the second Show on TV of the launch opened TV setup again');

  // ── E ──
  // RED BY DESIGN: written against item 217, never re-proved
  await dm.evaluate(q('#tv-ui [data-tv-more]') + '.click(); 0');
  await lib.settle(dm, '!!document.getElementById("tv-setup")', 6000);
  const live = await dm.evaluate('[...document.querySelectorAll("#tv-setup .sm-wfoot button")].map(b => b.textContent)');
  rig.check(await open() && live.join() === 'Done', 'E: ··· while live did not open TV setup with Done alone: ' + JSON.stringify(live));
  await dm.evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", key: "Escape", bubbles: true })); 0');
  await closed();
  rig.check(!(await open()), 'E: Esc did not close TV setup');
  await dm.evaluate(q('#tv-ui .tv-grp .lv') + '.click(); 0');
  await lib.settle(dm, '!_tvLive()', 8000);
  await dm.evaluate('_tvKey = ""; tvRefresh(); 0');
  await dm.evaluate(q('#tv-ui .tv-sub') + '.click(); 0');
  await lib.settle(dm, '!!document.getElementById("tv-setup")', 6000);
  rig.check(await open(), 'E: a click on the screen name under Show on TV did not open TV setup');

  // ── F ──
  // RED BY DESIGN: written against item 217, never re-proved
  await dm.evaluate('[...document.querySelectorAll("#tv-setup .cp-segtab")].find(b => b.textContent === "Manual").click(); 0');
  rig.check(await dm.evaluate('autoSync === false'), 'F: Manual in TV setup did not switch the app to Manual');
  await dm.evaluate('[...document.querySelectorAll("#tv-setup .cp-segtab")].find(b => b.textContent === "Auto").click(); 0');
  rig.check(await dm.evaluate('autoSync === true'), 'F: Auto in TV setup did not switch the app back');
  await dm.evaluate(q('#tv-setup .sm-wfoot button') + '.click(); 0');
  await closed();
};
