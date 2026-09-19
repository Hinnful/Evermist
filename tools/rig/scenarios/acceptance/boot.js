'use strict';

// boot.js — THE SECOND BOOT. The app started again on a library that already holds maps.
//
// THE GOAL OF THIS FEATURE: the DM closes Evermist after a session and opens it before the next
// one. What they left is what they find - the same map, the same fog, the same rooms, the same
// library. Every check below serves that sentence.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks under a marker carrying its
// letter, wherever in the file that state is cheapest to reach - which is not letter order.
//
//   A. The app comes up on the scene that was open when it was last closed, with its map at the
//      map's own size.
//   B. The fog the DM revealed before the shutdown is the fog that comes back.
//   C. The reopened scene brings its rooms, its effects, its grid and its fog look.
//   D. The whole library comes back, in the order it was left in and under the group it was
//      filed under.
//   E. The campaign's module text outlives the app, not just the scene.
//   F. The Player opened after a restart gets the restored map, fog and all.
//   G. A remembered scene that is no longer in the library leaves the DM on no map, with the
//      library still painted - not on a half-loaded scene and not behind an error.
//
// ⚠ EVERY OTHER SCENARIO BOOTS ONTO AN EMPTY LIBRARY, and run.js refuses to start against one
// that is not empty - that refusal is how profile isolation is PROVEN. So nothing else in the
// suite has ever exercised the app's startup path with content in it: which scene reopens, how
// the library paints first, an older record read back wrong. Those faults reach the table and
// no other check can see them.
//
// ⚠ rig.restart() RETURNS THE NEW SESSION AND THE OLD ONE IS DEAD. A `const dm = rig.dm` taken
// at the top of a file is a closed socket after a restart, and every evaluate on it throws
// rather than reporting anything. `dm` is a `let` here for that reason.
//
// ⚠ THE HELPERS GO BACK IN AFTER EVERY RESTART. They live on the page, and the page is new.

const lib = require('../../lib');

const MAP_W = 1400;
const MAP_H = 900;
const MAP2_W = 900;
const MAP2_H = 600;

// ⚠ OUTSIDE THE SHROUD ROOM BELOW. A reveal inside one is repainted shrouded when the
// scene reloads and rebuilds its fog from the rooms, so the check would report the app as
// losing a reveal it correctly put back.
const REVEAL = { x: 1150, y: 250, r: 110 };
const UNTOUCHED = { x: 1200, y: 800 };
const GRID_SIZE = 93;
const FOG_HEX = '#7a2f2f';

// The shape module-text.js proved the parser takes: a heading, prose, a blank line.
const BOOK = [
  'K1. The Gatehouse',
  'Two guards stand here, bored and cold. They have not been paid in a month.',
  '',
  'K2. The Long Hall',
  'Banners hang from the rafters, each from a house that no longer exists.',
  '',
].join(String.fromCharCode(10));

