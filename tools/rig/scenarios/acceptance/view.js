'use strict';

// view.js — AIMING THE TWO SCREENS, whole.
//
// THE GOAL OF THIS FEATURE: the DM works close in on the corridor the party is in while the TV
// shows the players what they should be looking at, and the two views are aimed independently. The
// minimap is the remote control for the TV: the DM frames the players' view there without moving
// their own, and can see where the players have wandered off to. Every check below serves that
// sentence.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks under a marker carrying its
// letter, wherever in the file that state is cheapest to reach - which is not letter order.
//
//   A. The DM pans by dragging, and the map moves with the cursor one pixel for one pixel.
//        the camera, and the animated map's own element, which is moved separately
//   B. The wheel zooms about the cursor: the map point under the pointer stays under it.
//        and the animated map's element takes the new scale
//   C. Zoom stops at its limits rather than running away.
//   D. A map that has just loaded is fitted to the window and centred in it.
//   E. Sync View sends the REGION the DM can read, not the DM's zoom — so a bigger TV shows the
//      same map rather than more of it.
//   F. The minimap is a remote control for the TV: dragging it moves the Player's view and leaves
//      the DM's own alone.
//   G. The minimap zooms about the view centre, so changing the zoom never re-frames the players.
//   H. The minimap's zoom stops at its limits, and its stepper agrees with its wheel.
//   I. Players who look somewhere else on their own reach the DM's minimap, so the frame shows
//      where they are actually looking.
//   J. Lock stops the players moving the view, and stops the minimap being nudged by accident.
//   K. Send puts the DM's view on the TV, and the minimap's zoom follows the TV there.
//
// The arithmetic behind a view crossing the wire is unit-tested (test/, calcViewportRect,
// zoomToFitRegion, visibleMapRegion). What is here is the behaviour those functions serve, driven
// through the real gestures across two real windows.
//
// ⚠ A VIEW CROSSES AS A REGION, NEVER AS A ZOOM. `zoom` is pixels per map unit on the SENDER's
// canvas, so replaying it verbatim on a differently-sized canvas shows a different amount of map.
// Section E is written against the two windows having DIFFERENT viewport sizes — the rig overrides
// the Player's renderer to the real display size — so a Sync View that shipped the zoom would be
// caught. On two same-sized windows that bug is invisible.
//
// ⚠ THE PLAYER'S REPORT IS THROTTLED TO 100ms AND ARRIVES BY postMessage. Every cross-window
// reading below is polled, never sampled once.
//
// ⚠ THE PLAYER STOPS FOLLOWING THE DM AS SOON AS IT IS DRAGGED, and says so. Section I depends on
// that: a Player still in follow mode reports nothing, so the drag has to be big enough to trip
// the 4px threshold.

const lib = require('../../lib');

const MAP_W = 2400, MAP_H = 1500;

