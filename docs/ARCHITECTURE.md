# Architecture

A plain-language tour of how Evermist works, for anyone reading the code. It's a
client-side app — no server, no database in the cloud. Everything happens in two
browser windows running inside an Electron shell.

If you want the exhaustive, every-edge-case version, that lives in
[CLAUDE.md](../CLAUDE.md) (it's written for an AI coding assistant, so it's dense).
This page covers the two things people actually wonder about: **how the fog is
drawn** and **how the two windows stay in sync**.

## The big picture

There is **one** HTML file, `index.html`. It serves both screens:

- Open it normally → you get the **DM window** (all the controls).
- Open it with `?mode=player` → you get the **Player window** (no buttons, no
  cursor, just the map). The DM opens this automatically.

The map itself is drawn on the GPU with **PixiJS** (WebGL) — that's what lets a
10000×6000 map pan and zoom smoothly. The fog, grid, and cursor are drawn
separately and stacked on top.

## The files

| File | What it does |
|------|--------------|
| `index.html` | The entry point and page markup. The JavaScript here is now just wiring — grab the canvases, start PixiJS, call each module's `init`, and connect the lifecycle events. (It was once a ~2400-line monster; that code now lives in the `src/` files below. A guard hook keeps it from creeping back.) |
| `renderer.js` | The PixiJS/WebGL wrapper. The GPU drawing path for the map and the DM's fog. |
| `render.js` | The render loop. Each frame it decides which layers actually changed and redraws only those, keeps the canvases sized to the window, and paints the cursor + polygon-selection overlay. |
| `fog.js` | Everything fog: the canvases that store what's hidden, the blur + cloud-texture math, and the reveal/hide logic. |
| `fogGeometry.js` | The pure fog math — polygon insetting, rounded paths, tint-color derivation, animation timing. Plain functions in, values out, no drawing. It's the part that has unit tests. |
| `tools.js` | The drawing tools — brush, rectangle, circle, polygon — and polygon editing. |
| `input.js` | The DM's mouse and keyboard: painting with the tools, keyboard shortcuts, and the legend toggle. |
| `undo.js` | Undo/redo history for fog edits. |
| `grid.js` | The grid overlay — squares or hexes, size/offset/color, and line width that scales with zoom. |
| `scenes.js` | Auto-save loop, fog-load helpers, and the error-recovery path that sits above the database layer. |
| `sceneManager.js` | Scene CRUD and the scene-manager UI — `switchScene`, `createNewScene`, `initScenes`, `renderSceneManager`, rename, delete, and thumbnail generation. |
| `sceneStore.js` | Saving and loading scenes to the browser's local database (IndexedDB). |
| `mapLoader.js` | Loading a map image into the app and driving the progress bar. Shared by scene-switching and backup restore. |
| `viewport.js` | Pan, zoom, pushing the camera to the player window, and the auto-sync helper. |
| `video.js` | Animated (video) map support — file loading, DOM compositing, decoding, the frame loop, and the freeze-watchdog. |
| `display.js` | Detecting the player screen's real size so the fog and map render at the right resolution. |
| `state.js` | Shared values that several files need (loaded first so they exist before anything reads them). |
| `backup.js` | The export/restore-to-zip feature (see "Backing up your maps" below). |
| `toolbar.js` | DM-only UI control wiring: toolbar buttons, brush/grid/fog sliders, fog color picker, animation presets and advanced sliders, polygon context panel, scene/backup modals, player-window controls, section collapse, and the UI-scale slider. |
| `player.js` | Player-mode runtime: cloud-texture pre-generation, PLAYER_READY handshake, resize listener, DM message handler (map/fog/anim/scene-transition/view-snap/fullscreen), and player pan/zoom. |
| `stress.js` | A hidden stress-test harness for chasing video and memory bugs. Dormant unless the page is opened with `?stress=1`. |
| `main.js` / `preload.js` | The Electron shell — creates the windows, handles saving video files to disk, and reads/writes backup zips. |

## How the fog works

The fog is the heart of the app, so it's worth understanding.

1. **A low-res "hidden/revealed" map.** Behind the scenes there's a small canvas
   (a quarter of the map's size, for speed) that records only one thing per
   pixel: is this spot **hidden** (navy) or **revealed** (transparent)? Painting
   with the brush or dropping a reveal shape edits this canvas.

2. **Two sources, combined.** Brush strokes are kept on one layer; the reveal/hide
   shapes (rectangles, polygons) are kept as editable objects. The final
   hidden/revealed map is those two combined. Keeping shapes as objects is why you
   can re-select and edit a room you carved out earlier.

3. **Making it look like fog, not a stencil.** That hard-edged hidden/revealed map
   is then blurred and overlaid with a drifting **cloud texture** (procedural
   noise). This is the "living fog" — soft edges and slow motion instead of a flat
   black cutout.

4. **Any color you want.** The cloud texture itself is neutral grey. The color
   comes from a base fill plus a glow tint you pick in the Fog panel, so the same
   fog can be dungeon-navy, blood-red, or swamp-green. Each scene remembers its own
   color and tint, and the choice rides along through Export/Import. The default
   reproduces the original navy. Picking a new color recolors everything live,
   including areas already shrouded, not just the next brush stroke.

5. **The DM sees through it; players don't.** On the DM screen the fog is
   semi-transparent (so you can plan), on the player screen it's fully opaque.

6. **A subtle but important detail:** the DM's fog is drawn on the GPU (PixiJS),
   but the **player's fog is drawn on top of the map with the regular 2D canvas**.
   This split exists because of a hard-won bug fix — when the player's fog was
   done on the GPU, a faint seam appeared at the edge of animated (video) maps.
   Drawing one continuous fog layer over the whole window on the player side makes
   that seam impossible. (Full story in CLAUDE.md.)

## How the two windows stay in sync

The DM window is the boss; the Player window just follows.

- They talk via **`postMessage`** — the standard browser way for two windows to
  send each other messages. The DM sends things like "here's the new fog," "the
  camera moved here," "switch to this map."
- The map image/video is sent as a **URL**, not copied pixel-by-pixel, so opening
  the player window doesn't double the memory used.
- **Auto vs. Manual.** With Auto on, every change the DM makes appears on the TV
  instantly. With Auto off, the DM can prep the next reveal privately and push it
  with the **Send** button when the party is ready.
- **Sync View** snaps the player's camera to match the DM's. The player camera
  also smoothly glides (lerps) to new positions rather than jumping.

## Backing up your maps

Everything you make lives in the browser's local database and (for video maps) on
disk next to the app. That's great for speed but it's tied to one machine, so
there's a backup feature for moving between PCs or keeping a safe copy.

- **Export** bundles the scenes you pick into a single `.zip` - the fog, the
  polygons, the thumbnails, and the actual map/video files, all in one place.
- **Restore** reads that zip back in and merges it into your current library
  rather than overwriting it. If a name already exists you get a "Name (2)" style
  rename instead of a clash, so importing the same backup twice is safe.

The zip reading and writing happens in the Electron shell (`main.js`), driven by
the `backup.js` module on the page.

## Why it's built this way

- **No frameworks, no build step.** It's plain JavaScript loaded with `<script>`
  tags. This keeps it dead simple to run and means it works straight off the
  local filesystem (`file://`), which matters for an offline desktop app.
- **Separate canvases for map / fog / grid / cursor.** Each is its own layer the
  GPU stacks together. That way painting fog doesn't force the (expensive) map to
  redraw — only the layer that changed gets touched.

---

Want the deep version — every performance trick, every past bug and why the fix
is shaped the way it is? See [CLAUDE.md](../CLAUDE.md).
