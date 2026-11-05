'use strict';

// table-session.js — A TABLE SESSION, IN THE ORDER THE DM RUNS ONE.
//
// THE GOAL: a real evening works end to end. One walk-through. Runs in Russian, on two Russian-named animated
// 3110x2160 maps (the size of the DM's) with the three rooms the Dungeon Alchemist plan gives, prepared beforehand.
//
// ⚠ A STEP THAT FAILS IS A FAILED CHECK, AND THE WALK GOES ON (lib.step). A step that cannot reach its goal puts
// the app where the next step needs it by another way, so one fault is one line in the verdict and not eleven.
//
// ⚠ AFTER EVERY STEP, FROM THE FIRST ONE THE TV IS UP, THE TV SHOWS NO HIDDEN GROUND. Rooms 2 and 3 are never
// revealed on the first map, so the fog the TV holds there is read after each step (secrecy). This is the one
// criterion no step may break.
//
// THE CRITERIA ARE THIS HEADER. Each step has its checks beneath it, in the same order.
//
//   1. Open a map from its card on the Campaign.
//   2. Pan and zoom, then Show on TV. The TV follows the view and its fog stays aligned to the map. The TV's map is
//      animated and actually plays: its video frames keep coming.
//   3. Play a music track and it is playing (its time advances). Play one soundboard sound.
//   4. Reveal a room. The TV shows ground there, and the neighbouring hidden room stays fogged.
//   5. One brush stroke reveals the ground it crosses on the TV.
//   6. Ctrl+Z brings the fog back on the TV, stroke first and then the room.
//   7. Place an effect, and it reaches the TV.
//   8. Show a gallery picture on the TV, then take it off.
//   9. Open a room's notes in the Notes window.
//  10. Search jumps to a room, and finds the other map.
//  11. Switch to the second map. The TV shows it, and the first map's reveals do not carry over. Switch the music track.
//  12. A fight: open the fight table, add two monsters from the bestiary, change an HP.
//      (The fight table has no turn to advance, so "next turn" is left to the eye.)
//
// ⚠ NO TIMING CLAIMS AND NO PIXEL TOLERANCES. Every wait is a bounded state; the TV's fog is read as fogged
// (above 200) or clear (below 128), and the view as "the same place" to within a quarter of what the DM sees.

const fs = require('fs');
const path = require('path');

const lib = require('../../lib');

const MAP_1 = 'Склеп вампира', MAP_2 = 'Тронный зал';
const BRUSH = { x: 1500, y: 2090 };      // below every room, where only a brush reaches

// A 44-byte header plus 8-bit mono PCM, as music.js writes it.
function wav(seconds) {
  const rate = 8000, n = rate * seconds, buf = Buffer.alloc(44 + n);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34);
  buf.write('data', 36); buf.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) buf[44 + i] = 128 + Math.round(40 * Math.sin(i / 8));
  return buf;
}
const TRACKS = ['Битва в склепе [dQw4w9WgXcQ].wav', 'Тихий зал [aBcDeFgHiJk].wav'];
const TRACK_NAMES = ['Битва в склепе', 'Тихий зал'];

