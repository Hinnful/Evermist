# Architecture

A plain-language tour of how Evermist works, for anyone reading the code. It's a
client-side app with no server and no cloud database. Everything happens in two browser
windows running inside an Electron shell.

**Where to look for what.** This page explains how the app works and why it's shaped the
way it is. [CLAUDE.md](../CLAUDE.md) is the rulebook: the constraints you must obey when
changing something, written terse for an AI assistant. [DECISIONS.md](DECISIONS.md) is the
ledger of settled calls, including everything that was tried and rejected. If you're about
to redesign something, check there first.

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
| `index.html` | The entry point and page markup, and nothing else. The JavaScript here is just wiring: grab the canvases, start PixiJS, call each module's `init`, connect the lifecycle events. The styling is eight `<link>` tags. It was once a ~2400-line script plus a ~1370-line stylesheet, and a guard hook keeps either from creeping back. |
| `src/css/*.css` | All of the app's styling, split by the part of the screen it dresses: `base.css` (page reset, floating-panel shell, canvas layers, player mode), then `controlPanel.css`, `toolbar.css`, `roomCard.css`, `playerPane.css`, `legend.css`, `sceneManager.css`, `overlays.css`. They load in that order and it matters, because CSS is one shared cascade. |
| `renderer.js` | The PixiJS/WebGL wrapper. The GPU drawing path for the map and the DM's fog. |
| `render.js` | The render loop. Each frame it decides which layers actually changed and redraws only those, keeps the canvases sized to the window, and paints the cursor and polygon-selection overlay. |
| `state.js` | Shared values that several files need. Loaded first so they exist before anything reads them. |
| `fog.js` | Everything fog: the canvases that store what's hidden, the blur and cloud-texture math, and the reveal/hide logic. |
| `fogGeometry.js` | The pure fog math: polygon insetting, rounded paths, tint-colour derivation, animation timing. Plain functions in, values out, no drawing. Unit-tested. |
| `tools.js` | The drawing tools (brush, rectangle, circle, polygon) and polygon editing. |
| `input.js` | The DM's mouse and keyboard: painting with the tools, keyboard shortcuts, the legend toggle. |
| `undo.js` | Undo/redo history for fog edits. |
| `grid.js` | The grid overlay: squares or hexes, size/offset/colour, and line width that scales with zoom. |
| `scenes.js` | Auto-save loop, fog-load helpers, and the error-recovery path above the database layer. |
| `sceneManager.js` | Scene CRUD and the scene-manager UI: `switchScene`, `createNewScene`, rename, delete, thumbnails. |
| `sceneStore.js` | Saving and loading scenes to the browser's local database (IndexedDB). |
| `mapLoader.js` | Loading a map image into the app and driving the progress bar. Shared by scene-switching and backup restore. |
| `viewport.js` | Pan, zoom, pushing the camera to the Player window, and the auto-sync helper. |
| `minimap.js` | The DM's live preview of the Player camera, and the remote control that drives it. |
| `video.js` | Animated (video) map support: file loading, DOM compositing, decoding, the frame loop, the freeze watchdog. |
| `display.js` | Detecting the Player screen's real size so the fog and map render at the right resolution. |
| `backup.js` | The export/restore-to-zip feature. |
| `toolbar.js` | DM-only UI control wiring: toolbar buttons, sliders, fog colour picker, animation presets, scene and backup modals, Player controls, the UI-scale slider. |
| `controlPanel.js` | The tabbed Fog/Grid/Player control panel. A presentational layer over the older hidden controls. |
| `roomPanel.js` | The room card and the room name labels drawn on the DM map. |
| `moduleText.js` | Importing a published module's text and turning the room name field into a searchable dropdown over it. |
| `pdfLayout.js` | Turning a PDF's scattered text fragments back into reading order. Pure functions, unit-tested, no dependencies. |
| `pdfExtract.js` | Runs pdf.js in an isolated child process. No `<script>` tag: this one never loads in the browser. |
| `confirmDialog.js` | The app's own yes/no dialog. The only sanctioned confirmation, because native `confirm()` breaks the page. |
| `player.js` | Player-mode runtime: cloud-texture pre-generation, the handshake, the resize listener, the DM message handler, Player pan/zoom. |
| `stress.js` | A hidden stress-test harness for chasing video and memory bugs. Dormant unless the page is opened with `?stress=1`. |
| `main.js` / `preload.js` | The Electron shell. Creates the windows, saves video files to disk, reads and writes backup zips, forks the PDF parser. |

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
   live, including areas already shrouded.

