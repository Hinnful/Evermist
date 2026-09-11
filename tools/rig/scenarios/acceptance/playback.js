'use strict';

// playback.js — AN ANIMATED MAP THAT KEEPS PLAYING.
//
// THE GOAL OF THIS FEATURE: the map on the TV never freezes. Chromium pauses a muted video it
// decides nobody is looking at, a decoder runs dry on a big file, and the frame pump can die on
// its own — and in every one of those the map has to start itself again without the DM noticing.
// Every check below serves that sentence.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks directly beneath it, in order.
//
//   A. A map the browser paused starts itself again, with nothing asked of the DM.
//   B. A drained buffer pauses the picture and resumes it when the data comes back, rather than
//      letting the clock run on and catching up with a visible jump.
//   C. A stall the pause handler never sees is still kicked back into playing.
//   D. The watchdog runs while an animated map is up, and it brings back a map the app's own
//      pause handler has been told to leave alone. A dead frame pump comes back too.
//   E. Switching to a still map stops the watchdog, so nothing polls a video that is gone.
//
// ⚠ THIS IS THE RECOVERY PATH, WHICH NOTHING ELSE DRIVES. smoke.js reads the frame loop as alive
// on a healthy map, which is the state these checks start from and not what they are about.
//
// ⚠ THE FAULTS ARE THE REAL EVENTS, DISPATCHED AT THE ELEMENT. `stalled`, `waiting` and `pause`
// are what Chromium fires, and the app's own listeners are what run — nothing here calls a
// handler by name, which would pass with the listener never registered.
//
// ⚠ B IS WATCHED THROUGH A LISTENER OF THE RIG'S OWN, added to the same element. The pause it
// makes lasts about as long as one poll of the buffer, so reading the state afterwards finds the
// video playing and cannot tell a handler that worked from one that never ran. A recorder set up
// BEFORE the event sees both halves whatever the machine's speed.
//
// ⚠ `_bufferingPause` IS SET BY HAND WHERE A TEST NEEDS THE PAUSE HANDLER OUT OF THE WAY. It is
// the app's own flag and the app's own meaning — "this pause is ours, leave it alone" — which is
// the only state where a `stalled` event has anything left to do. It is put back afterwards.
//
// ⚠ THE WATCHDOG TICKS EVERY THREE SECONDS, so D and E poll to a bound rather than sleeping. A
// fixed wait here is either a lie or six seconds nobody gets back.

const MAP_W = 900, MAP_H = 600;

const HELPERS = `
globalThis.__rigPlay = () => ({
  paused: !!mapVideo && mapVideo.paused,
  rs: mapVideo ? mapVideo.readyState : -1,
  loop: videoRVFCId != null,
  watchdog: _videoWatchdogId != null,
  buffering: _bufferingPause,
  enabled: videoEnabled,
});
globalThis.__rigFire = (type) => {
  mapVideo.dispatchEvent(new Event(type));
  return 0;
};
// The rig's own listener on the app's own element: an observer, not a change. It records what
// the app does to the video, in order, so a transient cannot be missed by reading too late.
// Called before each fault, so the listeners go on ONCE and the log is cleared every time —
// added again per call, every event would be recorded twice and an order read off doubles.
globalThis.__rigWatch = () => {
  globalThis.__rigSeen = [];
  if (globalThis.__rigWatching) return 0;
  globalThis.__rigWatching = true;
  const on = (t) => mapVideo.addEventListener(t, () => globalThis.__rigSeen.push(t));
  ['pause', 'play', 'playing'].forEach(on);
  return 0;
};
0`;

