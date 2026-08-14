'use strict';

// every-way-a-map-gets-in.js — the two doors. importMapFiles has been driven directly since it was
// written; the "+" picker's own change handler and the rewritten window drop handler never have
// been, so the wiring in FRONT of the loop was the untested part.
//
// Criteria, each with its check directly beneath.
//
//   The picker takes a folder's worth of maps in one go.
//     → #file-input carries `multiple`
//   Maps picked through "+" import as a batch, in the order they were picked.
//     → two files through the input's own change handler produce two scenes in order
//   The picker forgets what was picked, so the same file can be picked again.
//     → the input is empty afterwards, and re-picking the same name imports a second scene
//   A lone .zip through the picker goes to the restore path, not the map importer.
//     → it answers as restorePickedZip, which is a different answer from the batch refusal
//   Maps dropped on the window import exactly as picked ones do.
//     → a real drop event carrying two maps produces two scenes in order
//   A floor plan dropped on its own attaches to the open scene and imports nothing.
//     → the scene count does not move and the open scene comes away with a plan
//   A drop carrying nothing importable does nothing at all.
//     → no scene, no dialog
//
// ⚠ THE FILELIST IS BUILT WITH DataTransfer, WHICH IS THE ONLY PART THAT IS NOT THE APP'S OWN.
// DOM.setFileInputFiles reports success and leaves files.length at 0 in an Electron renderer, so
// the bytes cannot arrive the way the OS delivers them. `input.files = new DataTransfer().files`
// is Chromium's own supported way to populate one, and a DragEvent built round the same
// DataTransfer is a real drop event — so BOTH handlers run untouched, on real File objects. What
// is out of reach is a File that has a path on disk, which is the next warning.
//
// ⚠ restorePickedZip's REAL branch CANNOT BE REACHED, and it is not faked here. It asks
// electronAPI.getPathForFile for the .zip's path on disk; a File built in-page has none, so the
// answer is always null and the browser-fallback branch is the one that runs. electronAPI is
// exposed through contextBridge, so it is non-writable, non-configurable, and its methods cannot
// be replaced either — there is no way round it from the page. What this file therefore proves is
// the ROUTING: a lone .zip reaches restorePickedZip rather than the map importer, which is what
// the two dialogs distinguish. The restore itself is exercised with a real path by smoke.js, and
// the picker-to-disk hop is left below as the DM's own.

