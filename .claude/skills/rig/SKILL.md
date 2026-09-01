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

**A commit gets a SMOKE pass; the full regression set belongs to `/release`.** `/commit` Step 3
picks `smoke` plus the scenarios covering what the diff touched, and blocks on red. Its Step 2
settles where the change's criteria live before that set runs. `/release`
Step 2 runs `npm run rig -- regression` and blocks on red, because that is when an `.exe`
reaches the TV. Nobody builds from a commit, so no commit needs the whole suite. Do not run
either set yourself while still building.

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

A file exports one async function taking `rig`:

- `rig.check(condition, message)` — the message reads as the failure, since it is what lands in
  the FAIL line.
- `rig.byEye(message)` — a criterion nobody can automate. Stays in the file, reported as
  unchecked rather than dropped.
- `rig.note(message)` — a measured value worth printing.
- `rig.dm` / `await rig.player()` — the two windows. Asking for the Player clicks the DM's own
  button; nothing conjures a second window.
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
