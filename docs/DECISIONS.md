# Decisions

The ledger of settled calls: what was tried, what was rejected, what was reverted, and
why. This is a **lookup table, not a reading document** - nobody needs it in context to
work. Open it when you are about to change something and want to know whether it was
already decided.

This file is written in the **past tense**: what was built, what was tried, what was rejected.
Rules live in [CLAUDE.md](../CLAUDE.md), how the app works in
[ARCHITECTURE.md](ARCHITECTURE.md), and what the product is and will never be in
[PRODUCT.md](PRODUCT.md). A scope call or a positioning statement belongs there, not here.

**Status tags:** `SETTLED` (this is the shape, don't redesign it) · `REJECTED` (built or
proposed, then killed) · `REVERTED` (shipped, then taken back out) · `PARKED` (wanted,
deferred) · `WON'T FIX` (real, deliberately not fixed) · `SHIPPED` (landed in a named
version) · `REOPENED` (closed once, now live again). A guard rejects an entry with no tag.

**Adding an entry:** one heading, a status, and at most a short paragraph. If an entry needs
more than that, the excess belongs in the commit message.

**Write about the DECISION, never about the people.** This file is public. No "the user", no
"he/she said", no "I recommended", no quoted remarks from a chat log. Those read as leaked
internal notes about a named person, and the attribution carries no information anyway: what
a future reader needs is what was decided and why it held, not who said it. Write
"rejected on product grounds: …", not "he rejected it because …". Where a decision came from
someone's judgement rather than a measurement, say that impersonally ("judged not worth the
cost") and move on.

---

## Rendering and fog

Moved to [decisions/rendering-and-fog.md](decisions/rendering-and-fog.md) - the two
views' render paths, the fog pipeline, and the dirty-flag render loop.

---

## Rooms and the room card

### Room repair leans on a vendored clipping library · `SETTLED` (2026-09-02)
Join, Trim and the hole check run on `polygon-clipping` 0.15.7, vendored to `lib/` as its UMD
build and pinned as a devDependency for the tests. A hand-written boolean kernel was rejected:
union and difference over hand-drawn cave outlines is a known hard problem, and the library
fails loudly where a hand-rolled one fails quietly.

The library throws from fourteen sites. Every call is wrapped, and a throw becomes the same
refusal a rule-based rejection produces - the cost of letting one escape is spelled out at the
wrapper in `roomOps.js`.

### Repairs act on what a shape overlaps, not on a selection · `SETTLED` (2026-09-02)
Figma's model - select two objects, press a boolean - was rejected because the app holds exactly
one `selectedPolygonId` and building multi-select was the expensive half. Owlbear's model shipped
instead: pick a mode, draw a shape, and it combines with every room it lands on. One drag joins
two rooms with no selection at all.

Three calls fell out of it. A join takes the **most hidden** fog mode of its parts, never the
earliest one's, so it cannot hand the table ground that was shrouded a moment earlier. A result
that would leave a hole is refused whole, because a room is one ring of points and storing a
second one would change every saved scene. And rounding and door marks are dropped rather than
remapped, for the reason `applyShapePlan` gives.

### Cut is its own geometry, not a thin Trim · `SETTLED` (2026-09-02)
Trim can already split a room by removing a strip, so a separate Cut looks redundant. It is not:
the strip leaves a gap, which is correct on a dungeon where the gap is the wall, and wrong in a
cave where it puts a fogged line across open rock. A repair that leaves no gap whatsoever is not
something a difference operation can produce, so Cut is hand-written ring walking in
`roomOps.js`, deliberately outside the clipping library; `cutRing` says how it keeps the two
pieces flush.

### The room LIST · `REJECTED`
A full Rooms tab with a vertical room list (rows, `listOrder`, drag-reorder, 3-state pill,
click-to-jump, hover-to-outline) was built and then rejected on UX grounds: **the map is
the better interface**, because it is the biggest target on screen and it shows an actual
room instead of a room's name. Killed with it: `listOrder`, drag-reorder, pin/dock for the
card, search over descriptions, read-mode vs edit-mode, per-room thumbnails.

### Card position and description height are user-controlled, not computed · `SETTLED`
The card floats over the map, so the DM drags it and double-clicks the bar to send it back.
The description height is one global preference, because a box's height belongs to a screen
rather than to a room. **Partially reversed 2026-08-06 — see the entry below: automatic
placement now clears the room's whole outline, so it is no longer true that no placement
rule is worth having. The drag stays; it is the escape hatch, not the only mechanism.**

### Automatic placement clears the room's whole box, not its centre · `SETTLED` (2026-08-06)
The card used to be anchored 22px off the room's **centroid**, so any room bigger than the
card swallowed it, and selecting a room to edit it covered the thing being edited.
`clampPanelPosition` now takes the room's screen **bounding box** and takes the first side
fully clear of it: above, below, right, left.

Two consequences that are not optional. Placement is recomputed on every repaint, so a
vertex or edge drag reshaping the room under the pointer made the card flip sides mid-edit;
it is now **held still for the length of such a drag** and re-placed once on release. That
release re-place also had to be added to all four drag-release paths in `tools.js` — without
it the card only caught up on the next pointer move.

**The residual case is arithmetic, not a bug.** If no side has a clear band as large as the
card, no placement can be fully outside the room; the fallback pins the card to the viewport
edge furthest from the room. Card height is the lever, and most of it is the DM's own saved
description height.

