'use strict';

// claude-grid.js — CLAUDE FITS A GRID AND PLACES EFFECTS AND LIGHTS, AND THE TV NEVER HEARS OF IT.
//
// THE GOAL: Claude's grid tools (src/mcp/mcpGrid.js and src/mcp/mcpGridPlan.js: set_grid, create_effect, delete_effect, create_light, set_lights)
// change a map's grid, effects and lights the way the DM's own controls would. A map the DM has open changes on their
// screen, a closed map in the store, each call is one step undo_last_change takes back, a delete asks first, and the
// Player window receives nothing.
//
// Two maps are driven the same way: one OPEN on the DM window but not on the TV (the TV is held on its waiting screen,
// as delete-open-scene.js holds it), one CLOSED in the library.
//
//   A. set_grid fitted to a crossing sets the cell size and the grid's phase so a line crosses there, and undo puts the grid back.
//   B. create_effect puts one Fire effect on the map, and undo takes it away.
//   C. delete_effect without confirmed only says what would go; with confirmed it deletes; undo brings the effect back.
//   D. create_light draws one light and turns the map's lights on, and undo takes it away.
//   E. set_lights off hides the lights without losing them, and undo shows them again.
//   F. The Player window received no message about any of it.

const lib = require('../../lib');

const CELL_PCT = 5, CROSS = { x: 12, y: 21 };

module.exports = async function claudeGrid(rig) {
  const dm = rig.dm;
  const { player, open, closed } = await lib.openMapsOffTv(rig);
  rig.check(await dm.evaluate('tvHeld && currentScene.id === "' + open.id + '"') && !!closed,
            'the TV was not held off an open map with a closed one beside it, so nothing below tests both');
  const call = await lib.mcpClient(rig);
  rig.check(!!call, 'the app wrote no mcp.json with a port and a key into its profile');
  if (!call) return;

  await dm.evaluate(`(() => {
    globalThis.__cg = {
      state: async id => {
        if (currentScene && currentScene.id === id) {
          const l = lightsSceneFields();
          return { w: mapWidth, h: mapHeight, grid: captureGridConfig(), effects: effects.map(e => e.material), lights: l.lightShapes.length, lightsHidden: !!l.lightsHidden };
        }
        const r = await sceneStore.loadScene(id);
        return { w: r.mapWidth, h: r.mapHeight, grid: r.gridConfig || null, effects: (r.effects || []).map(e => e.material),
                 lights: (r.lightShapes || []).length, lightsHidden: !!r.lightsHidden };
      },
    };
    return 0;
  })()`);
  const state = id => dm.evaluate('__cg.state(' + JSON.stringify(id) + ')');
  const phase = (v, step) => ((v % step) + step) % step;

  for (const [where, map] of [['open map', open], ['closed map', closed]]) {
    const at = { name: map.name };
    const start = await state(map.id);

    // ── A ──
    // RED BY DESIGN: written against the feature, never re-proved
    const cell = Math.round(CELL_PCT / 100 * start.w * 100) / 100;
    const want = { cellSize: cell, offsetX: phase(CROSS.x / 100 * start.w, cell), offsetY: phase(CROSS.y / 100 * start.h, cell) };
    const grid = await call('set_grid', { ...at, on: true, type: 'square', cell: CELL_PCT, crossing: CROSS });
    const fitted = (await state(map.id)).grid || {};
    rig.check(!grid.isError && fitted.enabled === true && Math.abs(fitted.cellSize - want.cellSize) < 0.02
              && Math.abs(fitted.offsetX - want.offsetX) < 0.05 && Math.abs(fitted.offsetY - want.offsetY) < 0.05,
              'A: ' + where + ': set_grid did not fit the grid to the crossing: ' + JSON.stringify({ grid, fitted, want }));
    const undoneGrid = await call('undo_last_change');
    const back = (await state(map.id)).grid;
    // a map saved before it had a grid reads back as the default grid, so only a stored one is compared to the digit
    rig.check(!undoneGrid.isError && back && Math.abs(back.cellSize - want.cellSize) > 0.02
              && (!start.grid || (back.cellSize === start.grid.cellSize && back.offsetX === start.grid.offsetX && back.offsetY === start.grid.offsetY)),
              'A: ' + where + ': undo_last_change did not put the old grid back: ' + JSON.stringify({ undoneGrid, start: start.grid, back }));

    // ── B ──
    // RED BY DESIGN: written against the feature, never re-proved
    const fx = await call('create_effect', { ...at, material: 'Fire', circle: { x: 50, y: 50, radius: 5 } });
    const withFx = (await state(map.id)).effects;
    rig.check(!fx.isError && withFx.length === 1 && withFx[0] === 'fire', 'B: ' + where + ': create_effect did not put one Fire effect on the map: ' + JSON.stringify({ fx, withFx }));

    // ── C ──
    // RED BY DESIGN: written against the feature, never re-proved
    const dry = await call('delete_effect', { ...at, effect: 1 });
    rig.check(!dry.isError && /Would delete/.test(dry.text) && (await state(map.id)).effects.length === 1,
              'C: ' + where + ': delete_effect without confirmed changed something or did not say what goes: ' + JSON.stringify(dry));
    const gone = await call('delete_effect', { ...at, effect: 1, confirmed: true });
    rig.check(!gone.isError && (await state(map.id)).effects.length === 0, 'C: ' + where + ': delete_effect with confirmed left the effect: ' + JSON.stringify(gone));
    const undoneDelete = await call('undo_last_change');
    rig.check(!undoneDelete.isError && (await state(map.id)).effects.join() === 'fire', 'C: ' + where + ': undo_last_change did not bring the effect back: ' + JSON.stringify(undoneDelete));
    const undoneFx = await call('undo_last_change');
    rig.check(!undoneFx.isError && (await state(map.id)).effects.length === 0, 'B: ' + where + ': undo_last_change did not take the created effect away: ' + JSON.stringify(undoneFx));

    // ── D ──
    // RED BY DESIGN: written against the feature, never re-proved
    const light = await call('create_light', { ...at, outline: [[60, 10], [80, 10], [80, 30], [60, 30]] });
    const lit = await state(map.id);
    rig.check(!light.isError && lit.lights === 1 && lit.lightsHidden === false, 'D: ' + where + ': create_light did not draw one shown light: ' + JSON.stringify({ light, lit }));

    // ── E ──
    // RED BY DESIGN: written against the feature, never re-proved
    const off = await call('set_lights', { ...at, on: false });
    const dark = await state(map.id);
    rig.check(!off.isError && dark.lightsHidden === true && dark.lights === 1, 'E: ' + where + ': set_lights off did not hide the lights and keep them: ' + JSON.stringify({ off, dark }));
    const undoneOff = await call('undo_last_change');
    rig.check(!undoneOff.isError && (await state(map.id)).lightsHidden === false, 'E: ' + where + ': undo_last_change did not show the lights again: ' + JSON.stringify(undoneOff));
    const undoneLight = await call('undo_last_change');
    rig.check(!undoneLight.isError && (await state(map.id)).lights === 0, 'D: ' + where + ': undo_last_change did not take the light away: ' + JSON.stringify(undoneLight));
  }

  // ── F ──
  // RED ON: syncAnimToPlayer(true, true) called on the DM before the hold, with no hello from the Player - 2026-10-31
  await lib.hold(3000, 'long enough for a push of any of these changes to have reached the Player');
  const heard = await lib.claudeHeard(dm, player);
  rig.check(heard.length === 0, 'F: the Player window received something of Claude\'s grid, effect or light changes: ' + JSON.stringify(heard.slice(0, 5)));
};
