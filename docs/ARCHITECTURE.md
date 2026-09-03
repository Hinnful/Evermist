# Architecture

A plain-language tour of how Evermist works, for anyone reading the code. It's a
client-side app with no server and no cloud database. Everything happens in two browser
windows running inside an Electron shell.

**Where to look for what.** This page explains how the app works, in the present tense, and
nothing else. [CLAUDE.md](../CLAUDE.md) is the rulebook: the constraints you must obey when
changing something. [DECISIONS.md](DECISIONS.md) is the ledger of settled calls, including
everything that was tried and rejected - check there first if you're about to redesign
something, along with its topic files in [decisions/](decisions/). [PRODUCT.md](PRODUCT.md)
says what the app is for and what it will never do.

A sentence here that explains *why* belongs in one of those. This page says what is.

## The big picture

There is **one** HTML file, `index.html`. It serves both screens:

- Open it normally, and you get the **DM window** with all the controls.
- Open it with `?mode=player`, and you get the **Player window**: no buttons, no cursor,
  just the map. The DM window opens this automatically.

The map is drawn on the GPU with **PixiJS** (WebGL), which is what lets a 10000×6000 map
pan and zoom smoothly. The fog, grid, and cursor are drawn separately and stacked on top.

## The files

| File | What it does |
|------|--------------|
| `index.html` | The entry point and page markup, and nothing else. The JavaScript here is just wiring: grab the canvases, start PixiJS, call each module's `init`, connect the lifecycle events. The styling is nine `<link>` tags. It was once a ~2400-line script plus a ~1370-line stylesheet, and a guard hook keeps either from creeping back. |
| `src/css/*.css` | All of the app's styling, split by the part of the screen it dresses: `base.css` (page reset, the floating-panel surface every control shares, canvas layers, player mode), then `controlPanel.css`, `toolbar.css`, `roomCard.css`, `playerPane.css`, `legend.css`, `sceneManager.css`, `about.css`, `overlays.css`. They load in that order and it matters, because CSS is one shared cascade. |
| `renderer.js` | The PixiJS/WebGL wrapper. The GPU drawing path for the map and the DM's fog. |
| `render.js` | The render loop. Each frame it decides which layers actually changed and redraws only those, keeps the canvases sized to the window, and paints the cursor and polygon-selection overlay. |
| `state.js` | Shared values that several files need. Loaded first so they exist before anything reads them. |
| `fog.js` | Everything fog: the canvases that store what's hidden, the blur and cloud-texture math, and the reveal/hide logic. |
| `fogGeometry.js` | The pure fog math: polygon insetting, rounded paths, cone vertices, door placement and notch geometry, shared-wall detection, tint-colour derivation, animation timing. Plain functions in, values out, no drawing. Unit-tested. |
| `vttPlan.js` | Turns a Universal VTT floor plan's wall segments into room polygons, and reports where its openings sit. Pure geometry, no dependencies, unit-tested. |
| `roomOps.js` | Reshapes rooms already on the map: joins the ones a drawn shape overlaps into one, trims a drawn shape out of them, and cuts one room into two along a clicked path. Wraps the vendored `polygon-clipping` library and answers with vertex lists or a refusal reason, never a throw. Unit-tested. |
| `floorPlan.js` | The app side of that: finding the plan beside the map, the offer notice, setting Grid Size from the plan at import, and drawing the rooms and their doorways. |
| `tools.js` | The drawing tools (brush, rectangle, circle, cone, polygon), the Door tool, and polygon editing. The cone is drawn apex-first - press at the point of origin, drag towards where it points - and commits as an ordinary polygon with a shallow arc on its far edge, so nothing downstream knows a cone from any other shape. |
| `input.js` | The DM's mouse and keyboard: painting with the tools, keyboard shortcuts, the legend toggle. |
| `undo.js` | Undo/redo history for fog edits. |
| `effects.js` | Map effects - burning ground, and the materials to come. Each is a polygon carrying a material name, drawn under the fog on both screens as a flaming border: the outline burns inward with dissolving tongues over a faint fill, with sparks, smoke and haze. Rendered by a fragment shader over the polygon's own distance field, in two PixiJS meshes per effect - an additive pass for the light (fire, fill, sparks) and a normal-blend pass for the darkening (smoke, haze). Owns the `effects` array's model and that render path. The look is a fixed set of numbers in the module with no UI over it. (The ember relight of the map grid inside a zone lives in `grid.js`.) |
| `grid.js` | The grid overlay: squares or hexes, size/offset/colour, and line width that scales with zoom. Also the one place a grid change is committed from - redraw, push to the Player, save onto the scene - and what grid a freshly imported map starts with. Relights the grid in ember inside each effect zone (`drawEffectGridGlow`), because the map grid draws on a canvas above the effect layer. |
| `scenes.js` | Auto-save loop, fog-load helpers, and the error-recovery path above the database layer. |
| `sceneManager.js` | Scene CRUD and the scene library: `switchScene`, `createNewScene`, rename, delete, thumbnails, and the loop that imports a whole selection of maps one at a time. The library is a popup over the map, with a find field, group headings you drag cards into, and a contextual bar that replaces the header while anything is selected. |
| `sceneGroups.js` | Groups in the scene library. A group is a name a scene carries, so the scene's own `group` field is the only record of what is filed where; this file keeps the order the headings appear in, which ones are collapsed, and a heading made before anything was dragged into it. |
| `sceneStore.js` | Saving and loading scenes to the browser's local database (IndexedDB). Changing one field of a scene the app is not currently showing goes through `updateScene`, which reads and writes in one transaction so an autosave cannot land between the two and lose a fog reveal. |
| `mapLoader.js` | Loading a map image into the app and driving the progress bar, including the batch label a multi-map import puts on it. Shared by scene-switching and backup restore. |
| `mapConvert.js` | Asking whether to shrink an oversized animated map at import, and re-encoding it if the answer is yes. Pure box-fitting maths plus the recorder that drives it. |
| `viewport.js` | Pan, zoom, pushing the camera and the map to the Player window, and the auto-sync helper. Also the Player window's own life: one is prepared in the background at startup and waits hidden, and pressing the button adopts it and asks the shell to show it. |
| `minimap.js` | The DM's live preview of the Player camera, and the remote control that drives it. |
| `video.js` | Animated (video) map support: file loading, DOM compositing, decoding, the frame loop, the freeze watchdog. |
| `display.js` | Detecting the Player screen's real size so the fog and map render at the right resolution. |
| `backup.js` | The export/restore-to-zip feature. |
| `toolbar.js` | DM-only UI control wiring: toolbar buttons, sliders, fog colour picker, animation presets, the scene dropdown, Player controls. Also the Rooms/Effects placement switch, the New/Join/Trim group and the material picker. The row above the toolbar changes with both - `input.js`'s `updateContextPanels` owns every visibility decision in it. |
| `controlPanel.js` | The Fog/Grid/Player control panel and the tab bar above it. A presentational layer over the older hidden controls. The tab bar sits outside the panel and never hides; picking a tab opens the panel on that pane, picking the same tab again shuts it, and the open pane is remembered between sittings. |
| `roomPanel.js` | The room card and the room name labels drawn on the DM map. |
| `moduleText.js` | Importing a published module's text and turning the room name field into a searchable dropdown over it. |
| `pdfLayout.js` | Turning a PDF's scattered text fragments back into reading order. Pure functions, unit-tested, no dependencies. |
| `pdfExtract.js` | Runs pdf.js in an isolated child process. No `<script>` tag: this one never loads in the browser. |
| `confirmDialog.js` | The app's own dialogs: a yes/no question, and a one-button message for errors. The only sanctioned pair, because a native `confirm()` or `alert()` breaks the page's focus. One shows at a time; a second waits its turn rather than replacing it, so no question is dropped unanswered. |
| `about.js` | The About block: the app mark, the version number and the repo address. Builds its own markup rather than adding any to `index.html`, and fills the shortcut legend's footer, so one button opens both. DM only. |
| `player.js` | Player-mode runtime: cloud-texture pre-generation, the handshake, the resize listener, the DM message handler, Player pan/zoom. |
| `stress.js` | A hidden stress-test harness for chasing video and memory bugs. Dormant unless the page is opened with `?stress=1`. |
| `memProbe.js` | A hidden memory probe: counts what one loaded map costs and writes it to the diagnostics log. Dormant unless the page is opened with `?memprobe=1`. |
| `main.js` / `preload.js` | The Electron shell. Creates the windows, saves video files to disk, reads and writes backup zips, forks the PDF parser, finds a map's floor plan, and reports the app's own version number. |