### Drawing a room does not select it · `SETTLED` (2026-08-06)
Finishing a rectangle, circle or polygon used to set `selectedPolygonId`, which opened the
room card over the map exactly as the next room was about to be drawn. Rooms are now created
unselected, matching what floor-plan import already did, and naming becomes a deliberate
second pass with the Select tool.

**Not done by gating the card on the active tool** — visibility stays keyed to selection
alone so the card survives tool switches. Also rejected as answers to the same complaint: a
delay before the card opens, and a collapsed card state. Both add a mechanism to soften a
behaviour that simply should not happen. The fog crossfade direction was checked and does not
depend on the selection: the creation paths read `tool` / `poly.mode`, and the paths that read
`selectedPolygonId` are all drag paths that only run in Select mode.

### Axis-lock is an alignment snap, not a pointer constraint · `SETTLED` (2026-08-06)
The straighten-walls toggle does **not** clamp mouse movement to a horizontal or vertical
track. It snaps a point onto a reference point's exact x or y when it is already within a
threshold of sharing one, and leaves genuinely diagonal segments alone. The goal is
straightening a nearly-straight wall without a steady hand, which an alignment snap does and
a movement lock does not — a lock also makes a deliberate diagonal impossible to draw.

Details that matter: the threshold is SCREEN px divided by `zoom`, so the slack feels the
same at every zoom; only the axis with the smaller deviation snaps, so a near-45° segment
cannot flip unpredictably between them; drawing references the previous vertex, a vertex drag
references both ring neighbours. Grid snap runs first and axis-lock layers on top, so on an
aligned grid coordinate it is a no-op. Whole-polygon and edge drags are deliberately excluded
— neither changes any wall's angle. Runtime-only state, like `snapToGrid`: not per scene,
not in a backup.

### A `ResizeObserver` on the description · `REVERTED`
Everything ugly about it followed from it firing continuously: a debounce, a 0×0 guard, and
a real bug where re-clamping every tick slid the card up under the pointer during a
downward resize drag. Replaced by a `mouseup` listener. **The transferable lesson: when a
mechanism's own chattiness is generating its guards, the mechanism is wrong.**

### `RP_DESC_H_MIN` / `RP_DESC_H_MAX` JS constants · `REVERTED`
CSS `min-height`/`max-height` already clamp anything written to `style.height` (verified:
9999→620, 1→120), so they guarded nothing and needed a "keep in step with the CSS" note.
The note was the tell.

### A title on the drag bar · `REJECTED`
It briefly read "ROOM", directly above a field placeholdered "Room name": the same word
twice, and noise the moment the room is actually named. There is nothing else a title here
could say, because the card only ever shows a room. The six-dot grip advertises what the
bar *is* instead.

### The name field's alignment · `SETTLED` after three half-solutions
The trap: the 14px column is where **boxes** start and 24px is where **text** starts, and
the description is itself a 10px-padded field, so matching its box puts the name on both
columns at once. Earlier passes read "everything starts at 14px" as being about text and
stripped the name to a bare underline, buying a clean rest state at the cost of the focus
state. Verified by measurement: name, description, fog pill and Delete all share
left=75.4 w=288.4.

### The screen-px → pre-zoom-px mapping is affine · `SETTLED`
Two earlier versions got this wrong. Assigning screen px raw drifted the card ~20% off the
room; dividing by the slope alone left a constant ~8px offset that automatic placement hid
but a drag exposes as a jump on grab. Both the slope and the ~9.6px horizontal origin are
derived from measurement.

### A `roomRadiusMode` toggle · `REVERTED`
A flag in `state.js` plus a toggle button, both removed: it was a control for a decision the
selection had already made, and two things to keep in sync. The radius field derives its
target from `selectedVertexIndex` and swaps its own glyph to say which.

### The `v3/8` vertex readout · `REVERTED`
It reported what the map already shows by highlighting the selected handle, in a notation
opaque enough that nobody wanted to admit not knowing what it meant.

### A second properties row, a label column, a leading icon on the name · `REJECTED`
All three cost height, and the description is the card's scarcest resource.

### A destructive button should keep the standard shape · `SETTLED`
Delete is a full-width `.cp-btn` with `.cp-btn-danger` behind a hairline footer. The
hairline is what stops it reading as the primary action. Shrinking it to signal danger only
costs it the shape every other button in the app has.

### Room notes are DM-only for free · `SETTLED`
Polygons never cross to the Player (fog crosses as pixels, `initScenes()` is DM-gated), so
there is no channel to strip and no guard needed. Area markers, when built, will not get
this for free.

### The card shows everything, and the description is load-bearing · `SETTLED`
Whether the description is actually wanted on screen, or whether a room name alone would do,
was an open question that sized half of module text import. Answered: the full card - name,
description and fog controls together - is the point. The description half of the import
feature is therefore load-bearing, and the confirm-before-overwrite machinery is correctly
scoped rather than over-built.

---

## Module text import

### An LLM in the loop · `REJECTED`
Parse or match in a chat, import the result. Killed on product grounds: it would make the app
infrastructure for one particular campaign rather than a standalone feature anybody can use.
**The test to apply to anything in this area: does a stranger who downloads the `.exe` get
value with nothing else installed?**

