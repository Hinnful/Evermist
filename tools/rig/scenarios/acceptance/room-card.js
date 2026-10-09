'use strict';

// room-card.js — THE ROOM TAB AND THE ROOM LABELS, whole.
//
// THE GOAL OF THIS FEATURE: the DM clicks a room and reads what is in it — its name, the notes
// they wrote during prep — in the left panel, while the map underneath stays visible and
// usable. It is the DM's own and none of it ever reaches the players.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks under a marker carrying its
// letter, wherever in the file that state is cheapest to reach - which is not letter order.
//
//   A. Selecting a room shows it in the left panel, and opens the panel if it was shut without
//      changing what the DM keeps. A tool change does not put it away — it follows the selection
//      and nothing else. Grid calibration puts it away and the same room comes back at Done.
//   B. The tab holds the room's name and notes, and what the DM types reaches the room.
//   C. A name is trimmed and never left empty; notes are kept as typed, including newlines.
//   D. The tab's shape: the name as its header with Delete beside it, and nothing else of the
//      room's own. The notes and the pictures sit in the left panel, notes above pictures. No fog
//      pill, no drag bar, no Close.
//   E. The fog trio shows and sets the selected room's fog while Select is in hand, and T cycles
//      it; with a drawing tool in hand it is the paint direction again.
//   G. Delete in the tab removes that room and nothing else.
//   H. The notes grow with their text, and no notes height is stored anywhere.
//   I. A room wears its name on the map, inside its own outline, and never on the Player.
//   J. An effect gets no Room tab at all, because it has none of what the tab is for.
//   K. The tab looks right.
//
// ⚠ VISIBILITY FOLLOWS THE SELECTION AND MUST STAY THAT WAY. Creating a room leaves nothing
// selected, which is what keeps the tab shut while the DM draws.

const lib = require('../../lib');

const MAP_W = 2400, MAP_H = 1500;
const SMALL = { x1: 300, y1: 250, x2: 620, y2: 500 };
const BIG = { x1: 700, y1: 200, x2: 2200, y2: 1300 };

