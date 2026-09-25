# Decisions - testing and the rig

Split out of [DECISIONS.md](../DECISIONS.md). What was decided about **how this app is
tested** - the CDP rig under `tools/rig/`, acceptance scenarios, and mutation coverage - and
why it held.

How to drive the rig is the `rig` skill. What it is lives in
[ARCHITECTURE.md](../ARCHITECTURE.md). The doc and guard-hook calls are in
[docs-and-guards.md](docs-and-guards.md).

Status tags and the paragraph budget: see the main ledger's header.

---

### Saved monster pages stay off the public repo · `SETTLED` (2026-09-25)

The pages the stat block parser is tested against are the sites' own pages, official monster text
included, so they live in the gitignored `.claude/private/fixtures/statblocks/` and the tests that
read them skip where the folder is absent. CI runs the line-based parser tests only. The bestiary
scenario serves a page written for an invented monster instead. Keeping them in the app's data
folder was rejected: tests cannot reach it from a checkout, and it sits beside the map library.

### The test rig drives the app's own shell · `SETTLED` (2026-08-14)
The app-driving harness had been written and thrown away four times, because each build solved
one question and then read as disposable. Every one of them stood up its **own** Electron main
process, which meant none of the app's IPC handlers existed: saving a map, restoring a zip and
the floor-plan lookup all died on a missing handler, and the Player window was invisible to the
harness entirely. `tools/rig/` replaces that with a driver attaching to `electron .` over
`--remote-debugging-port` with an isolated `--user-data-dir`. Boot to verdict is ~10s, which is
what makes it usable during debugging rather than only at the end.
Zero dependencies, because Node's global `fetch` and `WebSocket` are the whole CDP client.
**The Player window has to be put fullscreen to be measurable at all.** It opens inside the DM's
rectangle, so Chromium marks it hidden and stops giving it frames: `requestAnimationFrame` never
fires, the scene cover never lifts, and the run times out on a symptom that looks like a fog bug.
`backgroundThrottling: false`, `Page.bringToFront`, `focus()` and moving the DM aside all fail to
clear it. Fullscreen through the app's own IPC does, and that is the Player's real state on a TV.
Traps live in the `rig` skill, not here.

### Rejected while building the rig · `REJECTED`
**Driving the built `.exe` by default** - minutes per run, so the rig stops being used. `--exe`.
**A test hook inside the app** - it would ship, which is what `--stress` already costs.
**Stubbing an IPC method past the export's native save dialog** - `window.electronAPI` is
non-writable and non-configurable. The round trip mirrors the payload and keeps a hand test.
**One app instance for all scenarios** - imports and restores make each file depend on the last.
**An `--offscreen` flag** - Electron exposes no CDP `Browser` domain, so no window can be moved.
**Trusting `--user-data-dir` to isolate `--exe`** - the portable build overrides it from
`PORTABLE_EXECUTABLE_DIR` and a run damaged the real library beside it. The rig now refuses a
library that is not empty, and `--exe` belongs on `dist/win-unpacked/Evermist.exe`.

### A new acceptance scenario is proven by making it fail · `SETTLED` (2026-08-14)
A scenario written after the code it checks has never been red, so it has demonstrated nothing.
Three of the grid/bulk-import scenarios were therefore mutation-checked: the plan-derived grid moved
before the scene switch (caught), per-map dialogs left on during a batch (caught by the
overlay-versus-dialog check), and the failure route removed from a loader (caught, as the timeout it
would be at the table). The fourth mutation exposed a **weak check** rather than a bug: removing the
batch loop's own `hideMapProgress()` changed nothing, because each map's import already lowers the
overlay. That line stays as defence, but it is not covered, and a check that passes for a reason
other than the code under it is worth knowing about before it is trusted.

### The mutation ranges were pointed at untestable code · `SETTLED` (2026-08-14)
Two of the three recorded mutation-survivor clusters were still open, and one of them was partly
an artefact of the config. The config then mutated `src/shapes/tools.js:48-86`, which covers
`axisLockDraw` - not exported, and reading module globals no unit test can supply, so 11 of its
38 survivors were permanently unkillable - while excluding `distPointToSegment`, which *is*
exported and tested. The range now names the three exported kernels.
The real cause of the rest was the shape of the fixtures, not missing tests: every
`segmentsIntersect` and `distPointToSegment` case put a segment endpoint on the **origin**, where
`p2.x - p1.x` and `p2.x + p1.x` are the same number, and used symmetric geometry, where `t` and
`u` are both 0.5 and each parameter can be computed from the other's formula unnoticed. Every
`computeOptimalTextureSize` guard case zeroed **both** axes at once, the one shape that cannot
tell `||` from `&&`. Off-origin, oblique, asymmetric and one-axis-zero cases took the two files
from 59% and 64% to 97% and 96%. The `scaleFactor: NaN` gap recorded earlier is confirmed closed.

