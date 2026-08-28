'use strict';

// room-card.js — THE ROOM CARD AND THE ROOM LABELS, whole.
//
// THE GOAL OF THIS FEATURE: the DM clicks a room and reads what is in it — its name, the notes
// they wrote during prep — while the map underneath stays visible and usable. It is the DM's own
// panel and none of it ever reaches the players. Every check below serves that sentence.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks directly beneath it, in order.
//
//   A. The card opens on a selected room, closes when nothing is selected, and survives a tool
//      change — its visibility is the selection and nothing else.
//   B. The card holds the room's name and notes, and what the DM types reaches the room.
//   C. A name is trimmed and never left empty; notes are kept as typed, including newlines.
//   D. The card's shape is the one the DM reads: a titleless drag bar with a grip and a Close,
//      the name field, the notes, ONE properties row, and Delete at the bottom behind a hairline.
//   E. The card clears the room it belongs to — the whole outline, not just its middle.
//   F. The card can be dragged, and a drag cannot put it off screen.
//   G. Delete on the card removes that room and nothing else.
//   H. The notes height is ONE global preference: it survives a room change and a scene switch,
//      and it never lands on a scene.
//   I. A room wears its name on the map, inside its own outline, and never on the Player.
//   J. An effect gets no card at all, because it has none of what a card is for.
//   K. The card looks right.
//
// Changing a room's fog mode from the pill, deleting it with the keyboard and the fog those cost
// are editing.js's business (its sections E and G). What is here is the card as a PANEL.
//
// ⚠ THE CARD IS INSIDE A `zoom: var(--ui-zoom)` ELEMENT, and this Chromium folds an ancestor zoom
// into getBoundingClientRect — so the rects read here are already in screen pixels and match a
// screenshot's coordinates directly. Do NOT multiply by the zoom.
//
// ⚠ VISIBILITY IS SELECTION-ONLY AND MUST STAY THAT WAY. Creating a room leaves nothing selected,
// which is what keeps the card shut while the DM draws. Section A is the check that stops anyone
// "fixing" that with a tool test.
//
// ⚠ THE NOTES HEIGHT IS SAVED ON MOUSEUP, not on every resize. Section H drives the release.
//
// ⚠ THE MAP IS ANIMATED, AND EVERY ACCEPTANCE FILE'S IS. Animated is the only kind the DM
// ever uses, so a suite running on still PNGs proved the app worked in a case that never
// happens. `tableMap` (tools/rig/fixtures.js) records the clip once per run and caches it by
// size. Do not swap it back to `stillMap`; smoke.js is the one file that wants both.

const MAP_W = 2400, MAP_H = 1500;
// A small room and a big one. The big one is what catches a card anchored on a centroid: it
// swallows the card whole while its centre is nowhere near it.
const SMALL = { x1: 300, y1: 250, x2: 620, y2: 500 };
const BIG = { x1: 700, y1: 200, x2: 2200, y2: 1300 };

