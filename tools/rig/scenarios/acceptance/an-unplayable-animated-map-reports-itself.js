'use strict';

// an-unplayable-animated-map-reports-itself.js — a video that will not decode has to LET GO of the
// import, and the report has to come from the caller.
//
// Criteria, each with its check directly beneath.
//
//   An animated map that cannot be played settles the import instead of hanging it.
//     → a broken .mp4 through createNewScene resolves { ok: false } with a reason
//   The failure is reported by the CALLER, not by the video loader itself.
//     → the dialog names the file, which is something only createNewScene knows
//   The progress overlay comes down on the way out.
//     → #map-progress is not up once the import has settled, and no scene was created
//   A broken animated map inside a batch costs that map and not the run.
//     → two stills around a broken .mp4 import fine, and the run finishes
//   A batch reports it once at the end, and the map gets no dialog of its own.
//     → one summary naming the .mp4 only, and no dialog was up while the batch was still going
//   A missing file answers through the same route.
//     → loadVideoFromFile(null, …) hands its reason to onFail rather than raising its own dialog
//
// ⚠ THE TWO DIALOGS READ ALMOST THE SAME AND ONLY ONE OF THEM IS RIGHT. video.js's own bail text
// is "Evermist could not read this video"; the caller's names the file. They share a title, so a
// check on the title alone passes whichever one fired — which is exactly the regression this file
// exists to catch. Assert on the MESSAGE.
//
// ⚠ NEVER AWAIT createNewScene OVER THE WIRE HERE. Dropping onFail leaves the import's promise
// unsettled forever, so an awaited call becomes a CDP timeout that names the wait rather than the
// behaviour. Every import below is kicked off, flagged on settle, and polled — so a hang is
// reported as the named failure it is.