module.exports = async function everyWayAMapGetsIn(rig) {
  const dm = rig.dm;

  const still = await rig.fixtures.stillMap(dm, rig.fixtureDir,
    { w: 900, h: 600, name: 'rig-doors-still.png' });
  await rig.fixtures.asFileExpr(dm, still);   // leaves __rigB64 in the page

  await dm.evaluate(`(() => {
    globalThis.__rigFile = (name, type) => {
      const bin = atob(globalThis.__rigB64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return new File([u8], name, { type: type || 'image/png' });
    };
    globalThis.__rigText = (name, text, type) => new File([text], name, { type: type || '' });

    globalThis.__rigDT = files => {
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(f);
      return dt;
    };

    // The picker, through its own change handler. The FileList is real and so is the handler;
    // only the click that would have opened the OS dialog is skipped.
    globalThis.__rigPick = files => {
      const inp = document.getElementById('file-input');
      inp.files = globalThis.__rigDT(files).files;
      const seen = inp.files.length;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      return { delivered: seen, leftBehind: inp.files.length, value: inp.value };
    };

    // A real drop on the window, which is where toolbar.js listens.
    globalThis.__rigDrop = files => {
      document.dispatchEvent(new DragEvent('drop', {
        dataTransfer: globalThis.__rigDT(files), bubbles: true, cancelable: true,
      }));
      return 0;
    };

    // A plan the kernel will accept: one room, 6x4 squares, with a door so the run is not read
    // as solid rock.
    globalThis.__rigPlanText = JSON.stringify({
      format: 0.3,
      resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 10, y: 14 }, pixels_per_grid: 100 },
      line_of_sight: [
        [{ x: 1, y: 1 }, { x: 4, y: 1 }], [{ x: 5, y: 1 }, { x: 7, y: 1 }],
        [{ x: 7, y: 1 }, { x: 7, y: 5 }], [{ x: 7, y: 5 }, { x: 1, y: 5 }],
        [{ x: 1, y: 5 }, { x: 1, y: 1 }],
      ],
      portals: [{ bounds: [{ x: 4, y: 1 }, { x: 5, y: 1 }] }],
    });
    0
  })()`);

  const library = () => dm.evaluate('allScenes.map(s => s.name)');

  const dialogNow = () => dm.evaluate(`({
    shown: (() => { const a = document.getElementById('cd-anchor');
                    return !!a && a.style.display === 'flex'; })(),
    title: (document.getElementById('cd-title') || {}).textContent || '',
    msg: (document.getElementById('cd-msg') || {}).textContent || '',
  })`);

  const dismiss = () => dm.evaluate('(() => { const b = document.getElementById("cd-ok");' +
    ' if (b) b.click(); return 0; })()');

  // Both doors hand off to importMapFiles and neither returns its promise, so the finish line is
  // the library settling rather than a resolved call. Bounded, and it never throws: a miss has to
  // become a named check.
  const waitLibrary = async (want, ms) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const names = await library();
      if (names.length >= want || Date.now() > deadline) return names;
      await rig.sleep(250);
    }
  };

  // ── The picker takes more than one file ─────────────────────────────────────
  rig.check(await dm.evaluate('document.getElementById("file-input").multiple === true'),
            'the "+" picker no longer accepts more than one file at a time');

  // ── Two maps through the picker's own change handler ────────────────────────
  const picked = await dm.evaluate('__rigPick([__rigFile("Picked One.png"), __rigFile("Picked Two.png")])');
  rig.note('picker delivered: ' + JSON.stringify(picked));
  rig.check(picked.delivered === 2,
            'the picker was handed two files and saw ' + picked.delivered + ' — the FileList did not take');
  const afterPick = await waitLibrary(2, 240000);
  rig.note('after the picker: ' + JSON.stringify(afterPick));
  rig.check(afterPick.length === 2,
            'two files through the "+" picker did not produce two scenes: ' + JSON.stringify(afterPick));
  rig.check(afterPick[0] === 'Picked One' && afterPick[1] === 'Picked Two',
            'the picker imported out of order: ' + JSON.stringify(afterPick));

  // ── And it forgets what was picked ─────────────────────────────────────────
  // Without this the DM cannot re-pick a file they just imported: the input holds the old
  // selection and no change event ever fires again.
  rig.check(picked.leftBehind === 0 && picked.value === '',
            'the picker kept its selection, so the same file could never be picked twice: ' +
            JSON.stringify(picked));
  const again = await dm.evaluate('__rigPick([__rigFile("Picked One.png")])');
  rig.check(again.delivered === 1, 'the cleared input would not take a second selection');
  const afterAgain = await waitLibrary(3, 240000);
  rig.check(afterAgain.length === 3,
            're-picking the same file imported nothing: ' + JSON.stringify(afterAgain));

  // ── A lone .zip through the picker takes the restore route ─────────────────
  const beforeZip = (await library()).length;
  await dm.evaluate('__rigPick([__rigText("Library.zip", "PK", "application/zip")])');
  await rig.sleep(600);
  const zipDlg = await dialogNow();
  const afterZip = await library();
  rig.note('lone .zip through the picker: ' + JSON.stringify(zipDlg.title) + ' / ' + JSON.stringify(zipDlg.msg));
  rig.check(afterZip.length === beforeZip,
            'a lone .zip through the picker was imported as a map: ' + JSON.stringify(afterZip));
  // ⚠ The discriminator between the two routes. restorePickedZip answers "Backups need the desktop
  // app"; importMapFiles answers "Import the backup on its own". A check on "a dialog appeared"
  // would pass for either, which is the whole regression.
  rig.check(zipDlg.shown && zipDlg.title.indexOf('desktop app') !== -1,
            'a lone .zip did not reach restorePickedZip — it was handed to the map importer ' +
            'instead: ' + JSON.stringify(zipDlg));
  await dismiss();

  // ── Two maps dropped on the window ─────────────────────────────────────────
  const beforeDrop = (await library()).length;
  await dm.evaluate('__rigDrop([__rigFile("Dropped One.png"), __rigFile("Dropped Two.png")])');
  const afterDrop = await waitLibrary(beforeDrop + 2, 240000);
  rig.note('after the drop: ' + JSON.stringify(afterDrop));
  rig.check(afterDrop.length === beforeDrop + 2,
            'two maps dropped on the window did not produce two scenes: ' + JSON.stringify(afterDrop));
  rig.check(afterDrop.slice(beforeDrop).join('|') === 'Dropped One|Dropped Two',
            'the drop imported out of order: ' + JSON.stringify(afterDrop));

  // ── A floor plan dropped on its own ────────────────────────────────────────
  // It attaches to the scene that is open; it is never a map, so nothing imports.
  const beforePlan = (await library()).length;
  const hadPlan = await dm.evaluate('!!(currentScene && currentScene.floorPlan)');
  rig.check(!hadPlan, 'the open scene already had a plan, so the drop below proves nothing');
  await dm.evaluate('__rigDrop([__rigText("Cellar.dd2vtt", globalThis.__rigPlanText)])');
  const planLanded = await (async () => {
    const deadline = Date.now() + 20000;
    for (;;) {
      if (await dm.evaluate('!!(currentScene && currentScene.floorPlan)')) return true;
      if (Date.now() > deadline) return false;
      await rig.sleep(200);
    }
  })();
  const afterPlan = await library();
  rig.check(planLanded, 'a floor plan dropped on its own did not attach to the open scene');
  rig.check(afterPlan.length === beforePlan,
            'a dropped .dd2vtt was treated as a map: ' + JSON.stringify(afterPlan));
  rig.check(await dm.evaluate('!document.getElementById("btn-floorplan").disabled'),
            'the plan attached but Draw Rooms stayed disabled, so the DM cannot use it');

  // ── A drop with nothing importable in it ───────────────────────────────────
  const beforeJunk = (await library()).length;
  await dm.evaluate('__rigDrop([__rigText("notes.txt", "hello", "text/plain")])');
  await rig.sleep(1200);
  const junkDlg = await dialogNow();
  rig.check((await library()).length === beforeJunk,
            'a drop with nothing importable in it created a scene');
  rig.check(!junkDlg.shown,
            'a single unimportable dropped file raised a dialog: ' + JSON.stringify(junkDlg));

  rig.byEye('a .zip picked through the real "+" button, which is the only way restorePickedZip ' +
            'gets a path on disk to restore from — a File built in-page has none, and ' +
            'electronAPI cannot be stubbed to pretend otherwise');
  rig.byEye('maps dragged in from a real Explorer window, plus a map and its sibling .dd2vtt ' +
            'dropped together, so the plan is found beside the map rather than reported as a ' +
            'file that would not open');
};
