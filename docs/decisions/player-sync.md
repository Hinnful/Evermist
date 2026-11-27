# Decisions - Player sync and the minimap

Split out of [DECISIONS.md](../DECISIONS.md). What was decided about how the TV follows the DM screen, two screens, and the minimap, and why it held.

Status tags and the paragraph budget: see the main ledger's header.

---

### 1 inch is a one-press action beside Sync, not a mode · `SETTLED` (2026-11-09, BACKLOG 284)
Zooms the TV about its centre so a square is 1.1 inches (a 25 mm base fits), nothing stays on, a second press re-scales. On hex
grids the hex's width flat to flat is 1.1 inches. Sync is unchanged and copies the view completely. Rejected: a held mode or
switch, a Free/1-inch pill, Sync turning 1 inch off, Sync moving position only, a tag in the live pill, Arkenforge-style split
Sync keys. A mode and a one-press action side by side conflict with nothing to show how; two one-press actions never touch.
Rivals checked (Encounter+, Foundry modules, Fantasy Grounds, Arkenforge, DMHelper, Table Slayer, Owlbear, Roll20): none has a
separate minimap, most outline the TV on the DM's map; the minimap stays so the DM works anywhere without moving the TV.

### TV size is picked, kept per TV on this computer, and read from the TV when believable · `SETTLED` (2026-11-09)
Picker in TV setup (43, 50, 55, 65, 75, Other 10-120 whole inches), kept per TV (`label|WxH`) in local storage only, never in a
scene, backup or sync. 1 inch with no size opens TV setup, and Done zooms. The size the TV reports (EDID, Windows, Linux, Mac)
pre-picks when believable; fakes (LG's 160x90 cm, 0x0, an aspect ratio in cm) and sizes outside 10-120 inches are refused.
Electron exposes no physical size. Windows and Mac reads are untested on hardware; the parser is tested on recorded data.

### The Player reports its own screen for 1 inch · `SETTLED` (2026-11-09)
On Wayland the main process cannot see which screen holds a window and took the primary for the DM's, so squares came out half
size. The Player reports its screen (size, device pixel ratio) on load, resize and scale change; the old guess is only the
fallback before it opens. Not covered: a move between two screens of the same scale with no resize.

### Reveal all asks first, in Auto sync only · `SETTLED` (2026-10-16)
In Auto sync one click on the eye shows every room on the TV at once, and nothing takes it back from
the TV. So Reveal all asks through `confirmDialog`. In Manual sync the TV does not change until the DM
pushes, so there is no dialog. Hide all gets no guard: it only hides, and Undo restores it. A hold-to-confirm
and an undo toast were set aside, since neither stops the first frame reaching the TV.

### Deleting the open scene leaves the TV on its waiting screen · `SETTLED` (2026-10-16)
The world map's Delete works on the open scene. The DM's window opens the first scene in the list, or the
world map when none is left. The TV gets `scene-clear`: its fog closes over the old map and the drifting
waiting screen stays, because the fallback is the DM's pick and not the table's, and showing it could spoil a
scene. `tvHeld` blocks every automatic push (Auto sync, the resync a reopened Player asks for) until the DM
opens a scene, the fallback one included, or pushes by hand with Send, Space or Shift+S. Undo brings the scene back to the list only.

### Both Send keys work in both modes · `SETTLED` (2026-10-25)
Space sent to the TV in Auto as well as Manual while Shift+S sent only in Manual. One rule now: both keys send in
either mode, and the help sheet has one row, "Send to the TV", with both keys.

### The app does not explain undo in its hints · `REJECTED` (2026-10-25)
A "Ctrl+Z undoes" line in the reveal hint was proposed and rejected on product grounds: undo is not something the
app teaches. The reveal hint stays as it was.

### A fix that opens no pane needs no hint to move · `SETTLED` (2026-10-25)
Moving the Seat hint off Settings was dropped as moot: the Campaign's "Background picture..." row presses the Choose
image picker directly, so Settings never opens and the hint cannot fire.

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

### The minimap is overview+frame, not a pure mirror · `REVERTED` (2026-10-17, the minimap is the TV)
The old rule was "mirror flavour, shows ONLY the live zoomed slice". Reversed on purpose: a
square frame was a lie under the pure-mirror rule, and the padding shows what is about to
come into view while giving a bigger drag target. Do not "restore the mirror".

### TV frame is dotted lines only · `REVERTED` (2026-10-17, the minimap is the TV)
An earlier pass dimmed everything outside the frame and stroked it solid. Both were rejected
as obstructing the map.

### The minimap takes the TV's shape · `SETTLED` (2026-10-13)
Reverses "the square-plus-dotted-frame shape is not the thing to change". The box has the TV's aspect
(16:9 with no TV known), 240px wide, and the dotted frame is a full rectangle with an even margin of
map on every side. Drag, wheel and the view-centre pivot stay as they were. My seat swaps the box's
sides and turns only the picture, so the buttons stay upright. A whole-map overview with a draggable
frame was rejected on product grounds. A narrow window shrinks the box, never below 160px on its
long side, rather than cover the centred toolbar.

### The minimap is the TV · `SETTLED` (2026-10-17)
Reverses the margin and the dotted frame in the three entries above. The box keeps the TV's shape and
turns with Seat alignment, and the picture fills it edge to edge with exactly what the TV shows. The
margin spent 40% of each axis on what was about to come into view, which the DM's own map already
shows, and left the TV's real picture the cramped part. Drag, wheel and Sync are unchanged, so a
drag across the box now moves the TV one screen rather than about 1.7. A band that appears only while
dragging was prototyped and dropped for the same reason.

### Minimap zoom pivots about the view centre, never the cursor · `SETTLED`
Cursor-pivot zoom cannot change zoom without shifting `mapCX/mapCY`, so zooming off-centre
also panned what the players were watching. Cursor-pivot is still correct on the DM's own
canvas: different surface, different rule.

### The minimap is not a measurement of the Player's view · `SETTLED` (method)
It is a square canvas that deliberately shows more map than the TV does; the real TV is only
the band between the two dotted lines, which at a 16:9 Player is roughly a third of the
preview's height. So the preview is the wrong instrument for judging sync fidelity - read the
Player's own viewport for numbers, or judge it on the TV itself. The square-plus-dotted-frame
shape was a deliberate reversal; "The minimap takes the TV's shape" supersedes it.

### Lock blocks accidental movement, not deliberate driving · `REVERTED` (2026-11-09, Lock removed)
Sync View intentionally still moved a locked Player; Lock only disabled the Player's own input and the DM's minimap
drag/wheel. Lock is gone from the minimap: it was used once or twice, guarded only against stray nudges and conflicted with
1 inch. The TV window keeps its own mouse pan and zoom for when something goes wrong and for window mode.

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

### Two maps reach two screens as frames, not as a second copy of the app · `SETTLED` (2026-09-10)
Rewriting every scene global in `state.js` into a pane object was drawn and rejected: several
times the work, and its first half would have shipped nothing visible. Each column is instead
the whole app in an `<iframe>` at `?mode=pane`, so a column's scene, camera, grid, fog and undo
history all exist with nothing written for them.
A spike settled three unknowns first. Inside a `file://` iframe, `postMessage` round-trips and
the scene database opens; Electron injects no preload into a subframe, so a frame borrows the
bridge of the window above it rather than proxying every call by message.
The Player side began as one window per column and was replaced within the session, for the
reason ARCHITECTURE.md gives. Entering and leaving NAVIGATE the one window rather than
replacing it, which is what carries its fullscreen across.
Measured before the build finished: a second column and its half cost 3-9% more memory on a
3840x2160 fixture, so the cheap-DM-window path (flat fog, a still frame) stays dropped.

### A column keeps its camera through every change of width · `SETTLED` (2026-09-11)
2.10.0 refitted a column whenever its width moved. That threw the DM's framing away three
times in one gesture: on the way into two columns, when the second map landed and moved the
split, and on every divider drag. A column now keeps its zoom and holds the map point that
was in the middle. Fitting on entry was considered and dropped on the same ground - the DM
presses Two maps while looking at the room a fight is in, not at the whole floor.
The DM window's own resize is unchanged and still leaves the map where it is. The Player
halves still refit, because a TV showing less of the floor after a bar moved in the DM's own
window is worse than a rescale.

### The ping is Ctrl+middle-click and a gold bezel · `SETTLED` (2026-09-29)
Right-click was free but was kept for a context menu later, and a plain middle-click pans, so the
ping takes Ctrl with the middle button and needs no tool. Rejected on look: plain rings (too
plain), a rune circle with glyphs and a star (it ties a map from any game to fantasy), a flare, a
target lock, embers and four water drops, one bending the map under its ripples. The bezel keeps
the rune's glow, ripples and sparks with ticks and four diamonds for symbols.
