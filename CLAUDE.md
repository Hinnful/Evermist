# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Evermist** — a client-side web app for displaying D&D dungeon maps on a TV with fog of war.
No backend, no VTT features (tokens, initiative). Just: map + fog + grid + two screens.

## Running the app

No build step. For the Electron desktop app: `npm start` (requires `npm install` first). Build a local installer with `npm run build` (Windows portable `.exe`), `npm run build:mac` (`.dmg`), or `npm run build:linux` (`AppImage`).

Alternatively, `npx serve .` and open `http://localhost:3000` for browser testing. Player view opens automatically as a second window.

## Distribution & releases

Cross-platform from one push (set up 2026-06-23). Building a Mac `.dmg` cannot be done on Windows locally, so releases are built in the cloud by **GitHub Actions** (`.github/workflows/release.yml`).

**To cut a release:**
1. Get the changes onto `main` (push directly or via PR-merge).
2. Bump `version` in `package.json` to match the tag you're about to create (the `version` field names the installer files; the tag triggers the build — keep them in sync).
3. On GitHub: Releases → Draft a new release → create a new tag `vX.Y.Z` on publish → Publish.

The workflow then builds on `windows-latest`, `macos-latest` (universal `.dmg`, runs on Intel + Apple Silicon), and `ubuntu-latest` in parallel, and attaches `dist/*.{exe,dmg,AppImage}` to that release.

**Pipeline gotchas (do not regress):**
- **Use `softprops/action-gh-release@v2` to upload, NOT `electron-builder --publish`.** electron-builder's own publisher only uploads to *draft* releases; creating the release as published via the web UI made it silently skip the upload (build still went green, but no installers attached). softprops uploads regardless of draft/published state. The workflow builds with `electron-builder --publish never`, then softprops attaches the files.
- **Unsigned, by deliberate choice** (no paid certs). `CSC_IDENTITY_AUTO_DISCOVERY=false` is set in the workflow env (and the local Windows `build` script) so electron-builder doesn't hunt for a signing identity — without it the mac build fails. Users get a one-time OS security warning; the README's "First-time open" section explains how to bypass it per platform.
- Repo Actions settings must allow third-party actions ("Allow all actions") and grant `contents: write` (set in the workflow) for the upload to work.
- The portable `evermist-data` copyable-folder trick is **Windows-only** (`PORTABLE_EXECUTABLE_DIR`, `main.js`). Mac/Linux fall back to the OS-default per-user data location — the app works, it just isn't a copyable self-contained folder there. Not yet addressed.

First release: `v1.0.0`, all three installers built and verified working (2026-06-23).

## Tech decisions

