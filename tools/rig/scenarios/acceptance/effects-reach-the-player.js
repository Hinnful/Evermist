'use strict';

// effects-reach-the-player.js — map effects across both windows.
//
// THE CRITERIA ARE THIS HEADER. Each line below has its check directly beneath it in the code,
// in the same order. There is no separate criteria document.
//
//   A. The shape tools in Effects mode create effects, and no rooms — and the toolbar shows
//      exactly one of Rooms/Effects picked, inside a dark pill.
//   B. An effect actually paints lit lines on the DM — it is not an empty layer.
//   C. Effects ride the Auto/Manual sync gate like fog: with Auto-sync OFF a new effect is HELD
//      off the Player, and a manual Send is what puts it there.
//   D. The effect is drawn UNDER the fog on both screens, so one in an unexplored room is
//      hidden from the table for free.
//   E. Rooms and effects stay two arrays. Drawing one never appends to the other.
//   F. The grid-fire looks right on a real screen — the DM's call, not the rig's.
//
// ⚠ THE DM PIXEL READ HAPPENS BEFORE THE PLAYER OPENS. rig.player() puts the Player fullscreen,
// which covers the DM; anything the DM defers to a frame gets unreliable after that.
//
// ⚠ WAIT OUT THE SCENE COVER BEFORE READING PAINTED FOG on the Player — a fresh map arrives under
// a full-fog cover that punches nothing, so every sample reads opaque regardless.

const path = require('path');

const MAP_W = 2000, MAP_H = 1200;
// The DM reveals here, so an effect placed inside it is visible on the Player.
const CLEARING = { x: 500, y: 300, r: 260 };
// Never revealed, so an effect placed here must stay hidden behind fog.
const DARK = { x: 1500, y: 900 };
// pixiEffectsLayer holds two Meshes per effect — an additive light pass and a normal dark pass.
const PER_EFFECT = 2;

const HELPERS = `
globalThis.__rigMouse = (type, mx, my) => {
  const r = container.getBoundingClientRect();
  container.dispatchEvent(new MouseEvent(type, {
    clientX: mx * zoom + panX + r.left,
    clientY: my * zoom + panY + r.top,
    bubbles: true, cancelable: true, button: 0,
  }));
};
globalThis.__rigDrag = (x1, y1, x2, y2) => {
  __rigMouse('mousedown', x1, y1);
  __rigMouse('mousemove', (x1 + x2) / 2, (y1 + y2) / 2);
  __rigMouse('mousemove', x2, y2);
  __rigMouse('mouseup', x2, y2);
};
// ⚠ RENDER THE STAGE INTO A RENDERTEXTURE AND READ THAT. extract.pixels() with no target reads
// the default framebuffer, and PixiJS runs without preserveDrawingBuffer, so after a present that
// buffer is undefined — every sample comes back rgb(0,0,0). A RenderTexture the size of the
// viewport also keeps pixel (x,y) equal to screen (x,y).
globalThis.__rigRender = () => {
  const w = pixiApp.renderer.width, h = pixiApp.renderer.height;
  const rt = PIXI.RenderTexture.create({ width: w, height: h });
  pixiApp.renderer.render(pixiApp.stage, { renderTexture: rt, clear: true });
  const px = pixiApp.renderer.extract.pixels(rt);
  rt.destroy(true);
  return { px, w, h };
};
globalThis.__rigAt = (mx, my) => {
  const { px, w } = __rigRender();
  const x = Math.round(mx * zoom + panX), y = Math.round(my * zoom + panY);
  const i = (y * w + x) * 4;
  return { r: px[i], g: px[i + 1], b: px[i + 2], a: px[i + 3] };
};
// The brightest pixel in a map-space box — grid-fire is sparse lit lines over a faint tint, so a
// single centre sample can land between lines; the max over the box catches a line or the border.
globalThis.__rigMaxRed = (mx1, my1, mx2, my2) => {
  const { px, w, h } = __rigRender();
  const sx1 = Math.max(0, Math.round(mx1 * zoom + panX)), sy1 = Math.max(0, Math.round(my1 * zoom + panY));
  const sx2 = Math.min(w - 1, Math.round(mx2 * zoom + panX)), sy2 = Math.min(h - 1, Math.round(my2 * zoom + panY));
  let best = { r: -1, g: 0, b: 0 };
  for (let y = sy1; y <= sy2; y += 2) for (let x = sx1; x <= sx2; x += 2) {
    const i = (y * w + x) * 4;
    if (px[i] > best.r) best = { r: px[i], g: px[i + 1], b: px[i + 2] };
  }
  return best;
};
0`;