module.exports = async function viewFeature(rig) {
  const dm = rig.dm;

  await lib.openMap(rig, { w: MAP_W, h: MAP_H });
  await dm.waitFor('fogCoverT === 0', 30000, 'the scene cover to lift');

  const camera = s => s.evaluate('({ panX: +panX.toFixed(2), panY: +panY.toFixed(2),' +
    ' zoom: +zoom.toFixed(5) })');

  const region = s => s.evaluate(`(() => {
    const { w, h } = getViewportSize();
    const r = visibleMapRegion(panX, panY, zoom, mapWidth, mapHeight, w, h);
    return { cx: +r.cx.toFixed(1), cy: +r.cy.toFixed(1), w: +r.w.toFixed(1), h: +r.h.toFixed(1),
             vpW: w, vpH: h, zoom: +zoom.toFixed(5) };
  })()`);

  // A real drag on the map: middle button, which is the DM's own pan gesture. The release goes to
  // the window, because that is where input.js listens for it.
  const drag = (dx, dy) => dm.evaluate(`(() => {
    const r = container.getBoundingClientRect();
    const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
    const ev = (type, x, y, target) => target.dispatchEvent(new MouseEvent(type, {
      clientX: x, clientY: y, button: 1, buttons: 4, bubbles: true, cancelable: true }));
    ev('mousedown', x0, y0, container);
    ev('mousemove', x0 + ${dx} / 2, y0 + ${dy} / 2, container);
    ev('mousemove', x0 + ${dx}, y0 + ${dy}, container);
    ev('mouseup', x0 + ${dx}, y0 + ${dy}, window);
    return 0;
  })()`);

  const wheelAt = (s, sx, sy, notches) => s.evaluate(`(() => {
    const r = container.getBoundingClientRect();
    for (let i = 0; i < ${Math.abs(notches)}; i++) {
      container.dispatchEvent(new WheelEvent('wheel', {
        clientX: r.left + ${sx}, clientY: r.top + ${sy},
        deltaY: ${notches < 0 ? 120 : -120}, bubbles: true, cancelable: true }));
    }
    return 0;
  })()`);

  // Polled, bounded, never throwing: a miss lands as the named check below.
  const settleOn = async (read, ok, ms) => {
    // The last value the poll saw. A fresh read after the bound can throw on a window that has
    // gone, which abandons the file instead of failing the check.
    let last;
    const got = await lib.poll(async () => { last = await read(); return ok(last) ? { v: last } : null; },
                               ms, 150);
    return got ? got.v : last;
  };

  // ── D. A freshly loaded map is fitted and centred ─────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  // Checked first, because everything below moves the camera.
  const fitted = await dm.evaluate(`(() => {
    const cw = container.clientWidth, ch = container.clientHeight;
    return { zoom: +zoom.toFixed(5), want: +(Math.min(cw / mapWidth, ch / mapHeight) * 0.95).toFixed(5),
             panX: +panX.toFixed(1), wantPanX: +((cw - mapWidth * zoom) / 2).toFixed(1),
             panY: +panY.toFixed(1), wantPanY: +((ch - mapHeight * zoom) / 2).toFixed(1) };
  })()`);
  rig.note('the fit on load: ' + JSON.stringify(fitted));
  rig.check(Math.abs(fitted.zoom - fitted.want) < 0.0005,
            'a freshly loaded map was not fitted to the window: zoom ' + fitted.zoom +
            ' against a fit of ' + fitted.want);
  rig.check(Math.abs(fitted.panX - fitted.wantPanX) < 1 &&
            Math.abs(fitted.panY - fitted.wantPanY) < 1,
            'a freshly loaded map was not centred in the window: ' + JSON.stringify(fitted));

  // ── A. Panning follows the cursor 1:1 ─────────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  const before = await camera(dm);
  await drag(-180, 120);
  await lib.settle(dm, '!viewportDirty', 8000);
  const after = await camera(dm);
  rig.note('pan: ' + JSON.stringify(before) + ' → ' + JSON.stringify(after));
  rig.check(Math.abs((after.panX - before.panX) - -180) < 1 &&
            Math.abs((after.panY - before.panY) - 120) < 1,
            'dragging the map 180 left and 120 down moved it somewhere else: ' +
            JSON.stringify({ dx: after.panX - before.panX, dy: after.panY - before.panY }));
  rig.check(after.zoom === before.zoom, 'panning changed the zoom: ' + after.zoom);

  // ⚠ AN ANIMATED MAP IS NOT MOVED BY THE PixiJS CAMERA. It is a DOM <video> the browser
  // composites, and video.js positions it with a CSS transform of its own. So panX and panY
  // agreeing with the drag proves only half of it: the picture the DM is looking at moves on a
  // separate code path, and nothing else in the suite reads it.
  //
  // The NUMBERS out of the stored transform, compared against the camera with a tolerance. The
  // browser rounds what it keeps, so a string comparison against the app's own formula fails on
  // float precision alone. A stale transform, or none at all, fails here.
  const videoBox = () => dm.evaluate(`(() => {
    if (!mapVideo) return { err: 'the DM holds no video element' };
    // Scanned rather than matched: neither 'translate' nor 'scale' carries a digit, so every run
    // of number characters in the string is one of the three values, in order.
    const nums = (t) => {
      const out = []; let cur = '';
      for (const ch of String(t || '')) {
        if ((ch >= '0' && ch <= '9') || ch === '.' || ch === '-') cur += ch;
        else { if (cur) out.push(Number(cur)); cur = ''; }
      }
      if (cur) out.push(Number(cur));
      return out;
    };
    const v = nums(mapVideo.style.transform);
    return {
      raw: mapVideo.style.transform, tx: v[0], ty: v[1], scale: v[2],
      panX: +panX.toFixed(3), panY: +panY.toFixed(3), zoom: +zoom.toFixed(6),
      w: mapVideo.style.width, h: mapVideo.style.height,
      wantW: mapWidth + 'px', wantH: mapHeight + 'px',
    };
  })()`);

  const box = await videoBox();
  rig.note('the video element after the pan: ' + JSON.stringify(box));
  if (rig.check(!box.err, 'the animated map could not be measured: ' + box.err)) {
    rig.check(box.tx != null && Math.abs(box.tx - box.panX) < 1 &&
              Math.abs(box.ty - box.panY) < 1,
              'the animated map did not follow the pan: the video sits at ' + box.tx + ',' +
              box.ty + ' where the camera is at ' + box.panX + ',' + box.panY);
    rig.check(box.scale != null && Math.abs(box.scale - box.zoom) < 0.0005,
              'the animated map is drawn at the wrong scale: the video is at ' + box.scale +
              ' where the camera is at ' + box.zoom);
    rig.check(box.w === box.wantW && box.h === box.wantH,
              'the animated map is laid out at the wrong size: ' + box.w + 'x' + box.h +
              " against the map's own " + box.wantW + 'x' + box.wantH);
  }

  // ── B. The wheel zooms about the cursor ───────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  const anchor = await dm.evaluate(`(() => {
    // A screen point off-centre, so a zoom that pivots about the centre instead moves it.
    const sx = Math.round(container.clientWidth * 0.28), sy = Math.round(container.clientHeight * 0.7);
    return { sx, sy, mapX: (sx - panX) / zoom, mapY: (sy - panY) / zoom };
  })()`);
  await wheelAt(dm, anchor.sx, anchor.sy, 3);
  await lib.settle(dm, '!viewportDirty', 8000);
  const held = await dm.evaluate('({ sx: ' + anchor.mapX + ' * zoom + panX,' +
    ' sy: ' + anchor.mapY + ' * zoom + panY, zoom: +zoom.toFixed(5) })');
  rig.note('the map point under the cursor: (' + anchor.sx + ',' + anchor.sy + ') → (' +
           held.sx.toFixed(1) + ',' + held.sy.toFixed(1) + ') at zoom ' + held.zoom);
  rig.check(held.zoom > after.zoom, 'three notches of wheel up did not zoom in: ' + held.zoom);
  rig.check(Math.abs(held.sx - anchor.sx) < 2 && Math.abs(held.sy - anchor.sy) < 2,
            'the wheel did not zoom about the cursor: the map point under it moved ' +
            Math.round(held.sx - anchor.sx) + ',' + Math.round(held.sy - anchor.sy) + ' pixels');

  const zoomedBox = await videoBox();
  rig.check(!zoomedBox.err && Math.abs(zoomedBox.scale - zoomedBox.zoom) < 0.0005,
            'the animated map did not take the new zoom: the video is at ' + zoomedBox.scale +
            ' where the camera is at ' + zoomedBox.zoom);

  // ── C. Zoom stops at its limits ───────────────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  await wheelAt(dm, 100, 100, 90);
  await lib.settle(dm, 'zoom === 20', 8000);
  const zoomedIn = (await camera(dm)).zoom;
  rig.check(zoomedIn === 20,
            'zooming in without end did not stop at 20: ' + zoomedIn);
  await wheelAt(dm, 100, 100, -200);
  await lib.settle(dm, 'zoom === 0.02', 8000);
  const zoomedOut = (await camera(dm)).zoom;
  rig.check(zoomedOut === 0.02,
            'zooming out without end did not stop at 0.02: ' + zoomedOut);
  await dm.evaluate('fitToScreen(); viewportDirty = true; scheduleRender(); 0');
  await lib.settle(dm, '!viewportDirty', 8000);

  // ── E. Sync View sends a region, not a zoom ───────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  const player = await rig.player();
  await player.waitFor('!!mapOffscreen', 45000, 'the Player to receive the map');
  await player.waitFor('fogCoverT === 0', 45000, 'the scene cover to lift on the Player');

  const sizes = { dm: await dm.evaluate('getViewportSize()'),
                  player: await player.evaluate('getViewportSize()') };
  rig.note('viewport sizes: DM ' + JSON.stringify(sizes.dm) + ' Player ' + JSON.stringify(sizes.player));
  rig.check(sizes.dm.w !== sizes.player.w || sizes.dm.h !== sizes.player.h,
            'both windows are the same size, so a Sync View that shipped the DM\'s zoom instead ' +
            'of its region would pass every check below: ' + JSON.stringify(sizes));

  // Zoomed in AND moved off the map's centre, both deliberately. A DM zoomed about the middle of
  // its own viewport is still centred on the middle of the map, so a Player that ignored the snap
  // entirely would sit at the same centre and pass a centre-only check.
  await wheelAt(dm, Math.round(sizes.dm.w / 2), Math.round(sizes.dm.h / 2), 8);
  await dm.evaluate('panX -= 260; panY -= 190; viewportDirty = true; scheduleRender(); 0');
  await lib.settle(dm, '!viewportDirty', 8000);
  const dmRegion = await region(dm);
  // What a correct refit lands on: the DM's REGION fitted to the Player's own canvas.
  const wantZoom = Math.min(sizes.player.w / dmRegion.w, sizes.player.h / dmRegion.h);
  rig.note('the DM is looking at ' + JSON.stringify(dmRegion) + ', a correct refit is zoom ' +
           wantZoom.toFixed(5));

  await dm.evaluate('document.getElementById("btn-sync-view").click(); 0');
  // ⚠ lib.SETTLE ON THE ZOOM, NOT THE CENTRE. The Player lerps into place, and it was ALREADY at the
  // right centre before the snap — so a wait that watched the centre returns on its first poll,
  // before the lerp has moved anything, and reads the pre-snap view as the result.
  const playerRegion = await settleOn(() => region(player),
    v => Math.abs(v.zoom - wantZoom) < 0.02, 20000);
  rig.note('the Player settled on ' + JSON.stringify(playerRegion));
  rig.check(Math.abs(playerRegion.cx - dmRegion.cx) < 40 &&
            Math.abs(playerRegion.cy - dmRegion.cy) < 40,
            "Sync View did not put the DM's region on the TV: the Player is centred on " +
            playerRegion.cx + ',' + playerRegion.cy + " against the DM's " + dmRegion.cx + ',' +
            dmRegion.cy);
  rig.check(Math.abs(playerRegion.zoom - wantZoom) < 0.02,
            "the Player did not refit the DM's region onto its own canvas: it is at zoom " +
            playerRegion.zoom + ' where fitting ' + dmRegion.w + 'x' + dmRegion.h + ' into ' +
            sizes.player.w + 'x' + sizes.player.h + ' is ' + wantZoom.toFixed(5));
  // ⚠ REFIT-VERSUS-COPY IS IN sizes.js, NOT HERE, and moving it there is what made it a check.
  // It can only tell a refit from a copy when the two answers are further apart than the
  // tolerance, and every run is pinned to 1008x681 against 1024x768 — two viewports so close in
  // shape that a correct refit always lands inside 0.02 of the DM's own zoom. The check sat here
  // behind `!discriminates ||` and passed every run without ever running.
  rig.note('a correct refit here is ' + wantZoom.toFixed(5) + " against the DM's " +
           dmRegion.zoom.toFixed(5) + '; sizes.js B is where those two separate');
  // The promise is "the players see AT LEAST what the DM sees", so the TV's region contains the
  // DM's rather than matching it exactly.
  rig.check(playerRegion.w >= dmRegion.w - 1 && playerRegion.h >= dmRegion.h - 1,
            'the TV is showing LESS map than the DM can read, so the players are missing part of ' +
            'what the DM is pointing at: ' + JSON.stringify(playerRegion) + ' against ' +
            JSON.stringify(dmRegion));
  rig.check(await player.evaluate('playerFollowDM === true'),
            'the Player did not go back to following the DM after Sync View, so the next fog ' +
            'change re-frames it somewhere else');

  // ── K. After Send, the minimap reads the TV's zoom ───────────────────────
  // RED ON: reportPlayerView skipped after a pushed view in applyPlayerFogOnly (playerMap.js) — 2026-09-26
  await wheelAt(dm, Math.round(sizes.dm.w / 2), Math.round(sizes.dm.h / 2), 2);
  await lib.settle(dm, '!viewportDirty', 8000);
  const sendRegion = await region(dm);
  const sendZoom = Math.min(sizes.player.w / sendRegion.w, sizes.player.h / sendRegion.h);
  // ⚠ THE PREVIEW IS PUT WRONG FIRST, so a Player that never reports cannot pass by already agreeing.
  await dm.evaluate('minimapSetView({ mapCX: minimapView.mapCX, mapCY: minimapView.mapCY,' +
    ' zoom: minimapView.zoom * 1.5 }); 0');
  await dm.evaluate('document.getElementById("btn-send").click(); 0');
  const sentTo = await settleOn(() => region(player), v => Math.abs(v.zoom - sendZoom) < 0.02, 20000);
  const mmAfterSend = await settleOn(() => dm.evaluate('minimapView.zoom'),
    z => Math.abs(z - sentTo.zoom) / sentTo.zoom < 0.02, 10000);
  rig.check(Math.abs(mmAfterSend - sentTo.zoom) / sentTo.zoom < 0.02,
            'the minimap kept its own zoom after Send moved the TV: preview ' + mmAfterSend +
            ' against a TV at ' + sentTo.zoom);

  // ── F. The minimap is a remote control ───────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  // ⚠ THE MINIMAP LIVES IN THE CONTROL PANEL'S PLAYER PANE, which carries `hidden` until that tab
  // is chosen — and a hidden element has zero-sized rects, so every gesture below would land at
  // 0,0 and the drag would silently move nothing. Opened through the real tab.
  await dm.evaluate(`(() => {
    const tab = document.querySelector('.cp-tab[data-tab="player"]');
    if (tab && !tab.classList.contains('active')) tab.click();
    return 0;
  })()`);
  await lib.settle(dm, "!!document.getElementById('minimap-canvas') && " +
    "document.getElementById('minimap-canvas').getBoundingClientRect().width > 0", 8000);
  const mmBox = await dm.evaluate(`(() => {
    const c = document.getElementById('minimap-canvas');
    const b = c ? c.getBoundingClientRect() : null;
    return b ? { w: Math.round(b.width), h: Math.round(b.height) } : { w: 0, h: 0 };
  })()`);
  rig.check(mmBox.w > 0 && mmBox.h > 0,
            'the minimap has no size on screen even with the Player tab open, so every gesture ' +
            'below would be aimed at nothing: ' + JSON.stringify(mmBox));

  const mmDrag = (dx, dy) => dm.evaluate(`(() => {
    const c = document.getElementById('minimap-canvas');
    if (!c) return { err: 'no minimap canvas' };
    const r = c.getBoundingClientRect();
    if (!r.width) return { err: 'the minimap has no size on screen' };
    const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
    // setPointerCapture on a synthetic pointerId throws in this Chromium; stubbed for the drag
    // and put straight back, so the handler under test is otherwise untouched.
    const origCapture = c.setPointerCapture;
    c.setPointerCapture = () => {};
    const ev = (type, x, y) => c.dispatchEvent(new PointerEvent(type, {
      pointerId: 7, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    ev('pointerdown', x0, y0);
    ev('pointermove', x0 + ${dx} / 2, y0 + ${dy} / 2);
    ev('pointermove', x0 + ${dx}, y0 + ${dy});
    ev('pointerup', x0 + ${dx}, y0 + ${dy});
    c.setPointerCapture = origCapture;
    return { ok: true };
  })()`);

  const mmView = () => dm.evaluate('({ cx: +minimapView.mapCX.toFixed(1),' +
    ' cy: +minimapView.mapCY.toFixed(1), zoom: +minimapView.zoom.toFixed(5) })');

  const dmCamBefore = await camera(dm);
  const mmBefore = await mmView();
  const dragged = await mmDrag(-40, -25);
  if (rig.check(!dragged.err, 'the minimap could not be dragged: ' + dragged.err)) {
    await lib.poll(async () => {
      const v = await mmView();
      return (v.cx !== mmBefore.cx || v.cy !== mmBefore.cy) ? v : null;
    }, 10000);
    const mmAfter = await mmView();
    rig.note('minimap view: ' + JSON.stringify(mmBefore) + ' → ' + JSON.stringify(mmAfter));
    rig.check(mmAfter.cx !== mmBefore.cx || mmAfter.cy !== mmBefore.cy,
              'dragging the minimap moved nothing: ' + JSON.stringify(mmAfter));
    const playerMoved = await settleOn(() => region(player),
      v => Math.abs(v.cx - mmAfter.cx) < 40 && Math.abs(v.cy - mmAfter.cy) < 40, 20000);
    rig.check(Math.abs(playerMoved.cx - mmAfter.cx) < 40 &&
              Math.abs(playerMoved.cy - mmAfter.cy) < 40,
              'dragging the minimap did not move what the players are looking at: the Player is ' +
              'centred on ' + playerMoved.cx + ',' + playerMoved.cy + ' against the minimap\'s ' +
              mmAfter.cx + ',' + mmAfter.cy);
    const dmCamAfter = await camera(dm);
    rig.check(dmCamAfter.panX === dmCamBefore.panX && dmCamAfter.panY === dmCamBefore.panY &&
              dmCamAfter.zoom === dmCamBefore.zoom,
              "dragging the minimap moved the DM's own view as well as the TV's, so the DM " +
              'cannot aim the players without losing their own place: ' +
              JSON.stringify(dmCamBefore) + ' → ' + JSON.stringify(dmCamAfter));
  }

  // ── G. The minimap zooms about the centre ────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  const mmBeforeZoom = await mmView();
  await dm.evaluate(`(() => {
    const c = document.getElementById('minimap-canvas');
    const r = c.getBoundingClientRect();
    // Deliberately off-centre. A cursor-pivot zoom here would shift what the players see.
    for (let i = 0; i < 3; i++) {
      c.dispatchEvent(new WheelEvent('wheel', { clientX: r.left + r.width * 0.15,
        clientY: r.top + r.height * 0.85, deltaY: -120, bubbles: true, cancelable: true }));
    }
    return 0;
  })()`);
  await lib.poll(async () => {
    const v = await mmView();
    return v.zoom > mmBeforeZoom.zoom ? v : null;
  }, 10000);
  const mmAfterZoom = await mmView();
  rig.note('minimap zoom: ' + JSON.stringify(mmBeforeZoom) + ' → ' + JSON.stringify(mmAfterZoom));
  rig.check(mmAfterZoom.zoom > mmBeforeZoom.zoom,
            'the minimap wheel did not zoom in: ' + mmAfterZoom.zoom);
  rig.check(mmAfterZoom.cx === mmBeforeZoom.cx && mmAfterZoom.cy === mmBeforeZoom.cy,
            'zooming the minimap off-centre re-framed what the players are looking at: centre ' +
            'went from ' + mmBeforeZoom.cx + ',' + mmBeforeZoom.cy + ' to ' + mmAfterZoom.cx +
            ',' + mmAfterZoom.cy);

  // ── H. The minimap's zoom limits, and its stepper ────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  const stepUp = await dm.evaluate('(() => { const before = minimapGetZoom();' +
    ' minimapNudgeZoom(1); return { before, after: minimapGetZoom() }; })()');
  rig.check(stepUp.after > stepUp.before,
            'the minimap stepper does not zoom in the same direction as its wheel: ' +
            JSON.stringify(stepUp));
  const clampedIn = await dm.evaluate('(() => { minimapSetZoom(1e6); return minimapGetZoom(); })()');
  rig.check(clampedIn === 20, 'the minimap zoom did not stop at 20: ' + clampedIn);
  const clampedOut = await dm.evaluate('(() => { minimapSetZoom(1e-6); return minimapGetZoom(); })()');
  rig.check(clampedOut === 0.02, 'the minimap zoom did not stop at 0.02: ' + clampedOut);
  // ⚠ WAITED FOR ON THE PLAYER, not on the DM. Restoring the minimap zoom posts a view-snap,
  // and the DM's own value is correct the instant it is set. Section I then drags the Player's
  // view, and a LERP still running lands on top of that drag and puts the view back - which
  // reads as the Player never having moved at all.
  await dm.evaluate('minimapSetZoom(' + mmBeforeZoom.zoom + '); 0');
  await lib.settle(player, '!viewLerpActive && Math.abs(zoom - ' + mmBeforeZoom.zoom + ') < 1e-4', 10000);

  // ── I. Players looking elsewhere reach the minimap ──────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  // ⚠ THE MOVES ARE SPACED FROM NODE, ON PURPOSE. _postPlayerView throttles to one report per
  // 100ms, so a drag whose moves all arrive inside one window has its FINAL position dropped and
  // the DM's frame is left pointing at the middle of the gesture. Spacing them is what makes "the
  // frame agrees with where the players are looking" a real check rather than a race.
  const playerStep = (type, x, y, onWindow) => player.evaluate(`(() => {
    const r = container.getBoundingClientRect();
    const t = ${onWindow ? 'window' : 'container'};
    t.dispatchEvent(new MouseEvent(${JSON.stringify(type)}, {
      clientX: r.left + r.width / 2 + ${x}, clientY: r.top + r.height / 2 + ${y},
      button: 0, buttons: 1, bubbles: true, cancelable: true }));
    return { follow: playerFollowDM, panX: +panX.toFixed(1) };
  })()`);
  const playerDrag = async (dx, dy) => {
    await playerStep('mousedown', 0, 0, false);
    await playerStep('mousemove', Math.round(dx / 2), Math.round(dy / 2), false);
    await lib.hold(160, "_postPlayerView throttles to one report per 100ms, so two moves inside " +
      "one window lose the last position and the frame points at the middle of the gesture");
    const out = await playerStep('mousemove', dx, dy, false);
    await lib.hold(160, 'the same throttle window, before the release');
    await playerStep('mouseup', dx, dy, true);
    return out;
  };

  const mmBeforeFreelook = await mmView();
  const looked = await playerDrag(-260, -160);
  rig.note('the Player after dragging its own view: ' + JSON.stringify(looked));
  rig.check(looked.follow === false,
            'the Player is still following the DM after being dragged, so it reports nothing and ' +
            'the DM cannot see where the players are looking');
  // ⚠ COMPARED AGAINST THE PLAYER'S RAW VIEWPORT CENTRE, NOT ITS visibleMapRegion. That helper
  // CLAMPS to the map, and PLAYER_VIEW reports the unclamped centre — so against a map edge the
  // two legitimately disagree by however far the viewport hangs off the map, and a check written
  // against the clamped figure fails on a view the app framed correctly.
  //
  // ⚠ READ BEFORE THE MINIMAP IS POLLED, and the poll waits for AGREEMENT rather than for any
  // change at all. A drag posts a report per throttle window, so "the minimap moved" is true at
  // the halfway point — and a wait that stops there compares the middle of the gesture against
  // the end of it and reports a minimap that is working as broken.
  const playerCentre = await player.evaluate(`(() => {
    const { w, h } = getViewportSize();
    return { cx: +((w / 2 - panX) / zoom).toFixed(1), cy: +((h / 2 - panY) / zoom).toFixed(1),
             zoom: +zoom.toFixed(5) };
  })()`);
  const mmFollowed = await settleOn(() => mmView(),
    v => Math.abs(v.cx - playerCentre.cx) < 20 && Math.abs(v.cy - playerCentre.cy) < 20, 20000);
  rig.note('the minimap after the players looked away: ' + JSON.stringify(mmBeforeFreelook) +
           ' → ' + JSON.stringify(mmFollowed));
  rig.check(mmFollowed.cx !== mmBeforeFreelook.cx || mmFollowed.cy !== mmBeforeFreelook.cy,
            'the players moved their own view and the DM\'s minimap never heard about it, so the ' +
            'frame is pointing at somewhere nobody is looking');
  rig.check(Math.abs(mmFollowed.cx - playerCentre.cx) < 20 &&
            Math.abs(mmFollowed.cy - playerCentre.cy) < 20,
            'the minimap frame does not agree with where the players are actually looking: ' +
            JSON.stringify(mmFollowed) + ' against ' + JSON.stringify(playerCentre));
  rig.check(Math.abs(mmFollowed.zoom - playerCentre.zoom) < 0.01,
            'the minimap frame is drawn at the wrong size for what the players can see: zoom ' +
            mmFollowed.zoom + " against the Player's " + playerCentre.zoom);

  // ── J. Lock ─────────────────────────────────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  await dm.evaluate('document.getElementById("btn-minimap-lock").click(); 0');
  rig.check(await dm.evaluate('minimapLocked === true'), 'the Lock button did not lock the minimap');
  const lockReached = await settleOn(() => player.evaluate('playerInputLocked === true'),
                                     v => v === true, 15000);
  rig.check(lockReached === true,
            'Lock never reached the Player, so the players can still drag the view away from ' +
            'what the DM aimed at');

  // ⚠ LET EVERYTHING THE DM HAS ALREADY SENT LAND FIRST. A view-snap still in flight — section H
  // restored the minimap zoom, which posts one — arrives while the locked drag below is being
  // measured and reads exactly like the lock having failed.
  await lib.hold(1200, 'a view-snap the DM already sent is still in flight, and it lands during ' +
    'the locked drag below looking exactly like the lock having failed');
  const lockedPlayerBefore = await camera(player);
  await playerDrag(200, 140);
  await lib.hold(400, 'the Player is locked, so there is no state to poll for - long enough for ' +
    'an unlocked drag to have moved the camera, then prove it did not');
  const lockedPlayerAfter = await camera(player);
  rig.check(lockedPlayerAfter.panX === lockedPlayerBefore.panX &&
            lockedPlayerAfter.panY === lockedPlayerBefore.panY,
            'a locked Player still moved when it was dragged: ' +
            JSON.stringify(lockedPlayerBefore) + ' → ' + JSON.stringify(lockedPlayerAfter));

  const lockedMmBefore = await mmView();
  await mmDrag(-50, -30);
  await lib.hold(400, 'the minimap is locked, so there is no state to poll for - long enough ' +
    'for an unlocked drag to have moved the view, then prove it did not');
  const lockedMmAfter = await mmView();
  rig.check(lockedMmAfter.cx === lockedMmBefore.cx && lockedMmAfter.cy === lockedMmBefore.cy,
            'a locked minimap still moved when it was dragged: ' + JSON.stringify(lockedMmBefore) +
            ' → ' + JSON.stringify(lockedMmAfter));

  // The stepper is deliberately NOT locked: the lock exists to stop an accidental nudge, and a
  // deliberate zoom is still the DM's to make.
  const lockedStep = await dm.evaluate('(() => { const before = minimapGetZoom();' +
    ' minimapNudgeZoom(1); return { before, after: minimapGetZoom() }; })()');
  rig.check(lockedStep.after !== lockedStep.before,
            'Lock also disabled the zoom stepper, which it is not meant to: ' +
            JSON.stringify(lockedStep));

  await dm.evaluate('document.getElementById("btn-minimap-lock").click(); 0');
  rig.check(await dm.evaluate('minimapLocked === false'), 'the Lock button would not unlock');

  rig.byEye('whether a Sync View lands the TV where the DM meant it to when the two screens are ' +
            'very different shapes — the region arithmetic is checked here, the judgement of ' +
            '"is that the right framing" is at the table');
};
