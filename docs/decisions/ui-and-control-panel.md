# Decisions - UI and the control panel

Split out of [DECISIONS.md](../DECISIONS.md) so the main ledger stays readable. Same
question, same past tense: what was decided about the **DM's chrome** - the toolbar, the
control panel and its tabs, the scene library, the minimap's furniture and the dialogs -
and why it held.

The Player view has no UI at all, so nothing here reaches it. The layout and
button-identity rules that bind while editing this chrome are in the `dm-ui` skill; the
stylesheet cascade is in [src/css/CLAUDE.md](../../src/css/CLAUDE.md); how the panels are
wired is in [ARCHITECTURE.md](../ARCHITECTURE.md).

**Status tags** and the one-heading-one-paragraph budget are the main ledger's; read its
header before adding an entry here.

---

### The Fog/Grid/Player tabs left the panel, and the panel now shuts · `SETTLED` (2026-08-30)
The panel covered about 288 screen px of map on the DM's right edge, so a zoomed-in DM framed the
TV against a viewport narrower than the one the players saw. **Trimming the region sent to the
Player by the panel width stays reverted** - it crops the TV to the DM's readable area, so content
stops reaching the table. What ships instead: `#cp-tabbar` floats above `#sidebar-right` and never
hides, and picking the lit tab shuts the panel, which gives the strip back without touching the
region. An acceptance check compares `dmVisibleRegion()` open against shut so the trim cannot
return unnoticed.
Rejected on the way, all built or sketched first: a vertical icon rail (icons alone do not say
"fog" or "grid", and the rail left an empty column beside the open panel); a pane header carrying
the reset; and stretching the reset button to the selector's height, which made it a rectangle.

### The Animation and Grid Type rows carry no pill · `SETTLED` (2026-08-30)
The pane gives 207px. Five 30px icons plus a 30px reset button only fit with nothing boxing them,
so the two rows follow the bottom toolbar's rule that a group inside a bar has no box of its own.
Both come out 30px tall with no rule forcing it. Any pill around the icons costs icon size, which
is what makes the smaller variants worse rather than merely different.

### Reset asks rather than offering an undo · `SETTLED` (2026-08-30)
Reset lost its full-width red footer button when it moved beside the selector it resets, so the
shape no longer warns and `confirmDialog` does. The undo toast was considered and rejected: it
belongs to `sceneManager.js` and its button is wired to one fixed action, so sharing it means
extracting a module and rewiring scene deletion - more risk than the safety here needs.

### The UI scale slider is gone, and About moved into the legend · `SETTLED` (2026-08-30)
The slider set `--ui-zoom` from a bottom-left strip; that strip also held the two help buttons.
One button replaces all three: it opens the shortcut legend, and `about.js` now fills that
legend's footer instead of building a dialog of its own. `--ui-zoom` keeps its `base.css` default,
and the stored `evermist-ui-zoom` key is dead - a DM who had moved the slider returns to 120%.

### `window.open` reuses a Player window by NAME, and both directions bite · `SETTLED` (2026-08-30)
Every Player window is opened as `window.open(url, 'evermist-player')`, so a second call finds the
first by name and NAVIGATES it rather than creating one. Two live consequences, both found by
review after the pre-warm shipped. Warming a window while a Player is open re-navigates the live
one, so the TV reloads mid-session - `prewarmPlayer` refuses when `playerWindow` is open. And
warming one in the same tick as a close can land on the window still closing, leaving the warm
handle on a corpse and the next press paying the page load again - the close hands the dying
window over and the warming waits for it, bounded at two seconds.

### The landing card is the Player's loading state, not a hidden window · `SETTLED` (2026-08-30, replaced a hold)
Opening the Player used to put the app's own boot on the TV: the landing card carrying the app
name, then a flat navy cover, then the map. **Holding the window hidden until the map painted was
built first and rejected** - it removed the ugly part by removing the window, so the button had a
silent two-and-a-half-second wait behind it and nothing said the app was working. What ships
instead: the window goes up on the press, and the landing card stays on screen through the first
map's decode carrying a "Loading map…" line.
**`#landing.loading` sits at z-index 1000, ABOVE `#scene-fade` (999), and that is what makes it
work.** The cover has to stay opaque or the players see the map with no fog on it while `loadFog`
is still running; the card simply sits on top of it. ⚠ The rule is SCOPED to `.loading` and must
stay that way: the DM shows the same element when no scene is open, and unscoped it outranks the
scene library, the About box and every dialog.
Two things from the rejected version are kept because they are worth having on their own.
**Every Player window is created hidden** - `show: false` in `overrideBrowserWindowOptions` does
NOT work for a `window.open` child, so `did-create-window` hides it again - and `main.js` shows it
on the DM's `player-reveal`. That is what lets a window be pre-warmed at all.

**The Player's need-map retry starts on the DM's first message, never at init.** It runs for about
thirty seconds and used to start when the button was pressed, by which time a map had arrived and it
never fired. A pre-warmed window starts that clock long before the button, so the retry was still
running at adoption; the DM accepted the stale `need-map`, cleared `playerMapSent` and re-sent the
whole map mid-session, which reset the fog the players were looking at. It showed up as a shrouded
room reading fully clear on the TV, in one regression run out of five. Do not move the start back to
`initPlayer`.

A window is also **pre-warmed at DM startup and left hidden**, which takes the page load and the
blocking cloud-texture generation off the button. `playerWindow` deliberately stays null until the
button is pressed: adopting the warm window early would send every fog push, and pull every map,
into a window nobody opened. The cost is a second renderer process idle for the session. The map
is NOT pre-loaded into it, so what remains behind the button is the map's own decode - measured at
roughly 2.4-2.7s on an animated map on this machine.

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