const PAGE = `
globalThis.__gaFile = (name, w, h) => new Promise(r => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.fillStyle = '#7a0f18'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#d9c9b8'; g.fillRect(w / 4, h / 4, w / 2, h / 2);
  c.toBlob(b => r(new File([b], name, { type: 'image/png' })), 'image/png');
});
globalThis.__gaPick = files => {
  const inp = document.getElementById('ga-input'), dt = new DataTransfer();
  files.forEach(f => dt.items.add(f));
  inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true }));
  return 0;
};
globalThis.__gaTile = name => Array.from(document.querySelectorAll('#ga-grid .ga-tile'))
  .find(t => t.querySelector('.ga-name').textContent === name);
globalThis.__srType = q => { const i = document.getElementById('sr-input'); i.value = q; i.dispatchEvent(new Event('input', { bubbles: true })); return 0; };
globalThis.__srKey = c => { document.getElementById('sr-input').dispatchEvent(new KeyboardEvent('keydown', { code: c, key: c, bubbles: true, cancelable: true })); return 0; };
globalThis.__srUp = () => document.body.classList.contains('searching') && getComputedStyle(document.getElementById('sr-veil')).display !== 'none';
globalThis.__srRows = () => [...document.querySelectorAll('#sr-list .sr-row')].map(r => r.querySelector('.sr-nm').textContent);
globalThis.__cbRow = name => [...document.querySelectorAll('#cb-list .cb-row')].find(r => r.querySelector('[data-f=name]').value === name);
globalThis.__cbType = (name, f, v) => {
  const inp = __cbRow(name).querySelector('[data-f=' + f + ']');
  inp.focus(); inp.value = v;
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  return 0;
};
globalThis.__cbPickTyped = typed => {
  document.getElementById('cb-add').click();
  const inp = [...document.querySelectorAll('#cb-list .cb-row')].pop().querySelector('[data-f=name]');
  inp.focus(); inp.value = typed;
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  const offered = [...document.querySelectorAll('#cb-suggest [data-i]')].map(d => d.firstChild.textContent);
  const first = document.querySelector('#cb-suggest [data-i]');
  if (first) first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  return offered;
};
0`;

// What a window is looking at, as a region of the map.
const REGION = `(() => { const s = getViewportSize(); return visibleMapRegion(panX, panY, zoom, mapWidth, mapHeight, s.w, s.h); })()`;

