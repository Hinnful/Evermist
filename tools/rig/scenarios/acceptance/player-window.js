'use strict';

// player-window.js — HOW THE PLAYER WINDOW ARRIVES ON THE TV.
//
// THE GOAL OF THIS FEATURE: pressing Open Player puts the window up at once, showing the app's own
// landing card while the map decodes, and swaps to the map when it is ready. What the players must
// never see is the app booting: a flat navy sheet with nothing on it. A window is pre-warmed at DM
// startup and kept hidden, so the button carries no page load and the card is on screen instantly.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks directly beneath it, in order.
//
//   A. A Player window is PRE-WARMED and waiting before the button is ever pressed, with the DM
//      not yet holding it — so no fog push and no map reaches a window nobody opened.
//   B. The card only outranks other panels while it is loading. The DM shows the same element
//      when no scene is open, and it must not paint over the scene library or a dialog.
//   C. While the map decodes the landing card is what is on screen, marked as loading, and it
//      sits ABOVE the cover so no bare sheet is ever visible.
//   D. Once the map is on screen the card is gone, and it does not come back on a later switch.
//   E. Closing the Player and pressing the button again works, leaves a fresh window warming for
//      the press after that, and never warms a second one over a Player that is already open.
//
// ⚠ C IS READ WHILE THE MAP IS STILL DECODING, which is only a window at all because the map is
// animated and takes seconds. rig.player() returns as soon as the window reports itself visible,
// which is now the moment of the press — so the read straight after it lands inside the decode.
// Do not add a wait before it or the map arrives first and C measures nothing.
//
// ⚠ THE MAP IS ANIMATED, AND EVERY ACCEPTANCE FILE'S IS. Animated is the only kind the DM
// ever uses, so a suite running on still PNGs proved the app worked in a case that never
// happens. `tableMap` (tools/rig/fixtures.js) records the clip once per run and caches it by
// size. Do not swap it back to `stillMap`; smoke.js is the one file that wants both.

const MAP_W = 1600, MAP_H = 1000;

module.exports = async function playerWindowFeature(rig) {
  const dm = rig.dm;

  const map = await rig.fixtures.tableMap(dm, rig.fixtureDir, { w: MAP_W, h: MAP_H });
  const expr = await rig.fixtures.asFileExpr(dm, map);

  // ── A. A window is pre-warmed, and the DM is not holding it ────────────────
  // The pre-warm is deliberately off the boot path, so poll for it rather than assuming it is up.
  await dm.waitFor('!!_playerPrewarm', 30000, 'a Player window to be pre-warmed');
  rig.check(await dm.evaluate('!playerWindow'),
    'the DM adopted the pre-warmed window without the button being pressed, so every fog push and ' +
    'every map now goes to a window nobody opened');

  // ── B. The idle card on the DM stays under the panels ───────────────────────
  // Read here because no scene is open yet, which is the one state the DM shows the card in.
  const idle = await dm.evaluate(`(() => {
    const l = getComputedStyle(document.getElementById('landing'));
    const m = getComputedStyle(document.getElementById('sm-modal'));
    return { z: l.zIndex, modalZ: parseInt(m.zIndex, 10), shown: l.display };
  })()`);
  rig.check(idle.shown !== 'none',
    'the DM is not showing the landing card with no scene open, so B measured nothing');
  rig.check(idle.z === 'auto' || parseInt(idle.z, 10) < idle.modalZ,
    'the DM landing card outranks the scene library (' + idle.z + ' against ' + idle.modalZ +
    '), so with no scene open its wordmark paints over the library, the About box and dialogs');

  await dm.evaluate('createNewScene(' + expr + ')', 120000);
  await dm.waitFor('!!mapOffscreen', 120000, 'the DM to finish importing the map');

  // ── C. The card is the loading state while the map decodes ─────────────────
  const pressedAt = Date.now();
  const player = await rig.player();
  const waitMs = Date.now() - pressedAt;

  const whileLoading = await player.evaluate(`(() => {
    const el = document.getElementById('landing');
    const cs = getComputedStyle(el);
    const fade = getComputedStyle(document.getElementById('scene-fade'));
    return {
      hidden:   document.hidden,
      hasMap:   !!mapOffscreen,
      display:  cs.display,
      zIndex:   parseInt(cs.zIndex, 10),
      loading:  el.classList.contains('loading'),
      fadeZ:    parseInt(fade.zIndex, 10),
    };
  })()`);

  rig.check(whileLoading.hidden === false,
    'the Player window did not report itself visible after the button was pressed');

  rig.check(whileLoading.hasMap === false,
    'the map was already decoded when the window came up, so nothing here measured the wait — ' +
    'the fixture is probably no longer animated');

  rig.check(whileLoading.display !== 'none' && whileLoading.loading === true,
    'the landing card was not up and marked loading while the map decoded, so the players are ' +
    'looking at a bare cover with nothing on it');

  rig.check(whileLoading.zIndex > whileLoading.fadeZ,
    'the landing card sits under the scene cover (' + whileLoading.zIndex + ' vs ' +
    whileLoading.fadeZ + '), so the cover hides it and the TV shows a flat sheet');

  // The one thing nobody can assert: whether it looks like fog or like a blue screen.
  const shot = require('path').join(rig.outDir, 'player-loading.png');
  await player.screenshot(shot);
  rig.note('Player while the map decodes: ' + shot);
  rig.byEye('whether ' + shot + ' reads as the app’s own drifting fog behind the wordmark, ' +
            'rather than a flat sheet with text on it');

  // ── D. The card goes when the map arrives ─────────────────────────────
  await player.waitFor('!!mapOffscreen', 60000, 'the map to reach the Player');
  await player.waitFor("getComputedStyle(document.getElementById('landing')).display === 'none'",
                       30000, 'the landing card to come down once the map was on screen');

  // Printed rather than asserted — a threshold here would measure this machine.
  rig.note('button to window on screen: ' + waitMs + ' ms; the card then holds until the map lands');

  // ── E. Close, warm again, re-open ───────────────────────────────────────
  // ⚠ window.open() REUSES A NAMED WINDOW, so warming a replacement straight after a close can
  // land on the one still dying and leave the button dead on the next press.
  player.close();
  await dm.evaluate('document.getElementById("btn-player").click(); 0');
  await dm.waitFor('!playerWindow', 10000, 'the DM to drop the closed Player');

  await dm.waitFor('!!(_playerPrewarm && !_playerPrewarm.closed)', 30000,
                   'a replacement Player window to warm up after the close');

  await dm.evaluate('document.getElementById("btn-player").click(); 0');
  rig.check(await dm.evaluate('!!(playerWindow && !playerWindow.closed)'),
    'pressing the button after a close left the DM holding no Player window, so the second open ' +
    'of a session does nothing');

  // ⚠ THE WARMING MUST REFUSE WHILE A PLAYER IS OPEN. window.open reuses the name, so warming
  // over a live one re-navigates it and the TV reloads mid-session. The startup timer can land
  // here for real, when the DM presses the button inside its first two seconds.
  await dm.evaluate('prewarmPlayer(); 0');
  rig.check(await dm.evaluate('!_playerPrewarm'),
    'prewarmPlayer() opened a window with the Player already open, which re-navigates the live ' +
    'Player window and reloads the TV in the middle of a session');
};
