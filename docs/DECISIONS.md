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

### Player fog is Canvas-2D on top, DM fog is PixiJS · `SETTLED`
The two views deliberately use different fog paths. Every PixiJS approach to the Player
fog left a faint seam at the edge of animated maps; drawing one continuous 2D layer over
the whole Player window makes the seam geometrically impossible. The split is
architectural, not a stopgap. Do not unify the paths.

### Fog animates by cycling pre-rendered warped frames · `SETTLED`
The cloud texture is generated once at startup as a set of 512² domain-warped noise frames,
then crossfaded at runtime while the cloud passes keep drifting spatially. The drift supplies
movement and the frame morph supplies organic evolution; neither looks right alone. Sampling a
3D noise field per pixel per frame is the better-looking approach and is far too slow in JS at
full resolution, so pre-rendering moves that cost to startup, a few hundred ms for roughly
10MB of canvases. Plain texture-sheet cycling without warping, and per-tile UV perturbation,
were both considered and neither is needed while frame cycling holds up. The warping follows
Inigo Quilez's domain-warping technique: https://iquilezles.org/articles/warp/

### Oscillating drift, breathing and rotation · `REJECTED`
Modulating drift velocity with sine waves, pulsing scale or alpha, and slowly rotating the
cloud passes were built and all look wrong. A rigid transform applied to a full-screen texture
reads as a whirlpool or as seasickness rather than as weather, and rotation is the worst of the
three: the whole layer visibly spins even at 0.008 rad/s. **A global rigid-body transform
cannot approximate atmospheric motion - organic movement needs per-pixel deformation**, which
is what the warped frame cycling above already provides. Do not re-propose making the fog
breathe, pulse or rotate.

### Testing fog's render/compositing layer · `REJECTED`
`renderFog`, `rebuildFogBlur`, `recompositeCloudEffect`, the RAF loops and the Player seam
path are not `node:test`-testable no matter how state is injected, because their behaviour
*is* canvas pixel output and there is no `canvas` dependency. node-canvas does not
faithfully implement `ctx.filter='blur()'`, so feather and blur would not reproduce either.
Pure math goes in `fogGeometry.js` and gets tested there; the imperative layer stays
untested. Do not chase testability by injecting render state.

### A door is stored on one room but reads every room on its wall · `SETTLED` (2026-08-30)
A door marks an exit as a notch in the fog. It is stored on a room, so it appears only when that
room does and an unexplored map is never handed a diagram of its own exits. Its STATE, though, is
the most revealed of every room whose outline passes within a third of a cell of it. Asking the
owning room alone left a door invisible whenever the click had attached it to the shrouded side of
a shared wall, which is not something the DM can aim at. It also settles half-shroud, which has no
answer while a door belongs to one room: half beside shrouded is half, revealed beside anything is
revealed. Free-standing doors were considered and rejected - a door owned by nothing still has to
know which rooms touch it, and it shows before the party arrives.

### Doors are one grid cell, not a size that gets drawn · `SETTLED` (2026-08-30, replaced a drag)
A click-and-drag door, whose length along the wall set its width and whose distance from the wall
set its depth, was built first and taken out. Per-door sizes invite editing, copying and moving,
and none of that exists. Snapping to the grid removes the question: every door is one cell, a
second click on the neighbouring cell makes a ten-foot doorway, and a third click on either closes
it again. Toggling is decided by CELL, never by whether the click landed inside a door's rectangle
- a boundary click belongs to two rectangles and to neither, and the tool draws its ticks exactly
there. Width and depth survive as two global percentages of a cell, not as per-door fields.

### The reveal's feather is flattened along walls two rooms share · `SETTLED` (2026-08-30)
Two revealed rooms sharing a wall each feather inward from it, so neither reaches a full erase on
the line and a band of fog stands over every shared wall. The mask is flattened along those
stretches, found by sampling each wall against the other rooms' outlines within half a feather.
The flattened band may cross the wall ONLY where the neighbour paints the same density: crossing
bridges two rooms traced a few pixels apart and costs nothing between two revealed rooms, but
between a revealed room and a half-shrouded one whichever composites last would win a strip on the
wrong side. Spans stop short of both ends, or a band reaching a wall junction left a tab of cleared
fog poking out of the room block.

