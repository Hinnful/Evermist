'use strict';

// maps.js — GETTING A MAP IN, whole.
//
// THE GOAL OF THIS FEATURE: the DM points at a folder of Dungeon Alchemist exports, walks away,
// and comes back to a library of scenes. Nothing stops to ask about one bad file, and anything
// that did not make it is named once at the end. Every check below serves that sentence.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks directly beneath it, in order.
//
//   A. The picker takes a folder's worth of maps in one go, in the order they were picked, and
//      each scene is named after its file with the extension dropped.
//   B. The picker forgets what was picked, so the same map can be picked again.
//   C. Maps dropped on the window import exactly as picked ones do.
//   D. A floor plan dropped on its own attaches to the open scene and imports nothing.
//   E. A drop carrying nothing importable does nothing at all — no scene, no dialog.
//   F. A backup takes the restore route on its own, and is refused by name inside a selection.
//   G. A batch says which map of how many is going through; a single import wears no batch label.
//   H. One unloadable map costs that map and not the run, and is named once at the end.
//   I. A map that will not decode LETS GO of the import, and the report comes from the CALLER.
//   J. The progress overlay is never up while a dialog is on screen.
//
// Every good map in this file is a recorded clip, so the batch import path runs on the kind of
// file the DM actually points at. What a playing map RENDERS as is smoke.js's business: block 2
// there holds the animated render path against a still one, which needs both kinds. What is here
// is every way a file ARRIVES, and every way one can fail on the way in.
//
// ⚠ THE FILELIST IS BUILT WITH DataTransfer, AND THAT IS THE ONLY PART THAT IS NOT THE APP'S OWN.
// DOM.setFileInputFiles reports success and leaves files.length at 0 in an Electron renderer, so
// the bytes cannot arrive the way the OS delivers them. `input.files = new DataTransfer().files`
// is Chromium's own supported way to populate one, and a DragEvent built round the same
// DataTransfer is a real drop event — so BOTH handlers run untouched, on real File objects.
//
// ⚠ restorePickedZip's REAL BRANCH CANNOT BE REACHED, and it is not faked here. It asks
// electronAPI.getPathForFile for the .zip's path on disk; a File built in-page has none, so the
// answer is always null and the browser-fallback branch runs. electronAPI comes through
// contextBridge, so it is non-writable, non-configurable, and its methods cannot be replaced
// either. What section F proves is the ROUTING, which the two dialogs distinguish. The restore
// itself runs with a real path in smoke.js, and the picker-to-disk hop is the DM's own.
//
// ⚠ THE TWO VIDEO DIALOGS READ ALMOST THE SAME AND ONLY ONE OF THEM IS RIGHT. video.js's own bail
// text is "Evermist could not read this video"; the caller's names the file. They share a TITLE,
// so a check on the title alone passes whichever one fired — which is the regression section I
// exists to catch. Assert on the MESSAGE.
//
// ⚠ NEVER AWAIT createNewScene OVER THE WIRE FOR A BROKEN FILE. Dropping onFail leaves the
// import's promise unsettled forever, so an awaited call becomes a CDP timeout naming the wait
// rather than the behaviour. Every import below is kicked off, flagged on settle, and polled — so
// a hang lands as "never settled" instead of "the rig timed out".
//
// ⚠ THE MAP IS ANIMATED, AND EVERY ACCEPTANCE FILE'S IS. Animated is the only kind the DM
// ever uses, so a suite running on still PNGs proved the app worked in a case that never
// happens. `tableMap` (tools/rig/fixtures.js) records the clip once per run and caches it by
// size. Do not swap it back to `stillMap`; smoke.js is the one file that wants both.