module.exports = async function effectsReachThePlayer(rig) {
  const dm = rig.dm;

  const still = await rig.fixtures.stillMap(dm, rig.fixtureDir, { w: MAP_W, h: MAP_H, name: 'rig-still.png' });
  const fileExpr = await rig.fixtures.asFileExpr(dm, still);
  await dm.evaluate('createNewScene(' + fileExpr + ')', 120000);
  await dm.waitFor('currentScene && currentScene.mapType === "image" && mapWidth === ' + MAP_W,
                   120000, 'the generated map to load on the DM');
  await dm.waitFor('!!mapOffscreen', 60000, 'the DM map surface');
  await dm.evaluate(HELPERS);

  // Grid on, so the ember relight inside effects has a grid to light and it crosses to the Player.
  await dm.evaluate('(() => { if (!gridEnabled) { gridEnabled = true; commitGridChange(); } return 0; })()');

  // Auto-sync OFF for the whole run. Pressed through the button, so this is the DM's own switch
  // and not a variable the rig poked.
  await dm.evaluate('(() => { const b = document.getElementById("btn-auto-sync");' +
                    ' if (autoSync) b.click(); return 0; })()');
  rig.check(await dm.evaluate('autoSync') === false,
            'Auto-sync would not turn off, so the rest of this scenario proves nothing');

  // ⚠ revealCircle() WRITES THE FOG DATA CANVAS AND NOTHING ELSE — no rebuild, no repaint. Left
  // there, the DM goes on rendering the fog it had before, and criterion B is read through opaque
  // fog.
  await dm.evaluate('revealCircle(' + CLEARING.x + ',' + CLEARING.y + ',' + CLEARING.r + ');' +
                    'rebuildFogEffect(); fogDirty = true; scheduleRender(); 0');

  // ── A. The shape tools in Effects mode create effects, and no rooms ────────
  await dm.evaluate('setPlaceMode("effects"); setShape("circle"); 0');
  await dm.evaluate('__rigDrag(' + CLEARING.x + ',' + CLEARING.y + ',' +
                    CLEARING.x + ',' + (CLEARING.y + 130) + '); 0');
  await dm.evaluate('setShape("rect"); 0');
  await dm.evaluate('__rigDrag(' + (DARK.x - 150) + ',' + (DARK.y - 110) + ',' +
                    (DARK.x + 150) + ',' + (DARK.y + 110) + '); 0');

  const placed = await dm.evaluate('({ effects: effects.length, rooms: polygons.length,' +
                                   ' shape: effects.map(e => e.material + ":" + e.vertices.length) })');
  rig.check(placed.effects === 2,
            'the shape tools in Effects mode did not create two effects: ' + placed.effects);
  rig.check(placed.rooms === 0,
            'drawing in Effects mode created ' + placed.rooms + ' room(s) as well — the two ' +
            'arrays are not separate');
  rig.check(JSON.stringify(placed.shape) === JSON.stringify(['fire:32', 'fire:4']),
            'the effects did not come out as a 32-sided fire circle then a 4-cornered fire ' +
            'rectangle: ' + JSON.stringify(placed.shape));

  // The switch is pick-exactly-one, and its OWN pill beside the bar is how the toolbar says so
  // (the `dm-ui` skill). A live mode with no highlight, or the switch folded back into the
  // toolbar as one more group, each break the bar's grammar without breaking any behaviour.
  const pill = await dm.evaluate(`(() => {
    const on = id => document.getElementById(id).classList.contains('active');
    const par = document.getElementById('btn-place-effects').parentElement;
    return { rooms: on('btn-place-rooms'), effects: on('btn-place-effects'),
             wrapper: par.id, inBar: !!par.closest('#toolbar-bottom') };
  })()`);
  rig.check(pill.effects && !pill.rooms,
            'the Rooms/Effects switch is not showing exactly one picked: ' + JSON.stringify(pill));
  rig.check(pill.wrapper === 'place-pill' && !pill.inBar,
            'the switch is not in its own pill outside the toolbar, so it reads as one more ' +
            'group on the bar rather than as the thing that governs it: ' + JSON.stringify(pill));

  // And the context row is ONE pill: a group inside it must draw no box of its own, or the
  // rounded-box-inside-a-rounded-box is back.
  const nested = await dm.evaluate(`(() => {
    const row = document.getElementById('context-row');
    const boxed = Array.from(row.querySelectorAll('.tb-group')).filter(g => {
      const c = getComputedStyle(g);
      return parseFloat(c.borderTopWidth) > 0 || c.backgroundColor !== 'rgba(0, 0, 0, 0)';
    }).map(g => g.id || g.className);
    return { boxed, rowBg: getComputedStyle(row).backgroundColor,
             rowH: row.getBoundingClientRect().height,
             barH: document.getElementById('toolbar-bottom').getBoundingClientRect().height };
  })()`);
  rig.check(nested.boxed.length === 0,
            'a group inside the context row draws its own box, so the pill inside a pill is ' +
            'back: ' + JSON.stringify(nested.boxed));
  rig.note('pill heights — context row ' + Math.round(nested.rowH) +
           'px, toolbar ' + Math.round(nested.barH) + 'px');
  rig.check(Math.abs(nested.rowH - nested.barH) <= 2,
            'the context row and the toolbar are different heights (' + Math.round(nested.rowH) +
            ' vs ' + Math.round(nested.barH) + 'px), which is what the nested pill looked like')

  // ── B. An effect actually paints lit lines on the DM ───────────────────────
  await dm.waitFor('typeof pumpEffects === "function"', 5000, 'the effects render path');
  await dm.waitFor('pixiEffectsLayer && pixiEffectsLayer.children.length === ' + (2 * PER_EFFECT),
                   15000, 'the DM to build graphics for both effects');
  // ⚠ WAIT OUT THE FOG BEFORE SAMPLING. revealCircle() returns at once but the fog CROSSFADES.
  await dm.waitFor('fogCoverT === 0 && fogTransRafId === null', 30000,
                   'the DM fog to finish opening the clearing');
  // Brightest pixel inside the fire circle's box vs a bare revealed patch of the same map.
  const lit  = await dm.evaluate('__rigMaxRed(' + (CLEARING.x - 130) + ',' + (CLEARING.y - 130) + ',' +
                                 (CLEARING.x + 130) + ',' + (CLEARING.y + 130) + ')');
  const bare = await dm.evaluate('__rigAt(' + (CLEARING.x + 200) + ',' + CLEARING.y + ')');
  rig.note('DM composite — brightest over the fire rgb(' + lit.r + ',' + lit.g + ',' + lit.b +
           '), bare revealed map rgb(' + bare.r + ',' + bare.g + ',' + bare.b + ')');
  rig.check(lit.r > bare.r + 20,
            'the DM shows no lit lines over the fire — the effects layer is rendering empty ' +
            '(brightest red ' + lit.r + ' over the effect vs ' + bare.r + ' on bare map)');
  rig.check(lit.r > lit.b,
            'what the DM paints over the fire is not warm: rgb(' + lit.r + ',' + lit.g +
            ',' + lit.b + ')');

  // ── C. Effects ride the Auto/Manual sync gate ──────────────────────────────
  const player = await rig.player();
  await player.waitFor('!!mapOffscreen', 45000, 'the Player to receive the map');
  await player.waitFor('fogCoverT === 0', 45000, 'the scene cover to lift on the Player');
  await player.waitFor('effects.length === 2', 20000, 'the two effects from the Player handshake');

  rig.check(await dm.evaluate('autoSync') === false, 'Auto-sync came back on before the check');
  // A third effect placed with Auto-sync OFF and nothing sent. It must NOT appear on the Player.
  await dm.evaluate('__rigDrag(' + (CLEARING.x - 200) + ',' + (CLEARING.y + 180) + ',' +
                    (CLEARING.x - 80)  + ',' + (CLEARING.y + 300) + '); 0');
  rig.check(await dm.evaluate('effects.length') === 3, 'the third effect was not placed on the DM');
  // Longer than the 300ms auto-sync debounce, so a "held" reading is the gate working, not a race.
  await rig.sleep(700);
  const held = await player.evaluate('effects.length');
  rig.check(held === 2,
            'an effect placed with Auto-sync OFF reached the Player anyway (' + held + ' of the ' +
            'held 2) — the sync gate is not holding it');
  // Now the DM sends, the way pressing Send does, and it crosses.
  await dm.evaluate('sendToPlayer(true); 0');
  try { await player.waitFor('effects.length === 3', 15000, 'the sent effect to reach the Player'); }
  catch (_) { /* the assertion below reports the real number rather than a timeout */ }
  const gotThere = await player.evaluate('({ n: effects.length, last: effects[effects.length - 1] })');
  rig.check(gotThere.n === 3,
            'a manual Send did not put the held effect on the Player (it holds ' + gotThere.n + ' of 3)');
  // Never pixels: what crossed is the shape and the material's NAME.
  rig.check(gotThere.last && gotThere.last.material === 'fire' &&
            Array.isArray(gotThere.last.vertices) && gotThere.last.vertices.length === 4 &&
            !JSON.stringify(gotThere.last).includes('data:'),
            'the effect did not cross as a vertex list plus a material name: ' +
            JSON.stringify(gotThere.last));

  // ── D. The effect is drawn UNDER the fog on both screens ───────────────────
  const dmOrder = await dm.evaluate(
    '({ effects: pixiApp.stage.getChildIndex(pixiEffectsLayer),' +
    '   fog: pixiApp.stage.getChildIndex(pixiFogLayer),' +
    '   map: pixiApp.stage.getChildIndex(pixiMapLayer) })');
  rig.check(dmOrder.map < dmOrder.effects && dmOrder.effects < dmOrder.fog,
            'the DM draws effects outside the map→effects→fog order: ' + JSON.stringify(dmOrder));

  // The Player's fog is a Canvas-2D layer ABOVE the whole PixiJS canvas (docs/DECISIONS.md), so
  // "under the fog" there means two things: the effects live in the WebGL canvas, and that canvas
  // comes first in the DOM.
  const playerOrder = await player.evaluate(`(() => {
    const ids = Array.from(container.children).map(c => c.id);
    return { ids, effectsInPixi: !!(pixiEffectsLayer && pixiEffectsLayer.children.length),
             stage: pixiApp.stage.getChildIndex(pixiEffectsLayer) < pixiApp.stage.getChildIndex(pixiFogLayer) };
  })()`);
  rig.check(playerOrder.ids.indexOf('pixi-canvas') < playerOrder.ids.indexOf('fog-canvas'),
            'the Player draws its fog under the map canvas, so an effect would sit on top of ' +
            'it: ' + JSON.stringify(playerOrder.ids));
  rig.check(playerOrder.effectsInPixi && playerOrder.stage,
            'the Player is not rendering the effects beneath its fog: ' + JSON.stringify(playerOrder));

  // And the fog really is covering the one in the dark, rather than the ordering being right over
  // ground that happens to be clear.
  const samplePainted = `((mx, my) => {
    const sx = Math.round(mx * zoom + panX), sy = Math.round(my * zoom + panY);
    const c = document.getElementById('fog-canvas');
    if (sx < 0 || sy < 0 || sx >= c.width || sy >= c.height) return -1;
    return c.getContext('2d').getImageData(sx, sy, 1, 1).data[3];
  })`;
  await player.evaluate('viewportDirty = true; scheduleRender(); 0');
  const covered = await player.evaluate(samplePainted + '(' + DARK.x + ',' + DARK.y + ')');
  rig.check(covered > 200,
            'the Player is barely painting fog over the effect in the unexplored area (alpha ' +
            covered + '), so the table can see it');

  // ── E. Rooms and effects stay two arrays ──────────────────────────────────
  await dm.evaluate('setPlaceMode("rooms"); setShape("rect"); 0');
  await dm.evaluate('__rigDrag(900, 200, 1200, 450); 0');
  const both = await dm.evaluate(
    '({ rooms: polygons.length, effects: effects.length,' +
    '   roomsAreRooms: polygons.every(p => Array.isArray(p.vertices) && !p.material),' +
    '   effectsAreEffects: effects.every(e => !!e.material && Array.isArray(e.vertices)) })');
  rig.check(both.rooms === 1 && both.effects === 3,
            'drawing a room after three effects left ' + both.rooms + ' room(s) and ' +
            both.effects + ' effect(s)');
  rig.check(both.roomsAreRooms,
            'a room in the polygons array carries a material — an effect was merged into it');
  rig.check(both.effectsAreEffects,
            'something in the effects array is not a material-carrying polygon — a room was ' +
            'merged into it');

  // ── F. The grid-fire looks right ───────────────────────────────────────────
  // Set up something worth looking at before photographing it: a broad clearing on the map's
  // coolest quarter, with an area fire and a wall of fire in it.
  await dm.evaluate('setPlaceMode("effects"); revealCircle(500, 900, 430); 0');
  await dm.evaluate('setShape("circle"); __rigDrag(380, 860, 380, 1010); 0');
  await dm.evaluate('setShape("rect"); __rigDrag(560, 990, 880, 1070); 0');
  await dm.evaluate('sendToPlayer(true); 0');
  await player.waitFor('effects.length === 5', 20000, 'the display effects to reach the Player');
  await player.evaluate('viewportDirty = true; scheduleRender(); 0');
  try { await player.waitFor(samplePainted + '(500, 900) === 0', 20000, 'the second clearing to open'); }
  catch (_) { rig.note('the display clearing had not finished opening when the shot was taken'); }
  await rig.sleep(300);   // a few flicker frames, so the shot is mid-animation

  const shot = path.join(rig.outDir, 'player-effects.png');
  await player.screenshot(shot);
  rig.note('Player screenshot: ' + shot);
  rig.byEye('whether the fire in ' + shot + ' reads as a flaming frame — the outline burning ' +
            'with flames licking off it, over a faint tint - judged live, since the motion is the ' +
            'point and a still cannot show it');
};
