'use strict';

// undo.js — UNDO AND REDO, whole.
//
// THE GOAL OF THIS FEATURE: the DM can be wrong in front of the players and take it back
// instantly. Ctrl+Z reverses the last thing that changed the map — fog, rooms, effects, all one
// history — and Ctrl+Y puts it back. Nothing about the reversal costs the DM their place: the room
// they were reading stays open, and the TV follows. Every check below serves that sentence.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks directly beneath it, in order.
//
//   A. Ctrl+Z reverses the last change and Ctrl+Y puts it back, over several steps, in order.
//        Ctrl+Shift+Z is the same as Ctrl+Y
//   B. Undo with nothing to undo does nothing at all, and neither does redo.
//   C. Fog, rooms and effects are ONE history, so a Ctrl+Z reverses whichever came last.
//   D. A new change after an undo throws the redo away rather than leaving a branch.
//   E. Undo keeps the room card open on a room that survived, and closes it on one that did not.
//   F. An undo reaches the Player, because the fog it restored is the fog the table must see.
//   G. Ctrl+Z typed into the room's name or notes edits the text, never the map.
//   H. The history is bounded by memory, and eviction always leaves something to undo.
//
// The byte-arithmetic of eviction is unit-tested (test/, evictUndoStack and evictUndoPair). What
// is here is the behaviour those functions serve, driven through the real keyboard.
//
// ⚠ EVERY STEP IS DRIVEN BY THE REAL KEYSTROKE, not by calling undo(). The shortcut is guarded —
// it returns early for a keystroke aimed at an INPUT or a TEXTAREA — and section G is entirely
// about that guard. A file that called undo() directly would pass with the guard deleted and the
// DM's typing eating the map.
//
// ⚠ THE SNAPSHOT IS TAKEN BEFORE THE CHANGE, BY THE CALLER. pushUndo() captures the state as it
// is now, so a scenario must push, then change — pushing after changing records the new state as
// the thing to go back to, and every check passes while undo does nothing.
//
// ⚠ SECTION G IS GUARDED TWICE, AND EITHER GUARD ALONE HOLDS. The room card's fields stop the
// keydown at source (roomPanel.js `_rpWireField`) and input.js's own handler returns early for an
// INPUT or a TEXTAREA. Breaking one to watch section G go red proves nothing — the other catches
// it. Both have to go at once, which is also why neither is safe to "tidy away as redundant".
//
// ⚠ THE MAP IS ANIMATED, AND EVERY ACCEPTANCE FILE'S IS. Animated is the only kind the DM
// ever uses, so a suite running on still PNGs proved the app worked in a case that never
// happens. `tableMap` (tools/rig/fixtures.js) records the clip once per run and caches it by
// size. Do not swap it back to `stillMap`; smoke.js is the one file that wants both.

const MAP_W = 1400, MAP_H = 900;
const A = { x: 300, y: 250, r: 150 };      // first reveal
const B = { x: 900, y: 650, r: 150 };      // second reveal, far enough not to touch the first
const ROOM = { x1: 500, y1: 150, x2: 800, y2: 380 };
const FX = { x1: 500, y1: 550, x2: 780, y2: 780 };