module.exports = async function anUnplayableAnimatedMapReportsItself(rig) {
  const dm = rig.dm;

  const still = await rig.fixtures.stillMap(dm, rig.fixtureDir,
    { w: 900, h: 600, name: 'rig-fail-still.png' });
  await rig.fixtures.asFileExpr(dm, still);   // leaves __rigB64 in the page

  await dm.evaluate(`(() => {
    // Compression would run convertVideoForImport over the broken bytes before the loader ever
    // saw them, which is a different path. Off is also the shipped default.
    localStorage.removeItem('evermist.compressBigVideos');

    globalThis.__rigFile = name => {
      const bin = atob(globalThis.__rigB64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return new File([u8], name, { type: 'image/png' });
    };
    // Passes isVideoFile on both its extension and its MIME type, then fails to decode — the
    // honest shape of a truncated or half-copied export.
    globalThis.__rigBrokenVideo = name => new File(
      [new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 9, 9, 9, 9, 0, 0])],
      name, { type: 'video/mp4' });

    // Sampled in the page: a dialog raised mid-batch and dismissed between two round trips would
    // be invisible from Node.
    globalThis.__rigDlgSeen = [];
    globalThis.__rigTick = setInterval(() => {
      const a = document.getElementById('cd-anchor');
      if (a && a.style.display === 'flex') {
        globalThis.__rigDlgSeen.push((document.getElementById('cd-msg') || {}).textContent || '');
      }
    }, 30);
    0
  })()`);

  rig.check(await dm.evaluate('!compressBigVideosEnabled()'),
            'compression is on, so the broken bytes go through the converter instead of the loader');

  const dialogNow = () => dm.evaluate(`({
    shown: (() => { const a = document.getElementById('cd-anchor');
                    return !!a && a.style.display === 'flex'; })(),
    title: (document.getElementById('cd-title') || {}).textContent || '',
    msg: (document.getElementById('cd-msg') || {}).textContent || '',
    overlayUp: (() => { const p = document.getElementById('map-progress');
                        return !!p && p.style.display === 'flex'; })(),
  })`);

  const dismiss = () => dm.evaluate('(() => { const b = document.getElementById("cd-ok");' +
    ' if (b) b.click(); return 0; })()');

  const library = () => dm.evaluate('allScenes.map(s => s.name)');

  // ⚠ Kicked off rather than awaited — see the header. Returns whether it settled AT ALL, which is
  // the difference between a reported failure and a hang.
  const importOne = async (expr, ms) => {
    await dm.evaluate('globalThis.__rigR = null; globalThis.__rigSettled = false;' +
      ' createNewScene(' + expr + ').then(r => { globalThis.__rigR = r; globalThis.__rigSettled = true; },' +
      ' e => { globalThis.__rigR = { threw: String(e) }; globalThis.__rigSettled = true; }); 0');
    try { await dm.waitFor('globalThis.__rigSettled === true', ms, 'the broken import to settle'); }
    catch (_) {}   // the check below reports the hang by name
    return dm.evaluate('({ settled: globalThis.__rigSettled, r: globalThis.__rigR })');
  };

  const runBatch = async (expr, ms) => {
    await dm.evaluate('globalThis.__rigDone = false;' +
      ' importMapFiles(' + expr + ').then(() => { globalThis.__rigDone = true; }); 0');
    try { await dm.waitFor('globalThis.__rigDone === true', ms, 'the batch to finish'); } catch (_) {}
    return dm.evaluate('globalThis.__rigDone === true');
  };

  // ── One broken animated map, on its own ─────────────────────────────────────
  const before = (await library()).length;
  const lone = await importOne('__rigBrokenVideo("Torn Cavern.mp4")', 60000);
  rig.note('broken animated import settled with: ' + JSON.stringify(lone.r));
  rig.check(lone.settled,
            'a broken animated map never settled the import — the overlay stays up and a batch ' +
            'behind it would hang forever');
  rig.check(!!lone.r && lone.r.ok === false,
            'a broken animated map did not resolve as a refusal: ' + JSON.stringify(lone.r));
  rig.check(!!lone.r && typeof lone.r.reason === 'string' && lone.r.reason.length > 0,
            'the refusal carries no reason, so the caller has nothing to report: ' + JSON.stringify(lone.r));

  const loneDlg = await dialogNow();
  rig.note('dialog after the lone failure: ' + JSON.stringify(loneDlg.title) + ' / ' + JSON.stringify(loneDlg.msg));
  rig.check(loneDlg.shown, 'a broken animated map on its own reported nothing at all');
  // ⚠ The MESSAGE, not the title: both dialogs share the title, and only the caller's knows the name.
  rig.check(loneDlg.msg.indexOf('Torn Cavern.mp4') !== -1,
            'the failure was reported by the video loader instead of the caller — its own dialog ' +
            'cannot name the file: ' + JSON.stringify(loneDlg.msg));
  rig.check(loneDlg.msg.indexOf('Evermist could not read this video') === -1,
            "video.js raised its own dialog, so the caller's onFail never ran: " + JSON.stringify(loneDlg.msg));
  rig.check(!loneDlg.overlayUp, 'the progress overlay stayed up over the failure dialog');
  rig.check((await library()).length === before,
            'a map that would not play left a scene behind: ' + JSON.stringify(await library()));
  await dismiss();

  // ── The same file inside a batch ────────────────────────────────────────────
  const mark = await dm.evaluate('globalThis.__rigDlgSeen.length');
  const finished = await runBatch('[__rigFile("Left Wing.png"), __rigBrokenVideo("Half Copy.mp4"),' +
                                  ' __rigFile("Right Wing.png")]', 240000);
  rig.check(finished, 'the batch never finished — a broken animated map in the middle hung the run');
  const after = await library();
  rig.note('after the batch: ' + JSON.stringify(after));
  rig.check(after.length === before + 2,
            'the two good maps around the broken one did not both import: ' + JSON.stringify(after));
  rig.check(after.indexOf('Left Wing') !== -1 && after.indexOf('Right Wing') !== -1,
            'the batch stopped at the broken animated map: ' + JSON.stringify(after));

  const summary = await dialogNow();
  rig.note('batch summary: ' + JSON.stringify(summary.title) + ' / ' + JSON.stringify(summary.msg));
  rig.check(summary.shown, 'the broken animated map was never reported at the end of the batch');
  rig.check(summary.msg.indexOf('Half Copy.mp4') !== -1,
            'the summary does not name the animated map that failed: ' + JSON.stringify(summary.msg));
  rig.check(summary.msg.split('\n').filter(l => l.trim()).length === 1,
            'the summary is not one line for the one failure: ' + JSON.stringify(summary.msg));
  rig.check(!summary.overlayUp, 'the progress overlay is still up under the summary dialog');

  // Every dialog that stood open during the batch, so a per-map dialog raised and dismissed
  // between polls still counts. The summary above is the only one allowed.
  const midBatch = (await dm.evaluate('globalThis.__rigDlgSeen')).slice(mark)
    .filter(m => m.indexOf('Half Copy.mp4') === -1);
  rig.check(midBatch.length === 0,
            'a dialog interrupted the batch, so an unattended run stops to ask about one bad file: ' +
            JSON.stringify(Array.from(new Set(midBatch))));
  await dismiss();

  // ── No file at all, through the same route ──────────────────────────────────
  // The silent falsy-file return the loader's own comment claims onFail covers. createNewScene
  // cannot reach it (isVideoFile would throw first), so it is driven directly.
  const noFile = await dm.evaluate(`(async () => {
    const seen = [];
    const before = (document.getElementById('cd-msg') || {}).textContent || '';
    await new Promise(r => { loadVideoFromFile(null, () => r(), reason => { seen.push(reason); r(); }); });
    const a = document.getElementById('cd-anchor');
    return { seen, dialogUp: !!a && a.style.display === 'flex',
             msg: (document.getElementById('cd-msg') || {}).textContent || '', before };
  })()`, 30000);
  rig.note('no file at all: ' + JSON.stringify(noFile.seen));
  rig.check(noFile.seen.length === 1 && typeof noFile.seen[0] === 'string' && noFile.seen[0].length > 0,
            'a falsy file did not reach onFail with a reason: ' + JSON.stringify(noFile.seen));
  rig.check(!noFile.dialogUp,
            'the loader raised its own dialog for a falsy file even though a caller was listening: ' +
            JSON.stringify(noFile.msg));

  await dm.evaluate('clearInterval(globalThis.__rigTick); 0');

  rig.byEye('a real half-copied Dungeon Alchemist .webm — a file whose container is intact but ' +
            'whose stream is cut short can fail later than the decode, and only a real one has ' +
            'that shape');
};