### Half-shroud is absolute: erase to completion, then repaint · `SETTLED` (reversed 2026-08-04)
Originally the Half erase was partial (`destination-out` at `1 - fogHalfAlpha`) on the
theory that you can't half-forget the room the party is standing in, and reveal-then-repaint
was rejected for being able to re-fog cleared ground. That got the case backwards. At the
table the room a Half marker is *for* is the one the party has already been in, so its
ground is already clear - from a brush stroke, a Reveal All, or the room's own earlier
Reveal. `destination-out` only ever multiplies, so on clear ground a partial erase is a
no-op: marking the room Half changed nothing on screen and the density slider looked dead at
every value. Now the erase runs to completion like a reveal and fog is repainted at
`fogHalfAlpha` through the same mask, so the room lands on exactly that density whatever was
underneath. With mask `m` the result is `(1 - m) × old + fogHalfAlpha × m`, so the feathered
band still ramps from the surrounding fog down to the interior. The old "no change in the
overlap" behaviour is gone on purpose; a Half room now dims cleared ground, which is the
whole point of the state.

### Half-shroud rollback needs a data sweep, not just a revert · `SETTLED`
`mode: 'half'` is written into IndexedDB scenes and backup zips. If the branch is ever
reverted, saved half rooms fall into the reveal `else` and render as **full reveals**, the
most permissive possible failure for a fog tool. A revert must also sweep saved polygons
`'half'` → `'shroud'`. Fail closed.

### `fogHalfAlpha` is absent from Fog Reset · `SETTLED`
It is the only dial in that panel that persists across sessions, so resetting it would
discard a value dialled in over a session.

### DM cloud pattern is frozen at frame 0 · `WON'T FIX` (until someone sees it)
`cloudPattern` is built once and never refreshed; only the Player rebuilds it per tick. A
`CanvasPattern` is a snapshot (verified empirically in Electron 43), so every DM
reveal/shroud crossfade composites a stale frame-0 cloud. DM only, visible only during a
transition, roughly a one-line fix. Nobody has reported seeing it.

### Cloud morph advances by real elapsed time on both paths · `SETTLED` (reversed 2026-08-09)
The video path fed `cloudFramePos` the per-tick `dt` while the frame throttle was skipping
ticks, so fog over an animated map morphed at a fraction of its rate on a still one. Carried as
`WON'T FIX` on the grounds that preserving the appearance outranked uniformity; that call is
reversed and both paths now share one rebuild gate and one clock. **The measured gain is ~4×,
not the ~12× long recorded** — `dt` is one rAF interval (~16.7ms) against a 66ms video gate.

**The stall clamp must exceed the longest ordinary gap between rebuilds**, or it silently
throttles the morph instead of only catching stalls. At 0.1s it was shorter than the ~132ms the
video throttle produces and docked every step; it is now 0.25s and named.

### A drag release must not stop the running fog transition · `SETTLED` (2026-08-09)
`stopFogTransition()` ends a crossfade by jumping it to its finished state, so the six drag
releases in `tools.js` calling it before starting the next transition made a quick second drag
snap. They no longer do: `startFogTransition()` already handles an overlapping call by leaving
the live fade running, and the following `rebuildFogEffect()` re-targets it. `stopFogTransition`
stays where a transition must genuinely be abandoned — scene switch and window close.

**This did NOT fix the reported snap**, which still reproduces. Two theories are now spent: the
older "call `startFogTransition()` after the final rebuild" was already in the code, and this
one was correct in itself but is not the cause. The change is kept on its own merits. A third
attempt starts from a fresh diagnosis, not from either.

### Fog "named theme library" · `REJECTED`
Save/apply named fog themes was descoped out of the fog-colour epic. Distinct from
per-preset fog identities, which are parked separately.

### A scene switch is covered by the fog itself · `SETTLED` (2026-08-09)
The Player's switch used to be a black DOM layer fading in and out. It is now the fog: it
closes over the outgoing map, holds fully shrouded while the new map decodes, then clears off
it, roughly 2.25s / 1.4s / 3.35s. Fully covered, `renderFog` punches no reveal holes at all,
which is what makes the cover immune to the map changing size and camera underneath it. The
DM holds the scene payload back until the close has had its time, or the swap happens under a
half-closed cover. `#scene-fade` survives only as the flat blind for the session's first map,
before any fog canvas exists to cover with, plus a `.dark` marker meaning "switch in progress".