module.exports = async function playbackFeature(rig) {
  const dm = rig.dm;

  const map = await rig.fixtures.tableMap(dm, rig.fixtureDir, { w: MAP_W, h: MAP_H });
  await dm.evaluate('createNewScene(' + (await rig.fixtures.asFileExpr(dm, map)) + ')', 120000);
  await dm.waitFor('currentScene && currentScene.mapType === "video"', 120000,
                   'the animated map to load on the DM');
  await dm.waitFor('!!mapVideo && !mapVideo.paused && mapVideo.readyState >= 3', 45000,
                   'the map to start playing');
  await dm.evaluate(HELPERS);

  const start = await dm.evaluate('__rigPlay()');
  rig.note('playing: ' + JSON.stringify(start));
  rig.check(start.watchdog,
            'no watchdog is running on an animated map, so nothing would ever notice it stopping');
  rig.check(start.loop,
            'the frame pump is already dead before anything was done to it, so every check ' +
            'below starts from the wrong state');

  // ── A. A paused map starts itself again ──────────────────────────────────
  // Chromium's background-video optimiser pauses a muted element it thinks nobody is looking at.
  // That arrives as a plain `pause`, which is what this fires.
  //
  // ⚠ THE WATCHDOG IS STOPPED FIRST, AND SO IT IS IN C. It calls play() on anything paused every
  // three seconds, so with it running these two checks passed with their listeners deleted — the
  // watchdog recovered the video and the check could not tell which half had done it. D is where
  // the watchdog's own recovery is measured.
  await dm.evaluate('stopVideoWatchdog(); __rigWatch(); 0');
  await dm.evaluate('mapVideo.pause(); 0');
  try { await dm.waitFor('!mapVideo.paused', 8000,
                         'the map to start itself again after the browser paused it'); } catch (_) {}
  const resumed = await dm.evaluate('({ state: __rigPlay(), seen: __rigSeen.slice() })');
  rig.note('a browser pause: ' + JSON.stringify(resumed.seen));
  rig.check(resumed.seen.indexOf('pause') >= 0,
            'the video never paused at all, so nothing had to recover and A proves nothing: ' +
            JSON.stringify(resumed.seen));
  rig.check(!resumed.state.paused,
            'a paused animated map stayed paused, so the TV holds one frame for the rest of the ' +
            'session');

  // ── B. A drained buffer pauses the picture, then resumes it ──────────────
  // ⚠ PUT BACK INTO PLAYING FIRST, whatever A ended on. onVideoWaiting does nothing to a video
  // that is already paused, so a failure in A would otherwise land again here as three more.
  await dm.evaluate('mapVideo.play().catch(() => {}); 0');
  try { await dm.waitFor('!mapVideo.paused', 8000, 'the map to be playing again before B'); }
  catch (_) {}
  rig.check(!(await dm.evaluate('__rigPlay()')).paused,
            'the map could not be put back into playing, so the buffer drain below does nothing ' +
            'and B measures nothing');

  // ⚠ The recorder goes on BEFORE the event. The pause lasts about one poll of the buffer.
  await dm.evaluate('__rigWatch()');
  await dm.evaluate('__rigFire("waiting")');
  // Both halves have to land, and the order is the app's: pause first, play second.
  try {
    await dm.waitFor('__rigSeen.includes("pause") && __rigSeen.includes("play")', 10000,
                     'the buffer pause and the resume that follows it');
  } catch (_) {}
  const seen = await dm.evaluate('__rigSeen.slice()');
  const after = await dm.evaluate('__rigPlay()');
  rig.note('a drained buffer: ' + JSON.stringify(seen) + ' then ' + JSON.stringify(after));
  rig.check(seen.indexOf('pause') >= 0,
            'a drained buffer did not pause the picture, so the presentation clock runs on and ' +
            'the refill lands as a visible jump: ' + JSON.stringify(seen));
  rig.check(seen.indexOf('play') > seen.indexOf('pause'),
            'the picture was paused for a drained buffer and never resumed, so the map is frozen ' +
            'from here on: ' + JSON.stringify(seen));
  rig.check(!after.paused && !after.buffering,
            'the map did not settle back into playing after the buffer refilled: ' +
            JSON.stringify(after));

  // ── C. A stall the pause handler never sees ──────────────────────────────
  // ⚠ THE PAUSE HANDLER HAS TO BE OUT OF THE WAY OR IT RECOVERS FIRST, and `stalled` would then
  // pass with its own listener never registered. `_bufferingPause` is the app's own way of saying
  // "this pause is ours" and onVideoPause returns on it; onVideoStalled does not read it at all.
  await dm.evaluate('stopVideoWatchdog(); _bufferingPause = true; mapVideo.pause(); 0');
  await rig.sleep(400);
  const suppressed = await dm.evaluate('__rigPlay()');
  rig.check(suppressed.paused,
            'the map resumed on its own with the pause handler suppressed and the watchdog ' +
            'stopped, so the stall below has nothing to recover and C proves nothing');

  await dm.evaluate('__rigFire("stalled")');
  try { await dm.waitFor('!mapVideo.paused', 8000, 'the stall to be kicked back into playing'); }
  catch (_) {}
  const kicked = await dm.evaluate('__rigPlay()');
  rig.check(!kicked.paused,
            'a stalled decoder was never kicked back into playing, so a map that runs dry stays ' +
            'dry: ' + JSON.stringify(kicked));
  await dm.evaluate('_bufferingPause = false; startVideoWatchdog(); 0');
  rig.check((await dm.evaluate('__rigPlay()')).watchdog,
            'the watchdog did not come back on, so D below measures nothing');

  // ── D. The watchdog recovers a map nothing else will ─────────────────────
  // ⚠ THE PAUSE HANDLER STANDS DOWN AND THE WATCHDOG IS THE ONLY THING LEFT. `_bufferingPause`
  // makes onVideoPause return, and the watchdog does not read that flag at all — so a recovery
  // here can only be the poll's. C proves the other half: with the watchdog also stopped, the
  // same pause is not recovered at all.
  await dm.evaluate('__rigWatch(); _bufferingPause = true; mapVideo.pause(); 0');
  const pausedAt = Date.now();
  // ⚠ POLLED TO A BOUND OF MORE THAN ONE TICK. The watchdog runs every three seconds and a pause
  // lands at a random point in that cycle, so a bound under two ticks fails on timing alone.
  try { await dm.waitFor('!mapVideo.paused', 10000, 'the watchdog to bring the map back'); }
  catch (_) {}
  const byWatchdog = await dm.evaluate('({ state: __rigPlay(), seen: __rigSeen.slice() })');
  rig.note('the watchdog took ' + (Date.now() - pausedAt) + 'ms: ' + JSON.stringify(byWatchdog.seen));
  rig.check(byWatchdog.seen.indexOf('pause') >= 0,
            'the video never paused, so the watchdog had nothing to recover: ' +
            JSON.stringify(byWatchdog.seen));
  rig.check(!byWatchdog.state.paused,
            'the watchdog never brought a stopped map back, so a map Chromium pauses behind the ' +
            'app\'s back stays paused for the rest of the session: ' + JSON.stringify(byWatchdog.state));
  await dm.evaluate('_bufferingPause = false; 0');

  // The frame pump comes back after it dies. WHICH half restarts it is not pinned: this window
  // is parked off-screen, Chromium's own optimiser pauses a muted video in it, and the pause
  // handler's resume gets to the pump through onVideoPlaying before the watchdog's own poll does.
  // A check naming the watchdog here passed with that line deleted.
  await dm.evaluate('(() => { if (videoRVFCId != null && mapVideo.cancelVideoFrameCallback)' +
    ' mapVideo.cancelVideoFrameCallback(videoRVFCId); videoRVFCId = null; return 0; })()');
  rig.check(!(await dm.evaluate('__rigPlay()')).loop,
            'the frame pump could not be stopped, so its recovery below has nothing to restart');
  const killedAt = Date.now();
  try { await dm.waitFor('videoRVFCId != null', 12000, 'the frame pump to come back'); }
  catch (_) {}
  rig.note('the pump came back after ' + (Date.now() - killedAt) + 'ms');
  rig.check((await dm.evaluate('__rigPlay()')).loop,
            'a dead frame pump was never restarted, so the DM\'s own map stops moving and ' +
            'nothing brings it back');

  // ── E. A still map takes the watchdog down with it ───────────────────────
  const still = await rig.fixtures.stillMap(dm, rig.fixtureDir, { w: MAP_W, h: MAP_H });
  await dm.evaluate('createNewScene(' + (await rig.fixtures.asFileExpr(dm, still)) + ')', 120000);
  await dm.waitFor('currentScene && currentScene.mapType === "image"', 120000,
                   'the still map to load');
  try { await dm.waitFor('_videoWatchdogId == null', 10000, 'the watchdog to stop with the video'); }
  catch (_) {}
  const onStill = await dm.evaluate('__rigPlay()');
  rig.note('on a still map: ' + JSON.stringify(onStill));
  rig.check(!onStill.watchdog,
            'the watchdog is still polling after the animated map was switched away from, so it ' +
            'runs for the rest of the session over a video that is gone: ' +
            JSON.stringify(onStill));
  rig.check(!onStill.enabled,
            'the video path still reports itself enabled on a still map');

  // ⚠ A DECODER THAT RUNS DRY FOR REAL IS NOT REACHABLE HERE. Every fixture is a whole, valid
  // file on a local disk, and nothing in the protocol truncates a stream mid-decode. What is
  // driven above is the app's RESPONSE to each fault, at the real listener.
  rig.byEye('an animated map big enough to make the decoder stall on its own at the table, which ' +
            'is the fault these recoveries exist for. The diagnostic log the app writes on every ' +
            'playback is what says whether one happened');
};