module.exports = async function tableSession(rig) {
  let dm = await lib.inRussian(rig);
  let player = null;
  let rooms = [];
  const ids = {};

  // ── The prep the evening starts from: two maps, each with its rooms from the floor plan ──
  await lib.step(rig, 'setup: the two prepared maps', async () => {
    ids.one = await lib.importWithPlan(rig, MAP_1);
    rooms = await lib.drawRooms(rig, 3);
    await dm.evaluate('doAutoSave()', 120000);
    ids.two = await lib.importWithPlan(rig, MAP_2);
    await lib.drawRooms(rig, 3);
    await dm.evaluate('doAutoSave()', 120000);
    await dm.evaluate(PAGE);
  });
  rig.check(rooms.length === 3 && !!ids.one && !!ids.two, 'setup: the prepared maps are not there, so the session below means nothing');
  if (rooms.length !== 3) return;
  const hiddenRooms = [rooms[1], rooms[2]];

  // The TV's fog over the rooms nobody opens, read after a step. Painted as well as sent, where the room is on the
  // TV's screen.
  const secrecy = async label => {
    if (!player) return;
    for (const r of hiddenRooms) {
      const sent = await lib.tvFog(player, r.cx, r.cy);
      // RED ON: HTMLCanvasElement.prototype.toDataURL answering a clear canvas for fogDataCanvas, so the TV is sent all ground — 2026-11-05
      rig.check(sent > 200, label + ': the TV holds clear ground inside a room that must stay hidden ("' + r.name + '", fog ' + sent + ')');
      const painted = await player.evaluate('__rigPainted(' + Math.round(r.cx) + ',' + Math.round(r.cy) + ')');
      rig.check(painted < 0 || painted > 128, label + ': the TV paints no fog over "' + r.name + '", a room that must stay hidden (' + painted + ')');
    }
  };
  const tvClear = (x, y) => lib.poll(async () => { const a = await lib.tvFog(player, x, y); return a < 128 ? { a } : null; }, 30000);
  const tvFogged = (x, y) => lib.poll(async () => { const a = await lib.tvFog(player, x, y); return a > 200 ? { a } : null; }, 30000);
  const typeInto = (id, value) => dm.evaluate(`(() => {
    const el = document.getElementById(${JSON.stringify(id)});
    el.dispatchEvent(new FocusEvent('focus')); el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new FocusEvent('blur'));
    return 0; })()`);
  const pickRoom = r => dm.evaluate('setPlaceMode("rooms"); setShape("select"); __rigClick(' + Math.round(r.cx + 150) + ',' + Math.round(r.cy + 300) + '); 0');
  const revealRoom = async r => {
    await pickRoom(r);
    await lib.settle(dm, 'selectedPolygonId === ' + r.id, 8000);
    await dm.evaluate('document.getElementById("btn-reveal").click(); 0');
  };

  // ── 1. Open a map from its card on the Campaign ───────────────────────────
  await lib.step(rig, '1: open a map from the Campaign', async () => {
    await dm.evaluate('worldMapShow(); 0');
    await lib.settle(dm, 'worldMapOpen && !_wmAnim', 30000);
    const card = '.wm-card[data-id="' + ids.one + '"]';
    await lib.settle(dm, '!!document.querySelector(' + JSON.stringify(card) + ')', 20000);
    // RED BY DESIGN: written against the feature, never re-proved
    await dm.evaluate('document.querySelector(' + JSON.stringify(card) + ').firstChild.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true })); 0');
    const opened = await lib.settle(dm, 'currentScene && currentScene.id === ' + JSON.stringify(ids.one) + ' && !worldMapOpen && fogCoverT === 0', 120000);
    rig.check(opened, '1: a double-click on the map\'s card on the Campaign did not open it');
    if (!opened) {
      await dm.evaluate('worldMapHide(); switchScene(' + JSON.stringify(ids.one) + '); 0');
      await lib.settle(dm, 'currentScene && currentScene.id === ' + JSON.stringify(ids.one) + ' && fogCoverT === 0', 120000);
    }
    rig.check(await dm.evaluate('currentScene.name') === MAP_1 && await dm.evaluate('polygons.length') === 3,
              '1: the map opened without its three rooms');
    await dm.evaluate(PAGE);
  });

  // ── 2. Pan and zoom, then Show on TV ──────────────────────────────────────
  await lib.step(rig, '2: pan, zoom and Show on TV', async () => {
    const mid = { x: (rooms[0].cx + rooms[1].cx) / 2, y: (rooms[0].cy + rooms[1].cy) / 2 };
    const z0 = await dm.evaluate('zoom');
    // The wheel zooms about the pointer, one notch at a time, until the map is well past its fit.
    for (let i = 0; i < 14 && await dm.evaluate('zoom') < z0 * 2; i++) {
      await dm.evaluate(`(() => { const r = container.getBoundingClientRect();
        container.dispatchEvent(new WheelEvent('wheel', { clientX: r.left + ${mid.x} * zoom + panX, clientY: r.top + ${mid.y} * zoom + panY,
          deltaY: -120, bubbles: true, cancelable: true })); return 0; })()`);
      await lib.settle(dm, '!viewportDirty', 8000);
    }
    // A middle-button drag brings the point between rooms 1 and 2 to the middle of the window.
    await dm.evaluate(`(() => { const r = container.getBoundingClientRect();
      const x0 = r.left + ${mid.x} * zoom + panX, y0 = r.top + ${mid.y} * zoom + panY, x1 = r.left + r.width / 2, y1 = r.top + r.height / 2;
      const ev = (type, x, y, to) => to.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 1, buttons: 4, bubbles: true, cancelable: true }));
      ev('mousedown', x0, y0, container); ev('mousemove', (x0 + x1) / 2, (y0 + y1) / 2, container); ev('mousemove', x1, y1, container); ev('mouseup', x1, y1, window);
      return 0; })()`);
    await lib.settle(dm, '!viewportDirty', 8000);
    const zoomed = await dm.evaluate('zoom');
    rig.check(zoomed > z0, '2: the wheel did not zoom the map: ' + z0 + ' → ' + zoomed);

    // RED BY DESIGN: written against the feature, never re-proved
    player = await rig.player();
    await lib.installHelpers(player);
    const there = await lib.settle(player, '!!mapOffscreen && !!mapVideo && fogCoverT === 0 && !viewLerpActive', 120000);
    rig.check(there, '2: the TV never showed the map after Show on TV');
    const follows = async () => {
      await lib.settle(player, '!viewLerpActive', 20000);
      const a = await dm.evaluate(REGION), b = await player.evaluate(REGION);
      const ok = Math.abs(a.cx - b.cx) < a.w / 4 && Math.abs(a.cy - b.cy) < a.h / 4 && b.w < lib.DM_MAP.w * 0.8;
      return { ok, a, b };
    };
    const first = await lib.poll(async () => { const f = await follows(); return f.ok ? f : null; }, 20000, 500) || await follows();
    rig.check(first.ok, '2: the TV is not looking where the DM is looking: DM ' + JSON.stringify(first.a) + ', TV ' + JSON.stringify(first.b));

    // The DM moves again and presses Sync View: the TV goes along.
    await dm.evaluate('panX -= 170; panY -= 110; viewportDirty = true; scheduleRender(); 0');
    await lib.settle(dm, '!viewportDirty', 8000);
    await dm.evaluate('document.getElementById("btn-sync-view").click(); 0');
    const again = await lib.poll(async () => { const f = await follows(); return f.ok ? f : null; }, 20000, 500) || await follows();
    rig.check(again.ok, '2: Sync View did not take the TV to where the DM moved: DM ' + JSON.stringify(again.a) + ', TV ' + JSON.stringify(again.b));

    // The TV's map plays: video frames keep arriving. A looping clip's clock wraps, so frames are counted.
    const frames = () => player.evaluate('(mapVideo && mapVideo.getVideoPlaybackQuality) ? mapVideo.getVideoPlaybackQuality().totalVideoFrames : -1');
    const f0 = await frames();
    // RED BY DESIGN: written against the feature, never re-proved
    const moving = await lib.poll(async () => { const f = await frames(); return f > f0 ? { f } : null; }, 60000, 250);
    rig.check(f0 >= 0 && !!moving, '2: the TV\'s animated map is not playing: its video frames stopped at ' + f0);
  });
  await secrecy('2');

  // ── 3. Music and one soundboard sound ─────────────────────────────────────
  await lib.step(rig, '3: music and a sound', async () => {
    const musicDir = path.join(rig.profileDir, 'music');
    fs.mkdirSync(musicDir, { recursive: true });
    for (const t of TRACKS) fs.writeFileSync(path.join(musicDir, t), wav(60));
    await dm.evaluate('dockOpen(null); document.getElementById("dock-tab-music").click(); 0');
    await lib.settle(dm, '_muTracks.length === 2', 30000);
    await dm.evaluate('_muEnsureDecks(); _muDecks.forEach(d => { d.el.muted = true; }); 0');
    const click = name => dm.evaluate(`[...document.querySelectorAll('#mu-list .mu-row')]
      .find(r => r.querySelector('.mu-row-name').textContent === ${JSON.stringify(name)}).click(); 0`);
    await click(TRACK_NAMES[0]);
    const playing = await lib.settle(dm, '_muPlaying === ' + JSON.stringify(TRACKS[0]), 30000);
    rig.check(playing, '3: the clicked track did not become the playing one (' + await dm.evaluate('_muPlaying') + ')');
    const t0 = await dm.evaluate('_muDecks[_muActive].el.currentTime');
    // RED BY DESIGN: written against the feature, never re-proved
    const advanced = await lib.poll(async () => {
      const t = await dm.evaluate('_muDecks[_muActive].el.currentTime');
      return Math.abs(t - t0) > 0.05 ? { t } : null;
    }, 30000, 200);
    rig.check(!!advanced, '3: the track is named as playing but its time never advanced');

    await dm.evaluate('dockOpen(null); document.getElementById("dock-tab-sounds").click(); 0');
    await lib.settle(dm, 'typeof _sbMaster !== "undefined" && !!_sbMaster', 30000);
    // Silent twice over: the run is muted, and the sounds go through a zero gain as well.
    await dm.evaluate(`(() => { _sbMaster.disconnect(); const z = _sbCtx.createGain(); z.gain.value = 0;
      _sbMaster.connect(z); z.connect(_sbCtx.destination); return 0; })()`);
    await dm.evaluate('document.querySelector("#sb-cols [data-file=\\"bell.mp3\\"]").click(); 0');
    // RED BY DESIGN: written against the feature, never re-proved
    const sounding = await lib.settle(dm, '(_sbPlaying["bell.mp3"] || []).length >= 1', 30000);
    rig.check(sounding, '3: a click on a soundboard sound started nothing');
    await dm.evaluate('dockOpen(null); 0');
  });
  await secrecy('3');

  // ── 4. Reveal a room ──────────────────────────────────────────────────────
  await lib.step(rig, '4: reveal a room', async () => {
    const r = rooms[0];
    await revealRoom(r);
    rig.check(await dm.evaluate('polygons.find(p => p.id === ' + r.id + ').mode') === 'reveal', '4: the Reveal button did not reveal the picked room on the DM');
    // RED ON: sendToPlayer = function () {} at the start of step 4, so no change reaches the TV — 2026-11-05
    const shown = await tvClear(r.cx, r.cy);
    rig.check(!!shown, '4: the TV still shows fog over the room the DM revealed (' + await lib.tvFog(player, r.cx, r.cy) + ')');
    rig.check(!!(await tvFogged(rooms[1].cx, rooms[1].cy)), '4: the room next to the revealed one is no longer fogged on the TV');
    // Painted through the TV's own view: the revealed room is clear and its neighbour is fogged where each is on screen.
    await lib.settle(player, '!viewportDirty && !fogDirty && !fogTransRafId', 30000);
    const on = await lib.poll(async () => {
      const a = await player.evaluate('__rigPainted(' + Math.round(r.cx) + ',' + Math.round(r.cy) + ')');
      const b = await player.evaluate('__rigPainted(' + Math.round(rooms[1].cx) + ',' + Math.round(rooms[1].cy) + ')');
      return a >= 0 && a < 128 && b > 128 ? { a, b } : null;
    }, 30000, 300);
    // RED BY DESIGN: written against the feature, never re-proved
    rig.check(!!on, '4: the fog on the TV is not over the same ground as the map: the revealed room paints ' +
      await player.evaluate('__rigPainted(' + Math.round(r.cx) + ',' + Math.round(r.cy) + ')') + ', its neighbour ' +
      await player.evaluate('__rigPainted(' + Math.round(rooms[1].cx) + ',' + Math.round(rooms[1].cy) + ')') + ' (-1 is off the TV\'s screen)');
  });
  await secrecy('4');

  // ── 5. One brush stroke ───────────────────────────────────────────────────
  await lib.step(rig, '5: a brush stroke', async () => {
    await dm.evaluate('setShape("select"); __rigClick(' + BRUSH.x + ',' + BRUSH.y + '); 0');
    await dm.evaluate('document.getElementById("btn-reveal").click(); setShape("brush"); __rigDrag(' + (BRUSH.x - 200) + ',' + BRUSH.y + ',' + (BRUSH.x + 200) + ',' + BRUSH.y + '); setShape("select"); 0');
    await dm.evaluate('scheduleRender(); 0');
    await lib.settle(dm, 'pendingBrushOps.length === 0', 30000);
    rig.check(await dm.evaluate('__rigFog(' + BRUSH.x + ',' + BRUSH.y + ')') < 128, '5: the brush stroke did not clear the ground it crossed on the DM');
    // RED BY DESIGN: written against the feature, never re-proved
    rig.check(!!(await tvClear(BRUSH.x, BRUSH.y)), '5: the ground the brush crossed is still fogged on the TV');
  });
  await secrecy('5');

  // ── 6. Ctrl+Z ─────────────────────────────────────────────────────────────
  await lib.step(rig, '6: Ctrl+Z', async () => {
    await dm.evaluate('document.activeElement && document.activeElement.blur && document.activeElement.blur(); 0');
    await dm.evaluate('__rigKey("KeyZ", { ctrlKey: true }); 0');
    // RED BY DESIGN: written against the feature, never re-proved
    rig.check(!!(await tvFogged(BRUSH.x, BRUSH.y)), '6: Ctrl+Z took the brush stroke back on the DM but the TV still shows the ground');
    rig.check(await lib.tvFog(player, rooms[0].cx, rooms[0].cy) < 128, '6: Ctrl+Z after the brush stroke fogged the revealed room too');
    await dm.evaluate('__rigKey("KeyZ", { ctrlKey: true }); 0');
    rig.check(!!(await tvFogged(rooms[0].cx, rooms[0].cy)), '6: Ctrl+Z after revealing a room did not bring its fog back on the TV');
    await revealRoom(rooms[0]);
    rig.check(!!(await tvClear(rooms[0].cx, rooms[0].cy)), '6: the room could not be revealed again after the undo');
  });
  await secrecy('6');

  // ── 7. An effect ──────────────────────────────────────────────────────────
  await lib.step(rig, '7: an effect', async () => {
    const r = rooms[0];
    await dm.evaluate('setPlaceMode("effects"); setShape("rect"); __rigDrag(' + Math.round(r.cx - 250) + ',' + Math.round(r.cy - 450) + ',' + Math.round(r.cx + 50) + ',' + Math.round(r.cy - 150) + '); 0');
    rig.check(await dm.evaluate('effects.length') === 1, '7: the effect was not placed on the DM');
    await dm.evaluate('setPlaceMode("rooms"); setShape("select"); 0');
    // RED BY DESIGN: written against the feature, never re-proved
    const arrived = await lib.settle(player, 'effects.length === 1 && !!effects[0].vertices', 30000);
    rig.check(arrived, '7: the effect never reached the TV: it holds ' + await player.evaluate('effects.length'));
  });
  await secrecy('7');

  // ── 8. A gallery picture on the TV, then off ──────────────────────────────
  await lib.step(rig, '8: a picture', async () => {
    await dm.evaluate('dockOpen("gallery"); 0');
    await dm.evaluate(`(async () => { __gaPick([await __gaFile('Письмо барона.png', 600, 800)]); return 0; })()`);
    const added = await lib.settle(dm, '_gaPics.length === 1', 30000);
    rig.check(added, '8: the picture was not added to the gallery');
    const up = () => player.evaluate(`(() => { const el = document.getElementById('tv-picture'); return !!el && el.classList.contains('up'); })()`);
    await dm.evaluate('__gaTile("Письмо барона").querySelector(".ga-th").click(); 0');
    // RED BY DESIGN: written against the feature, never re-proved
    rig.check(!!(await lib.poll(async () => (await up()) ? { up: true } : null, 30000)), '8: a click on a picture did not put it on the TV');
    await secrecy('8, picture up');
    await dm.evaluate('__gaTile("Письмо барона").querySelector(".ga-th").click(); 0');
    rig.check(!!(await lib.poll(async () => (await up()) ? null : { down: true }, 30000)), '8: a second click did not take the picture off the TV');
    await dm.evaluate('dockOpen(null); 0');
  });
  await secrecy('8');

  // ── 9. A room's notes in the Notes window ─────────────────────────────────
  await lib.step(rig, '9: a room\'s notes', async () => {
    await pickRoom(rooms[0]);
    await lib.settle(dm, 'selectedPolygonId === ' + rooms[0].id, 8000);
    await dm.evaluate('if (!nwIsOpen()) document.getElementById("dock-tab-notes").click(); 0');
    // RED BY DESIGN: written against the feature, never re-proved
    const shown = await lib.settle(dm, 'nwIsOpen() && !!document.getElementById("rp-name") && document.getElementById("rp-name").offsetParent !== null', 15000);
    rig.check(shown, '9: the Notes window did not open on the picked room');
    await typeInto('rp-name', 'Зал стражи');
    await typeInto('rp-desc', 'Двое стражников у фонтана.');
    const kept = await lib.settle(dm, 'polygons.find(p => p.id === ' + rooms[0].id + ').name === "Зал стражи" && polygons.find(p => p.id === ' + rooms[0].id + ').desc === "Двое стражников у фонтана."', 8000);
    rig.check(kept, '9: a name and a note typed in the Notes window did not reach the room');
    await dm.evaluate('nwHide(); 0');
  });
  await secrecy('9');

  // ── 10. Search ────────────────────────────────────────────────────────────
  const search = async q => {
    await dm.evaluate('__rigKey("KeyF", { ctrlKey: true }); 0');
    await lib.settle(dm, '__srUp()', 8000);
    await lib.settle(dm, '_srProgress === null', 60000);
    await dm.evaluate('__srType(' + JSON.stringify(q) + '); 0');
  };
  await lib.step(rig, '10: search', async () => {
    await dm.evaluate('setShape("select"); __rigClick(' + BRUSH.x + ',' + BRUSH.y + '); 0');
    await lib.settle(dm, 'selectedPolygonId === null', 8000);
    await search('Зал стражи');
    await dm.evaluate('__srKey("Enter"); 0');
    // RED BY DESIGN: written against the feature, never re-proved
    const jumped = await lib.settle(dm, 'selectedPolygonId === ' + rooms[0].id, 20000);
    rig.check(jumped, '10: searching for a room by its name did not pick it');
    await dm.evaluate('document.getElementById("sr-input") && document.getElementById("sr-input").dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", key: "Escape", bubbles: true })); 0');
    await lib.settle(dm, '!__srUp()', 8000);
    await search(MAP_2);
    const listed = await lib.settle(dm, '__srRows()[0] === ' + JSON.stringify(MAP_2), 20000);
    rig.check(listed, '10: searching for the other map by its name did not list it first: ' + JSON.stringify(await dm.evaluate('__srRows()')));
  });
  await secrecy('10');

  // ── 11. Switch the map, and the music ─────────────────────────────────────
  await lib.step(rig, '11: switch the map and the music', async () => {
    await player.evaluate('globalThis.__rigWas = mapVideo; 0');
    // The search is still open on the second map: Enter opens it, and Auto asks before it does.
    await dm.evaluate('__srKey("Enter"); 0');
    const asked = await lib.settle(dm, '_cdOpen', 10000);
    if (asked) await dm.evaluate('document.getElementById("cd-ok").click(); 0');
    // RED BY DESIGN: written against the feature, never re-proved
    let on = await lib.settle(dm, 'currentScene && currentScene.id === ' + JSON.stringify(ids.two) + ' && fogCoverT === 0', 120000);
    rig.check(on, '11: picking the other map in the search did not open it');
    if (!on) {
      await dm.evaluate('switchScene(' + JSON.stringify(ids.two) + '); 0');
      on = await lib.settle(dm, 'currentScene && currentScene.id === ' + JSON.stringify(ids.two) + ' && fogCoverT === 0', 120000);
    }
    // RED ON: sendToPlayer = function () {} at the start of step 11, so the second map never reaches the TV — 2026-11-05
    const tv = await lib.settle(player, '!!mapVideo && mapVideo !== globalThis.__rigWas && fogCoverT === 0 && !!mapOffscreen', 120000);
    rig.check(tv, '11: the TV did not show the second map');
    // RED BY DESIGN: written against the feature, never re-proved
    rig.check(!!(await tvFogged(rooms[0].cx, rooms[0].cy)), '11: the room revealed on the first map is clear on the second map\'s TV');
    rig.check(!!(await tvFogged(BRUSH.x, BRUSH.y)), '11: the ground brushed on the first map is clear on the second map\'s TV');
    rig.check(await dm.evaluate('__rigFog(' + Math.round(rooms[0].cx) + ',' + Math.round(rooms[0].cy) + ')') > 200 &&
              await dm.evaluate('polygons.every(p => p.mode === "shroud")'), '11: the first map\'s reveal carried over to the second map on the DM');

    await dm.evaluate('dockOpen(null); document.getElementById("dock-tab-music").click(); 0');
    await lib.settle(dm, '_muTracks.length === 2', 30000);
    await dm.evaluate(`[...document.querySelectorAll('#mu-list .mu-row')]
      .find(r => r.querySelector('.mu-row-name').textContent === ${JSON.stringify(TRACK_NAMES[1])}).click(); 0`);
    const swapped = await lib.settle(dm, '_muPlaying === ' + JSON.stringify(TRACKS[1]), 30000);
    rig.check(swapped, '11: picking the second track did not switch the music (' + await dm.evaluate('_muPlaying') + ')');
    const t0 = await dm.evaluate('_muDecks[_muActive].el.currentTime');
    const advanced = await lib.poll(async () => {
      const t = await dm.evaluate('_muDecks[_muActive].el.currentTime');
      return Math.abs(t - t0) > 0.05 ? { t } : null;
    }, 30000, 200);
    rig.check(!!advanced, '11: the second track is named as playing but its time never advanced');
    await dm.evaluate('dockOpen(null); 0');
  });
  await secrecy('11');

  // ── 12. A fight ───────────────────────────────────────────────────────────
  await lib.step(rig, '12: a fight', async () => {
    await dm.evaluate(`(() => {
      for (const [n, ac, hp] of [['Гоблин', '15', '7 (2d6)'], ['Волк', '13', '11 (2d8 + 2)']]) {
        combatAddEntry(cbState.blocks, Object.assign(combatBlankBlock('', n), { meta: 'Small humanoid', ac, hp, cr: '1/4' }));
      }
      cbSave(); return 0; })()`);
    await dm.evaluate('document.getElementById("btn-combat").click(); 0');
    const open = await lib.settle(dm, 'document.getElementById("cb-fight").style.display !== "none"', 15000);
    rig.check(open, '12: the Combat button did not open the fight table');
    const offered = await dm.evaluate('__cbPickTyped("Гоб")');
    await dm.evaluate('__cbPickTyped("Вол"); 0');
    // RED BY DESIGN: written against the feature, never re-proved
    const rows = await dm.evaluate('cbState.rows.map(r => r.name)');
    rig.check(JSON.stringify(offered) === '["Гоблин"]' && rows.join() === 'Гоблин,Волк',
              '12: two monsters picked from the bestiary did not become two rows: offered ' + JSON.stringify(offered) + ', rows ' + JSON.stringify(rows));
    await dm.evaluate('__cbType("Гоблин", "hp", "-3"); 0');
    const readHp = () => dm.evaluate('({ typed: cbState.rows.find(r => r.name === "Гоблин").hp, sum: __cbRow("Гоблин").querySelector(".sum").textContent })');
    const hp = (await lib.poll(async () => { const h = await readHp(); return h.typed === '-3' && /^4$/.test(h.sum) ? h : null; }, 15000)) || await readHp();
    rig.check(hp.typed === '-3' && /^4$/.test(hp.sum), '12: an HP typed into a row was not kept and summed: ' + JSON.stringify(hp));
    rig.byEye('12: next turn - the fight table has no turn to advance, so there is nothing to automate');
    await dm.evaluate('cbSetOpen(false); 0');
  });
  await secrecy('12');
};
