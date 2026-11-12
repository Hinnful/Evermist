'use strict';

// room-layers.js - A ROOM DRAWN INSIDE A HIDDEN ROOM CAN BE REVEALED (spec room-layers, DoD 1, 4, 5, 7, 10, 12).
//
// One map, no floor-plan rooms: a hidden hall and a hidden closet drawn inside it with the Rectangle tool, then
// Claude's room, the TV, clicks, copies and the popup's two layer buttons. Index 0 of `polygons` wins the fog.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   2.  The closet drawn inside the hall goes above it.
//  10.  Claude's create_room inside the hall goes above it, its reply names the room's real index, and edit_room by
//       that index reaches that room.
//   5.  A click picks the closet; a second still click on the spot picks the hall, a third the closet again. A press
//       and drag moves the closet.
//  12.  The drag leaves every room at its layer.
//   1.  The closet, clicked and revealed, is clear on the DM's fog and on the TV; the hall around it stays fogged.
//   4.  A duplicate, a paste and an Alt-drag copy of the closet, dropped inside the hall, each go above it and are
//       clear where they lie, on the TV too for the Alt-drag copy.
//   7.  The popup shows Bring to front and Send to back after the door. Send to back fogs the closet on the DM and the
//       TV; Bring to front clears it; the store holds the new order with an order time; Ctrl+Z puts it back to the back.

const lib = require('../lib');

const NAME = 'Слои';
const HALL = [300, 300, 1500, 1500], CLOSET = [600, 600, 900, 900];