### Mutation targets are named, never numbered · `SETTLED` (2026-09-08)
`stryker.conf.json` listed line ranges, and every edit above one moved it while nothing checked
it - so a run still reported a score, for whatever code had since slid into those lines. Checked a
month later, ten of the twelve ranges straddled a function boundary and four exported kernels were
not covered at all. The config is now `stryker.conf.js`, and `tools/mutation-targets.js` holds the
FUNCTION NAMES and reads each span out of the source at load time. A rename throws there rather
than being skipped, `test/mutationTargets.test.js` catches the same drift without running Stryker,
and the two hex helpers stay in the list because `deriveFogColors` reaches them.

### Fog-colour derivation is left uncovered · `PARKED` (2026-08-14)
`fogGeometry.js` sits at 58% with 32 survivors, all in `_hslToHex`'s hue-branch chain and
`deriveFogColors`' clamps - a fourth cluster nobody had filed. It is deliberately not closed
here. Killing them needs a decided table of expected output colours across the hue wheel, and a
wrong expectation baked into a test is worse than no test: it pins whatever the code does today
as correct, which is exactly the trap that makes a green suite meaningless. Closing it is a
session with the colours on screen, not an afternoon of arithmetic.
Seven survivors elsewhere are provably **equivalent mutants** and no test can kill them: two in
`backup.js` where both mutant strings produce the same return value, two on the `segmentsIntersect`
determinant guard where a parallel input fails the range test anyway, two on the texture cap where
the clamp factor is exactly 1, and one asking what a point exactly *on* a polygon edge should mean.

### The Player sometimes comes up invisible, and is reopened rather than coaxed · `SETTLED` (2026-08-14)
Roughly one rig run in three, the Player window opens, reports `document.hidden`, and never
becomes visible - so every measurement reads zero and the run fails on whichever Player scenario
went first. **The cause is still unknown and this entry does not claim otherwise.** What is known:
it predates the scenarios added around it, it does not depend on which scenario runs before it, and
it is not the display sleeping (this machine is a desktop on AC with the video timeout disabled -
checked, not assumed).
Two things were tried and neither is sufficient. Asking again does nothing at all, because
`setFullScreen(true)` on a window Electron already flags as fullscreen fires no event and does not
re-raise. Dropping out of fullscreen and back in, which Electron cannot ignore, still failed after
nine transitions over 45s. So the window is not coaxable once it lands in that state.
The recovery is to stop trying: press the DM's Player button to close it, wait for the target to
go, and open a fresh one, which cannot inherit the state. That path is exercised by forcing it, not
merely written. Chasing the root cause is worth a session with a window-state tool, not more
guesses from inside the page.

### The Player's fullscreen path is recorded, never driven · `WON'T FIX` (2026-09-01)
Every session at the table runs the Player fullscreen, and no scenario had pressed the button.
Automating it is refused rather than deferred. `setFullScreen(true)` moves the window onto the
nearest real monitor; `offscreen.ps1` re-parks only a window still sitting at its parked corner,
so a fullscreened Player stops matching, gets dragged back on the next tick, and may paint on the
way. Whether Windows shows it in that gap is not answerable from this repo, and the rule against
putting a window on the DM's screen is absolute. An app-side hook to make it drivable is barred by
the rig's own rules. So it is criterion F in `tools/rig/scenarios/acceptance/player-window.js`,
reported as unchecked on every run.

### A scenario commits a field by dispatching blur, never by calling it · `SETTLED` (2026-09-08)
`scene-groups` failed its rename step inside a full run and passed alone, and the cascade made one
missed step read as eight broken checks. The cause was the scenario, not the app. Chromium records
an element as the document's focused one even when the WINDOW is not the OS's focused window, and
`el.blur()` then dispatches nothing - so the app's commit handler never ran and the rig read that
as the app doing nothing. The step guarded on `document.activeElement === field`, which is true in
exactly that case, so the guard could never fire. A run parks its windows off-screen and never
activates them, and a second app starting during the run takes the focus away, which is why it
depended on what else was running. Every commit in that file now dispatches `FocusEvent('blur')`
at the listener, the way `room-card.js` already did; `focus()` stays where a check reads the caret.
Measured both ways under a concurrent run: six of twelve red with the old guard, none of fifteen
with the dispatch.

