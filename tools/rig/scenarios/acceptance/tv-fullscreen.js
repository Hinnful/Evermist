'use strict';

// tv-fullscreen.js — A WINDOW THE DM WANTED FULLSCREEN GOES FULLSCREEN ONCE THE PLAYER HAS LOADED.
//
// tvControl.js asks for fullscreen when the Player window reports loaded (PLAYER_READY), not after a
// fixed delay, which fired before a slow Player had loaded and left the window windowed.
//
//   A. With Fullscreen picked and the window route, Show on TV opens the Player and asks for
//      fullscreen exactly once.
//   B. That ask comes the moment the Player reports loaded: never before the report, and with no
//      fixed wait after it.
//
// ⚠ The rig never fullscreens a window (it would leave its off-screen park), so the Fullscreen
// button's handler is replaced by a recorder. What is checked is the ask, not the fullscreen itself.

const lib = require('../../lib');

const q = sel => 'document.querySelector(' + JSON.stringify(sel) + ')';

module.exports = async function tvFullscreen(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: 900, h: 600 });
  await lib.settle(dm, '!minimapDirty', 10000);
  if (await dm.evaluate('_tvLive()')) {
    await dm.evaluate(q('#tv-ui .tv-grp .lv') + '.click(); 0');
    await lib.settle(dm, '!_tvLive()', 8000);
  }
  await lib.settle(dm, '!playerWindow || playerWindow.closed', 8000);
  await dm.evaluate(`(() => {
    window.__fsAsks = []; window.__readyAt = 0; window.__readyRan = 0;
    document.getElementById('btn-fullscreen-player').onclick = () => window.__fsAsks.push(performance.now());
    // ⚠ The app's listener, added first, has already asked by the time this one runs, so an ask between the
    // event's own timestamp and this listener's clock was made inside the report's dispatch. A slow runner queues
    // the message for a while before either listener runs, so no fixed gap from the timestamp can hold.
    window.addEventListener('message', e => {
      if (!playerWindow || e.source !== playerWindow || !e.data || window.__readyAt) return;
      if (e.data.type === 'PLAYER_READY' || e.data.type === 'need-map') { window.__readyAt = e.timeStamp; window.__readyRan = performance.now(); }
    });
    _tvSetupSeen = true; _tvScreenPick = 'window'; _tvWantFull = true; _tvKey = ''; tvRefresh(); return 0;
  })()`);

  // ── A ──
  // RED ON: `_tvFullAsk = true` removed from _tvGoLive (tvControl.js) - 2026-10-23
  await dm.evaluate(q('#tv-ui .tv-go') + '.click(); 0');
  await lib.settle(dm, '_tvLive()', 15000);
  await lib.settle(dm, 'window.__fsAsks.length > 0', 15000);
  await dm.evaluate('new Promise(r => setTimeout(r, 2000))');
  const r = await dm.evaluate('({ live: _tvLive(), route: _tvRoute, asks: window.__fsAsks, readyAt: window.__readyAt, readyRan: window.__readyRan })');
  rig.check(r.live && r.route === 'window' && r.asks.length === 1,
            'A: Show on TV with Fullscreen picked did not ask for fullscreen exactly once: ' + JSON.stringify(r));

  // ── B ──
  // RED ON: tvControl.js, stageWindow.js and toolbar.js put back to the 700 ms timer in _tvTick - 2026-10-23
  // RED ON: the ask in tvPlayerLoaded deferred by setTimeout 0 (tvControl.js) - 2026-10-24
  rig.check(r.readyAt > 0 && r.asks.length > 0 && r.asks[0] >= r.readyAt && r.asks[0] <= r.readyRan,
            'B: fullscreen was not asked the moment the Player reported loaded: ' + JSON.stringify(r));
};