module.exports = async function roomLayers(rig) {
  const id = await lib.importWithPlan(rig, NAME);
  const dm = rig.dm;
  let player = null;
  const ids = () => dm.evaluate('polygons.map(p => p.id)');
  const at = async rid => (await ids()).indexOf(rid);
  const draw = (b, dir) => dm.evaluate(`(() => { setPlaceMode('rooms'); setShapeOp('new'); setShape('rect');
    document.getElementById('btn-${dir}').click(); const n = nextPolygonId;
    __rigDrag(${b[0]}, ${b[1]}, ${b[2]}, ${b[3]}); setShape('select'); return n; })()`);
  const click = (x, y) => dm.evaluate(`(() => { setShape('select'); __rigClick(${x}, ${y}); return selectedPolygonId; })()`);
  const dmFog = async (x, y) => { await lib.settle(dm, '!fogTransRafId && !fogDirty', 15000); return dm.evaluate(`__rigFog(${x}, ${y})`); };
  const tvClear = (x, y) => lib.poll(async () => { const a = await lib.tvFog(player, x, y); return a < 128 ? { a } : null; }, 30000);
  const tvFogged = (x, y) => lib.poll(async () => { const a = await lib.tvFog(player, x, y); return a > 200 ? { a } : null; }, 30000);

  let hall, closet;
  await lib.step(rig, '2: draw', async () => {
    hall = await draw(HALL, 'shroud');
    closet = await draw(CLOSET, 'shroud');
    rig.check((await ids()).length === 2, '2 setup: two rooms were not drawn: ' + JSON.stringify(await ids()));
    rig.check(await at(closet) < await at(hall), '2: the closet drawn inside the hall went below it: ' + JSON.stringify(await ids()));
  });

  // Before the TV opens: Claude may not change the map the TV shows.
  await lib.step(rig, '10: Claude adds a room', async () => {
    const out = await dm.evaluate(`MCP_ROOMS_TOOLS.create_room({ name: ${JSON.stringify(NAME)}, room: 'Ниша Клода', fog: 'revealed',
      outline: [[${1100 / 31.1}, ${1100 / 21.6}], [${1300 / 31.1}, ${1100 / 21.6}], [${1300 / 31.1}, ${1300 / 21.6}], [${1100 / 31.1}, ${1300 / 21.6}]] })`, 30000);
    const live = await dm.evaluate('polygons.map(p => p.name)');
    const k = live.indexOf('Ниша Клода');
    rig.check(!out.isError && k >= 0, '10: Claude\'s room was not added: ' + out.text);
    rig.check(k < await at(hall), '10: Claude\'s room inside the hall went below it: ' + JSON.stringify(live));
    rig.check(new RegExp('index ' + (k + 1) + '\\)').test(out.text), '10: the reply names the wrong index (the room is at ' + (k + 1) + '): ' + out.text);
    const ed = await dm.evaluate(`MCP_ROOMS_TOOLS.edit_room({ name: ${JSON.stringify(NAME)}, index: ${k + 1}, newName: 'Ниша' })`, 30000);
    rig.check(!ed.isError && (await dm.evaluate('polygons.map(p => p.name)'))[k] === 'Ниша', '10: edit_room by the reported index missed the room: ' + ed.text);
    rig.check(await dmFog(1200, 1200) < 128, '10: Claude\'s revealed room is fogged on the DM inside the hidden hall');
  });

  player = await rig.player();
  await lib.installHelpers(player);
  await lib.settle(player, '!!mapOffscreen && fogCoverT === 0', 120000);

  await lib.step(rig, '5 and 12: click, click again, drag', async () => {
    rig.check(await click(750, 750) === closet, '5: a click on the closet did not pick it');
    rig.check(await click(750, 750) === hall, '5: a second click on the same spot did not pick the hall');
    rig.check(await click(750, 750) === closet, '5: a third click did not go back to the closet');
    const before = await ids(), v0 = await dm.evaluate(`polygons.find(p => p.id === ${closet}).vertices[0].x`);
    await dm.evaluate('__rigDrag(750, 750, 800, 800); 0');
    const v1 = await dm.evaluate(`polygons.find(p => p.id === ${closet}).vertices[0].x`), z = await dm.evaluate('zoom');
    rig.check(await dm.evaluate('selectedPolygonId') === closet && Math.abs(v1 - v0 - 50) <= 2 / z, '5: press and drag did not move the closet: ' + v0 + ' -> ' + v1);
    rig.check(JSON.stringify(await ids()) === JSON.stringify(before), '12: moving the closet changed the layers: ' + JSON.stringify(before) + ' -> ' + JSON.stringify(await ids()));
  });

  await lib.step(rig, '1: reveal the closet', async () => {
    rig.check(await click(800, 800) === closet, '1: a click inside the closet did not pick it');
    await dm.evaluate('document.getElementById("btn-reveal").click(); 0');
    rig.check(await dm.evaluate(`polygons.find(p => p.id === ${closet}).mode`) === 'reveal', '1: the closet was not revealed');
    rig.check(await dmFog(800, 800) < 128, '1: the revealed closet is still fogged on the DM');
    rig.check(!!(await tvClear(800, 800)), '1: the TV shows fog over the revealed closet (' + await lib.tvFog(player, 800, 800) + ')');
    rig.check(!!(await tvFogged(400, 1300)), '1: the hidden hall around the closet is clear on the TV');
  });

  await lib.step(rig, '4: duplicate, paste, Alt-drag copy', async () => {
    await click(700, 700);
    const dup = await dm.evaluate('duplicateSelectedShape(); selectedPolygonId');
    rig.check(dup !== closet && await at(dup) >= 0 && await at(dup) < await at(hall), '4: the duplicate went below the hall: ' + JSON.stringify(await ids()));
    rig.check(await dmFog(1000, 1000) < 128, '4: the revealed duplicate is fogged on the DM');
    await click(700, 700);
    const pasted = await dm.evaluate('copySelectedShape(); lastScreenX = 500 * zoom + panX; lastScreenY = 1300 * zoom + panY; pasteShapeAtCursor(); selectedPolygonId');
    rig.check(pasted !== closet && await at(pasted) < await at(hall), '4: the pasted copy went below the hall: ' + JSON.stringify(await ids()));
    rig.check(await dmFog(500, 1300) < 128, '4: the revealed paste is fogged on the DM');
    rig.check(await click(700, 700) === closet, '4: a click did not pick the closet again');
    await dm.evaluate('__rigDrag(700, 700, 1200, 400, { mods: { altKey: true } }); 0');
    const copy = await dm.evaluate('selectedPolygonId');
    rig.check(copy !== closet && await at(copy) >= 0 && await at(copy) < await at(hall), '4: the Alt-drag copy went below the hall: ' + JSON.stringify(await ids()));
    rig.check(await dmFog(1300, 500) < 128, '4: the Alt-drag copy is fogged on the DM where it was dropped');
    rig.check(!!(await tvClear(1300, 500)), '4: the Alt-drag copy is fogged on the TV (' + await lib.tvFog(player, 1300, 500) + ')');
  });

  await lib.step(rig, '7: Bring to front and Send to back', async () => {
    // Saved first, so the order the moves are timed against is this one.
    await dm.evaluate('doAutoSave()', 60000);
    rig.check(await click(700, 700) === closet, '7: a click did not pick the closet');
    await lib.settle(dm, 'document.getElementById("room-fog").style.display === "flex"', 8000);
    const bar = await dm.evaluate(`[...document.querySelectorAll('#room-fog > button')].map(b => b.className.split(' ').filter(c => c.startsWith('rf-')).join('.') + ':' + b.title)`);
    rig.check(JSON.stringify(bar) === JSON.stringify(['rf-door:Add a door - then click a wall', 'rf-layer.rf-front:Bring to front', 'rf-layer.rf-back:Send to back']),
      '7: the popup\'s buttons after the clouds are not the door, Bring to front, Send to back: ' + JSON.stringify(bar));
    await dm.evaluate('document.querySelector("#room-fog .rf-back").click(); 0');
    const order = await ids();
    rig.check(order[order.length - 1] === closet, '7: Send to back did not put the closet last: ' + JSON.stringify(order));
    rig.check(await dmFog(700, 700) > 200, '7: after Send to back the closet is still clear on the DM');
    rig.check(!!(await tvFogged(700, 700)), '7: after Send to back the TV still shows the closet clear');
    await dm.evaluate('document.querySelector("#room-fog .rf-front").click(); 0');
    const front = await ids();
    rig.check(front[0] === closet, '7: Bring to front did not put the closet first: ' + JSON.stringify(front));
    rig.check(await dmFog(700, 700) < 128, '7: after Bring to front the closet is fogged on the DM');
    rig.check(!!(await tvClear(700, 700)), '7: after Bring to front the TV still fogs the closet');
    const stored = await lib.poll(async () => {
      const r = await dm.evaluate(`sceneStore.loadScene(${JSON.stringify(id)}).then(r => ({ ids: r.polygons.map(p => p.id), order: r.edits && r.edits.scene && r.edits.scene.order }))`, 20000);
      return JSON.stringify(r.ids) === JSON.stringify(front) ? r : null;
    }, 20000, 500);
    rig.check(!!stored, '7: the new order was not saved');
    rig.check(!!stored && stored.order > 0, '7: the saved map carries no order time: ' + JSON.stringify(stored));
    await dm.evaluate('document.activeElement && document.activeElement.blur && document.activeElement.blur(); __rigKey("KeyZ", { ctrlKey: true }); 0');
    const undone = await ids();
    rig.check(undone[undone.length - 1] === closet, '7: Ctrl+Z did not put the closet back at the back: ' + JSON.stringify(undone));
    rig.check(!!(await tvFogged(700, 700)), '7: after Ctrl+Z the TV still shows the closet clear');
  });
};