## Bringing an animated map in

A still map arrives, gets decoded, and that's the end of it. An animated map is a different
proposition: it costs a video decoder in every window that shows it, for as long as the scene is
open, and that is comfortably the heaviest thing the app does. A Dungeon Alchemist export runs
13 to 20 megapixels, several times what any table television can show.

So there's a **Compression** switch at the bottom of the scene list. With it on, any animated map
larger than 3840×2160 is re-encoded on import to fit that box - twice a 1080p TV, and under the
4096-pixel ceiling where a laptop's built-in graphics stop decoding video in hardware and fall
back to the processor. A map already inside the box is stored exactly as it arrived.

It is off until switched on, and it replaces what the app stores rather than keeping both. The
cost is time: re-encoding runs at the speed the map plays, so a thirty-second map takes about
thirty-five seconds behind a progress bar that says what it's doing. Everything about the
conversion happens in the browser engine the app is already built on - nothing is bundled for it.

Two things it deliberately won't do. It won't touch maps already saved, or maps restored from a
backup zip, because their rooms are recorded in the old map's pixel space and would end up in the
wrong place. And it never asks per map: the machine doing the importing is usually not the
machine that has to play the result, so a question at import is asked of the wrong computer.

**What the DM window keeps for an animated map is nothing.** The map is the video element itself,
handed to the browser's own compositor - the same path a media player uses, with no copying per
frame. The graphics layer holds no picture of the map at all on that side, which is the
counterpart to the Player's one-screen patch described below.

