---
name: rig
description: Load BEFORE editing anything under tools/rig/, and whenever a task needs the running app to answer a question - reproducing a reported bug, confirming a fix, checking what reached the Player window, verifying a map actually saved, or writing an acceptance scenario. Also load when the task mentions the test rig, npm run rig, smoke, regression, acceptance scenarios, CDP, --remote-debugging-port, or driving both windows. Carries when to run it, when not to, and the traps that make a scenario silently pass.
---

# The test rig

`tools/rig/` launches the real app over the Chrome DevTools Protocol, drives both windows, and
prints one PASS or FAIL. Boot to verdict is about ten seconds, but a run still costs the DM real
time, so reach for it only at the two gates below.

## When to run it

**The rig is a last resort, not a development tool.** Reading and editing code is faster, so
reach for the rig only when code cannot answer the question. Two cases qualify:

- **Seeing what code cannot show.** Did the map reach disk. Did the reveal reach the Player.
  Did switching scenes leave the old map underneath. Anything spanning both windows.
- **Finding a bug nothing else catches.** Reading the code failed, so drive the DM's own repro
  steps in a scenario and watch the failure happen.

**Do not run any set while building, and that includes the end of a chunk.** Not `regression`,
not `smoke`, not one scenario. A finished chunk goes to the DM to look at, and `/commit` is where
it gets proven. Write the scenario during the build and run nothing.

**A commit gets a SMOKE pass; the full sweep runs in CI.** `/commit` Step 2 settles where the
change's criteria live, then picks `smoke` plus the scenarios covering what the diff touched, and
blocks on red. **`.github/workflows/release.yml` then runs `smoke` and `regression` against the
built `.exe`, and a red gate means no tag, no release and no installers.** So the full set is
never run by hand: reach for one scenario to answer a question, and let CI own the sweep.

**The gate also runs when `tools/rig/**` changed, bump or no bump.** `tools/` ships nothing, so a
rig change takes no version and the gate used to be skipped entirely - the one change nobody
could check was the one that checks everything else.

**A CI-only geometry failure should no longer exist.** Every run is pinned to the runner's own
layout, here and there. If one appears anyway, `--dm-size` and `--player-size` still reproduce
any other layout on demand.

**Never ask the DM to hand-verify what the rig can check.** They run the `.exe` on a TV; asking
them to re-test correctness is asking them to do your job.

## When not to

- **How something looks or feels.** That is the DM's call, always. A scenario that reaches a
  visual question marks it `rig.byEye(...)` and the report lists it as unchecked.
- **Performance at the table.** The stutter lives on their hardware, their 40MB maps and a TV,
  and comparing cost between runs on this machine is worthless (`docs/DECISIONS.md`). The tools
  there are the diagnostic logs the app writes on every playback, and `npm run stress`. Use the
  rig to reach the state, those to say what happened in it.
- **Backup, export and restore still get the DM's own hand test**, whatever the rig reports. Its
  save dialog is native and cannot be driven, so that half of the path is mirrored, not exercised.

## Running it

```
npm run rig                              the smoke set
npm run rig -- regression                every acceptance scenario
npm run rig -- fog                       one by name
npm run rig -- --exe "dist/Evermist.exe" a built installer, for packaging bugs npm start cannot see
npm run rig -- --shot "#sel" --shot-setup "openDropdown()"   a cropped screenshot
npm run rig -- name-one name-two         several by name, in that order
```

That is every flag there is, and an unrecognised one stops the run rather than being ignored.

**EVERY RUN USES ONE GEOMETRY, HERE AND IN CI: the DM at 1008x681 on a 1024x768 screen.** Those
are a GitHub runner's own numbers, so a local run and a gate run are the same run, digit for
digit. The default used to be whatever the machine gave, and three geometry checks passed here
and took a release gate down there. `--dm-size` and `--player-size` override it; nothing else
varies between machines. `--player-size` sets the reported screen too, because the Player fills
it.

**A scenario that throws is recorded and stepped over, and so is one that HANGS.** `waitFor`
throws, about 190 of them are unguarded, and one timeout used to end the run with every later
scenario unread. A scenario that hangs never throws, so it slipped past that: the run-wide
watchdog killed the process and the other 28 files went unread. Each scenario now has its own
300s limit, and reaching it abandons that file and moves on. The verdict names every scenario
that failed. Three boots failing in a row still stops the run, because that is the machine
rather than the scenarios.

**An abandoned scenario is still running**, because nothing can stop an async function
mid-await. The runner mutes its `rig` first, so whatever it reports on its way out cannot land
under the next scenario's name.

