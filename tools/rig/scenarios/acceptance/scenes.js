'use strict';

// scenes.js — THE SCENE LIBRARY, whole.
//
// THE GOAL OF THIS FEATURE: the DM preps a dungeon's maps before the session, then moves between
// them at the table without losing what they revealed on any of them. A scene is the unit of
// prep: its map, its fog, its rooms, its effects and its grid, kept together and kept apart from
// every other scene's. Every check below serves that sentence.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks directly beneath it, in order.
//
//   A. A scene remembers the fog. The autosave commits what the DM revealed, a switch away does
//      not damage what was committed, and coming back restores it.
//   B. A scene remembers its rooms and its effects, and never inherits another scene's.
//   C. A scene's name is the DM's to set: it reaches the store and the library trigger, and an
//      empty name falls back rather than leaving a nameless card.
//   D. The library keeps the order the DM dragged it into, and that order survives the next save.
//   E. Deleting is undoable for a few seconds, and Undo puts the scene back where it was.
//   F. Deleting the scene that is open leaves the DM on another map, not on nothing.
//   G. Once the delete is committed the scene is really gone — out of the store, not just out of
//      the list.
//   H. Switching to a scene that will not load leaves the DM where they were, with a reason.
//
// What a switch sends to the Player is everything-reaches-the-player.js's business, not this
// file's: sections D and E there cover the new map arriving on the TV exactly once. Nothing here
// opens a Player, which is also why it is one of the quick scenarios.
//
// ⚠ SECTION A WAITS FOR THE AUTOSAVE, AND MUST KEEP WAITING. The app saves on a five-second
// timer, which is the promise it makes; it does not promise to have saved the instant the DM
// changes map. A scenario that revealed and switched immediately would read an unsaved scene and
// report data loss where the app is behaving exactly as designed. That version was written, run,
// and corrected. Do not "tighten" this by dropping the wait.
//
// ⚠ SECTION A SPLITS THE SAVE FROM THE RESTORE ON PURPOSE. "The fog came back" can fail three
// completely different ways: the autosave never committed, the switch away damaged what it had
// committed, or something was written and not read. The store is read at each step, so the FAIL
// line says which.
//
// ⚠ DRIVE A SWITCH THROUGH switchScene(), NEVER THE DROPDOWN. openDropdown() saves before it
// renders, so a switch made by clicking a card carries a save the switch itself did not make —
// which is a different path from the one the DM's own keyboard and card clicks take here.
//
// ⚠ NEVER PASS AN ASYNC EXPRESSION TO waitFor. It wraps what it is given in `!!(…)`, so a promise
// is truthy on the first poll and the wait returns instantly, having looked at nothing. Anything
// reading IndexedDB is polled from Node here instead.
//
// ⚠ THE MAP IS ANIMATED, AND EVERY ACCEPTANCE FILE'S IS. Animated is the only kind the DM
// ever uses, so a suite running on still PNGs proved the app worked in a case that never
// happens. `tableMap` (tools/rig/fixtures.js) records the clip once per run and caches it by
// size. Do not swap it back to `stillMap`; smoke.js is the one file that wants both.

const MAP_W = 1400, MAP_H = 900;
const REVEAL = { x: 400, y: 300, r: 220 };
const DARK = { x: 1100, y: 700 };
const ROOM = { x1: 900, y1: 150, x2: 1250, y2: 400 };
const FX = { x1: 200, y1: 600, x2: 500, y2: 800 };

