# Decisions - storage, packaging and the shell

Split out of [DECISIONS.md](../DECISIONS.md). What was decided about **how the app stores its
data, builds its installers, and ships a release** - `localStorage` and the scene store, the
Electron packaging traps, and the release pipeline - and why it held.

The rules that bind while editing this area are in [CLAUDE.md](../../CLAUDE.md); how the
pipeline works today is in [ARCHITECTURE.md](../ARCHITECTURE.md).

Status tags and the paragraph budget: see the main ledger's header.

---

### `.gitattributes` declares `eol=lf`, checked against what is already committed · `SETTLED` (2026-09-22)
A script that reads a checked-out CRLF file and writes it back CRLF can leave a third line ending
behind if the read already saw one added by a mismatched local git config. The object store
already holds LF only - `core.autocrlf` converts to CRLF on checkout - so `eol=lf` matches what
is committed rather than rewriting it; `git diff --stat` confirmed no file changed. Binary assets
(`.png`, `.gif`, `.jpg`, `.ico`) are declared explicitly, and `.svg` is marked `-text`.

### The in-app changelog is derived from release commits · `SETTLED` (2026-09-12)
`tools/build-changelog.js` reads every `<version> - <note>` commit subject and its body into
`src/ui/changelogData.js`, which the What's new panel renders. A hand-kept `CHANGELOG.md` was
rejected: the release notes on GitHub are already the commit message verbatim, and a second copy
written by hand drifts from it with nothing to catch the drift. A Markdown file parsed at runtime
was rejected too - `fetch()` of a local file is blocked on `file://`, so a generated `<script>`
global is the only shape that needs no parser and no network.

The generator runs AFTER the version-bump commit and the commit is amended, because the newest
entry is that commit's own message.

### The update toast is the DM window's alone · `SETTLED` (2026-09-12)
A two-column pane is an `<iframe>` of the same page with `isPlayer` false, so `initUpdater` runs
in all three documents and they share one `localStorage`. Without the `isPane` guard a toast lands
over a map column and the record of the version last run is consumed there, leaving the DM window
silent. The toast also sits above the shortcut legend rather than on the floor-plan notice strip:
an update arrives whenever it arrives, and the legend's dimmer would otherwise swallow the click
that installs it.

### No frameworks, no bundler, no build step · `SETTLED`
Plain JavaScript in `<script>` tags, because the app has to run straight off the local
filesystem. That single requirement is also why ES modules are banned: `import`/`export` do not
work on `file://`. A build step would buy nothing an offline single-page app needs, and it would
put a compile between an edit and seeing the result on the TV.

The corollary that needed a hook rather than a rule: the entry script was once a 2400-line blob,
and `guard-blob.js` blocking any edit that grows it is the only reason the code now lives in
`src/`.

### A backup names a map it could not find, and still goes out · `SETTLED` (2026-09-08)
A scene whose video file has been moved or deleted still holds a full record, so the export wrote
its metadata and skipped the file: the zip looked complete and the scene came back unopenable,
with the failure surfacing on its first open as a missing-file error. Refusing the whole export
over one absent clip was rejected - it costs the DM every other scene for a fault in one. The
export reports the names instead and finishes, and the restore no longer writes a `mapPath` for
a scene the zip carried no file for. Both sides are covered by criterion I in the backup scenario.

### A vendored library is pinned exactly and checked against its copy · `SETTLED` (2026-09-08)
What runs is the file in `lib/`; the devDependency only records which version it came from.
`pixi.js` sat on a caret, so an `npm install` could put a different version in the tree while
the app kept running the vendored one, and nothing compared them. It is pinned to `7.4.3` now,
matching how `polygon-clipping` was already handled, and a packaging test reads the version
banner out of `lib/pixi.min.js` and fails when the two disagree.