5. **The DM sees through it, players don't.** On the DM screen the fog is semi-transparent
   so you can plan. On the Player screen it's fully opaque. This matters when judging any
   fog setting by eye: the DM window shows roughly half the density the TV does.

6. **A third state: half-shroud.** A room can be marked Half, which leaves it at partial
   fog density instead of clearing it. It's an absolute setting, not a partial erase: the
   room lands on the Half density whatever was there before, so marking a room the party
   has already walked through does dim it back down.

7. **The two windows draw fog differently, and that's on purpose.** The DM's fog is drawn
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
- The map image or video is sent as a **URL** rather than copied pixel by pixel, so opening
  the Player window doesn't double the memory used.
- **Auto vs Manual.** With Auto on, every change the DM makes appears on the TV instantly.
  With Auto off, the DM can prep the next reveal privately and push it with **Send** when
  the party is ready.
- **Sync View** snaps the Player's camera to match the DM's. The Player camera glides to
  new positions rather than jumping.

**The camera crosses the wire as a region, not a zoom level.** This is the part worth
understanding. If the DM sent "centre here, at 1.4× zoom", a bigger TV would show *more
map* than the DM sees, rather than the same map bigger. So the DM sends the rectangle of
the map he's looking at, in map units, and the Player fits that rectangle to its own screen.
Matching screen shapes land exactly edge to edge. Mismatched ones fit rather than crop, so
the players can never see less than the DM intended.

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

**Array order is fog compositing order.** The fog rebuild walks the room list in reverse, so
reordering the list silently changes what the fog looks like wherever shapes overlap. There
is no separate display order, and no room list UI to need one.

### The room card

Select a room and a floating card appears with its name, description, fog mode, and corner
radius. It stays open when you switch tools, so you can read a description while painting
fog.

Two things about it are load-bearing rather than polish. The card **floats over the map**, so
it will sometimes cover the very handles you selected the room by, and no automatic
placement rule wins that in general. So you drag it, and double-clicking its bar snaps it
back. And the description box is **resizable**, with its height remembered as one global
preference, because a box's height belongs to your screen rather than to a room.

Room names are also drawn on the DM map itself, sized relative to zoom and placed inside the
room's outline rather than at its bounding box corner, which is what makes circles and
heavily-rounded rectangles work without special cases. `L` toggles them.

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
- **The parsed text is campaign-level.** It lives in `localStorage`, not inside a scene and
  not inside a backup zip.

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
  thumbnails, and the actual map and video files.
- **Restore** reads that zip back and merges it into your current library rather than
  overwriting. If a name already exists you get a "Name (2)" style rename, so importing the
  same backup twice is safe.

The zip reading and writing happens in the Electron shell, driven by `backup.js` on the page.

## Why it's built this way

- **No frameworks, no build step.** Plain JavaScript loaded with `<script>` tags. This keeps
  it simple to run and means it works straight off the local filesystem (`file://`), which
  matters for an offline desktop app. It's also the reason ES modules are banned:
  `import`/`export` don't work on `file://`.
- **Separate canvases for map, fog, grid, and cursor.** Each is its own layer the GPU stacks
  together, so painting fog doesn't force the expensive map to redraw.
- **The code lives in `src/`, and `index.html` is only wiring.** The entry script was once a
  2400-line blob. A guard hook now blocks any edit that grows it, which is the only reason
  the rule has held.

---

Want the rules for changing any of this? [CLAUDE.md](../CLAUDE.md). Want to know whether an
idea was already tried? [DECISIONS.md](DECISIONS.md).
