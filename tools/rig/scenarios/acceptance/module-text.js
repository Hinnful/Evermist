'use strict';

// module-text.js — MODULE TEXT, whole.
//
// THE GOAL OF THIS FEATURE: the DM loads the campaign module once, then fills each room's card
// from it by picking a heading out of a list, instead of retyping a book. The text is the
// campaign's, not any one map's, and none of it ever reaches the players. Every check below serves
// that sentence.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks directly beneath it, in order.
//
//   A. The panel carries exactly three controls, and an import happens on choosing a file — no
//      confirm step, and an empty parse never overwrites what is already loaded.
//   B. A file that is not prose is NAMED rather than parsed as prose.
//   C. The panel lists what is loaded every time it opens, and Remove clears it.
//   D. The file input is cleared before the dialog opens, so the same file can be picked twice.
//   E. The text is campaign-level: it survives a scene switch and never lands on a scene.
//   F. It rides a backup as ONE entry at the zip root, and a zip without that entry restores
//      exactly as before.
//   G. The name field's dropdown is the only way in, it filters as the DM types, and it marks
//      what is already on this map without refusing it.
//   H. Picking an entry writes the room's name and its notes, in ONE undo step.
//   I. A room that already has notes is asked before they are replaced, and the name lands either
//      way.
//   J. None of it reaches the Player.
//   K. A PDF is CONVERTED rather than refused, in the app that actually ships.
//
// The parser is unit-tested and stays that way (test/moduleText.test.js — headings, sub-locations,
// furniture, reflow, the sequence). What is here is the app around it: the panel, the store, the
// dropdown and the write into a room.
//
// ⚠ THE FIXTURE IS SYNTHETIC, AND MUST STAY SO. Real module text is copyrighted and never goes in
// this repo. That also means the thresholds this feature tunes — the wrap percentile, paragraph
// recovery — are NOT what this file measures; they can only be judged against a real book.
//
// ⚠ SECTION K IS A PACKAGING CHECK AS MUCH AS A FEATURE ONE. The extraction forks a
// utilityProcess and loads pdfjs-dist from `app.asar.unpacked`, a path that exists only in a
// built app. Under `npm start` it resolves to node_modules and passes whatever build.files says,
// so this criterion only earns its place on the run CI makes against the .exe.
//
// ⚠ THE DROPDOWN ACTS ON click, AND ITS mousedown ONLY CALLS preventDefault. That split keeps the
// pointer from blurring the name field and closing the list, and keeps a dialog out of the middle
// of a mouse gesture. Section G drives both events in that order, so a scenario that dispatched
// only one would be testing a gesture the DM never makes.
//
// ⚠ THE STORE IS localStorage, WHICH SURVIVES NOTHING THE RIG DOES BETWEEN SCENARIOS but survives
// everything inside one. Section E leans on that: the profile is thrown away per scenario, so the
// panel starts empty every run.

const lib = require('../../lib');

const MAP_W = 1400, MAP_H = 900;
const ROOM_A = { x1: 200, y1: 200, x2: 550, y2: 450 };
const ROOM_B = { x1: 800, y1: 500, x2: 1150, y2: 750 };

// Synthetic, and shaped like the real thing: a capital prefix touching the digits, a name after
// the period, and bodies long enough that the reflow has something to do.
const MODULE = [
  'K1. The Gatehouse',
  'Two guards stand here, bored and cold. They have not been paid in a month and will talk',
  'for coin.',
  '',
  'K2. The Long Hall',
  'Banners hang from the rafters, each one from a house that no longer exists.',
  '',
  'K3. The Chapel',
  'A font of black water sits at the far end. Drinking from it is a very bad idea, and the',
  'acolytes will not say why.',
].join('\n');

