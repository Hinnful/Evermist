'use strict';

// tv-wayland.js — Show on TV where Wayland lets no app place its own window. Linux desktop only, run with
// --screens=2 so the hidden KWin has two monitors.
//
//   1. The main process says it cannot place windows here.
//   2. Show on TV, pressed as the DM does, offers no monitor: TV setup lists none, and no screen
//      question or help box opens.
//   3. The Player opens as a plain window, and it is not fullscreen.

const lib = require('../lib');

module.exports = async function probeTvScreen(rig) {
  const dm = rig.dm;

  // ── 1 ──
  const list = await dm.evaluate('electronAPI.listDisplays()', 10000);
  rig.note('displays: ' + JSON.stringify({ canPlace: list.canPlace, dm: list.dmDisplayId,
    displays: list.displays.map(d => ({ id: d.id, b: d.bounds })) }));
  rig.check(list.displays.length === 2, '1: the run did not have two screens, it had ' + list.displays.length);
  rig.check(list.canPlace === false, '1: listDisplays answered canPlace ' + JSON.stringify(list.canPlace) + ' on Wayland');

  // ── 2 ──
  await dm.evaluate('document.getElementById("tv-go").click(); 0');
  await lib.settle(dm, '!!document.getElementById("tv-setup") || _tvLive() || !!_tvMenu', 10000);
  const setup = await dm.evaluate('!!document.getElementById("tv-setup")');
  rig.note('TV setup opened: ' + setup);
  if (setup) {
    const hasScreen = await dm.evaluate('!!document.querySelector("#tv-setup [data-tv-screen]")');
    if (hasScreen) {
      await dm.evaluate('document.querySelector("#tv-setup [data-tv-screen]").click(); 0');
      await lib.settle(dm, '!!document.getElementById("tb-dd")', 5000);
    }
    const items = await dm.evaluate('[...document.querySelectorAll("#tb-dd .dd-it")].map(b => b.textContent)');
    rig.note('TV setup screen list: ' + JSON.stringify(items));
    const monitors = items.filter(s => !/A window/.test(s));
    rig.check(monitors.length === 0, '2: TV setup offered a monitor: ' + JSON.stringify(monitors));
    const label = await dm.evaluate('(() => { const b = document.querySelector("#tv-setup [data-tv-screen]"); return b ? b.textContent : null; })()');
    rig.check(label === null || /A window/.test(label), '2: TV setup picked the screen ' + JSON.stringify(label));
    await dm.evaluate('document.querySelector("#tv-setup .sm-wfoot .primary").click(); 0');
  }
  const live = await lib.settle(dm, '_tvLive()', 15000);
  rig.check(live, '2: Show on TV never opened the Player');
  const menu = await dm.evaluate('_tvMenu');
  rig.check(!menu, '2: Show on TV opened the ' + menu + ' box');

  // ── 3 ──
  const route = await dm.evaluate('_tvRoute');
  rig.check(route === 'window', '3: the Player went by the ' + route + ' route, not as a window');
  const player = await rig.player();
  await lib.hold(3000, 'long enough for a fullscreen to have reached the Player');
  const fs = { player: await player.evaluate('playerIsFullscreen'), dm: await dm.evaluate('paneScope().playerIsFullscreen') };
  rig.note('fullscreen: ' + JSON.stringify(fs));
  rig.check(!fs.player && !fs.dm, '3: the Player went fullscreen on its own: ' + JSON.stringify(fs));
  await lib.hold(2000, 'long enough for a wait-for-the-TV tick to have opened a box');
  const later = await dm.evaluate('({ menu: _tvMenu, wait: _tvWaitSince })');
  rig.check(!later.menu && !later.wait, '2: a box or a wait came up after Show on TV: ' + JSON.stringify(later));
};
