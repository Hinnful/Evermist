'use strict';

// cones-are-drawn-from-their-apex.js — the Cone tool, in both placement modes.
//
// THE CRITERIA ARE THIS HEADER. Each line below has its check directly beneath it in the code,
// in the same order. There is no separate criteria document.
//
//   A. The Cone tool is on the bar, lights up when picked, and answers to O.
//   B. A drag makes ONE cone, apex where the press landed, pointing where the drag went.
//   C. It is a D&D cone: as wide at its far end as it is long, 53.13° at the apex. This is the
//      whole reason the tool exists rather than the DM drawing a triangle by hand. The far edge
//      bows outward slightly, which must not disturb either measurement.
//   D. Straighten walls rounds the direction to 15°, and rounding it does not change the length.
//   E. The mode decides where it lands: a cone in Rooms mode is a room and paints fog, a cone in
//      Effects mode is an effect and paints none.
//   F. It is an ordinary polygon afterwards — the Select tool moves it like any other.
//
// DM-only ON PURPOSE. Nothing here needs the Player: what crosses to it is already covered by
// effects-reach-the-player, and this machine cannot reliably raise a Player window (item 39).
//
// ⚠ A DISPATCHED KEY EVENT MUST GO TO `document`. input.js registers its keydown there, and an
// event dispatched on `window` never reaches it — the check passes or fails for the wrong reason.

const MAP_W = 2000, MAP_H = 1200;
// Straight right, so the expected apex angle and width are readable by hand.
const FLAT = { x: 400, y: 300, len: 400 };
// About 20°, which must round down to 15.
const SLOPED = { x: 400, y: 700, dx: 300, dy: 110 };
// Inside a revealed clearing, so a cone effect drawn here is visible rather than under fog.
const CLEARING = { x: 1450, y: 700, r: 420 };

const HELPERS = `
globalThis.__rigMouse = (type, mx, my) => {
  const r = container.getBoundingClientRect();
  container.dispatchEvent(new MouseEvent(type, {
    clientX: mx * zoom + panX + r.left, clientY: my * zoom + panY + r.top,
    bubbles: true, cancelable: true, button: 0,
  }));
};
globalThis.__rigDrag = (x1, y1, x2, y2) => {
  __rigMouse('mousedown', x1, y1);
  __rigMouse('mousemove', (x1 + x2) / 2, (y1 + y2) / 2);
  __rigMouse('mousemove', x2, y2);
  __rigMouse('mouseup', x2, y2);
};
// A cone's own measurements, read off the committed vertices rather than off the drag — the
// press and release land on whole screen pixels, so the map-space length is never exactly what
// the scenario asked for and every check has to be relative to the shape itself.
// ⚠ THE CORNERS ARE THE FIRST AND LAST VERTEX. The far edge is a shallow arc, so everything
// between them is arc; measuring v[1] to v[2] would measure one segment of the bulge and every
// check here would pass against the wrong number.
globalThis.__rigCone = (v) => {
  const c1 = v[1], c2 = v[v.length - 1];
  const mid = { x: (c1.x + c2.x) / 2, y: (c1.y + c2.y) / 2 };
  const a = Math.atan2(c1.y - v[0].y, c1.x - v[0].x);
  const b = Math.atan2(c2.y - v[0].y, c2.x - v[0].x);
  let spread = Math.abs(a - b);
  if (spread > Math.PI) spread = 2 * Math.PI - spread;
  const length = Math.hypot(mid.x - v[0].x, mid.y - v[0].y);
  // How far the far edge bulges past the straight line between the two corners, as a fraction of
  // the length. Zero means the edge came out flat.
  // ⚠ MEASURED ALONG THE AXIS FROM THE CHORD, not as distance from the apex. A triangle's own
  // corners sit 11.8% further from the apex than the middle of a shallow arc does, so a
  // furthest-from-the-apex reading gives 11.8% for a FLAT edge and this check cannot fail.
  // ⚠ AND SCANNED, not indexed. Indexing the middle of the arc reads undefined on a three-vertex
  // cone, so the check threw instead of reporting the flat edge it exists to catch.
  const ax = (mid.x - v[0].x) / length, ay = (mid.y - v[0].y) / length;
  let sagitta = 0;
  for (let i = 1; i < v.length; i++) {
    const d = (v[i].x - mid.x) * ax + (v[i].y - mid.y) * ay;
    if (d > sagitta) sagitta = d;
  }
  return {
    apex: v[0],
    n: v.length,
    length,
    width: Math.hypot(c1.x - c2.x, c1.y - c2.y),
    spreadDeg: spread * 180 / Math.PI,
    headingDeg: Math.atan2(mid.y - v[0].y, mid.x - v[0].x) * 180 / Math.PI,
    bulge: sagitta / length,
  };
};
0`;

