'use strict';

// import-many-maps-at-once.js — pick ten maps, walk away, come back done.
//
// Criteria, each with its check directly beneath.
//
//   N files produce N scenes, in the order they were picked, and land on the FIRST of them.
//     → two files import, both scenes exist in order, the current scene is the first
//   The overlay says which map of how many is going through.
//     → every label raised during a batch starts "Map i of N - <scene name>"
//   A clean run says nothing at the end.
//     → no dialog is up when the batch resolves
//   One unloadable file does not stop the run, and is named once at the end.
//     → three good files plus a broken one: three scenes, one summary naming only the broken one
//   The progress overlay is never up while a dialog is on screen.
//     → sampled continuously through both runs; #map-progress is z-index 10000, the dialog is 620
//   A backup inside a multi-file selection imports nothing and says why.
//     → the scene count does not move and the dialog names the .zip
//   A single import behaves exactly as it always has.
//     → it lands on its own map and carries no batch label
//
// ⚠ THE RIG CANNOT REACH THE FLOOR-PLAN HALF OF AN IMPORT. DOM.setFileInputFiles does not
// populate a file input in an Electron renderer, so a scenario has to hand createNewScene a File
// built in-page — and such a File has no path on disk, so findPlanForFile returns null and no plan
// is ever found. Scene count, order and labels are all this file can speak to.