## Bringing in a folder of maps

Select ten maps in the file dialog, or drag them onto the window together, and they import one
after another - never overlapping, because two maps decoding at once is how a video import lands
on top of the one still being saved. The progress bar says which map of how many is going through
and names it, over the top of whatever that map is doing at the time.

You land on the first map of the batch, not the last, so a run of ten leaves you where you started
reading rather than at the far end. A clean run ends silently. A run with a casualty ends in one
message naming exactly what did not make it, and nothing interrupts mid-run to ask about a single
bad file - the alternative is an unattended import stopping on map three and waiting all evening.
One unreadable map costs that map and nothing else.

Close the app halfway through and the maps that finished are there. The rest simply never existed.

A backup zip is the exception: on its own it still restores the library, but one sitting inside a
multi-file selection imports nothing at all and says why. Restoring adds to the library rather than
replacing it and carries the module text, of which the app holds one - so it is a question, and a
question in the middle of a run nobody is watching is the thing this feature exists to avoid.

## How the fog works

The fog is the heart of the app, so it's worth understanding.

1. **A low-res hidden/revealed map.** Behind the scenes there's a small canvas, a quarter of
   the map's size for speed, that records one thing per pixel: is this spot **hidden**
   (navy) or **revealed** (transparent)? Painting with the brush or dropping a reveal shape
   edits this canvas.

2. **Two sources, combined.** Brush strokes are kept on one layer. The reveal/hide shapes
   (rectangles, polygons) are kept as editable objects. The final hidden/revealed map is
   those two combined. Keeping shapes as objects is why you can re-select and edit a room
   you carved out earlier.

3. **Making it look like fog rather than a stencil.** That hard-edged map is blurred and
   overlaid with a drifting **cloud texture** (procedural noise). This is the "living fog":
   soft edges and slow motion instead of a flat black cutout. The texture doesn't only slide
   across the screen, it also slowly changes shape, which is what stops the fog reading as one
   repeating pattern on a conveyor belt.

4. **Any colour you want.** The cloud texture itself is neutral grey. The colour comes from
   a base fill plus a glow tint picked in the Fog panel, so the same fog can be
   dungeon-navy, blood-red, or swamp-green. Each scene remembers its own colour, and the
   choice rides along through Export/Import. Picking a new colour recolours everything
   live, including areas already shrouded, and on the Player it also recolours the area
   around the map, so the map does not sit in a differently coloured surround.

