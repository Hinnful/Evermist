'use strict';

// tv-map-switch.js — THE TV NEVER SHOWS ONE MAP WITH ANOTHER MAP'S FOG.
//
// THE GOAL OF THIS FEATURE: while the TV is still loading a new map, the old map stays covered, and
// whatever the DM reveals meanwhile is on the TV once the new map lands.
//
// Drives src/player/playerMap.js, src/player/playerWindow.js and src/scenes/sceneSwitch.js.
//
// THE CRITERIA ARE THIS HEADER. Each check sits under its letter.
//
//   A. A reveal sent while the TV is still loading the next map never lifts the cover over the old map.
//   B. That reveal is on the TV once the new map lands.
//   C. A slow load of a map the DM already left never replaces the newer map on the TV.
//   D. Nothing is sent to the TV while the DM's own map switch is still loading.
//   E. A file or link dropped on the TV window leaves the TV on the app.
//
// ⚠ THE SLOW LOAD IS A ONE-SHOT STUB ON THE PLAYER'S Image: only the next map decode is held back,
// so the fog mask after it decodes at its normal speed.

const lib = require('../../lib');

const A_W = 1600, A_H = 1000, C_W = 1200, C_H = 800, D_W = 1000, D_H = 700;
const ROOM = { x: 600, y: 400 };

const SLOW_NEXT_IMAGE = '(() => { const Orig = Image; window.Image = function () { window.Image = Orig; const i = new Orig();' +
  ' const d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");' +
  ' Object.defineProperty(i, "src", { set(v) { setTimeout(() => d.set.call(i, v), 6000); }, get() { return d.get.call(i); } });' +
  ' return i; }; return 0; })()';