**A run NEVER puts a window on the DM's screen, and that is not negotiable.** `offscreen.ps1`
parks every window the run opens at -9000,-9000 without activating it, and `KEEP_PAINTING` in
`run.js` stops Chromium refusing to paint a window nobody can see. Neither works without the
other. Nothing in the DevTools protocol can move an OS window - Electron exposes no CDP `Browser`
domain - so the parking is done from outside, in PowerShell.

**ONE parker per run, started before the first app and awaited.** PowerShell needs ~1s to start
and compile it, so a parker started per app left a focused splash window on screen for ~600ms
EVERY scenario. It signals through a ready file and `startParker` holds the first launch until
that file appears. It matches on the run's own output directory, never on the process name, so
it can only move this run's windows and never the DM's real Evermist.

**`--visible` is the DM's flag, not yours.** Do not pass it, and do not reach for `npm start`,
`npm run stress` or `npm run memprobe` either - all three take the screen and all three are the
DM's to run. `tools/window-state.ps1` reads the real OS window state from outside when a window
question comes up again.

One app instance per scenario, each on a throwaway profile under the OS temp dir. `--exe` is
never the default: a build per run is minutes, and a rig that slow stops being used.

**Either build is safe for `--exe` now.** The portable `dist/Evermist.exe` used to override
`--user-data-dir` through `PORTABLE_EXECUTABLE_DIR`, which put a run inside the real library; that
override is gone and every build honours the flag. **The rig still refuses to start when the
library it opens already holds scenes - do not weaken that check.** `dist/win-unpacked/Evermist.exe`
covers the same packaging bugs and needs no portable step.

## Writing a scenario

`scenarios/smoke.js` is the fast always-run set. `scenarios/acceptance/*.js` is one file per
feature, and running them all together is the regression pass.

**An acceptance file's criteria ARE its header.** Plain-language lines at the top, each with its
check directly beneath, in the same order. There is no separate criteria document.

**A scenario that has never been red has proven nothing.** Written before the fix, run it against
the unfixed code and confirm it fails on the right line. Written after, break the thing it covers,
confirm the FAIL names it, then put it back. A check that passes for some reason other than the
code under it looks identical to one that works.

**A file starts with `const lib = require('../../lib');` and opens its map in one line.**
`tools/rig/lib.js` holds the page-side helper set, the map preamble, and the two waits. Nothing
in it is pasted into a scenario. The helpers used to be a `HELPERS` template copied into each
file: fourteen files carried one, all fourteen differed, and `__rigDrag` alone had four versions
across ten files.

```js
const lib = require('../../lib');
…
  await lib.openMap(rig, { w: MAP_W, h: MAP_H });        // import a map, install the helpers
  const map = await lib.openMap(rig, { kind: 'still' }); // the fixture, if the file needs the bytes
  await lib.installHelpers(session);                     // a window openMap did not load into
  await lib.settle(dm, 'fogCoverT === 0', 30000);        // a bounded wait that never fails alone
  await lib.poll(fn, 20000);                             // a wait written in Node, for a store read
  await lib.fire(dm, 'grid-size-num', 93, 'change');     // set a control and let the app hear it
```

**A file that only needs the FIXTURE calls `rig.fixtures.tableMap` and imports nothing.** Several
scenarios build their own named scenes from one recording; `openMap` would hand them a scene they
never had, and every count after it would be one out.

**The extras on a mouse helper travel in a NAMED options object**: `{ mods, onWindow, steps }`.
The fourth argument used to mean modifier keys in three files and "dispatch on window" in two, so
a positional merge would have turned a Ctrl+drag into a window dispatch with every check still
passing.

**THERE IS NO `rig.sleep`, and it is not to come back.** A fixed wait is either a lie or a
waste, and on a slow runner it is the lie. 104 of them across eighteen files were the largest
single source of a gate that went red on the runner and green here. Three things replaced them,
and every wait in a scenario is now one of the three:

- `lib.settle(session, expr, ms)` for a STATE. It names what is being waited for, never fails on
  its own, and the assertion after it is still the one that decides.
- `lib.poll(fn, ms, everyMs)` for a VALUE - anything that has to be compared against a reading
  taken earlier, or read out of IndexedDB.
- `lib.hold(ms, why)` for the one case neither serves: a check that something does NOT happen.
  There is no state to wait for, so the wait IS the claim, and `why` is required. Fourteen of
  these survive, each one reading "long enough for it to have gone wrong, then prove it did not".