5. **The DM sees through it, players don't.** On the DM screen the fog is semi-transparent
   so you can plan. On the Player screen it's fully opaque. This matters when judging any
   fog setting by eye: the DM window shows roughly half the density the TV does.

6. **A third state: half-shroud.** A room can be marked Half, which leaves it at partial
   fog density instead of clearing it. It's an absolute setting, not a partial erase: the
   room lands on the Half density whatever was there before, so marking a room the party
   has already walked through does dim it back down.

7. **The fog is also what covers a scene switch.** Changing scenes on the TV isn't a screen
   fading to black and back. The fog closes over the map the party is looking at, holds while
   the next map loads, then clears off the new one - about seven seconds end to end. While it
   is fully closed nothing is revealed at all, which is what lets the map underneath change
   size, shape and camera without anything showing. Two things ride the closing half so they
   never happen in open view: the new scene's fog colour, which crosses while the fog thickens,
   and the cloud texture, which holds its size and position across the swap instead of
   resizing to the new map. Nothing is written on screen during a switch - the scene's name was
   shown there for a while and was taken back out.

8. **The two windows draw fog differently, and that's on purpose.** The DM's fog is drawn
   on the GPU with PixiJS. The **Player's fog is drawn on top of the map with the regular
   2D canvas.** When the Player's fog was done on the GPU, a faint seam appeared at the
   edge of animated maps. Drawing one continuous layer over the whole window makes the seam
   impossible. See [DECISIONS.md](DECISIONS.md) for the full story.

## How the render loop works

Everything the app draws rides **one clock**: the PixiJS ticker.

Each layer has a dirty flag. When you pan, the viewport is marked dirty; when you paint,
the fog is marked dirty. Once per tick, `doRender` looks at the flags and redraws only what
changed, which is why painting fog doesn't force the expensive map layer to redraw.

The part that's easy to get wrong: `doRender` is registered **on the PixiJS ticker itself**,
at a priority above Pixi's own render, rather than running its own animation loop. Two
independent loops at the same frame rate drift out of phase, and the Canvas-2D layers start
leading the WebGL map, which looks like the grid sliding against the map during a pan. One
clock keeps them registered to each other.

The frame rate is capped at 30fps. There's no user-facing control for this. A tabletop map
doesn't need 60, and the TVs barely support it.

## How the two windows stay in sync

The DM window is the boss. The Player window follows.

- They talk via **`postMessage`**, the standard browser way for two windows to send each
  other messages. The DM sends things like "here's the new fog", "the camera moved here",
  "switch to this map".
- **The Player window exists before it is opened.** One is built a couple of seconds after the
  DM starts and waits out of sight, so pressing Open Player has no page load behind it. The DM
  ignores that waiting window until the button is pressed, so nothing is sent to it and no map
  is pulled into it.
- **The window goes up straight away, showing the app's own landing card** over a full screen of
  drifting fog, and swaps to the map when it has decoded. The fog is the real thing - the same
  cloud texture and the same drift the map's fog uses - so the players see a title card rather
  than the app starting up.
- The map image or video is sent as a **URL** rather than copied pixel by pixel, so opening
  the Player window doesn't double the memory used.
- **Auto vs Manual.** With Auto on, every change the DM makes appears on the TV instantly.
  With Auto off, the DM can prep the next reveal privately and push it with **Send** when
  the party is ready.
- **Sync View** snaps the Player's camera to match the DM's. The Player camera glides to
  new positions rather than jumping.
- The Player reports a few things back, so DM controls can show what is actually true rather
  than what was last asked for: its screen size, whether it has been panned away from the
  DM's camera, and whether it is fullscreen. Fullscreen is the odd one - it is the window
  going fullscreen rather than the page, so only the app shell can see it, and it travels
  shell → Player → DM.

**The camera crosses the wire as a region, not a zoom level.** This is the part worth
understanding. If the DM sent "centre here, at 1.4× zoom", a bigger TV would show *more
map* than the DM sees, rather than the same map bigger. So the DM sends the rectangle of
map it is looking at, in map units, and the Player fits that rectangle to its own screen.
Matching screen shapes land exactly edge to edge. Mismatched ones fit rather than crop, so
the players can never see less than the DM intended.

### What the Player keeps in memory

The Player doesn't hold a copy of the whole map to draw from. It holds one screen's worth.

