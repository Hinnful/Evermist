'use strict';

// fit-to-tv.js — TURN: a scene's own turn of the TV picture, three tiles in TV setup.
//
// THE GOAL OF THIS FEATURE: a tall map on a wide TV is laid along the TV by one click on a picture of
// it, with no image editor and no re-encoding. The laptop never turns with it. Every check below
// serves that sentence. (The file keeps its name; the feature began as Fit to TV.)
//
//   5. TV setup has a Turn row of three pictures, upright and a quarter turn each way, offered for
//      every map, a tall one and a wide one alike. The current one wears the ring.
//   6. A tile turns the Player by the same amount whatever the seat (270 and 90). The laptop's seat
//      never moves with it, and a later seat change leaves the turn as it was.
//   7. Map, fog, grid and an effect turn together, on the Player's own painted pixels, on an
//      animated map. The ping keeps its size. Pictures on the TV stay upright.
//   8. The minimap shows the turned picture and a drag on it goes the way the hand goes. Sync View
//      frames the TV right with seat 90 and turn 270, where both views lie sideways.
//   9. The turn is kept per scene, survives a restart, and a scene switch brings the new scene's.
//      An older save holding step 2 shows as the tile with its turn.
//  12. In Manual mode a turn waits for Send, and Send carries it with the pending reveal.
//  10. In two-map mode each half turns its own map.
//
// ⚠ THE PLAYER'S PIXELS ARE READ FROM A SCREENSHOT, and the expected place of each map point is
// worked out from the pixi canvas's computed CSS matrix, never from the app's own conversion, so a
// wrong turn cannot cancel itself out. The map is four quadrants of four colours, so a wrong turn
// puts the wrong colour under a probe.

const lib = require('../../lib');

const TALL = { w: 1000, h: 2000 };
const WIDE = { w: 2000, h: 1000 };

// Probes, in map units: one inside each quadrant, in revealed ground clear of a grid line, the disc
// and the effect; and one in fog.
const QUAD = { TL: [150, 520, 141, 85, 36], TR: [850, 520, 58, 107, 53], BL: [150, 1520, 47, 75, 124], BR: [850, 1520, 122, 47, 75],
               TOP: [150, 30, 141, 85, 36], BOT: [850, 1970, 122, 47, 75] };

const DM_HELPERS = `
globalThis.__fitPick = deg => { document.querySelector('.sa-hit[data-seat-pick="' + deg + '"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); return 0; };
globalThis.__fitTile = i => {
  if (!document.getElementById('tv-setup')) _tvSetupOpen();
  document.querySelector('#tv-setup [data-tv-turn="' + i + '"]').click();
  return 0;
};
globalThis.__fitState = () => {
  if (!document.getElementById('tv-setup')) _tvSetupOpen();
  _tvSetupRender();
  const tiles = [...document.querySelectorAll('#tv-setup [data-tv-turn]')];
  return { n: tiles.length, on: tiles.findIndex(b => b.classList.contains('on')), disabled: tiles.some(b => b.disabled) };
};
globalThis.__fitDrag = () => {
  const c = document.getElementById('minimap-canvas'), r = c.getBoundingClientRect();
  const cx0 = minimapView.mapCX, cy0 = minimapView.mapCY, x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
  const orig = c.setPointerCapture; c.setPointerCapture = () => {};
  const ev = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { pointerId: 9, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  ev('pointerdown', x0, y0); ev('pointermove', x0 + 30, y0); ev('pointerup', x0 + 30, y0);
  c.setPointerCapture = orig;
  return { dx: minimapView.mapCX - cx0, dy: minimapView.mapCY - cy0 };
};
globalThis.__fitMmPx = (x, y) => { const d = _ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data; return [d[0], d[1], d[2]]; };
0`;