module.exports = async function boot(rig) {
  let dm = rig.dm;

  // ── The session before the shutdown ───────────────────────────────────────
  await lib.openMap(rig, { w: MAP_W, h: MAP_H });
  const sceneOne = await dm.evaluate('currentScene.id');
  await dm.evaluate('(() => { const s = allScenes.find(x => x.id === "' + sceneOne + '");' +
                    ' commitSceneName(s, { value: "The Sunken Abbey" }); return 0; })()');

  await dm.evaluate('__rigDrawShroud(300, 300, 700, 700); 0');
  await dm.evaluate('setPlaceMode("effects"); setShape("rect"); __rigDrag(800, 300, 1000, 500);' +
                    ' setPlaceMode("rooms"); setShape("select"); 0');
  // ⚠ THE CONTROLS LISTEN ON `input`, NOT `change`. A `change` event sets the field and the app
  // never hears it, so the value reads as the default and the criterion passes on a fresh app.
  await dm.evaluate('(() => { if (!gridEnabled) document.getElementById("btn-grid").click();' +
                    ' return 0; })()');
  await lib.fire(dm, 'grid-size-num', GRID_SIZE);
  await lib.fire(dm, 'fog-color', FOG_HEX);

  // A second scene, filed under a group, so the library has both an order and a heading to
  // restore.
  await lib.openMap(rig, { w: MAP2_W, h: MAP2_H });
  const sceneTwo = await dm.evaluate('currentScene.id');
  await dm.evaluate('(() => { const s = allScenes.find(x => x.id === "' + sceneTwo + '");' +
                    ' commitSceneName(s, { value: "The Drowned Stair" }); return 0; })()');
  await dm.evaluate('smAssignGroup(' + JSON.stringify([sceneTwo]) + ', "Chapter One"); 0');

  // Back to the first, so IT is the scene the app has to reopen.
  await dm.evaluate('switchScene("' + sceneOne + '"); 0', 120000);
  await dm.waitFor('currentScene && currentScene.id === "' + sceneOne + '" && mapWidth === ' + MAP_W,
                   120000, 'the abbey to come back before the reveal');
  await lib.settle(dm, 'fogCoverT === 0', 45000);

  // Exactly what the brush does on mouseup.
  await dm.evaluate('revealCircle(' + REVEAL.x + ',' + REVEAL.y + ',' + REVEAL.r + ');' +
                    ' fogDirty = true; scheduleRender(); scheduleAutoSave(); 0');
  const before = await dm.evaluate(`({
    fogAt: __rigFog(${REVEAL.x}, ${REVEAL.y}),
    rooms: polygons.length, effects: effects.length,
    grid: gridSize, hex: fogPickedHex,
    order: allScenes.map(s => s.id),
    remembered: localStorage.getItem('evermist-current-scene-id'),
  })`);
  rig.note('before the shutdown: ' + JSON.stringify(before));
  rig.check(before.fogAt === 0 && before.rooms === 1 && before.effects === 1,
            'the session never reached the state this file restarts from, so nothing below is ' +
            'about a restart: ' + JSON.stringify(before));
  rig.check(before.grid === GRID_SIZE && before.hex === FOG_HEX,
            'the grid and the fog colour were not dialled off their defaults, so criterion C ' +
            'would pass on a fresh app: ' + JSON.stringify(before));
  rig.check(before.remembered === sceneOne,
            'the app did not remember the open scene before it was closed, so criterion A would ' +
            'be checking a default rather than a memory: ' + before.remembered);

  // ⚠ WAITED FOR ON DISK, never slept through. The autosave runs on a five-second timer, then
  // encodes the whole fog canvas and writes it. A restart that beats it proves nothing about
  // persistence; it only proves the timer lost.
  const saved = await lib.poll(async () => {
    const got = await dm.evaluate(`(async () => {
      try {
        const s = await sceneStore.loadScene('${sceneOne}');
        if (!s || !s.baseFogBlob) return { fog: false };
        // The saved blob is READ, not just counted. The autosave fires on a timer, so a save
        // that ran before the reveal satisfies "there is fog on disk", and the restart then
        // finds no reveal - which reads as the app having lost it.
        const bmp = await createImageBitmap(s.baseFogBlob);
        const c = document.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        const cx = c.getContext('2d');
        cx.drawImage(bmp, 0, 0);
        const at = cx.getImageData(Math.round(${REVEAL.x} / FOG_SCALE),
                                   Math.round(${REVEAL.y} / FOG_SCALE), 1, 1).data[3];
        return { fog: true, at: at, rooms: (s.polygons || []).length,
                 effects: (s.effects || []).length,
                 grid: s.gridConfig ? s.gridConfig.cellSize : null,
                 hex: s.fogSettings ? s.fogSettings.pickedHex : null };
      } catch (e) { return { err: String(e) }; }
    })()`, 30000);
    return (got && got.fog && got.at === 0 && got.rooms === 1 && got.grid === GRID_SIZE)
      ? got : null;
  }, 40000);
  rig.note('on disk before the shutdown: ' + JSON.stringify(saved));
  rig.check(!!saved,
            'the autosave never committed the session to disk, so the restart below would find ' +
            'nothing whatever the app does on boot');

  // ══ THE RESTART ══════════════════════════════════════════════════════════
  dm = await rig.restart();
  await lib.installHelpers(dm);

  // ── A. The app comes up on the scene it was left on ──────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  // ⚠ POLLED. initScenes opens the database, lists the library and only then calls switchScene,
  // and the DM's ready signal fires before any of that. A single read lands on an app with no
  // map at all and reports the feature as broken.
  await lib.settle(dm, 'currentScene && currentScene.id === "' + sceneOne + '"', 90000);
  const reopened = await dm.evaluate(`({
    id: currentScene ? currentScene.id : null,
    name: currentScene ? currentScene.name : null,
    w: mapWidth, h: mapHeight,
    type: currentScene ? currentScene.mapType : null,
  })`);
  rig.note('after the restart: ' + JSON.stringify(reopened));
  rig.check(reopened.id === sceneOne,
            'the app came up on "' + reopened.name + '" instead of the scene the DM left open, ' +
            'so every session starts by hunting for the map that was already on screen');
  rig.check(reopened.w === MAP_W && reopened.h === MAP_H,
            'the reopened map came back at ' + reopened.w + 'x' + reopened.h +
            ' instead of its own ' + MAP_W + 'x' + MAP_H);
  rig.check(reopened.type === 'video',
            'the reopened map is "' + reopened.type + '" rather than the animated map it was');

  // ── B. The fog comes back ────────────────────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  await lib.settle(dm, 'fogCoverT === 0', 45000);
  const fog = await dm.evaluate('({ at: __rigFog(' + REVEAL.x + ',' + REVEAL.y + '),' +
                                ' away: __rigFog(' + UNTOUCHED.x + ',' + UNTOUCHED.y + ') })');
  rig.note('fog after the restart: ' + JSON.stringify(fog));
  rig.check(fog.at === 0,
            'the ground the DM cleared before the shutdown came back fogged (alpha ' + fog.at +
            "), so a session's reveals do not survive closing the app");
  rig.check(fog.away > 200,
            'ground nobody entered came back clear (alpha ' + fog.away +
            '), so the restart handed the players the whole map');

  // ── C. Rooms, effects, grid and fog look ─────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  const carried = await dm.evaluate(`({
    rooms: polygons.length, effects: effects.length,
    mode: polygons[0] ? polygons[0].mode : null,
    grid: gridSize, hex: fogPickedHex,
  })`);
  rig.note('what the reopened scene carried: ' + JSON.stringify(carried));
  rig.check(carried.rooms === 1 && carried.mode === 'shroud',
            'the room the DM drew did not come back on the reopened scene: ' +
            JSON.stringify(carried));
  rig.check(carried.effects === 1,
            'the effect did not come back on the reopened scene, and effects are placed during ' +
            'play: ' + JSON.stringify(carried));
  rig.check(carried.grid === GRID_SIZE,
            'the grid came back at ' + carried.grid + ' instead of the ' + GRID_SIZE +
            ' the DM fitted to this map');
  rig.check(carried.hex === FOG_HEX,
            'the fog colour came back as ' + carried.hex + ' instead of the ' + FOG_HEX +
            ' the DM dialled in');

  // ── D. The library comes back whole, in order, under its group ───────────
  // RED BY DESIGN: written against the fix, never re-proved
  const library = await dm.evaluate(`(async () => {
    const stored = await sceneStore.listScenes();
    return {
      count: allScenes.length,
      order: allScenes.map(s => s.id),
      names: allScenes.map(s => s.name),
      groups: allScenes.map(s => s.group || null),
      onDisk: stored.length,
      // A named group's heading is an <input>, so its name is in .value. textContent there is
      // the count span alone, and every heading reads as a number.
      headings: Array.from(document.querySelectorAll('#sm-list .sm-group-name'))
        .map(h => (h.value != null ? h.value : h.textContent).trim()),
      cards: document.querySelectorAll('#sm-list .sm-card').length,
    };
  })()`, 30000);
  rig.note('the library after the restart: ' + JSON.stringify(library));
  rig.check(library.count === 2 && library.onDisk === 2,
            'the library came back with ' + library.count + ' scenes in memory and ' +
            library.onDisk + ' on disk, against the 2 that were left there');
  rig.check(library.cards === 2,
            'the library holds 2 scenes and painted ' + library.cards +
            ' cards, so a map the DM saved is not reachable after a restart');
  rig.check(JSON.stringify(library.order) === JSON.stringify(before.order),
            'the library came back in a different order from the one it was left in: ' +
            JSON.stringify(library.names));
  rig.check(library.groups.filter(g => g === 'Chapter One').length === 1,
            'the group a scene was filed under did not survive the restart, so a filed library ' +
            'comes back flat: ' + JSON.stringify(library.groups));
  rig.check(library.headings.indexOf('Chapter One') !== -1,
            'the library painted no "Chapter One" heading after the restart, so the group is in ' +
            'the record and not on screen: ' + JSON.stringify(library.headings));

  // ── E. The module text outlives the app ──────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  // Loaded after the first restart and checked across a second, so it cannot pass on a value
  // that merely stayed in memory from the session that wrote it.
  await dm.evaluate(`(() => {
    globalThis.__rigPickModule = file => {
      const inp = document.getElementById('mt-file-input');
      inp.files = (() => { const dt = new DataTransfer(); dt.items.add(file); return dt.files; })();
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      return inp.files.length;
    };
    0
  })()`);
  await dm.evaluate('openModuleTextModal(); 0');
  // ⚠ THE SHAPE THE PARSER TAKES, copied from module-text.js: a heading line, prose under
  // it, a blank line between entries. Prose with no heading parses to nothing, and the restart
  // below would then be checking that zero entries survive zero entries.
  await dm.evaluate('__rigPickModule(new File([' + JSON.stringify(BOOK) + '], ' +
    '"Abbey.txt", { type: "text/plain" }))');
  await lib.settle(dm, 'mtEntries && mtEntries.length > 0', 20000);
  await dm.evaluate('closeModuleTextModal(); 0');
  const bookBefore = await dm.evaluate('({ n: mtEntries.length, source: mtSourceName || null })');
  rig.check(bookBefore.n > 0,
            'the module text never parsed, so the restart below checks nothing: ' +
            JSON.stringify(bookBefore));

  dm = await rig.restart();
  await lib.installHelpers(dm);
  await lib.settle(dm, 'typeof mtEntries !== "undefined" && mtEntries.length > 0', 30000);
  const bookAfter = await dm.evaluate(
    '({ n: (typeof mtEntries === "undefined" ? 0 : mtEntries.length),' +
    ' source: (typeof mtSourceName === "undefined" ? null : mtSourceName) || null })');
  rig.note('the module text across a restart: ' + JSON.stringify(bookBefore) + ' → ' +
           JSON.stringify(bookAfter));
  rig.check(bookAfter.n === bookBefore.n && bookAfter.source === bookBefore.source,
            "the campaign's module text did not survive the restart, so the DM re-imports the " +
            'book every session: ' + JSON.stringify(bookAfter));

  // ── F. The Player after a restart gets the restored map ──────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  await lib.settle(dm, 'currentScene && currentScene.id === "' + sceneOne + '"', 90000);
  await lib.settle(dm, 'fogCoverT === 0', 45000);
  const player = await rig.player();
  await player.waitFor('!!mapOffscreen && !!fogDataCanvas', 60000,
                       'the restored map to reach the Player');
  await player.waitFor('fogCoverT === 0', 45000, 'the scene cover to lift on the Player');
  const tv = await player.evaluate('({ w: mapWidth, h: mapHeight,' +
    ' at: (' + lib.TV_FOG + ')(' + REVEAL.x + ',' + REVEAL.y + '),' +
    ' away: (' + lib.TV_FOG + ')(' + UNTOUCHED.x + ',' + UNTOUCHED.y + ') })');
  rig.note('the Player after a restart: ' + JSON.stringify(tv));
  rig.check(tv.w === MAP_W && tv.h === MAP_H,
            'the Player got the restored map at ' + tv.w + 'x' + tv.h + ' instead of its own ' +
            MAP_W + 'x' + MAP_H);
  rig.check(tv.at < 60,
            'the ground the DM cleared before the shutdown is still fogged on the TV after a ' +
            'restart (alpha ' + tv.at + ')');
  rig.check(tv.away > 200,
            'ground nobody entered reached the TV clear after a restart (alpha ' + tv.away + ')');

  // ── G. A remembered scene that is gone ───────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  // ⚠ LAST, because it leaves the app on no map. The id points at a scene that never existed,
  // which is what a library carried onto another machine looks like.
  await dm.evaluate('localStorage.setItem("evermist-current-scene-id", "no-such-scene-id"); 0');
  dm = await rig.restart();
  await lib.settle(dm, 'allScenes && allScenes.length === 2', 90000);
  const orphan = await dm.evaluate(`({
    scene: currentScene ? currentScene.id : null,
    count: allScenes.length,
    cards: document.querySelectorAll('#sm-list .sm-card').length,
    // The anchor is built by the first dialog, so a clean startup has none at all - which
    // is the answer this criterion wants.
    dialog: (() => { const a = document.getElementById('cd-anchor');
                     return a ? getComputedStyle(a).display : 'absent'; })(),
  })`);
  rig.note('after a restart onto a scene that is gone: ' + JSON.stringify(orphan));
  rig.check(orphan.scene === null,
            'the app claims to have opened "' + orphan.scene + '", which is not in the library');
  rig.check(orphan.count === 2 && orphan.cards === 2,
            'the library did not paint after the remembered scene turned out to be missing, so ' +
            'the DM comes up with no way to pick a map at all: ' + JSON.stringify(orphan));
  rig.check(orphan.dialog !== 'flex',
            'a remembered scene that is simply gone put a dialog in front of the DM on startup');
};