module.exports = async function tvMapSwitch(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: A_W, h: A_H, kind: 'still', name: 'tv-switch-a.png' });
  await lib.settle(dm, 'fogCoverT === 0', 30000);
  const aId = await dm.evaluate('currentScene.id');
  const player = await rig.player();
  await lib.settle(player, 'mapOffscreen && mapOffscreen.width === ' + A_W + ' && fogCoverT === 0', 30000);
  rig.check(await player.evaluate('!!(mapOffscreen && mapOffscreen.width === ' + A_W + ')'), 'setup: the TV never showed map A');

  // ── A. The cover stays shut over the old map while the next one loads ────
  // RED ON: the pending-load hold removed from applyPlayerFogOnly (playerMap.js) — 2026-11-04
  await player.evaluate(SLOW_NEXT_IMAGE);
  const mapC = await rig.fixtures.stillMap(dm, rig.fixtureDir, { w: C_W, h: C_H, name: 'tv-switch-c.png' });
  await dm.evaluate('createNewScene(' + (await rig.fixtures.asFileExpr(dm, mapC)) + ', { quiet: true })', 120000);
  await lib.settle(dm, 'currentScene && mapWidth === ' + C_W, 60000);
  const cId = await dm.evaluate('currentScene.id');
  await lib.settle(player, 'mapWidth === ' + C_W, 20000);
  await dm.evaluate('polygons = [{ id: 1, vertices: [{ x: 100, y: 100 }, { x: 1100, y: 100 },' +
    ' { x: 1100, y: 700 }, { x: 100, y: 700 }], mode: "reveal", cornerRadius: 0, name: "Big" }]; nextPolygonId = 2; ' + lib.SETTLE);
  const leak = await lib.poll(() => player.evaluate(
    '(fogCoverT < 0.5 && mapOffscreen && mapOffscreen.width === ' + A_W + ') ? { cover: fogCoverT, shown: mapOffscreen.width } : null'), 5000, 100);
  rig.check(!leak, 'the TV lifted its cover over the old map while the next one was still loading: ' + JSON.stringify(leak));

  // ── B. The reveal is on the TV once the map lands ─────────────────────────
  // RED ON: the landing applies the payload's own fog instead of the newest (playerMap.js) — 2026-11-04
  await lib.settle(player, 'mapOffscreen && mapOffscreen.width === ' + C_W + ' && fogCoverT === 0', 20000);
  const tv = await lib.poll(() => player.evaluate('(a => a < 60 ? { a } : null)((' + lib.TV_FOG + ')(' + ROOM.x + ',' + ROOM.y + '))'), 8000);
  rig.check(!!tv, 'a room revealed while the TV loaded the map is hidden on the TV after it landed: fog ' +
            await player.evaluate('(' + lib.TV_FOG + ')(' + ROOM.x + ',' + ROOM.y + ')'));

  // ── C. A slow load the DM already left never lands ────────────────────────
  // RED ON: the generation check removed from startPlayerImageMap's onload (playerMap.js) — 2026-11-04
  // Every map picture the TV draws, by its own width: the fog masks are a quarter of a map's size.
  await player.evaluate('(() => { window.__rigDrawn = []; const f = CanvasRenderingContext2D.prototype.drawImage;' +
    ' CanvasRenderingContext2D.prototype.drawImage = function (src) { if (src instanceof HTMLImageElement && [' + A_W + ',' + D_W + '].includes(src.naturalWidth))' +
    ' window.__rigDrawn.push(src.naturalWidth); return f.apply(this, arguments); }; return 0; })()');
  await player.evaluate(SLOW_NEXT_IMAGE);
  const mapD = await rig.fixtures.stillMap(dm, rig.fixtureDir, { w: D_W, h: D_H, name: 'tv-switch-d.png' });
  await dm.evaluate('createNewScene(' + (await rig.fixtures.asFileExpr(dm, mapD)) + ', { quiet: true })', 120000);
  await lib.settle(player, 'mapWidth === ' + D_W, 20000);
  await dm.evaluate('switchScene(' + JSON.stringify(aId) + ')', 60000);
  await lib.settle(player, 'window.__rigDrawn.includes(' + A_W + ') && fogCoverT === 0', 20000);
  await lib.hold(7000, 'long enough for the left map\'s slow load to have landed, then prove it did not');
  const drawn = await player.evaluate('window.__rigDrawn.slice()');
  rig.check(drawn[drawn.length - 1] === A_W, 'a slow load of a map the DM had already left replaced the newer map on the TV; maps drawn in order: ' + JSON.stringify(drawn));

  // ── D. Nothing goes out while the DM's switch is loading ─────────────────
  // RED ON: currentScene removed from canSendToPlayer (playerWindow.js) — 2026-11-04
  // Each update the TV takes, with what it carries: the switch's own map push is the one that may come.
  await player.evaluate('(() => { window.__rigUpdates = []; const f = applyFogUpdate; applyFogUpdate = function (m) {' +
    ' window.__rigUpdates.push({ t: Date.now(), map: !!m.mapUrl, scene: m.mapSceneId || null, change: !!m.sceneChange }); return f.apply(this, arguments); }; return 0; })()');
  await dm.evaluate('(() => { const orig = sceneStore.loadScene; sceneStore.loadScene = (id) => { sceneStore.loadScene = orig;' +
    ' return new Promise(r => setTimeout(r, 1500)).then(() => orig(id)); }; return 0; })()');
  await dm.evaluate('(window.__rigSwitch = switchScene(' + JSON.stringify(cId) + ')), 0');
  // Counted from the moment the open map is let go, so a send made just before the switch is not this check's.
  const t0 = await lib.poll(() => dm.evaluate('currentScene === null ? Date.now() : null'), 3000, 20);
  rig.check(!!t0, 'setup: the DM never let go of the open map during the switch');
  await dm.evaluate('sendToPlayerNow(); 0');
  // ...and up to the moment the new one is held, read the same way.
  const t1 = await lib.poll(() => dm.evaluate('currentScene !== null ? Date.now() : null'), 10000, 20);
  const stray = await player.evaluate('window.__rigUpdates.filter(u => u.t >= ' + (t0 || 0) + ' && u.t <= ' + (t1 || Date.now()) +
    ' && !(u.map && u.change && u.scene === ' + JSON.stringify(cId) + '))');
  rig.check(stray.length === 0, 'the TV received an update other than the new map while the DM\'s map switch was loading: ' + JSON.stringify(stray));
  await dm.evaluate('window.__rigSwitch');

  // ── E. A drop never navigates the TV away ─────────────────────────────────
  // RED ON: keepOnAppPages() removed from the Player window (main.js) — 2026-11-04
  // A synthetic drop never navigates, so the navigation a real drop starts is started directly.
  const fileUrl = await dm.evaluate('location.href.split("?")[0].replace(/index\\.html$/, "package.json")');
  await player.evaluate('location.href = ' + JSON.stringify(fileUrl) + '; 0').catch(() => {});
  await lib.hold(2000, 'long enough for a navigation to have replaced the page, then prove it did not');
  let still = false;
  try { still = await player.evaluate('typeof applyFogUpdate === "function" && !!mapOffscreen'); } catch (_) { still = false; }
  rig.check(still, 'a file opened in the TV window replaced the app with the raw file');
};
