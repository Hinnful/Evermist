# Decisions - rendering and fog

Split out of [DECISIONS.md](../DECISIONS.md) so the main ledger stays readable. Same
question, same past tense: what was decided about **how the map and the fog get drawn** -
the two views' render paths, the fog pipeline, and the loop that schedules a frame - and
why it held.

Both views render the map through PixiJS. The DM's fog is a GPU path; the Player's fog is a
Canvas-2D layer on top. The rules that bind while editing them are in
[CLAUDE.md](../../CLAUDE.md); how the passes work today is in
[ARCHITECTURE.md](../ARCHITECTURE.md).

**Status tags** and the one-heading-one-paragraph budget are the main ledger's; read its
header before adding an entry here.

---

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