module.exports = async function roomCardFeature(rig) {
  const dm = rig.dm;

  await lib.openMap(rig, { w: MAP_W, h: MAP_H });
  await dm.waitFor('fogCoverT === 0', 30000, 'the scene cover to lift');

  const box = (x1, y1, x2, y2, id, name) => '{ id: ' + id + ', vertices: [' +
    '{ x: ' + x1 + ', y: ' + y1 + ' }, { x: ' + x2 + ', y: ' + y1 + ' },' +
    '{ x: ' + x2 + ', y: ' + y2 + ' }, { x: ' + x1 + ', y: ' + y2 + ' }],' +
    " mode: 'shroud', cornerRadius: 0, name: " + JSON.stringify(name) + ' }';

  await dm.evaluate('polygons = [' +
    box(SMALL.x1, SMALL.y1, SMALL.x2, SMALL.y2, 1, 'The Vestry') + ', ' +
    box(BIG.x1, BIG.y1, BIG.x2, BIG.y2, 2, 'The Great Hall') + '];' +
    ' nextPolygonId = 3; selectedPolygonId = null;' +
    ' rebuildFogFromPolygons(); refreshRoomPanel(); scheduleRender(); 0');

  const OPEN = '(!document.getElementById("notes-panel").hidden && document.getElementById("panel-room").getBoundingClientRect().width > 0)';
  const select = async id => {
    await dm.evaluate('selectedPolygonId = ' + (id === null ? 'null' : id) +
      '; refreshRoomPanel(); scheduleRender(); 0');
    await lib.settle(dm, id === null ? '!' + OPEN : OPEN, 6000);
  };

  const card = () => dm.evaluate(`(() => {
    const p = document.getElementById('panel-room');
    if (!p) return { err: 'the Room tab is not in the DOM' };
    const b = p.getBoundingClientRect();
    const nameEl = document.getElementById('rp-name');
    const descEl = document.getElementById('rp-desc');
    return {
      shown: ${OPEN}, w: Math.round(b.width), h: Math.round(b.height),
      name: nameEl ? nameEl.value : null, desc: descEl ? descEl.value : null,
      descH: descEl ? Math.round(descEl.getBoundingClientRect().height) : 0,
    };
  })()`);

  const room = id => dm.evaluate('(() => { const p = polygons.find(x => x.id === ' + id + ');' +
    ' return p ? { name: p.name, desc: p.desc == null ? null : p.desc, mode: p.mode } : null; })()');

  // ⚠ THE COMMIT IS ON THE FIELD'S OWN blur LISTENER, and el.blur() does not reliably fire one in
  // a window the OS has not focused — the rig parks both windows off-screen. So the focus and blur
  // events are dispatched at the listeners directly. Everything they then run is the app's.
  const typeInto = (fieldId, value) => dm.evaluate(`(() => {
    const el = document.getElementById(${JSON.stringify(fieldId)});
    if (!el) return { err: 'no field ' + ${JSON.stringify(fieldId)} };
    el.dispatchEvent(new FocusEvent('focus'));
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('blur'));
    return { ok: true, left: el.value };
  })()`);

  // ── A. The room follows the selection ─────────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  rig.check(!(await card()).shown, 'the room is showing in the left panel with nothing selected');
  await select(1);
  rig.check((await card()).shown, 'selecting a room did not show it in the left panel');
  for (const [k, tool] of [['KeyB', 'brush'], ['KeyR', 'rect'], ['KeyV', 'select']]) {
    await dm.evaluate('__rigKey(' + JSON.stringify(k) + '); 0');
    await lib.settle(dm, 'shape === ' + JSON.stringify(tool), 6000);
    rig.check((await card()).shown,
              'changing the tool to ' + tool + ' put the room away, which must follow the selection alone');
  }
  await select(null);
  rig.check(!(await card()).shown, 'deselecting left the room in the left panel');
  // A shut panel opens on a pick, and the pick does not change what the DM chose to keep.
  await dm.evaluate('document.getElementById("np-toggle").click(); 0');
  await lib.settle(dm, 'document.getElementById("notes-panel").hidden', 6000);
  await select(1);
  rig.check((await card()).shown, 'selecting a room did not open a shut left panel');
  rig.check(await dm.evaluate('localStorage.getItem("evermist.notesPanelOpen")') === '0',
            'a room pick changed whether the DM keeps the panel open');
  await dm.evaluate('localStorage.setItem("evermist.notesPanelOpen", "1"); 0');
  await select(null);
  await select(1);

  // ⚠ CALIBRATION IS NOT A TOOL. It takes the map's mouse and puts the pane away; THE SELECTION
  // IS UNTOUCHED, which is what brings the same room back at Done.
  await dm.evaluate('document.getElementById("cp-grid-calibrate").click(); 0');
  await lib.settle(dm, 'gridCalArmed === true', 8000);
  rig.check(await dm.evaluate('gridCalArmed === true') && !(await card()).shown,
            'the Room tab stayed over the map that calibration has to be dragged on');
  await dm.evaluate('document.getElementById("gridcal-done").click(); 0');
  await lib.settle(dm, 'gridCalArmed === false', 8000);
  rig.check((await card()).shown && await dm.evaluate('selectedPolygonId') === 1,
            'the Room tab did not come back on the same room once calibration handed the map back');

  // ── B. The fields reach the room ──────────────────────────────────────────
  // RED ON: poly.name = v gated off in _rpCommitName (roomCard.js) — 2026-10-02
  rig.check((await card()).name === 'The Vestry',
            'the Room tab is not showing the name of the room that is selected: ' + (await card()).name);
  await typeInto('rp-name', 'The Cold Vestry');
  await lib.settle(dm, 'polygons[0].name === "The Cold Vestry"', 6000);
  rig.check((await room(1)).name === 'The Cold Vestry',
            'a name typed into the Room tab never reached the room: ' + (await room(1)).name);

  const NOTES = 'Two acolytes here.\nThe font is trapped.';
  await typeInto('rp-desc', NOTES);
  await lib.settle(dm, '!!polygons[0].desc', 6000);
  rig.check((await room(1)).desc === NOTES,
            'notes typed into the Room tab did not reach the room as typed, newlines included: ' +
            JSON.stringify((await room(1)).desc));

  // Selecting another room and coming back must not carry the first room's text across.
  await select(2);
  const onBig = await card();
  rig.check(onBig.name === 'The Great Hall' && onBig.desc === '',
            "the Room tab carried the previous room's name or notes onto the next room: " +
            JSON.stringify(onBig));
  await select(1);
  const backOnSmall = await card();
  rig.check(backOnSmall.name === 'The Cold Vestry' && backOnSmall.desc === NOTES,
            'coming back to a room lost what was typed into its tab: ' +
            JSON.stringify(backOnSmall));

  // ── C. Trimmed, never empty ───────────────────────────────────────────────
  // RED ON: poly.name = v gated off in _rpCommitName (roomCard.js) — 2026-10-02
  await typeInto('rp-name', '   The Cold Vestry   ');
  await lib.settle(dm, 'polygons[0].name === "The Cold Vestry"', 6000);
  rig.check((await room(1)).name === 'The Cold Vestry',
            'a name was stored with the spaces the DM typed round it: ' +
            JSON.stringify((await room(1)).name));
  await typeInto('rp-name', '     ');
  // Nothing is expected to CHANGE here, so the wait is on the field having been handled at all.
  await lib.settle(dm, 'document.getElementById("rp-name").value === "     "', 6000);
  const blanked = await room(1);
  rig.note('after emptying the name: ' + JSON.stringify(blanked));
  rig.check(!!blanked.name && blanked.name.trim().length > 0,
            'emptying the name field left the room nameless, so its label on the map says ' +
            'nothing: ' + JSON.stringify(blanked.name));
  await typeInto('rp-name', 'The Cold Vestry');

  // ── D. The shape of the tab ───────────────────────────────────────────────
  // RED ON: #rp-delete pushed 40px down by a rule appended to dock.css — 2026-10-02
  const shape = await dm.evaluate(`(() => {
    const p = document.getElementById('panel-room');
    const name = document.getElementById('rp-name'), del = document.getElementById('rp-delete');
    const order = ['rp-desc', 'rp-pic-add']
      .map(id => document.getElementById(id).getBoundingClientRect().top);
    const left = document.getElementById('notes-panel');
    return {
      headRow: Math.abs(name.getBoundingClientRect().top - del.getBoundingClientRect().top) < 12 &&
               del.getBoundingClientRect().left > name.getBoundingClientRect().left,
      ordered: order.every((t, i) => i === 0 || t > order[i - 1]),
      notesHome: ['rp-desc', 'rp-pics', 'rp-pic-add', 'rp-pic-input'].every(id => left.contains(document.getElementById(id))),
      notesLeftBehind: ['rp-desc', 'rp-pics', 'rp-pic-add', 'rp-pic-input'].filter(id => document.getElementById('dock').contains(document.getElementById(id))),
      gone: ['rp-mode', 'rp-head', 'rp-close', 'rp-radius-field'].filter(id => document.getElementById(id)),
      inPanel: !!p.closest('#notes-panel'),
      railTab: !!document.getElementById('dock-tab-room') || !!document.getElementById('dock-pane-room'),
    };
  })()`);
  rig.note('the tab\'s shape: ' + JSON.stringify(shape));
  rig.check(shape.inPanel && shape.headRow && !shape.railTab,
            'the room is not the name with Delete beside it in the left panel, or the dock still has a Room tab: ' + JSON.stringify(shape));
  rig.check(shape.notesHome && shape.notesLeftBehind.length === 0 && shape.ordered,
            'the room\'s notes and pictures are not in the left panel, notes above pictures: ' + JSON.stringify(shape));
  rig.check(shape.gone.length === 0, 'the floating card\'s parts are still in the page: ' + shape.gone.join(', '));

  // ── E. The fog trio, split by the tool in hand ────────────────────────────
  // RED ON: fogTrioRoom made to return null (toolbar.js), and separately setPolygonMode gated off in pressFogTrio — 2026-10-02
  const lit = () => dm.evaluate('[...document.querySelectorAll("#ctx-rooms .active")].map(b => b.id).join()');
  await dm.evaluate('setShape("select"); setShapeOp("new"); setPaintDirection("reveal"); 0');
  rig.check(await dm.evaluate('document.getElementById("context-row").style.visibility') !== 'hidden' &&
            await lit() === 'btn-' + (await room(1)).mode,
            'with Select in hand the trio does not show the selected room\'s fog: lit ' + await lit());
  await dm.evaluate('document.getElementById("btn-half").click(); 0');
  rig.check((await room(1)).mode === 'half' && await lit() === 'btn-half' &&
            await dm.evaluate('tool') === 'reveal',
            'the trio did not set the selected room\'s fog, or it moved the paint direction too');
  await dm.evaluate('__rigKey("KeyT"); 0');
  rig.check((await room(1)).mode === 'reveal' && await lit() === 'btn-reveal',
            'T did not cycle the selected room\'s fog, or the trio did not follow it');
  await dm.evaluate('setShape("rect"); 0');
  await dm.evaluate('document.getElementById("btn-shroud").click(); 0');
  rig.check(await dm.evaluate('tool') === 'shroud' && (await room(1)).mode === 'reveal',
            'with a drawing tool in hand the trio did not go back to being the paint direction');
  await dm.evaluate('setShape("select"); 0');

  // ── H. The notes grow, and no height is stored ────────────────────────────
  // RED ON: _rpFitNotes made to return first (roomCard.js) — 2026-10-02
  const short = (await card()).descH;
  await typeInto('rp-desc', NOTES + '\n'.repeat(30) + 'The end.');
  const grown = (await card()).descH;
  rig.check(grown > short + 100, 'the notes did not grow with their text: ' + short + ' → ' + grown);
  rig.check(await dm.evaluate('localStorage.getItem("evermist.roomDescHeight") === null'),
            'a notes height was written to storage, which the Room tab has no use for');
  await typeInto('rp-desc', NOTES);

  // ── I. Room labels ────────────────────────────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  rig.check(await dm.evaluate('showRoomLabels === true'),
            'room labels are off by default, so nothing below is about where they are drawn');
  await select(null);
  await dm.evaluate('resetRoomLabelCache(); drawCursor(null, null);' +
    ' viewportDirty = true; scheduleRender(); 0');
  await lib.settle(dm, '!viewportDirty', 8000);
  const labels = await dm.evaluate(`(() => {
    const out = [];
    for (const p of polygons) {
      const e = _rpLabelCache.get(p.id);
      if (!e || !e.text) { out.push({ id: p.id, text: null }); continue; }
      const bb = getPolyBBox(p.vertices);
      out.push({ id: p.id, text: e.text, mx: Math.round(e.mx), my: Math.round(e.my),
                 inside: e.mx >= bb.minX && e.mx <= bb.maxX && e.my >= bb.minY && e.my <= bb.maxY });
    }
    return { out, fontPx: roomLabelFontPx(zoom), zoom: +zoom.toFixed(4) };
  })()`);
  rig.note('room labels: ' + JSON.stringify(labels));
  // ⚠ COUNTED BEFORE IT IS JUDGED. Both checks below run `every` over a list built from
  // `polygons`, and `[].every(...)` is true — so with no rooms on the map they would report that
  // every room is labelled and every label sits inside its room.
  rig.check(labels.out.length === 2,
            'the two rooms this section is about are not on the map, so the label checks below ' +
            'judge nothing: ' + JSON.stringify(labels.out));
  rig.check(labels.out.length > 0 && labels.out.every(l => l.text),
            'a room on the map carries no label at all: ' + JSON.stringify(labels.out));
  rig.check(labels.out.length > 0 && labels.out.every(l => l.inside),
            'a room label was placed outside the room it names: ' + JSON.stringify(labels.out));
  rig.check(labels.fontPx >= 17 && labels.fontPx <= 38,
            'the label size left its readable range: ' + labels.fontPx + 'px at zoom ' + labels.zoom);
  const zoomedFont = await dm.evaluate('({ tiny: roomLabelFontPx(0.001), huge: roomLabelFontPx(500) })');
  rig.check(zoomedFont.tiny >= 17 && zoomedFont.huge <= 38,
            'the label size is not clamped at both ends, so it vanishes or swamps the map at ' +
            'extreme zooms: ' + JSON.stringify(zoomedFont));

  // The label is chrome for the DM. Nothing about it exists on the Player.
  const player = await rig.player();
  await player.waitFor('!!mapOffscreen', 45000, 'the Player to receive the map');
  const onTV = await player.evaluate(`({
    rooms: typeof polygons === 'undefined' ? 'undefined' : polygons.length,
    card: (() => { const p = document.getElementById('panel-room');
                   return !!p && p.getBoundingClientRect().width > 0; })(),
    labels: typeof drawRoomLabels === 'function'
      ? (() => { try { drawRoomLabels(); return 'ran and drew nothing'; } catch (e) { return 'threw'; } })()
      : 'absent',
  })`);
  rig.note('what the Player holds: ' + JSON.stringify(onTV));
  rig.check(onTV.rooms === 0 || onTV.rooms === 'undefined',
            'rooms reached the Player, so a room name and its notes are one bug away from the ' +
            'table: it holds ' + onTV.rooms);
  rig.check(onTV.card === false, 'the Room tab is showing on the Player, which has no UI at all');

  // ── J. An effect gets no Room tab ─────────────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  await dm.evaluate(`(() => {
    setEffects([{ id: 1, vertices: [
      { x: 900, y: 900 }, { x: 1200, y: 900 }, { x: 1200, y: 1150 }, { x: 900, y: 1150 },
    ], material: 'fire', cornerRadius: 0, name: 'Burning pews' }]);
    nextEffectId = 2;
    placeMode = 'effects';
    selectedPolygonId = 1;
    rebuildFogEffect(); refreshRoomPanel(); scheduleRender();
    return 0;
  })()`);
  await lib.settle(dm, '!viewportDirty', 8000);
  const onEffect = await card();
  rig.check(!onEffect.shown,
            'selecting an effect opened the Room tab, which is name, notes and module text — ' +
            'none of which an effect has: ' + JSON.stringify(onEffect));

  // ── G. Delete ─────────────────────────────────────────────────────────────
  // RED ON: deleteSelectedPolygon gated off in the rp-delete handler (roomCard.js) — 2026-10-02
  await dm.evaluate('placeMode = "rooms"; selectedPolygonId = 1; refreshRoomPanel(); 0');
  await lib.settle(dm, OPEN, 8000);
  await dm.evaluate('document.getElementById("rp-delete").click(); 0');
  // Delete either asks first or acts. Waiting for whichever happened beats guessing at both.
  await lib.settle(dm, "(() => { const a = document.getElementById('cd-anchor');" +
    " return (!!a && a.style.display === 'flex') || !polygons.some(p => p.id === 1); })()", 8000);
  // Delete is destructive, so it may ask first; take the confirmation if it is there.
  await dm.evaluate('(() => { const a = document.getElementById("cd-anchor");' +
    ' if (a && a.style.display === "flex") document.getElementById("cd-ok").click();' +
    ' return 0; })()');
  await lib.settle(dm, '!polygons.some(p => p.id === 1)', 8000);
  const afterDelete = await dm.evaluate('({ ids: polygons.map(p => p.id),' +
    ' names: polygons.map(p => p.name), selected: selectedPolygonId })');
  rig.note('after Delete: ' + JSON.stringify(afterDelete));
  rig.check(afterDelete.ids.indexOf(1) === -1,
            'Delete in the tab did not remove the room it was open on: ' +
            JSON.stringify(afterDelete));
  rig.check(afterDelete.ids.indexOf(2) !== -1,
            'Delete in the tab took a room it was not open on: ' + JSON.stringify(afterDelete));
  rig.check(!(await card()).shown,
            'the Room tab stayed open after its room was deleted, so it is describing a ghost');

  // ── K. The look ───────────────────────────────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  await select(2);
  rig.byEye('the room in a screenshot taken with --shot "#notes-panel" — the name as the header, the ' +
            'notes on the panel\'s own background, and Delete reading as destructive only on hover');
  rig.byEye('room labels over real Dungeon Alchemist floor art, which is what the plate has to ' +
            'stay readable against');
};
