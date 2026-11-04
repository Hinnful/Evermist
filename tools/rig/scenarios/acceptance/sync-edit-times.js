'use strict';

// sync-edit-times.js — EVERY SAVE TIMES WHAT IT CHANGED, AND NOTHING ELSE, SO THE NEWER EDIT WINS AN IMPORT.
//
// THE GOAL OF THIS FEATURE: when two machines' maps are merged, the reveals and notes made later win,
// whichever machine made them; and a map that stops saving says so.
//
// Drives src/scenes/sceneStore.js and src/scenes/scenes.js.
//
// THE CRITERIA ARE THIS HEADER. Each check sits under its letter.
//
//   A. Renaming a map that is not open keeps the time its fog was last revealed.
//   B. A room note written in the Notes window for a map that is not open is timed on that room.
//   C. Renaming a room on the open map leaves the fog's time alone.
//   D. A map that fails to save puts up one dialog that says so.

const lib = require('../../lib');

const room = '[{ id: 1, vertices: [{ x: 200, y: 200 }, { x: 700, y: 200 }, { x: 700, y: 600 }, { x: 200, y: 600 }],' +
  ' mode: "shroud", cornerRadius: 0, name: "Hall", desc: "" }]';

module.exports = async function syncEditTimes(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: 1600, h: 1000, kind: 'still', name: 'sync-a.png' });
  const aId = JSON.stringify(await dm.evaluate('currentScene.id'));
  await dm.evaluate('polygons = ' + room + '; nextPolygonId = 2; doAutoSave()');
  const edits = id => dm.evaluate('sceneStore.loadScene(' + id + ').then(r => JSON.stringify(r.edits || {}))').then(JSON.parse);
  const fogA = (await edits(aId)).scene.fog;
  rig.check(fogA > 0, 'setup: map A has no fog time');

  // ── C. A room rename leaves the fog's time alone ──────────────────────────
  // RED ON: the unchanged-picture check removed from doAutoSave (scenes.js) — 2026-11-04
  await lib.hold(20, 'a later clock reading than the fog was stamped at');
  await dm.evaluate('roomCardPatch(1, { name: "Great hall" }); doAutoSave()');
  const afterRename = await edits(aId);
  rig.check(fogA > 0 && afterRename.scene.fog === fogA, 'renaming a room moved the fog\'s time: ' + JSON.stringify([fogA, afterRename.scene.fog]));

  // Map B is opened, so A is closed from here on.
  const mapB = await rig.fixtures.stillMap(dm, rig.fixtureDir, { w: 1200, h: 800, name: 'sync-b.png' });
  await dm.evaluate('createNewScene(' + (await rig.fixtures.asFileExpr(dm, mapB)) + ', { quiet: true })', 120000);
  await lib.settle(dm, 'currentScene && currentScene.id !== ' + aId, 60000);

  // ── A. A closed map's rename keeps its fog time ───────────────────────────
  // RED ON: updateScene stamping through esStampScene again (sceneStore.js) — 2026-11-04
  await dm.evaluate('renameScene(' + aId + ', "Renamed far away"); 0');
  const renamed = await lib.poll(async () => { const e = await edits(aId); return e.scene && e.scene.name ? e : null; }, 5000);
  rig.check(fogA > 0 && renamed && renamed.scene.fog === fogA, 'renaming a closed map erased its fog time: ' + JSON.stringify(renamed && renamed.scene));

  // ── B. A closed map's room note is timed ──────────────────────────────────
  // RED ON: updateScene stamping through esStampScene again (sceneStore.js) — 2026-11-04
  const uid = await dm.evaluate('sceneStore.loadScene(' + aId + ').then(r => r.polygons[0].uid || "legacy-1")');
  const before = ((await edits(aId)).rooms[uid] || {}).notes || 0;
  await lib.hold(20, 'a later clock reading than the room was stamped at');
  await dm.evaluate('notesRoomPatch(' + aId + ', 1, { desc: "Written in the Notes window" }); 0');
  const timed = await lib.poll(async () => { const t = ((await edits(aId)).rooms[uid] || {}).notes || 0; return t > before ? t : null; }, 5000);
  rig.check(!!timed, 'a room note written for a closed map was not timed on the room');

  // ── D. A failed save says so ──────────────────────────────────────────────
  // RED ON: _writeFailed() removed from saveScene (sceneStore.js) — 2026-11-04
  await dm.evaluate('(() => { const orig = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function () {' +
    ' IDBObjectStore.prototype.put = orig; throw new DOMException("rig: the disk is full", "QuotaExceededError"); }; return 0; })()');
  await dm.evaluate('doAutoSave()');
  const up = await lib.poll(() => dm.evaluate('(() => { const r = document.getElementById("cd-anchor"); return r && r.style.display === "flex" ? (document.getElementById("cd-title") || {}).textContent : null; })()'), 5000);
  rig.check(/maps/i.test(up || ''), 'a map that failed to save put up no dialog: ' + JSON.stringify(up));
  // The aborted write logs itself. That line is this check's own doing; any other error still fails the run.
  const own = /rig: the disk is full|AbortError: Uncaught exception in event handler/;
  await lib.poll(() => (dm.errors || []).some(e => own.test(e)) || null, 5000);
  dm.errors = (dm.errors || []).filter(e => !own.test(e));
  if (up) await dm.evaluate('document.getElementById("cd-ok").click(); 0');
};