### A notes scratch pad in the app · `REJECTED`
It competes with Notion and loses (tables, initiative tracking, folders, embedded links).
Notion stays. Evermist's room note is the five seconds when the party opens a door. That
boundary is what keeps the feature small.

### Auto-assigning entries in click order (a queue) · `REJECTED`
Killed by the real text: sub-locations mean one heading covers several polygons, so it
desyncs within a few rooms. The DM picking is the irreducible step, because only they know
which blob on the map is K12.

### Importing a DM's own Notion prep notes · `REJECTED`
They are unstructured and often do not exist. The bulk input is the module, which is highly
structured; the homebrew delta gets typed over the top in the card.

### The paste textarea, the Preview button, the explanatory paragraph · `REJECTED`
All three cut from the import panel. Preview was actively broken-looking: it re-parsed the
*textarea*, so with a file loaded it answered "paste some text first". A module is a file,
choosing one already parses it, and the parser's rules are not something a DM can act on.

### PDF support · `SETTLED` — the recommendation against it was wrong
Recommended against on the grounds that it bought only ~3 extra rooms over exporting a `.txt`
by hand. That measured the wrong thing: campaign modules ship as PDFs, and the cost was never
the rooms, it was making someone prepare a file at all. **The lesson: when the recommendation
is "have the user do a manual step", weigh the step, not the output delta.**

### pdf.js runs in a `utilityProcess`, not the main process · `SETTLED`
A module is an untrusted file and pdf.js is a large parser; in the main process it would sit
beside the filesystem helpers, dialogs, window handles and every renderer channel. What the
move buys: no Electron APIs, no renderer channel, crash and hang isolation, no state across
imports. What it honestly does not buy: it is still a Node process, so `fs` exists. Full
isolation needs a sandboxed renderer plus a custom protocol to load ESM from, which is a
bigger change to the `file://` architecture than the residual risk justifies.

### Storage is localStorage, not IndexedDB · `SETTLED`
`sceneStore.js` is one store keyed by scene id at `DB_VERSION 1`, so a campaign-level store
would need a version bump plus an upgrade path on the database holding the user's maps, to
buy nothing for a few hundred KB. Measured headroom is 2.3×, not the 10× an early comment
claimed; the real guard is `mtStore`'s try/catch.

### Module text is campaign-level, and belongs in the backup anyway · `SHIPPED` 1.7.6 (2026-08-08)
Imported entries live in `localStorage`, deliberately outside any scene, because one book serves
every map in a campaign. The corollary drawn at the time - that they therefore stay out of the
export zip - does not follow. A zip is the only way a campaign moves between machines, and the
moment a missing room description gets noticed is at the table rather than during prep. Room
notes already survive the round trip; the source they were filled from should too.

Three shape calls settled while building it. **One entry at the zip ROOT, `moduleText.json`
beside `manifest.json`** - per-scene metadata would store the whole book once per scene and
re-import it N times on restore. **Replace or keep, never merge**: two books share no key space,
so a merged one would be neither. **Adopted after the scene loop and after the progress bar is
down**, so a question never opens on top of the bar and a storage failure cannot strand a
half-restore. Absence of the entry is the normal case, not an error - it is every zip written
before this - so the reader IPC resolves null where the manifest reader rejects.

### A sidebar classifier · `REJECTED`
A page of general rules between two headings is absorbed into the preceding room and the DM
deletes it (roughly 1 room in 13). Every signal is either language-specific or
indistinguishable from a long description, and a false positive silently loses real prep. A
test pins the behaviour rather than endorsing it.

### Synthetic fixtures validated the wrong parser twice · `SETTLED` (method)
Both serious parser bugs passed 77 green synthetic tests and died within seconds of touching
real text, and one synthetic fixture actively made a **correct** threshold look wrong (it
put paragraph-final lines at 41-44 chars; real ones run 15-30). Synthetic fixtures remain
right for the repo, because copyrighted text must not be committed, but **they prove only
the shapes already known. Get real input before believing a text parser.**

### A single false heading is catastrophic, not cosmetic · `SETTLED`
One cross-reference inside room К1's text cost К2-К6 plus К7's name: six rooms for one line.
That is why the sequence prefers its immediate successor over a forward jump, and why that
fix had to be gated on `prev > 0` after it regressed the numbered-list guard.

### The parser regression guard · `PARKED`
All test fixtures are synthetic, so nothing checks the thresholds that were tuned against a
real book. Change any one and every test still passes while every room silently arrives as a
wall of text. Deferred on the grounds that a gap with no risk attached can wait, which holds
while the parser sits still. **The trigger that changes that: if anyone retunes a threshold,
this guard lands in the same session**, because without it the retune is unverifiable. The
cheap fix carries no copyright risk: commit the **fingerprint** (line-length array, ordered
heading keys, per-entry body lengths), which is a statistics table rather than the work.

---

## Player sync and the minimap

### A view crosses the wire as a region, not a zoom · `SETTLED`
Syncing centre plus zoom across two different-sized canvases meant a bigger TV showed *more
map* rather than the same map. Now `mapCX`/`mapCY` plus `viewW`/`viewH` in map units, and
the Player refits to its own canvas. Matching aspects land exact edge to edge; mismatched
aspects fit rather than crop, so the players can never see less than the DM. `zoom` still
rides along as the fallback for a view with no region, which is what the minimap's own snaps
use.