module.exports = async function scenesFeature(rig) {
  const dm = rig.dm;

  const map = await rig.fixtures.tableMap(dm, rig.fixtureDir,
    { w: MAP_W, h: MAP_H });
  const expr = await rig.fixtures.asFileExpr(dm, map);
  const named = n => '(f => new File([f], ' + JSON.stringify(n) + ', { type: f.type }))(' + expr + ')';

  const importAs = async name => {
    await dm.evaluate('createNewScene(' + named(name + '.mp4') + ')', 120000);
    await dm.waitFor('currentScene && currentScene.name === ' + JSON.stringify(name), 120000,
                     'the import of ' + name);
    return dm.evaluate('currentScene.id');
  };

  const switchTo = async id => {
    await dm.evaluate('switchScene(' + JSON.stringify(id) + ')', 120000);
    await dm.waitFor('currentScene && currentScene.id === ' + JSON.stringify(id), 60000,
                     'the switch to ' + id);
    await dm.waitFor('fogCoverT === 0', 30000, 'the scene cover to lift');
  };

  const liveFog = (x, y) => dm.evaluate('fogDataCtx.getImageData(Math.round(' + x +
    ' / FOG_SCALE), Math.round(' + y + ' / FOG_SCALE), 1, 1).data[3]');

  // The fog a scene has ON DISK, read out of the stored baseFogBlob and sampled at one map point.
  // This is what section A holds the save half against.
  const storedFog = (id, x, y) => dm.evaluate(`(async () => {
    const sc = await sceneStore.loadScene(${JSON.stringify(id)});
    if (!sc) return { err: 'no scene' };
    if (!sc.baseFogBlob) return { err: 'no baseFogBlob stored' };
    const bmp = await createImageBitmap(sc.baseFogBlob);
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    bmp.close();
    const px = (mx, my) => g.getImageData(
      Math.round(mx / FOG_SCALE), Math.round(my / FOG_SCALE), 1, 1).data[3];
    return { w: c.width, h: c.height, at: px(${x}, ${y}), dark: px(${DARK.x}, ${DARK.y}) };
  })()`, 30000);

  const stored = id => dm.evaluate('(async () => { const sc = await sceneStore.loadScene(' +
    JSON.stringify(id) + ');' +
    ' return sc ? { name: sc.name, order: sc.sortOrder, rooms: (sc.polygons || []).length,' +
    ' effects: (sc.effects || []).length } : null; })()', 30000);

  // Polled, bounded, and it never throws: a miss becomes a named failure rather than an
  // exception that abandons the rest of the file.
  const waitFor = async (read, ok, ms) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const v = await read();
      if (ok(v) || Date.now() > deadline) return v;
      await rig.sleep(200);
    }
  };

  const library = () => dm.evaluate('allScenes.map(s => s.name)');
  const ids = () => dm.evaluate('allScenes.map(s => s.id)');

  const alpha = await importAs('Alpha');
  const beta = await importAs('Beta');
  rig.note('scenes: Alpha=' + alpha + ' Beta=' + beta);

  // ── A. A scene remembers the fog ───────────────────────────────────────────
  await switchTo(alpha);
  // Exactly what the brush does on mouseup: paint, mark dirty, and ask for a save.
  await dm.evaluate('revealCircle(' + REVEAL.x + ',' + REVEAL.y + ',' + REVEAL.r + ');' +
    ' fogDirty = true; scheduleRender(); scheduleAutoSave(); 0');
  rig.check(await liveFog(REVEAL.x, REVEAL.y) === 0,
            'the reveal did not take on the DM, so nothing below can be about persistence');

  // The autosave commits on its own, with the DM doing nothing further. Polled rather than slept
  // through: the wait is generous because the timer is five seconds, and what is being checked is
  // that it fires at all.
  const committed = await waitFor(() => storedFog(alpha, REVEAL.x, REVEAL.y),
                                  v => !v.err && v.at === 0, 20000);
  rig.note("Alpha's fog on disk once the autosave ran: " + JSON.stringify(committed));
  rig.check(!committed.err,
            'the scene has no saved fog at all after the autosave: ' + committed.err);
  rig.check(!committed.err && committed.at === 0,
            'the autosave never committed what the DM revealed (alpha ' + committed.at +
            " where it should be 0), so a session's work is only ever in memory");
  rig.check(!committed.err && committed.dark > 200,
            'the saved fog has lost the shroud over ground nobody entered (alpha ' +
            committed.dark + ')');

  // Switching away must not damage what was already committed. The switch saves the outgoing
  // scene on its way past, so a switch that wrote a blank would erase a good save.
  await switchTo(beta);
  const afterSwitch = await storedFog(alpha, REVEAL.x, REVEAL.y);
  rig.note("Alpha's fog on disk after switching away: " + JSON.stringify(afterSwitch));
  rig.check(!afterSwitch.err && afterSwitch.at === 0,
            'switching away from a scene overwrote the fog it had already saved (alpha ' +
            afterSwitch.at + ' where it should be 0)');
  rig.check(!afterSwitch.err && afterSwitch.dark > 200,
            'switching away flattened the saved shroud over ground nobody entered (alpha ' +
            afterSwitch.dark + ')');

  await switchTo(alpha);
  const back = await liveFog(REVEAL.x, REVEAL.y);
  const backDark = await liveFog(DARK.x, DARK.y);
  rig.note('Alpha on returning: revealed=' + back + ' untouched=' + backDark);
  rig.check(back === 0,
            'coming back to a scene did not restore what the DM had revealed on it: alpha ' + back);
  rig.check(backDark > 200,
            'coming back to a scene lost the shroud over ground nobody entered: alpha ' + backDark);

  // ── B. Rooms and effects belong to their scene ─────────────────────────────
  await dm.evaluate(`(() => {
    pushUndo();
    polygons = [{ id: 1, vertices: [
      { x: ${ROOM.x1}, y: ${ROOM.y1} }, { x: ${ROOM.x2}, y: ${ROOM.y1} },
      { x: ${ROOM.x2}, y: ${ROOM.y2} }, { x: ${ROOM.x1}, y: ${ROOM.y2} },
    ], mode: 'shroud', cornerRadius: 0, name: 'The Vestry' }];
    nextPolygonId = 2;
    effects = [{ id: 1, vertices: [
      { x: ${FX.x1}, y: ${FX.y1} }, { x: ${FX.x2}, y: ${FX.y1} },
      { x: ${FX.x2}, y: ${FX.y2} }, { x: ${FX.x1}, y: ${FX.y2} },
    ], material: 'fire', cornerRadius: 0, name: 'Burning pews' }];
    nextEffectId = 2;
    rebuildFogFromPolygons(); rebuildFogEffect(); doAutoSave();
    return 0;
  })()`);

  const alphaStored = await waitFor(() => stored(alpha), v => v && v.rooms === 1, 12000);
  rig.check(!!alphaStored && alphaStored.rooms === 1 && alphaStored.effects === 1,
            'a room and an effect were not saved onto the scene: ' + JSON.stringify(alphaStored));

  await switchTo(beta);
  const onBeta = await dm.evaluate('({ rooms: polygons.length, effects: effects.length })');
  rig.check(onBeta.rooms === 0 && onBeta.effects === 0,
            "Alpha's rooms or effects followed the switch onto Beta: " + JSON.stringify(onBeta));

  await switchTo(alpha);
  const backOnAlpha = await dm.evaluate(`({
    rooms: polygons.length, effects: effects.length,
    roomName: polygons.length ? polygons[0].name : null,
    fxName: effects.length ? effects[0].name : null,
    fxMaterial: effects.length ? effects[0].material : null,
  })`);
  rig.note('Alpha on returning: ' + JSON.stringify(backOnAlpha));
  rig.check(backOnAlpha.rooms === 1 && backOnAlpha.effects === 1,
            'coming back to a scene lost its rooms or its effects: ' + JSON.stringify(backOnAlpha));
  rig.check(backOnAlpha.roomName === 'The Vestry',
            "a room came back without the name the DM gave it: " + backOnAlpha.roomName);
  rig.check(backOnAlpha.fxName === 'Burning pews' && backOnAlpha.fxMaterial === 'fire',
            'an effect came back without its name or its material: ' + JSON.stringify(backOnAlpha));

  // ── C. Renaming ───────────────────────────────────────────────────────────
  const rename = (id, value) => dm.evaluate(`(() => {
    const s = allScenes.find(x => x.id === ${JSON.stringify(id)});
    const input = { value: ${JSON.stringify(value)} };
    commitSceneName(s, input);
    return { inMemory: s.name, inField: input.value,
             trigger: (document.getElementById('scene-dd-name') || {}).textContent || '' };
  })()`);

  const renamed = await rename(alpha, '  Watcherhouse Cellars  ');
  rig.note('after renaming: ' + JSON.stringify(renamed));
  rig.check(renamed.inMemory === 'Watcherhouse Cellars',
            'a scene name was not trimmed on the way in: ' + JSON.stringify(renamed.inMemory));
  rig.check(renamed.inField === 'Watcherhouse Cellars',
            'the name field was left holding the untrimmed text the DM typed: ' +
            JSON.stringify(renamed.inField));
  rig.check(renamed.trigger.indexOf('Watcherhouse Cellars') !== -1,
            'the library trigger still shows the old name of the open scene: ' +
            JSON.stringify(renamed.trigger));
  const renamedStored = await waitFor(() => stored(alpha),
                                      v => v && v.name === 'Watcherhouse Cellars', 12000);
  rig.check(!!renamedStored && renamedStored.name === 'Watcherhouse Cellars',
            'the new name never reached the store: ' + JSON.stringify(renamedStored));

  const blanked = await rename(alpha, '   ');
  rig.check(blanked.inMemory === 'Untitled' && blanked.inField === 'Untitled',
            'an emptied name left the scene nameless instead of falling back: ' +
            JSON.stringify(blanked));
  await rename(alpha, 'Alpha');

  // ── D. The order the DM dragged it into ───────────────────────────────────
  const gamma = await importAs('Gamma');
  await switchTo(alpha);
  const startOrder = await library();
  rig.note('order before the drag: ' + JSON.stringify(startOrder));

  // commitDragOrder reads the DOM the DM just rearranged, so the cards are reordered here rather
  // than the array — anything that sorted the array first would test nothing.
  const dragged = await dm.evaluate(`(() => {
    const list = document.getElementById('sm-list');
    if (!list) return { err: 'the scene list is not in the DOM' };
    // ⚠ THE GRID, NOT THE LIST. Cards live inside a .sm-grid inside a .sm-group section, and
    // commitDragOrder walks the sections — a card reparented to #sm-list itself is invisible
    // to it, so the reorder silently loses that scene instead of failing.
    const grid = list.querySelector('.sm-grid');
    if (!grid) return { err: 'no scene grid rendered' };
    const cards = [...grid.querySelectorAll('.sm-card')];
    if (cards.length < 3) return { err: 'only ' + cards.length + ' cards rendered' };
    grid.insertBefore(cards[cards.length - 1], cards[0]);   // last card to the front
    commitDragOrder();
    return { order: allScenes.map(s => s.name), sortOrders: allScenes.map(s => s.sortOrder) };
  })()`);
  rig.note('after the drag: ' + JSON.stringify(dragged));
  rig.check(!dragged.err, 'the scene cards could not be rearranged: ' + dragged.err);
  rig.check(!dragged.err && dragged.order[0] === startOrder[startOrder.length - 1],
            'dragging a card to the front did not move it there: ' + JSON.stringify(dragged.order));
  rig.check(!dragged.err && dragged.sortOrders.join(',') === '0,1,2',
            'the reordered library did not renumber from 0: ' + JSON.stringify(dragged.sortOrders));

  const movedId = await dm.evaluate('allScenes[0].id');
  rig.check((await waitFor(() => stored(movedId), v => v && v.order === 0, 12000) || {}).order === 0,
            'the new order never reached the store, so it is gone on the next restart');

  // ⚠ doAutoSave writes currentScene WHOLESALE, so an order written only to the store is reverted
  // by the next save of the open scene. That is a bug this check exists to catch.
  const openId = await dm.evaluate('currentScene.id');
  const openOrderBefore = await dm.evaluate('currentScene.sortOrder');
  await dm.evaluate('doAutoSave(); 0');
  const afterSave = await waitFor(() => stored(openId), v => v && v.order === openOrderBefore, 12000);
  rig.check(!!afterSave && afterSave.order === openOrderBefore,
            'saving the open scene reverted its place in the library: it is stored at ' +
            (afterSave && afterSave.order) + ' where the reorder put it at ' + openOrderBefore);

  // ── E. Deleting is undoable ───────────────────────────────────────────────
  const toDelete = await dm.evaluate('allScenes.find(s => s.name === "Gamma").id');
  const posBefore = await dm.evaluate('allScenes.findIndex(s => s.name === "Gamma")');
  await dm.evaluate('deleteScenesWithUndo([' + JSON.stringify(toDelete) + ']); 0');
  const afterDelete = await dm.evaluate(`({
    names: allScenes.map(s => s.name),
    toast: (() => { const t = document.getElementById('scene-undo-toast');
                    return !!t && t.style.display !== 'none'; })(),
    toastMsg: (() => { const t = document.getElementById('scene-undo-toast');
                       const m = t && t.querySelector('.undo-msg');
                       return m ? m.textContent : ''; })(),
  })`);
  rig.note('after deleting Gamma: ' + JSON.stringify(afterDelete));
  rig.check(afterDelete.names.indexOf('Gamma') === -1,
            'the deleted scene is still in the library: ' + JSON.stringify(afterDelete.names));
  rig.check(afterDelete.toast, 'deleting a scene offered no way to undo it');
  rig.check(afterDelete.toastMsg.indexOf('Gamma') !== -1,
            'the undo offer does not name the scene it is about: ' +
            JSON.stringify(afterDelete.toastMsg));
  // The record is still on disk while the offer stands. Undo has nothing to restore otherwise.
  rig.check(!!(await stored(toDelete)),
            'the scene was erased from the store while its Undo was still on offer, so pressing ' +
            'Undo would bring back an empty shell');

  await dm.evaluate('undoDelete(); 0');
  const afterUndo = await dm.evaluate(`({
    names: allScenes.map(s => s.name),
    at: allScenes.findIndex(s => s.name === 'Gamma'),
    toast: (() => { const t = document.getElementById('scene-undo-toast');
                    return !!t && t.style.display !== 'none'; })(),
  })`);
  rig.note('after Undo: ' + JSON.stringify(afterUndo));
  rig.check(afterUndo.at !== -1, 'Undo did not bring the deleted scene back');
  rig.check(afterUndo.at === posBefore,
            'Undo brought the scene back in the wrong place: it was at ' + posBefore +
            ' and came back at ' + afterUndo.at);
  rig.check(!afterUndo.toast, 'the undo offer stayed up after it had been taken');

  // ── F. Deleting the scene that is open ────────────────────────────────────
  const openNow = await dm.evaluate('currentScene.id');
  const others = (await ids()).filter(i => i !== openNow);
  await dm.evaluate('deleteScenesWithUndo([' + JSON.stringify(openNow) + ']); 0');
  const landed = await waitFor(() => dm.evaluate('currentScene ? currentScene.id : null'),
                               v => v && v !== openNow, 60000);
  rig.note('after deleting the open scene, the DM landed on: ' + landed);
  rig.check(!!landed && landed !== openNow,
            'deleting the open scene left the DM on no map at all, with a library still full of ' +
            'them: currentScene is ' + landed);
  rig.check(others.indexOf(landed) !== -1,
            'deleting the open scene landed the DM on a scene that is not in the library: ' + landed);
  rig.check(await dm.evaluate('mapWidth > 0'),
            'the DM landed on a scene with no map loaded, so the screen is empty');
  await dm.evaluate('undoDelete(); 0');

  // ── G. A committed delete is final ────────────────────────────────────────
  const doomed = await dm.evaluate('allScenes.find(s => s.id !== currentScene.id).id');
  await dm.evaluate('deleteScenesWithUndo([' + JSON.stringify(doomed) + ']);' +
    ' commitPendingDelete(); 0');
  const gone = await waitFor(() => stored(doomed), v => v === null, 12000);
  rig.check(gone === null,
            'a committed delete left the scene in the store, so it comes back on the next ' +
            'restart: ' + JSON.stringify(gone));
  rig.check((await ids()).indexOf(doomed) === -1,
            'a committed delete left the scene in the library');
  rig.check(!(await dm.evaluate(`(() => { const t = document.getElementById('scene-undo-toast');
              return !!t && t.style.display !== 'none'; })()`)),
            'the undo offer is still up after the delete was committed, so it offers nothing');

  // ── H. A scene that will not load ─────────────────────────────────────────
  // The DM stays where they are and is told why, rather than being left on a blank screen with
  // the library still listing the map.
  const stayedOn = await dm.evaluate('currentScene.id');
  // ⚠ THE RECOVERY IS ASYNCHRONOUS. onSwitchSceneError switches BACK to the scene that worked, so
  // reading currentScene the instant the failed switch returns catches the gap and reports the
  // recovery as a failure. Polled.
  //
  // ⚠ THE STUB THROWS FOR THE UNKNOWN ID ALONE, and that is what makes this check about the app
  // rather than about its scheduling. A stub that threw for EVERY id also breaks the recovery's own
  // load, so the file would only pass while onSwitchSceneError defers through setTimeout(…, 0) —
  // and an ordinary refactor to an awaited recovery would fail it on a healthy app. Scoping the
  // stub also means it can be left in place for the whole poll below rather than removed on a
  // timing assumption.
  await dm.evaluate(`(async () => {
    globalThis.__rigOrigLoad = sceneStore.loadScene;
    sceneStore.loadScene = async (id) => {
      if (id === 'no-such-scene-id') throw new Error('rig: the map is missing');
      return globalThis.__rigOrigLoad.call(sceneStore, id);
    };
    try { await switchScene('no-such-scene-id'); } catch (_) {}
    return 0;
  })()`, 60000);
  await waitFor(() => dm.evaluate('currentScene ? currentScene.id : null'), v => v !== null, 30000);
  await dm.evaluate('sceneStore.loadScene = globalThis.__rigOrigLoad; 0');
  const brokenSwitch = await dm.evaluate(`(() => {
    const a = document.getElementById('cd-anchor');
    return { on: currentScene ? currentScene.id : null, mapW: mapWidth,
             dialog: !!a && a.style.display === 'flex',
             msg: (document.getElementById('cd-msg') || {}).textContent || '' };
  })()`);
  rig.note('a switch that could not load: ' + JSON.stringify(brokenSwitch));
  rig.check(brokenSwitch.on === stayedOn,
            'a scene that would not load left the DM on nothing rather than on the map they ' +
            'were already using: currentScene is ' + brokenSwitch.on);
  rig.check(brokenSwitch.mapW > 0,
            'a failed switch left the DM with no map loaded: mapWidth ' + brokenSwitch.mapW);
  rig.check(brokenSwitch.dialog && brokenSwitch.msg.length > 0,
            'a scene that would not load said nothing at all: ' + JSON.stringify(brokenSwitch));
  await dm.evaluate('(() => { const b = document.getElementById("cd-ok");' +
    ' if (b) b.click(); return 0; })()');

  rig.byEye('dragging scene cards by hand in the real dropdown — the drag itself is a pointer ' +
            'gesture on a list that scrolls, and only the order it commits is checked here');
};
