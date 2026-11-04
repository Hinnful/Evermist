'use strict';

// weather.js - WEATHER PRESETS PER MAP, whole (backlog item 116).
// It drives render/weather.js, the numbers in weatherPlan.js and the shader in weatherShader.js.
//
// THE GOAL OF THIS FEATURE: the DM shows the players "it started raining" instead of saying it. A map
// carries one weather preset, picked in Map settings, drawn over the map on the TV and at a third of the
// strength on the DM's screen, never under the fog's reach and never inside a room. Every check below
// serves that sentence.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks under a marker carrying its
// letter, wherever in the file that state is cheapest to reach - which is not letter order.
//
//   A. Map settings opens on a Weather section: the preset list straight under its title, six entries
//      (No weather and five presets), then a Fog sub-header over the fog theme dropdown.
//   B. Picking a preset starts an 8 second fade on both screens; the DM draws it at a third of the TV's
//      strength. The look itself is the DM's eye.
//   C. A map keeps its preset across an app restart, and No weather leaves no field on the record.
//   D. Weather is drawn under the fog and carries none inside any room, whatever the room's fog mode, on
//      either screen; a room drawn later joins the mask the TV holds.
//   E. With two maps on, each half of the TV shows its own map's weather, and a pick lands in the
//      selected column alone.
//
// ⚠ THE DM'S MAP IS A <video> UNDER THE CANVAS, so the DM's weather is read as COVERAGE: the weather layer
// alone, rendered with every other layer hidden, and its alpha. Fair weather is the preset that proves a
// room: it has no darkness and no lightning, so inside a room the pass is exactly the map, alpha 0.
//
// ⚠ A COLUMN IS AN <IFRAME>: its weatherId is read through rig.pane, and its half of the TV through
// rig.player(id). rig.dm reads the shell, which holds no map of its own in two-map mode.

const lib = require('../../lib');

const MAP_W = 1400, MAP_H = 900;
const MAP2_W = 2000, MAP2_H = 1200;
const ROOM_SHROUD = { x1: 300, y1: 300, x2: 700, y2: 700 };
const ROOM_REVEAL = { x1: 900, y1: 400, x2: 1100, y2: 600 };
const ROOM_LATE   = { x1: 100, y1: 700, x2: 250, y2: 850 };
const OUTSIDE = { x1: 800, y1: 60, x2: 1300, y2: 260 };

const OWN_HELPERS = `
// The weather layer alone: every other layer hidden for one render, then its alpha over a map-space box.
globalThis.__rigWeatherAlpha = (x1, y1, x2, y2) => {
  const w = pixiApp.renderer.width, h = pixiApp.renderer.height;
  const hide = [pixiMapLayer, pixiEffectsLayer, pixiFogLayer, pixiGridLayer, pixiToolLayer];
  const was = hide.map(l => l.visible);
  hide.forEach(l => { l.visible = false; });
  const rt = PIXI.RenderTexture.create({ width: w, height: h });
  pixiApp.renderer.render(pixiApp.stage, { renderTexture: rt, clear: true });
  const px = pixiApp.renderer.extract.pixels(rt); rt.destroy(true);
  hide.forEach((l, i) => { l.visible = was[i]; });
  const sx1 = Math.max(0, Math.round(x1 * zoom + panX)), sy1 = Math.max(0, Math.round(y1 * zoom + panY));
  const sx2 = Math.min(w - 1, Math.round(x2 * zoom + panX)), sy2 = Math.min(h - 1, Math.round(y2 * zoom + panY));
  let max = 0, sum = 0, n = 0;
  for (let y = sy1; y <= sy2; y += 2) for (let x = sx1; x <= sx2; x += 2) {
    const a = px[(y * w + x) * 4 + 3]; if (a > max) max = a; sum += a; n++;
  }
  return { max, mean: n ? sum / n : 0, n };
};
globalThis.__rigMaskAt = (mx, my) => _wxMaskCvs && _wxMaskCvs.width > 1
  ? _wxMaskCvs.getContext('2d').getImageData(Math.round(mx / FOG_SCALE), Math.round(my / FOG_SCALE), 1, 1).data[3] : -1;
0`;

const mid = r => ({ x: (r.x1 + r.x2) / 2, y: (r.y1 + r.y2) / 2 });