This was never "drift". Do not reopen a drift investigation without a genuinely new repro.

### No `devicePixelRatio` term belongs in the handshake · `SETTLED` (measured)
On the Player, `window.innerWidth/Height` equals `getViewportSize()` exactly, at
devicePixelRatio 1 and 1.5, because player mode hides all chrome and PixiJS runs at
`resolution: 1`.

### Trimming the region by the control panel's width · `REVERTED`
Roughly 288 screen px of the DM's viewport is map hidden behind the fixed control panel, so
during zoomed-in play the players get a strip the DM cannot see. The geometrically correct
fix (subtract the panel width from the region) was built and rejected on feel: it crops the
TV to the DM's readable area, so content that used to reach the players stops reaching them.
A real answer needs a different shape, such as making the panel collapsible or translucent so
the DM's readable area and the canvas agree. There is a comment in `dmVisibleRegion()`
saying not to re-add the trim.

### The minimap is overview+frame, not a pure mirror · `SETTLED` — a deliberate reversal
The old rule was "mirror flavour, shows ONLY the live zoomed slice". Reversed on purpose: a
square frame was a lie under the pure-mirror rule, and the padding shows what is about to
come into view while giving a bigger drag target. Do not "restore the mirror".

### TV frame is dotted lines only · `SETTLED`
An earlier pass dimmed everything outside the frame and stroked it solid. Both were rejected
as obstructing the map.

### Minimap zoom pivots about the view centre, never the cursor · `SETTLED`
Cursor-pivot zoom cannot change zoom without shifting `mapCX/mapCY`, so zooming off-centre
also panned what the players were watching. Cursor-pivot is still correct on the DM's own
canvas: different surface, different rule.

### The minimap is not a measurement of the Player's view · `SETTLED` (method)
It is a square canvas that deliberately shows more map than the TV does; the real TV is only
the band between the two dotted lines, which at a 16:9 Player is roughly a third of the
preview's height. So the preview is the wrong instrument for judging sync fidelity - read the
Player's own viewport for numbers, or judge it on the TV itself. The square-plus-dotted-frame
shape is a deliberate reversal and is not the thing to change.

### Lock blocks accidental movement, not deliberate driving · `SETTLED`
Sync View intentionally still moves a locked Player. Lock only disables the Player's own
input and the DM's own minimap drag/wheel.

### Minimap fog is a cheap approximation · `SETTLED`
Blur plus tint so fog reads like fog. Do not replicate the cloud pipeline. Video maps mirror
as a frozen frame.

### Sync MODE (continuous follow) · `PARKED`
Considered as a mode rather than a button, then dropped: in practice sync barely gets used at
all. The button stays; the job is making the existing one work.

### Player resilience (recovering a stale or blank Player map) · `PARKED`
Irrelevant unless these errors become frequent. Nobody debugs mid-session, so a recovery path
for a rare failure buys nothing. Don't pick this up without a real recurring failure.

### Send means the same thing from the button and from the key · `SETTLED` (2026-08-26)
`sendToPlayer(fogOnly, sceneChange)` was wired as `btn-send.onclick = sendToPlayer`, so the
click event arrived as `fogOnly` and was truthy. The button therefore sent fog and dropped the
view, while Space and Shift+S sent both — one control, two behaviours, and nothing on screen
to say which was which. A handler for a function that takes arguments is now always wrapped.

Space also has to mean Send wherever focus sits. A toolbar button keeps focus after a click,
and Space on a focused button presses it again, so the key handler hands focus back to the map
first. Letting the focused button win was rejected: it makes the app's most-used key depend on
which control was touched last, with nothing visible saying so.

---

## UI and the control panel

Moved to [decisions/ui-and-control-panel.md](decisions/ui-and-control-panel.md) - the
toolbar, the control-panel tabs, the scene library, and the dialogs.

---

## Storage, packaging and the shell

### No frameworks, no bundler, no build step · `SETTLED`
Plain JavaScript in `<script>` tags, because the app has to run straight off the local
filesystem. That single requirement is also why ES modules are banned: `import`/`export` do not
work on `file://`. A build step would buy nothing an offline single-page app needs, and it would
put a compile between an edit and seeing the result on the TV.

The corollary that needed a hook rather than a rule: the entry script was once a 2400-line blob,
and `guard-blob.js` blocking any edit that grows it is the only reason the code now lives in
`src/`.

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
The loop lives in `sceneManager.js` (`importMapFiles`), never a second one in the drop handler.
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

---

## Video

### The rs=2 stall fix · `SETTLED` — keep every piece
The Player plays from its **own** in-memory blob, not the shared `file://` clip both windows
read concurrently. Keep: the `disable-features BackgroundVideoTrackOptimization` switch,
`backgroundThrottling:false` on both windows, the `onVideoWaiting` pause-poll-until-rs≥3
resume, the RVFC loop in `startVideoLoop`, and the Player texture-sync dedup on
`currentTime`. The diagnostics (on-screen overlay, stress rig, rotated disk logs) are
permanent, not temporary. Fallback if it ever recurs: throttle the Player's per-frame
`drawImage(video)`.

### The ~30s jitter · `SETTLED`
Root cause was Chromium's `BackgroundVideoTrackOptimization` dropping tracks on "occluded"
muted loops. The `disable-features` switch above is the fix.