module.exports = async function moduleTextFeature(rig) {
  const dm = rig.dm;

  const map = await rig.fixtures.tableMap(dm, rig.fixtureDir, { w: MAP_W, h: MAP_H });
  const expr = await rig.fixtures.asFileExpr(dm, map);
  const named = n => '(f => new File([f], ' + JSON.stringify(n) + ', { type: f.type }))(' + expr + ')';

  const importMap = async name => {
    await dm.evaluate('createNewScene(' + named(name + '.mp4') + ')', 120000);
    await dm.waitFor('currentScene && currentScene.name === ' + JSON.stringify(name), 120000,
                     'the import of ' + name);
    return dm.evaluate('currentScene.id');
  };

  const alpha = await importMap('Alpha');
  await dm.waitFor('fogCoverT === 0', 30000, 'the scene cover to lift');

  const box = (r, id, name) => '{ id: ' + id + ', vertices: [' +
    '{ x: ' + r.x1 + ', y: ' + r.y1 + ' }, { x: ' + r.x2 + ', y: ' + r.y1 + ' },' +
    '{ x: ' + r.x2 + ', y: ' + r.y2 + ' }, { x: ' + r.x1 + ', y: ' + r.y2 + ' }],' +
    " mode: 'shroud', cornerRadius: 0, name: " + JSON.stringify(name) + ' }';

  await dm.evaluate('polygons = [' + box(ROOM_A, 1, 'Room 1') + ', ' +
    box(ROOM_B, 2, 'Room 2') + '];' +
    ' nextPolygonId = 3; selectedPolygonId = null;' +
    ' rebuildFogFromPolygons(); refreshRoomPanel(); scheduleRender(); 0');

  // The picker's own change handler, on a File built in-page. Only the OS dialog is skipped.
  await dm.evaluate(`(() => {
    globalThis.__rigText = (name, text, type) => new File([text], name, { type: type || 'text/plain' });
    globalThis.__rigPickModule = file => {
      const inp = document.getElementById('mt-file-input');
      inp.files = (() => { const dt = new DataTransfer(); dt.items.add(file); return dt.files; })();
      const seen = inp.files.length;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      return { delivered: seen };
    };
    0
  })()`);

  const panel = () => dm.evaluate(`(() => {
    const m = document.getElementById('mt-modal');
    const list = document.getElementById('mt-list');
    return {
      open: !!m && m.style.display !== 'none',
      status: (document.getElementById('mt-status') || {}).textContent || '',
      err: !!(document.getElementById('mt-status') || {}).classList &&
           document.getElementById('mt-status').classList.contains('mt-err'),
      rows: list ? [...list.querySelectorAll('.mt-row')].map(r => r.textContent) : [],
      listShown: !!list && list.style.display !== 'none',
      footShown: (() => { const f = document.getElementById('mt-foot');
                          return !!f && f.style.display !== 'none'; })(),
      fileLabel: (document.getElementById('mt-file-label') || {}).textContent || '',
      inputValue: (document.getElementById('mt-file-input') || {}).value,
    };
  })()`);

  const store = () => dm.evaluate(`(() => {
    let raw = null;
    try { raw = localStorage.getItem('evermist.moduleText'); } catch (_) {}
    return { has: !!raw, entries: mtEntries.length, source: mtSourceName || null };
  })()`);

  const room = id => dm.evaluate('(() => { const p = polygons.find(x => x.id === ' + id + ');' +
    ' return p ? { name: p.name, desc: p.desc == null ? null : p.desc } : null; })()');

  const undoDepth = () => dm.evaluate('undoStack.length');

  // ── A. Three controls, and importing on choose ────────────────────────────
  await dm.evaluate('openModuleTextModal(); 0');
  await lib.settle(dm, 'document.getElementById("mt-modal").style.display !== "none"', 8000);
  const empty = await panel();
  rig.note('the panel with nothing loaded: ' + JSON.stringify(empty.status));
  rig.check(empty.open, 'the module-text panel would not open');
  rig.check(!empty.listShown && !empty.footShown,
            'the panel is offering a list and a Remove with nothing loaded: ' + JSON.stringify(empty));

  const controls = await dm.evaluate(`(() => {
    const m = document.getElementById('mt-modal');
    return [...m.querySelectorAll('button')].map(b => b.id || b.textContent.trim());
  })()`);
  rig.note('the panel\'s controls: ' + JSON.stringify(controls));
  rig.check(controls.length === 3,
            'the panel has grown past its three controls — Choose file, Remove, Close: ' +
            JSON.stringify(controls));

  await dm.evaluate('__rigPickModule(__rigText("Watcherhouse.txt", ' + JSON.stringify(MODULE) + '))');
  await lib.settle(dm, 'mtEntries && mtEntries.length === 3', 20000);
  const loaded = await panel();
  const st = await store();
  rig.note('after choosing a file: ' + JSON.stringify(loaded.status) + ' / ' + JSON.stringify(st));
  rig.check(st.entries === 3,
            'the three headings in the file did not become three entries: ' + st.entries);
  rig.check(st.has, 'the parsed entries were not stored, so they are gone on the next start');
  rig.check(st.source === 'Watcherhouse.txt',
            'the panel does not remember which file the text came from: ' + st.source);
  rig.check(loaded.rows.length === 3,
            'the panel does not list what it just loaded: ' + JSON.stringify(loaded.rows));
  rig.check(loaded.footShown, 'Remove is not offered with a book loaded');
  rig.check(loaded.fileLabel.indexOf('another') !== -1,
            'the Choose button still reads as if nothing were loaded: ' +
            JSON.stringify(loaded.fileLabel));

  // An empty parse must not throw away the book that is loaded.
  await dm.evaluate('__rigPickModule(__rigText("Nothing.txt", "Just some prose with no headings ' +
    'in it at all, running on for a while."))');
  await lib.settle(dm, 'document.getElementById("mt-status").textContent.indexOf("numbered locations") !== -1', 20000);
  const afterEmpty = await panel();
  const stillLoaded = await store();
  rig.note('after a file with no headings: ' + JSON.stringify(afterEmpty.status));
  rig.check(afterEmpty.err && afterEmpty.status.length > 0,
            'a file with no numbered locations said nothing at all: ' +
            JSON.stringify(afterEmpty.status));
  rig.check(stillLoaded.entries === 3,
            'a file that parsed to nothing threw away the book that was already loaded: ' +
            stillLoaded.entries + ' entries left');

  // ── B. A file that is not prose ───────────────────────────────────────────
  // A .docx reaches here through the dialog's "All files": its bytes are a zip, and parsing them
  // as prose gives the DM a list of garbage and no idea why.
  await dm.evaluate('__rigPickModule(__rigText("Module.docx", "PK\\u0003\\u0004' +
    'word/document.xml", "application/octet-stream"))');
  await lib.settle(dm, 'document.getElementById("mt-status").textContent.indexOf(".docx") !== -1', 20000);
  const binary = await panel();
  rig.note('after a .docx: ' + JSON.stringify(binary.status));
  rig.check(binary.err,
            'a file that is not prose was accepted rather than named: ' +
            JSON.stringify(binary.status));
  rig.check((await store()).entries === 3,
            'a binary file replaced the book that was loaded');

  // ── D. The input is cleared before the dialog opens ───────────────────────
  // A file input fires no `change` for the same file twice, so without this a repeat pick is
  // silently dead — which is exactly what the DM does after a parse they did not like.
  // ⚠ THE INPUT HAS TO BE HOLDING A FILENAME WHEN Choose IS PRESSED, or the check passes for
  // nothing: an input that was already empty reads as cleared however the button behaves. The
  // picks above leave one there, so nothing is cleared by hand first. A file input's value cannot
  // be assigned any non-empty string, so a real FileList is the only way to stage this.
  const staged = await dm.evaluate(
    "(() => document.getElementById('mt-file-input').value !== '')()");
  rig.check(staged === true,
            'the file input is already empty before Choose is pressed, so the check below cannot ' +
            'tell a cleared input from an untouched one');
  const cleared = await dm.evaluate(`(() => {
    const input = document.getElementById('mt-file-input');
    let clicked = false, valueAtClick = null;
    const origClick = input.click;
    input.click = function () { clicked = true; valueAtClick = this.value; };
    document.getElementById('btn-mt-file').click();
    input.click = origClick;
    return { clicked, valueAtClick };
  })()`);
  rig.note('Choose file: ' + JSON.stringify(cleared));
  rig.check(cleared.clicked, 'the Choose button no longer opens the file dialog');
  rig.check(cleared.valueAtClick === '',
            'the file input was not cleared before the dialog opened, so picking the same file ' +
            'twice is silently dead: it held ' + JSON.stringify(cleared.valueAtClick));

  // ── C. Remove ─────────────────────────────────────────────────────────────
  // Checked after everything that needs a book, so the rest of the file reloads it once.
  const removeId = await dm.evaluate(`(() => {
    const f = document.getElementById('mt-foot');
    const b = f && f.querySelector('button');
    return b ? (b.id || b.textContent.trim()) : null;
  })()`);
  rig.check(!!removeId, 'there is no Remove in the panel footer');

  // ── E. Campaign-level, never a scene ──────────────────────────────────────
  const beta = await importMap('Beta');
  await dm.waitFor('fogCoverT === 0', 30000, 'the cover to lift on Beta');
  rig.check((await store()).entries === 3,
            'the module text did not survive an import and a scene switch, so it is per-scene');
  await dm.evaluate('switchScene(' + JSON.stringify(alpha) + ')', 120000);
  await dm.waitFor('currentScene && currentScene.id === ' + JSON.stringify(alpha), 60000,
                   'the switch back to Alpha');
  rig.check((await store()).entries === 3, 'the module text was lost on a scene switch');

  const inScene = await dm.evaluate(`(async () => {
    doAutoSave();
    await new Promise(r => setTimeout(r, 600));
    const sc = await sceneStore.loadScene(currentScene.id);
    return JSON.stringify(sc || {}).indexOf('The Gatehouse') === -1;
  })()`, 30000);
  rig.check(inScene === true,
            'the module text was written into a scene record, which is keyed by scene id and ' +
            'would need a DB version bump — it belongs to the campaign, not a map');

  // Alpha's rooms were replaced by the import; put them back for the sections below.
  await dm.evaluate('polygons = [' + box(ROOM_A, 1, 'Room 1') + ', ' +
    box(ROOM_B, 2, 'Room 2') + '];' +
    ' nextPolygonId = 3; selectedPolygonId = null;' +
    ' rebuildFogFromPolygons(); refreshRoomPanel(); scheduleRender(); 0');

  // ── F. It rides the backup as one entry at the zip root ───────────────────
  const payload = await dm.evaluate(`(() => {
    const p = mtBackupPayload();
    return { present: typeof p === 'string' && p.length > 0,
             hasEntries: typeof p === 'string' && p.indexOf('The Gatehouse') !== -1 };
  })()`);
  rig.check(payload.present && payload.hasEntries,
            'the backup payload does not carry the loaded book: ' + JSON.stringify(payload));

  const roundTrip = await dm.evaluate(`(() => {
    const saved = mtBackupPayload();
    // Wiped the way Remove wipes it, then restored from the payload alone.
    const before = mtEntries.length;
    mtStore([], '');
    const emptied = mtEntries.length;
    const res = mtRestorePayload(saved);
    return { before, emptied, ok: res && res.ok, after: mtEntries.length,
             source: mtSourceName || null,
             firstTitle: mtEntries.length ? mtEntries[0].title : null };
  })()`);
  rig.note('the backup round trip: ' + JSON.stringify(roundTrip));
  rig.check(roundTrip.emptied === 0, 'the book could not be cleared, so the restore below proves nothing');
  rig.check(roundTrip.ok && roundTrip.after === 3,
            'a book restored out of a backup did not come back whole: ' + JSON.stringify(roundTrip));
  rig.check(roundTrip.firstTitle === 'K1. The Gatehouse',
            'a restored book lost its headings: ' + JSON.stringify(roundTrip.firstTitle));

  const noEntry = await dm.evaluate(`(() => {
    const before = mtEntries.length;
    const res = mtRestorePayload(null);
    return { before, refused: !(res && res.ok), after: mtEntries.length };
  })()`);
  rig.check(noEntry.refused && noEntry.after === noEntry.before,
            'a backup with no module text in it wiped the book that was loaded, so restoring an ' +
            'older zip costs the DM their whole module: ' + JSON.stringify(noEntry));

  // ── G. The dropdown is the only way in ───────────────────────────────────
  await dm.evaluate('closeModuleTextModal(); selectedPolygonId = 1; refreshRoomPanel(); 0');
  await lib.settle(dm, '!!document.getElementById("rp-mt-dd")', 8000);

  const dd = () => dm.evaluate(`(() => {
    const d = document.getElementById('rp-mt-dd');
    if (!d) return { err: 'the dropdown is not in the card' };
    return {
      open: d.style.display !== 'none',
      inCard: !!d.closest('#panel-room'),
      head: (document.getElementById('rp-mt-head') || {}).textContent || '',
      rows: [...d.querySelectorAll('.rp-mt-opt')].map(b => b.textContent),
      placed: [...d.querySelectorAll('.rp-mt-opt.placed')].map(b => b.textContent),
      none: !!d.querySelector('.rp-mt-none'),
      footLabel: (document.getElementById('rp-mt-load') || {}).textContent || '',
    };
  })()`);

  const closed = await dd();
  rig.check(!closed.err, 'the room card has no module-text dropdown: ' + closed.err);
  rig.check(!closed.err && closed.inCard,
            'the dropdown is not inside the room card, so the UI zoom does not reach it');
  rig.check(!closed.err && !closed.open, 'the dropdown is open before anyone asked for it');

  await dm.evaluate('mtOpenDropdown(); 0');
  await lib.settle(dm, "document.getElementById('rp-mt-dd').style.display !== 'none'", 8000);
  const openDd = await dd();
  rig.note('the dropdown: ' + JSON.stringify(openDd.head) + ' ' + JSON.stringify(openDd.rows));
  rig.check(openDd.open && openDd.rows.length === 3,
            'the dropdown does not list the loaded entries: ' + JSON.stringify(openDd));
  rig.check(openDd.head.indexOf('of 3') !== -1,
            'the dropdown does not say how much of the book is placed on this map: ' +
            JSON.stringify(openDd.head));

  // Filters as the DM types, and only once the text differs from the name already in the field.
  await dm.evaluate(`(() => {
    const el = document.getElementById('rp-name');
    el.value = 'Chapel';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    mtOpenDropdown();
    return 0;
  })()`);
  await lib.settle(dm, 'document.querySelectorAll(".rp-mt-opt").length === 1', 8000);
  const filtered = await dd();
  rig.note('filtered on "Chapel": ' + JSON.stringify(filtered.rows));
  rig.check(filtered.rows.length === 1 && filtered.rows[0].indexOf('Chapel') !== -1,
            'the dropdown does not filter on what the DM types: ' + JSON.stringify(filtered.rows));

  await dm.evaluate(`(() => {
    const el = document.getElementById('rp-name');
    el.value = 'nothing matches this';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    mtOpenDropdown();
    return 0;
  })()`);
  await lib.settle(dm, 'document.querySelectorAll(".rp-mt-opt").length === 0', 8000);
  const noMatch = await dd();
  rig.check(noMatch.rows.length === 0 && noMatch.none,
            'a filter matching nothing does not say so, and does not tell the DM their typing ' +
            'is kept: ' + JSON.stringify(noMatch));

  // ── H. Picking writes the room, in one undo step ──────────────────────────
  await dm.evaluate(`(() => {
    const el = document.getElementById('rp-name');
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    mtOpenDropdown();
    return 0;
  })()`);
  await lib.settle(dm, 'document.querySelectorAll(".rp-mt-opt").length === 3', 8000);

  const beforePick = await undoDepth();
  // ⚠ mousedown THEN click, in that order, because the split between them is deliberate.
  const picked = await dm.evaluate(`(() => {
    const rows = [...document.querySelectorAll('.rp-mt-opt')];
    const row = rows.find(r => r.textContent.indexOf('Gatehouse') !== -1);
    if (!row) return { err: 'no Gatehouse row in the dropdown' };
    row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return { ok: true };
  })()`);
  if (rig.check(!picked.err, 'the dropdown could not be picked from: ' + picked.err)) {
    await lib.settle(dm, 'polygons[0].name === "K1. The Gatehouse"', 8000);
    const written = await room(1);
    rig.note('the room after picking K1: ' + JSON.stringify(written));
    rig.check(written.name === 'K1. The Gatehouse',
              "picking an entry did not write the room's name: " + JSON.stringify(written.name));
    rig.check(!!written.desc && written.desc.indexOf('Two guards stand here') !== -1,
              "picking an entry did not write the room's notes: " + JSON.stringify(written.desc));
    rig.check(written.desc.indexOf('K1.') === -1,
              'the heading was written into the notes as well as the name: ' +
              JSON.stringify(written.desc.slice(0, 40)));
    rig.check(await undoDepth() === beforePick + 1,
              'picking an entry cost more than one undo step: ' + beforePick + ' → ' +
              await undoDepth());
    await dm.evaluate('undo(); 0');
    await lib.settle(dm, 'polygons[0].name === "Room 1"', 8000);
    rig.check((await room(1)).name === 'Room 1',
              'undo after a pick did not put the room back: ' + JSON.stringify(await room(1)));
  }

  // The entry now on the map is marked in the list, and still selectable — one heading can serve
  // several polygons.
  // ⚠ THE SELECTION MOVES FIRST, THEN THE NAME IS SET. refreshRoomPanel commits the name FIELD
  // for the room being left, so a name written onto polygons[0] before the switch is overwritten
  // by whatever the field was still holding — and the placed dot then never appears.
  await dm.evaluate('selectedPolygonId = 2; refreshRoomPanel(); 0');
  await dm.evaluate('polygons[0].name = "K1. The Gatehouse"; _rpInvalidateLabel(1);' +
    ' mtOpenDropdown(); 0');
  await lib.settle(dm, 'document.querySelectorAll(".rp-mt-opt.placed").length === 1', 8000);
  const marked = await dd();
  rig.note('placed rows: ' + JSON.stringify(marked.placed));
  rig.check(marked.placed.length === 1 && marked.placed[0].indexOf('Gatehouse') !== -1,
            'the dropdown does not mark the entry already on this map: ' +
            JSON.stringify(marked.placed));
  rig.check(marked.rows.length === 3,
            'the dropdown hid the entry already on the map, which one heading serving several ' +
            'rooms needs: ' + JSON.stringify(marked.rows));

  // ── I. A room with notes already is asked first ──────────────────────────
  await dm.evaluate('polygons[1].desc = "My own note about this room."; ' +
    ' selectedPolygonId = 2; refreshRoomPanel(); mtOpenDropdown(); 0');
  await lib.settle(dm, 'document.getElementById("rp-mt-dd").style.display !== "none"', 8000);
  const pickChapel = () => dm.evaluate(`(() => {
    const rows = [...document.querySelectorAll('.rp-mt-opt')];
    const row = rows.find(r => r.textContent.indexOf('Chapel') !== -1);
    if (!row) return { err: 'no Chapel row in the dropdown' };
    row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return { ok: true };
  })()`);
  rig.check(!(await pickChapel()).err, 'the Chapel entry is not in the dropdown to pick');
  await lib.settle(dm, 'document.getElementById("cd-anchor").style.display === "flex"', 8000);
  const asked = await dm.evaluate(`(() => {
    const a = document.getElementById('cd-anchor');
    return { dialog: !!a && a.style.display === 'flex',
             title: (document.getElementById('cd-title') || {}).textContent || '',
             name: polygons[1].name, desc: polygons[1].desc };
  })()`);
  rig.note('picking over an existing description: ' + JSON.stringify(asked));
  rig.check(asked.dialog && asked.title.indexOf('Replace') !== -1,
            'the module text overwrote a description the DM had written, without asking: ' +
            JSON.stringify(asked));
  // The name is written up front on purpose: the dialog's focus change blurs the name field and
  // runs its commit, so a name left for the callback is lost.
  rig.check(asked.name === 'K3. The Chapel',
            'the name was not written before the question was asked, so the field commits the ' +
            'old one on its way out: ' + JSON.stringify(asked.name));
  rig.check(asked.desc === 'My own note about this room.',
            'the description was replaced before the DM answered: ' + JSON.stringify(asked.desc));

  await dm.evaluate('(() => { const b = document.getElementById("cd-cancel");' +
    ' if (b) b.click(); return 0; })()');
  await lib.settle(dm, 'document.getElementById("cd-anchor").style.display !== "flex"', 8000);
  rig.check((await room(2)).desc === 'My own note about this room.',
            'keeping the DM\'s own description replaced it anyway: ' +
            JSON.stringify((await room(2)).desc));

  await dm.evaluate('selectedPolygonId = 2; refreshRoomPanel(); mtOpenDropdown(); 0');
  await lib.settle(dm, 'document.getElementById("rp-mt-dd").style.display !== "none"', 8000);
  rig.check(!(await pickChapel()).err,
            'the Chapel entry is not in the dropdown to pick a second time');
  await lib.settle(dm, 'document.getElementById("cd-anchor").style.display === "flex"', 8000);
  await dm.evaluate('(() => { const b = document.getElementById("cd-ok");' +
    ' if (b) b.click(); return 0; })()');
  await lib.settle(dm, 'polygons[1].desc.indexOf("font of black water") !== -1', 8000);
  const replaced = await room(2);
  rig.check(!!replaced.desc && replaced.desc.indexOf('font of black water') !== -1,
            'answering Replace did not put the module text into the room: ' +
            JSON.stringify(replaced.desc));

  // ── J. None of it reaches the Player ─────────────────────────────────────
  const player = await rig.player();
  await player.waitFor('!!mapOffscreen', 45000, 'the Player to receive the map');
  const onTV = await player.evaluate(`({
    rooms: typeof polygons === 'undefined' ? 'undefined' : polygons.length,
    stored: (() => { try { return !!localStorage.getItem('evermist.moduleText'); }
                     catch (_) { return 'unreadable'; } })(),
    panel: (() => { const m = document.getElementById('mt-modal');
                    return !!m && m.style.display !== 'none'; })(),
  })`);
  rig.note('what the Player holds: ' + JSON.stringify(onTV));
  rig.check(onTV.rooms === 0 || onTV.rooms === 'undefined',
            'rooms reached the Player, so the module text written into them is one bug away from ' +
            'the table: it holds ' + onTV.rooms);
  rig.check(onTV.panel === false, 'the module-text panel is showing on the Player');

  // ── C, finished: Remove clears it ────────────────────────────────────────
  await dm.evaluate('openModuleTextModal(); 0');
  await lib.settle(dm, 'document.getElementById("mt-modal").style.display !== "none"', 8000);
  const listedAgain = await panel();
  rig.check(listedAgain.rows.length === 3,
            'the panel does not list what is loaded every time it opens, which is what makes ' +
            'importing-on-choose safe: ' + JSON.stringify(listedAgain.rows));
  await dm.evaluate(`(() => {
    const f = document.getElementById('mt-foot');
    const b = f && f.querySelector('button');
    if (b) b.click();
    return 0;
  })()`);
  await lib.settle(dm, 'document.getElementById("cd-anchor").style.display === "flex"', 8000);
  // Remove is destructive, so take the confirmation if there is one.
  await dm.evaluate('(() => { const a = document.getElementById("cd-anchor");' +
    ' if (a && a.style.display === "flex") document.getElementById("cd-ok").click();' +
    ' return 0; })()');
  await lib.settle(dm, 'mtEntries.length === 0', 8000);
  const removed = await store();
  const afterRemove = await panel();
  rig.note('after Remove: ' + JSON.stringify(removed) + ' / ' + JSON.stringify(afterRemove.status));
  rig.check(removed.entries === 0,
            'Remove did not clear the loaded book: ' + removed.entries + ' entries left');
  rig.check(!afterRemove.listShown && !afterRemove.footShown,
            'the panel still offers a list and a Remove with nothing loaded: ' +
            JSON.stringify(afterRemove));

  // ══ K. A PDF is converted, in the app that ships ══════════════════════════
  // Built in the page, because the renderer hands the main process BYTES: Electron removed
  // File.path, so nothing here needs a real file on disk and the whole chain is reachable.
  // ⚠ ASCII ONLY. String.length is the byte count the /Length entry and the xref offsets are
  // written from, and one multi-byte character would put every offset out by one.
  await dm.evaluate(`(() => {
    globalThis.__rigPdfBytes = (lines) => {
      let content = 'BT /F1 12 Tf 72 720 Td 14 TL\\n';
      for (const l of lines) content += '(' + l.replace(/[()\\\\]/g, m => '\\\\' + m) + ') Tj T*\\n';
      content += 'ET';
      const objs = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]' +
          ' /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        '<< /Length ' + content.length + ' >>\\nstream\\n' + content + '\\nendstream',
      ];
      let body = '%PDF-1.4\\n';
      const offsets = [];
      objs.forEach((o, i) => {
        offsets.push(body.length);
        body += (i + 1) + ' 0 obj\\n' + o + '\\nendobj\\n';
      });
      const xref = body.length;
      body += 'xref\\n0 ' + (objs.length + 1) + '\\n0000000000 65535 f \\n';
      for (const off of offsets) body += String(off).padStart(10, '0') + ' 00000 n \\n';
      body += 'trailer\\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\\nstartxref\\n' +
              xref + '\\n%%EOF';
      const a = new Uint8Array(body.length);
      for (let i = 0; i < body.length; i++) a[i] = body.charCodeAt(i) & 0xff;
      return a;
    };
    0
  })()`);

  await dm.evaluate('openModuleTextModal(); 0');
  await lib.settle(dm, 'document.getElementById("mt-modal").style.display !== "none"', 8000);
  // ⚠ MODULE IS ONE JOINED STRING. The builder wants a line per element, and a string handed
  // to its for..of loop iterates by CHARACTER — a PDF of 300 one-letter lines that extracts
  // cleanly, parses to nothing, and reads exactly like a broken utilityProcess.
  await dm.evaluate('__rigPickModule(new File([__rigPdfBytes(' + JSON.stringify(MODULE.split('\n')) + ')], ' +
    '"Keep of the Cold Marches.pdf", { type: "application/pdf" }))');

  // The parse crosses a process boundary, so this is the one import in the file that is not
  // near-instant. Bounded rather than slept through: a cold utilityProcess is slower than a warm
  // one, and a fixed wait would be tuned to whichever machine it was written on.
  const pdfLanded = await lib.settle(dm, 'mtEntries && mtEntries.length > 0', 60000);
  const pdfPanel = await panel();
  const pdfStore = await store();
  rig.note('after the PDF: ' + JSON.stringify(pdfStore) + ' / ' + JSON.stringify(pdfPanel.status));
  rig.check(pdfLanded && pdfStore.entries > 0,
            'the PDF never became entries, so the utilityProcess, pdfjs-dist or the asar.unpacked ' +
            'path is broken in this build: ' + JSON.stringify(pdfPanel.status));
  rig.check(!pdfPanel.err,
            'the panel reported the PDF as an error: ' + JSON.stringify(pdfPanel.status));
  rig.check(pdfStore.source === 'Keep of the Cold Marches.pdf',
            'the PDF did not become the loaded source: ' + JSON.stringify(pdfStore.source));

  // The headings, not just a count. A PDF that extracted to whitespace would still parse to
  // SOME entries, and a count alone cannot tell that apart from the book coming through.
  const pdfNames = await dm.evaluate('mtEntries.map(e => e.name)');
  rig.note('the entries the PDF produced: ' + JSON.stringify(pdfNames));
  rig.check(pdfNames.some(n => /Gatehouse/.test(n)),
            'the PDF parsed, but none of its headings came through: ' + JSON.stringify(pdfNames));

  rig.byEye('a real campaign PDF through the real Choose file button. Section K drives the ' +
            'conversion on bytes, which is the part that breaks in a packaged build. The native ' +
            'dialog cannot be driven, and the reflow thresholds can only be judged against real ' +
            'prose no repo of ours may hold');
};