**Wait on the window that has to act, not the one that was told to.** A DM value is correct the
instant it is set; the Player is a postMessage away, and a lerp or a crossfade away after that.
Three separate failures on this branch were a settle that watched the DM while the Player was
still moving. The states worth knowing: `!viewportDirty && !fogDirty` (the render has painted),
`!fogTransRafId` (the reveal/shroud crossfade has finished), `!fogColorRafId` (the colour ease
has landed), `!viewLerpActive` (a view-snap has finished animating), `!minimapDirty` (the
preview has repainted).

A file exports one async function taking `rig`:

- `rig.check(condition, message)` — the message reads as the failure, since it is what lands in
  the FAIL line.
- `rig.byEye(message)` — a criterion nobody can automate. Stays in the file, reported as
  unchecked rather than dropped.
- `rig.note(message)` — a measured value worth printing.
- `rig.dm` / `await rig.player()` — the two windows. Asking for the Player clicks the DM's own
  button; nothing conjures a second window.
- `await rig.restart()` — the app shut down and started again on the SAME profile, for the one
  thing no other scenario can reach: the app coming up with maps already in the library.
  **It returns the new DM session and closes the old one**, so a `const dm = rig.dm` taken at
  the top of the file is a dead socket afterwards. The helpers go back in with
  `lib.installHelpers`, because the page is new. `scenarios/acceptance/boot.js` is its scenario.
- `await rig.resizeDm(w, h)` / `await rig.resizePlayer(w, h)` — **`sizes.js` and nothing else.**
  Every run is pinned to one geometry, and that file is what pays for it by varying the size on
  purpose. A scenario that sets its own metrics leaves the next one at a size run.js did not
  choose.
- `rig.fixtures` — maps generated at runtime, cached on disk, never committed.
  **`tableMap` is the map an acceptance scenario imports, and it is ANIMATED.** Animated is
  the only kind the DM ever uses, so a suite on still PNGs proved the app worked in a case
  that never happens. It records one second, caches by size for the whole run, and stays
  inside the shrink box so no scenario pays for a re-encode. `stillMap` is still there and
  `smoke.js` is the one file that wants both — its block 2 holds the animated render path
  against the still one.

## Traps

Each of these cost a debugging round, and most of them make a scenario **pass** rather than fail.

- **Evaluate with bare identifiers, never `window.x`.** The app's scripts are plain `<script>`
  tags using top-level `let`/`const`, which are not properties of `window`: `window.pixiApp` is
  undefined while `pixiApp` is an object.
- **`waitFor` takes a SYNCHRONOUS expression only.** It wraps what it is handed in `!!(…)`, so an
  async arrow's promise is truthy on the first poll and the wait returns instantly, having looked
  at nothing. Anything that must read IndexedDB gets a bounded poll loop written in the scenario,
  in Node, not a `waitFor`.
- **Poll, never sleep.** A fixed wait is either a lie or a waste, and it is the difference
  between a rig that takes ten seconds and one nobody runs.
- **Wait out the scene cover before reading painted fog.** A fresh map arrives under a full-fog
  cover that punches nothing, so every sample reads opaque however much was revealed. Poll
  `fogCoverT` down to 0 first.
- **The Player stays WINDOWED, inside the DM's rectangle, and the rig never fullscreens it.**
  `rig.player()` clicks the DM's own button and waits for the window to report itself visible;
  it asks for no fullscreen anywhere (`showPlayer` in `run.js`). Both windows paint at the same
  time, so a scenario reads either one whenever it likes. Every Player measurement is therefore
  at the DM window's size, not a display's - assert against the window, never a screen figure.
- **Do not reintroduce fullscreen to fix a Player that reads as hidden.** The "Player comes up
  invisible" fault is solved, and its cause was another window in front. Windows reports a covered
  window as occluded, Chromium stops painting it, and the page then reports `document.hidden` -
  which the rig could only read as the window never appearing. Working on the machine during a run
  caused it, which is why it looked intermittent. `run.js` launches with `KEEP_PAINTING`, three
  Chromium switches that turn occlusion handling off, so a covered, backgrounded or off-screen
  Player keeps painting. Proven both ways: remove the switches and the exact old error comes back.
  Not asking for fullscreen is also what lets the whole run sit off-screen. `rig.player()` keeps
  its close-and-reopen recovery as a backstop; it should no longer fire.
- **Electron does not expose the CDP `Browser` domain.** `Browser.getWindowForTarget` answers
  "wasn't found", so there is no moving or resizing an OS window from the protocol.
- **`el.blur()` does not reliably fire a blur event, and `document.activeElement` does not say
  whether it will.** Chromium keeps the element as the document's focused one even while the
  WINDOW is not the OS's focused one, and `blur()` then dispatches nothing - a commit handler
  hanging off it never runs, and the run reads the app as having done nothing. Parked windows are
  never activated, so whether it fires turns on what else is on the machine: it fails at random
  inside a set and passes alone. Dispatch `FocusEvent('blur')` at the listener instead, and keep
  `focus()` where a check reads the caret.