**The "unverified across the Chromium 120 → 150 bump" worry is retired, 2026-08-09.** It held
that a renamed feature would silently turn the switch into a no-op, and it carried a soak test
to prove otherwise. Two full table sessions after the bump ran clean, so the switch is doing its
job. The related rs=2 stall is **not a version regression either** - it occurred on 120, occurs
on 140, and occurs in between, so any future freeze is new evidence rather than this cause
recurring, and should be diagnosed from scratch.

### The Player's map texture is viewport-sized · `SETTLED` (2026-08-07)
The Player's animated-map texture was the size of the display-scaled map and was re-uploaded
to the GPU every frame. It is now the viewport plus a 32px margin, carrying only the region
under the camera at one texel per screen pixel: **90.7 MB to 3.9 MB** on the 12900x11700 map
(one instance, 20s apart), resident and per-frame alike. `USE_REGION_TEXTURE` reverts it.

**The region is the viewport grown by a margin, NOT `visibleMapRegion()`**, which shrinks as
you pan to an edge and would change the texel-per-pixel ratio with the camera. The
un-intersected rect makes the sprite land on the SAME screen rect at every pan and zoom, so
no sub-pixel drift can open a rim between the map and the Canvas-2D fog above it.

**`bleedRegionEdges` replaces the clamp a full-map texture got for free**, and must read the
VIDEO: a canvas drawn onto itself forces a readback, measured at 0.185 ms/frame.
**`onDisplayInfoUpdated` must not fall through here** - it rebuilds a full-map sprite at 0,0.
`PLAYER_COVERAGE_FACTOR` no longer reaches animated maps; it still governs image maps.

### Frame timing for the two Player texture paths · `SETTLED` (method + result)
**The lever this was measured with no longer exists** (noted 2026-08-13): `USE_REGION_TEXTURE`
and `npm run memprobe:no-region` are both gone from the code, so the A/B below cannot be re-run
as written. Rebuilding a runtime flip is the prerequisite for re-measuring it.
The method was: flip at runtime and start on the other side, so the comparison runs inside one
instance in both orders. Clean run, same map both windows: region 351 frames / 0.370 ms,
full-map 337 / 0.320 ms. No smoothness difference. **The region texture's win is memory, not
frame time**, and import-time compression narrowed even that - the full-map alternative on a
boxed map is ~27MB against the region's ~15MB, where it was 91MB against 15MB when this landed.

**ms/frame measures the wrong half**: the timer wraps the canvas draw and
`pixiUpdateMapTexture()`, which only marks the texture dirty, so the GPU upload it schedules
falls outside it. Frames delivered in a wall-clock window is the metric. **A flip that races
the DM's scene sequence measures a different map per window** and three runs were void for
exactly that. Distrust any result whose two lines do not print the same `map=`.

### Three allocations nothing read · `SETTLED` (2026-08-07)
- `fogTransBlendCanvas` and `fogTransBlurPrev` are read only by the Player's `renderFog`,
  which returns early for the DM. Now inside the `isPlayer` branch of `startFogTransition`;
  36 MB each off the DM on the 12900 map.
- `rebuildFogBlur`'s padded canvas is cached on dimensions as `_fogPadded` and cleared on
  reuse, since the `drawImage` into it is source-over. **Not** `_fogScratch`: assigning
  `.width` reallocates, so sharing one canvas between two resizing callers saves nothing.
- `pixiFlushTexturePool()` on minimize was dead. Its calls after `pixiInitFog` stay.
- The minimap's fog-composite scratch is the same pattern, added 2026-08-09: cached on the
  preview's dimensions instead of allocated per redraw. **Its reset must run on every reuse,
  not only after a resize** — the composite exits with `source-atop` and alpha 0.35 still set,
  and "no resize" is the steady state, so a resize-only reset would make the dirty path the
  normal one.

### `UNDO_MAX_BYTES` is one budget for both stacks · `SETTLED`
`redoStack` had no cap, so the pair could reach ~218 MB against a 120 MB budget. Capping each
stack separately would allow 240 MB and fix nothing, so `evictUndoPair` trims them together,
**redo first** - it is empty during ordinary drawing, so undo depth is untouched in the case
that matters. Redo keeps a one-entry floor: `redo()` checks the length, then pushes and
evicts before popping, so a stack that eviction could empty would pop `undefined`.

### Streaming the Player's video over a private scheme · `REJECTED` - built, measured, removed
Would have dropped the 280 MB Blob the Player pins for the session, by serving the same file
over `evermist-video://map/<sceneId>`. Built and working: no canvas taint, correct 206/Range,
no return of the rs=2 stall, fine inside the asar. Removed rather than parked, because a
privileged scheme handler that nothing reaches is live surface for zero benefit, and the Blob
path is a SETTLED stall fix that any replacement has to beat rather than merely match.

It did not beat it. The Player pauses ~0.8s at every loop wrap on both sources, and the
streaming numbers (0.97-1.03s) sat inside the Blob's spread (0.56-0.99s) - no win to show for
the surface. Retrieve from git history if revisited.

**Traps already paid for, and none announces itself.** `registerSchemesAsPrivileged` must run
at module scope with `secure`+`corsEnabled`, alongside `crossOrigin='anonymous'` and an ACAO
header, or the canvas taints and the map renders BLACK rather than slow. Responses must be
cacheable. The id goes in the pathname, never the host, which lowercases.

