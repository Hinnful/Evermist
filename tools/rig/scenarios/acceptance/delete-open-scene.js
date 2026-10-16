'use strict';

// delete-open-scene.js — DELETING THE OPEN SCENE NEVER PUTS ANOTHER SCENE ON THE TV.
//
// THE GOAL: the DM deletes the scene that is open, from the world map's menu. The DM's window opens
// the first scene in the list, but that is the DM's fallback, not the table's: the TV closes its fog
// and shows its waiting screen, because the fallback could be a scene the players must not see.
//
//   A. The world map's menu offers Delete on the open scene.
//   B. The delete leaves the DM on the first scene in the list.
//   C. The TV drops its map and shows the waiting screen.
//   D. Nothing automatic reaches the TV while it waits: an Auto sync edit on the fallback scene stays
//      off the TV.
//   E. Opening the scene again from the world map puts it on the TV.
//   F. With no scene left, the DM lands on the world map and the TV stays on its waiting screen.

const lib = require('../../lib');

const ONE_W = 1200, ONE_H = 800;
const TWO_W = 1000, TWO_H = 700;

const TV_EMPTY = '!mapOffscreen && mapWidth === 0 && landing.style.display !== "none"';

module.exports = async function deleteOpenScene(rig) {
  const dm = rig.dm;

  // Both scenes exist before the Player opens (see everything-reaches-the-player.js, D).
  await lib.openMap(rig, { w: ONE_W, h: ONE_H });
  const one = await dm.evaluate('currentScene.id');
  await lib.openMap(rig, { w: TWO_W, h: TWO_H });
  const two = await dm.evaluate('currentScene.id');
  rig.check(await dm.evaluate('autoSync === true'), 'auto-sync is off, so nothing below could reach the TV');

  const player = await rig.player();
  await player.waitFor('!!mapOffscreen && mapWidth === ' + TWO_W, 45000, 'the second map to reach the Player');
  await player.waitFor('fogCoverT === 0', 45000, 'the scene cover to lift on the Player');

  // ── A ──
  // RED ON: `off: _wmIsOpen(id)` put back on the Delete row (worldMapMenu.js) - 2026-10-16
  await dm.evaluate('worldMapShow(); 0');
  await lib.settle(dm, 'worldMapOpen && !_wmAnim', 10000);
  const del = await dm.evaluate('(() => { const r = _wmSceneRows("' + two + '").find(x => x.danger);' +
                                ' return r ? { off: !!r.off } : null; })()');
  rig.check(del && !del.off, 'A: the world map greys out Delete for the open scene');

  await dm.evaluate('_wmDeletePicked(["' + two + '"]); 0');

  // ── B ──
  // RED BY DESIGN: written against the fix, never re-proved
  await lib.settle(dm, 'currentScene && currentScene.id === "' + one + '" && mapWidth === ' + ONE_W, 60000);
  rig.check(await dm.evaluate('!!currentScene && currentScene.id === "' + one + '"'),
            'B: the delete did not leave the DM on the first scene');

  // ── C ──
  // RED ON: holdTvClear() removed from handleCurrentDeleted (sceneDelete.js) - 2026-10-16
  const cleared = await lib.settle(player, TV_EMPTY, 20000);
  rig.check(cleared, 'C: the TV kept a map after the open scene was deleted');
  rig.check(await player.evaluate('mapWidth !== ' + ONE_W), 'C: the TV shows the fallback scene the DM did not open');

  // ── D ──
  // RED ON: `&& !tvHeld` removed from canSendToPlayer (playerWindow.js) - 2026-10-16
  await dm.evaluate('revealCircle(300, 300, 150); rebuildFogEffect(); fogDirty = true; scheduleRender(); scheduleAutoSync(); 0');
  await lib.hold(4000, 'long enough for an Auto sync push to have reached the TV');
  rig.check(await player.evaluate(TV_EMPTY), 'D: an Auto sync edit put the fallback scene on the TV');

  // ── E ──
  // RED ON: the tvHeld branch removed from switchScene's same-scene return (sceneSwitch.js) - 2026-10-16
  await dm.evaluate('switchScene("' + one + '"); 0');
  const shown = await lib.settle(player, '!!mapOffscreen && mapWidth === ' + ONE_W, 45000);
  rig.check(shown, 'E: opening the scene again did not put it on the TV');

  // ── F ──
  // RED BY DESIGN: written against the fix, never re-proved
  await lib.settle(player, 'fogCoverT === 0', 45000);
  await dm.evaluate('worldMapShow(); 0');
  await lib.settle(dm, 'worldMapOpen && !_wmAnim', 10000);
  await dm.evaluate('_wmDeletePicked(["' + one + '"]); 0');
  await lib.settle(dm, '!currentScene && worldMapOpen', 20000);
  rig.check(await dm.evaluate('!currentScene && worldMapOpen'), 'F: with no scene left the DM is not on the world map');
  rig.check(await lib.settle(player, TV_EMPTY, 20000), 'F: the TV kept a map with no scene left');
  await dm.evaluate('commitPendingDelete(); 0');
};
