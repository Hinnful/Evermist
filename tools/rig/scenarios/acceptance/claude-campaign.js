'use strict';

// claude-campaign.js — CLAUDE SHAPES THE CAMPAIGN: GROUP OUTLINES, CARDS, ROADS AND THE BACKDROP.
//
// THE GOAL: Claude's Campaign tools (src/mcp/mcpWorld.js and src/mcp/mcpWorldPlan.js: reshape_place; src/mcp/mcpScenes.js: move_scene;
// src/mcp/mcpWorldMap.js: edit_road, set_road_maps, delete_road, set_backdrop; src/mcp/mcpNotes.js at the road level)
// change what the DM sees on the world map the way the DM's own drags would, and each call is one step
// undo_last_change takes back. A delete asks first. Nothing here is a map's own record, so the Player window has no part.
//
//   A. reshape_place with an outline gives the group that outline, and undo puts the old shape back.
//   B. move_scene with x and y puts the map's card exactly there, and undo puts it back where it was.
//   C. edit_road renames a road, gives it a new route and rounds its corners, and undo puts all of it back.
//   D. set_road_maps puts a map on the road and undo takes it off.
//   E. add_notes at the road level writes the road's notes, read_notes reads them, and undo clears them.
//   F. delete_road without confirmed only says what would go; with confirmed it deletes the road and its notes;
//      undo brings back both.
//   G. set_backdrop with numbers only is refused while there is no backdrop, and once there is one it changes scale,
//      opacity and position, and undo puts the old numbers back.
//
// ⚠ set_backdrop WITH A PATH reads a file through the main process and is not driven here; the numbers-only form is.

const lib = require('../../lib');

