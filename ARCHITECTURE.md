# Architecture

A plain-language tour of how Evermist works, for anyone reading the code. It's a
client-side app — no server, no database in the cloud. Everything happens in two
browser windows running inside an Electron shell.

If you want the exhaustive, every-edge-case version, that lives in
[CLAUDE.md](CLAUDE.md) (it's written for an AI coding assistant, so it's dense).
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
| `index.html` | The entry point. Holds shared state, the render loop, all the UI wiring, the window-to-window sync, and scene management. (Historically oversized — it's being broken into smaller files over time.) |
| `renderer.js` | The PixiJS/WebGL wrapper. The GPU drawing path for the map and the DM's fog. |
| `fog.js` | Everything fog: the canvases that store what's hidden, the blur + cloud-texture math, and the reveal/hide logic. |
| `tools.js` | The drawing tools — brush, rectangle, circle, polygon — and polygon editing. |
| `sceneStore.js` | Saving and loading scenes to the browser's local database (IndexedDB). |
| `main.js` / `preload.js` | The Electron shell — creates the windows, handles saving video files to disk. |

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
   noise, tinted navy/purple). This is the "living fog" — soft edges and slow
   motion instead of a flat black cutout.

4. **The DM sees through it; players don't.** On the DM screen the fog is
   semi-transparent (so you can plan), on the player screen it's fully opaque.

5. **A subtle but important detail:** the DM's fog is drawn on the GPU (PixiJS),
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

## Why it's built this way

- **No frameworks, no build step.** It's plain JavaScript loaded with `<script>`
  tags. This keeps it dead simple to run and means it works straight off the
  local filesystem (`file://`), which matters for an offline desktop app.
- **Separate canvases for map / fog / grid / cursor.** Each is its own layer the
  GPU stacks together. That way painting fog doesn't force the (expensive) map to
  redraw — only the layer that changed gets touched.

---

Want the deep version — every performance trick, every past bug and why the fix
is shaped the way it is? See [CLAUDE.md](CLAUDE.md).