### The old Canvas-2D grid path · `SETTLED` — deleted
Only `renderPlayerGrid(vp)` on `playerGridCanvas` is the live Player grid path. Don't
resurrect `drawGridLines(mapCtx)`.

---

## Floor-plan derivation

### Auto-polygons read the map's own floor plan, not pixels · `SETTLED` (design)
Dungeon Alchemist exports Universal VTT (`.dd2vtt`) beside the map: wall segments, doors and
windows, light sources and the grid calibration, as vector data in grid-square units. Every
hard problem in pixel tracing is simply absent - no doorway leaks, no furniture holes, no
tolerance dial, no ragged vertices along a curve. It calibrates the grid for free, and alignment
with the paired video is exact (`map_size × pixels_per_grid` equals the video's own pixel size,
uniform scale 1.0).

Walls arrive as loose two-point segments with gaps at the openings, and the portals fill those
gaps exactly, sharing endpoints. **Walls unioned with portals is a closed floor plan; walls
alone are not.** Derivation is then five pure-geometry steps: union walls with portals, split
edges at T-junctions, walk the planar faces, drop collinear vertices, discard boundary faces by
winding, and scale by `pixels_per_grid`.

### The UVTT derivation's two silent traps · `SETTLED`
**Classify faces by winding direction, never by area.** Interior faces wind one way and
boundaries the other. Size looks like a usable signal right up until a map holds two detached
buildings, and then the smaller building's own boundary outranks a real room by area. Fails
silently, and only on multi-building maps.

**Never read `objects_line_of_sight`.** It is a vision-blocking list - columns, boulders, tall
crates - so unioning it in turns every pillar into a closed loop inside a real room, and the
face walk reports the hall as a ring plus a fake little room. Ordinary furniture never appears
there anyway: a fully furnished test room produced an absent field.

### An open wall loses its room · `SETTLED` (both halves reversed 2026-08-06)
A missing wall segment does not distort a room, it deletes it: the gap joins the interior to
the outside and the two merge into one face.

**Auto-closing gaps was rejected, then shipped bounded.** An archway with no door still bounds
a room worth shrouding, so refusing every gap failed the common case to guard a rare one. Three
things keep it safe: the bridge is a straight line between two points the file already
contains, two ends join only when each is the other's nearest feature, and a minimum face area
refuses the sliver a corner bridge chips off. Wider gaps are still refused, and nothing can
close a wall that is simply absent.

**Reporting each gap's coordinates was built, then cut from the UI** - unreadable as text, and
an edge case placed in front of every successful import. `openWalls` still computes.

### A doorless wall loop is solid, not a room · `SETTLED` (kernel rule)
A wall run that closes on itself carrying no portal anywhere does not bound a room: it is a
rock formation or the cave's own shell. Every real room reaches somewhere through a doorway,
so its walls arrive as an OPEN chain that closes only once the portals are unioned in. On the
cave export the false rooms scored 100%, 100% and 84% of their outline in doorless wall and
every real room scored exactly zero — so the test is "any at all", with no threshold to tune.
That is the point: a blind area threshold is the instrument the winding-not-area trap already
punished once.

Two properties keep it safe. It judges **a whole connected run of walls, not one room**, so a
windowless cellar or a prison cell keeps its building's doors; only a structure isolated from
everything else is refused. And it runs **before the portals are unioned in**, since afterwards
every chain is a loop and the distinction is gone. Accepted cost: a floor that is one sealed
room, an attic reached by a hatch, comes back empty rather than wrong. That trade is deliberate:
confidently correct, or no polygons at all.

### A wall stub never bridges into solid, and a mutual pair reaches further · `SETTLED`
A room whose whole side is open to a cave was lost, and gap closing looked innocent. Both
ends of the opening bridged sideways into the rock a few feet away — nearer than each other —
which glues the wall to the cave, achieves nothing, and consumes the end so the real partner
is never found. 8 of 10 bridges on the cave map were that mistake, and raising the reach
could not fix it because the ends were already spent.

So the doorless walls are computed BEFORE closing and excluded as targets. Once nothing solid
can steal an end, the two sides of an opening find each other — at 3.7 and 4.3 squares, past
the 2.5 a stub is allowed. Hence a second, wider ceiling for a MUTUAL PAIR only, where both
ends pick each other: far better evidence than a stub projecting onto some wall's mid-span,
which keeps the tight one. Tightening the base ceiling tightens both, so "closing off" still
means off. Result on the cave map: 13 rooms, all real, none false.

### A portal becomes a door only where two rooms share the wall · `SETTLED` (2026-09-01)
Portals carry no type field, so the only evidence a plan gives about an opening is what stands on
either side of it. One rule uses that: a portal whose midpoint sits within a quarter cell of two
derived rooms' outlines is a doorway; one room means a window or an outside entrance and nothing
is placed. Measured on both fixtures before it was built - 2 of 19 portals qualify on the interior
map, 16 of 25 on the cave - and the counts are identical at tolerances of 0.1, 0.25 and 0.5 of a
cell. At a full cell they smear, one portal claiming three rooms. A quarter cell is also what
`doorMouseDown` already uses to decide two clicks are the same door.

**A derived door is the identical record a click makes**, `{edge, t}` and nothing else. Width and
depth stay global, so a double doorway in the file comes out one square wide - accepted, because a
per-door size field would reach the fog rebuild, the click hit-test, the grid-change rebuild, scene
save, backup and undo, and split doors into two kinds that look different from each other. The
match runs in `fogGeometry.js`; `vttPlan.js` only gained the portal midpoints, and stays
dependency-free.