### A drag's tolerance is one client pixel in map units, never a flat number · `SETTLED` (2026-09-09)
`mouseAt` builds a synthetic event on a whole client pixel, so a 17px drag in MAP units arrives as
17.5 at a zoom of 0.855. A check written against the number the drag aimed at is then out by half
a pixel through no fault of the code. It passed here at one window size and took a release gate
down on a 1008x681 runner. The tolerance is `2 / zoom`, read live, and a 3px drift still goes red.
The same shape caught a second time in the same session: assertions on a calibrated cell size were
written against the intended drag rather than the committed span, and missed by the same one
pixel. **Read the number the app RECORDED, and scale any remaining tolerance by the zoom.**

### A criterion over a transient asserts every order the app allows · `SETTLED` (2026-09-09)
The Player's landing card is the loading state while the first map decodes, and `player-window`
read that state once, immediately. `revealPlayer()` lifts the cover on a `SCENE_FADE_MIN_MS`
timer rather than on the map arriving, so a slow machine strips the loading line first and the
one-shot read lands after it. The scenario passed here every run and went red on a runner.
Polling for the state is half the fix. The other half is that BOTH orders are legitimate - the
comment on `onPlayerMapShown` says the error paths reveal with no map - so the criterion now
branches and asserts each: the card up and above the cover when the decode wins, and the card
still on screen as the empty state when the timer does. **Neither branch is a free pass**, which
is the condition for splitting one at all; a branch that only notes what happened is a silent
skip wearing a check's clothes.

### Code coming in is gated on the suite, and linting was refused · `SETTLED` (2026-09-07)
A Tests workflow runs `npm test` on every branch push and pull request, and release builds now wait
on a verify job running the same suite plus a tag-versus-`package.json` check. Before it, a
mismatch built and uploaded in silence and shipped an installer whose About box reported a version
that was never released. Both test paths skip the Electron binary download; the build jobs still
fetch it.

ESLint ships in the fork this pattern came from and was refused here. It needs a triage pass over
several hundred existing complaints before its gate could go green, and what it finds is not what
breaks the app.

### A packaging test guards `build.files` · `SETTLED` (2026-09-07)
`test/structure.test.js` fails when `index.html` or `splash.html` loads a script or stylesheet that
`build.files` does not ship. That class of bug is invisible to `npm start` and silent in the
packaged app, where a missing stylesheet renders unstyled rather than erroring. It passes today:
the `src/**` globs cover everything, and a third file under `lib/` is the case that breaks it.

The fork's version checks scripts only. Checking stylesheets as well is the addition, because the
silent failure named in CLAUDE.md is the stylesheet one.

### A recovery path is only testable with its neighbours stood down · `SETTLED` (2026-09-11)
An animated map has four ways back from a stop: the `pause` handler, the `waiting` handler, the
`stalled` handler and the watchdog's three-second poll. They overlap on purpose, so a scenario that
breaks one and waits for the map to recover watches another one do it. Three checks passed with the
code under them deleted before this was caught.

Each criterion now stops whatever else could recover the map: `stopVideoWatchdog()` for the three
handlers, and `_bufferingPause` for the watchdog's own check, which is the app's own way of saying
a pause is not to be touched.

**The watchdog's frame-pump restart stays uncovered.** This window is parked off-screen, Chromium
pauses a muted video in it, and the pause handler's resume reaches the pump through
`onVideoPlaying` about two seconds before the poll would. The scenario asserts the pump comes back
and does not name which half brought it.

### A fixed wait is a lie on a slow machine · `SETTLED` (2026-09-19)
104 `rig.sleep` calls across eighteen scenario files were the largest single reason a run could
pass here and fail on the build server. They are gone, and `rig.sleep` no longer exists on the
rig object, so a scenario cannot reach one. Three things replaced them: `lib.settle` for a state,
`lib.poll` for a value, and `lib.hold(ms, why)` for the one case neither serves - a check that
something does NOT happen, where the wait IS the claim and has to carry its reason as an argument.
Fourteen holds survive. The set also runs in 7 minutes instead of 11 for a suite half the size.

The recurring fault while converting: waiting on the window that was TOLD to act rather than the
one that acts. A DM value is correct the instant it is set; the Player is a postMessage away and
a lerp or a crossfade away after that. Three checks passed for that reason and broke when the
timing around them changed.