This matters on animated maps. The Player has to redraw its map picture from the video and
hand it to the graphics card on every frame, so the size of that picture is a cost thirty
times a second, not just a cost once. Sized to the whole map, a large animated map meant
pushing 91MB to the card on every frame. Now it's the size of the Player's own
screen plus a small margin, holding only the patch of map the camera is over, at one picture
pixel per screen pixel. That's about 15MB on a 1440p TV whatever the map's resolution, and
the same figure is what crosses to the card each frame.

The patch is recomputed every frame from the camera, so it can't go stale, and it's always
sized so one pixel lands on one pixel. The map stays as sharp when you zoom in as it was
before.

The piece that makes it safe: the patch always lands on exactly the same rectangle of the
screen, whatever the pan and zoom. The fog is drawn separately on top, in screen
coordinates, so anything that shifted the map by a fraction of a pixel against the fog would
show up as a bright or dark rim along the map's edge. Holding that rectangle still is what
prevents it.

The clip itself is still loaded the expensive way. The Player can't read the same file the DM
window is reading, because two video players on one file starve each other and both freeze, so
it loads a whole private copy of the clip into memory - 280MB on the largest map. A streaming
replacement was built and measured, and it saved the memory without making anything faster, so
it was taken back out.

### The minimap

The DM's right column carries a small live preview of what the Player camera is framing,
and dragging or scrolling it **drives** the TV. It's a remote control rather than a second
independent camera: it feeds the same camera message the Player already listens for.

One thing to know before trusting it: **the preview is deliberately wider than the TV.** It's
a square canvas showing extra context around the Player's frame, and the actual TV is only
the band between the two dotted lines. At a 16:9 Player, roughly a third of the preview's
height is padding. It's a rough sketch for aiming, not evidence of what the players see.

## Rooms

A "room" is a polygon the DM draws on the map. It carries a fog mode (Revealed, Half, or
Shrouded), an optional name and description, and optional per-corner rounding.

Rooms are DM-only, and that comes for free rather than by enforcement: fog crosses to the
Player as flattened pixels, so the polygon list never leaves the DM window. There's no
channel to strip and no risk of leaking a room's notes to the TV.

**Selecting a room is the Select tool's job alone.** The other tools keep drawing new rooms
when you click, including ones that overlap or nest inside existing ones.

Two toggles at the right-hand end of the toolbar help the drawing land where you meant. **Snap
to grid** pulls each corner onto the nearest grid intersection. **Straighten walls** pulls a
corner level with the one before it when it's already nearly level, so a wall comes out square
without a steady hand - it's an alignment nudge, not a lock, so a wall you genuinely want
diagonal stays diagonal. It works while dragging a corner of a finished room too. Neither
setting is saved; both are off when the app starts.

**Array order is fog compositing order.** The fog rebuild walks the room list in reverse, so
reordering the list silently changes what the fog looks like wherever shapes overlap. There
is no separate display order, and no room list UI to need one.

### Repairing a room

The floor-plan import draws most rooms correctly, and the rest need fixing rather than redrawing.
Three repairs cover it, and none of them asks you to select anything first: you pick what the
next shape should do, then draw it over the rooms you mean.

**Join** unions the shape you draw with every room it lands on, so one rectangle straddling two
rooms leaves one room. The result keeps the name and notes of the earlier of the two, and takes
the *most hidden* fog mode of the pair - joining a revealed room to a shrouded one gives a
shrouded room, so a repair can never uncover ground on the TV by accident. **Trim** subtracts the
shape instead. One rectangle over a wall cuts a notch; one drawn clean across a room splits it in
two; one covering a room whole deletes it. **Cut** takes a clicked path rather than a shape: the
room becomes two rooms whose edges touch exactly, with no strip removed between them. That
distinction matters in a cave, where a Trim strip would leave a fogged line across open rock.

All three are one undo step, save with the scene, and reach the Player like any other room,
because a room's outline *is* the fog stencil. Two things are dropped rather than carried over:
per-corner rounding and door marks, both of which are stored by position in the corner list, and
a repair renumbers every position.

A repair that cannot produce a valid room refuses and changes nothing, with the reason on screen.
There are three such cases: the result would have a hole in it, which a room cannot store; the
clipping maths failed; or a cut path did not enter and leave the room exactly once each. Pieces
smaller than one grid square are discarded rather than kept as slivers.