module.exports = async function roomCardFeature(rig) {
  const dm = rig.dm;

  const map = await rig.fixtures.tableMap(dm, rig.fixtureDir,
    { w: MAP_W, h: MAP_H });
  const expr = await rig.fixtures.asFileExpr(dm, map);
  await dm.evaluate('createNewScene(' + expr + ')', 120000);
  await dm.waitFor('currentScene && mapWidth === ' + MAP_W, 120000, 'the map to load on the DM');
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

  const select = async id => {
    await dm.evaluate('selectedPolygonId = ' + (id === null ? 'null' : id) +
      '; refreshRoomPanel(); scheduleRender(); 0');
    await rig.sleep(250);
  };

  const card = () => dm.evaluate(`(() => {
    const p = document.getElementById('panel-room');
    if (!p) return { err: 'the room card is not in the DOM' };
    const b = p.getBoundingClientRect();
    const shown = getComputedStyle(p).display !== 'none' && b.width > 0;
    const nameEl = document.getElementById('rp-name');
    const descEl = document.getElementById('rp-desc');
    return {
      shown, x: Math.round(b.left), y: Math.round(b.top),
      w: Math.round(b.width), h: Math.round(b.height),
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

  // ── A. Visibility is the selection, and nothing else ──────────────────────
  rig.check(!(await card()).shown,
            'the room card is open with nothing selected');
  await select(1);
  const opened = await card();
  rig.note('the card on The Vestry: ' + JSON.stringify(opened));
  rig.check(opened.shown, 'selecting a room did not open its card');

  for (const [k, tool] of [['b', 'brush'], ['e', 'rect'], ['v', 'select']]) {
    await dm.evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: ' +
      JSON.stringify(k) + ', bubbles: true, cancelable: true })); 0');
    await rig.sleep(200);
    rig.check((await card()).shown,
              'changing the tool to ' + tool + ' closed the room card, which must be gated on ' +
              'the selection alone');
  }

  await select(null);
  rig.check(!(await card()).shown, 'deselecting did not close the room card');
  await select(1);

  // ── B. The fields reach the room ──────────────────────────────────────────
  rig.check((await card()).name === 'The Vestry',
            'the card is not showing the name of the room that is selected: ' + (await card()).name);
  await typeInto('rp-name', 'The Cold Vestry');
  await rig.sleep(250);
  rig.check((await room(1)).name === 'The Cold Vestry',
            'a name typed into the card never reached the room: ' + (await room(1)).name);

  const NOTES = 'Two acolytes here.\nThe font is trapped.';
  await typeInto('rp-desc', NOTES);
  await rig.sleep(250);
  rig.check((await room(1)).desc === NOTES,
            'notes typed into the card did not reach the room as typed, newlines included: ' +
            JSON.stringify((await room(1)).desc));

  // Selecting another room and coming back must not carry the first room's text across.
  await select(2);
  const onBig = await card();
  rig.check(onBig.name === 'The Great Hall' && onBig.desc === '',
            "the card carried the previous room's name or notes onto the next room: " +
            JSON.stringify(onBig));
  await select(1);
  const backOnSmall = await card();
  rig.check(backOnSmall.name === 'The Cold Vestry' && backOnSmall.desc === NOTES,
            'coming back to a room lost what was typed into its card: ' +
            JSON.stringify(backOnSmall));

  // ── C. Trimmed, never empty ───────────────────────────────────────────────
  await typeInto('rp-name', '   The Cold Vestry   ');
  await rig.sleep(250);
  rig.check((await room(1)).name === 'The Cold Vestry',
            'a name was stored with the spaces the DM typed round it: ' +
            JSON.stringify((await room(1)).name));
  await typeInto('rp-name', '     ');
  await rig.sleep(250);
  const blanked = await room(1);
  rig.note('after emptying the name: ' + JSON.stringify(blanked));
  rig.check(!!blanked.name && blanked.name.trim().length > 0,
            'emptying the name field left the room nameless, so its label on the map says ' +
            'nothing: ' + JSON.stringify(blanked.name));
  await typeInto('rp-name', 'The Cold Vestry');

  // ── D. The shape of the card ──────────────────────────────────────────────
  const shape = await dm.evaluate(`(() => {
    const p = document.getElementById('panel-room');
    const head = document.getElementById('rp-head');
    const del = document.getElementById('rp-delete');
    const foot = p.querySelector('.rp-foot');
    const rows = p.querySelectorAll('.rp-props, .rp-row');
    return {
      headText: head ? head.textContent.replace(/\\s+/g, '') : null,
      grip: !!p.querySelector('.rp-grip'),
      close: !!document.getElementById('rp-close'),
      pill: !!document.getElementById('rp-mode'),
      radius: !!document.getElementById('rp-radius-field'),
      del: !!del,
      delWidth: del ? Math.round(del.getBoundingClientRect().width) : 0,
      cardWidth: Math.round(p.getBoundingClientRect().width),
      delBottom: del && foot ? del.getBoundingClientRect().top >= foot.getBoundingClientRect().top - 2 : null,
      danger: del ? del.className.indexOf('cp-btn-danger') !== -1 : false,
      propRows: rows.length,
    };
  })()`);
  rig.note('the card\'s shape: ' + JSON.stringify(shape));
  rig.check(shape.grip && shape.close,
            'the drag bar has lost its grip or its Close: ' + JSON.stringify(shape));
  rig.check(shape.headText === '',
            'the drag bar has grown a title, which the card deliberately does not have: ' +
            JSON.stringify(shape.headText));
  rig.check(shape.pill && shape.radius,
            'the properties row has lost the fog pill or the corner-radius field: ' +
            JSON.stringify(shape));
  rig.check(shape.del && shape.danger,
            'Delete is not marked as the destructive action, so it reads as the primary one: ' +
            JSON.stringify(shape));
  rig.check(shape.delWidth > shape.cardWidth * 0.8,
            'Delete was shrunk to signal danger, which the hairline is there to do instead: ' +
            shape.delWidth + ' wide in a ' + shape.cardWidth + ' card');

  // ── E. The card clears the room ───────────────────────────────────────────
  // Against the BIG room especially: a card placed from a room's centroid sits inside it.
  for (const [id, name] of [[1, 'The Vestry'], [2, 'The Great Hall']]) {
    await select(id);
    const overlap = await dm.evaluate(`(() => {
      const p = document.getElementById('panel-room').getBoundingClientRect();
      const poly = polygons.find(x => x.id === ${id});
      const xs = poly.vertices.map(v => v.x * zoom + panX);
      const ys = poly.vertices.map(v => v.y * zoom + panY);
      const r = container.getBoundingClientRect();
      const rx1 = Math.min(...xs) + r.left, rx2 = Math.max(...xs) + r.left;
      const ry1 = Math.min(...ys) + r.top,  ry2 = Math.max(...ys) + r.top;
      const ox = Math.min(p.right, rx2) - Math.max(p.left, rx1);
      const oy = Math.min(p.bottom, ry2) - Math.max(p.top, ry1);
      return { ox: Math.round(ox), oy: Math.round(oy),
               card: { x: Math.round(p.left), y: Math.round(p.top),
                       w: Math.round(p.width), h: Math.round(p.height) },
               room: { x: Math.round(rx1), y: Math.round(ry1),
                       w: Math.round(rx2 - rx1), h: Math.round(ry2 - ry1) } };
    })()`);
    rig.note(name + ': overlap ' + overlap.ox + 'x' + overlap.oy + ' — card ' +
             JSON.stringify(overlap.card) + ' room ' + JSON.stringify(overlap.room));
    rig.check(overlap.ox <= 0 || overlap.oy <= 0,
              'the card is sitting on top of ' + name + ', which is the room it is describing: ' +
              'they overlap by ' + overlap.ox + 'x' + overlap.oy + ' pixels');
  }

  // ── F. Dragging the card ──────────────────────────────────────────────────
  await select(1);
  const dragCard = (dx, dy) => dm.evaluate(`(() => {
    const head = document.getElementById('rp-head');
    const b = head.getBoundingClientRect();
    const x0 = b.left + b.width / 2, y0 = b.top + b.height / 2;
    const ev = (type, x, y, target) => target.dispatchEvent(new MouseEvent(type, {
      clientX: x, clientY: y, button: 0, buttons: 1, bubbles: true, cancelable: true }));
    ev('mousedown', x0, y0, head);
    ev('mousemove', x0 + ${dx} / 2, y0 + ${dy} / 2, window);
    ev('mousemove', x0 + ${dx}, y0 + ${dy}, window);
    ev('mouseup', x0 + ${dx}, y0 + ${dy}, window);
    return 0;
  })()`);

  // ⚠ DRAGGED UP, NOT DOWN. The card is clamped inside the window and it is tall, so a downward
  // drag is legitimately cut short — and a check on the delta would read that clamp as the card
  // failing to follow the cursor. Section F's next check is what covers the clamp on purpose.
  const beforeDrag = await card();
  await dragCard(120, -60);
  await rig.sleep(300);
  const afterDrag = await card();
  rig.note('the card was dragged: ' + JSON.stringify(beforeDrag) + ' → ' + JSON.stringify(afterDrag));
  rig.check(afterDrag.x !== beforeDrag.x || afterDrag.y !== beforeDrag.y,
            'dragging the card by its bar moved nothing: ' + JSON.stringify(afterDrag));
  rig.check(Math.abs((afterDrag.x - beforeDrag.x) - 120) < 12 &&
            Math.abs((afterDrag.y - beforeDrag.y) - -60) < 12,
            'the card did not follow the cursor: it moved ' + (afterDrag.x - beforeDrag.x) + ',' +
            (afterDrag.y - beforeDrag.y) + ' for a drag of 120,-60 — a bare divide by the UI zoom ' +
            'is what puts a constant offset here');

  await dragCard(-4000, -4000);
  await rig.sleep(300);
  const shoved = await card();
  rig.note('the card after being dragged hard off screen: ' + JSON.stringify(shoved));
  rig.check(shoved.x + shoved.w > 20 && shoved.y + shoved.h > 20,
            'the card can be dragged off screen, where the DM cannot get it back: ' +
            JSON.stringify(shoved));

  // A double-click on the bar snaps it back beside its room.
  await dm.evaluate(`(() => { const head = document.getElementById('rp-head');
    head.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    return 0; })()`);
  await rig.sleep(300);
  const snapped = await card();
  rig.check(snapped.x !== shoved.x || snapped.y !== shoved.y,
            'double-clicking the drag bar did not snap the card back to its room: ' +
            JSON.stringify(snapped));

  // ── H. The notes height is one global preference ──────────────────────────
  // Driven through the real release: the height is saved on mouseup, not on every resize.
  // ⚠ THE WATCHER IS ARMED BY A MOUSEDOWN ON THE TEXTAREA, deliberately: its listener lives on
  // window and would otherwise force a layout on every mouse release in the app. A resize that
  // never pressed the handle is never saved, so the gesture has to start with that mousedown.
  //
  // ⚠ IT STORES offsetHeight, NOT THE SCREEN RECT. The card carries `zoom: var(--ui-zoom)`, so the
  // rect is screen px while style.height is pre-zoom layout px. Both are reported here.
  const setDescHeight = h => dm.evaluate(`(() => {
    const el = document.getElementById('rp-desc');
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.style.height = ${h} + 'px';
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return { layout: el.offsetHeight, screen: Math.round(el.getBoundingClientRect().height) };
  })()`);
  const storedHeight = () => dm.evaluate(
    "(() => { try { return localStorage.getItem('evermist.roomDescHeight'); } catch (_) { return null; } })()");

  const tall = await setDescHeight(150);
  await rig.sleep(400);
  const savedH = await storedHeight();
  rig.note('the notes were resized to ' + JSON.stringify(tall) + ' and stored as ' + savedH);
  rig.check(savedH !== null && Math.abs(parseInt(savedH, 10) - tall.layout) < 4,
            'resizing the notes was not remembered at all: the store holds ' + savedH +
            ' against a height of ' + tall.layout);

  await select(2);
  await select(1);
  const keptH = (await card()).descH;
  rig.check(Math.abs(keptH - tall.screen) < 8,
            'the notes height was not kept across a room change: ' + keptH + ' against ' +
            tall.screen);

  const inScene = await dm.evaluate(`(() => {
    doAutoSave();
    return JSON.stringify(polygons).indexOf('descHeight') === -1 &&
           JSON.stringify(currentScene.polygons || []).indexOf('descHeight') === -1;
  })()`);
  rig.check(inScene === true,
            'the notes height was written onto a room, so it travels between machines in a ' +
            'backup and stops being one preference');

  // ── I. Room labels ────────────────────────────────────────────────────────
  rig.check(await dm.evaluate('showRoomLabels === true'),
            'room labels are off by default, so nothing below is about where they are drawn');
  await select(null);
  await dm.evaluate('resetRoomLabelCache(); drawCursor(null, null);' +
    ' viewportDirty = true; scheduleRender(); 0');
  await rig.sleep(500);
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
                   return !!p && getComputedStyle(p).display !== 'none'; })(),
    labels: typeof drawRoomLabels === 'function'
      ? (() => { try { drawRoomLabels(); return 'ran and drew nothing'; } catch (e) { return 'threw'; } })()
      : 'absent',
  })`);
  rig.note('what the Player holds: ' + JSON.stringify(onTV));
  rig.check(onTV.rooms === 0 || onTV.rooms === 'undefined',
            'rooms reached the Player, so a room name and its notes are one bug away from the ' +
            'table: it holds ' + onTV.rooms);
  rig.check(onTV.card === false, 'the room card is showing on the Player, which has no UI at all');

  // ── J. An effect gets no card ─────────────────────────────────────────────
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
  await rig.sleep(300);
  const onEffect = await card();
  rig.check(!onEffect.shown,
            'selecting an effect opened the room card, which is name, notes and module text — ' +
            'none of which an effect has: ' + JSON.stringify(onEffect));

  // ── G. Delete ─────────────────────────────────────────────────────────────
  await dm.evaluate('placeMode = "rooms"; selectedPolygonId = 1; refreshRoomPanel(); 0');
  await rig.sleep(250);
  await dm.evaluate('document.getElementById("rp-delete").click(); 0');
  await rig.sleep(400);
  // Delete is destructive, so it may ask first; take the confirmation if it is there.
  await dm.evaluate('(() => { const a = document.getElementById("cd-anchor");' +
    ' if (a && a.style.display === "flex") document.getElementById("cd-ok").click();' +
    ' return 0; })()');
  await rig.sleep(400);
  const afterDelete = await dm.evaluate('({ ids: polygons.map(p => p.id),' +
    ' names: polygons.map(p => p.name), selected: selectedPolygonId })');
  rig.note('after Delete: ' + JSON.stringify(afterDelete));
  rig.check(afterDelete.ids.indexOf(1) === -1,
            'Delete on the card did not remove the room it was open on: ' +
            JSON.stringify(afterDelete));
  rig.check(afterDelete.ids.indexOf(2) !== -1,
            'Delete on the card took a room it was not open on: ' + JSON.stringify(afterDelete));
  rig.check(!(await card()).shown,
            'the card stayed open after its room was deleted, so it is describing a ghost');

  // ── K. The look ───────────────────────────────────────────────────────────
  await dm.evaluate('selectedPolygonId = 2; refreshRoomPanel(); 0');
  await rig.sleep(400);
  rig.byEye('the room card in a screenshot taken with --shot "#panel-room" — whether the notes ' +
            'have enough room, and whether Delete reads as destructive without shouting');
  rig.byEye('room labels over real Dungeon Alchemist floor art, which is what the plate has to ' +
            'stay readable against');
};