module.exports = async function weatherFeature(rig) {
  let dm = rig.dm;

  await lib.openMap(rig, { w: MAP_W, h: MAP_H });
  await dm.evaluate(OWN_HELPERS);
  const sceneOne = await dm.evaluate('currentScene.id');
  await lib.settle(dm, 'fogCoverT === 0', 45000);

  // ── A. the Weather section ─────────────────────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  await dm.evaluate('dockOpen("scene"); 0');
  const layout = await dm.evaluate(`(() => {
    const sec = document.getElementById('cp-sec-fog');
    const kids = Array.from(sec.children);
    const title = sec.querySelector('.dk-sh .cp-label').textContent.trim();
    const subs = Array.from(sec.querySelectorAll('.dk-sub')).map(e => e.textContent.trim());
    const fogSub = Array.from(sec.querySelectorAll('.dk-sub')).find(e => e.textContent.trim() === 'Fog');
    const after = (a, b) => !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
    return {
      title, subs,
      listUnderTitle: kids[1] && kids[1].id === 'cp-wx-row',
      entries: Array.from(document.querySelectorAll('#cp-pop-wx [data-wx]')).map(b => b.dataset.wx),
      fogOverTheme: after(fogSub, document.getElementById('cp-fogtheme-row')),
      listBeforeFog: after(document.getElementById('cp-wx-row'), fogSub),
      label: document.getElementById('cp-wx-lbl').textContent.trim(),
    };
  })()`);
  rig.note('Weather section: ' + JSON.stringify(layout));
  rig.check(layout.title === 'Weather', 'the section is titled "' + layout.title + '", not Weather');
  rig.check(layout.listUnderTitle, 'the preset dropdown is not straight under the section title');
  rig.check(layout.entries.join() === 'none,rain,storm,snowfall,blizzard,fair',
            'the preset list holds ' + layout.entries.join() + ', not No weather and the five presets');
  rig.check(layout.listBeforeFog && layout.fogOverTheme,
            'the Fog sub-header does not sit over the fog theme dropdown, after the list');
  rig.check(layout.label === 'No weather', 'a fresh map shows "' + layout.label + '" instead of No weather');

  // Two rooms of different fog modes, so the mask is proved for every mode and not one.
  await dm.evaluate('__rigDrawRoom("shroud", ' + ROOM_SHROUD.x1 + ',' + ROOM_SHROUD.y1 + ',' + ROOM_SHROUD.x2 + ',' + ROOM_SHROUD.y2 + '); 0');
  await dm.evaluate('__rigDrawRoom("reveal", ' + ROOM_REVEAL.x1 + ',' + ROOM_REVEAL.y1 + ',' + ROOM_REVEAL.x2 + ',' + ROOM_REVEAL.y2 + '); 0');
  rig.check(await dm.evaluate('polygons.length') === 2, 'the two rooms were not drawn, so no room check below is real');

  const player = await rig.player();
  await player.waitFor('!!mapOffscreen && !!fogDataCanvas', 45000, 'the Player to receive the map');
  await player.waitFor('fogCoverT === 0', 45000, 'the scene cover to lift on the Player');
  await player.evaluate(OWN_HELPERS);

  // ── B. a pick fades in over about 8 seconds, at a third on the DM ──────────
  // RED BY DESIGN: written against the fix, never re-proved
  const startedAt = Date.now();
  await dm.evaluate('document.getElementById("cp-wx-dd").click(); 0');
  await dm.evaluate('document.querySelector("#cp-pop-wx [data-wx=fair]").click(); 0');
  rig.check(await dm.evaluate('weatherId') === 'fair', 'picking Fair weather left the DM on ' + await dm.evaluate('weatherId'));
  rig.check(await dm.evaluate('_wxPrev') === 'none', 'no fade began on the DM: the old preset is not held for the 8 seconds');
  rig.check((await dm.evaluate('document.getElementById("cp-wx-lbl").textContent')).trim() === 'Fair weather',
            'the dropdown does not say Fair weather after the pick');
  await player.waitFor('weatherId === "fair"', 20000, 'the preset to reach the Player');
  await lib.settle(dm, '!!_wxMain && _wxMain.visible', 20000);
  const strengths = await lib.poll(async () => {
    const d = await dm.evaluate('_wxMain && _wxMain.visible ? _wxMain.shader.uniforms.uStr : null');
    const p = await player.evaluate('_wxMain && _wxMain.visible ? _wxMain.shader.uniforms.uStr : null');
    return d !== null && p !== null ? { d, p } : null;
  }, 20000);
  rig.check(!!strengths && Math.abs(strengths.d - 1 / 3) < 0.01 && strengths.p === 1,
            'strength on the DM / the TV is ' + JSON.stringify(strengths) + ', not a third and 1');
  const faded = await lib.poll(async () => (await dm.evaluate('_wxPrev === null')) ? { ms: Date.now() - startedAt } : null, 20000);
  rig.note('the fade ended after ' + (faded && faded.ms) + ' ms');
  rig.check(!!faded && faded.ms > 6000 && faded.ms < 16000,
            'the fade took ' + (faded && faded.ms) + ' ms, not about 8 seconds');
  rig.byEye('Fair weather: slow sunbeams, light cloud shadows, the rare gust; the DM at a third of the TV\'s strength');
  rig.byEye('Storm: lightning flashes every 10 to 25 seconds over the downpour');

  // ── D. under the fog, and none inside any room ────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  const order = await dm.evaluate(`({
    map: pixiWorld.children.indexOf(pixiMapLayer), weather: pixiWorld.children.indexOf(pixiWeatherLayer),
    fx: pixiWorld.children.indexOf(pixiEffectsLayer), fog: pixiWorld.children.indexOf(pixiFogLayer) })`);
  rig.check(order.map < order.weather && order.weather < order.fog && order.map >= 0,
            'the DM draws weather outside the band between the map and the fog: ' + JSON.stringify(order));
  const tvOrder = await player.evaluate(`({
    world: pixiApp.stage.children.indexOf(pixiWorld), screen: pixiApp.stage.children.indexOf(pixiScreenLayer),
    inWorld: pixiWorld.children.indexOf(pixiWeatherLayer) })`);
  rig.check(tvOrder.inWorld >= 0 && tvOrder.world < tvOrder.screen,
            'the TV draws weather above its fog (the fog is in the screen layer): ' + JSON.stringify(tvOrder));

  await lib.settle(dm, '__rigMaskAt(' + mid(ROOM_SHROUD).x + ',' + mid(ROOM_SHROUD).y + ') > 200', 15000);
  const inside = await lib.poll(async () => {
    const a = await dm.evaluate('__rigWeatherAlpha(' + (ROOM_SHROUD.x1 + 60) + ',' + (ROOM_SHROUD.y1 + 60) + ',' + (ROOM_SHROUD.x2 - 60) + ',' + (ROOM_SHROUD.y2 - 60) + ')');
    return a.n > 20 ? a : null;
  }, 15000);
  const insideReveal = await dm.evaluate('__rigWeatherAlpha(' + (ROOM_REVEAL.x1 + 40) + ',' + (ROOM_REVEAL.y1 + 40) + ',' + (ROOM_REVEAL.x2 - 40) + ',' + (ROOM_REVEAL.y2 - 40) + ')');
  const outside = await dm.evaluate('__rigWeatherAlpha(' + OUTSIDE.x1 + ',' + OUTSIDE.y1 + ',' + OUTSIDE.x2 + ',' + OUTSIDE.y2 + ')');
  rig.note('weather alpha on the DM: shroud room ' + JSON.stringify(inside) + ', revealed room ' + JSON.stringify(insideReveal) + ', open ground ' + JSON.stringify(outside));
  rig.check(!!inside && inside.max <= 2, 'weather falls inside the shroud room on the DM: alpha ' + (inside && inside.max));
  rig.check(insideReveal.max <= 2, 'weather falls inside the revealed room on the DM: alpha ' + insideReveal.max);
  rig.check(outside.mean > 3, 'no weather falls on open ground, so the room checks above prove nothing: mean alpha ' + outside.mean);

  const tvMask = await lib.poll(async () => {
    const m = await player.evaluate('({ shroud: __rigMaskAt(' + mid(ROOM_SHROUD).x + ',' + mid(ROOM_SHROUD).y + '),' +
      ' reveal: __rigMaskAt(' + mid(ROOM_REVEAL).x + ',' + mid(ROOM_REVEAL).y + '), open: __rigMaskAt(1200, 150) })');
    return m.shroud > 200 ? m : null;
  }, 20000);
  rig.note('the TV\'s room mask: ' + JSON.stringify(tvMask));
  rig.check(!!tvMask && tvMask.shroud > 200 && tvMask.reveal > 200 && tvMask.open === 0,
            'the room mask the TV holds is not the rooms of every mode and nothing else: ' + JSON.stringify(tvMask));
  // A room drawn while weather is on reaches the TV's mask without a new preset.
  await dm.evaluate('__rigDrawRoom("reveal", ' + ROOM_LATE.x1 + ',' + ROOM_LATE.y1 + ',' + ROOM_LATE.x2 + ',' + ROOM_LATE.y2 + '); 0');
  const late = await lib.poll(async () => {
    const a = await player.evaluate('__rigMaskAt(' + mid(ROOM_LATE).x + ',' + mid(ROOM_LATE).y + ')');
    return a > 200 ? { a } : null;
  }, 20000);
  rig.check(!!late, 'a room drawn after the weather began never reached the TV\'s mask');

  // ── C. kept across a restart ───────────────────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  const saved = await lib.poll(async () => {
    const w = await dm.evaluate('sceneStore.loadScene("' + sceneOne + '").then(s => s ? (s.weather || null) : "missing")');
    return w === 'fair' ? { w } : null;
  }, 40000);
  rig.check(!!saved, 'the autosave never wrote the preset onto the map\'s record');
  dm = await rig.restart();
  await lib.installHelpers(dm);
  await dm.evaluate(OWN_HELPERS);
  await lib.settle(dm, 'currentScene && currentScene.id === "' + sceneOne + '" && mapWidth === ' + MAP_W, 90000);
  await lib.settle(dm, 'fogCoverT === 0', 45000);
  rig.check(await dm.evaluate('weatherId') === 'fair', 'the map came back with ' + await dm.evaluate('weatherId') + ' instead of Fair weather');
  rig.check((await dm.evaluate('document.getElementById("cp-wx-lbl").textContent')).trim() === 'Fair weather',
            'the dropdown does not show the restored preset');
  rig.check(await dm.evaluate('_wxPrev === null'), 'a map that opened with a preset fades it in instead of starting settled');

  // ── E. two maps: each half its own weather ─────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  await lib.openMap(rig, { w: MAP2_W, h: MAP2_H });
  const sceneTwo = await dm.evaluate('currentScene.id');
  await lib.installHelpers(dm);
  await dm.evaluate('document.getElementById("btn-two-maps").click(); 0');
  await dm.waitFor('panesActive && panes.A.ready && panes.B.ready', 180000, 'both columns to come up');
  await dm.evaluate('worldMapColumnFill(' + JSON.stringify(sceneOne) + '); 0');
  await dm.waitFor('panes.A.mapW > 0 && panes.B.mapW > 0', 90000, 'both columns to hold a map');
  const paneA = await rig.pane('A'), paneB = await rig.pane('B');
  const colOf = async id => (await paneA.evaluate('currentScene.id')) === id ? 'A' : 'B';
  const colOne = await colOf(sceneOne), colTwo = colOne === 'A' ? 'B' : 'A';
  const paneOne = colOne === 'A' ? paneA : paneB, paneTwo = colOne === 'A' ? paneB : paneA;
  const tvOne = await rig.player(colOne), tvTwo = await rig.player(colTwo);
  rig.check(await paneOne.evaluate('weatherId') === 'fair' && await paneTwo.evaluate('weatherId') === 'none',
            'the columns did not open each with its own map\'s weather: ' + await paneOne.evaluate('weatherId') + ' / ' + await paneTwo.evaluate('weatherId'));
  await tvOne.waitFor('weatherId === "fair"', 30000, 'the first map\'s half to hold its preset');
  rig.check(await tvTwo.evaluate('weatherId') === 'none', 'the other half shows weather it was never given');

  await dm.evaluate('selectPane("' + colTwo + '"); 0');
  await dm.evaluate('chooseWeather("rain"); 0');
  await paneTwo.waitFor('weatherId === "rain"', 15000, 'the pick to land in the selected column');
  rig.check(await paneOne.evaluate('weatherId') === 'fair', 'a pick in one column changed the other\'s weather');
  await tvTwo.waitFor('weatherId === "rain"', 30000, 'the pick to reach its own half of the TV');
  rig.check(await tvOne.evaluate('weatherId') === 'fair', 'a pick in one column reached the other half of the TV');
  rig.check((await dm.evaluate('document.getElementById("cp-wx-lbl").textContent')).trim() === 'Rain',
            'the Weather section does not show the selected column\'s preset');
  const halfMask = await lib.poll(async () => {
    const w = await tvTwo.evaluate('_wxMaskCvs ? _wxMaskCvs.width : 0');
    return w > 1 ? { w } : null;
  }, 20000);
  rig.check(!!halfMask && halfMask.w === Math.ceil(MAP2_W / 4), 'the half got no mask of its own map: ' + JSON.stringify(halfMask));
  rig.check(sceneTwo !== sceneOne, 'both columns hold one map, so the halves prove nothing');
  rig.byEye('Weather over an animated map in two-map mode does not stall the Player on the DM\'s PC');
};