module.exports = async function claudeCampaign(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: 1200, h: 800 });
  const aId = await dm.evaluate('currentScene.id');
  await dm.evaluate('renameScene(' + JSON.stringify(aId) + ', "Alpha Map"); 0');
  await lib.openMap(rig, { w: 1000, h: 700 });
  const bId = await dm.evaluate('currentScene.id');
  await dm.evaluate('renameScene(' + JSON.stringify(bId) + ', "Beta Map"); 0');
  const call = await lib.mcpClient(rig);
  rig.check(!!call, 'the app wrote no mcp.json with a port and a key into its profile');
  if (!call) return;

  const ev = expr => dm.evaluate(expr);
  const place = name => ev('(() => { const r = worldPlaceByName(' + JSON.stringify(name) + '); return r && { v: wmOutline(r).map(p => [p.x, p.y]), b: wmPolyBounds(wmOutline(r)) }; })()');
  const road = name => ev('(() => { const r = worldRoadRecords().find(x => x.name === ' + JSON.stringify(name) + '); return r && { uid: r.uid, v: r.vertices.map(p => [p.x, p.y]), radius: r.cornerRadius || 0, maps: r.scenes.map(s => s.id), notes: notesRoadGet(r.uid) }; })()');
  const pos = id => ev('(() => { const s = allScenes.find(x => x.id === ' + JSON.stringify(id) + '); return s && s.worldPos ? [s.worldPos.x, s.worldPos.y] : null; })()');

  await call('create_place', { name: 'Fen' });
  await call('create_place', { name: 'Moor' });
  const fen = await place('Fen');
  rig.check(!!fen && !!(await place('Moor')), 'the two groups the Campaign tests start from were not made');
  if (!fen) return;

  // ── A ──
  // RED BY DESIGN: written against the feature, never re-proved
  const outline = [{ x: fen.b.x, y: fen.b.y }, { x: fen.b.x + fen.b.w + 100, y: fen.b.y }, { x: fen.b.x + fen.b.w, y: fen.b.y + fen.b.h + 60 }, { x: fen.b.x, y: fen.b.y + fen.b.h }];
  const shaped = await call('reshape_place', { name: 'Fen', outline });
  const reshaped = await place('Fen');
  rig.check(!shaped.isError && JSON.stringify(reshaped.v) === JSON.stringify(outline.map(p => [p.x, p.y])),
            'A: reshape_place did not give the group its outline: ' + JSON.stringify({ shaped, reshaped: reshaped && reshaped.v }));
  const undoneShape = await call('undo_last_change');
  rig.check(!undoneShape.isError && JSON.stringify((await place('Fen')).v) === JSON.stringify(fen.v), 'A: undo_last_change did not put the group\'s old shape back: ' + JSON.stringify(undoneShape));

  // ── B ──
  // RED BY DESIGN: written against the feature, never re-proved
  const beforePos = await pos(aId);
  const spot = { x: fen.b.x + fen.b.w + 3000, y: fen.b.y + 2000 };
  const moved = await call('move_scene', { name: 'Alpha Map', x: spot.x, y: spot.y });
  rig.check(!moved.isError && JSON.stringify(await pos(aId)) === JSON.stringify([spot.x, spot.y]),
            'B: move_scene did not put the card exactly at ' + spot.x + ',' + spot.y + ': ' + JSON.stringify({ moved, at: await pos(aId) }));
  const undoneMove = await call('undo_last_change');
  rig.check(!undoneMove.isError && JSON.stringify(await pos(aId)) === JSON.stringify(beforePos),
            'B: undo_last_change did not put the card back where it was: ' + JSON.stringify({ undoneMove, beforePos, now: await pos(aId) }));

  // ── C ──
  // RED BY DESIGN: written against the feature, never re-proved
  const made = await call('create_road', { from: 'Fen', to: 'Moor' });
  const firstName = 'Road from Fen to Moor';
  const first = await road(firstName);
  rig.check(!made.isError && !!first && first.v.length === 2, 'C: the road the edit tests start from was not made: ' + JSON.stringify(made));
  if (!first) return;
  const route = [{ x: first.v[0][0], y: first.v[0][1] }, { x: first.v[0][0] + 400, y: first.v[0][1] + 300 }, { x: first.v[1][0], y: first.v[1][1] }];
  const edited = await call('edit_road', { name: firstName, newName: 'Old Salt Road', points: route, cornerRadius: 20 });
  const now = await road('Old Salt Road');
  rig.check(!edited.isError && !!now && now.v.length === 3 && now.radius === 20 && !(await road(firstName)),
            'C: edit_road did not rename the road, give it three points and round it: ' + JSON.stringify({ edited, now }));
  const undoneRoad = await call('undo_last_change');
  const reverted = await road(firstName);
  rig.check(!undoneRoad.isError && !!reverted && reverted.v.length === 2 && reverted.radius === 0 && !(await road('Old Salt Road')),
            'C: undo_last_change did not put the road\'s name, route and corners back: ' + JSON.stringify({ undoneRoad, reverted }));
  await call('edit_road', { name: firstName, newName: 'Old Salt Road' });

  // ── D ──
  // RED BY DESIGN: written against the feature, never re-proved
  const onRoad = await call('set_road_maps', { name: 'Old Salt Road', add: ['Beta Map'] });
  rig.check(!onRoad.isError && (await road('Old Salt Road')).maps.includes(bId), 'D: set_road_maps did not put the map on the road: ' + JSON.stringify(onRoad));
  const undoneOn = await call('undo_last_change');
  rig.check(!undoneOn.isError && !(await road('Old Salt Road')).maps.includes(bId), 'D: undo_last_change did not take the map off the road: ' + JSON.stringify(undoneOn));

  // ── E ──
  // RED BY DESIGN: written against the feature, never re-proved
  const noted = await call('add_notes', { level: 'road', name: 'Old Salt Road', text: 'Bandits at the ford.' });
  const read = await call('read_notes', { level: 'road', name: 'Old Salt Road' });
  rig.check(!noted.isError && (await road('Old Salt Road')).notes === 'Bandits at the ford.' && /Bandits at the ford\./.test(read.text),
            'E: the road\'s notes were not written and read back: ' + JSON.stringify({ noted, read }));

  // ── F ──
  // RED BY DESIGN: written against the feature, never re-proved
  const dry = await call('delete_road', { name: 'Old Salt Road' });
  rig.check(!dry.isError && /Would delete the road "Old Salt Road"/.test(dry.text) && !!(await road('Old Salt Road')),
            'F: delete_road without confirmed changed something or did not say what goes: ' + JSON.stringify(dry));
  const uid = (await road('Old Salt Road')).uid;
  const gone = await call('delete_road', { name: 'Old Salt Road', confirmed: true });
  rig.check(!gone.isError && !(await road('Old Salt Road')) && await ev('notesRoadGet(' + JSON.stringify(uid) + ')') === '',
            'F: delete_road with confirmed left the road or its notes: ' + JSON.stringify(gone));
  const undoneDelete = await call('undo_last_change');
  const backRoad = await road('Old Salt Road');
  rig.check(!undoneDelete.isError && !!backRoad && backRoad.notes === 'Bandits at the ford.' && backRoad.v.length === 2,
            'F: undo_last_change did not bring back the road with its notes: ' + JSON.stringify({ undoneDelete, backRoad }));

  // ── G ──
  // RED BY DESIGN: written against the feature, never re-proved
  const noBackdrop = await call('set_backdrop', { scale: 150 });
  rig.check(noBackdrop.isError && /no backdrop/i.test(noBackdrop.text), 'G: set_backdrop with numbers only was not refused while there is no backdrop: ' + JSON.stringify(noBackdrop));
  await ev(`(async () => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64; c.getContext('2d').fillRect(0, 0, 32, 32);
    const f = await new Promise(res => c.toBlob(b => res(new File([b], 'backdrop.png', { type: 'image/png' })), 'image/png'));
    await _wbChoose(f);
    return 0;
  })()`);
  const meta = () => ev('_wbMeta && ({ scale: _wbMeta.scale, alpha: _wbMeta.alpha, x: _wbMeta.x, y: _wbMeta.y })');
  const metaBefore = await meta();
  rig.check(!!metaBefore, 'G: the backdrop the number tests start from was not set');
  const numbers = await call('set_backdrop', { scale: 150, opacity: 0.5, x: 400, y: 300 });
  const metaNow = await meta();
  rig.check(!numbers.isError && metaNow.scale === 1.5 && metaNow.alpha === 0.5 && metaNow.x === 400 && metaNow.y === 300,
            'G: set_backdrop did not set scale, opacity and position: ' + JSON.stringify({ numbers, metaNow }));
  const undoneNumbers = await call('undo_last_change');
  rig.check(!undoneNumbers.isError && JSON.stringify(await meta()) === JSON.stringify(metaBefore),
            'G: undo_last_change did not put the backdrop\'s old numbers back: ' + JSON.stringify({ undoneNumbers, metaBefore, now: await meta() }));
};
