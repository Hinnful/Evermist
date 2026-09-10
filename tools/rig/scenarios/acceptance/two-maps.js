'use strict';

// two-maps.js — TWO MAPS MANAGED AT ONCE, whole.
//
// THE GOAL OF THIS FEATURE: a fight in a multi-storey building moves between floors, and every
// mini standing on the TV has to stay where it is. So two maps show at once, one Player window
// each, and neither map moves because the other was touched. Every check below serves that
// sentence.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks directly beneath it, in order.
//
//   A. The second column opens EMPTY and waits to be picked; choosing a map from the library
//      fills it, and the DM window then holds no map of its own.
//   B. The columns start at a width that fills both of them at the same height, and dragging the
//      divider re-fits each camera to its new column.
//   C. A click anywhere in a column both selects that column and acts on it, in one click.
//   D. The toolbar acts on the selected column and leaves the other alone.
//   E. The two columns hold different grid cell sizes, because a grid belongs to its scene.
//   F. ONE Player screen carries both floors, one in each half, and a reveal in a column reaches
//      its own half and not the other. Entering and leaving two-map mode REUSES that one window,
//      so whatever the DM set up on the TV - fullscreen above all - survives the switch.
//   G. The one minimap shows the selected column, repaints when it is dragged, and swaps to the
//      other column when that one is selected.
//   H. Auto sends a column's fog to its half of the Player screen without Send being pressed.
//   I. The fog controls act on the selected column, and the panel shows THAT column's settings
//      when the selection moves - colour, animation and the advanced sliders alike.
//   J. Four things only two-map mode can get wrong, each of which reads as the app working until
//      someone looks closely: a column learns the TV's resolution, the chrome adopts the column
//      it lands on, the corner-radius field reaches the selected column, and arming calibration
//      puts the DM's own panel away.
//   K. Both open maps are named where the app says what is open: the top-left button, and the
//      scene library, which marks which column each one is in.
//   L. Closing a column ends two-map mode on the map that is left, and the TV keeps showing it
//      rather than going dark.
//   M. Running one map alone behaves exactly as it did before any of this existed.
//
// ⚠ A COLUMN IS AN <IFRAME>, AND `rig.dm` REACHES THE PARENT FRAME ONLY. `polygons`, `zoom` and
// `currentScene` for a column live in that column's own JS context — `rig.pane('A')` is the only
// thing that can see them. A check written against `rig.dm` reads the parent's torn-down scene
// and passes with the app doing nothing.
//
// ⚠ THE TWO MAPS HAVE DIFFERENT ASPECT RATIOS ON PURPOSE. Section B is the default split, which
// is derived from them; on two maps of the same shape an even split passes it by accident.
//
// ⚠ THE MAP IS ANIMATED, AND EVERY ACCEPTANCE FILE'S IS. Animated is the only kind the DM
// ever uses, so a suite running on still PNGs proved the app worked in a case that never
// happens. `tableMap` (tools/rig/fixtures.js) records the clip once per run and caches it by
// size. Do not swap it back to `stillMap`; smoke.js is the one file that wants both.

const WIDE = { w: 2400, h: 1500 };   // aspect 1.60
const TALL = { w: 1200, h: 1500 };   // aspect 0.80

// A brush dab, which is the smallest gesture that both selects a column and changes it.
const HELPERS = `
globalThis.__rigMouse = (type, mx, my, onWindow) => {
  const r = container.getBoundingClientRect();
  const ev = new MouseEvent(type, {
    clientX: mx * zoom + panX + r.left, clientY: my * zoom + panY + r.top,
    bubbles: true, cancelable: true, button: 0,
  });
  (onWindow ? window : container).dispatchEvent(ev);
};
globalThis.__rigDab = (mx, my) => { __rigMouse('mousedown', mx, my); __rigMouse('mouseup', mx, my); };
globalThis.__rigFog = (mx, my) => fogDataCtx.getImageData(
  Math.round(mx / FOG_SCALE), Math.round(my / FOG_SCALE), 1, 1).data[3];
globalThis.__rigFit = () => {
  const cw = container.clientWidth, ch = container.clientHeight;
  return +(Math.min(cw / mapWidth, ch / mapHeight) * 0.95).toFixed(5);
};
0`;