module.exports = async function conesAreDrawnFromTheirApex(rig) {
  const dm = rig.dm;

  const still = await rig.fixtures.stillMap(dm, rig.fixtureDir, { w: MAP_W, h: MAP_H, name: 'rig-still.png' });
  const fileExpr = await rig.fixtures.asFileExpr(dm, still);
  await dm.evaluate('createNewScene(' + fileExpr + ')', 120000);
  await dm.waitFor('currentScene && currentScene.mapType === "image" && mapWidth === ' + MAP_W,
                   120000, 'the generated map to load on the DM');
  await dm.waitFor('!!mapOffscreen', 60000, 'the DM map surface');
  await dm.evaluate(HELPERS);

  // ── A. The tool is on the bar, lights up, and answers to O ─────────────────
  await dm.evaluate('setPlaceMode("rooms"); setShape("rect"); 0');
  const btn = await dm.evaluate(`(() => {
    const b = document.getElementById('btn-cone');
    return { there: !!b, inBar: !!(b && b.closest('#toolbar-bottom')),
             cls: b ? b.className : null };
  })()`);
  rig.check(btn.there && btn.inBar,
            'the Cone tool is not a button on the toolbar: ' + JSON.stringify(btn));
  rig.check(/\btool-btn\b/.test(btn.cls || ''),
            'the Cone button is not a .tool-btn, so it will not read as one of the tools: ' + btn.cls);
  await dm.evaluate('document.getElementById("btn-cone").click(); 0');
  const picked = await dm.evaluate(`({ shape,
    lit: document.getElementById('btn-cone').classList.contains('active'),
    others: ['rect','circle','poly','brush','select']
      .filter(s => document.getElementById('btn-' + s).classList.contains('active')) })`);
  rig.check(picked.shape === 'cone' && picked.lit && picked.others.length === 0,
            'picking Cone did not leave it the one lit tool: ' + JSON.stringify(picked));
  // ⚠ document, not window — see the header.
  await dm.evaluate('setShape("rect"); document.dispatchEvent(' +
                    'new KeyboardEvent("keydown", { key: "o", bubbles: true })); 0');
  rig.check(await dm.evaluate('shape') === 'cone',
            'the O key does not pick the Cone tool, so the legend row for it is a lie');

  // ── B. One cone, apex at the press, pointing where the drag went ───────────
  await dm.evaluate('__rigDrag(' + FLAT.x + ',' + FLAT.y + ',' +
                    (FLAT.x + FLAT.len) + ',' + FLAT.y + '); 0');
  const made = await dm.evaluate('({ n: polygons.length, nv: polygons[0] && polygons[0].vertices.length })');
  rig.check(made.n === 1 && made.nv > 3,
            'a cone drag did not make exactly one room with an arc on its far edge: ' +
            JSON.stringify(made));
  const flat = await dm.evaluate('__rigCone(polygons[0].vertices)');
  rig.check(Math.abs(flat.apex.x - FLAT.x) < 2 && Math.abs(flat.apex.y - FLAT.y) < 2,
            'the apex is not where the drag started — it is at ' + JSON.stringify(flat.apex) +
            ' rather than ' + FLAT.x + ',' + FLAT.y);
  rig.check(Math.abs(flat.headingDeg) < 0.5,
            'a cone dragged straight right does not point right (' + flat.headingDeg.toFixed(2) + '°)');

  // ── C. It is a D&D cone ───────────────────────────────────────────────────
  rig.note('flat cone — length ' + flat.length.toFixed(1) + ', far width ' +
           flat.width.toFixed(1) + ', spread ' + flat.spreadDeg.toFixed(3) + '°');
  rig.check(Math.abs(flat.width - flat.length) < 1e-6,
            'the cone is not as wide at its far end as it is long (' + flat.width.toFixed(3) +
            ' wide, ' + flat.length.toFixed(3) + ' long), so it measures a different area than ' +
            "the players' own rulers");
  rig.check(Math.abs(flat.spreadDeg - 53.13010235415598) < 1e-6,
            'the cone does not open 53.13° at the apex: ' + flat.spreadDeg.toFixed(4) + '°');
  // The bow has to be THERE and has to stay SLIGHT. A flat edge reads as a paper cut-out; a deep
  // one turns the cone into a pizza slice and pushes its reach past where the DM dragged.
  rig.note('far-edge bow: ' + (flat.bulge * 100).toFixed(1) + '% of the length');
  rig.check(flat.bulge > 0.01,
            'the far edge came out flat, so the cone is a bare triangle again (bow ' +
            (flat.bulge * 100).toFixed(2) + '%)');
  rig.check(flat.bulge < 0.2,
            'the far edge bows too far — at ' + (flat.bulge * 100).toFixed(1) + '% of the length ' +
            'the cone reaches well past where the drag ended');

  // ── D. Straighten walls rounds the direction to 15° ────────────────────────
  await dm.evaluate('(() => { if (!axisLock) document.getElementById("btn-axislock").click(); return 0; })()');
  rig.check(await dm.evaluate('axisLock') === true,
            'straighten walls would not turn on, so the rest of this check proves nothing');
  await dm.evaluate('__rigDrag(' + SLOPED.x + ',' + SLOPED.y + ',' +
                    (SLOPED.x + SLOPED.dx) + ',' + (SLOPED.y + SLOPED.dy) + '); 0');
  const snapped = await dm.evaluate('__rigCone(polygons[1].vertices)');
  const rawDeg = Math.atan2(SLOPED.dy, SLOPED.dx) * 180 / Math.PI;
  rig.note('sloped cone — dragged at ' + rawDeg.toFixed(2) + '°, committed at ' +
           snapped.headingDeg.toFixed(4) + '°');
  rig.check(Math.abs(snapped.headingDeg - 15) < 1e-6,
            'straighten walls did not round a ' + rawDeg.toFixed(1) + '° drag to 15°: ' +
            snapped.headingDeg.toFixed(4) + '°');
  rig.check(Math.abs(snapped.width - snapped.length) < 1e-6,
            'rounding the direction broke the width-equals-length rule: ' +
            snapped.width.toFixed(3) + ' vs ' + snapped.length.toFixed(3));
  // The length is the drag's own, untouched by the rounding.
  rig.check(Math.abs(snapped.length - Math.hypot(SLOPED.dx, SLOPED.dy)) < 2,
            'rounding the direction also changed the length (' + snapped.length.toFixed(1) +
            ' against a drag of ' + Math.hypot(SLOPED.dx, SLOPED.dy).toFixed(1) + ')');
  await dm.evaluate('document.getElementById("btn-axislock").click(); 0');

  // ── E. The mode decides where it lands ────────────────────────────────────
  // A room cone has to paint fog. Sampled on the fog data canvas, which is what the stencil is.
  const fogAt = `((mx, my) => {
    const s = 1 / FOG_SCALE;
    return fogDataCtx.getImageData(Math.round(mx * s), Math.round(my * s), 1, 1).data[3];
  })`;
  const insideFlat = await dm.evaluate(fogAt + '(' + (FLAT.x + 200) + ',' + FLAT.y + ')');
  rig.check(insideFlat < 40,
            'a cone drawn as a REVEALED room did not clear the fog inside it (alpha ' +
            insideFlat + '), so it is a shape with no effect on the map');

  await dm.evaluate('revealCircle(' + CLEARING.x + ',' + CLEARING.y + ',' + CLEARING.r + ');' +
                    'rebuildFogEffect(); fogDirty = true; scheduleRender(); 0');
  await dm.waitFor('fogCoverT === 0 && fogTransRafId === null', 30000,
                   'the DM fog to finish opening the clearing');
  const fogBefore = await dm.evaluate('fogDataCanvas.toDataURL().length');
  await dm.evaluate('setPlaceMode("effects"); setShape("cone"); 0');
  await dm.evaluate('__rigDrag(' + (CLEARING.x - 180) + ',' + (CLEARING.y - 240) + ',' +
                    (CLEARING.x + 20) + ',' + (CLEARING.y + 180) + '); 0');
  const landed = await dm.evaluate('({ rooms: polygons.length, effects: effects.length,' +
                                   ' mat: effects[0] && effects[0].material,' +
                                   ' nv: effects[0] && effects[0].vertices.length,' +
                                   ' fog: fogDataCanvas.toDataURL().length })');
  rig.check(landed.effects === 1 && landed.rooms === 2,
            'a cone drawn in Effects mode did not land in the effects array alone: ' +
            JSON.stringify(landed));
  rig.check(landed.mat === 'fire' && landed.nv > 3,
            'the cone effect is not a fire with an arc on its far edge: ' + JSON.stringify(landed));
  rig.check(landed.fog === fogBefore,
            'drawing a cone EFFECT changed the fog stencil, which only rooms may do');
  await dm.waitFor('pixiEffectsLayer && pixiEffectsLayer.children.length === 2', 15000,
                   'the cone effect to build its two meshes');

  // ── F. It is an ordinary polygon afterwards ──────────────────────────────
  // No cone-specific editing path exists, and that is the point: the Select tool has to move it
  // exactly as it moves a rectangle.
  await dm.evaluate('setPlaceMode("rooms"); setShape("select"); 0');
  const before = await dm.evaluate('polygons[0].vertices.map(v => ({ x: v.x, y: v.y }))');
  await dm.evaluate('__rigDrag(' + (FLAT.x + 200) + ',' + FLAT.y + ',' +
                    (FLAT.x + 260) + ',' + (FLAT.y + 90) + '); 0');
  const after = await dm.evaluate('({ sel: selectedPolygonId, nv: polygons[0].vertices.length,' +
                                  '   v: polygons[0].vertices.map(v => ({ x: v.x, y: v.y })) })');
  const moved = after.v.every((v, i) => Math.abs(v.x - before[i].x - 60) < 3 &&
                                        Math.abs(v.y - before[i].y - 90) < 3);
  rig.check(after.nv === before.length && moved,
            'the Select tool did not move the whole cone as one shape: ' + JSON.stringify(after.v));
};