const PLAYER_HELPERS = `
globalThis.__fitClient = (mx, my) => {
  const c = document.getElementById('pixi-canvas'), w = c.offsetWidth, h = c.offsetHeight;
  const t = getComputedStyle(c).transform, M = t && t !== 'none' ? new DOMMatrix(t) : new DOMMatrix();
  const p = M.transformPoint(new DOMPoint(mx * zoom + panX - w / 2, my * zoom + panY - h / 2));
  const r = container.getBoundingClientRect();
  return { x: r.left + c.offsetLeft + w / 2 + p.x, y: r.top + c.offsetTop + h / 2 + p.y };
};
globalThis.__fitLoad = async () => {
  const bin = atob(globalThis.__fitB64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([u], { type: 'image/png' }));
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
  globalThis.__fitImg = { d: x.getImageData(0, 0, c.width, c.height), k: bmp.width / innerWidth };
  globalThis.__fitB64 = null;
  return [bmp.width, bmp.height];
};
globalThis.__fitPx = (mx, my) => {
  const p = __fitClient(mx, my), I = __fitImg, x = Math.round(p.x * I.k), y = Math.round(p.y * I.k);
  if (x < 0 || y < 0 || x >= I.d.width || y >= I.d.height) return null;
  const o = (y * I.d.width + x) * 4;
  return [I.d.data[o], I.d.data[o + 1], I.d.data[o + 2]];
};
globalThis.__fitCount = (mx1, my1, mx2, my2, kind) => {
  const a = __fitClient(mx1, my1), b = __fitClient(mx2, my2), I = __fitImg;
  const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) * I.k)), x1 = Math.min(I.d.width - 1, Math.ceil(Math.max(a.x, b.x) * I.k));
  const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) * I.k)), y1 = Math.min(I.d.height - 1, Math.ceil(Math.max(a.y, b.y) * I.k));
  let n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const o = (y * I.d.width + x) * 4, r = I.d.data[o], g = I.d.data[o + 1], bl = I.d.data[o + 2];
    if (kind === 'magenta' ? (r > 200 && bl > 200 && g < 110) : (r > 170 && r - bl > 60 && g < 200)) n++;
  }
  return n;
};
globalThis.__fitRot = () => {
  const t = getComputedStyle(document.getElementById('pixi-canvas')).transform;
  if (!t || t === 'none') return 0;
  const m = new DOMMatrix(t);
  return (Math.round(Math.atan2(m.b, m.a) * 180 / Math.PI) + 360) % 360;
};
globalThis.__fitMetrics = quads => {
  const dist = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : 999);
  const q = {};
  for (const k in quads) q[k] = Math.round(dist(__fitPx(quads[k][0], quads[k][1]), quads[k].slice(2)));
  const F = __fitPx(500, 1950);
  return { rot: __fitRot(), q, fogTL: Math.round(dist(F, quads.BL.slice(2))), fogBR: Math.round(dist(F, quads.BR.slice(2))),
           grid: __fitCount(688, 688, 712, 712, 'magenta'), gridMid: __fitCount(738, 738, 762, 762, 'magenta'),
           ember: __fitCount(310, 1210, 690, 1390, 'ember'), emberCtl: __fitCount(650, 350, 850, 550, 'ember') };
};
0`;