The geometry lives in `roomOps.js` over the vendored `polygon-clipping` library, and is unit
tested against rooms derived from a real Dungeon Alchemist cave export rather than against
rectangles alone.

### Doors

A revealed room reads as a sealed box: its outline is what the players see from across the table,
and a rectangle with no break in it says there is no way out. A door fixes that by changing the
outline. It is a notch of cleared fog one grid square wide, straddling the wall so it reads as a
gap punched through it rather than a bump on the room.

Pick the **Door** tool and click a wall. The click snaps to the grid cell it landed in, so every
door is the same size and lands on the same lines as the squares. Clicking the same cell again
closes it; clicking the cell beside it opens a ten-foot doorway. While the tool is picked the grid
draws on the DM screen even if it is switched off, and every wall carries a tick at each cell
boundary, which is the only way the cells of a diagonal wall are predictable.

A door stores nothing but which wall it is on and where along it. Width and depth come from the
scene's grid cell when it is drawn, so correcting a grid resizes every door already placed instead
of forcing a redraw. Two percentages under the tool set them, at 100% and 10% of a cell by default.

A door belongs to a room, so it appears only when that room does. Its density, though, is the most
revealed of every room whose wall runs through it - which stops the choice of owner mattering on a
wall two rooms share, and gives half-shroud an answer. Doors reach the Player for free: they are
cut into the same fog stencil that crosses to the TV.

### The room card

Select a room and a floating card appears with its name, description, fog mode, and corner
radius. It stays open when you switch tools, so you can read a description while painting
fog. **Drawing a room doesn't open it** - a new room is created with nothing selected, so the
card can't cover the map while you draw the next one. Naming is a second pass with Select.

Two things about it are load-bearing rather than polish. The card **floats over the map** and
places itself clear of the whole room, not just its centre: the first of above, below, right
or left that the room's outline leaves free. It holds still while you drag a vertex or an
edge, so it can't hop sides mid-edit, and re-places once when you let go. If a room leaves no
gap big enough anywhere, the card hugs the viewport edge furthest from it - you can always
drag it, and double-clicking its bar sends it back. And the description box is **resizable**,
with its height remembered as one global preference, because a box's height belongs to your
screen rather than to a room. That height is also what decides whether a big room has room
for the card beside it.

Room names are also drawn on the DM map itself, sized relative to zoom and placed inside the
room's outline rather than at its bounding box corner, which is what makes circles and
heavily-rounded rectangles work without special cases. `L` toggles them.

### Drawing the rooms from the map's own floor plan

Dungeon Alchemist writes a `.dd2vtt` floor plan beside every map it exports: wall segments,
doors and windows, light sources, and the grid calibration, all as vector data. So the rooms
don't have to be traced by hand or guessed at from pixels - they're already in a file.

Dropping a map asks the Electron shell whether a plan sits beside it. That question is asked
**first, before anything else touches the file**, for two reasons: the map is about to be copied
into the app's own folder and will no longer have a sibling to find, and if the map gets
compressed on the way in, the file that arrives at the far end was built in memory and has no
place on disk to look beside at all. A notice then appears with the room count, and Draw Rooms
in the Fog tab stays available for later.

The plan's coordinates are in the pixel space of the export it was written beside, so the rooms
are scaled onto whatever size the map actually is before they're drawn. Without that step a
compressed map would get rooms half again too large - correctly shaped, sitting in the wrong
place, with nothing to indicate anything went wrong.

**Draw Rooms also marks the doorways.** The plan lists every opening in the walls, but it does not
say which are doors, which are windows and which are the way out of the building. What separates
them is what stands either side: an opening on a wall two rooms share is a doorway between them,
and one with a room on a single side is a window or an outside entrance. Only the first kind gets a
door, so a plan with ten to fifteen internal doorways stops being ten to fifteen clicks. A derived
door is the same thing a click makes, so it takes the same size dials, comes off with one click,
and is saved with the scene.