### `File.path` is gone and must never come back · `SETTLED`
Electron 32 removed it. The renderer was still passing `file.path` to `saveVideoFile`, so
main got `undefined`, `fs.stat` threw, and because the `await` had no try/catch the rejection
stranded the progress overlay forever. Broken in every release from 1.4.4 through 1.6.0, and
unnoticed because existing video scenes load from disk and never touch it. The same removal
silently broke zip restore, which alerted "needs the desktop app" while running in the
desktop app. Use `webUtils.getPathForFile`, called in the **preload**, not the renderer.

**A failed save must never leave the progress overlay up.** The hang was worse than the
failure.

### `npm start` cannot see the packaging bug class · `SETTLED`
Dev was green while the built `.exe` died on "Setting up fake worker failed": pdf.js derives
its fake-worker path from `GlobalWorkerOptions.workerSrc`, and left unset it guesses the
non-minified worker, which the build filter did not ship. Two more of the same family: ESM
does not go through Electron's asar redirect, and pdfjs-dist drags a 37MB optional native
canvas binding that text extraction never touches. **The check that catches all of it:
`npx electron-builder --win --dir`, then run the real `.exe`.**

### Backwards-compat migration layer · `REJECTED`
Export/Import already covers cross-release transfer. The guard that replaces it: don't break
Export/Import.

### GPU-direct video texture (epic task 3) · `REJECTED`
Display-sizing is a prerequisite of that path, not a benefit; once the source is
display-sized, the simple path is already cheap. It also drops high-res DA exports and
re-trips TDR. Only revisit if a measured video frame-time problem survives display-sizing.

### Proxy auto-shrink-on-import · `REOPENED` → `SETTLED` (2026-08-13)
Parked on three costs: a bundled encoder's weight, its licensing, and a slow "preparing your
map" wait. **Two of the three were wrong.** `MediaRecorder` is already in Chromium and emits a
playable MP4 with no muxer to write, so nothing is bundled and nothing is licensed. The third
cost is real and was accepted: conversion runs at realtime, measured at 34.4s for a 30s
6150×2850 export.
Binding details. The codec string must be H.264 **High 5.1 or 5.2** (`avc1.640033` /
`avc1.640034`) - a lower level caps resolution below the box and `MediaRecorder` rejects it
outright, and there is no hardware VP9 encoder to use instead. Frames are paced at
`playbackRate = 1` through `requestVideoFrameCallback` and `captureStream(0)` +
`requestFrame()`: faster-than-realtime harvesting drops most frames and writes wrong duration
metadata, which on a looping map is wrong playback speed. Measured output drift, paced: 0.5%.
A source recorded BY `MediaRecorder` as WebM has no reliable duration of its own and cannot be
used to check this - the first attempt to measure it reported 1.6s for six seconds of wall clock.

### Compression is a setting, not a per-import question · `SETTLED` (2026-08-13)
Three shapes were built. An automatic shrink with a toggle went first and was rejected: the box
is a guess about hardware, and on a strong machine the re-encode is a one-way loss for nothing.
A `confirmDialog` per import replaced it, then remembered the answer for the rest of the app
run - **rejected as the worst of both**, because an answer the app remembers is a setting
however it was obtained, and it reads as a question while behaving as hidden state. The shape
that held: one persistent switch, applied silently to every import, **off by default** so
nothing destructive happens until it is asked for. Arming it explains itself once per run
through `messageDialog` - a statement, not a question.
Two traps for anything else built on this path. `#map-progress` sits at z-index 10000 and
`confirmDialog` at 620, so an overlay raised before a dialog buries it and the app looks hung
with no way to answer; the progress bar therefore goes up from `onStart`, after the decision.
And a map already inside the box must not be re-encoded at all - it costs a generation of
quality and a realtime wait for no memory saved.

