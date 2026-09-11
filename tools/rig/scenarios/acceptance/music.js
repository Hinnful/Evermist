'use strict';

// music.js — THE MUSIC BUBBLE AT THE TOP OF THE DM WINDOW.
//
// THE GOAL OF THIS FEATURE: no YouTube tab is open for music during a session. The DM picks a
// track from a control at the top of the Evermist window, it fades in, and picking another
// crossfades to it. The music folder IS the library, so every list here is a read of that folder.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks directly beneath it, in order.
//
//   A. The bubble is on the DM window and ABSENT from the Player. Music never reaches the TV
//      as a control, and the Player has no UI at all.
//   B. The panel opens on a click and lists exactly the audio files in the music folder, under
//      their display names rather than their filenames.
//   C. Clicking a row plays that track, lights it, and shuts the panel — one gesture, and the
//      map comes back.
//   D. Picking a second track CROSSFADES: both decks carry audio part-way through, exactly one
//      carries it after, and no single file is ever open on two elements at once.
//   E. The filter narrows the list, in Cyrillic as well as Latin.
//   F. Pause keeps the position and the loaded track, and a second press resumes from there
//      rather than restarting.
//   G. Deleting a track removes the file from the folder and the row from the list, and never
//      touches the maps folder beside it.
//   H. The volume slider drives the app's own fill and knob, not a bare range input.
//   I. The download panel's action bar replaces the header while anything is ticked, Select all
//      skips tracks already on disk, and its label flips once they are all picked.
//   J. A click anywhere off the bubble shuts the track panel, so it never has to be dismissed
//      with the button it was opened by.
//   K. A running download shows its progress on the pill, and reopening the Add music panel
//      mid-download keeps the queue rather than asking for the link again.
//   L. Sound actually leaves the speaker, and the fade sounds like a fade.
//   M. Pasting a YouTube link downloads the tracks picked from it.
//
// ⚠ THE TRACKS ARE WRITTEN HERE AS WAV, not downloaded. A scenario must never reach YouTube: it
// needs the network, a real video and a 50MB transfer. L and M are therefore rig.byEye, and
// so is the audible half of a fade: a run is MUTED at launch by tools/rig/run.js.
//
// ⚠ `--user-data-dir` IS what `app.getPath('userData')` resolves to, so the music folder is
// `<profileDir>/music`. Writing there is the only way to give an isolated profile a library.

const fs = require('fs');
const path = require('path');

const MAP_W = 1600, MAP_H = 1000;

// A 44-byte header plus 8-bit mono PCM. Small, valid, and Chromium decodes it without ffmpeg —
// which is the same reason the feature ships no ffmpeg.
function wav(seconds) {
  const rate = 8000;
  const samples = rate * seconds;
  const buf = Buffer.alloc(44 + samples);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate, 28);
  buf.writeUInt16LE(1, 32);
  buf.writeUInt16LE(8, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples, 40);
  for (let i = 0; i < samples; i++) buf[44 + i] = 128 + Math.round(40 * Math.sin(i / 8));
  return buf;
}