### Grid Size comes from the plan at import, size only · `SETTLED` (2026-08-14)
A Dungeon Alchemist export used to mean typing its DPI into Grid Size, and a compressed map broke
that trick: the right size became 150 × 3840/srcW, which nothing on screen could tell you.
Derived instead as **pixels across divided by squares across** (`mapWidth / squaresX`), not from
the plan's own `pixels_per_grid`. The division self-corrects any resolution mismatch, the same rule
`vttScaleRooms` already uses for the rooms; reading the file's own number would hand back the
untouched export's value and put the grid out of step with the map on screen. `vttDerivePlan` gained
`squaresX`/`squaresY`/`gridPx` additively; the clamp to the control's 10–400 range and the writing
of both slider and chip live in `floorPlan.js`.
**The import path only, never `applyPlanToScene`.** Draw Rooms runs that function again at any
later point, and a hand-tuned grid has to survive it - auto on first load, the DM's value wins
forever after. **Size, not offset:** `map_origin` means a correctly-sized grid can still sit out of
phase, and deriving the offset too was judged the wrong trade against a manual nudge. A map with no
plan gets nothing, and no hint about the shrink factor either; both accepted, not gaps.

### Owlbear Rodeo's automatic fogging is not a template · `REJECTED` (as a model)
Their "Forecast" feature is a server-side computer vision pipeline gated to their top paid
tier, which an offline `file://` app cannot replicate at any effort. Worth knowing for a
second reason: with cloud compute and a purpose-built pipeline they still ship Slice, Trim and
Join to correct its output. Any local pixel approach should expect to need correction tools
too, which is a further argument for reading vector data instead.

---

## Docs, rules and guards

Moved to [decisions/docs-and-guards.md](decisions/docs-and-guards.md) - the doc
architecture, the guard hooks, and the calls about what CLAUDE.md may hold.

## Testing and the rig

Moved to [decisions/testing-and-the-rig.md](decisions/testing-and-the-rig.md) - the CDP
rig, acceptance scenarios, and mutation coverage.

## Map effects

Moved to [decisions/map-effects.md](decisions/map-effects.md) - burning ground, the
flaming border, the Cone tool and the material picker.

---

## Corrections worth keeping

Reasoning that turned out wrong in a way that would repeat. Each is here so it doesn't.

**"It's a big refactor."** Said about the comment trim. It conflated *deleting reasons* with
*trimming verbosity*. Different operations: the second is comment-only edits with no code
change, and the test suite catches the one real risk.

**"PDF support isn't worth it."** Measured the wrong thing - the cost was never the extra
rooms, it was the DM having to prepare a file at all.

**"The whole-book numbers."** "301 locations, 88/88 castle" was measured by the parser *before*
sub-locations landed. The current parser finds strictly more and nobody has re-run it. Don't
quote those figures as current.

**"Universal VTT carries a still image."** True of the format's own specification and false of
the tool: Dungeon Alchemist's UniversalVTT export offers video file types, writes the video as
a sibling file and leaves `image` an empty string. Reading a spec is not checking what the
exporter does.

**"Loose wall segments mean face-finding is several evenings."** Judged before the portals were
unioned in. Walls plus portals close the plan, and the derivation took one pass. A partial read
of a data file is not a basis for an estimate.

**"Brush radius is applied in map-space, so 40px isn't 40 screen px."** Carried as an open bug
for months and false on inspection: both places that turn the slider value into a fog radius
divide by `zoom`, and the cursor ring is drawn in screen px to match. `brushSize` has no third
reader. A bug filed from reasoning rather than a repro can outlive the code it described.

### The Player window came up invisible because Windows called it occluded · `SETTLED` (2026-08-28)
A long-running fault where the rig's Player window reported itself hidden and rendered nothing.
It looked intermittent, then sat at 100% for whole sittings, and no amount of asking the window
to go fullscreen cleared it. The cause was Windows reporting the window covered, at which point
Chromium stops painting it and the page reports `document.hidden`. Working on the machine during
a run produced it, which is why it appeared to come and go. Three Chromium switches at launch
turn occlusion handling off, and a run now survives being held at the back of the z-order for its
whole length. Proven both directions: remove the switches and the exact old error returns.
Fullscreen was only ever a workaround for this, so the Player is windowed now.

### The rig runs off the screen, and four pieces hold that up · `SETTLED` (2026-08-28)
A run used to own the machine. It now parks every window the app opens at -9000,-9000 through a
PowerShell helper, moving them while still hidden so none ever appears. Four pieces depend on one
another and must not be separated: the occlusion switches keep a parked window painting; not
asking for fullscreen is what allows parking at all; parking hidden windows is what removes the
flash; and a device-metrics override gives the Player the real display size its rendering depends
on without putting the window back on screen. Focus still moves to the app on launch, which is
the app calling `focus()` on itself; changing that would be an app change made to serve a test.