- **A DRAG'S TOLERANCE IS ONE CLIENT PIXEL IN MAP UNITS, never a flat number.** `mouseAt` builds
  the event on a whole client pixel, so a 17px drag in map units arrives as 17.5 at a zoom of
  0.855. Assert against the value the app RECORDED - the committed span, not the drag you aimed -
  and scale whatever tolerance is left by `2 / zoom`, read live. A flat 0.5 passed at one window
  size and took a release gate down on a 1008x681 runner.
- **A criterion over a TRANSIENT must poll, and must assert every order the app allows.** Reading
  a state that exists for a moment, once, is a coin toss the slow machine loses. Poll for it with
  a bound. Then enumerate EVERY order the app allows and branch on all of them - the Player's cover
  lifts on a timer, not on the map arriving, and on a slow runner the decode can finish before the
  first sample is even taken. **Two branches looked like all of them and a third order took a
  release gate down.** Two events the app never ties together must never be asserted as one.
  **No branch may be a free pass**; a branch that only notes what happened is a silent skip wearing
  a check's clothes.
- **An element inside `display:none` has zero-sized rects**, so a spacing or centring assertion
  against it passes by accident. Reveal it first.
- **Both windows must stay visible and unminimized.** An OS-minimize makes `main.js` send
  `window-visibility`, which pauses the PixiJS ticker: the window renders nothing and every
  measurement reads zero. There is no flag that moves them aside, so leave the screen alone
  while a run is going.
- **`window.electronAPI` is non-writable and non-configurable, and so are its methods** - a
  `contextBridge` object cannot be stubbed at all, not even one function on it. Anything behind a
  native dialog is unreachable; go round it, not through. In particular `getPathForFile` always
  answers `null` for a `File` built in-page, so nothing that needs a real path on disk can be
  driven: mark it `rig.byEye`.
- **`DOM.setFileInputFiles` does not populate a file input in an Electron renderer.** It reports
  success and leaves `files.length` at 0. Two ways round it, and they test different things:
  hand the app's own `createNewScene` a `File` built in-page to exercise the import, or assign a
  real `FileList` with `input.files = new DataTransfer().files` (and dispatch `change`) to
  exercise the **picker's own handler**. A `DragEvent` built round the same `DataTransfer` drives
  the real window drop handler the same way.
- **An ancestor `zoom` is folded into `getBoundingClientRect`** in this Chromium, so its numbers
  match a screenshot's coordinates directly. Do not multiply by the zoom yourself.
- **A probe that reads the same CSS variable as the element it measures cannot see that variable
  disappear.** Both sides fall back to the initial value, so the compare passes with the element
  bare. Assert the resolved number as well - a border computing to `0px` is not an edge.
- **A pixel sampled off the grid canvas inside an effect is never the ember's own colour.** The
  ember strokes OVER the base grid line already painted there, so every reading is a blend with
  `gridColor`. Set the base grid faint first and test the hue RELATIVELY, red far above blue; an
  absolute `r > 200` read the blend at 181 and found nothing on a working build.
- **Electron's own security warning arrives as a console error** and is not the app's. `cdp.js`
  filters it. Do not widen that filter.
- **`lib.poll` reads a FALSY answer as "not found".** A fog alpha of 0 is exactly the reading
  that means the thing happened, so `return a < 60 ? a : null` polls its whole bound and then
  reports no leak on the one reading that is the leak. Wrap the answer: `{ alpha: a }`.
- **Some scenario files are CRLF and some are LF.** A pattern written against `\n` silently
  misses every CRLF file, so a script that edits several of them leaves half converted and half
  untouched - and the half it did touch comes back with mixed endings. Normalise to `\n`, edit,
  then put the file's own ending back on write.

## Rules that bind

- **No app-side changes to serve the rig.** Nothing in `src/`, nothing in `index.html`, no new
  flag in `main.js`. Everything it needs is already reachable as a bare global, and a test hook
  inside the app would ship in the build.
- **No dependency, dev or runtime.** Node has global `fetch` and `WebSocket`; that is the whole
  CDP client.
- **No rig output inside the working tree.** Screenshots, generated maps and the profile all go
  under the OS temp dir. `.gitignore` carries `.rig/` as the backstop, and the rig asserts at
  startup that the line is still there.
- **Rig code is committed like any other file.** `tools/` is simply absent from `package.json`'s
  `build.files`, so it is tracked in git and not inside the `.exe`.
- **No kernel or arithmetic tests here.** `node --test` owns those and they stay as they are.