### A hanging scenario needed its own limit · `SETTLED` (2026-09-19)
The per-scenario try/catch already stepped over a scenario that THREW. One that hangs never
throws, so the run-wide watchdog killed the process and every later file went unread - the same
fault, on the path nobody had covered. Each scenario now has a 300s limit of its own; reaching it
abandons that file and moves on. Nothing can cancel an async function mid-await, so the runner
mutes that scenario's `rig` first, or the checks it reaches on its way out land under the next
file's name.

### A wait weaker than the check it guards · `SETTLED` (2026-09-19)
Sync View's wait watched one axis against the same tolerance the check asserted on two, so it
released mid-lerp whenever the first axis arrived early. It passed for a year on timing alone and
went red the moment the sleeps around it were removed. The rule it gives: a wait names the state
that ends the work - here the view lerp - and never a loosened copy of the assertion after it.

### A control the suite never pressed · `SETTLED` (2026-09-19)
The suite reached the TV with `sendToPlayer()` in eight places and never clicked Send, deleted
scenes with `deleteScenesWithUndo()` and never pressed the library's Delete, and so on through 42
of the DM's 120 controls. Every one of those handlers was proven and every one of those buttons
was not, so a dead `onclick` would have left the whole set green. The rule: a criterion presses
the control the DM presses, and reaches past it to the function only where a native dialog, the
network or a second display makes the control unreachable. Three controls stay unreachable and
carry a `rig.byEye` line each - Export's save dialog, the YouTube field, the downloader updater.

### Two labels, because "proven" is a claim about a run · `SETTLED` (2026-09-19)
289 criteria, and nothing recorded which had ever been watched failing. A single "proven" label
would have been a lie on 272 of them, and the register exists to be trusted. So there are two:
`RED ON: <the edit> — <date>` where someone broke the app and watched that criterion go red, and
`RED BY DESIGN: written against the fix, never re-proved` everywhere else. `RED ON` names the
EDIT rather than the date, so anyone can run it again in a minute and a rename makes it visibly
wrong. Converting one to the other is the only thing that moves the count.

### A sweep of the whole suite was refused · `REJECTED` (2026-09-19)
Mutation-proving all 289 criteria costs four minutes each, about 18 hours. It was offered and
turned down: the suite is written red-first, so the yield is low, and a proof goes stale on its
own the day the code moves. Proof is spent where it costs nothing extra - on a criterion being
written or repaired - and the rest carry the honest label. 17 are proved today.

### A mutation must never shrink the file it breaks · `SETTLED` (2026-09-19)
`guard-module-size.js` ratchets its ceiling DOWN the moment a file gets smaller, so deleting a
line to break something writes the smaller number into the baseline and the revert then reads as
growth. 748 bytes of headroom went that way on the first mutation of this work. Gate the line off
instead: `if (0 > 1) …` breaks the same behaviour and grows the file.

### A fixture is checked before it is cached · `SETTLED` (2026-09-19)
The fixture cache is keyed by SIZE and shared across a run, and nothing checked a recording before
storing it. One truncated 900x600 clip was handed to all five scenarios at that size, and each
died 180s later on a wait that blamed the map - the only clue a console error about a byte range
on a blob. The test is STRUCTURAL, never a byte count: a healthy one-second clip runs 4KB to 10KB
depending on what moved, so any floor big enough to catch a truncation also fails a good file. An
mp4 the browser can seek carries `ftyp`, `moov` and `mdat`, and a cut-short recording loses
`mdat`'s payload first. One retry, because a truncation is transient; a second failure names the
fixture and stops there.

### The library grows before the app is on the new scene · `SETTLED` (2026-09-19)
`maps` criterion K waited for the scene count to rise and then read `currentScene`, which on a
slow runner is still the previous map. The gate reported a .png arriving as a video at the wrong
size, which was the animated map before it. A check that reads `currentScene` waits for
`currentScene` - the count rising says only that a record was written.

### Two mutations that survived, and what each one taught · `SETTLED` (2026-09-19)
Proving the new kernel tests red, two mutations passed. Casting `pointInRing`'s ray the other way
is an EQUIVALENT mutant: still a correct point-in-polygon test, so it says nothing about the
check, and a mutation has to be genuinely wrong before a survivor means anything. `ringHomePiece`'s
corner fallback could be deleted outright while its test passed, because that case's centroid
landed inside a piece and the fallback never ran - a test that never reaches the branch it names.