module.exports = async function twoMapsFeature(rig) {
  const dm = rig.dm;

  const importMap = async (size) => {
    const map = await rig.fixtures.tableMap(dm, rig.fixtureDir, size);
    const expr = await rig.fixtures.asFileExpr(dm, map);
    await dm.evaluate('createNewScene(' + expr + ')', 180000);
    await dm.waitFor('currentScene && mapWidth === ' + size.w, 180000,
                     'the ' + size.w + 'x' + size.h + ' map to load');
    await dm.waitFor('fogCoverT === 0', 30000, 'the scene cover to lift');
    return dm.evaluate('currentScene.id');
  };

  const wideId = await importMap(WIDE);
  const tallId = await importMap(TALL);

  // ── M. one map, before anything splits ───────────────────────────────────
  // Read here rather than at the end: this is the app as it shipped, and the point of the
  // criterion is that entering and leaving returns to exactly this.
  await dm.evaluate(HELPERS);
  // A Player on the TV before anything splits, so the transition has a window to preserve.
  await rig.player();
  const soloPlayerTargetId = ((await rig.targets())
    .find(t => t.url.includes('mode=player')) || {}).id;
  rig.check(!!soloPlayerTargetId, 'no Player window was open before the split');
  await dm.evaluate('(() => { const f = document.getElementById("grid-size-num");' +
    ' f.value = 133; f.dispatchEvent(new Event("input", { bubbles: true })); return 0; })()');
  await dm.waitFor('gridSize === 133', 8000, 'the one map to take a 133px cell');
  const soloBefore = await dm.evaluate(
    '({ mapWidth, zoom: +zoom.toFixed(5), fit: __rigFit(), panes: panesActive,' +
    ' cols: document.querySelectorAll(".pane-col").length })');
  rig.check(Math.abs(soloBefore.zoom - soloBefore.fit) < 0.0005,
            'one map alone did not come up fitted to the window');
  rig.check(soloBefore.panes === false && soloBefore.cols === 0,
            'the app came up already in two-column mode');
  rig.check(soloBefore.mapWidth === TALL.w,
            'one map alone did not show the map that was just imported');

  // ── A. the second column opens empty and is filled by hand ───────────────
  await dm.evaluate('document.getElementById("btn-two-maps").click(); 0');
  await dm.waitFor('panesActive && panes.A.ready && panes.B.ready', 180000,
                   'both columns to come up');

  const paneA = await rig.pane('A');
  const paneB = await rig.pane('B');
  await paneA.waitFor('typeof currentScene !== "undefined" && currentScene && !!mapOffscreen',
                      60000, 'column A to have the map that was already open');
  // ⚠ EMPTY, AND SELECTED. A column filled with whatever map came next put a map on the TV the
  // DM never chose, and the library's next click has to land in the column that is waiting.
  rig.check(await paneB.evaluate('currentScene === null || currentScene === undefined'),
            'the second column opened with a map the DM never picked');
  rig.check(await dm.evaluate('panesSelected === "B"'),
            'the empty column is not the one the library would fill');
  rig.check((await dm.evaluate('document.getElementById("scene-dd-name").textContent'))
              .includes('Pick a map'),
            'the top-left button does not say the second column is waiting for a map');
  // ⚠ THE CHROME MUST LAND ON THE COLUMN IT SELECTED. Left showing the torn-down scene's
  // settings, the next grid nudge pushes that whole config into a column that never had it.
  rig.check(await dm.evaluate('gridSize') !== 133,
            "the panel still shows the previous map's 133px cell after the split");
  // ⚠ A COLUMN WITH NO MAP MUST NOT REPORT A CAMERA. Its triple is state.js's {0,0,1} until a
  // map loads, and the parent adopting that aims the one preview at a view no map is at.
  const mmOnEntry = await dm.evaluate('({ cx: minimapView.mapCX, z: +minimapView.zoom.toFixed(4) })');
  rig.check(!(mmOnEntry.cx === 0 && mmOnEntry.z === 1),
            'the empty column reported its default camera and the preview adopted it: ' +
            JSON.stringify(mmOnEntry));

  await dm.evaluate('loadSceneIntoSelectedPane(' + JSON.stringify(wideId) + '); 0');
  await dm.waitFor('panes.B.sceneId === ' + JSON.stringify(wideId), 30000,
                   'the picked map to land in column B');
  for (const [id, p] of [['A', paneA], ['B', paneB]]) {
    await p.waitFor('typeof currentScene !== "undefined" && currentScene && !!mapOffscreen', 60000,
                    'column ' + id + ' to have a map');
    await p.evaluate(HELPERS);
  }
  await dm.waitFor('panes.A.ready && panes.B.ready && panes.B.mapW > 0', 60000,
                   'both columns to report their maps');
  await dm.evaluate('selectPane("A"); 0');

  const sceneA = await paneA.evaluate('currentScene.id');
  const sceneB = await paneB.evaluate('currentScene.id');
  const aMapW  = await paneA.evaluate('mapWidth');
  rig.check(sceneA !== sceneB, 'both columns opened the same scene: ' + sceneA);
  rig.check([wideId, tallId].indexOf(sceneA) >= 0 && [wideId, tallId].indexOf(sceneB) >= 0,
            'a column opened a scene that was never imported');
  rig.check(await dm.evaluate('mapOffscreen === null && currentScene === null'),
            'the DM window kept its own map after handing both to the columns');
  rig.check(await dm.evaluate('document.getElementById("canvas-container").offsetParent === null'),
            "the DM window's own map area is still on screen behind the columns");

  // ── B. the split, and the divider ────────────────────────────────────────
  const wideCol = (await paneA.evaluate('mapWidth')) === WIDE.w ? 'A' : 'B';
  const colWidth = id => dm.evaluate(
    'document.querySelector(\'.pane-col[data-pane="' + id + '"]\').getBoundingClientRect().width');
  const wWide = await colWidth(wideCol);
  const wTall = await colWidth(wideCol === 'A' ? 'B' : 'A');
  const want = (WIDE.w / WIDE.h) / (WIDE.w / WIDE.h + TALL.w / TALL.h);
  const got  = wWide / (wWide + wTall);
  rig.note('default split ' + got.toFixed(3) + ', both maps at one height wants ' + want.toFixed(3));
  rig.check(Math.abs(got - want) < 0.02,
            'the columns did not open at the width that fills both maps to the same height: got ' +
            got.toFixed(3) + ', wanted ' + want.toFixed(3));

  // Each camera must FIT its own column, so the check is against that column's own arithmetic
  // rather than against a number measured before the drag.
  const fits = async (p, id) => {
    const r = await p.evaluate('({ zoom: +zoom.toFixed(5), fit: __rigFit() })');
    return rig.check(Math.abs(r.zoom - r.fit) < 0.0005,
                     'column ' + id + " did not re-fit its camera to its column: zoom " + r.zoom +
                     ' against a fit of ' + r.fit);
  };
  await dm.evaluate(`(() => {
    const row = document.getElementById('panes-row');
    const r = row.getBoundingClientRect();
    const div = document.getElementById('panes-divider');
    const at = (type, x, target) => target.dispatchEvent(new MouseEvent(type, {
      clientX: x, clientY: r.top + r.height / 2, bubbles: true, cancelable: true, button: 0 }));
    at('mousedown', div.getBoundingClientRect().left + 4, div);
    at('mousemove', r.left + r.width * 0.35, document);
    at('mouseup',   r.left + r.width * 0.35, document);
    return 0;
  })()`);
  await dm.waitFor('Math.abs(document.querySelector(\'.pane-col[data-pane="A"]\')' +
                   '.getBoundingClientRect().width / document.getElementById("panes-row")' +
                   '.getBoundingClientRect().width - 0.35) < 0.03', 10000,
                   'the divider drag to resize the columns');
  // The refit rides a message, so both columns are polled rather than read once.
  for (const [id, p] of [['A', paneA], ['B', paneB]]) {
    await p.waitFor('Math.abs(zoom - __rigFit()) < 0.0005', 10000,
                    'column ' + id + ' to re-fit after the divider moved');
  }
  await fits(paneA, 'A');
  await fits(paneB, 'B');

  // ── C. one click selects the column and acts on it ───────────────────────
  // A is selected on entry, so the dab goes into B: the same press has to do both jobs.
  // ⚠ THE TOOL HAS TO REACH THE UNSELECTED COLUMN TOO, or that first click paints with whatever
  // that column last had. This is the check that catches a tool sent only to the selected one.
  rig.check(await dm.evaluate('panesSelected === "A"'), 'the first column was not selected on entry');
  await dm.evaluate('setShape("brush"); setPaintDirection("reveal"); 0');
  await paneB.waitFor('shape === "brush" && tool === "reveal"', 5000,
                      'the brush to reach column B, which is NOT the selected one');
  await paneA.waitFor('shape === "brush" && tool === "reveal"', 5000,
                      'the brush to reach column A');
  const dabB = await paneB.evaluate('({ x: Math.round(mapWidth / 2), y: Math.round(mapHeight / 2) })');
  const fogBefore = { a: await paneA.evaluate('__rigFog(200, 200)'),
                      b: await paneB.evaluate('__rigFog(' + dabB.x + ',' + dabB.y + ')') };
  await paneB.evaluate('__rigDab(' + dabB.x + ',' + dabB.y + '); 0');
  await dm.waitFor('panesSelected === "B"', 5000, 'the click in column B to select it');
  await paneB.waitFor('__rigFog(' + dabB.x + ',' + dabB.y + ') < ' + Math.max(1, fogBefore.b - 40),
                      5000, 'the same click to reveal in column B');
  rig.check(await paneA.evaluate('__rigFog(200, 200)') === fogBefore.a,
            'a click in column B changed the fog in column A');

  // ── D. the toolbar acts on the selected column only ──────────────────────
  await paneA.evaluate('__rigDab(200, 200); 0');   // one room in each column to compare
  await dm.waitFor('panesSelected === "A"', 5000, 'the click in column A to select it');
  await dm.evaluate('document.getElementById("btn-fill-fog").click(); 0');
  await paneA.waitFor('__rigFog(200, 200) > 200', 8000, 'Shroud All to reach column A');
  rig.check(await paneB.evaluate('__rigFog(' + dabB.x + ',' + dabB.y + ')') < 200,
            'Shroud All on column A also shrouded column B');

  // ── E. a grid belongs to its scene, so the two differ ────────────────────
  const setCell = async (p, id, px) => {
    await dm.evaluate('(() => { selectPane("' + id + '");' +
      ' const f = document.getElementById("grid-size-num"); f.value = ' + px + ';' +
      ' f.dispatchEvent(new Event("input", { bubbles: true })); return 0; })()');
    await p.waitFor('gridSize === ' + px, 8000, 'column ' + id + ' to take a ' + px + 'px cell');
  };
  await setCell(paneA, 'A', 120);
  await setCell(paneB, 'B', 45);
  rig.check(await paneA.evaluate('gridSize') === 120 && await paneB.evaluate('gridSize') === 45,
            'the two columns did not keep different grid cell sizes: A ' +
            await paneA.evaluate('gridSize') + ', B ' + await paneB.evaluate('gridSize'));

  // ── F. one Player screen, a floor in each half ──────────────────────────────
  const tvA = await rig.player('A');
  const tvB = await rig.player('B');
  // ⚠ ONE WINDOW CARRIES BOTH, and that is the point of the shell: two Player windows could
  // never both be fullscreen on one TV. Counting them is what a per-half check cannot do.
  const playerWindows = (await rig.targets()).filter(t => /stage[.]html|mode=player/.test(t.url));
  rig.check(playerWindows.length === 1,
            'the Player screen is ' + playerWindows.length + ' windows, not one: ' +
            playerWindows.map(t => t.url).join(' | '));
  // ⚠ THE SAME OS WINDOW, not a fresh one. Whatever the DM set up on the TV - fullscreen above
  // all - belongs to the window, so a replaced window loses it. A CDP target id is the same
  // across a navigation and different for a new window, which is what makes this readable.
  rig.check(playerWindows[0] && playerWindows[0].id === soloPlayerTargetId,
            'entering two-map mode replaced the Player window instead of reusing it, so a ' +
            'fullscreen TV drops out of fullscreen');
  const tvAW = await tvA.evaluate('mapWidth');
  const tvBW = await tvB.evaluate('mapWidth');
  rig.check(tvAW === await paneA.evaluate('mapWidth'),
            "column A's half of the Player screen shows a " + tvAW + 'px map, not column A\'s');
  rig.check(tvBW === await paneB.evaluate('mapWidth'),
            "column B's half of the Player screen shows a " + tvBW + 'px map, not column B\'s');

  rig.check(tvAW !== tvBW, 'both halves show the same map, so nothing here proves they differ');

  // A reveal in one column, measured on both TVs. Column A is fully shrouded from section D, so
  // the dab has somewhere to land.
  const SX = 900, SY = 1200;   // clear of every other gesture in this file, and inside both maps
  const tvFog = 'fogDataCtx.getImageData(Math.round(' + SX + ' / FOG_SCALE), Math.round(' + SY +
                ' / FOG_SCALE), 1, 1).data[3]';
  await dm.evaluate('selectPane("A"); 0');
  await paneA.evaluate('__rigDab(' + SX + ',' + SY + '); 0');
  await paneA.evaluate('sendToPlayer(); 0');
  await tvA.waitFor(tvFog + ' < 120', 15000, "the reveal to reach column A's Player");
  const bAt = await tvB.evaluate('fogDataCtx ? ' + tvFog + ' : -1');
  rig.check(bAt > 120, "a reveal in column A cleared the same ground on column B's Player: " +
                       'alpha ' + bAt);

  // ── G. the one minimap follows the selection and repaints ────────────────
  // ⚠ THE PANEL HAS TO BE OPEN. A canvas inside display:none has zero-sized rects, so a drag
  // built from getBoundingClientRect lands entirely at 0,0 and moves nothing.
  await dm.evaluate('document.querySelector(`.cp-tab[data-tab="player"]`).click(); 0');
  await dm.waitFor('document.getElementById("minimap-canvas").offsetWidth > 0', 8000,
                   'the Player tab to open so the minimap has a real size');

  // ⚠ THE SIZE RIDES ALONG WITH THE PIXELS. The canvas is cleared whenever it is resized, so a
  // bare "the picture changed" comparison passes on a resize with nothing redrawn - which is
  // how three checks here passed against a minimap that never painted once.
  const mmSig = () => dm.evaluate(`(() => {
    const c = document.getElementById('minimap-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let ink = 0, h = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) ink++;
    for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) >>> 0;
    return c.width + 'x' + c.height + ':' + ink + ':' + h;
  })()`);

  await dm.evaluate('selectPane("A"); minimapSeedView(); 0');
  await rig.sleep(700);
  const mmA = await mmSig();
  rig.check(+mmA.split(':')[1] > 2000, 'the minimap is blank while two maps are open: ' + mmA);

  // The decisive one: shroud the selected column and watch the preview follow. A frozen minimap
  // cannot show this, and no resize can fake it.
  await paneA.evaluate('shroudAllRooms(); 0');
  await rig.sleep(900);
  const mmShrouded = await mmSig();
  rig.check(mmShrouded !== mmA,
            'shrouding the selected column did not change the minimap: ' + mmA + ' → ' + mmShrouded);
  await paneA.evaluate('revealAllRooms(); 0');
  await rig.sleep(700);

  await dm.evaluate('selectPane("B"); minimapSeedView(); 0');
  await rig.sleep(700);
  const mmB = await mmSig();
  rig.check(mmB !== mmA, 'the minimap shows the same picture for both columns: ' + mmB);

  await dm.evaluate('selectPane("A"); 0');
  await rig.sleep(700);
  const mmBefore = await mmSig();
  await dm.evaluate(`(() => {
    const c = document.getElementById('minimap-canvas');
    const r = c.getBoundingClientRect();
    const at = (t, x, y) => c.dispatchEvent(new PointerEvent(t, {
      clientX: x, clientY: y, pointerId: 1, bubbles: true, cancelable: true, button: 0 }));
    at('pointerdown', r.left + r.width * 0.5, r.top + r.height * 0.5);
    at('pointermove', r.left + r.width * 0.2, r.top + r.height * 0.3);
    at('pointerup',   r.left + r.width * 0.2, r.top + r.height * 0.3);
    return 0;
  })()`);
  await rig.sleep(700);
  const mmDragged = await mmSig();
  rig.check(mmDragged !== mmBefore,
            'dragging the minimap moved the Player but did not repaint the preview: ' +
            mmBefore + ' → ' + mmDragged);

  // ── H. Auto reaches the TV without Send ──────────────────────────────────
  await dm.evaluate('selectPane("A"); 0');
  await dm.evaluate(`(() => {
    const b = document.getElementById('btn-auto-sync');
    if (!b.classList.contains('active')) b.click();
    return 0;
  })()`);
  // ⚠ BOTH COLUMNS. Auto is a standing preference, not one map's setting, and sending it only
  // to the selected column leaves the other silently on Manual - which reads as "Auto is broken".
  await paneA.waitFor('autoSync === true', 8000, 'Auto to reach column A');
  await paneB.waitFor('autoSync === true', 8000, 'Auto to reach column B, which is not selected');
  const AX = 1500, AY = 400;
  const autoFog = 'fogDataCtx.getImageData(Math.round(' + AX + ' / FOG_SCALE), Math.round(' + AY +
                  ' / FOG_SCALE), 1, 1).data[3]';
  const beforeAuto = await tvA.evaluate(autoFog);
  // ⚠ NO sendToPlayer() HERE. Pressing Send would pass this check with Auto broken, which is
  // exactly the fault being covered.
  await paneA.evaluate('__rigDab(' + AX + ',' + AY + '); 0');
  await tvA.waitFor(autoFog + ' < ' + Math.max(1, beforeAuto - 40), 15000,
                    "Auto to carry the reveal to column A's half without Send");

  // ── I. the fog controls belong to the column they are aimed at ───────────
  const HEX_A = '#c04010';
  await dm.evaluate('selectPane("A"); 0');
  await dm.evaluate('(() => { const el = document.getElementById("fog-color");' +
    ' el.value = ' + JSON.stringify(HEX_A) + ';' +
    ' el.dispatchEvent(new Event("input", { bubbles: true })); return 0; })()');
  await paneA.waitFor('fogPickedHex === ' + JSON.stringify(HEX_A), 8000,
                      'the fog colour to reach column A');
  rig.check(await paneB.evaluate('fogPickedHex') !== HEX_A,
            'the fog colour set on column A also changed column B');
  // ⚠ THE TV IS THE POINT. The DM window has no Player of its own while two maps are up, so the
  // push the picker's own handler makes there reaches nothing.
  await tvA.waitFor('fogPickedHex === ' + JSON.stringify(HEX_A), 10000,
                    "the fog colour to reach column A's half of the Player screen");
  rig.check(await tvB.evaluate('fogPickedHex') !== HEX_A,
            "the fog colour set on column A also changed column B's half");

  // Animation is a SCENE setting, so turning it off on one column must leave the other running,
  // and the panel must show the column it is now aimed at rather than the one it left.
  await dm.evaluate(`(() => {
    const b = document.getElementById('btn-anim');
    if (b.classList.contains('active')) b.click();
    return 0;
  })()`);
  await paneA.waitFor('fogAnimEnabled === false', 8000, 'the animation to stop on column A');
  rig.check(await paneB.evaluate('fogAnimEnabled') === true,
            'stopping the animation on column A stopped it on column B too');

  // ⚠ THE SLIDERS, NOT JUST THE BUTTON. The advanced numbers are what the DM reads before
  // nudging one, and a stale slider sends the OTHER column's value into this one.
  // The panel is OPENED first, because the mode row reading "advanced" for a column that is on
  // a preset is the fault this covers.
  await dm.evaluate('document.querySelector(`#cp-anim-row [data-anim="advanced"]`).click(); 0');
  await dm.evaluate(`(() => {
    const n = document.getElementById('anim-drift-num');
    n.value = '2.50';
    n.dispatchEvent(new Event('change', { bubbles: true }));
    return 0;
  })()`);
  await paneA.waitFor('Math.abs(driftScale - 2.5) < 0.01', 8000, 'the drift to reach column A');
  rig.check(Math.abs(await paneB.evaluate('driftScale') - 2.5) > 0.01,
            'the drift set on column A also changed column B');

  await dm.evaluate('selectPane("B"); 0');
  await rig.sleep(400);
  rig.check(await dm.evaluate('document.getElementById("btn-anim").classList.contains("active")'),
            'the panel still shows animation OFF after selecting the column where it is ON');
  const driftShown = await dm.evaluate('+document.getElementById("anim-drift-num").value');
  rig.check(Math.abs(driftShown - (await paneB.evaluate('driftScale'))) < 0.02,
            'the advanced sliders still show the other column: panel ' + driftShown +
            ' against column B at ' + await paneB.evaluate('driftScale'));
  const animMode = await dm.evaluate(
    '(document.querySelector("#cp-anim-row [data-anim].active") || {}).dataset?.anim || "none"');
  rig.check(animMode !== 'advanced' && animMode !== 'none',
            'the animation row still reads "' + animMode + '" after selecting a column that is ' +
            'on a preset, because the Advanced panel was left open and aimed at the other one');
  await dm.evaluate('selectPane("A"); 0');
  await rig.sleep(400);
  rig.check(!(await dm.evaluate('document.getElementById("btn-anim").classList.contains("active")')),
            'the panel shows animation ON after selecting the column where it is OFF');
  await dm.evaluate('selectPane("A"); document.getElementById("btn-anim").click(); 0');
  await paneA.waitFor('fogAnimEnabled === true', 8000, 'the animation to start again on column A');

  // A column that changes width refits its half of the Player screen, so the preview's zoom has
  // to follow it. Nothing else reports that resize.
  await dm.evaluate(`(() => {
    const row = document.getElementById('panes-row');
    const r = row.getBoundingClientRect();
    const div = document.getElementById('panes-divider');
    const at = (type, x, target) => target.dispatchEvent(new MouseEvent(type, {
      clientX: x, clientY: r.top + r.height / 2, bubbles: true, cancelable: true, button: 0 }));
    at('mousedown', div.getBoundingClientRect().left + 4, div);
    at('mousemove', r.left + r.width * 0.55, document);
    at('mouseup',   r.left + r.width * 0.55, document);
    return 0;
  })()`);
  await rig.sleep(1500);
  const tvZoom = await tvA.evaluate('+zoom.toFixed(4)');
  const mmZoom = await dm.evaluate('+minimapView.zoom.toFixed(4)');
  rig.check(Math.abs(tvZoom - mmZoom) / Math.max(tvZoom, 0.0001) < 0.02,
            'the minimap kept the old zoom after the columns were resized: preview ' + mmZoom +
            ' against a TV at ' + tvZoom);

  // ── J. four things only two-map mode can get wrong ───────────────────────
  // ⚠ A COLUMN NEEDS THE TV'S RESOLUTION. It sizes the map's GPU texture against it, and with
  // displayInfo null it falls back to a heuristic off its own half-width box and never corrects.
  for (const [id, p] of [['A', paneA], ['B', paneB]]) {
    await p.waitFor('displayInfo && displayInfo.w > 0', 20000,
                    "column " + id + " to be told the Player screen's size");
  }

  // The corner-radius field edits the SELECTED shape, so the column needs one selected. The
  // selection is set directly: what is under test is the message, not the picking.
  await dm.evaluate('selectPane("A"); 0');
  await paneA.evaluate(`(() => {
    setPlaceMode('effects');
    effects.push({ id: nextEffectId++, material: 'fire', cornerRadius: 0,
                   vertices: [{x:100,y:100},{x:400,y:100},{x:400,y:400},{x:100,y:400}] });
    selectedPolygonId = effects[effects.length - 1].id;
    selectedVertexIndex = -1;
    return 0;
  })()`);
  await dm.evaluate('(() => { const f = document.getElementById("fx-radius-num");' +
    ' f.value = 37; f.dispatchEvent(new Event("input", { bubbles: true })); return 0; })()');
  await paneA.waitFor('effects[effects.length - 1].cornerRadius === 37', 8000,
                      'the corner radius to reach the effect selected in column A');
  await paneA.evaluate('effects.pop(); selectedPolygonId = null; setPlaceMode("rooms"); 0');

  // ⚠ ARMING CALIBRATION PUTS THE DM'S PANEL AWAY. armGridCalibration runs inside the column,
  // where the panel it shuts is that column's hidden one, so the DM's has to be shut from here.
  await dm.evaluate('document.getElementById("cp-grid-calibrate").click(); 0');
  await paneA.waitFor('gridCalArmed === true', 8000, 'calibration to arm on column A');
  rig.check(await dm.evaluate('document.querySelector(".cp-tab.active") === null'),
            "arming calibration left the DM's own panel open over the map");
  await dm.evaluate('document.getElementById("cp-grid-calibrate").click(); 0');
  await paneA.waitFor('gridCalArmed === false', 8000, 'calibration to disarm on column A');

  // ── K. the app says which two maps are open, and where ───────────────────
  const nameA = await dm.evaluate('allScenes.find(x => x.id === ' + JSON.stringify(sceneA) + ').name');
  const nameB = await dm.evaluate('allScenes.find(x => x.id === ' + JSON.stringify(sceneB) + ').name');
  const trigger = await dm.evaluate('document.getElementById("scene-dd-name").textContent');
  rig.check(trigger.includes(nameA) && trigger.includes(nameB),
            'the top-left button does not name both open maps: "' + trigger + '"');
  rig.check(await dm.evaluate('document.getElementById("btn-two-maps").classList.contains("active")'),
            'the two-map toggle is not lit while two maps are open');
  const badges = await dm.evaluate(`(() => {
    openDropdown();
    return Array.from(document.querySelectorAll('.sm-card.active')).map(c => ({
      id: c.dataset.id, badge: (c.querySelector('.sm-badge') || {}).textContent || '' }));
  })()`);
  await dm.evaluate('closeDropdown(); 0');
  rig.check(badges.length === 2, 'the library marks ' + badges.length + ' maps as open, not two');
  const badgeOf = id => (badges.find(b => b.id === id) || {}).badge;
  rig.check(badgeOf(sceneA) === 'Left' && badgeOf(sceneB) === 'Right',
            'the library does not say which column each open map is in: ' + JSON.stringify(badges));

  // ── L. closing a column ends two-map mode, and the TV stays lit ──────────
  await dm.evaluate('document.querySelector(`.pane-col[data-pane="B"] .pane-close`).click(); 0');
  await dm.waitFor('!panesActive', 30000, 'closing a column to end two-map mode');
  rig.check(await dm.evaluate('document.querySelectorAll(".pane-col").length') === 0,
            'a column was left on screen after one of the two closed');
  rig.check(!(await dm.evaluate('document.getElementById("btn-two-maps").classList.contains("active")')),
            'the two-map toggle is still lit with one map on screen');
  // ⚠ THE TV MUST NOT GO DARK. A column's Player was showing the players a map, so closing that
  // column has to hand the map that is left to the DM's own Player window.
  await dm.waitFor('!!mapOffscreen && currentScene', 120000, 'the DM window to take the map back');
  await dm.waitFor('!!(playerWindow && !playerWindow.closed)', 20000,
                   'the DM window to reopen a Player, so the TV is not left dark');
  // ⚠ POLLED, AND ONLY AFTER THE MAP IS BACK. The halves go when the shell is navigated to the
  // single Player, and that happens AFTER the scene has loaded - so a single read taken at the
  // moment the mode ends finds them still there. This read once and passed on a fast machine.
  let bGone = false;
  const goneBy = Date.now() + 30000;
  while (Date.now() < goneBy) {
    try { await tvB.evaluate('1'); } catch (_) { bGone = true; break; }
    await rig.sleep(300);
  }
  rig.check(bGone, "column B's half of the Player screen is still there after its column closed");
  const backWindows = (await rig.targets()).filter(t => /stage[.]html|mode=player/.test(t.url));
  rig.check(backWindows.length === 1 && backWindows[0].id === soloPlayerTargetId,
            'leaving two-map mode replaced the Player window instead of navigating it back, so ' +
            'a fullscreen TV drops out of fullscreen');
  const tvBack = await rig.player();
  await tvBack.waitFor('!!mapOffscreen && mapWidth === ' + aMapW, 60000,
                       'the map that is left to reach the TV');

  // ── M. and one map alone, unchanged ──────────────────────────────────────
  await dm.waitFor('fogCoverT === 0', 30000, 'the scene cover to lift');
  await dm.evaluate('syncSize(); fitToScreen(); viewportDirty = true; scheduleRender(); 0');
  const soloAfter = await dm.evaluate(
    '({ mapWidth, sceneId: currentScene.id, zoom: +zoom.toFixed(5), fit: __rigFit(),' +
    ' cols: document.querySelectorAll(".pane-col").length,' +
    ' visible: document.getElementById("canvas-container").offsetParent !== null })');
  rig.check(soloAfter.visible, "the DM window's own map area did not come back");
  rig.check(soloAfter.sceneId === sceneA && soloAfter.mapWidth === aMapW,
            'the one map that came back was not the column that was kept: scene ' +
            soloAfter.sceneId + ' at ' + soloAfter.mapWidth + 'px, wanted ' + sceneA +
            ' at ' + aMapW + 'px');
  rig.check(Math.abs(soloAfter.zoom - soloAfter.fit) < 0.0005,
            'the map that came back was not fitted to the window: zoom ' + soloAfter.zoom +
            ' against a fit of ' + soloAfter.fit);

  rig.byEye('Two floors side by side read as two maps and not as one split image, and the ' +
            'selected column is obvious at a glance from across the table.');
};