### The cloud transform is re-anchored across a switch, never animated across · `SETTLED` (2026-08-09)
The cloud texture is anchored to the map, so a swap changes its scale and origin in one frame.
Two ways of crossing that gap were built and removed: easing the transform reads as the whole
fog zooming, because two maps fitted to one screen can differ several-fold in zoom, and
cross-fading two cloud bitmaps dissolves one cloud scale into another, which reads as a wash.
What ships removes the gap instead - the transform is pinned for the length of the switch and
the incoming scene is re-anchored onto it (`fogCloudAdj`, a scale multiplier plus offsets).
The cost is that cloud size no longer tracks each map's fit-zoom; it carries forward, which is
the more consistent look. Pan and zoom inside a scene still scale the clouds.

### Fog colour crosses during the close, never the reveal · `SETTLED` (2026-08-09)
Fog colour is per scene, so mismatched scenes swapped the whole screen from one colour to the
other in one frame, at the moment the colour was the entire picture. The destination is now
sent as soon as the scene record is read and eased into over what is left of the close.
**This is the pattern for any future per-scene fog appearance:** the close is the only part of
a switch where fog appearance can change unwatched, because the fog is thickening and covers
its own transition. Anything that changes the cloud texture during the open reveal will read
as a wash, the same failure the transform ease had.

### The scene name on the Player transition · `REVERTED` (2026-08-09)
The switch showed the destination scene's name over the fog. Three treatments were built - a
feathered dark scrim behind it, a glyph-scale halo, and heavy text fitted to the screen width -
and the surface was cut instead, on product grounds: text over drifting weather reads as
pasted on however it is styled, and a name on the TV also forces map names to be written around
spoilers. The name is no longer sent to the Player at all. If it ever returns, it needs its own
moment rather than a layer over the fog.

### Every drawing preview reads `POLY_EDGE_COLORS` · `SETTLED` (2026-08-09)
1.7.7 gave the polygon tool the shared outline table but left `drawCursor` colouring the brush,
rectangle and circle from its own list, so a rectangle dragged in Shroud previewed blue and
snapped to purple on release - the same hue-jump that table was created to end. All four tools
now read the table, as does the polygon's rubber-band segment to the cursor (mode colour at
0.6 alpha, so an un-placed edge still reads as provisional), and the close-target halo now uses
`POLY_EDGE_SELECTED` instead of a second, slightly different gold. **The brush and circle centre
dots stay white deliberately** - they mark where the stroke lands rather than outlining a room,
so they have to hold against every map. The rule this generalises: anything that previews a room
takes the room's colour; anything that marks a position does not.

### The About box shows the repo as text, not a link · `SETTLED` (2026-08-09)
The app gained an About box in 1.7.8 (`src/about.js`, opened from a button beside the shortcut
legend, absent from the Player view because its whole row is). It shows the mark, the wordmark,
the tagline, the version and the repo address. **The repo is plain text on purpose:** opening a
URL from Electron needs `shell.openExternal` and another IPC channel, and a link that looks
clickable and does nothing is worse than no link. **The version must never be a literal** - it
arrives from `app.getVersion()` over an `app-version` IPC, so it cannot go stale at the next
bump; served from a plain browser with no `electronAPI`, the line hides itself rather than
printing a placeholder. The box builds its own markup at init, because `index.html`'s inline
script is under a shrink-only guard and is wiring only.

### The splash tagline names prep, not fog · `SETTLED` (2026-08-09)
"FOG OF WAR FOR THE TABLETOP" described the old positioning and became wrong once the app's
pitch moved to prep. It now reads "PREPARE LESS, PLAY BETTER". This is the same reframe the
README rewrite carries, so the two must not drift: the app is a prep tool that also runs
beautiful maps, and the splash is the first place that claim is made.

### Video loop seam · `WON'T FIX`
The seam is in the source Dungeon Alchemist export (last frame ≠ first frame); the app just
plays the file. Every in-app fix (double-buffer crossfade, freeze-bridge) either doubles
decode cost or hitches on moving water. A "how to export a clean loop from DA" note serves
better than app code, and the whole thing evaporates if the DA team fixes the export.

