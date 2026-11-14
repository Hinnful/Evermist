'use strict';

// effects-286.js — DARKNESS, ICE, WEB AND GREASE; EDGE SQUARES ON THE GRID; ONE COLOUR PER EFFECT (BACKLOG 286).
//
// THE CRITERIA ARE THIS HEADER. Each has its check beneath it, in the same order. The grid is read off the grid's own
// canvas on each screen (the DM's grid canvas, the Player's offscreen one) with the base grid set white, so a relit
// line is the only pixel whose hue leans: ice's blue (b - r), terrain's sand and a light's yellow (r - b).
//
//   1. Ice, Web, Grease and Darkness each place, and each draws its edge on the DM and on the TV.
//   2. On the DM, a square grid's lines one step inside an ice edge are relit blue, and the middle shows the plain
//      white grid with none.
//   3. The same holds on the TV.
//   4. A light relights its edge in its own yellow, and its middle stays plain.
//   5. A picked Difficult terrain outlines in its sand, not gold; Ctrl+click into editing turns it white.
//   6. A picked light outlines in its own colour, not gold.
//   7. Ctrl+Z steps back the light, the terrain and Darkness, Darkness leaves the TV too, and redo brings it
//      back to both screens still Darkness.
//   8. On a hex grid, the DM's lines just inside an ice edge are relit and its middle stays plain.
//   9. Screenshots of the four effects on the DM and the TV, for the eye.
//  10. The four come back with their materials from the saved scene after a restart, and the backup's record of
//      the scene carries them.
//  11. The palette shows Ground, Cloud and Marks, in that order, with the materials in each; a search hides a
//      section with no match.

const path = require('path');
const lib = require('../lib');

const NAME = 'Эффекты 286';
const NEW = ['ice', 'web', 'grease', 'darkness'];
// Each shape's box in map px. The cell is the plan's 100px, so the edges sit 30px off the grid lines.
const box = (x, y) => ({ x1: x, y1: y, x2: x + 440, y2: y + 440 });
const AT = { ice: box(330, 330), web: box(930, 330), grease: box(1530, 330), darkness: box(2130, 330),
             terrain: box(330, 1130), light: box(930, 1130) };
const rect = b => '[{x:' + b.x1 + ',y:' + b.y1 + '},{x:' + b.x2 + ',y:' + b.y1 + '},{x:' + b.x2 + ',y:' + b.y2 + '},{x:' + b.x1 + ',y:' + b.y2 + '}]';
const LEAN = 40;   // the hue lean, 0..255, a relit line shows
const PLAIN = 12;  // the most a plain line may lean

// In-page readers: the strongest lean of the grid canvas over a map box, and the brightest drawn effect pixel.
const READERS = `
globalThis.__rigGridLean = (canvas, mb, sign) => {
  const g = canvas.getContext('2d');
  const x1 = Math.floor(mb.x1 * zoom + panX), y1 = Math.floor(mb.y1 * zoom + panY);
  const w = Math.max(1, Math.ceil((mb.x2 - mb.x1) * zoom)), h = Math.max(1, Math.ceil((mb.y2 - mb.y1) * zoom));
  const d = g.getImageData(x1, y1, w, h).data;
  let lean = -999, lines = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 40) continue;
    lines++;
    lean = Math.max(lean, sign * (d[i + 2] - d[i]) * d[i + 3] / 255);
  }
  return { lean: Math.round(lean), lines };
};
globalThis.__rigFxAlpha = (mb) => {
  const b = pixiEffectsLayer.getBounds(), c = pixiApp.renderer.extract.canvas(pixiEffectsLayer);
  const r = c.width / Math.max(1, b.width);
  const x1 = Math.max(0, Math.floor((mb.x1 * zoom + panX - b.x) * r)), y1 = Math.max(0, Math.floor((mb.y1 * zoom + panY - b.y) * r));
  const w = Math.max(1, Math.ceil((mb.x2 - mb.x1) * zoom * r)), h = Math.max(1, Math.ceil((mb.y2 - mb.y1) * zoom * r));
  if (x1 >= c.width || y1 >= c.height) return -1;
  const d = c.getContext('2d').getImageData(x1, y1, Math.min(w, c.width - x1), Math.min(h, c.height - y1)).data;
  let a = 0;
  for (let i = 3; i < d.length; i += 4) a = Math.max(a, d[i]);
  return a;
};
globalThis.__rigOutline = (mx, my) => {
  const sx = Math.round(mx * zoom + panX), sy = Math.round(my * zoom + panY);
  const d = cursorCtx.getImageData(sx - 2, sy - 5, 5, 11).data;
  let best = null;
  for (let i = 0; i < d.length; i += 4) if (!best || d[i + 3] > best[3]) best = [d[i], d[i + 1], d[i + 2], d[i + 3]];
  return best;
};
0`;