**The plan also sets Grid Size**, which used to mean typing the export's DPI in by hand and
guessing after a map had been compressed. The plan says how many squares wide the map is, the map
says how many pixels wide it is, and dividing one by the other is the answer - which stays right
whatever happened to the map's resolution on the way in. It happens once, when the map first
arrives; pressing Draw Rooms later never moves a grid that has been adjusted since. Grid offset is
still yours to nudge, because a plan can declare its own origin and a correctly-sized grid can
still sit half a square out of phase.

The geometry is five steps and lives in `vttPlan.js`, entirely separate from the app. Wall
segments are unioned with the portals that fill their gaps, because walls alone have a hole at
every opening and are not a closed plan. Edges are split where one wall meets another
mid-span. Then the enclosed faces are walked, and each is classified by which direction it
winds: one way is a room, the other is the outline of the whole building.

Two properties are deliberate. **Coordinates are grid squares, not pixels**, so every
tolerance is resolution-independent. And a room whose wall has a gap gets bridged only if the
two loose ends are each other's nearest feature and close enough to be no coincidence;
anything wider is refused rather than invented, because a confidently wrong room costs more
than a missing one. Two ends that pick each other are allowed to reach twice as far as a
single end reaching for a wall, since they are far better evidence of a wall that was once
whole.

**Cave maps need one more idea: telling a room from solid rock.** A cave is drawn with walls
exactly like a building, so a boulder standing in a cavern encloses a face and looks like a
small room, while the cavern itself encloses a huge one that wraps around every building
inside it. The signal that separates them is the doorway. A real room always reaches
somewhere, so its walls arrive as an open chain that closes only once the doorways are filled
in; a rock closes on itself with no door anywhere. Anything bounded by a doorless wall is
refused, which drops the cavern and the rocks together with no size limit to tune.

That test is also applied *before* gaps are bridged, because rock must never be a target. A
room whose whole side opens onto a cave has a loose wall end at each side of the mouth, and
the nearest thing to each is the cave wall a few feet away, not its real partner across the
opening. Left alone, both ends glue themselves to the cave, close nothing, and the room is
swallowed into the cavern.

What a cave map cannot give is the cave's own chambers. They are one continuous space with no
wall between them, so nothing in the file says where one ends. Splitting the cavern polygon by
hand is the intended route.

## Reading a published module

The biggest prep cost for a DM isn't typing a room description, it's finding the room in a
400-page book eighty times. So the app reads the book once.

Point it at a published module (`.txt` or `.pdf`), and it parses out the numbered locations:
`K12. The Chapel`, and so on. After that the room card's name field becomes a **searchable
dropdown** over those entries. Pick one, and it fills the name and the description together.
A counter shows how many are placed, because a finite shrinking list is a different
psychological object than an open-ended chore.

Some things this deliberately doesn't do:

- **It never auto-assigns.** A module has sub-locations, where one heading covers several
  rooms on the map, so any automatic 1:1 mapping desyncs within a few rooms. Only the DM
  knows which blob on the map is K12, and that one choice per room is irreducible.
- **It never talks to a network or an LLM.** The app has to keep working offline from a
  local file, and a stranger who downloads the `.exe` has to get the full value with nothing
  else installed.
- **The parsed text is campaign-level.** It lives in `localStorage` rather than inside a
  scene, because one book serves every map in a campaign. It does ride in a backup zip, as
  one entry for the whole campaign rather than a copy per scene.

**PDFs get parsed in a separate isolated process.** A module is an untrusted file and pdf.js
is a large parser, so it runs somewhere with no access to the filesystem helpers, the
dialogs, or any window. The parse is forked per import and killed as soon as it answers.

The parser itself is full of rules that look arbitrary and aren't. Every one of them exists
because a real 255-page book broke the previous version. Read them in CLAUDE.md before
touching the parser, and read the method warning in DECISIONS.md before trusting a green
test suite: synthetic fixtures validated the wrong parser twice.

## Backing up your maps

Everything you make lives in the browser's local database, and for video maps, on disk next
to the app. That's fast but tied to one machine, so there's a backup feature for moving
between PCs.

- **Export** bundles the scenes you pick into a single `.zip`: the fog, the polygons, the
  thumbnails, and the actual map and video files. The imported module text goes in too, once
  for the whole campaign rather than once per scene.
- **Restore** reads that zip back and merges it into your current library rather than
  overwriting. If a name already exists you get a "Name (2)" style rename, so importing the
  same backup twice is safe.
