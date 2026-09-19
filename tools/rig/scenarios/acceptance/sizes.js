'use strict';

// sizes.js — THE WINDOW AT MORE THAN ONE SIZE. Everything here runs three times.
//
// THE GOAL OF THIS FEATURE: the DM's laptop, the DM's desk monitor and the TV at the table are
// three different shapes, and the app has to be right on all of them. Every check below serves
// that sentence.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks under a marker carrying its
// letter, wherever in the file that state is cheapest to reach - which is not letter order.
//
//   A. A map is fitted to the window and centred in it, at every window size.
//   B. Sync View sends the REGION the DM can read, and the Player refits it to its own canvas -
//      at every pairing of the two window sizes, not just the one this machine happens to have.
//   C. The Player's fog covers the map to its edge at every Player size. The fog there is a
//      Canvas-2D layer composited over the PixiJS map, so a clear band at the edge is a seam and
//      the players see through the map's border.
//   D. The room card stays wholly on screen at every DM size, including one too short to hold it
//      at its natural place.
//   E. The region sent to the Player does not change when the control panel opens, at any DM
//      width. The reverted panel-width trim was a fraction of a wide window and most of a narrow
//      one, so a narrow DM is where it shows.
//
// ⚠ THIS FILE IS WHY EVERY OTHER RUN IS PINNED TO ONE SIZE. The rig used to come up at whatever
// the machine gave, on the theory that scenarios would hold at any size. They did not, and three
// geometry checks passed here and took a release gate down on a 1008x681 runner. Pinning makes a
// size-dependent check invisible instead of noisy, so this file varies the size ON PURPOSE and
// nothing else does.
//
// ⚠ EVERY SIZE IS APPLIED THROUGH rig.resizeDm / rig.resizePlayer AND NOWHERE ELSE. A scenario
// that sets its own metrics leaves the next one running at a size run.js did not choose.
//
// ⚠ AN ASSERTION HERE IS AGAINST THE WINDOW, NEVER A FIXED NUMBER. That is the whole point: a
// check that names 1008 is the class of check this file exists to catch.

const lib = require('../../lib');

const MAP_W = 1600;
const MAP_H = 1000;

// The runner's layout, a laptop, and a wide desk monitor. The first is the pinned default, so a
// failure at that size reproduces every other scenario's conditions exactly.
const DM_SIZES = [
  { w: 1008, h: 681, what: 'the runner layout' },
  { w: 1280, h: 800, what: 'a laptop' },
  { w: 1760, h: 990, what: 'a desk monitor' },
];

// A 4:3 projector, a 16:9 TV, and a tall screen. The last one is deliberately a shape no map is.
const TV_SIZES = [
  { w: 1024, h: 768, what: 'a 4:3 projector' },
  { w: 1920, h: 1080, what: 'a 16:9 TV' },
  { w: 900, h: 1200, what: 'a portrait screen' },
];