module.exports = async function importManyMapsAtOnce(rig) {
  const dm = rig.dm;

  const still = await rig.fixtures.stillMap(dm, rig.fixtureDir,
    { w: 1000, h: 700, name: 'rig-batch-still.png' });
  await rig.fixtures.asFileExpr(dm, still);   // leaves __rigB64 in the page

  // ── The recorders ───────────────────────────────────────────────────────────
  // showMapProgress is a plain function declaration in a classic script, so it IS a property of
  // window and can be wrapped from here — the app itself is untouched. Wrapping it is the only
  // way to catch a label for a map that imports faster than any sampler ticks.
  await dm.evaluate(`(() => {
    globalThis.__rigLabels = [];
    const orig = showMapProgress;
    window.showMapProgress = function (label) {
      orig(label);
      globalThis.__rigLabels.push(document.getElementById('map-progress-label').textContent);
    };
    showMapProgress = window.showMapProgress;

    // The overlay/dialog invariant, sampled in the page rather than over the wire so a moment
    // where both are up cannot slip between two round trips.
    globalThis.__rigBoth = [];
    globalThis.__rigTick = setInterval(() => {
      const p = document.getElementById('map-progress');
      const a = document.getElementById('cd-anchor');
      const up = !!p && p.style.display === 'flex';
      const dlg = !!a && a.style.display === 'flex';
      if (up && dlg) globalThis.__rigBoth.push(document.getElementById('map-progress-label').textContent);
    }, 30);

    globalThis.__rigFile = (name, type) => {
      const bin = atob(globalThis.__rigB64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return new File([u8], name, { type: type || 'image/png' });
    };
    // Passes the extension gate and the MIME gate, and then fails to decode — the honest shape
    // of a truncated export, which is what a batch has to survive.
    globalThis.__rigBroken = name => new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0])],
                                              name, { type: 'image/png' });
    0
  })()`);

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

  const labelsSince = async mark => (await dm.evaluate('globalThis.__rigLabels')).slice(mark);
  const labelCount = () => dm.evaluate('globalThis.__rigLabels.length');

  // Starts the real entry point and waits for it to finish, without holding a CDP call open for
  // the length of the run.
  const runBatch = async (filesExpr, ms) => {
    await dm.evaluate('globalThis.__rigDone = false;' +
      ' importMapFiles(' + filesExpr + ').then(() => { globalThis.__rigDone = true; }); 0');
    await dm.waitFor('globalThis.__rigDone === true', ms, 'the batch to finish');
  };

  // ── A clean batch of two ────────────────────────────────────────────────────
  let mark = await labelCount();
  await runBatch('[__rigFile("Alpha Hall.png"), __rigFile("Beta Vault.png")]', 240000);
  const clean = await library();
  rig.note('clean batch: ' + JSON.stringify(clean));
  rig.check(clean.names.length === 2, 'two files did not produce two scenes: ' + JSON.stringify(clean.names));
  rig.check(clean.names[0] === 'Alpha Hall' && clean.names[1] === 'Beta Vault',
            'the batch imported out of order: ' + JSON.stringify(clean.names));
  rig.check(clean.current === 'Alpha Hall',
            'a batch of two did not land on the first of the batch: ' + clean.current);

  const cleanLabels = await labelsSince(mark);
  rig.note('labels: ' + JSON.stringify(cleanLabels));
  rig.check(cleanLabels.some(l => l.startsWith('Map 1 of 2 - Alpha Hall')) &&
            cleanLabels.some(l => l.startsWith('Map 2 of 2 - Beta Vault')),
            'the overlay never carried the batch label: ' + JSON.stringify(cleanLabels));

  const afterClean = await dialogNow();
  rig.check(!afterClean.shown, 'a clean batch ended in a dialog: ' + afterClean.title + ' / ' + afterClean.msg);
  rig.check(!afterClean.overlayUp, 'the progress overlay stayed up after the batch finished');

  // ── One broken file among three good ones ───────────────────────────────────
  mark = await labelCount();
  await runBatch('[__rigFile("Gate One.png"), __rigFile("Gate Two.png"), __rigBroken("Torn Export.png"),' +
                 ' __rigFile("Gate Three.png")]', 240000);
  const mixed = await library();
  rig.note('after the mixed batch: ' + JSON.stringify(mixed));
  rig.check(mixed.names.length === 5,
            'the batch did not import the three good files around the broken one: ' + JSON.stringify(mixed.names));
  rig.check(mixed.names.slice(2).join('|') === 'Gate One|Gate Two|Gate Three',
            'the good files did not come through in order: ' + JSON.stringify(mixed.names));
  rig.check(mixed.current === 'Gate One', 'the mixed batch did not land on its first map: ' + mixed.current);

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

  // ── A backup inside a multi-file selection ──────────────────────────────────
  const before = (await library()).names.length;
  await runBatch('[__rigFile("Library.zip", "application/zip"), __rigFile("Late Arrival.png")]', 60000);
  const zipDlg = await dialogNow();
  const afterZip = await library();
  rig.note('zip refusal: ' + JSON.stringify(zipDlg.title) + ' / ' + JSON.stringify(zipDlg.msg));
  rig.check(zipDlg.shown && zipDlg.msg.indexOf('Library.zip') !== -1,
            'a .zip in a multi-file selection was not refused by name: ' + JSON.stringify(zipDlg));
  rig.check(afterZip.names.length === before,
            'a selection holding a .zip imported some of its maps anyway: ' + JSON.stringify(afterZip.names));
  await dismiss();

  // ── One file on its own, unchanged ──────────────────────────────────────────
  mark = await labelCount();
  await runBatch('[__rigFile("Lone Tower.png")]', 240000);
  const lone = await library();
  rig.check(lone.current === 'Lone Tower', 'a single import did not land on its map: ' + lone.current);
  rig.check(lone.names.length === before + 1,
            'a single import did not add exactly one scene: ' + JSON.stringify(lone.names));
  const loneLabels = await labelsSince(mark);
  rig.check(!loneLabels.some(l => l.indexOf('Map 1 of 1') !== -1),
            'a single import wore a batch label: ' + JSON.stringify(loneLabels));
  const afterLone = await dialogNow();
  rig.check(!afterLone.shown, 'a single clean import ended in a dialog: ' + afterLone.title);

  // ── The invariant, over everything above ────────────────────────────────────
  const both = await dm.evaluate('(() => { clearInterval(globalThis.__rigTick); return globalThis.__rigBoth; })()');
  rig.check(both.length === 0,
            'the progress overlay was up while a dialog was on screen: ' + JSON.stringify(both));

  rig.byEye('a real Dungeon Alchemist export plus its sibling .dd2vtt, imported so the derived ' +
            'Grid Size can be held against the map\'s own squares — the rig can never see a floor ' +
            'plan, because a File it builds in-page has no path on disk for findPlanForFile');
  rig.byEye('a floor plan surviving a real multi-file selection through the "+" button, and the ' +
            'notice appearing once for the map the batch lands on');
};