module.exports = async function musicFeature(rig) {
  const dm = rig.dm;

  // ── The library, written straight into the profile's music folder ──────────
  const musicDir = path.join(rig.profileDir, 'music');
  fs.mkdirSync(musicDir, { recursive: true });
  const TRACKS = [
    'Strahd Battle Theme [dQw4w9WgXcQ].wav',
    'Village of Barovia [aBcDeFgHiJk].wav',
    'Крипты [zYxWvUtSrQp].wav',
  ];
  // Six seconds, not two: the tracks loop, and a short file wraps its currentTime back to zero
  // often enough that the "is playback consuming this" check below cannot read a clean advance.
  for (const name of TRACKS) fs.writeFileSync(path.join(musicDir, name), wav(6));

  // ── A. On the DM, absent from the Player ──────────────────────────────────
  await dm.waitFor("!!document.getElementById('mu-pill')", 30000, 'the music bubble to exist');
  const resting = await dm.evaluate(`(() => {
    const b = document.getElementById('music-bubble');
    const p = document.getElementById('mu-panel');
    return {
      resting: b.classList.contains('mu-resting'),
      panel: getComputedStyle(p).display,
      radius: getComputedStyle(document.getElementById('mu-pill')).borderTopLeftRadius,
    };
  })()`);
  rig.check(resting.resting,
    'the bubble is not in its resting state with nothing playing, so it shows a track name for a ' +
    'track the DM never started');
  rig.check(resting.panel === 'none',
    'the music panel is open before anyone clicked it, so a 300px panel sits over the map at boot');
  // --panel-radius, shared with every other floating surface. A probe reading the variable
  // itself could not see it disappear, so this reads the resolved number.
  rig.check(parseFloat(resting.radius) === 12,
    'the pill corner radius resolves to ' + resting.radius + ' rather than the 12px every other ' +
    'floating surface in the app uses');

  const map = await rig.fixtures.tableMap(dm, rig.fixtureDir, { w: MAP_W, h: MAP_H });
  const expr = await rig.fixtures.asFileExpr(dm, map);
  await dm.evaluate('createNewScene(' + expr + ')', 120000);
  await dm.waitFor('!!mapOffscreen', 120000, 'the DM to finish importing the map');

  const player = await rig.player();
  const onPlayer = await player.evaluate(`(() => {
    const anchor = document.getElementById('music-anchor');
    return { shown: anchor ? getComputedStyle(anchor).display : 'none' };
  })()`);
  rig.check(onPlayer.shown === 'none',
    'the music bubble is visible on the PLAYER window, so a control the players must never see ' +
    'is sitting on the TV');

  // ── B. The panel lists the folder, by display name ────────────────────────
  await dm.evaluate("document.getElementById('btn-mu-open').click()");
  await dm.waitFor('_muTracks.length === 3', 15000, 'the panel to read the three files on disk');
  const listed = await dm.evaluate(`(() => {
    const rows = [...document.querySelectorAll('#mu-list .mu-row .mu-row-name')].map(e => e.textContent);
    return { rows: rows, panel: getComputedStyle(document.getElementById('mu-panel')).display };
  })()`);
  rig.check(listed.panel === 'flex',
    'clicking the bubble did not open the panel, so nothing below this measured the real list');
  rig.check(listed.rows.length === 3,
    'the panel lists ' + listed.rows.length + ' rows for 3 files in the music folder, so the ' +
    'library and the folder have stopped agreeing');
  rig.check(listed.rows.indexOf('Strahd Battle Theme') !== -1,
    'the list shows no row called "Strahd Battle Theme", so the video id and the extension are ' +
    'reaching the DM instead of the track name: ' + JSON.stringify(listed.rows));
  rig.check(listed.rows.indexOf('Крипты') !== -1,
    'a Cyrillic track name did not survive the folder read, so a non-Latin library is unusable: ' +
    JSON.stringify(listed.rows));

  // ── H. The volume slider is the app's, not a bare range ───────────────────
  // Read while the panel is open: an element inside display:none has zero-sized rects.
  const slider = await dm.evaluate(`(() => {
    const r = document.getElementById('mu-vol');
    r.value = '35';
    r.dispatchEvent(new Event('input'));
    const wrap = r.closest('.cp-slider');
    const fill = wrap && wrap.querySelector('.cp-slider-fill');
    const knob = wrap && wrap.querySelector('.cp-slider-knob');
    return {
      wrapped: !!wrap,
      fill: fill ? fill.style.width : null,
      knob: knob ? knob.style.left : null,
      opacity: r ? getComputedStyle(r).opacity : null,
    };
  })()`);
  rig.check(slider.wrapped && slider.fill === '35%' && slider.knob === '35%',
    'the volume slider did not drive the app\'s own fill and knob (fill ' + slider.fill +
    ', knob ' + slider.knob + '), so it renders as a second slider look in one app');
  rig.check(parseFloat(slider.opacity) === 0,
    'the range input is visible at opacity ' + slider.opacity + ', so Chromium\'s own slider ' +
    'paints on top of the app\'s');
  rig.check(await dm.evaluate('Math.abs(_muVolume - 0.35) < 0.001'),
    'moving the slider did not reach the volume the decks read');

  // ── C. A click plays, lights the row, and shuts the panel ─────────────────
  // ⚠ MUTED AT THE ELEMENT TOO, on top of run.js's `--mute-audio`. Two independent guarantees,
  // because one loud hour-long track out of a run nobody was watching is the whole trust of the
  // rig. `muted` is independent of `volume`, so every fade assertion below still measures the
  // real ramp.
  await dm.evaluate('_muEnsureDecks(); _muDecks.forEach(d => { d.el.muted = true; }); 0');

  await dm.evaluate(`(() => {
    const rows = [...document.querySelectorAll('#mu-list .mu-row')];
    rows.find(r => r.querySelector('.mu-row-name').textContent === 'Strahd Battle Theme').click();
  })()`);
  await dm.waitFor("_muPlaying === 'Strahd Battle Theme [dQw4w9WgXcQ].wav'", 15000,
                   'the clicked track to become the playing one');
  const afterPick = await dm.evaluate(`(() => ({
    panel: getComputedStyle(document.getElementById('mu-panel')).display,
    lit: document.querySelectorAll('#mu-list .mu-row-on').length,
    pill: document.getElementById('mu-pill-name').textContent,
    resting: document.getElementById('music-bubble').classList.contains('mu-resting'),
  }))()`);
  rig.check(afterPick.panel === 'none',
    'the panel stayed open after a pick, so the DM has to shut it by hand before the map is visible');
  rig.check(afterPick.lit === 1,
    afterPick.lit + ' rows are lit as playing, so the DM cannot tell which track is live');
  rig.check(afterPick.pill === 'Strahd Battle Theme',
    'the collapsed pill reads "' + afterPick.pill + '" rather than the playing track');
  rig.check(!afterPick.resting,
    'the bubble is still in its resting state with a track playing, so it shows a note icon ' +
    'instead of what is on');

  // ── D. A second pick crossfades, and no file is open twice ────────────────
  // ⚠ LET THE FIRST FADE FINISH FIRST. Clicking the second track while the first is still
  // fading IN leaves the outgoing deck near phase 0, so it drops out of the overlap before the
  // incoming one reaches it and this criterion measures nothing. A real pick is seconds later.
  await dm.waitFor('_muDecks.every(d => d.timer === 0)', 15000, 'the first fade-in to finish');

  await dm.evaluate("document.getElementById('btn-mu-open').click()");
  await dm.evaluate(`(() => {
    const rows = [...document.querySelectorAll('#mu-list .mu-row')];
    rows.find(r => r.querySelector('.mu-row-name').textContent === 'Village of Barovia').click();
  })()`);
  // Mid-ramp, so poll for it rather than sleeping into the middle of a 2s fade.
  await dm.waitFor('_muDecks && _muDecks[0].phase > 0.05 && _muDecks[1].phase > 0.05', 5000,
                   'both decks to carry audio part-way through the crossfade');
  const mid = await dm.evaluate(`(() => {
    const [a, b] = _muDecks;
    return {
      srcs: [a.el.currentSrc || a.el.src, b.el.currentSrc || b.el.src],
      vols: [a.el.volume, b.el.volume],
      volume: _muVolume,
    };
  })()`);
  rig.check(mid.srcs[0] !== mid.srcs[1],
    'both decks hold the same file during a crossfade. Two media elements on one file starve ' +
    "Chromium's pipeline and both windows stall — the landmine main.js:283 exists for");
  rig.check(mid.vols[0] > 0 && mid.vols[1] > 0,
    'only one deck has volume mid-crossfade (' + JSON.stringify(mid.vols) + '), so this is a cut ' +
    'rather than a fade');
  // Equal power is what stops the middle of a crossfade sounding like a dip. The tolerance
  // allows one tick of drift: the two decks run independent timers, so their phases sum to
  // 1 give or take a step.
  const power = mid.vols[0] * mid.vols[0] + mid.vols[1] * mid.vols[1];
  const want = mid.volume * mid.volume;
  rig.check(Math.abs(power - want) < 0.04,
    'the two decks sum to ' + power.toFixed(3) + ' power against ' + want.toFixed(3) +
    ', so the crossfade dips in the middle rather than holding level');

  await dm.waitFor('_muDecks[0].timer === 0 && _muDecks[1].timer === 0', 15000,
                   'the crossfade to finish');
  const settled = await dm.evaluate(`(() => ({
    live: _muDecks.filter(d => d.el.volume > 0 && !d.el.paused).length,
    cleared: _muDecks.filter(d => !d.el.getAttribute('src')).length,
  }))()`);
  rig.check(settled.live === 1,
    settled.live + ' decks are still playing after the crossfade settled, so a track is decoding ' +
    'silently forever');
  rig.check(settled.cleared === 1,
    'the faded-out deck kept its src, so it holds a decoded file open with nothing playing it');

  // The pipeline is FED, which is the automatable half of "sound reaches the speaker": the
  // decoder produced data and playback is consuming it. A muted run cannot prove the rest.
  // ⚠ A CHANGE, not an increase: the track loops, so currentTime wraps back to zero.
  const t0 = await dm.evaluate('_muDecks[_muActive].el.currentTime');
  await dm.waitFor('Math.abs(_muDecks[_muActive].el.currentTime - ' + t0 + ') > 0.05', 8000,
                   'the playing deck to advance through the file');
  const fed = await dm.evaluate(`(() => {
    const d = _muDecks[_muActive];
    return { ready: d.el.readyState, vol: d.el.volume, err: d.el.error ? d.el.error.code : null };
  })()`);
  rig.check(fed.ready >= 2 && fed.err === null,
    'the playing deck has no decoded audio (readyState ' + fed.ready + ', error ' + fed.err +
    '), so nothing would reach the speaker however loud the volume');
  rig.check(fed.vol > 0,
    'the playing deck sits at volume ' + fed.vol + ' after its fade finished, so a finished ' +
    'fade-in leaves the track silent');

  // Clicking the row that is already playing must do NOTHING — a second element on the same
  // file is the stall above.
  const before = await dm.evaluate('_muPlaying');
  await dm.evaluate("document.getElementById('btn-mu-open').click()");
  await dm.evaluate("document.querySelector('#mu-list .mu-row-on').click()");
  rig.check(await dm.evaluate('_muPlaying === ' + JSON.stringify(before)),
    'clicking the playing row changed what is playing, so it can open a second element on the ' +
    'file already loaded');

  // The concurrent-decode figure, with an animated map on both windows and music running.
  const dmMedia = await dm.evaluate("document.querySelectorAll('audio,video').length");
  const plMedia = await player.evaluate("document.querySelectorAll('audio,video').length");
  rig.note('live media elements with an animated map and music playing: DM ' + dmMedia +
           ', Player ' + plMedia);

  // ── E. The filter narrows the list ────────────────────────────────────────
  const setFilter = (v) => dm.evaluate(`(() => {
    const f = document.getElementById('mu-filter');
    f.value = ${JSON.stringify(v)};
    f.dispatchEvent(new Event('input'));
  })()`);
  await setFilter('barovia');
  rig.check(await dm.evaluate("document.querySelectorAll('#mu-list .mu-row').length === 1"),
    'filtering on "barovia" did not narrow the list to one row, so a hundred tracks cannot be ' +
    'searched');
  await setFilter('КРИПТЫ');
  rig.check(await dm.evaluate("document.querySelectorAll('#mu-list .mu-row').length === 1"),
    'an upper-case Cyrillic filter matched nothing, so case folding is Latin-only');
  await setFilter('dQw4');
  rig.check(await dm.evaluate("document.querySelectorAll('#mu-list .mu-row').length === 0"),
    'four characters of a video id matched a track, so the filter reads the filename rather ' +
    'than the name the DM sees');
  await setFilter('');

  // ── F. Pause keeps the position, and a second press resumes ───────────────
  // ⚠ WAIT FOR THE TRACK TO ADVANCE FIRST. The position pause keeps is the position it had, so
  // pressing pause on an element still sitting at 0 asserts nothing. A loaded CI runner reaches
  // this line before a muted deck in a parked window has played a single frame.
  await dm.waitFor('_muDecks[_muActive].el.currentTime > 0', 20000,
                   'the playing track to advance past its first frame');
  await dm.evaluate("document.getElementById('btn-mu-pause').click()");
  rig.check(await dm.evaluate('_muPaused === true'),
    'pressing pause did not put the bubble into its paused state');
  rig.check(await dm.evaluate('_muPlaying !== null'),
    'pause forgot which track was loaded, so it behaves as a stop and the pill goes blank');
  const paused = await dm.evaluate(`(() => ({
    flat: document.getElementById('music-bubble').classList.contains('mu-paused'),
    playIcon: document.getElementById('mu-ico-play').style.display !== 'none',
    pauseIcon: document.getElementById('mu-ico-pause').style.display !== 'none',
  }))()`);
  rig.check(paused.flat,
    'the level bars are still animating while paused, so the pill says sound is coming out');
  rig.check(paused.playIcon && !paused.pauseIcon,
    'the pill still shows a pause icon while paused, so the button does not say what it will do');

  await dm.waitFor('_muDecks[_muActive].el.paused', 15000, 'pause to fade the track out');
  const at = await dm.evaluate('_muDecks[_muActive].el.currentTime');
  rig.check(at > 0,
    'pause left the position at ' + at + ', so resuming restarts the track from the top');
  rig.check(await dm.evaluate("!!_muDecks[_muActive].el.getAttribute('src')"),
    'pause released the file, so resuming has to decode it again from nothing');

  await dm.evaluate("document.getElementById('btn-mu-pause').click()");
  await dm.waitFor('!_muDecks[_muActive].el.paused', 10000, 'the second press to resume the track');
  rig.check(await dm.evaluate('_muPaused === false'),
    'resuming left the bubble marked as paused');
  const resumedAt = await dm.evaluate('_muDecks[_muActive].el.currentTime');
  rig.check(resumedAt >= at - 0.05,
    'resuming went back to ' + resumedAt + ' from ' + at + ', so a pause restarts the track');
  await dm.waitFor('_muDecks[_muActive].timer === 0', 10000, 'the resume fade to finish');

  // ── I. The download panel's action bar and Select all ─────────────────────
  // Driven against a SEEDED lookup: reaching YouTube from a scenario is out, and the selection
  // model is app code either way.
  await dm.evaluate("document.getElementById('btn-mu-add').click()");
  await dm.waitFor("getComputedStyle(document.getElementById('mu-modal')).display !== 'none'",
                   10000, 'the download panel to open');
  await dm.evaluate(`(() => {
    _muLookup = { title: 'Test playlist', entries: [
      { id: 'aaaaaaaaaaa', title: 'One',   duration: 60, size: 1048576, url: '', have: false },
      { id: 'bbbbbbbbbbb', title: 'Two',   duration: 60, size: 1048576, url: '', have: false },
      { id: 'ccccccccccc', title: 'Three', duration: 60, size: 1048576, url: '', have: true  },
    ] };
    _muPicked.clear();
    _muRenderLookup();
    0;
  })()`);
  const idle = await dm.evaluate(`(() => ({
    rows: document.querySelectorAll('#mu-picklist .mu-pick').length,
    selecting: document.getElementById('mu-modal').classList.contains('mu-selecting'),
    head: getComputedStyle(document.getElementById('mu-head')).display,
    bar: getComputedStyle(document.getElementById('mu-actionbar')).display,
    foot: getComputedStyle(document.getElementById('mu-pickfoot')).display,
  }))()`);
  rig.check(idle.rows === 3,
    'the picker rendered ' + idle.rows + ' rows for a three-entry playlist, so no row is truncated ' +
    'away and none is invented');
  rig.check(!idle.selecting && idle.head !== 'none' && idle.bar === 'none',
    'the action bar is up with nothing ticked, so the panel loses its own header and close button');
  rig.check(idle.foot === 'none',
    'the Update downloader footer is showing before anything said an update exists');

  await dm.evaluate("document.getElementById('btn-mu-selall').click()");
  const all = await dm.evaluate(`(() => ({
    picked: _muPicked.size,
    hasHave: _muPicked.has('ccccccccccc'),
    label: document.getElementById('btn-mu-selall').textContent.trim(),
    count: document.getElementById('mu-selcount').textContent,
    getLabel: document.getElementById('mu-getlabel').textContent,
    getOff: document.getElementById('btn-mu-get').disabled,
    selecting: document.getElementById('mu-modal').classList.contains('mu-selecting'),
    head: getComputedStyle(document.getElementById('mu-head')).display,
  }))()`);
  rig.check(all.picked === 2 && !all.hasHave,
    'Select all ticked ' + all.picked + ' of 3 entries, so it offers to download a track already ' +
    'on disk');
  rig.check(all.selecting && all.head === 'none',
    'the action bar did not replace the header once rows were ticked');
  rig.check(all.count === '2 selected',
    'the action bar reads "' + all.count + '" rather than the number ticked');
  rig.check(all.label === 'Deselect all',
    'the button still reads "' + all.label + '" with everything ticked, so there is no way back ' +
    'out in one press');
  rig.check(!all.getOff && all.getLabel.indexOf('2') !== -1,
    'the Download button reads "' + all.getLabel + '" and disabled=' + all.getOff);

  await dm.evaluate("document.getElementById('btn-mu-selall').click()");
  rig.check(await dm.evaluate('_muPicked.size === 0'),
    'Deselect all left tracks ticked');
  rig.check(await dm.evaluate("!document.getElementById('mu-modal').classList.contains('mu-selecting')"),
    'the action bar stayed up after the selection was cleared');
  await dm.evaluate("document.getElementById('btn-mu-close').click()");

  // ── G. Delete removes the file and the row ────────────────────────────────
  await dm.evaluate("document.getElementById('btn-mu-open').click()");
  await dm.waitFor('_muTracks.length === 3', 15000, 'the list to be back to three rows');
  await dm.evaluate(`(() => {
    const rows = [...document.querySelectorAll('#mu-list .mu-row')];
    rows.find(r => r.querySelector('.mu-row-name').textContent === 'Крипты')
        .querySelector('.mu-row-del').click();
  })()`);
  // confirmDialog answers asynchronously, so the delete only happens on the button.
  await dm.waitFor("getComputedStyle(document.getElementById('cd-modal')).display !== 'none'",
                   10000, 'the confirm dialog to ask before deleting a track');
  await dm.evaluate("document.getElementById('cd-ok').click()");

  // ⚠ A BOUNDED POLL, NOT A waitFor. When the delete silently does nothing, a waitFor throws a
  // timeout and this criterion's own checks never run, so a broken delete reads as a rig fault
  // instead. Proven by mutating the handler to a no-op.
  const doomed = path.join(musicDir, 'Крипты [zYxWvUtSrQp].wav');
  let gone = false;
  for (let i = 0; i < 60 && !gone; i++) {
    gone = !fs.existsSync(doomed);
    if (!gone) await new Promise(r => setTimeout(r, 250));
  }
  rig.check(gone,
    'the file is still in the music folder after a confirmed delete, so the DM removes a track ' +
    'and it comes straight back on the next read');

  // The folder read that follows the unlink is a tick behind it, so poll for the list too.
  let listed2 = false;
  for (let i = 0; i < 40 && !listed2; i++) {
    listed2 = await dm.evaluate('_muTracks.length === 2');
    if (!listed2) await new Promise(r => setTimeout(r, 250));
  }
  rig.check(listed2,
    'the library still holds the deleted track, so the list and the folder have stopped agreeing');
  rig.check(await dm.evaluate("document.querySelectorAll('#mu-list .mu-row').length === 2"),
    'the deleted row is still on screen');
  // ⚠ The maps folder is a sibling and nothing may ever delete from it.
  rig.check(fs.existsSync(path.join(rig.profileDir, 'maps')),
    'the maps folder is gone after a music delete, which would destroy the whole map library');

  // ── J. A click off the bubble shuts the panel ─────────────────────────────
  // Normalised to shut first: the criteria above leave it either way, and a toggle from an
  // unknown state opens or closes depending on what ran before.
  await dm.evaluate('_muSetOpen(false); 0');
  await dm.evaluate("document.getElementById('btn-mu-open').click()");
  rig.check(await dm.evaluate('_muOpen === true'),
    'the panel did not open, so J measured nothing');
  await dm.evaluate(`(() => {
    document.getElementById('canvas-container')
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  })()`);
  rig.check(await dm.evaluate('_muOpen === false'),
    'a click on the map left the track panel open, so it can only be dismissed by the control ' +
    'that opened it');
  rig.check(await dm.evaluate("getComputedStyle(document.getElementById('mu-panel')).display === 'none'"),
    'the panel is still painted after being closed by an outside click');

  // ── K. Progress on the pill, and a reopen that keeps the queue ────────────
  // Driven against a seeded queue: reaching YouTube from a scenario is out, and the arithmetic
  // and the state retention are app code either way.
  await dm.evaluate(`(() => {
    _muLookup = { title: 'Kept', entries: [
      { id: 'aaaaaaaaaaa', title: 'One', duration: 60, size: 0, url: '', have: false },
      { id: 'bbbbbbbbbbb', title: 'Two', duration: 60, size: 0, url: '', have: false },
    ] };
    _muPicked.clear(); _muPicked.add('aaaaaaaaaaa'); _muPicked.add('bbbbbbbbbbb');
    _muBusy = true;
    _muQueueTotal = 4;
    _muQueue = [{ id: 'ccccccccccc' }];
    _muProgress = { bbbbbbbbbbb: 50 };
    _muPushProgress();
    0;
  })()`);
  const dl = await dm.evaluate(`(() => ({
    on: document.getElementById('music-bubble').classList.contains('mu-downloading'),
    width: document.getElementById('mu-dlbar').firstElementChild.style.width,
    shown: getComputedStyle(document.getElementById('mu-dlbar')).display,
  }))()`);
  rig.check(dl.on && dl.shown !== 'none',
    'the pill shows no progress line while a download runs, so closing the panel loses any sense ' +
    'of how far it has got');
  // Two of four whole tracks finished plus half of a third: 62.5%.
  rig.check(dl.width === '62.5%',
    'the progress line reads ' + dl.width + ' rather than 62.5% for two of four done and one ' +
    'half-way, so it does not move per track');

  await dm.evaluate('openMusicDownload(); 0');
  const kept = await dm.evaluate(`(() => ({
    lookup: !!_muLookup,
    title: _muLookup ? _muLookup.title : null,
    picked: _muPicked.size,
  }))()`);
  rig.check(kept.lookup && kept.title === 'Kept' && kept.picked === 2,
    'reopening the panel mid-download wiped the queue, so the link has to be pasted again to ' +
    'see progress');

  await dm.evaluate(`(() => {
    _muBusy = false; _muQueueTotal = 0; _muQueue = []; _muProgress = {};
    _muPushProgress();
    document.getElementById('btn-mu-close').click();
    0;
  })()`);
  rig.check(await dm.evaluate("!document.getElementById('music-bubble').classList.contains('mu-downloading')"),
    'the progress line stayed on the pill after the queue emptied');

  rig.byEye('L. Sound leaves the speaker, and a pick crossfades rather than cutting. A run is ' +
            'MUTED by design, so the audible half is the ear at the table and nothing else.');
  rig.byEye('M. Pasting a YouTube video or playlist link lists its tracks and downloads the ' +
            'ones ticked. Needs the network and a real video, so no scenario can drive it.');
};