### The shrink's bitrate buys quality per pixel, not just size · `SETTLED` (moved out of state.js 2026-08-30)
`VIDEO_BITRATE` in `state.js` is a one-line tunable and 15 Mbps is not arbitrary. Inside the
3840×2160 box that is ~0.073 bits per pixel against the source exports' ~0.051, so quality per
pixel improves even after H.264's deficit against VP9. Lowering it is what would make the shrink
read as a loss.

### Auto-drawn rooms scale onto the loaded map · `SETTLED` (2026-08-13)
`vttPlan.js` multiplies grid squares by the plan's own `pixels_per_grid` and has no map-width
term anywhere, so its coordinates are in the pixel space of the export the plan was written
beside. Invisible while the map on screen IS that export, and wrong the moment it is not: a
6150→3840 shrink put every room 1.6× too large.
Fixed self-correctingly rather than by threading a stored factor. `vttDerivePlan` additionally
returns the plan's own declared pixel size (`resolution.map_size` × `pixels_per_grid`), and
`applyPlanToScene` scales by `mapWidth / srcW` through `vttScaleRooms`. That fixes the import
path and the attach-a-plan-later path with one rule, and corrects any resolution mismatch
rather than only this one. The scale is **uniform and positive on width alone**: winding is what
classifies a face as a room and a uniform positive scale cannot flip it, while scaling the axes
independently would shear a plan whose aspect disagrees - a wrong answer that still looks right.
An absent `map_size` yields 0 and scales by 1, so a plan beside its own export is untouched.

### The grid belongs to the scene, and an import inherits its look but not its fit · `SETTLED` (2026-08-14)
Reported as "grid settings are shared between the scenes". Two mechanisms, and only the second was
what the report described. Every grid slider already persisted, because `scheduleAutoSync` calls
`scheduleAutoSave` itself - but **Grid Reset called neither**, so a reset came back at the old
size on the next switch and never reached the Player at all. Every grid control now ends in one
`commitGridChange()` (`grid.js`): render, Player push, scene save. A control that ends any other
way is one whose value does not survive a switch.
The second was `createNewScene` capturing the live grid, so ten imports in a row all inherited
whatever was on screen. Both extremes were rejected: inheriting everything IS the reported bug,
and resetting everything discards a look dialled in over a session. The split that held is
**look versus fit** - colour, opacity, thickness, type and on/off carry over because they are
preferences; cell size and offset reset, because they describe the map that just left the screen.

