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
//   C. The players never look at a bare sheet before the first map, in ANY of three orders. When
//      the decode outlasts the cover, the card is on screen, marked as loading, and above the
//      cover. When the cover lifts first, the card holds as the empty state. When the decode beats
//      the first sample, the map is already there and the card is on its way out. Either way it is
//      gone once the map is on screen - which machine takes which order is not this file’s to decide.
//   D. Once the map is on screen the card is gone, and it does not come back on a later switch.
//   E. Closing the Player and pressing the button again works, leaves a fresh window warming for
//      the press after that, and never warms a second one over a Player that is already open.
//   F. The DM's fullscreen button puts the Player window on the whole TV, and the button then
//      shows it is on.
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

  // ⚠ POLLED, NEVER READ ONCE. The card goes up and gets its `loading` class a beat after the
  // window reports itself visible, so a single read lands in that gap on a slow machine - it
  // passes here every time and took a release gate down on a runner. The loop is BOUNDED and its
  // exit conditions are the checks' own: the card being up, or the map decoding first. A card that
  // never comes up runs the clock out and lands on the same check with the same message.
  const readLanding = () => player.evaluate(`(() => {
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
      covered:  ['dark', 'blind'].some(c =>
                  document.getElementById('scene-fade').classList.contains(c)),
    };
  })()`);

  // ⚠ THE COVER BEING DOWN IS WHAT MAKES WAITING VALID. revealPlayer() strips the loading line
  // once, and never puts it back, so polling past the reveal only burns the decode window and
  // turns a measurable run into "the map was already decoded". Stop the moment any of the three
  // settles it: the card is up, the map landed, or the cover lifted.
  let whileLoading = await readLanding();
  const landingBy = Date.now() + 8000;
  while (Date.now() < landingBy && !whileLoading.hasMap && whileLoading.covered &&
         !(whileLoading.display !== 'none' && whileLoading.loading === true)) {
    await rig.sleep(50);
    whileLoading = await readLanding();
  }
  rig.note('sampled the Player after ' + (8000 - (landingBy - Date.now())) + 'ms: ' +
           JSON.stringify(whileLoading));

  rig.check(whileLoading.hidden === false,
    'the Player window did not report itself visible after the button was pressed');

  // ⚠ THREE ORDERS, AND ALL THREE ARE REAL. revealPlayer() lifts the cover on a SCENE_FADE_MIN_MS
  // timer, not on the map arriving, so a slow machine strips the loading line while there is still
  // no map - the comment on onPlayerMapShown says the error paths reveal too. A slow machine can
  // also finish the decode before this file gets its first sample. Which order a machine takes is
  // NOT the scenario's to choose, and demanding one took a release gate down four times.
  // ⚠ THE LOADING LINE GOING AND THE MAP LANDING ARE TWO EVENTS, so a sample holding both is the
  // app mid-swap, not a lie on the TV. The end state below is what proves the card came down.
  // NO BRANCH IS A FREE PASS: each one says the players never look at a bare sheet.
  const coverUp = whileLoading.zIndex > whileLoading.fadeZ;
  if (whileLoading.hasMap === true) {
    rig.note('the decode beat the first sample, so the loading window was over before it was read');
    rig.check(whileLoading.display !== 'none' || whileLoading.covered === false,
      'the map had decoded, the card was already off screen and the cover was still down, so the ' +
      'TV is a flat sheet with nothing on it: ' + JSON.stringify(whileLoading));
    rig.check(whileLoading.loading === false || coverUp,
      'the card still claims to be loading but sits under the scene cover (' + whileLoading.zIndex +
      ' vs ' + whileLoading.fadeZ + '), so the cover hides it and the TV shows a flat sheet');
  } else if (whileLoading.loading === true) {
    rig.note('the decode outlasted the cover, so the loading state was measured directly');
    rig.check(whileLoading.display !== 'none',
      'the landing card was marked loading and not on screen, so the players are looking at a ' +
      'bare cover with nothing on it');
    rig.check(coverUp,
      'the landing card sits under the scene cover (' + whileLoading.zIndex + ' vs ' +
      whileLoading.fadeZ + '), so the cover hides it and the TV shows a flat sheet');
  } else {
    rig.note('the cover lifted first, so the card is checked as the empty state and on the way out');
    rig.check(whileLoading.display !== 'none' || whileLoading.hasMap === true,
      'the cover lifted before the map arrived and the landing card went with it, so the TV is ' +
      'showing nothing at all rather than the empty state the app draws for it');
    rig.check(whileLoading.zIndex === null || !coverUp,
      'the loading line was gone but the card still outranks the scene cover, so the cover can ' +
      'never paint over it: ' + whileLoading.zIndex + ' against ' + whileLoading.fadeZ);
  }

  // ⚠ THE END STATE IS THE CHECK THAT HOLDS IN EITHER ORDER, and it is the one the players feel:
  // a card left over a decoded map is the app's own wordmark sitting on the dungeon. Polled
  // because the map arriving and the card going are two frames, not one.
  let settled = await readLanding();
  const settledBy = Date.now() + 30000;
  while (Date.now() < settledBy && !(settled.hasMap && settled.display === 'none')) {
    await rig.sleep(100);
    settled = await readLanding();
  }
  rig.note('once the map was on the Player: ' + JSON.stringify(settled));
  rig.check(settled.hasMap === true,
    'the map never reached the Player at all, so nothing here measured the wait');
  rig.check(settled.display === 'none',
    'the landing card is still on screen with a decoded map under it, so the TV is showing the ' +
    'wordmark over the dungeon: ' + JSON.stringify(settled));

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

  // ── F. Fullscreen, and why it stays by eye ─────────────────────────────
  rig.byEye('whether the DM fullscreen button puts the Player window on the whole TV, and the ' +
            'button then shows it is on. Driving it is not automated: setFullScreen moves the ' +
            'window onto the nearest real display, and the rig may not put a window on the DM’s ' +
            'screen');
};