module.exports = async function mapsFeature(rig) {
  const dm = rig.dm;

  const map = await rig.fixtures.tableMap(dm, rig.fixtureDir, { w: 900, h: 600 });
  await rig.fixtures.asFileExpr(dm, map);   // leaves __rigB64 in the page

  // ── The fixtures and the recorders, all installed once ─────────────────────
  await dm.evaluate(`(() => {
    // Compression would run convertVideoForImport over the broken bytes before the loader ever
    // saw them, which is a different path. Off is also the shipped default.
    localStorage.removeItem('evermist.compressBigVideos');

    globalThis.__rigFile = (name, type) => {
      const bin = atob(globalThis.__rigB64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return new File([u8], name, { type: type || 'video/mp4' });
    };
    globalThis.__rigText = (name, text, type) => new File([text], name, { type: type || '' });
    // Passes the extension gate and the MIME gate, then fails to decode — the honest shape of a
    // truncated export, which is what a batch has to survive.
    globalThis.__rigBrokenImage = name => new File(
      [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0])], name, { type: 'image/png' });
    globalThis.__rigBrokenVideo = name => new File(
      [new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 9, 9, 9, 9, 0, 0])],
      name, { type: 'video/mp4' });

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

    // showMapProgress is a plain function declaration in a classic script, so it IS a property of
    // window and can be wrapped from here — the app itself is untouched. Wrapping is the only way
    // to catch a label for a map that imports faster than any sampler ticks.
    globalThis.__rigLabels = [];
    const origProgress = showMapProgress;
    window.showMapProgress = function (label) {
      origProgress(label);
      globalThis.__rigLabels.push(document.getElementById('map-progress-label').textContent);
    };
    showMapProgress = window.showMapProgress;

    // Sampled in the page rather than over the wire: a dialog raised mid-batch and dismissed
    // between two round trips would be invisible from Node, and so would a moment where the
    // overlay and a dialog were up together.
    globalThis.__rigDlgSeen = [];
    globalThis.__rigBoth = [];
    globalThis.__rigTick = setInterval(() => {
      const p = document.getElementById('map-progress');
      const a = document.getElementById('cd-anchor');
      const up = !!p && p.style.display === 'flex';
      const dlg = !!a && a.style.display === 'flex';
      if (dlg) globalThis.__rigDlgSeen.push((document.getElementById('cd-msg') || {}).textContent || '');
      if (up && dlg) globalThis.__rigBoth.push(document.getElementById('map-progress-label').textContent);
    }, 30);
    0
  })()`);

  rig.check(await dm.evaluate('!compressBigVideosEnabled()'),
            'compression is on, so the broken video bytes go through the converter instead of ' +
            'the loader and section I would be testing the wrong path');

  // ── Readers ────────────────────────────────────────────────────────────────
  const dialogNow = () => dm.evaluate(`(() => {
    const a = document.getElementById('cd-anchor');
    const p = document.getElementById('map-progress');
    return {
      shown: !!a && a.style.display === 'flex',
      title: (document.getElementById('cd-title') || {}).textContent || '',
      msg: (document.getElementById('cd-msg') || {}).textContent || '',
      overlayUp: !!p && p.style.display === 'flex',
    };
  })()`);

  const dismiss = () => dm.evaluate('(() => { const b = document.getElementById("cd-ok");' +
    ' if (b) b.click(); return 0; })()');

  const library = () => dm.evaluate('({ names: allScenes.map(s => s.name),' +
    ' current: currentScene ? currentScene.name : null })');

  const names = async () => (await library()).names;

  const labelCount = () => dm.evaluate('globalThis.__rigLabels.length');
  const labelsSince = async mark => (await dm.evaluate('globalThis.__rigLabels')).slice(mark);

  // Neither door returns its promise, so the finish line is the library settling rather than a
  // resolved call. Bounded, and it never throws: a miss has to become a named check.
  const waitLibrary = async (want, ms) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const got = await names();
      if (got.length >= want || Date.now() > deadline) return got;
      await rig.sleep(250);
    }
  };

  // Starts the real entry point and waits for it to finish, without holding a CDP call open for
  // the length of the run.
  const runBatch = async (filesExpr, ms) => {
    await dm.evaluate('globalThis.__rigDone = false;' +
      ' importMapFiles(' + filesExpr + ').then(() => { globalThis.__rigDone = true; }); 0');
    try { await dm.waitFor('globalThis.__rigDone === true', ms, 'the batch to finish'); }
    catch (_) {}   // the caller's check reports the hang by name
    return dm.evaluate('globalThis.__rigDone === true');
  };

  // ── A. The picker takes many maps, in order ────────────────────────────────
  rig.check(await dm.evaluate('document.getElementById("file-input").multiple === true'),
            'the "+" picker no longer accepts more than one file at a time');

  const picked = await dm.evaluate('__rigPick([__rigFile("Picked One.mp4"), ' +
    '__rigFile("Picked_Two.mp4")])');
  rig.note('picker delivered: ' + JSON.stringify(picked));
  rig.check(picked.delivered === 2,
            'the picker was handed two files and saw ' + picked.delivered +
            ' — the FileList did not take');
  const afterPick = await waitLibrary(2, 240000);
  rig.note('after the picker: ' + JSON.stringify(afterPick));
  rig.check(afterPick.length === 2,
            'two files through the "+" picker did not produce two scenes: ' +
            JSON.stringify(afterPick));
  rig.check(afterPick[0] === 'Picked One' && afterPick[1] === 'Picked Two',
            'the picker imported out of order, or named a scene something other than its file ' +
            'without the extension: ' + JSON.stringify(afterPick));

  // ── B. And it forgets what was picked ──────────────────────────────────────
  // Without this the DM cannot re-pick a file they just imported: the input holds the old
  // selection and no change event ever fires again.
  rig.check(picked.leftBehind === 0 && picked.value === '',
            'the picker kept its selection, so the same file could never be picked twice: ' +
            JSON.stringify(picked));
  const again = await dm.evaluate('__rigPick([__rigFile("Picked One.mp4")])');
  rig.check(again.delivered === 1, 'the cleared input would not take a second selection');
  const afterAgain = await waitLibrary(3, 240000);
  rig.check(afterAgain.length === 3,
            're-picking the same file imported nothing: ' + JSON.stringify(afterAgain));

  // ── C. Maps dropped on the window ──────────────────────────────────────────
  const beforeDrop = (await names()).length;
  await dm.evaluate('__rigDrop([__rigFile("Dropped One.mp4"), __rigFile("Dropped Two.mp4")])');
  const afterDrop = await waitLibrary(beforeDrop + 2, 240000);
  rig.note('after the drop: ' + JSON.stringify(afterDrop));
  rig.check(afterDrop.length === beforeDrop + 2,
            'two maps dropped on the window did not produce two scenes: ' +
            JSON.stringify(afterDrop));
  rig.check(afterDrop.slice(beforeDrop).join('|') === 'Dropped One|Dropped Two',
            'the drop imported out of order: ' + JSON.stringify(afterDrop));

  // ── D. A floor plan dropped on its own ─────────────────────────────────────
  // It attaches to the scene that is open; it is never a map, so nothing imports.
  const beforePlan = (await names()).length;
  rig.check(!(await dm.evaluate('!!(currentScene && currentScene.floorPlan)')),
            'the open scene already had a plan, so the drop below proves nothing');
  await dm.evaluate('__rigDrop([__rigText("Cellar.dd2vtt", globalThis.__rigPlanText)])');
  const planLanded = await (async () => {
    const deadline = Date.now() + 20000;
    for (;;) {
      if (await dm.evaluate('!!(currentScene && currentScene.floorPlan)')) return true;
      if (Date.now() > deadline) return false;
      await rig.sleep(200);
    }
  })();
  rig.check(planLanded, 'a floor plan dropped on its own did not attach to the open scene');
  rig.check((await names()).length === beforePlan,
            'a dropped .dd2vtt was treated as a map: ' + JSON.stringify(await names()));
  rig.check(await dm.evaluate('!document.getElementById("btn-floorplan").disabled'),
            'the plan attached but Draw Rooms stayed disabled, so the DM cannot use it');

  // ── E. A drop with nothing importable in it ────────────────────────────────
  const beforeJunk = (await names()).length;
  await dm.evaluate('__rigDrop([__rigText("notes.txt", "hello", "text/plain")])');
  await rig.sleep(1200);
  const junkDlg = await dialogNow();
  rig.check((await names()).length === beforeJunk,
            'a drop with nothing importable in it created a scene');
  rig.check(!junkDlg.shown,
            'a single unimportable dropped file raised a dialog: ' + JSON.stringify(junkDlg));

  // ── F. A backup, alone and in a crowd ──────────────────────────────────────
  const beforeZip = (await names()).length;
  await dm.evaluate('__rigPick([__rigText("Library.zip", "PK", "application/zip")])');
  await rig.sleep(600);
  const zipAlone = await dialogNow();
  rig.note('lone .zip through the picker: ' + JSON.stringify(zipAlone.title) + ' / ' +
           JSON.stringify(zipAlone.msg));
  rig.check((await names()).length === beforeZip,
            'a lone .zip through the picker was imported as a map');
  // ⚠ The discriminator between the two routes. restorePickedZip answers "Backups need the
  // desktop app"; importMapFiles answers "Import the backup on its own". A check on "a dialog
  // appeared" would pass for either, which is the whole regression.
  rig.check(zipAlone.shown && zipAlone.title.indexOf('desktop app') !== -1,
            'a lone .zip did not reach restorePickedZip — it was handed to the map importer ' +
            'instead: ' + JSON.stringify(zipAlone));
  await dismiss();

  await runBatch('[__rigFile("Library.zip", "application/zip"), __rigFile("Late Arrival.mp4")]',
                 60000);
  const zipCrowd = await dialogNow();
  rig.note('zip in a crowd: ' + JSON.stringify(zipCrowd.title) + ' / ' + JSON.stringify(zipCrowd.msg));
  rig.check(zipCrowd.shown && zipCrowd.msg.indexOf('Library.zip') !== -1,
            'a .zip in a multi-file selection was not refused by name: ' + JSON.stringify(zipCrowd));
  rig.check((await names()).length === beforeZip,
            'a selection holding a .zip imported some of its maps anyway: ' +
            JSON.stringify(await names()));
  await dismiss();

  // ── G. The batch label ─────────────────────────────────────────────────────
  let mark = await labelCount();
  const before2 = (await names()).length;
  rig.check(await runBatch('[__rigFile("Alpha Hall.mp4"), __rigFile("Beta Vault.mp4")]', 240000),
            'a clean batch of two never finished');
  const clean = await library();
  rig.note('clean batch: ' + JSON.stringify(clean.names.slice(before2)) + ' current=' + clean.current);
  rig.check(clean.names.length === before2 + 2,
            'two files did not produce two scenes: ' + JSON.stringify(clean.names));
  rig.check(clean.names.slice(before2).join('|') === 'Alpha Hall|Beta Vault',
            'the batch imported out of order: ' + JSON.stringify(clean.names));
  rig.check(clean.current === 'Alpha Hall',
            'a batch of two did not land on the first of the batch: ' + clean.current);

  const cleanLabels = await labelsSince(mark);
  rig.note('labels: ' + JSON.stringify(cleanLabels));
  rig.check(cleanLabels.some(l => l.startsWith('Map 1 of 2 - Alpha Hall')) &&
            cleanLabels.some(l => l.startsWith('Map 2 of 2 - Beta Vault')),
            'the overlay never carried the batch label: ' + JSON.stringify(cleanLabels));

  const afterClean = await dialogNow();
  rig.check(!afterClean.shown,
            'a clean batch ended in a dialog: ' + afterClean.title + ' / ' + afterClean.msg);
  rig.check(!afterClean.overlayUp, 'the progress overlay stayed up after the batch finished');

  mark = await labelCount();
  const before3 = (await names()).length;
  await runBatch('[__rigFile("Lone Tower.mp4")]', 240000);
  const lone = await library();
  rig.check(lone.current === 'Lone Tower', 'a single import did not land on its map: ' + lone.current);
  rig.check(lone.names.length === before3 + 1,
            'a single import did not add exactly one scene: ' + JSON.stringify(lone.names));
  const loneLabels = await labelsSince(mark);
  rig.check(!loneLabels.some(l => l.indexOf('Map 1 of 1') !== -1),
            'a single import wore a batch label: ' + JSON.stringify(loneLabels));
  rig.check(!(await dialogNow()).shown, 'a single clean import ended in a dialog');

  // ── H. One bad map costs that map, not the run ─────────────────────────────
  mark = await labelCount();
  const before4 = (await names()).length;
  rig.check(await runBatch('[__rigFile("Gate One.mp4"), __rigFile("Gate Two.mp4"),' +
                           ' __rigBrokenImage("Torn Export.png"), __rigFile("Gate Three.mp4")]',
                           240000),
            'a batch holding one broken map never finished');
  const mixed = await library();
  rig.note('after the mixed batch: ' + JSON.stringify(mixed.names.slice(before4)));
  rig.check(mixed.names.length === before4 + 3,
            'the batch did not import the three good files around the broken one: ' +
            JSON.stringify(mixed.names));
  rig.check(mixed.names.slice(before4).join('|') === 'Gate One|Gate Two|Gate Three',
            'the good files did not come through in order: ' + JSON.stringify(mixed.names));
  rig.check(mixed.current === 'Gate One',
            'the mixed batch did not land on its first map: ' + mixed.current);

  const mixedLabels = await labelsSince(mark);
  rig.check(mixedLabels.some(l => l.startsWith('Map 4 of 4 - Gate Three')),
            'the batch stopped counting at the broken file: ' + JSON.stringify(mixedLabels));

  const summary = await dialogNow();
  rig.note('summary: ' + JSON.stringify(summary.title) + ' / ' + JSON.stringify(summary.msg));
  rig.check(summary.shown, 'the broken file was never reported');
  rig.check(!summary.overlayUp,
            'the progress overlay is still up under the summary dialog, which is invisible below it');
  rig.check(summary.msg.indexOf('Torn Export.png') !== -1,
            'the summary does not name the file that failed: ' + summary.msg);
  rig.check(summary.msg.indexOf('Gate') === -1,
            'the summary names maps that imported fine: ' + summary.msg);
  rig.check(summary.msg.split('\n').filter(l => l.trim()).length === 1,
            'the summary is not one line per failure: ' + JSON.stringify(summary.msg));
  await dismiss();

  // A file that is not a map at all is filtered BEFORE anything loads, so it never reaches
  // createNewScene — and the batch counts only what it is actually going to import.
  mark = await labelCount();
  const before5 = (await names()).length;
  await runBatch('[__rigFile("Real Map.mp4"), __rigText("readme.txt", "hi", "text/plain")]', 240000);
  const filtered = await library();
  const filteredDlg = await dialogNow();
  rig.note('unimportable in a batch: ' + JSON.stringify(filteredDlg.msg));
  rig.check(filtered.names.length === before5 + 1,
            'a .txt in a selection of maps was imported as a scene: ' +
            JSON.stringify(filtered.names));
  rig.check(filteredDlg.shown && filteredDlg.msg.indexOf('readme.txt') !== -1,
            'a file that is not a map was dropped from the batch silently: ' +
            JSON.stringify(filteredDlg));
  // Counted, not just filtered: the label says "of 1" because the queue holds one map, not "of 2"
  // for the selection. The count of labels is asserted first — an empty list would pass `every`
  // for nothing at all.
  const filteredLabels = (await labelsSince(mark)).filter(l => l.indexOf('Map ') !== -1);
  rig.check(filteredLabels.length > 0 && filteredLabels.every(l => l.indexOf('Map 1 of 1') !== -1),
            'the batch counted the file it was never going to import: ' +
            JSON.stringify(filteredLabels));
  await dismiss();

  // ── I. A map that will not decode lets go, and the CALLER reports it ───────
  const before6 = (await names()).length;
  await dm.evaluate('globalThis.__rigR = null; globalThis.__rigSettled = false;' +
    ' createNewScene(__rigBrokenVideo("Torn Cavern.mp4"))' +
    '   .then(r => { globalThis.__rigR = r; globalThis.__rigSettled = true; },' +
    '         e => { globalThis.__rigR = { threw: String(e) }; globalThis.__rigSettled = true; }); 0');
  try { await dm.waitFor('globalThis.__rigSettled === true', 60000, 'the broken import to settle'); }
  catch (_) {}   // the check below reports the hang by name
  const brokenVid = await dm.evaluate('({ settled: globalThis.__rigSettled, r: globalThis.__rigR })');
  rig.note('broken animated import settled with: ' + JSON.stringify(brokenVid.r));
  rig.check(brokenVid.settled,
            'a broken animated map never settled the import — the overlay stays up and a batch ' +
            'behind it would hang forever');
  rig.check(!!brokenVid.r && brokenVid.r.ok === false,
            'a broken animated map did not resolve as a refusal: ' + JSON.stringify(brokenVid.r));
  rig.check(!!brokenVid.r && typeof brokenVid.r.reason === 'string' && brokenVid.r.reason.length > 0,
            'the refusal carries no reason, so the caller has nothing to report: ' +
            JSON.stringify(brokenVid.r));

  const vidDlg = await dialogNow();
  rig.note('dialog after the lone video failure: ' + JSON.stringify(vidDlg.msg));
  rig.check(vidDlg.shown, 'a broken animated map on its own reported nothing at all');
  rig.check(vidDlg.msg.indexOf('Torn Cavern.mp4') !== -1,
            'the failure was reported by the video loader instead of the caller — its own dialog ' +
            'cannot name the file: ' + JSON.stringify(vidDlg.msg));
  rig.check(vidDlg.msg.indexOf('Evermist could not read this video') === -1,
            "video.js raised its own dialog, so the caller's onFail never ran: " +
            JSON.stringify(vidDlg.msg));
  rig.check(!vidDlg.overlayUp, 'the progress overlay stayed up over the failure dialog');
  rig.check((await names()).length === before6,
            'a map that would not play left a scene behind: ' + JSON.stringify(await names()));
  await dismiss();

  const dlgMark = await dm.evaluate('globalThis.__rigDlgSeen.length');
  const before7 = (await names()).length;
  rig.check(await runBatch('[__rigFile("Left Wing.mp4"), __rigBrokenVideo("Half Copy.mp4"),' +
                           ' __rigFile("Right Wing.mp4")]', 240000),
            'the batch never finished — a broken animated map in the middle hung the run');
  const around = await names();
  rig.check(around.length === before7 + 2,
            'the two good maps around the broken animated one did not both import: ' +
            JSON.stringify(around));
  rig.check(around.indexOf('Left Wing') !== -1 && around.indexOf('Right Wing') !== -1,
            'the batch stopped at the broken animated map: ' + JSON.stringify(around));

  const vidSummary = await dialogNow();
  rig.note('batch summary: ' + JSON.stringify(vidSummary.msg));
  rig.check(vidSummary.shown,
            'the broken animated map was never reported at the end of the batch');
  rig.check(vidSummary.msg.indexOf('Half Copy.mp4') !== -1,
            'the summary does not name the animated map that failed: ' + JSON.stringify(vidSummary.msg));
  rig.check(vidSummary.msg.split('\n').filter(l => l.trim()).length === 1,
            'the summary is not one line for the one failure: ' + JSON.stringify(vidSummary.msg));

  // Every dialog that stood open during the batch, so a per-map dialog raised and dismissed
  // between polls still counts. The summary above is the only one allowed.
  const midBatch = (await dm.evaluate('globalThis.__rigDlgSeen')).slice(dlgMark)
    .filter(m => m.indexOf('Half Copy.mp4') === -1);
  rig.check(midBatch.length === 0,
            'a dialog interrupted the batch, so an unattended run stops to ask about one bad ' +
            'file: ' + JSON.stringify(Array.from(new Set(midBatch))));
  await dismiss();

  // No file at all, through the same route. This is the silent falsy-file return the loader's own
  // comment claims onFail covers; createNewScene cannot reach it (isVideoFile would throw first),
  // so it is driven directly.
  const noFile = await dm.evaluate(`(async () => {
    const seen = [];
    await new Promise(r => { loadVideoFromFile(null, () => r(), reason => { seen.push(reason); r(); }); });
    const a = document.getElementById('cd-anchor');
    return { seen, dialogUp: !!a && a.style.display === 'flex',
             msg: (document.getElementById('cd-msg') || {}).textContent || '' };
  })()`, 30000);
  rig.note('no file at all: ' + JSON.stringify(noFile.seen));
  rig.check(noFile.seen.length === 1 && typeof noFile.seen[0] === 'string' && noFile.seen[0].length > 0,
            'a falsy file did not reach onFail with a reason: ' + JSON.stringify(noFile.seen));
  rig.check(!noFile.dialogUp,
            'the loader raised its own dialog for a falsy file even though a caller was ' +
            'listening: ' + JSON.stringify(noFile.msg));

  // ── J. The overlay and a dialog are never up together ──────────────────────
  const both = await dm.evaluate('(() => { clearInterval(globalThis.__rigTick);' +
    ' return globalThis.__rigBoth; })()');
  rig.check(both.length === 0,
            'the progress overlay was up while a dialog was on screen, which hides the dialog ' +
            'under it: ' + JSON.stringify(Array.from(new Set(both))));

  rig.byEye('a .zip picked through the real "+" button, which is the only way restorePickedZip ' +
            'gets a path on disk to restore from — a File built in-page has none, and ' +
            'electronAPI cannot be stubbed to pretend otherwise');
  rig.byEye('maps dragged in from a real Explorer window, plus a map and its sibling .dd2vtt ' +
            'dropped together, so the plan is found beside the map rather than reported as a ' +
            'file that would not open');
  rig.byEye('a real half-copied Dungeon Alchemist .webm — a file whose container is intact but ' +
            'whose stream is cut short can fail later than the decode, and only a real one has ' +
            'that shape');
};