module.exports = async function fitToTv(rig) {
  let dm = rig.dm;

  await lib.openMap(rig, TALL);
  await dm.evaluate(DM_HELPERS);
  await dm.waitFor('fogCoverT === 0', 30000, 'the scene cover to lift');
  const tallId = await dm.evaluate('currentScene.id');
  let player = await rig.player();
  await lib.installHelpers(player);
  await player.evaluate(PLAYER_HELPERS);
  await player.waitFor('!!mapOffscreen && fogCoverT === 0', 45000, 'the Player to show the map');

  const turnIs = async (sess, want) => !!(await lib.poll(
    async () => ((await sess.evaluate('seatTurn')) === want ? { ok: 1 } : null), 12000));
  const tile = i => dm.evaluate('__fitTile(' + i + ')');
  const tvState = () => dm.evaluate('({ seat: seatTurn, fit: tvFit })');
  const TURN = { 1: 270, 2: 90 };

  // ── 5. the window ────────────────────────────────────────────────────────
  // RED BY DESIGN: written against item 217, never re-proved
  const s0 = await dm.evaluate('__fitState()');
  rig.check(s0.n === 3 && s0.on === 0 && !s0.disabled,
            'TV setup has no three enabled Turn tiles with upright ringed for a tall map: ' + JSON.stringify(s0));
  await tile(1);
  rig.check((await dm.evaluate('__fitState()')).on === 1 && (await tvState()).fit.step === 1,
            'the first turned tile did not take the ring and the turn');
  await tile(2);
  rig.check((await dm.evaluate('__fitState()')).on === 2, 'the second turned tile did not take the ring');
  await tile(0);
  const s5 = await dm.evaluate('__fitState()');
  rig.check(s5.on === 0 && (await tvState()).fit.step === 0, 'the upright tile did not put the turn back: ' + JSON.stringify(s5));

  // ── 6. the turn is the same from every seat, and only the Player turns ───
  // RED BY DESIGN: written against item 217, never re-proved
  for (const seat of [0, 90, 180, 270]) {
    await dm.evaluate('__fitPick(' + seat + ')');
    const keyBefore = await dm.evaluate('localStorage.getItem("evermist.seatTurn")');
    for (const i of [1, 2]) {
      await tile(i);
      const got = await turnIs(player, TURN[i]);
      const st = await tvState();
      rig.check(got, 'seat ' + seat + ': tile ' + i + ' did not turn the Player to ' + TURN[i] + ', it is at ' + await player.evaluate('seatTurn'));
      rig.check(st.seat === seat && st.fit.turn === TURN[i] && st.fit.step === 1,
                'seat ' + seat + ': the laptop turned with the tile, or the saved turn is not {1, ' + TURN[i] + '}: ' + JSON.stringify(st));
    }
    rig.check(await player.evaluate('localStorage.getItem("evermist.seatTurn")') === keyBefore,
              'seat ' + seat + ': the Player wrote the seat key the DM window reads, so the next launch turns the laptop');
    await tile(0);
    rig.check(await turnIs(player, 0), 'seat ' + seat + ': the upright tile did not put the Player back to 0');
  }
  await dm.evaluate('__fitPick(0)');
  await tile(2);
  await turnIs(player, 90);
  await dm.evaluate('__fitPick(180)');
  await lib.hold(800, 'long enough for a seat change that wrongly reached the turn to move the Player');
  const kept = await tvState();
  rig.check(kept.fit.turn === 90 && await player.evaluate('seatTurn') === 90,
            'a later seat change moved the turn: ' + JSON.stringify(kept));
  await dm.evaluate('__fitPick(0)');
  await tile(0);

  // ── 7. everything on the TV turns together, on the Player's own pixels ───
  await dm.evaluate(`revealCircle(500, 800, 1000); revealCircle(850, 1850, 200); rebuildFogEffect(); fogDirty = true;
    setEffects([{ id: 900, vertices: [{x:300,y:1200},{x:700,y:1200},{x:700,y:1400},{x:300,y:1400}], material: 'fire', cornerRadius: 0, name: 'Ember probe' }]);
    applyGridConfig({ enabled: true, cellSize: 100, offsetX: 0, offsetY: 0, color: '#ff00ff', opacity: 1, lineWidth: 4, mode: 'square' });
    gridDirty = true; viewportDirty = true; scheduleRender(); sendToPlayerNow(); 0`);
  await lib.settle(player, '!viewportDirty && !fogDirty && !fogTransRafId && fogCoverT === 0', 15000);

  const shoot = async check => {
    let last = null;
    const hit = await lib.poll(async () => {
      const r = await player.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 60000);
      await player.writeBig('__fitB64', r.data);
      await player.evaluate('__fitLoad()');
      last = await player.evaluate('__fitMetrics(' + JSON.stringify(QUAD) + ')');
      return check(last) ? { ok: last } : null;
    }, 25000, 400);
    return { ok: !!hit, last };
  };
  const painted = want => m => m.rot === want && Object.values(m.q).every(d => d < 60) && m.fogTL > 40 && m.fogBR > 40 &&
                       m.grid > 2 && m.gridMid === 0 && m.ember > 20 && m.emberCtl === 0;
  // RED BY DESIGN: written against the fix, never re-proved
  const base = await shoot(painted(0));
  rig.check(base.ok, 'the probes do not read the untouched TV, so the turned reads below prove nothing: ' + JSON.stringify(base.last));

  // RED ON: the seat-turned canvas rule broken in base.css, and separately setPlayerTurn's initPlayerMapRegionTexture call removed (mapTurn.js) - 2026-10-17
  for (const [label, want, i] of [['A quarter turn one way', 270, 1], ['A quarter turn the other way', 90, 2]]) {
    await tile(i);
    await turnIs(player, want);
    await lib.settle(player, '!viewportDirty && !fogDirty', 8000);
    const shot = await shoot(painted(want));
    rig.check(shot.ok, label + ': map, fog, grid and the effect did not all turn together by ' + want + ' on the Player: ' + JSON.stringify(shot.last));
    // The picture layer is built when a picture first shows; where it exists, it sits on body.
    const upright = await player.evaluate(`(() => { const pic = document.getElementById('tv-picture'), fade = document.getElementById('scene-fade');
      return { pic: !pic || (pic.parentElement === document.body && !pic.closest('.seat-turned')),
               fade: !!fade && fade.parentElement === document.body }; })()`);
    rig.check(upright.pic && upright.fade, label + ': a TV picture or the scene cover sits inside the turned stack');
    const video = await player.evaluate(`(() => { const v = document.querySelector('#canvas-container > video');
      return v ? getComputedStyle(v).visibility : 'none'; })()`);
    rig.check(video === 'hidden' || video === 'none', label + ': the Player\'s own <video> shows unturned under the map: ' + video);
  }
  await tile(0);
  await turnIs(player, 0);

  // ── 7b. the ping keeps its size ──────────────────────────────────────────
  // RED ON: _drawPing handed mapAreaSize().h again instead of container.clientHeight (ping.js) - 2026-10-17
  await player.evaluate(`globalThis.__fitH = []; const o = _drawPing; _drawPing = function (c, p, t, H) { __fitH.push(H); return o.apply(this, arguments); }; 0`);
  const pingH = async () => {
    await player.evaluate('__fitH.length = 0; 0');
    await dm.evaluate('pingAt(500, 700); 0');
    const hs = await lib.poll(async () => { const a = await player.evaluate('__fitH.slice()'); return a.length ? { a } : null; }, 8000);
    return hs ? hs.a[0] : -1;
  };
  const hOff = await pingH();
  await tile(2);
  await turnIs(player, 90);
  const hFit = await pingH();
  const ch = await player.evaluate('container.clientHeight');
  rig.check(hOff === ch && hFit === ch, 'the ping is sized from ' + hOff + ' unturned and ' + hFit + ' turned, not the screen height ' + ch + ' both times');

  // ── 8. the minimap ───────────────────────────────────────────────────────
  // RED ON: _drawHalf's place() rotation zeroed (minimap.js) - 2026-10-17
  await lib.settle(dm, '!minimapDirty', 8000);
  const mmProbe = async () => {
    const pw = await player.evaluate('container.clientWidth'), ph = await player.evaluate('container.clientHeight');
    const mm = await dm.evaluate('({ w: _canvas.width, h: _canvas.height })');
    const out = {};
    for (const k in QUAD) {
      const c = await player.evaluate('__fitClient(' + QUAD[k][0] + ',' + QUAD[k][1] + ')');
      const px = await dm.evaluate('__fitMmPx(' + (c.x * mm.w / pw) + ',' + (c.y * mm.h / ph) + ')');
      out[k] = Math.round(Math.hypot(px[0] - QUAD[k][2], px[1] - QUAD[k][3], px[2] - QUAD[k][4]));
    }
    return out;
  };
  let mmLast = null;
  const mmOk = await lib.poll(async () => {
    await dm.evaluate('minimapDirty = true; scheduleRender(); 0');
    await lib.settle(dm, '!minimapDirty', 4000);
    mmLast = await mmProbe();
    return Object.values(mmLast).every(d => d < 70) ? { ok: 1 } : null;
  }, 15000, 400);
  rig.check(!!mmOk, 'the minimap picture is not the TV turned: distance of each quadrant probe from its colour ' + JSON.stringify(mmLast));

  // RED ON: the minimap drag left unturned through the fit (minimap.js) - 2026-10-17
  const drag = await dm.evaluate('__fitDrag()');
  rig.check(Math.abs(drag.dx) < 1 && drag.dy > 5,
            'at turn 90 a drag to the right on the minimap moved the view ' + JSON.stringify(drag) + ', not the way the hand went');

  // The players' own hands on the TV: a drag carries the map with it and the wheel zooms about the pointer.
  // RED ON: the Player's pan delta left unturned and its wheel anchor read from the rect (player.js) - 2026-10-17
  const hands = await player.evaluate(`(() => {
    const a = __fitClient(500, 1000);
    const ev = (t, x, y, tgt) => (tgt || container).dispatchEvent(new MouseEvent(t, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }));
    ev('mousedown', a.x, a.y); ev('mousemove', a.x + 40, a.y + 10); ev('mouseup', a.x + 40, a.y + 10, window);
    const b = __fitClient(500, 1000);
    const z0 = zoom;
    container.dispatchEvent(new WheelEvent('wheel', { clientX: b.x, clientY: b.y, deltaY: -100, bubbles: true, cancelable: true }));
    const c = __fitClient(500, 1000);
    return { dx: b.x - a.x, dy: b.y - a.y, zoomed: zoom > z0, drift: Math.hypot(c.x - b.x, c.y - b.y) };
  })()`);
  rig.check(Math.abs(hands.dx - 40) < 1.5 && Math.abs(hands.dy - 10) < 1.5,
            'at fit 90 a drag of 40,10 on the TV moved the map ' + hands.dx.toFixed(1) + ',' + hands.dy.toFixed(1) + ', not with the hand');
  rig.check(hands.zoomed && hands.drift < 1.5,
            'at fit 90 the wheel on the TV did not zoom about the pointer: the point under it moved ' + hands.drift.toFixed(1) + 'px');

  // RED ON: regionSwaps gated on the seat alone (viewport.js), and the minimap-zoom swap in toolbar.js forced off - 2026-10-17
  await dm.evaluate('__fitPick(90); 0');
  await tile(1);
  await turnIs(player, 270);
  const st90 = await tvState();
  await dm.evaluate('applyCamera({ mapCX: 500, mapCY: 1000, zoom: 1 }); viewportDirty = true; document.getElementById("btn-sync-view").click(); 0');
  const sv = await dm.evaluate('({ r: dmVisibleRegion(), a: mapAreaSize(), pw: playerScreenW, ph: playerScreenH, mz: minimapView.zoom })');
  rig.check(st90.seat === 90 && st90.fit.turn === 270, 'the setup for seat 90 with fit 270 is wrong: ' + JSON.stringify(st90));
  rig.check(Math.abs(sv.r.viewW - sv.a.w) < 2 && Math.abs(sv.r.viewH - sv.a.h) < 2,
            'Sync View swapped the region although the laptop and the TV both lie sideways: ' + JSON.stringify(sv.r));
  const pv = await player.evaluate('getViewportSize()');
  const wantZ = Math.min(pv.w / sv.r.viewW, pv.h / sv.r.viewH);
  const landed = await lib.poll(async () => {
    const c = await player.evaluate('({ cam: captureCamera(), lerp: viewLerpActive })');
    return !c.lerp && Math.abs(c.cam.zoom - wantZ) < wantZ * 0.03 && Math.abs(c.cam.mapCX - 500) < 6 && Math.abs(c.cam.mapCY - 1000) < 6 ? { c } : null;
  }, 15000);
  rig.check(!!landed, 'Sync View at seat 90 with fit 270 did not frame the TV as the laptop is framed, wanted zoom ' + wantZ.toFixed(3));
  const wantMz = Math.min(sv.ph / sv.r.viewW, sv.pw / sv.r.viewH);
  rig.check(Math.abs(sv.mz - wantMz) < wantMz * 0.03, 'the minimap frame did not take the turned TV\'s zoom after Sync View: ' + sv.mz.toFixed(3) + ', wanted ' + wantMz.toFixed(3));

  // ── 12. Manual mode: a turn waits for Send and arrives with the pending reveal ───
  // RED BY DESIGN: written against item 217, never re-proved
  await dm.evaluate('document.getElementById("btn-auto-sync").click(); 0');
  rig.check(await dm.evaluate('autoSync === false'), 'Manual mode did not switch on');
  await dm.evaluate('revealCircle(500, 1950, 150); rebuildFogEffect(); fogDirty = true; scheduleAutoSync(); 0');
  rig.check(await dm.evaluate('playerUnsent === true'), 'a reveal in Manual mode did not wait for Send');
  const tvFog = 'fogDataCtx.getImageData(Math.round(500 / FOG_SCALE), Math.round(1950 / FOG_SCALE), 1, 1).data[3]';
  await tile(0);
  await lib.hold(1200, 'long enough for a turn that wrongly went out at once to reach the Player');
  rig.check(await player.evaluate('seatTurn') === 270 && await player.evaluate(tvFog) > 200 && await dm.evaluate('playerUnsent === true'),
            'in Manual the turn reached the TV before Send, or the reveal did');
  await dm.evaluate('sendToPlayerNow(); 0');
  rig.check(await turnIs(player, 0), 'Send did not carry the turn to the TV');
  const sent = await lib.poll(async () => { const a = await player.evaluate(tvFog); return a < 60 ? { a } : null; }, 15000);
  rig.check(!!sent, 'Send never delivered the reveal');
  await dm.evaluate('document.getElementById("btn-auto-sync").click(); 0');

  // ── 9. the fit is kept per scene ─────────────────────────────────────────
  // RED ON: the tvFit line removed from doAutoSave (scenes.js) - 2026-10-17
  await tile(1);
  const saved = await dm.evaluate('({ step: tvFit.step, turn: tvFit.turn })');
  await turnIs(player, saved.turn);
  const stored = await lib.poll(async () => {
    const s = await dm.evaluate('sceneStore.loadScene(currentScene.id).then(s => (s && s.tvFit) || null)');
    return s && s.step === saved.step && s.turn === saved.turn ? { s } : null;
  }, 10000);
  rig.check(!!stored && saved.step === 1, 'the fit was not saved with the scene: ' + JSON.stringify(saved));

  // RED ON: tvFit not read in switchScene (sceneSwitch.js), and separately tvTurn left out of the map payload (playerWindow.js) - 2026-10-17
  await lib.openMap(rig, WIDE);
  await dm.evaluate(DM_HELPERS);
  await dm.waitFor('fogCoverT === 0', 30000, 'the wide scene cover to lift');
  const wideId = await dm.evaluate('currentScene.id');
  rig.check(await turnIs(player, 0) && (await dm.evaluate('tvFit.step')) === 0,
            'a scene with no fit came up with the previous scene\'s turn');
  const wide = await dm.evaluate('__fitState()');
  rig.check(wide.n === 3 && wide.on === 0 && !wide.disabled, 'a wide map on a wide TV does not offer all three tiles: ' + JSON.stringify(wide));
  await dm.evaluate('tvFit = { step: 1, turn: 90 }; 0');
  rig.check((await dm.evaluate('__fitState()')).on === 2, 'a saved {1, 90} does not show as the second turned tile');
  await dm.evaluate('tvFit = cleanFit({ step: 2, turn: 270 }); 0');
  rig.check((await dm.evaluate('__fitState()')).on === 1, 'an older save holding step 2 does not show as the tile with its turn');
  await dm.evaluate('tvFit = { step: 0, turn: 0 }; 0');
  await dm.evaluate('switchScene(' + JSON.stringify(tallId) + '); 0');
  await dm.waitFor('currentScene && currentScene.id === ' + JSON.stringify(tallId) + ' && fogCoverT === 0', 30000, 'the tall scene to come back');
  rig.check(await turnIs(player, saved.turn) && (await dm.evaluate('tvFit.turn')) === saved.turn,
            'switching back did not bring the tall scene\'s own fit to the TV');

  rig.byEye('whether the Player turns behind the scene cover, never in front of the old map: the rig reads the end state');
  // RED ON: tvFit not read in switchScene (sceneSwitch.js), and the doAutoSave line removed (scenes.js) - 2026-10-17
  dm = await rig.restart();
  await lib.installHelpers(dm);
  await dm.evaluate(DM_HELPERS);
  const back = await lib.poll(async () => {
    const f = await dm.evaluate('typeof tvFit !== "undefined" && currentScene ? ({ step: tvFit.step, turn: tvFit.turn }) : null');
    return f && f.step ? { f } : null;
  }, 45000);
  rig.check(!!back && back.f.step === saved.step && back.f.turn === saved.turn,
            'the fit did not survive a restart: ' + JSON.stringify(back));
  player = await rig.player();
  await lib.installHelpers(player);
  rig.check(await turnIs(player, saved.turn), 'the Player did not come up turned after a restart');

  // ── 10. two maps ─────────────────────────────────────────────────────────
  // RED BY DESIGN: the pane-tv-fit handler removed (paneRuntime.js); rewritten for item 217
  await dm.waitFor('fogCoverT === 0', 30000, 'the scene cover to lift');
  await dm.evaluate('document.getElementById("btn-two-maps").click(); 0');
  await dm.waitFor('panesActive && panes.A.ready && panes.B.ready', 180000, 'both columns to come up');
  const paneA = await rig.pane('A');
  await paneA.waitFor('typeof currentScene !== "undefined" && currentScene && !!mapOffscreen', 60000, 'column A to have the map');
  await dm.evaluate('worldMapColumnFill(' + JSON.stringify(wideId) + '); 0');
  await dm.waitFor('panes.B.sceneId === ' + JSON.stringify(wideId), 30000, 'the wide map to land in column B');
  await dm.waitFor('panes.A.ready && panes.B.ready && panes.B.mapW > 0', 60000, 'both columns to report their maps');
  const tvA = await rig.player('A');
  const tvB = await rig.player('B');
  await dm.evaluate(DM_HELPERS);
  rig.check(await turnIs(tvA, saved.turn) && await turnIs(tvB, 0),
            'the two halves did not come up with their own maps\' fits: A ' + await tvA.evaluate('seatTurn') + ', B ' + await tvB.evaluate('seatTurn'));
  // RED BY DESIGN: written against item 217, never re-proved
  await dm.evaluate('selectPane("A"); 0');
  await tile(0);
  rig.check(await turnIs(tvA, 0), 'column A\'s own turn did not step back to upright on its half');
  await tile(2);
  rig.check(await turnIs(tvA, 90), 'column A did not turn its own half');
  rig.check(await tvB.evaluate('seatTurn') === 0, 'a turn picked for column A turned column B\'s half too');
  await dm.evaluate('selectPane("B"); 0');
  await tile(1);
  rig.check(await turnIs(tvB, 270), 'column B did not turn its own half');
  rig.check(await tvA.evaluate('seatTurn') === 90, 'a turn picked for column B turned column A\'s half too');
  const halves = await dm.evaluate('_mmGeom().halves.map(h => h.scope.tvFit.turn)');
  rig.check(JSON.stringify(halves) === '[90,270]', "the minimap does not read each half's own turn: " + JSON.stringify(halves));
  await dm.evaluate('document.querySelector(`.pane-col[data-pane="B"] .pane-close`).click(); 0');
  await dm.waitFor('!panesActive', 30000, 'two-map mode to close');
};