module.exports = async function undoFeature(rig) {
  const dm = rig.dm;

  const map = await rig.fixtures.tableMap(dm, rig.fixtureDir,
    { w: MAP_W, h: MAP_H });
  const expr = await rig.fixtures.asFileExpr(dm, map);
  await dm.evaluate('createNewScene(' + expr + ')', 120000);
  await dm.waitFor('currentScene && mapWidth === ' + MAP_W, 120000, 'the map to load on the DM');
  await dm.waitFor('fogCoverT === 0', 30000, 'the scene cover to lift');

  // The real keystroke, on the document, exactly as the DM's keyboard delivers it.
  const key = (k, mods) => dm.evaluate('(() => { document.dispatchEvent(new KeyboardEvent(' +
    '"keydown", Object.assign({ key: ' + JSON.stringify(k) + ', bubbles: true,' +
    ' cancelable: true }, ' + JSON.stringify(mods || {}) + '))); return 0; })()');
  const undoKey = () => key('z', { ctrlKey: true });
  const redoKey = () => key('y', { ctrlKey: true });
  const redoKeyAlt = () => key('z', { ctrlKey: true, shiftKey: true });

  const settle = () => rig.sleep(350);

  const fog = (x, y) => dm.evaluate('fogDataCtx.getImageData(Math.round(' + x +
    ' / FOG_SCALE), Math.round(' + y + ' / FOG_SCALE), 1, 1).data[3]');

  const depths = () => dm.evaluate('({ undo: undoStack.length, redo: redoStack.length })');

  const shapes = () => dm.evaluate('({ rooms: polygons.map(p => p.name),' +
    ' effects: effects.map(e => e.name), selected: selectedPolygonId })');

  const reveal = (c) => dm.evaluate('pushUndo(); revealCircle(' + c.x + ',' + c.y + ',' + c.r +
    '); fogDirty = true; scheduleRender(); scheduleAutoSync(); 0');

  // ── A. Two steps back and two steps forward ───────────────────────────────
  await dm.evaluate('document.getElementById("btn-fill-fog").click(); 0');
  await settle();
  await dm.evaluate('undoStack = []; redoStack = []; 0');

  await reveal(A);
  await reveal(B);
  rig.check(await fog(A.x, A.y) === 0 && await fog(B.x, B.y) === 0,
            'the two reveals did not both take, so nothing below is about undo');

  await undoKey();
  await settle();
  const oneBack = { a: await fog(A.x, A.y), b: await fog(B.x, B.y) };
  rig.note('one step back: ' + JSON.stringify(oneBack));
  rig.check(oneBack.b > 200,
            'Ctrl+Z did not reverse the last reveal: it is still clear (alpha ' + oneBack.b + ')');
  rig.check(oneBack.a === 0,
            'Ctrl+Z reversed more than the last change: the earlier reveal went with it');

  await undoKey();
  await settle();
  rig.check(await fog(A.x, A.y) > 200,
            'a second Ctrl+Z did not reverse the earlier reveal: alpha ' + await fog(A.x, A.y));

  await redoKey();
  await settle();
  const oneForward = { a: await fog(A.x, A.y), b: await fog(B.x, B.y) };
  rig.note('one step forward: ' + JSON.stringify(oneForward));
  rig.check(oneForward.a === 0,
            'Ctrl+Y did not put the first reveal back: alpha ' + oneForward.a);
  rig.check(oneForward.b > 200,
            'Ctrl+Y went forward more than one step: the later reveal came back too');

  await redoKeyAlt();
  await settle();
  rig.check(await fog(B.x, B.y) === 0,
            'Ctrl+Shift+Z is not the same as Ctrl+Y: the later reveal did not come back (alpha ' +
            await fog(B.x, B.y) + ')');

  // ── B. Nothing to undo ────────────────────────────────────────────────────
  await dm.evaluate('undoStack = []; redoStack = []; 0');
  const beforeNothing = { a: await fog(A.x, A.y), b: await fog(B.x, B.y) };
  await undoKey();
  await undoKey();
  await redoKey();
  await settle();
  const afterNothing = { a: await fog(A.x, A.y), b: await fog(B.x, B.y) };
  rig.check(afterNothing.a === beforeNothing.a && afterNothing.b === beforeNothing.b,
            'Ctrl+Z or Ctrl+Y with an empty history changed the map: ' +
            JSON.stringify(beforeNothing) + ' → ' + JSON.stringify(afterNothing));
  const emptyDepths = await depths();
  rig.check(emptyDepths.undo === 0 && emptyDepths.redo === 0,
            'undo or redo on an empty history pushed something onto the other stack: ' +
            JSON.stringify(emptyDepths));

  // ── C. One history for fog, rooms and effects ─────────────────────────────
  await dm.evaluate(`(() => {
    pushUndo();
    polygons = [{ id: 1, vertices: [
      { x: ${ROOM.x1}, y: ${ROOM.y1} }, { x: ${ROOM.x2}, y: ${ROOM.y1} },
      { x: ${ROOM.x2}, y: ${ROOM.y2} }, { x: ${ROOM.x1}, y: ${ROOM.y2} },
    ], mode: 'shroud', cornerRadius: 0, name: 'The Vestry' }];
    nextPolygonId = 2;
    rebuildFogFromPolygons(); fogDirty = true; scheduleRender();
    return 0;
  })()`);
  await dm.evaluate(`(() => {
    pushUndo();
    setEffects([{ id: 1, vertices: [
      { x: ${FX.x1}, y: ${FX.y1} }, { x: ${FX.x2}, y: ${FX.y1} },
      { x: ${FX.x2}, y: ${FX.y2} }, { x: ${FX.x1}, y: ${FX.y2} },
    ], material: 'fire', cornerRadius: 0, name: 'Burning pews' }]);
    nextEffectId = 2;
    rebuildFogEffect(); fogDirty = true; scheduleRender();
    return 0;
  })()`);
  const withBoth = await shapes();
  rig.check(withBoth.rooms.length === 1 && withBoth.effects.length === 1,
            'the room and the effect were not both placed: ' + JSON.stringify(withBoth));

  await undoKey();
  await settle();
  const afterOne = await shapes();
  rig.note('after one Ctrl+Z over an effect placed last: ' + JSON.stringify(afterOne));
  rig.check(afterOne.effects.length === 0,
            'Ctrl+Z did not reverse the effect that was placed last: ' +
            JSON.stringify(afterOne.effects));
  rig.check(afterOne.rooms.length === 1,
            'Ctrl+Z took the room with the effect, so the two are not one history in order: ' +
            JSON.stringify(afterOne.rooms));

  await undoKey();
  await settle();
  const afterTwo = await shapes();
  rig.check(afterTwo.rooms.length === 0,
            'a second Ctrl+Z did not reverse the room: ' + JSON.stringify(afterTwo.rooms));

  await redoKey();
  await redoKey();
  await settle();
  const bothBack = await shapes();
  rig.check(bothBack.rooms.length === 1 && bothBack.effects.length === 1,
            'redoing twice did not bring the room and the effect back: ' +
            JSON.stringify(bothBack));
  rig.check(bothBack.effects[0] === 'Burning pews',
            'an effect came back through redo without its name: ' + JSON.stringify(bothBack.effects));

  // ── D. A new change throws the redo away ──────────────────────────────────
  await undoKey();
  await settle();
  rig.check((await depths()).redo > 0, 'an undo left nothing to redo, so section D proves nothing');
  await reveal(A);
  const afterNew = await depths();
  rig.note('depths after a fresh change following an undo: ' + JSON.stringify(afterNew));
  rig.check(afterNew.redo === 0,
            'a change made after an undo left the redo history in place, so Ctrl+Y would jump ' +
            'the DM onto a branch that no longer exists: ' + afterNew.redo + ' steps still there');
  await redoKey();
  await settle();
  rig.check((await shapes()).effects.length === 0,
            'Ctrl+Y after a fresh change brought back the discarded branch');

  // ── E. The room card keeps its place ──────────────────────────────────────
  // Nulling the selection on every Ctrl+Z slammed the card shut mid-read. It closes only where
  // the room itself is gone.
  await dm.evaluate('selectedPolygonId = polygons[0].id; refreshRoomPanel(); 0');
  await reveal(B);
  await undoKey();
  await settle();
  const keptCard = await shapes();
  rig.check(keptCard.selected !== null && keptCard.rooms.length === 1,
            'undoing a fog change closed the room card on a room that is still there: ' +
            JSON.stringify(keptCard));

  await dm.evaluate(`(() => {
    pushUndo();
    polygons = polygons.concat([{ id: nextPolygonId++, vertices: [
      { x: 100, y: 700 }, { x: 300, y: 700 }, { x: 300, y: 850 }, { x: 100, y: 850 },
    ], mode: 'shroud', cornerRadius: 0, name: 'The Crypt' }]);
    selectedPolygonId = polygons[polygons.length - 1].id;
    rebuildFogFromPolygons(); refreshRoomPanel();
    return 0;
  })()`);
  await undoKey();
  await settle();
  const closedCard = await shapes();
  rig.note('after undoing the room that was selected: ' + JSON.stringify(closedCard));
  rig.check(closedCard.rooms.length === 1 && closedCard.rooms.indexOf('The Crypt') === -1,
            'undoing a room the DM had just drawn did not remove it: ' +
            JSON.stringify(closedCard.rooms));
  rig.check(closedCard.selected === null,
            'the room card stayed open on a room that no longer exists: selected is ' +
            closedCard.selected);

  // ── F. An undo reaches the Player ─────────────────────────────────────────
  rig.check(await dm.evaluate('autoSync === true'),
            'auto-sync is off, so no undo could reach the Player and the check below would be ' +
            "reading the Player's own state");
  const player = await rig.player();
  await player.waitFor('!!mapOffscreen && !!fogDataCanvas', 45000, 'the Player to receive the map');
  await player.waitFor('fogCoverT === 0', 45000, 'the scene cover to lift on the Player');

  const playerFog = (x, y) => player.evaluate('fogDataCtx.getImageData(Math.round(' + x +
    ' / FOG_SCALE), Math.round(' + y + ' / FOG_SCALE), 1, 1).data[3]');
  const waitPlayerFog = async (x, y, ok, ms) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const v = await playerFog(x, y);
      if (ok(v) || Date.now() > deadline) return v;
      await rig.sleep(250);
    }
  };

  await dm.evaluate('document.getElementById("btn-fill-fog").click(); 0');
  await settle();
  await reveal(A);
  const sawReveal = await waitPlayerFog(A.x, A.y, v => v === 0, 30000);
  rig.check(sawReveal === 0,
            'the reveal never reached the Player, so the undo below has nothing to be seen ' +
            'reversing: alpha ' + sawReveal);

  await undoKey();
  const sawUndo = await waitPlayerFog(A.x, A.y, v => v > 200, 30000);
  rig.note('the Player after the undo: alpha ' + sawUndo);
  rig.check(sawUndo > 200,
            'an undo never reached the TV, so the players can still see ground the DM has just ' +
            'taken back: alpha ' + sawUndo);

  // ── G. Ctrl+Z while typing belongs to the text ────────────────────────────
  // The room card's notes field is a textarea, and the shortcut must not reach the map from it.
  await dm.evaluate('selectedPolygonId = polygons[0].id; refreshRoomPanel(); 0');
  await reveal(B);
  const beforeTyping = await depths();
  const typed = await dm.evaluate(`(() => {
    const el = document.getElementById('rp-desc') || document.querySelector('#room-panel textarea');
    if (!el) return { err: 'the room card has no notes field' };
    el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown',
      { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    return { ok: true, tag: el.tagName };
  })()`);
  if (rig.check(!typed.err, 'the room card has no notes field to type into: ' + typed.err)) {
    await settle();
    const afterTyping = await depths();
    rig.note('typing Ctrl+Z into the ' + typed.tag + ': depths ' +
             JSON.stringify(beforeTyping) + ' → ' + JSON.stringify(afterTyping));
    rig.check(afterTyping.undo === beforeTyping.undo && afterTyping.redo === beforeTyping.redo,
              'Ctrl+Z typed into the room notes reached the map shortcuts and undid a fog ' +
              'change: depths went ' + JSON.stringify(beforeTyping) + ' → ' +
              JSON.stringify(afterTyping));
    rig.check(await fog(B.x, B.y) === 0,
              'Ctrl+Z typed into the room notes reversed the last reveal on the map');
  }

  const namedField = await dm.evaluate(`(() => {
    const el = document.getElementById('rp-name') || document.querySelector('#room-panel input');
    if (!el) return { err: 'the room card has no name field' };
    el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown',
      { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    return { ok: true };
  })()`);
  if (!namedField.err) {
    await settle();
    rig.check(await fog(B.x, B.y) === 0,
              "Ctrl+Z typed into the room's name field reversed the last reveal on the map");
  }

  // ── H. The history is bounded, and never emptied by eviction ──────────────
  // ⚠ ENOUGH PUSHES TO ACTUALLY EVICT, and the count is derived rather than guessed: a fixed
  // number that happens to stay inside the budget makes every check here pass for nothing. The
  // fog canvas on this map is about 315KB a snapshot, so the ceiling is a few hundred entries.
  const evicted = await dm.evaluate(`(() => {
    const per = baseFogCanvas.width * baseFogCanvas.height * 4;
    const pushes = Math.ceil(UNDO_MAX_BYTES / per) + 40;
    for (let i = 0; i < pushes; i++) { pushUndo(); revealCircle(200 + (i % 100) * 8, 800, 20); }
    const bytes = s => s.reduce((t, e) => t + e.baseFog.width * e.baseFog.height * 4, 0);
    return { pushes, per, depth: undoStack.length, bytes: bytes(undoStack), max: UNDO_MAX_BYTES };
  })()`, 180000);
  rig.note('after ' + evicted.pushes + ' pushes: ' + JSON.stringify(evicted));
  rig.check(evicted.depth < evicted.pushes,
            'the undo history took every one of ' + evicted.pushes + ' steps without evicting ' +
            'anything, so nothing below is about the memory ceiling');
  rig.check(evicted.bytes <= evicted.max,
            'the undo history is over its memory budget, which is what runs the app out of ' +
            'memory at the table: ' + evicted.bytes + ' bytes against a ' + evicted.max +
            ' ceiling');
  rig.check(evicted.depth >= 1,
            'eviction emptied the undo history, so the DM has nothing to take back at all');
  // A history sitting on the ceiling still undoes. It loses MORE than one entry doing it — the
  // redo step it pushes is charged to the same budget, so an undo entry is evicted to pay for it —
  // which is why this counts a step being taken rather than a depth going down by exactly one.
  await undoKey();
  await settle();
  const afterEvicted = await depths();
  rig.note('the evicted history after one Ctrl+Z: ' + JSON.stringify(afterEvicted));
  rig.check(afterEvicted.undo < evicted.depth && afterEvicted.redo >= 1,
            'a history sitting on its memory ceiling would not undo at all: ' +
            JSON.stringify(afterEvicted));
};