- Vanilla JS, no frameworks, no bundler
- **No ES modules** — plain `<script src="...">` tags only; `import`/`export` break on `file://` protocol
- Canvas 2D API for all rendering (no WebGL unless Canvas 2D can't handle blur on large images)
- Single HTML entry point: `index.html` serves both DM view and Player view (`?mode=player`)
- postMessage for DM → Player sync (works on `file://` in Chrome with the flag above)
- Electron wrapper for desktop packaging (Windows `.exe`, macOS `.dmg`, Linux `AppImage`) — core app is identical to browser version. See "Distribution & releases".

## Code organization (READ BEFORE ADDING ANY FEATURE)

The inline `<script>` in `index.html` is an oversized blob (~2400+ lines) inherited from an earlier era. **It is being actively dissolved, not extended.** Treat it as legacy, not as the home for new work.

Hard rules — these override convenience, and "it's easier to just add it to the inline script" is never a valid reason:

- **Never add new feature logic to the inline script in `index.html`.** A new concern gets a **new `.js` file**. The entry script is for wiring modules together and kicking off init — nothing else, long-term.
- **Migrate-on-touch.** When you modify a concern that still lives in the inline blob, extract *that concern* (and only that concern) into its own module as the first half of the change, then build the new behavior in the clean module. Do not extract unrelated code in the same change.
- **Shared mutable state has one home: `state.js`.** Today state is scattered as top-level globals in the inline script. When a feature touches a piece of state, move *that piece* into `state.js` and reference it from there. Grow `state.js` lazily — never attempt to move all globals at once.
- **No big-bang refactors.** Never schedule or perform a standalone "refactor the blob" pass. The blob shrinks only as a byproduct of normal feature work under the rules above. If a task is purely cosmetic file-shuffling with no feature attached, stop and confirm with the user first.
- **Target module map** (where extracted concerns should land — create these as needed, don't pre-build empty ones): `state.js` (shared state), `viewport.js` (pan/zoom/sync-view), `grid.js` (grid config + render), `input.js` (mouse/keyboard/drag-drop), `scenes.js` (scene load/switch/transition, above the existing `sceneStore.js` IDB layer), `video.js` (animated-map handling). `fog.js` and `tools.js` already exist — extend them, don't duplicate their concerns elsewhere.
- **Testability follows from decoupling, not file count.** `fog.js` is already a separate file but is untestable because it reaches into globals defined in the inline script. The win that unlocks fog regression tests is moving fog's state into `state.js` / passing it explicitly — not merely cutting files. Prioritize accordingly when fog work comes up.

Mechanics that constrain all of the above (do not violate): no ES modules (`import`/`export` break on `file://`), plain `<script src>` only, load order matters (declarations must precede use at init), and **every new `.js` file must be added to `package.json` `build.files`** or it won't ship in the Electron package.

## Architecture

Code is split across five browser scripts (plus the bundled PixiJS library) loaded via plain `<script>` tags. Global scope sharing: `let`/`const` at top level of a non-module script live in the global lexical environment and are accessible to all later scripts. Function bodies are lazily evaluated, so fog.js and tools.js functions can reference variables declared in the inline script (which loads last).

**Load order** (critical — declarations must precede their use at initialization time):
```html
<script src="lib/pixi.min.js"></script> <!-- PixiJS (WebGL) vendor library -->
<script src="renderer.js"></script>      <!-- PixiJS wrapper: pixiSetMap, pixiUpdateMapTexture, GPU fog layers, etc. -->
<script src="fog.js"></script>           <!-- FOG_SCALE, fog canvases, buildRoundedPolyPath, renderFog, etc. -->
<script src="tools.js"></script>         <!-- tool state, flushBrushOps, toolMouseDown/Move/Up, etc. -->
<script src="sceneStore.js"></script>    <!-- IndexedDB scene persistence -->
<script>/* inline */</script>            <!-- shared state, render loop, UI handlers, player sync, scenes, init -->
```

```
renderer.js (~400 lines) — PixiJS (WebGL) wrapper; the GPU render path
  ├── Lifecycle: initPixiRenderer, pixiSetMap, pixiSetViewport, pixiResize, pixiHideMap/pixiShowMap
  ├── Map texture: pixiUpdateMapTexture, pixiStartVideoTextureSync/pixiStopVideoTextureSync, pixiGetMaxTexSize, pixiClampCanvas, pixiRefreshProxy
  └── DM GPU fog layers: pixiFogBlur*, pixiFogCloud* (TilingSprites), pixiFogData*/brush sprite, pixiFogTrans* (SpriteMaskFilter compositing)

fog.js (~470 lines)
  ├── Constants: FOG_SCALE, FOG_BLUR_RADIUS, FOG_OPACITY_DM, FOG_FEATHER_RADIUS, FOG_EDGE_MARGIN, FOG_REVEAL_MS, CLOUD_PASSES
  ├── Runtime override: `fogFeatherRadius` (let, initially = FOG_FEATHER_RADIUS) — overridden by the Feather slider in the DM's advanced Fog panel (0–24 px at fog scale). `getScaledFeatherRadius()` uses this instead of the constant.
  ├── Canvas state: fogDataCanvas, baseFogCanvas, fogBlurCanvas, fogEffectCanvas, cloudCanvas
  ├── Animation state: fogAnimEnabled, fogAnimSpeed, fogAnimOffsets
  ├── Transition state: fogTransPrev, fogTransBlurPrev, fogTransBlendCanvas, fogTransT
  └── Functions: buildRoundedPolyPath, revealCircle, shroudCircle, applyPolygonToFog,
        rebuildFogFromPolygons, generateCloudFrames, rebuildFogBlur, recompositeCloudEffect,
        renderFog, fogAnimTick, startFogAnim, stopFogAnim, startFogTransition, fogTransTick

tools.js (~650 lines)
  ├── Tool state: tool, shape, brushSize, isDrawing, pendingBrushOps
  ├── Polygon tool state: activePolygon
  ├── Select tool state: selectedPolygonId, isDraggingPolygon, snapToGrid
  ├── Vertex/edge editing state: selectedVertexIndex, polyCtxRadiusMode, isDraggingVertex, isDraggingEdge
  └── Functions: snapVertex, getPolyBBox, segmentsIntersect, pointInPolygon, findPolygonAt,
        distPointToSegment, findPolygonHandleAt, getCentroid, findVertexAt, findEdgeAt,
        closestPointOnSegment, flushBrushOps, drawPolyOutline, drawActivePolyPreview,
        updatePolyContextPanel, toolMouseDown, toolMouseMove, toolMouseUp, toolWindowMouseUp, toolDblClick

sceneStore.js (~95 lines)
  └── IndexedDB wrapper: initSceneDB, saveScene, loadScene, deleteScene, listScenes.
        DB name: 'evermist', store: 'scenes'.

index.html (inline script ~2400+ lines — LEGACY BLOB, being dissolved; see "Code organization")
  ├── State: mapBitmap, mapOffscreen, mapVideo, mapVideoBlob, zoom/panX/panY, polygons, undoStack/redoStack
  ├── 4 stacked CSS canvases (map, fog, grid, cursor)
  ├── Dirty flags: viewportDirty, mapDirty, fogDirty, gridDirty
  ├── scheduleRender() → RAF → doRender()
  │     ├── flushBrushOps()  — from tools.js
  │     ├── renderMap()      — when viewportDirty OR mapDirty (video frames)
  │     ├── renderFog()      — from fog.js, only when fogDirty
  │     └── renderGrid()     — only when gridDirty
  ├── Video map support: loadVideoFromFile, startVideoLoop, stopVideoLoop, cleanupVideo, isVideoFile
  │     Video <video> element appended to DOM (hidden) for full-res Chromium decoding.
  │     RAF loop sets mapDirty each frame. (NOTE: avg-frame-time auto-fallback is NOT implemented — see Video map support.)
  ├── Mouse events: delegate to toolMouseDown/Move/Up from tools.js
  │     (coordinate conversion screen→map stays in index.html event listeners)
  ├── Polygon management: closeActivePolygon, deleteSelectedPolygon, toggleSelectedPolygon
  ├── Undo/redo: pushUndo, restoreState, undo, redo
  ├── Scene management: createNewScene, switchScene, replaceSceneMap, auto-save (5s debounce)
  ├── Player sync: sendToPlayer, postMessage listener, view lerp, auto/manual toggle
  └── Toolbar, keyboard shortcuts, save/load, grid drawing, init
```

**Critical rules:**
- **Multi-canvas layering**: map, fog, grid, and cursor each have their own canvas, stacked via CSS `position: absolute; inset: 0`. The browser GPU-composites them. This avoids redrawing the map during brush operations.
- Fog display canvas uses CSS `opacity: 0.55` (DM) / `1.0` (Player) — no per-frame `globalAlpha`.
- Dirty flag separation: brush strokes set `fogDirty` only; pan/zoom set `viewportDirty` (redraws all); video frames set `mapDirty` only. This is the key performance optimization.
- Large image handling (Canvas 2D mode): map is decoded once into an `ImageBitmap` (GPU-backed). All subsequent renders use `drawImage` from that bitmap, never from the `Image` object. **In PixiJS mode, `mapBitmap` is NOT created** — `mapOffscreen` canvas is passed directly to `pixiSetMap`. See "PixiJS memory management" section.
- Viewport culling: pass a source rectangle to `drawImage` — only draw the visible portion of the map.
- **Player grid rendering**: grid is drawn on `map-canvas` (below fog) in Player view, not on the grid canvas. This ensures fog naturally hides the grid in shrouded areas without compositing artifacts.
- **Player fog — hybrid Canvas-2D fog-on-top (2026-06-22 rewrite)**: The Player does NOT render fog in PixiJS. PixiJS draws only the unmasked map sprite (bottom layer); the fog is drawn on top by the Canvas-2D `renderFog()` (fog.js) on `#fog-canvas`, which sits above `#pixi-canvas` in the DOM. `renderFog`'s player path fills the entire viewport with navy + cloud in one pass, then punches reveal holes inside the map rect via `destination-in` with `fogBlurCanvas`. Because one continuous fog layer covers the whole viewport (including the map edge), the WebM map-rect boundary seam is structurally impossible. This replaced an earlier inverted-layer PixiJS approach (fog as masked background) that could never fully eliminate the seam.
  - **`#fog-canvas` must stay visible in the Player.** In PixiJS mode the DM hides its 2D fog-canvas (`if (!isPlayer) fogCanvas.style.display = 'none'`) because the DM's fog is GPU-rendered. The Player keeps it visible at `opacity: 1` — if hidden, `syncSize` skips it (stays 0×0) and `renderFog` paints into nothing, so the map shows fully revealed with only the container background around it.
  - **Edge-margin fix (FOG_EDGE_MARGIN)**: a reveal reaching the map's outer edge would hard-stop against the solid outside-map fog (a sharp horizontal "seam", glaring over bright map-edge content). `rebuildFogBlur` stamps a thin always-shrouded navy frame (FOG_EDGE_MARGIN fog-scale px, default 2) over the blur mask's outer edge; the blur feathers its inner edge inward so edge-touching reveals fade into the margin. Applied to the display blur mask only — `fogDataCanvas`, undo, and saved scenes are untouched.
  - **Player WebM texture downscale**: `playerMapTexCanvas` is downscaled to ~2× viewport (≈3840×2305 for a 9746×5850 map) to avoid per-frame GPU TDR (a full-res upload trips Windows GPU-timeout → exit_code=34). Sprite logical dims stay mapW×mapH. The map's magnified-texture edge is irrelevant now — it's covered by opaque fog. JPEG maps use a full-res texture (no downscale).

## Video map support

Accepts MP4 (H.264) and WebM (VP8/VP9) alongside static images. The `<video>` element is a drop-in source for `drawImage()` — same viewport culling, same render path.

**Key architecture:**
- `mapVideo`: the `<video>` element (appended to DOM hidden for full-res decoding). `mapBitmap` holds frame 0 as static fallback.
- `mapDirty` flag: video RAF loop sets this each frame — triggers ONLY `renderMap()`, never fog/grid. `viewportDirty` still triggers all layers on pan/zoom.
- **Filesystem storage (Electron)**: video files are stored on disk in `userData/maps/{sceneId}.webm|.mp4`. The IDB scene record stores `mapPath` (relative path string) instead of `mapBlob`. On load, `getVideoFilePath` IPC resolves the absolute path and `video.src` is set to a `file:///` URL. Zero memory overhead for storage/loading. `save-video-file` IPC streams the file from the source path via `createReadStream`→`createWriteStream` with per-chunk progress events. `save-video-blob` IPC handles legacy migration (ArrayBuffer→disk in 4MB chunks).
- **Browser fallback**: when `window.electronAPI` is absent, video blobs are stored in IDB as before (the pre-filesystem path).
- **Legacy migration**: `switchScene` detects video scenes with `mapBlob` but no `mapPath` and auto-migrates them to disk on first access (shows progress bar, writes blob to disk, updates IDB record, frees the blob).
- Scene record has `mapType: 'video'|'image'` field. On load, `switchScene` checks this to decide video vs image path.
- Player creates its own `<video>` and plays independently — slight frame desync is invisible on dungeon maps. DM sends the `file:///` URL via postMessage; Player loads from the same path.
- **Player video texture sync (PixiJS)**: In Player mode the map is a PixiJS *sprite* (unmasked, with Canvas-2D fog drawn on top — see "Player fog — hybrid"), NOT a DOM `<video>` — so the DM's DOM-video compositing path does nothing. The map texture must be refreshed from the video every rendered frame. `finishPlayerVideo` calls `pixiStartVideoTextureSync(fn)` (renderer.js) which adds `fn` to the **PixiJS render ticker** (not `doRender`'s dirty-flag loop, which fires on demand and would leave the video frozen between viewport changes). `fn` draws the current video frame into the downscaled map-texture canvas and calls `pixiUpdateMapTexture()`. `cleanupVideo` calls `pixiStopVideoTextureSync()`. `startVideoLoop` skips `activateVideoDom` for Player (`if (!isPlayer)`) — the DOM video would sit invisibly under the opaque fog layer.
- **Player map texture is downscaled** to ~2× viewport before `pixiSetMap`. A full-res frame (e.g. 9746×5850 = 228 MB raw) uploaded to GPU on first render trips Windows TDR (GPU Timeout → `exit_code=34` crash). Sprite logical dims stay full-res; only texture resolution drops. Player follows DM view so the quality loss is invisible.
- **DM stale `mapCtx` clear**: `activateVideoDom` clears the Canvas 2D `mapCanvas` (DM PixiJS video mode) — otherwise a previous scene's static image persists there and shows through the transparent fog holes ("white space" / "loaded as static").
- **No perf auto-fallback.** The video RAF loop only throttles to `VIDEO_MIN_FRAME_INTERVAL` (~24fps). There is no avg-frame-time measurement / auto-pause-to-static fallback (the dead `videoFrameCount`/`videoFrameTimeSum`/`VIDEO_SLOW_THRESHOLD_MS` scaffolding for it was removed in the 2026-06-22 cleanup). Not needed in practice; revisit only if a map stutters.
- **Load gotcha (do not regress):** the `<video>` element MUST be appended to the DOM (hidden) for Chromium to decode at full resolution. The `canplay` handler must self-remove via `video.oncanplay = null` — using `removeEventListener` fails (different mechanism) and once caused hundreds of duplicate scenes. Frame-0 extraction waits for a `seeked` event (seek to 0.001s) with a 2s timeout, and uses `preload='auto'` (`'metadata'` causes black frames on some DA WebMs).
- `cleanupVideo()` handles all teardown: stops RAF, pauses video, removes from DOM, revokes blob URL (skips revocation for `file://` URLs).
- Export/import UI was removed; portability is handled via the portable data directory instead.
- Progress overlay (`#map-progress`): fullscreen dark backdrop with gradient progress bar, shown during video file save and legacy migration. Driven by `video-save-progress` IPC events.

## Fog visual effect pipeline

1. `fogDataCanvas` (offscreen, 1/4 scale) — the data layer. `#1a1a2e` = hidden, transparent = revealed.
2. `applyPolygonToFog` reveal pipeline: draw polygon on scratch → blur → cloud erosion (`destination-out`) → **inward clip (`destination-in`)** → `fogDataCtx destination-out` → hard interior clear. The `destination-in` step (added 2026-06-22) clips the blurred scratch back to the polygon shape so the soft edge fades inward only — prevents outward bleed into adjacent rooms. `fogFeatherRadius` controls blur radius (live slider, 0–24).
3. `rebuildFogBlur()` runs on mouseup / tool completion (not every frame):
   - Draws `fogDataCanvas` into `fogBlurCanvas` (padded) with `ctx.filter = 'blur(4px)'`. 4px at 1/4 scale ≈ 16px at full res.
4. `recompositeCloudEffect(offsets)` — cheap per-frame operation during animation:
   - Composites cloud texture over the blur result via 3 passes at different scales/rotations using `source-atop`.
5. Cloud texture: Perlin turbulence with prime-number grid sizes for seamless wrapping. Generated as a set of animation frames via `generateCloudFrames(512, CLOUD_FRAME_COUNT)`, cross-faded over time. Dark navy/purple color range.
6. `renderFog(vp)` blits from `fogEffectCanvas` (cached). During active brushing, falls back to raw `fogDataCanvas` so DM sees live strokes.
7. DM view: fog CSS opacity 0.55 (see-through). Player view: 1.0 (fully opaque).
8. Fog color: `#1a1a2e` (dark navy), not pure black.
9. **Fog animation**: drifting cloud effect. RAF loop calls `recompositeCloudEffect` each frame without re-blurring. DM toggle via "Animate" button (`btn-anim`) or `A` key. The toggle button now propagates `fogAnimEnabled` to the Player via `syncAnimToPlayer` (fixed 2026-06-22). **KNOWN BUG (2026-06-22, low priority):** the `A` key shortcut for the animate toggle is broken — `toggleFogAnim()` is declared inside the `if (!isPlayer)` block; the top-level `keydown` handler cannot reliably call it via sloppy-mode hoisting. User confirmed they don't use keyboard shortcuts, so this is low priority. Fix: move `toggleFogAnim` to true global scope or delegate the A key to `btn-anim.click()`.
10. **Fog transition**: 700ms smoothstep crossfade on reveal AND shroud. Uses `lighter` blend mode for linear lerp at 1/4 scale.

## Fog state architecture

- `baseFogCanvas` — brush strokes only (the persistent hand-painted layer).
- `fogDataCanvas` — derived: base + all polygon reveals/shrouds. Rebuilt via `rebuildFogFromPolygons()`.
- Undo/redo snapshots capture `baseFogCanvas` + `polygons[]` + `nextPolygonId`.

## Brush tool

Brush ops are batched: `mousemove` pushes segments to `pendingBrushOps[]`, which are flushed to the fog data canvas in a single compound-path operation at the start of `doRender()`. Reveal uses `clip()` + `clearRect()` (avoids `destination-out` which can force Chrome into software rendering on some canvas configurations).

## Scene management

IndexedDB-backed (`sceneStore.js`). Each scene stores: mapType ('image'|'video'), polygons, base fog as PNG, grid config, thumbnail, sort order. Image scenes store `mapBlob` (Blob) in IDB. Video scenes store `mapPath` (string, e.g. `maps/{id}.webm`) — the actual file lives on disk under `userData/maps/`. Scene deletion also calls `deleteVideoFile` IPC to remove the disk file. Scene Manager is a modal overlay with cards (thumbnail + name + reorder + delete). Auto-save on 5-second debounce (never re-saves the video file — only fog/polygon metadata). Scene switch triggers player fade-to-black transition. `switchScene` is guarded against concurrent switches by a `switchGeneration` counter (aborts stale flows after each `await`) and nulls `currentScene` at entry to prevent stale auto-save corruption.

**Scene creation/replace reroute through `switchScene`**: `createNewScene` and `replaceSceneMap` decode the dropped map (for dimensions + thumbnail, and to save the video file to disk), save the scene record, then set `currentScene = null` and `await switchScene(id)` to actually display it. The direct drop-load display path left PixiJS fog/video broken (map fully revealed, shroud inert, video frozen) and was only fixed by a manual scene switch — root cause never isolated; rerouting through the proven `switchScene` path is the reliable fix. **Cost: the map is loaded twice** (drop decode + switch reload). A single-load optimization (metadata-only first pass) is in the backlog, not yet decided.

## Portable data

In the portable `.exe` build, all Chromium user data (IndexedDB, caches) is stored in `evermist-data/` next to the executable instead of `%APPDATA%`. This makes the entire folder self-contained and copyable between PCs. Implemented via `app.setPath('userData', ...)` in `main.js`, using `process.env.PORTABLE_EXECUTABLE_DIR` (set by electron-builder's portable target). In dev mode (`npm start`), the env var is absent and default `%APPDATA%` behavior is preserved.

## Key constraints

- Images up to 30MB / 10000×6000px — never block the main thread during load; decode into offscreen canvas asynchronously.
- Must work offline from `file://` protocol.
- Player view (`?mode=player`) must have zero UI — no buttons, no cursor, no overlays.
- Fog must not be flat black — blur + noise texture is required, not optional.
- No artificial image size limit; browser canvas max (~16384×16384px) is the only hard ceiling.
- Every new `.js` file must be added to `package.json` `build.files` for Electron packaging.

## Polygon editing (Select tool)

Polygon objects: `{ id, vertices:[{x,y}], mode:'reveal'|'shroud', cornerRadius:0, cornerRadii:null }`.

`cornerRadii` is `null` (all corners use `cornerRadius`) or an array of per-vertex overrides where `null` entries fall back to `cornerRadius`. The ∀ button in the context panel toggles `polyCtxRadiusMode` ('all'|'vertex'); in vertex mode the radius slider writes to `cornerRadii[selectedVertexIndex]`.

**`buildRoundedPolyPath(ctx, verts, defaultR, perVertR)`** — arcTo path builder:
- Computes polygon signed area (shoelace) to determine winding.
- At each vertex, cross product of incoming/outgoing edges vs area sign → convex or concave.
- Concave (reflex) vertices are always left sharp — prevents inside-out arc deformation.
- `perVertR` is optional; null entries fall back to `defaultR`.
- Calling sites: `drawPolyOutline` (screen space, `r * zoom`), `applyPolygonToFog` (fog space, `r / FOG_SCALE`).

**Context panel** (`#panel-poly-ctx`, ~152px, `zoom: var(--ui-zoom)`):
- Row 1: ◯ Reveal / ◉ Shroud radio buttons + SVG trash icon delete
- Row 2: ▢ corner-radius slider + value + ∀ all/vertex mode toggle
- Row 3 (vertex selected): vertex index label + ✕v delete-vertex button
- `updatePolyContextPanel()` called from `drawCursor` every frame; positions above centroid.

**Edge drag** uses a fixed normal computed from the original edge direction at drag-start (`edgeDragOrigVerts`). This is intentional — prevents drift during drag. A fresh normal is computed each new mousedown.

## UI layout

- **Glass-morphism design**: dark purple/navy gradients with blur backdrop, purple accent borders.
- **Top toolbar**: centered, all shape/select tools (Brush, Rectangle, Polygon, Circle, Select).
- **Right sidebar**: collapsible sections — Grid (with SVG icons for square/hex modes, offset/opacity/thickness controls), Fog (animate toggle + speed slider).
- **Scenes panel**: separate compact glass panel above the settings sidebar. Opens Scene Manager modal.
- **Bottom-left**: UI scale slider.
- **Bottom-right**: Player controls (Player View, Sync, Auto/Manual, Fullscreen, Send).
- **Snap toggle**: own panel in bottom toolbar, visible when non-brush tool active.
- **UI zoom**: all panels use `zoom: var(--ui-zoom)` via anchor-wrapper pattern (fixed outer div, zoomed inner).

## PixiJS memory management

### The `mapBitmap` redundancy — fixed 2026-06-20

**Symptom:** 3 GB RAM at launch (10000×6000 map), spiking to 6 GB when Player window opens.

**Root cause:** In PixiJS mode, every map load path was calling `createImageBitmap(src)` and storing the result in `mapBitmap` (~240 MB ImageBitmap), then immediately passing it to `pixiSetMap`. After that call, `mapBitmap` was never touched again — PixiJS holds its own copy in VRAM, and Canvas 2D `renderMap` is never called in PixiJS mode. `mapOffscreen` (~240 MB Canvas) was kept separately for thumbnails. Two full-resolution CPU copies living permanently side by side.

**The fix:** In PixiJS mode, skip `createImageBitmap` entirely. Pass `mapOffscreen` (or the video `extractCanvas`) directly to `pixiSetMap`. For the `switchScene` image path, draw the bitmap to `mapOffscreen` first, then call `bitmap.close()` immediately — never store it in `mapBitmap`.

**Rule: in PixiJS mode, `mapBitmap` is always null.** The five load paths that enforce this:
1. `loadMapFromFile` — `if (usePixi) { pixiSetMap(mapOffscreen, ...); }` else `createImageBitmap → mapBitmap`
2. `loadVideoFromFile` `finishLoad` — `pixiSetMap(extractCanvas, ...); pixiHideMap();` (no createImageBitmap)
3. `switchScene` image path — draw bitmap → mapOffscreen, `bitmap.close()`, `pixiSetMap(mapOffscreen, ...)`
4. `switchScene` video path — `pixiSetMap(extractCanvas, ...); pixiHideMap();`
5. Player image/video paths — same pattern as DM equivalents

`mapBitmap` is still created in Canvas 2D mode (no PixiJS) and used normally by `renderMap`.

### `sendToPlayer` spike — fixed 2026-06-20

**Symptom:** Opening Player window caused memory to spike an additional 400–800 MB.

**Root cause:** `sendToPlayer()` was calling `mapOffscreen.toBlob(blob => sendMap(...), 'image/jpeg', 0.9)` — JPEG-encoding a 10000×6000 canvas in-process. The encoder allocates a full uncompressed buffer (~240 MB raw pixels) plus YCbCr conversion buffers before outputting anything. This is temporary but violent.

**The fix:** Check `currentScene.mapBlob` first. The original compressed image is already in IndexedDB RAM from `switchScene`. Use `URL.createObjectURL(currentScene.mapBlob)` directly and send that URL. No encoding, no temporary buffers. Falls back to the old `mapOffscreen.toBlob` path if `mapBlob` is absent (new scene not yet auto-saved).

### What was tried first and did not work

**Theory (wrong):** `pixiFogCloudMaskSpr` was not in the display list, so PixiJS `SpriteMaskFilter` called `getBounds()` on a detached sprite, got the full map dimensions (10000×6000), and allocated two intermediate RenderTextures at that size (~229 MB each in VRAM) via `FilterSystem.push()`.

**Fixes applied:** Added mask sprite to display list with `renderable = false`; flushed `texturePool` on fog init; paused Ticker on window hide.

**Why they had zero effect:** `FilterSystem.push()` calls `state.destinationFrame.fit(destinationFrame)` which **clamps** the intermediate RT to the current render target (the viewport). Even if `getBounds()` returns 10000×6000, the RT is clamped to ~viewport size (~8–33 MB). Additionally, PixiJS intermediate RTs live in VRAM (GPU process) and are invisible in Electron renderer process RAM. The 3 GB figure was entirely CPU RAM.

The ticker-pause and pool-flush fixes are harmless and correct — keep them. They just aren't the cause of the memory issue.