module.exports = async function sizes(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: MAP_W, h: MAP_H });

  // ── A. Fitted and centred at every DM size ───────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  // ⚠ REFITTED BY THE APP'S OWN fitToScreen, not by the resize alone. A resize on its own is not
  // required to move the camera, and asserting that it does would test a behaviour nobody
  // promised. What must hold is that a FIT, at any size, lands on that window's own numbers.
  for (const s of DM_SIZES) {
    await rig.resizeDm(s.w, s.h);
    await dm.evaluate('fitToScreen(); 0');
    await lib.settle(dm, 'container.clientWidth === ' + s.w, 8000);
    const fit = await dm.evaluate(`(() => {
      const cw = container.clientWidth, ch = container.clientHeight;
      return { cw, ch, zoom: +zoom.toFixed(5),
               want: +(Math.min(cw / mapWidth, ch / mapHeight) * 0.95).toFixed(5),
               panX: +panX.toFixed(1), wantPanX: +((cw - mapWidth * zoom) / 2).toFixed(1),
               panY: +panY.toFixed(1), wantPanY: +((ch - mapHeight * zoom) / 2).toFixed(1) };
    })()`);
    rig.note('fit at ' + s.w + 'x' + s.h + ' (' + s.what + '): ' + JSON.stringify(fit));
    rig.check(fit.cw === s.w,
              'the DM did not take the ' + s.w + 'x' + s.h + ' size at all, so this pass checked ' +
              'nothing: the container is ' + fit.cw + ' wide');
    rig.check(Math.abs(fit.zoom - fit.want) < 0.0005,
              'a fit at ' + s.w + 'x' + s.h + ' (' + s.what + ') landed on zoom ' + fit.zoom +
              ' against that window\'s own fit of ' + fit.want);
    rig.check(Math.abs(fit.panX - fit.wantPanX) < 1 && Math.abs(fit.panY - fit.wantPanY) < 1,
              'a fit at ' + s.w + 'x' + s.h + ' (' + s.what + ') did not centre the map: ' +
              JSON.stringify(fit));
  }

  // ── D. The room card stays on screen at every DM size ────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  // ⚠ DONE BEFORE THE PLAYER IS OPENED, so nothing below has to put the card away again.
  await dm.evaluate('__rigDrawShroud(300, 300, 700, 700); 0');
  await dm.evaluate('setShape("select"); __rigClick(500, 500); 0');
  await lib.settle(dm, 'selectedPolygonId !== null', 8000);

  const dragCard = (dx, dy) => dm.evaluate(`(() => {
    const head = document.getElementById('rp-head');
    const b = head.getBoundingClientRect();
    const x0 = b.left + b.width / 2, y0 = b.top + b.height / 2;
    const ev = (type, x, y, target) => target.dispatchEvent(new MouseEvent(type, {
      clientX: x, clientY: y, button: 0, buttons: 1, bubbles: true, cancelable: true }));
    ev('mousedown', x0, y0, head);
    ev('mousemove', x0 + ${dx} / 2, y0 + ${dy} / 2, window);
    ev('mousemove', x0 + ${dx}, y0 + ${dy}, window);
    ev('mouseup', x0 + ${dx}, y0 + ${dy}, window);
    return 0;
  })()`);

  // A short window as well as three normal ones: the card is taller than some screens, and the
  // clamp is what keeps its Delete button reachable.
  for (const s of DM_SIZES.concat([{ w: 1100, h: 560, what: 'a window shorter than the card' }])) {
    await rig.resizeDm(s.w, s.h);
    await lib.settle(dm, 'container.clientWidth === ' + s.w, 8000);
    // Dragged hard at every corner of the screen in turn, because a clamp that holds on one
    // edge and not the opposite one reads as working.
    for (const push of [[-4000, -4000], [4000, -4000], [-4000, 4000], [4000, 4000]]) {
      await dragCard(push[0], push[1]);
    }
    const box = await dm.evaluate(`(() => {
      const r = document.getElementById('panel-room').getBoundingClientRect();
      return { l: Math.round(r.left), t: Math.round(r.top),
               rt: Math.round(r.right), b: Math.round(r.bottom),
               w: Math.round(r.width), h: Math.round(r.height),
               winW: innerWidth, winH: innerHeight };
    })()`);
    rig.note('the room card after four hard drags at ' + s.w + 'x' + s.h + ': ' +
             JSON.stringify(box));
    rig.check(box.w > 0 && box.h > 0,
              'the room card has no size at ' + s.w + 'x' + s.h + ', so the clamp below is ' +
              'measuring a hidden element: ' + JSON.stringify(box));
    rig.check(box.l >= 0 && box.t >= 0,
              'the room card was dragged off the top or left at ' + s.w + 'x' + s.h + ' (' +
              s.what + '), so its drag bar is unreachable: ' + JSON.stringify(box));
    rig.check(box.rt <= box.winW && box.b <= box.winH,
              'the room card was dragged past the bottom or right at ' + s.w + 'x' + s.h + ' (' +
              s.what + "), so its Delete button is off screen: " + JSON.stringify(box));
  }

  // ── E. The panel does not change the region, at any DM width ─────────────
  // RED BY DESIGN: written against the fix, never re-proved
  // ⚠ _cpSelectTab, NOT A CLICK. The tab toggles, so clicking an open one shuts the panel and
  // the next read is of a closed panel rather than an open one.
  const openPane = tab => dm.evaluate('_cpSelectTab(' + JSON.stringify(tab) + '); 0');
  const shutPane = () => dm.evaluate('_cpSelectTab(null); 0');
  for (const s of DM_SIZES) {
    await rig.resizeDm(s.w, s.h);
    await lib.settle(dm, 'container.clientWidth === ' + s.w, 8000);
    // Shut, then open, then read both. The tab toggles, so picking the lit one closes it.
    await shutPane();
    await lib.settle(dm, 'document.getElementById("sidebar-right").hidden === true', 8000);
    const shutFirst = await dm.evaluate('JSON.stringify(dmVisibleRegion())');
    await openPane('fog');
    await lib.settle(dm, 'document.getElementById("sidebar-right").hidden === false', 8000);
    const open = await dm.evaluate('JSON.stringify(dmVisibleRegion())');
    await shutPane();
    const shutAgain = await dm.evaluate('JSON.stringify(dmVisibleRegion())');
    rig.note('region at ' + s.w + 'x' + s.h + ' — shut ' + shutFirst + ' open ' + open);
    rig.check(shutFirst === open && open === shutAgain,
              'the region sent to the Player changes with the control panel at ' + s.w + 'x' +
              s.h + ' (' + s.what + '), so the players lose a strip of map whenever the DM ' +
              'opens a tab: shut ' + shutFirst + ' against open ' + open);
  }

  // ── B and C. The Player at every TV size ─────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  await rig.resizeDm(DM_SIZES[0].w, DM_SIZES[0].h);
  await dm.evaluate('fitToScreen(); 0');
  const player = await rig.player();
  await player.waitFor('!!mapOffscreen && !!fogDataCanvas', 60000, 'the map to reach the Player');
  await player.waitFor('fogCoverT === 0', 45000, 'the scene cover to lift on the Player');

  // The DM looks somewhere that is neither the map's centre nor the whole map, so a Player that
  // ignored the region and kept its own fit would sit somewhere else and be caught.
  await dm.evaluate('zoom = 0.8; panX = -180; panY = -140; viewportDirty = true;' +
                    ' scheduleRender(); 0');
  await lib.settle(dm, 'zoom === 0.8', 5000);

  for (const s of TV_SIZES) {
    await rig.resizePlayer(s.w, s.h);
    await lib.settle(player, 'getViewportSize().w === ' + s.w, 10000);

    // ── B ──
    await dm.evaluate('document.getElementById("btn-sync-view").click(); 0');
    // ⚠ A REGION IS A CENTRE PLUS viewW/viewH IN MAP UNITS, never an x/y/w/h box. That is
    // the whole shape of the promise: the DM sends what it can READ, and the Player fits
    // that to its own canvas.
    const dmRegion = await dm.evaluate('(() => { const r = dmVisibleRegion();' +
      ' return { cx: +r.mapCX.toFixed(2), cy: +r.mapCY.toFixed(2),' +
      ' w: +r.viewW.toFixed(2), h: +r.viewH.toFixed(2) }; })()');
    const wantZoom = Math.min(s.w / dmRegion.w, s.h / dmRegion.h);
    const got = await lib.poll(async () => {
      const v = await player.evaluate('({ zoom, vw: getViewportSize().w, vh: getViewportSize().h })');
      return Math.abs(v.zoom - wantZoom) < wantZoom * 0.02 ? v : null;
    }, 15000) || await player.evaluate(
      '({ zoom, vw: getViewportSize().w, vh: getViewportSize().h })');
    rig.note('Sync View onto ' + s.w + 'x' + s.h + ' (' + s.what + '): region ' +
             JSON.stringify(dmRegion) + ', wanted zoom ' + wantZoom.toFixed(4) +
             ', got ' + (+got.zoom).toFixed(4));
    rig.check(got.vw === s.w && got.vh === s.h,
              'the Player did not take the ' + s.w + 'x' + s.h + ' size, so this pass checked ' +
              'nothing: its viewport is ' + got.vw + 'x' + got.vh);
    // ⚠ A FRACTION OF THE ANSWER, not a flat number. A 2% band is the same tolerance at 900 wide
    // and at 1920; a flat one is loose at the small size and impossible at the large.
    rig.check(Math.abs(got.zoom - wantZoom) < wantZoom * 0.02,
              'Sync View onto ' + s.w + 'x' + s.h + ' (' + s.what + ') landed on zoom ' +
              (+got.zoom).toFixed(4) + ' against the ' + wantZoom.toFixed(4) +
              " that fits the DM's region to that screen, so the TV shows a different amount of " +
              'map than the DM is reading');

    // ⚠ A REFIT, NOT A COPY, and this file is the only place that can tell the two apart. The
    // same check lives in view.js and is dead there: every run is pinned to 1008x681 against
    // 1024x768, two viewports so close in shape that a correct refit lands inside the tolerance
    // of the DM's own zoom. Here the sizes differ on purpose, so the two answers separate.
    // RED ON: playerApplyRegion given the DM's zoom verbatim instead of refitting (player.js)
    // — 2026-09-19
    const dmZoom = await dm.evaluate('+zoom.toFixed(5)');
    if (Math.abs(wantZoom - dmZoom) > wantZoom * 0.02) {
      rig.check(Math.abs(got.zoom - dmZoom) > wantZoom * 0.02,
                "the Player took the DM's zoom verbatim at " + s.w + 'x' + s.h + ' (' + s.what +
                ') rather than refitting the region, so a differently sized screen shows a ' +
                'different amount of map: both read ' + (+got.zoom).toFixed(4));
    } else {
      rig.check(Math.abs(got.zoom - wantZoom) < wantZoom * 0.02,
                'at ' + s.w + 'x' + s.h + ' a refit and a copy land within the tolerance of each ' +
                'other, so this pass holds the refit alone: it landed on ' +
                (+got.zoom).toFixed(4) + ' against ' + wantZoom.toFixed(4));
    }

    // ── C ──
    // RED BY DESIGN: written against the fix, never re-proved
    // Four points a few units inside the map's own corners. The fog there is the Canvas-2D layer
    // over the PixiJS map, and FOG_EDGE_MARGIN is what keeps a shrouded frame at the border.
    const edge = await player.evaluate('(() => { const at = ' + lib.TV_FOG + ';' +
      ' return { tl: at(6, 6), tr: at(' + (MAP_W - 6) + ', 6),' +
      ' bl: at(6, ' + (MAP_H - 6) + '), br: at(' + (MAP_W - 6) + ', ' + (MAP_H - 6) + ') }; })()');
    rig.note('Player fog at the map corners at ' + s.w + 'x' + s.h + ': ' + JSON.stringify(edge));
    const clear = Object.keys(edge).filter(k => edge[k] < 200);
    rig.check(clear.length === 0,
              'the Player\'s fog does not reach the map edge at ' + s.w + 'x' + s.h + ' (' +
              s.what + '): ' + clear.join(', ') + ' read ' +
              clear.map(k => edge[k]).join(', ') + ' where a shrouded corner is 255, so the ' +
              'players see through the border of the map');
  }
};