- **The module text is adopted last**, after every scene is safely saved. If a module is
  already loaded, the app asks which one to keep and names both; if there is no room left in
  storage for it, the scenes still restore and the app says the text didn't. A zip written
  before this existed carries no module text and restores exactly as it always did.

The zip reading and writing happens in the Electron shell, driven by `backup.js` on the page.
`moduleText.js` owns the module-text format at both ends: `backup.js` asks it for a payload
and hands one back, and never touches storage itself.

## How the app tests itself

Two things, answering different questions.

**The unit tests** (`npm test`) cover arithmetic and geometry: fitting a map inside a box,
insetting a polygon, turning a floor plan's walls into rooms, putting a PDF's text back in
reading order. Plain functions, values in and values out. Nothing that touches the screen.

**The rig** (`npm run rig`) covers everything the running app has to be looked at to know.
It starts the real app the way you do, waits for it to finish loading, then drives it from the
outside over the Chrome DevTools Protocol: import a map, flip a switch, open the Player window,
reveal an area. Then it reads back what actually happened and prints one line, PASS or FAIL.
About ten seconds start to finish.

Driving the app's *own* Electron shell is the point. An earlier harness stood up a second shell
of its own, which meant none of the file-handling existed and half the app died on a missing
handler the moment it touched disk. It also could not see the Player window at all, so the
app's central promise, that what the DM reveals is what the table sees, had never been checked
by anything but a person.

- Each run gets a throwaway copy of the app's storage under the system temp folder, so a test
  can import maps and restore backups without ever touching your real library.
- The test maps are drawn and recorded by the app itself at the start of a run, so nothing
  binary is stored in the project and no real map has to be pointed at.
- Every acceptance scenario runs on an **animated** map, because that is the only kind you
  use. The suite used to run on still images, which meant it proved the app worked in a
  case that never happens and said nothing about the one that always does. The two are
  genuinely different inside: your window hands the video to the browser to draw, the
  Player has to repaint its picture from it every frame, fog lies over a moving image,
  and panning moves the video rather than the graphics layer. A clip is recorded once
  per run and shared, so covering the real case costs seconds, not minutes.
- Screenshots, generated maps and the throwaway storage all stay out of the project folder.
- `tools/` ships in the repository but not inside the installer, so none of this reaches you.
- A run no longer takes the machine. Both windows are parked off the side of the screen and
  keep drawing there, so you can carry on working while one is going. `--visible` leaves them
  on screen when you want to watch.

Three tiers: a **smoke** set that always runs, one **acceptance** file per feature whose pass
criteria are written in plain English at the top of the file, and the **regression** pass,
which is every acceptance file together. A criterion that can only be judged by eye stays in
the file and is reported as unchecked rather than quietly dropped.

An acceptance file covers one whole feature and ends at the Player window. It opens with the
feature's goal in a sentence - "the DM draws a shape with any tool, in any fog mode, and the
players see the result" - and every check either serves that sentence or does not belong. The
many combinations a feature allows are swept on the DM, where they are cheap; the Player is
then checked once per distinct outcome, because everything crosses to it through one message
and checking each combination there would prove the same delivery over and over.

Two things keep the rig from being a tool nobody remembers. Editing anything the app ships now
raises a one-line reminder if no scenario moved with it, which is a hint and not a refusal -
plenty of changes genuinely need no new scenario. And a scenario is only believed once it has
been made to **fail**: the code under it is deliberately broken, the failure is read to check it
names the right thing, and the code goes back. One written after the code it covers has only
ever seen a pass, which is not the same as working.

## How it's put together

- **Plain JavaScript in `<script>` tags.** No framework, no bundler, no build step, and no ES
  modules. The app runs straight off the local filesystem.
- **Separate canvases for map, fog, grid, and cursor.** Each is its own layer the GPU stacks
  together, so painting fog doesn't force the expensive map to redraw.
- **The code lives in `src/`, and `index.html` is only wiring.** A guard hook blocks any edit
  that grows the inline script.

---

Rules for changing any of this: [CLAUDE.md](../CLAUDE.md). Whether an idea was already tried:
[DECISIONS.md](DECISIONS.md). Whether it belongs in the app at all: [PRODUCT.md](PRODUCT.md).