The measured shape, so it isn't rediscovered: at each wrap `onVideoWaiting` pauses until
readyState recovers - 0.56-1.03s on the Player, 0.20-0.22s on the DM. The two windows wrap at
different moments because each plays its own copy, which is the point of that split. Judged
not worth chasing against a source-side cause that is expected to go away.

---

## The render loop

### The dirty-flag loop rides the PixiJS ticker, on one clock · `SETTLED`
Capping the two loops independently at the same interval was built, measured and rejected:
same interval, different phase, so the Canvas-2D layers led the WebGL map. Measured
viewport-set→present latency during a scripted pan, p90: 5.5ms uncapped, 33.2ms with two
independent caps, roughly 36px of grid sliding against the map. Capping only `doRender`
preserved registration but won nothing, because the entire saving is the ticker.

The resolution: `doRender` is registered on the PixiJS ticker at `UPDATE_PRIORITY.HIGH`
(above Application's own render at LOW) and the cap lives on `ticker.maxFPS`. p90 dropped
to 0.5ms, tighter than the app has ever been. An rAF fallback covers `pixiApp === null`.

**Do not "simplify" this back into a self-scheduling rAF loop with its own throttle.** A
throttle on top of a throttle is exactly the phase bug this replaced.

### Frame cap is 30fps, not 15 · `SETTLED`
15 is where slow water and fire on video maps start to look wrong. No user-facing control:
the FPS slider was deleted deliberately (see below).

### CanvasPattern caching · `REJECTED` (the premise was wrong)
The backlog carried "cache the cloud pattern" as a perf idea. Tested in Electron 43: a
pattern made before a redraw still reads the old pixels, so the per-tick rebuild is
required rather than wasteful.

### Dropping the redundant full-res `mapOffscreen` · `REVERTED` — landmine
A 2026-06-19 attempt caused a 90% CPU regression and RAM stayed around 3GB. Only revisit
incrementally, one path at a time, measuring after each. High risk to the TV-critical
Player path.

### CPU is not the perf problem; memory is · `SETTLED`
The 1.6.1 batch cut renderer CPU roughly 7× and it solved nothing anyone could feel. It was
kept anyway, as a benefit to lower-end machines. Do not open another CPU-reduction batch.
Memory was measured on 2026-08-07; see below.

### What one map actually costs · `SETTLED` (measured 2026-08-07)
Measured with `src/memProbe.js` (`?memprobe=1`) on a 2560×1392 panel, no TV attached.
Working set across all processes, DM plus Player: **a 9750×5850 image map ≈ 3.0 GB; a
12900×11700 animated map ≈ 16.6 GB**, GPU process peaking at 10.4 GB.

Deliberate allocations are only ~918 MB and ~2.25 GB of those. The rest is Chromium's
multiplier, and its shape is the finding: **accelerated canvas backing stores are charged
to the GPU process and carry a CPU copy plus a GPU copy**, so a megabyte not allocated saves
about three. Two costs dominate and neither is fog: **the Player redraws and re-uploads the
whole map texture every frame** on an animated map (the difference between 7.5 GB for the DM
alone and 16.6 GB for both windows), and **two independent video decoders**, which on an
ordinary 4320×2592 map are ~92% of the total. The PixiJS RenderTexture pool measured empty
in every sample.

### Coverage is per-view: the Player gets less zoom headroom than the DM · `SETTLED` (2026-08-09)
`PLAYER_COVERAGE_FACTOR = 2` against the DM's 3 (`video.js`). Coverage is zoom headroom, and
area scales with its square, so the Player's texture — and on animated maps its per-frame
GPU upload — more than halves on an oversized map: 204 MB → 91 MB on the 12900 map, 459 MB →
204 MB on a 4K TV. 2 rather than a tighter value on purpose, so any map at or under twice the
Player's screen keeps every source pixel and nothing about an ordinary map changes; verified
byte-identical on a 4320×2592 map before and after.

**Confirmed at the table, 2026-08-09: the softening is not visible.** The cost of the change
was that the Player softens past 2× fit-to-screen zoom instead of 3×, and zooming into the
Player view does happen; two table sessions on the shipped value found nothing to see. The
constant stays at 2 and the question is closed.

### Sizing the DM's map texture off the DM's own window · `REJECTED`
Proposed on the grounds that the DM inherits the Player's display record and so carries a
texture sized for the TV rather than for its own much smaller window. Measuring it killed
the idea: 3× a 1384 px window is 4152 px, which against a 9750 px master goes soft at zoom
0.43 instead of 0.79. The DM is where rooms are drawn at high zoom, so the TV-derived figure
is load-bearing there even though it looks accidental.

### Cross-run CPU comparison on this machine is worthless · `SETTLED` (method)
The same configuration measured 9.3% and 24.1% minutes apart. Every trustworthy figure
must come from sampling twice inside one running instance and flipping the behaviour at
runtime in between. Two more traps: an occluded window reads as **zero** (the ticker stops
on `visibilitychange` and Chromium won't run rAF for a hidden surface), and a small test
window understates the Player, because `renderFog` cost scales with pixel area.

### Minimize memory "spike" · `REOPENED` 2026-08-07 — the earlier close was image-only
Previously closed as benign working-set movement, with a fix that pauses the PixiJS ticker
and flushes the texture pool. Two corrections from measurement:

**The texture-pool flush is dead code.** The pool reads empty in every sample, and stubbing
`pixiFlushTexturePool()` out leaves the minimize behaviour identical. Stubbing `doAutoSave()`
does too, so neither shipped suspect drives anything.

**The direction depends on the map type**, which is why an image-map investigation closed it
wrongly. On an image map minimizing dropped ~470 MB; on an animated map the reading rose
~2.9 GB and did not return on restore. Both sit inside a noise band that is ±470 MB on the
image path and ±3 GB on the video path, so a single observation attributes nothing — but peak
working set only ever ratchets up. Do not re-close this from image-map data.

---

## Rooms and the room card

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

### Player view has essentially no interface · `SETTLED`
An epic step called "Player view redesign" was wrong and was shrunk. `body.player-mode`
hides the sidebar, toolbar, minimap, scene dropdown, UI-scale row and the cursor. Exactly
three surfaces reach the TV: the scene transition fade plus scene name, the map loading bar,
and the landing/empty state. Keep them precisely because they are the only part of the app
the players ever see.

### A dark toolbar pill means pick exactly one · `SETTLED` (2026-08-06)
Snap-to-grid shipped alone inside a `.tb-seg` pill, which read as harmless because a group of
one has nothing to be picked between. Adding a second independent toggle beside it made the
pill say something false. Both toggles left the pill and became bare `.tb-toggle` buttons
behind a hairline, outlined blue when on.

The toolbar now carries three signals: a dark pill is pick-one, an outlined blue box is a
switch that is on, and the tool row wears that same outlined box while also being pick-one.
**The collision is deliberate and must not be "fixed"** — the tool picker is the one control
of its kind in the app and is meant to look unlike everything to its right. Rules are in the
`dm-ui` skill.

**The hairline is gone, and position alone carries the distinction · `REVERTED` (2026-08-09).**
The 1px `.tb-div` read as a scratch on the real monitor, which no amount of correctness in the
grouping argument survives. The gap it occupied is preserved as a margin on the first switch, so
the switches still read as their own group. **Don't reintroduce a divider on this bar.**

### The alpha slider's 1px edge fringe was `background-origin` · `SETTLED` (2026-08-06)
The opacity track painted a 1px column of the fully opaque colour on its left edge and of the
bare base grey on its right. Cause: `background-origin` defaulted to `padding-box` while
`background-clip` was `border-box`, so the gradient tile was 1px narrower than the visible
track and `background-repeat` wrapped it into the border ring. Fixed with
`background-origin: border-box` on `.ev-slider`.

Worth recording because of how it hid: the fog and hue tracks have the identical flaw and
neither shows it — fog's picked colour is dark against a dark checkerboard, and the hue
gradient starts and ends on the same red. **A colour-dependent rendering artefact is not a
colour bug**; the one visible instance was the only evidence three sliders were wrong.

### The FPS slider · `REVERTED` — deleted outright
It was a hidden `display:none` row, unreachable since the control-panel redesign, so it was
removed rather than restored. Deleted: the markup, the wiring, `fpsToFrameInterval` and its 7
tests, and the `videoFrameIntervalMs` field from the DM→Player `anim-params` message.
**`videoFrameIntervalMs` itself survives as a `const` = 1000/24 and is live** - `video.js`
throttles the frame pump on it every frame.

### The video codec hint · `REJECTED`
Carried for months without ever being wanted.

### Manual resolution slider · `REJECTED`
Irrelevant for images, and the display epic auto-downscales video textures.

### A click on the map takes focus off the room card · `SETTLED` (2026-08-09)
The map canvas is not focusable, so clicking it blurred nothing: once the DM typed in the room
card's name or description, that field held focus for the rest of the session and every later
Ctrl+Z reached its text history instead of the fog's undo. A mousedown on the map now blurs an
`INPUT`/`TEXTAREA`, which also runs the field's ordinary commit.

**The split is deliberate and was not changed:** while the caret is in a field, Ctrl+Z is that
field's text undo; on the map it is the fog's. Making Ctrl+Z always undo fog was considered and
rejected — it would make a room description uneditable in practice.

### The Player's fullscreen state comes from the event, never from `isFullScreen()` · `SETTLED` (2026-08-09)
Fullscreen on the Player window is native window fullscreen driven from `main.js`, so the
renderer sees no `fullscreenchange` and `document.fullscreenElement` stays null — the state
exists only in the main process and has to be pushed to the DM to be shown.

**On Windows, `win.isFullScreen()` still returns the OLD value inside the window's own
`enter-full-screen` / `leave-full-screen` handler** (verified against Electron 43). Reading it
there reports every change backwards and the button lights up exactly when it shouldn't. Take
the state from which event fired. Reading the flag is correct only where no transition is in
flight, such as the initial push on `did-finish-load`.

### Switching UI scaling off CSS `zoom` · `PARKED`
Moving to `transform: scale` or rem-based units would retire a bug class at the root, but the
Electron 43 bump already did that job. Don't take on the refactor without a new reason.

### Errors go through the app's own one-button dialog · `SETTLED` (2026-08-08)
Eight native `alert()` calls shipped on error paths against CLAUDE.md's outright ban. They are
gone, replaced by `messageDialog()` in `confirmDialog.js` - the same `#cd-modal` as the yes/no
dialog with Cancel hidden by a `cd-solo` class, the single button taking focus, and Escape plus
the backdrop still dismissing. The cost being paid off here was never cosmetic: a native popup is
a separate OS window, so closing one left the page's focus desynced and a later click into the
room name field placed no caret.

A modal, **not** the existing non-modal notice pattern. `#scene-undo-toast` and the floor-plan
notice are deliberately non-modal because they carry good news that can be ignored, and an error
cannot. One behaviour followed from answering asynchronously: a failed scene load now starts its
recovery immediately rather than waiting to be dismissed, so walking away from the message cannot
strand a broken scene on screen.

### The backup export modal and the native restore picker · `REVERTED` — deleted as unreachable (2026-08-08)
Both were superseded by the scene dropdown, and neither had a caller left. Selecting scenes in the
dropdown and pressing bulk export calls `doExport` directly, so the modal's checkbox list,
thumbnails and select-all controls had no way to open; the "+" button noticing a `.zip` calls
`restoreFromZipPath` directly, so `doRestore`'s file picker was stranded the same way. Deleted:
`openExportModal`/`closeExportModal`/`updateBemButton` with their parse-time wiring, the
`#backup-export-*` markup, the `#bem-*` CSS, `doRestore`, and the orphaned `show-open-dialog` IPC
on both sides of the preload. Export and restore themselves are untouched. **Do not rebuild either
as a missing feature** - the dropdown is the entry point for both.

### A drag follows the mouse BUTTON, not the pointer over chrome · `SETTLED` (2026-08-26)
`mouseleave` on `#canvas-container` used to clear `isDrawing` and `isPanning`. The bottom
toolbar is `position: fixed` over that container, so every brush stroke along the lower edge
crossed it and ended there. Worse, `toolWindowMouseUp()` is gated on `isDrawing`, so the whole
release path was skipped: the DM's fog stayed stuck showing the raw stencil, and the reveal
reached neither the Player nor the scene save.

The handler now only clears the brush ring, and the window `mouseup` owns every release. Ending
the stroke at the edge instead was considered and rejected — it saves the pixels but still cuts
a normal gesture short. `lastMapX`/`lastMapY` survive the crossing on purpose, so leaving the
map and coming back is one continuous stroke.

### One dialog at a time, and none is dropped · `SETTLED` (2026-08-26)
`confirmDialog` and `messageDialog` share one pair of callback slots, and both used to write
straight over them. A second dialog raised while one was up left the first caller waiting for
an answer that could never arrive — a restore asking whether to adopt the backup's module text
simply never heard back.

A second request now queues and appears once the first is answered. Letting the newest replace
the first and treating the first as declined was rejected: it answers a question the DM never
saw, and the answer it invents is silently "no".

### A pick-one group gets its own pill, not an inset one inside the bar · `SETTLED` (2026-08-26)

The toolbar's "pick exactly one of these" signal used to be a dark inset pill (`.tb-seg`) drawn
inside `#toolbar-bottom`. With the fog trio moved to a row above the bar and a Rooms/Effects switch
added, that put a rounded box inside a rounded box at two different heights, which reads as a
mistake rather than as a grouping. Rejected on sight.

The signal is now a STANDALONE pill wearing the bar's own surface: `#context-row` above the bar,
`#place-pill` beside it. A group inside one of those is a bare `.tb-group` with no background,
border or radius. `.tb-seg` is deleted; do not reintroduce it.

Every standalone pill matches `#toolbar-bottom`'s height - 4px padding on 34px buttons there, 6px
on 30px buttons elsewhere. The placement switch sits outside the bar because it governs every tool
on it; inside, behind a wide gap, it read as one more segment.

### Two of the four 1.4.3 engine workarounds are gone, one is permanent · `SETTLED` (2026-08-29)
1.4.3 blamed all four on Chromium 120's `zoom` handling and 1.4.4 moved to Chromium 150 the same
day, so none had been retested. Measured on the current engine: `getBoundingClientRect` now folds
an ancestor `zoom` in, within 0.5px. The colour picker's reconstructed box and the Advanced
panel's hard-coded sidebar widths both went; each now reads the real element box, checked by a
real pointer event and by where the panel lands.
**`width: 0` on `.cp-chip-pre input` and `.cp-stepval input` is NOT an engine workaround and must
stay.** Removing it takes the field from 88px to 168px and overflows its row by 149px on Chromium
150. An `<input>`'s intrinsic width beats `min-width: 0` alone, on every engine. The comment
blaming Electron 28 is what invited the deletion, and it has been corrected in place.
The fourth, the opacity track's linear-gradient checkerboard, was judged by eye and left alone:
the payoff is three lines of CSS.

### The over-engineering sweep found almost nothing · `SETTLED` (2026-08-29)
Recorded so the same ground is not re-swept. Every top-level function is reachable, no CSS rule
or custom property is orphaned, no IPC handler lacks a caller, no constant table has an unused
key, and no config points at a moved file. What it did find: five unreferenced declarations, a
`getElementById` for an element that never existed, an unused `set-fullscreen` IPC route, and one
dead CSS rule.
Three leads were checked and struck rather than left open. `PLAYER_COVERAGE_FACTOR` is live and
covered by tests; only its comment was stale. The Player region-texture helpers earn their place
on a correctness ground the backlog had not credited - `bleedRegionEdges` stops a dark rim at the
map border. Properties that look write-only are browser and WebGL APIs the platform reads.
Deliberately not acted on: `memProbe.js` and `stress.js` ship unreachable in an install but remain
the only tools for two open questions, and 27 silently-swallowing catches are a diagnosability
question rather than dead code.

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

### A denser scene list was built and rejected: the thumbnail is the identifier · `SETTLED` (2026-08-29)
Two of the three sketches shrank the picture to fit more scenes: a 30px row with a 38x22
thumbnail, and the same row under collapsible headings. Both were rejected on product grounds.
Picking the wrong scene puts the wrong map on the TV, and at that size a thumbnail reads as a
colour rather than a map, so the picture is a safety control instead of decoration. The name
follows from the same call: it wraps inside the picture over a darkened foot and is never
ellipsized, because a name cut short cannot be told from its neighbour either.
Do not reopen density as a way to fit more cards. The answers already taken are a wider panel
and a find field, and both leave the picture alone.
