# Decisions - testing and the rig

Split out of [DECISIONS.md](../DECISIONS.md) so the main ledger stays readable. Same
question, same past tense: what was decided about **how this app is tested** - the CDP
rig under `tools/rig/`, acceptance scenarios, and mutation coverage - and why it held.

How to drive the rig is the `rig` skill. What it is lives in
[ARCHITECTURE.md](../ARCHITECTURE.md). The doc and guard-hook calls are in
[docs-and-guards.md](docs-and-guards.md).

**Status tags** and the one-heading-one-paragraph budget are the main ledger's; read its
header before adding an entry here.

---

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
an artefact of the config. `stryker.conf.json` mutated `src/tools.js:48-86`, which covers
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