### Importing a folder of maps is one sequential loop that owns its own reporting · `SETTLED` (2026-08-14)
The loop lives in `mapImport.js` (`importMapFiles`), never a second one in the drop handler.
The trap that makes this bigger than it looks: `createNewScene` used to return before the map had
loaded, because both loaders are callback-based, so a naive `await` in a loop started the second
import mid-`cleanupVideo`. It now resolves from inside `onLoaded` **and settles on every failure
exit** - five of them, counting the two that used to return silently and anything the save path
throws. Missing one hangs the whole batch on a promise that never settles, with the progress
overlay up, which is worse than the failure.
Reporting is the batch's, not each map's: passing a failure callback to `loadMapFromFile` /
`loadVideoFromFile` suppresses their own dialog, so an unattended run cannot stop to ask about one
bad file. Failures arrive as one summary **after** the overlay is down (z-index 10000 against the
dialog's 620). Each map still raises and lowers its own overlay, carrying a batch label prefix, so
the overlay is never held up across a run. A `.zip` alone still restores; one inside a
multi-file selection imports nothing and is named, because restore appends and asks questions.

### The DM holds no map sprite for an animated map · `SETTLED` (2026-08-13)
`pixiHideMap` only sets `visible = false`, so the frame-0 texture built for an animated map
stayed resident on the GPU for the whole scene - and the DM's map is a CSS-composited DOM
`<video>`, so it never drew. The only path that could re-show it runs from `cleanupVideo`, i.e.
during teardown. Roughly 60MB on a 6150-wide map, 27MB once compression shrinks it.
`bindVideoFrameTexture` now calls `pixiClearMap` on the DM and keeps the Player's sprite, which
IS how that view draws. **Clearing is not the same as skipping the upload:** still → animated
has to destroy the outgoing sprite, or the previous map stays on the layer under the video.
Removed alongside it: `mapDirty`, written in two places and consumed by none, and the
`requestVideoFrameCallback` rAF fallback, unreachable on any engine this app runs on.
**`USE_DISPLAY_SIZING`'s else branch was NOT dead and stays.** It reads as a rollback path but
it is the only sizing available before `displayInfo` arrives, which is every startup; without
it an early-loaded map gets a full-resolution texture. Only the always-true lever was removed.

### Single-load on scene creation · `WON'T FIX` (noted)
Drop/replace loads the map twice. Rerouting through `switchScene` exists because the direct
path produced broken PixiJS fog and video. It works, it is just wasteful, and changing it
carries regression risk.

### The portable `evermist-data` folder moves to a per-user location · `SETTLED` (2026-08-06)
The Windows portable build writes its data beside the `.exe` so the whole folder can be copied
to another machine. In practice that never happens: transfer goes through Export to a zip,
which is the supported path and the only one that survives a version change. What the folder
does do is sit next to the app in plain sight, looking like clutter a user might delete or be
alarmed by. The copyable-folder benefit is theoretical and the cost is visible on every
desktop, so the data moves to the OS per-user location mac and Linux already use.

### Releases are unsigned, and upload via `softprops`, not electron-builder · `SETTLED`
electron-builder's own publisher only uploads to *draft* releases, so creating the release as
published via the web UI made it silently skip the upload: the build went green with no
installers attached. Unsigned is a deliberate cost choice; `CSC_IDENTITY_AUTO_DISCOVERY=false`
is required or the mac build fails hunting for an identity.

### The release is a draft until every file is verified up · `SETTLED` (2026-09-17)
`uploads.github.com` returned 500 on the three 100MB+ installers for an hour and a half, through
the action and through `gh` alike, while the small `.yml` and `.blockmap` files went up fine. The
action uploads all eight files at once and never retries, so one server error took 2.13.0 down
with it and left a half-filled release page behind.

Files now go up one at a time, five attempts each with a growing wait, and the release stays a
draft until every uploaded size matches the file on disk. A release that cannot be completed is
invisible instead of broken: no tag, no page, and installed copies stay on the last version.
Sizes are compared rather than the upload's exit code trusted, because GitHub accepting a
truncated asset is exactly what electron-updater would choke on.

### Windows ships an installer, and portable was dropped rather than kept beside it · `SETTLED` (2026-09-07)
A portable build extracts to a temp directory and cannot replace itself, so self-updating needed an
NSIS target. Shipping both was rejected: the change exists to remove a download step, and two
Windows files on a release page reintroduce the choice it set out to remove. Migration costs
nothing, because `userData` already sits in the OS per-user location and an install finds the
library that is already there.

macOS is excluded in code. Squirrel verifies a signature the unsigned `.dmg` does not carry, and an
Apple Developer certificate was judged not worth its yearly cost against the size of the audience. It
was given a link to the releases page rather than silence: a platform told nothing cannot tell an
up-to-date install from an abandoned one.

The update line shows nothing on error. Being offline is the usual failure and nothing can be done
about it from beside the table, so a dialog would be noise on a screen next to players.

### Publishing a release stays a hand gesture · `REJECTED` (reversed 2026-09-08)
Held for a day. The reasoning was that `/commit` bumps on every shipping commit, so releasing on
a version change would publish once per commit against a cadence of one or two per minor - and
that creating the tag by hand was the last point where a person looked at a release before it
existed.

**Both halves were reversed deliberately, and the cadence objection was accepted rather than
answered.** Every shipping commit now releases. What changed the trade is that the hand gesture
was never a quality check: nobody hand-tests this app, so "a person looked" meant a person read
their own commit message. The gate that replaced it drives the packaged `.exe` through the whole
rig suite, which is more than any glance was doing.

What made it safe to give up was not the gate, though. It was `allowDowngrade`.

### A release that goes wrong is pulled, not patched forward · `SETTLED` (2026-09-08)
The obvious recovery from a bad release is `git revert`, and it does nothing. `electron-updater`
serves whatever the newest release is, so the bad installer keeps being offered and a revert just
publishes another version on top of it.

So `allowDowngrade` is on in `main.js`, and recovery is deleting the release and its tag. The
previous release becomes newest and installed copies - including the ones already sitting on the
bad version - are offered the older one through the same Restart button. Without the flag
`electron-updater` refuses to go backwards and those copies have no way home but a manual
reinstall. `/rollback` is the procedure, because the wrong first move is the intuitive one.

Two things were considered for limiting blast radius and dropped. **Publishing as a pre-release
and promoting after a soak** would have made the author the only exposed user for two days, and
it needed either a second hand gesture or a timer that promotes builds nobody played on. Neither
fits a workflow whose whole point is one human gate. **Holding minors and majors for approval**
is the same objection.

### The gate runs before `main`, not on it · `SETTLED` (2026-09-11)
Releasing on a push to `main` meant a change that failed the gate was already on `main` when the
failure was read. Nothing public was created, so the release rule held, yet the commit list
carried the failure and the next shipping change inherited a red branch.

`main` is now protected and takes no push from anyone, the repo owner included. A change goes to
a `release/**` or `change/**` branch with a pull request; the workflow fires on those prefixes
only, and its `land` job fast-forwards `main` once the gate is green.

**The landing is a fast-forward and must stay one.** A merge, squash or rebase mints a new commit,
and `main` would then carry a tree no gate ever drove. The protected check is the workflow's own
unit-test job rather than the separate Tests workflow, because `land` depends on it and can
therefore never push before it has reported.

Rejected: keeping every attempt on `main` and bumping the version per retry. It burns numbers
nobody can install and puts the failures back where they were.

### One version is one commit · `SETTLED` (2026-09-11)
A red gate used to be fixed by a commit on top of the version bump. That splits one release across
several commits: the commit naming the version keeps the red gate, the fix below it reads green,
and the publisher - which read `git log -1` - shipped the fix's message as the release notes.

The fix now amends the version commit and force-pushes the branch. The publisher reads the title
and body off the commit that SET the version, found by the commit that added that version string
to `package.json`, so a stray commit on top can no longer become the public notes.

The open pull request keeps every failed attempt's checks on its own page, which is the audit
trail the branch would otherwise lose to the force-push.

### The staging branch is deleted after it lands, never before · `SETTLED` (2026-09-11)
A branch outlives its change: `land` fast-forwards `main` onto it and nothing ever removes it, so
the branch list grows one dead entry per release. A `cleanup` job now deletes it.

It runs last, after `publish`, because `publish` checks out the branch ref to read the release
notes off it. It refuses unless `land` succeeded, which is what keeps a red gate's branch alive for
the amend that follows. And it never fails the run: the release is already public by the time it
runs, and a red cross on a shipped version reads as a broken release.

The branch name reaches the script through the environment, not a `${{ }}` substitution into the
shell body, which a quote in a ref name would end.

### The tag is created last, not first · `SETTLED` (2026-09-08)
Three shapes were drawn. Tagging by hand and gating before upload leaves a live release page with
no installers on it when the gate goes red. Publishing to a draft and promoting by hand puts the
tag public before anything is checked. What ships: the workflow creates the tag as a side effect
of creating the release, in the last job. A red gate therefore leaves no tag, no page and no
assets, which is the only shape where nothing public precedes green.

`.github/check-version.js` was deleted with this. It compared a pushed tag against `package.json`,
and the tag is now derived from `package.json` rather than compared to it.