// The band just inside the left edge, and the middle more than a cell in from every edge.
const band = b => ({ x1: b.x1 + 3, y1: b.y1 + 40, x2: b.x1 + 18, y2: b.y2 - 40 });
const middle = b => ({ x1: b.x1 + 120, y1: b.y1 + 120, x2: b.x2 - 120, y2: b.y2 - 120 });

module.exports = async function effects286(rig) {
  await lib.importWithPlan(rig, NAME);
  let dm = rig.dm;
  await dm.evaluate(READERS);
  await dm.evaluate('gridEnabled = true; gridColor = "#ffffff"; gridOpacity = 1; gridMode = "square"; commitGridChange(); 0');

  // ── 1 ──
  await dm.evaluate('setPlaceMode("effects"); 0');
  for (const m of NEW.concat('terrain')) await dm.evaluate('setMaterial(' + JSON.stringify(m) + '); addEffect(' + rect(AT[m]) + '); 0');
  await dm.evaluate('setMaterial("light"); addLightShape(' + rect(AT.light) + '); setShape("select"); 0');
  rig.check(await dm.evaluate('effects.map(e => e.material).join()') === NEW.concat('terrain').join(),
    '1: the effects on the DM are not the five placed: ' + await dm.evaluate('effects.map(e => e.material).join()'));
  const edge = b => ({ x1: b.x1 + 2, y1: b.y1 + 150, x2: b.x1 + 12, y2: b.y2 - 150 });
  const drawn = async s => {
    const a = {};
    for (const m of NEW) a[m] = await s.evaluate('__rigFxAlpha(' + JSON.stringify(edge(AT[m])) + ')');
    return a;
  };
  const dmDrawn = await lib.poll(async () => { const a = await drawn(dm); return NEW.every(m => a[m] > 60) ? a : null; }, 20000, 500);
  rig.check(!!dmDrawn, '1: an effect draws no edge on the DM: ' + JSON.stringify(await drawn(dm)));

  const player = await rig.player();
  await lib.installHelpers(player);
  await player.evaluate(READERS);
  await lib.settle(player, '!!mapOffscreen && effects.length === 5 && lightPolys.length === 1 && !viewLerpActive', 60000);
  rig.check(await player.evaluate('effects.map(e => e.material).join()') === NEW.concat('terrain').join(),
    '1: the TV did not get the five effects: ' + await player.evaluate('effects.map(e => e.material).join()'));
  const tvDrawn = await lib.poll(async () => { const a = await drawn(player); return NEW.every(m => a[m] > 60) ? a : null; }, 20000, 500);
  rig.check(!!tvDrawn, '1: an effect draws no edge on the TV: ' + JSON.stringify(await drawn(player)));
  rig.note('edge alpha, DM ' + JSON.stringify(dmDrawn) + ', TV ' + JSON.stringify(tvDrawn));

  // ── 2..4 ──
  const relit = async (s, canvas, b, sign, label) => {
    const r = await lib.poll(async () => {
      const at = await s.evaluate('__rigGridLean(' + canvas + ', ' + JSON.stringify(band(b)) + ', ' + sign + ')');
      const mid = await s.evaluate('__rigGridLean(' + canvas + ', ' + JSON.stringify(middle(b)) + ', ' + sign + ')');
      return at.lean > LEAN && mid.lines > 0 && mid.lean <= PLAIN ? { at, mid } : null;
    }, 15000, 300);
    const at = await s.evaluate('__rigGridLean(' + canvas + ', ' + JSON.stringify(band(b)) + ', ' + sign + ')');
    const mid = await s.evaluate('__rigGridLean(' + canvas + ', ' + JSON.stringify(middle(b)) + ', ' + sign + ')');
    rig.note(label + ': edge ' + JSON.stringify(at) + ', middle ' + JSON.stringify(mid));
    return r || { at, mid, failed: true };
  };
  const verdict = (n, r, what) => {
    rig.check(r.at.lean > LEAN, n + ': ' + what + ' are not relit one step inside the edge: lean ' + r.at.lean);
    rig.check(r.mid.lines > 0, n + ': ' + what + ' show no grid at all in the middle');
    rig.check(r.mid.lean <= PLAIN, n + ': ' + what + ' are relit in the middle too: lean ' + r.mid.lean);
  };
  verdict(2, await relit(dm, 'gridCanvasEl', AT.ice, 1, 'DM ice, square'), 'the DM\'s square grid lines in ice');
  verdict(3, await relit(player, 'playerGridCanvas', AT.ice, 1, 'TV ice, square'), 'the TV\'s square grid lines in ice');
  verdict(4, await relit(dm, 'gridCanvasEl', AT.light, -1, 'DM light, square'), 'the DM\'s grid lines in a light');

  // ── 5, 6 ──
  const outline = async (b, want, label) => {
    const mx = (b.x1 + b.x2) / 2;
    const px = await lib.poll(async () => {
      const p = await dm.evaluate('__rigOutline(' + mx + ', ' + b.y1 + ')');
      return p && p[3] > 150 && want(p) ? { p } : null;
    }, 8000, 200);
    const p = px ? px.p : await dm.evaluate('__rigOutline(' + mx + ', ' + b.y1 + ')');
    rig.note(label + ' outline rgba ' + JSON.stringify(p));
    return { ok: !!px, p };
  };
  const centre = b => Math.round((b.x1 + b.x2) / 2) + ',' + Math.round((b.y1 + b.y2) / 2);
  await dm.evaluate('setShape("select"); __rigClick(' + centre(AT.terrain) + '); 0');
  await lib.settle(dm, 'selectedPolygonId === effects[4].id', 5000);
  const sand = await outline(AT.terrain, p => Math.abs(p[0] - 224) < 30 && Math.abs(p[1] - 191) < 30 && Math.abs(p[2] - 138) < 30, 'picked terrain');
  rig.check(sand.ok, '5: a picked Difficult terrain does not outline in its sand #e0bf8a: ' + JSON.stringify(sand.p));
  await dm.evaluate('__rigClick(' + centre(AT.terrain) + ', { mods: { ctrlKey: true } }); 0');
  await lib.settle(dm, 'shapeEditMode', 5000);
  const white = await outline(AT.terrain, p => p[0] > 235 && p[1] > 235 && p[2] > 235, 'editing terrain');
  rig.check(white.ok, '5: Difficult terrain in editing does not outline white: ' + JSON.stringify(white.p));
  await dm.evaluate('__rigKey("Escape"); __rigKey("Escape"); setPlaceMode("effects"); setShape("select"); 0');
  await dm.evaluate('__rigClick(' + centre(AT.light) + '); 0');
  await lib.settle(dm, 'selectedPolygonId === lightShapes[0].id', 5000);
  const lit = await outline(AT.light, p => p[0] > 235 && Math.abs(p[1] - 217) < 25 && Math.abs(p[2] - 138) < 30, 'picked light');
  rig.check(lit.ok, '6: a picked light does not outline in its own colour 255,217,138: ' + JSON.stringify(lit.p));
  await dm.evaluate('__rigKey("Escape"); __rigKey("Escape"); 0');

  // ── 7 ──
  await dm.evaluate('document.activeElement && document.activeElement.blur && document.activeElement.blur(); 0');
  await dm.evaluate('__rigKey("KeyZ", { ctrlKey: true }); 0');
  rig.check(await dm.evaluate('effects.length') === 5 && await dm.evaluate('lightShapes.length') === 0,
    '7: Ctrl+Z did not take the light back first: ' + await dm.evaluate('effects.length + " effects, " + lightShapes.length + " lights"'));
  await dm.evaluate('__rigKey("KeyZ", { ctrlKey: true }); 0');
  rig.check(await dm.evaluate('effects.map(e => e.material).join()') === 'ice,web,grease,darkness',
    '7: Ctrl+Z did not take the terrain away: ' + await dm.evaluate('effects.map(e => e.material).join()'));
  await dm.evaluate('__rigKey("KeyZ", { ctrlKey: true }); 0');
  rig.check(await dm.evaluate('effects.map(e => e.material).join()') === 'ice,web,grease',
    '7: Ctrl+Z did not take Darkness away on the DM: ' + await dm.evaluate('effects.map(e => e.material).join()'));
  rig.check(await lib.settle(player, 'effects.length === 3', 20000), '7: Ctrl+Z did not take Darkness off the TV');
  await dm.evaluate('__rigKey("KeyY", { ctrlKey: true }); 0');
  rig.check(await dm.evaluate('effects.map(e => e.material).join()') === 'ice,web,grease,darkness',
    '7: redo did not bring Darkness back: ' + await dm.evaluate('effects.map(e => e.material).join()'));
  rig.check(await lib.settle(player, 'effects.length === 4 && effects[3].material === "darkness"', 20000),
    '7: redo did not bring Darkness back to the TV');

  // ── 8 ── (after the undo checks: a grid change is an undo step of its own)
  await dm.evaluate('document.getElementById("btn-grid-hptop").click(); 0');
  // ⚠ WAIT FOR THE REDRAW, not the mode: the square grid still on the canvas passes every reading below.
  const hex = await lib.settle(dm, 'gridMode === "hex-pointy" && !gridDirty && !renderScheduled', 5000);
  rig.check(hex, '8: the grid never redrew as hexes: ' + await dm.evaluate('gridMode'));
  verdict(8, await relit(dm, 'gridCanvasEl', AT.ice, 1, 'DM ice, hex'), 'the DM\'s hex grid lines in ice');
  await dm.evaluate('document.getElementById("btn-grid-sq").click(); 0');

  // ── 9 ── The map revealed and the dock shut, so the TV shows the effects and nothing covers the DM's.
  await dm.evaluate('revealAllMap(); dockOpen(null); 0');
  await lib.settle(player, 'fogCoverT === 0 && !fogTransRafId && !viewportDirty && !fogDirty', 20000);
  const shots = [];
  for (const [s, who] of [[dm, 'dm'], [player, 'tv']]) {
    const r = await s.evaluate(`(() => { const r = container.getBoundingClientRect();
      return { x: ${AT.ice.x1 - 40} * zoom + panX + r.left, y: ${AT.ice.y1 - 40} * zoom + panY + r.top, z: zoom }; })()`);
    const file = path.join(rig.outDir, 'effects-286-' + who + '.png');
    await s.screenshot(file, { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(2320 * r.z), height: Math.round(520 * r.z) });
    shots.push(file);
  }
  rig.note('9: screenshots ' + shots.join(' and '));
  rig.byEye('9: Darkness, Ice, Web and Grease match round 4 on the DM and the TV');

  // ── 10 ──
  const sceneId = await dm.evaluate('currentScene.id');
  await dm.evaluate('scheduleAutoSave(); 0');
  const onDisk = await lib.poll(async () => {
    const got = await dm.evaluate(`(async () => {
      const s = await sceneStore.loadScene(${JSON.stringify(sceneId)});
      return s ? (s.effects || []).map(e => e.material).join() : null; })()`, 30000);
    return got === 'ice,web,grease,darkness' ? { got } : null;
  }, 60000, 500);
  rig.check(!!onDisk, '10: the four effects never reached the saved scene');
  const inBackup = await dm.evaluate(`(async () => sceneBackupMeta(await sceneStore.loadScene(${JSON.stringify(sceneId)}), 'mp4', 'video/mp4', [])
    .effects.map(e => e.material).join())()`, 30000);
  rig.check(inBackup === 'ice,web,grease,darkness', '10: the backup record of the scene does not carry the four: ' + inBackup);
  dm = await rig.restart();
  await lib.installHelpers(dm);
  await lib.settle(dm, 'currentScene && fogCoverT === 0 && mapWidth > 0', 120000);
  rig.check(await dm.evaluate('effects.map(e => e.material).join()') === 'ice,web,grease,darkness',
    '10: after a restart the effects came back as ' + await dm.evaluate('effects.map(e => e.material).join()'));

  // ── 11 ──
  await dm.evaluate('setPlaceMode("effects"); setShape("select"); document.querySelector("#mat-pick .mt-btn").click(); 0');
  const palette = () => dm.evaluate(`[...document.querySelectorAll('#mat-grid > *')].map(el =>
    el.classList.contains('mt-sec') ? '|' + el.dataset.group : el.dataset.material || '').join(' ')`);
  const all = await palette();
  rig.note('11: palette ' + all);
  rig.check(all === '|ground fire acid terrain ice web grease |cloud darkness |marks area light',
    '11: the palette is not Ground, Cloud and Marks with their materials: ' + all);
  const find = async q => {
    await dm.evaluate(`(() => { const f = document.getElementById('mat-find'); f.value = ${JSON.stringify(q)};
      f.dispatchEvent(new Event('input', { bubbles: true })); return 0; })()`);
    return palette();
  };
  const dark = await find('dark');
  rig.check(dark === '|cloud darkness', '11: searching "dark" does not leave the Cloud section alone: ' + dark);
  const gr = await find('gr');
  rig.check(gr === '|ground grease', '11: searching "gr" does not leave Ground with Grease alone: ' + gr);
};