### An acceptance scenario covers one feature and ends at the Player · `SETTLED` (2026-08-28)
Scenario files had grown one per bug fixed or feature shipped, which left the set arbitrary: one
file asked "does rounding work on fire", another "does everything work". They are now one file
per feature, opening with the feature's goal in a sentence, covering every success state it has
including the edge ones, and finishing at the Player window. The many combinations a feature
allows are swept on the DM; the Player is checked once per distinct OUTCOME, because everything
crosses in one `fog-update` message and checking each combination there proves the same delivery
repeatedly. Rooms never cross, so a Player check reads the fog a room paints, never a room.

### Two Electron startup messages are filtered, and only a preload check makes that safe · `SETTLED` (2026-08-28)
Electron's sandboxed-renderer bootstrap failed about one boot in thirty and ended runs on the
rig's own noise. The splash window takes Electron's defaults - sandboxed, no preload - and is
destroyed as soon as the DM paints, so its bootstrap can be cut off midway. Filtering those two
messages alone would be unsafe: a real preload failure logs the same words, and the app degrades
quietly rather than failing, so a run would go green with no disk access at all. Both windows are
therefore checked directly for `electronAPI` on every boot. Delete either check and the two
filter terms have to come out with it.

### The five-second autosave is the promise, so the switch-time save is not a bug · `SETTLED` (2026-08-28)
`switchScene` calls `doAutoSave()` and nulls `currentScene` in the same task, so the `toBlob`
callback's identity guard rejects that write every time. A rig criterion was written against it
and reported data loss: reveal ground, change map inside five seconds, and the reveal is gone from
the saved scene. Closed as expected behaviour on product grounds. The app promises an autosave on
a five-second timer, not a save the instant the map changes, and the criterion was demanding a
guarantee that was never offered. The scenario now waits for the autosave to commit, then checks
that switching away does not damage what it committed, which is the success state. Two rules
follow: do not "tighten" that scenario by dropping the wait, and do not make the switch-time save
land in order to satisfy a test - it would change behaviour at the table to serve the rig.

### Every acceptance scenario runs on an animated map · `SETTLED` (2026-08-28)
The suite generated a still PNG everywhere, and animated maps are the only kind in real use, so it
proved the app worked in a case that never happens. The open question was scope: whether to switch
every scenario or only the Player-facing ones, because a recorded clip costs real time per run.
Measurement settled it - all fourteen files switched for four extra seconds across the whole pass.
Three things make that affordable and all three must hold: the clip is one second, it is cached by
size for the whole run so scenarios at the same size share it, and it stays inside the shrink box
so no import pays for a re-encode. `smoke.js` keeps one still map, because its own job is holding
the animated render path against the still one.

### The backup export's field whitelist is checked by reading its own source · `SETTLED` (2026-08-28)
`doExport` opens a native save dialog as its first act, and `electronAPI` comes through
contextBridge, so it cannot be stubbed and the payload builder behind it cannot be reached. A
scenario can only rebuild the same payload itself, which proves the archiver works and says
nothing about the export's own field list - and a field missing from that list is dropped
silently, leaving a valid zip and a room without its corner radii. So the scenario reads
`doExport.toString()` and asserts every field the restore needs appears inside the `metadata:`
literal. A source-text assertion in a behaviour test is deliberate here, not laziness: nothing
else in reach can see that loss.

### The scene library is a popup, and a group is a name the scene carries · `SETTLED` (2026-08-29)
The scene list was a 208px dropdown showing six of sixteen scenes with every long name
truncated. Three shapes were weighed: a denser row list in the same dropdown, a full-screen
view, and a popup over the map. The popup won because a card keeps its old size and the map
stays behind as context, and a full-screen view was priced as the same outcome for more work.
A second HTML file was ruled out outright: `switchScene`, the canvas and the open scene all
live in the main window, so a second document would have to message back for every action.
A group is a NAME on the scene record, never a container that holds scenes. That is what makes
it ride the scene through IndexedDB and the backup zip with no new store, and what makes
deleting a heading cost no maps. `sceneGroups.js` keeps only the display order, the collapse
state, and a heading made before anything was dragged into it. Those live in localStorage
because losing them costs a fold and an empty heading rather than a map.

### One floating surface, and the panels were brought to it · `SETTLED` (2026-09-01)

`base.css` defines the app's floating panel as four variables. Five panels wrote their own values,
so the room card and the settings panel sat side by side over the map with edges that disagreed.
All five now read the variables.

**The panels moved to the shared value; the shared value did not move.** The four full shells - the
advanced fog panel, the module-text modal, the confirm dialog and the room card - went from a 1px
hairline at 5.5% white, 10px corners and a `0 6px 22px/0.36` shadow to the shared 1.5px at 10%, 12px
corners and `0 5px 16px/0.28`. They sit visibly FLATTER on the map now, and that is the chosen
result, not a regression. `#sm-panel` is the exception and takes the border alone, for the reason
the `dm-ui` skill records.

### A denser scene list was built and rejected: the thumbnail is the identifier · `SETTLED` (2026-08-29)
Two of the three sketches shrank the picture to fit more scenes: a 30px row with a 38x22
thumbnail, and the same row under collapsible headings. Both were rejected on product grounds.
Picking the wrong scene puts the wrong map on the TV, and at that size a thumbnail reads as a
colour rather than a map, so the picture is a safety control instead of decoration. The name
follows from the same call: it wraps inside the picture over a darkened foot and is never
ellipsized, because a name cut short cannot be told from its neighbour either.
Do not reopen density as a way to fit more cards. The answers already taken are a wider panel
and a find field, and both leave the picture alone.
