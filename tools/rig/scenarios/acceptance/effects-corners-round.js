'use strict';

// effects-corners-round.js — corner rounding reaches the fire, not just the room path.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check directly beneath it, in order.
//
//   A. Rounding an effect's corners moves its fire: the flame that burned in a sharp corner is
//      gone once that corner is rounded away, while a straight edge's fire is untouched.
//   B. The rounded fire looks right — the DM's call, not the rig's.
//
// Rounding is compared BEFORE vs AFTER on the same corner, so the map's own colour under the
// corner cannot pass the check by itself — only the DROP in brightness can.

const path = require('path');

const MAP_W = 2000, MAP_H = 1200;
const CLEAR = { x: 700, y: 500, r: 430 };
// A rectangle effect well inside the clearing. Its top-left corner is the one we round away.
const RECT = { x1: 520, y1: 360, x2: 900, y2: 640 };
const RADIUS = 80;

const HELPERS = `
globalThis.__rigMouse = (type, mx, my) => {
  const r = container.getBoundingClientRect();
  container.dispatchEvent(new MouseEvent(type, {
    clientX: mx * zoom + panX + r.left, clientY: my * zoom + panY + r.top,
    bubbles: true, cancelable: true, button: 0,
  }));
};
globalThis.__rigDrag = (x1, y1, x2, y2) => {
  __rigMouse('mousedown', x1, y1); __rigMouse('mousemove', (x1+x2)/2, (y1+y2)/2);
  __rigMouse('mousemove', x2, y2); __rigMouse('mouseup', x2, y2);
};
// Sample the FIRE alone: hide the map sprite for the read, so a bright patch of map under the
// corner cannot stand in for a flame. Fog over the revealed clearing is clear, so what is left is
// the effect layer.
globalThis.__rigMaxRed = (mx1, my1, mx2, my2) => {
  const w = pixiApp.renderer.width, h = pixiApp.renderer.height;
  const rt = PIXI.RenderTexture.create({ width: w, height: h });
  pixiHideMap();
  pixiApp.renderer.render(pixiApp.stage, { renderTexture: rt, clear: true });
  pixiShowMap();
  const px = pixiApp.renderer.extract.pixels(rt); rt.destroy(true);
  const sx1=Math.max(0,Math.round(mx1*zoom+panX)), sy1=Math.max(0,Math.round(my1*zoom+panY));
  const sx2=Math.min(w-1,Math.round(mx2*zoom+panX)), sy2=Math.min(h-1,Math.round(my2*zoom+panY));
  let best=-1;
  for(let y=sy1;y<=sy2;y+=2) for(let x=sx1;x<=sx2;x+=2){ const i=(y*w+x)*4; if(px[i]>best) best=px[i]; }
  return best;
};
0`;

module.exports = async function effectsCornersRound(rig) {
  const dm = rig.dm;
  const still = await rig.fixtures.stillMap(dm, rig.fixtureDir, { w: MAP_W, h: MAP_H, name: 'rig-still.png' });
  const fileExpr = await rig.fixtures.asFileExpr(dm, still);
  await dm.evaluate('createNewScene(' + fileExpr + ')', 120000);
  await dm.waitFor('currentScene && mapWidth === ' + MAP_W, 120000, 'the map to load');
  await dm.waitFor('!!mapOffscreen', 60000, 'the DM map surface');
  await dm.evaluate(HELPERS);
  await dm.evaluate('revealCircle(' + CLEAR.x + ',' + CLEAR.y + ',' + CLEAR.r + ');' +
                    'rebuildFogEffect(); fogDirty = true; scheduleRender(); 0');
  await dm.waitFor('fogCoverT === 0 && fogTransRafId === null', 30000, 'the clearing to open');

  // Draw one rectangle effect with sharp corners.
  await dm.evaluate('setPlaceMode("effects"); setShape("rect"); 0');
  await dm.evaluate('__rigDrag(' + RECT.x1 + ',' + RECT.y1 + ',' + RECT.x2 + ',' + RECT.y2 + '); 0');
  rig.check(await dm.evaluate('effects.length') === 1, 'the rectangle effect was not created');
  await dm.waitFor('pixiEffectsLayer && pixiEffectsLayer.children.length === 2', 15000, 'the fire meshes');

  // Boxes in MAP space: one hugging the top-left corner (rounded away), one on the top edge's
  // middle (left alone). Both just inside the outline where the fire burns.
  // A small box hard against the true corner — the sliver a radius of RADIUS cuts away entirely,
  // so after rounding no fire can reach it.
  const cornerBox = [RECT.x1 + 2, RECT.y1 + 2, RECT.x1 + 22, RECT.y1 + 22];
  const midX = (RECT.x1 + RECT.x2) / 2;
  const edgeBox = [midX - 20, RECT.y1 + 4, midX + 20, RECT.y1 + 40];
  const box = b => '__rigMaxRed(' + b.join(',') + ')';

  const cornerSharp = await dm.evaluate(box(cornerBox));
  const edgeSharp   = await dm.evaluate(box(edgeBox));

  // Round the corners through the effect's own field, the path the toolbar uses.
  await dm.evaluate('(() => { const e = effects[0]; selectedPolygonId = e.id; selectedVertexIndex = -1;' +
                    ' e.cornerRadius = ' + RADIUS + '; effectsChanged(); scheduleRender(); return 0; })()');
  await dm.waitFor('effects[0].cornerRadius === ' + RADIUS, 5000, 'the radius to take');
  await rig.sleep(200);   // a couple of frames for the mesh to reload the rounded outline
  const cornerRound = await dm.evaluate(box(cornerBox));
  const edgeRound    = await dm.evaluate(box(edgeBox));

  rig.note('corner brightness sharp ' + cornerSharp + ' -> rounded ' + cornerRound +
           ';  edge sharp ' + edgeSharp + ' -> rounded ' + edgeRound);

  // ── A. Rounding moves the fire off the cut corner, leaves the straight edge burning ──
  rig.check(cornerSharp > 60,
            'the sharp corner never showed fire to begin with (' + cornerSharp + '), so the test ' +
            'proves nothing');
  rig.check(cornerRound < cornerSharp - 40,
            'rounding the corner did not take the fire with it — the fire still ignores corner ' +
            'radius (corner ' + cornerSharp + ' -> ' + cornerRound + ')');
  rig.check(edgeRound > edgeSharp - 40,
            'rounding the corners dimmed a straight edge that should have been left alone (edge ' +
            edgeSharp + ' -> ' + edgeRound + ')');

  // ── B. Looks right ──
  await dm.evaluate('selectedPolygonId = null; selectedVertexIndex = -1; drawCursor(null,null); 0');
  await rig.sleep(250);
  const shot = path.join(rig.outDir, 'rounded-effect.png');
  await dm.screenshot(shot);
  rig.note('DM screenshot: ' + shot);
  rig.byEye('whether the fire in ' + shot + ' follows the rounded corners cleanly rather than ' +
            'cutting across them');
};
