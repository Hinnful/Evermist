# CLAUDE.md

Behavioral rulebook for this repo: the constraints you must obey. Rules only, imperative,
one clause of reason at most.

**Every doc answers one question.** This one answers *what must I never do?* A paragraph
that doesn't belongs elsewhere:

- How does it work? Present tense → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Why this shape, what was tried? Past tense → [docs/DECISIONS.md](docs/DECISIONS.md),
  plus one file per split-out topic in [docs/decisions/](docs/decisions/)
- What is it for, what will it never do? → [docs/PRODUCT.md](docs/PRODUCT.md)
- Scoped to one folder → that folder's own `CLAUDE.md`. To a few named files → a skill in
  `.claude/skills/`; `guard-skill-hint.js` names it on an edit.

**Every one has a guard hook, and every doc grows only by a decision.** Add a rule here
only after trying to tighten or relocate an existing one; if it still does not fit, raise
`maxBytes` in `.claude/hooks/claudemd-baseline.json` by hand and say so.
**The ledgers are meant to grow** - when one gets
too big to read whole, move its largest `##` section to `docs/decisions/<topic>.md` and
leave a pointer, never delete an entry.

## What this is

**Evermist** - a client-side web app showing D&D dungeon maps on a TV with fog of
war. No backend, no VTT features (tokens, initiative). Map + fog + grid + two screens, one
or two maps at a time.

## Tech constraints

- Vanilla JS. No frameworks, no bundler, no build step.
- **No ES modules.** Plain `<script src="...">` only; `import`/`export` break on `file://`.
- **PixiJS (WebGL) is the primary render path** for both views. Canvas 2D is used only for
  fog compositing and the Player's fog-on-top overlay. There is no Canvas 2D map fallback.
- One HTML entry point: `index.html` serves both DM and Player (`?mode=player`).
- postMessage for DM → Player sync.
- Must work offline from `file://`.
- Player view has **zero UI**: no buttons, no overlays. Keep the cursor.
- Fog must never be flat black. Blur + noise texture is required.
- Images up to 30MB / 10000×6000px, decoded into an offscreen canvas asynchronously. Never
  block the main thread; no size limit beyond the browser's ~16384px.

## What ships in the build

`package.json` `build.files` lists each shipped path. Three entries are globs: `src/**/*.js`,
`src/css/**/*.css` and `electron/**/*.js`; the rest name one file each.

- A new `.js` under `src/` or `electron/`, or a `.css` in `src/css/`, ships automatically.
  Anything else needs its own entry.
- A runtime npm dependency needs per-package include/exclude rules (see pdfjs-dist); ESM
  also needs `asarUnpack`.
- **This whole class of bug is invisible to `npm start`, and the packaged app fails
  silently** (a missing stylesheet just renders unstyled). Verify with
  `npx electron-builder --win --dir` and run the real `.exe`.

## Code organization

Hard rules. "It's easier to just add it to the inline script" is never a valid reason.

- **Never add feature logic to the inline `<script>` in `index.html`.** It is wiring and
  init only: DOM/canvas refs, PixiJS init, module `init` calls, lifecycle listeners. A new
  concern gets a new `.js` file in the `src/` folder that owns its subsystem.
- **A module belongs to one subsystem folder**, and a file that would sit in two belongs in
  neither: split it. `src/` root holds only what every subsystem reads.
- **A set that grows by one more of the same thing is a folder, not a branch.** A tool, a
  material, a Player message and a column control each arrive as one file or one record.
- **Migrate-on-touch.** Modifying a concern still in the blob? Extract *that concern only*
  into its own module first, then build the new behavior there.
- **Shared mutable state has one home: `state.js`.** Move a piece there when a feature
  touches it. Grow it lazily; never move all globals at once.
- **No big-bang refactors.** The blob shrinks as a byproduct of feature work. If a task is
  purely file-shuffling, stop and confirm with the user.
- **Extend the module that owns the concern**, don't duplicate it elsewhere.
- **Build nothing for a case that does not exist yet.** No option no caller passes, no
  wrapper around a single call, no branch for a state the app cannot reach. Delete it; git has it.

### Module map

| Module | Owns |
|---|---|
| `state.js` | Shared state: fog constants, grid config, fog RAF handles, and every dirty flag |
| `render/renderer.js` | PixiJS/WebGL wrapper: the context, the map sprite, the texture pool |
| `render/playerFogPass.js` | The Player's fog: one full-screen GPU pass and its shaders |
| `render/dmFogLayer.js` | The DM's fog: map-sized sprites, the transition crossfade, the cloud mask |
| `render/render.js` | Render orchestration: `doRender`, `syncSize`, `scheduleRender`, `drawCursor` |
| `fog/fogClouds.js` | The drifting noise texture: one document builds the frame set, siblings copy it |
| `fog/fog.js` | Fog canvases, the blur + cloud pipeline, reveal/hide |
| `fog/fogAnim.js` | Fog on a clock: the drift, the reveal crossfade, the scene cover, the colour ease |
| `fog/fogControls.js` | The Fog tab's controls: anim presets, sliders, colour, feather, half-shroud, doors |
| `fog/fogGeometry.js` | Pure fog geometry kernel. Unit-tested |
| `fog/fogColor.js` | Pure fog colour kernel: base and tint from one hex, the step between two, the settings a scene carries. Unit-tested |
| `shapes/doorGeometry.js` | Pure door-notch kernel. Unit-tested |
| `rooms/vttPlan.js` | Pure UVTT floor-plan → room-polygon kernel. Unit-tested, dependency-free |
| `shapes/roomOps.js` | Pure Join/Trim/Cut kernel. Unit-tested |
| `shapes/shapeDetail.js` | Pure kernel: curves, radii and doors across a repair. Unit-tested |
| `shapes/tools.js` | Which tool is in hand, the state they share, and the registry a click dispatches through |
| `shapes/shapeCommit.js` | A drawn shape into a room, an effect or a repair; every refusal |
| `shapes/toolPoly.js` | The Polygon tool: a vertex per click, and the two ways it closes |
| `shapes/toolShapes.js` | The drag-a-shape tools: rectangle, circle, cone |
| `shapes/toolBrush.js` | The fog brush: the stroke queued while the pointer moves, and the pass that paints it |
| `shapes/toolDoor.js` | The Door tool and its notch in the fog |
| `shapes/toolCut.js` | The Cut tool and the two pieces it leaves |
| `shapes/toolPreview.js` | What a tool draws before anything is committed |
| `shapes/shapeHit.js` | Pure hit-test kernel: point-in-room, distance to a wall, where along it. Unit-tested |
| `shapes/shapeSelect.js` | The selection: its levels, hand edits, outline drawing |
| `shapes/shapeBox.js` | The bounding box: its handles, rotate and scale |
| `shapes/shapeClipboard.js` | Copy, paste, duplicate; a clipboard that outlives a scene switch |
| `shapes/shapeMenu.js` | The one shape button and its right-click flyout |
| `ui/input.js` | DM mouse/wheel/keyboard, legend. **Drag-drop is in `scenes/dragDrop.js`** |
| `undo.js` | Undo/redo for fog edits |
| `render/effects.js` | Map effects: the `effects` array's model, and the meshes its render path builds |
| `render/effectMaterials.js` | One record per material: ramp, warmth, swatch. A new material is a record |
| `render/effectShader.js` | The two fragment passes an effect burns with, and the vertex cap they walk |
| `render/grid.js` | Grid config + render |
| `render/gridCalibrate.js` | The calibration square that fits the grid to the map |
| `scenes/scenes.js` | Fog persistence + scene fade helpers |
| `scenes/sceneManager.js` | Scene CRUD and the library popup around the list |
| `scenes/sceneCards.js` | The list itself: a card per scene, a section per group, the drag that reorders |
| `scenes/sceneDelete.js` | The trash and its undo |
| `scenes/mapImport.js` | Import: what the app accepts, the one-at-a-time batch loop, video maps to disk |
| `scenes/sceneSwitch.js` | `switchScene`: fog cover, store read, decode, fog reopen |
| `scenes/sceneGroups.js` | Group names on scenes; heading order + collapse. Tested |
| `scenes/sceneStore.js` | IndexedDB read/write |
| `scenes/mapLoader.js` | Image-map loading + progress-bar helpers |
| `scenes/mapConvert.js` | Import-time animated-map shrink. `fitInsideBox` unit-tested |
| `render/viewport.js` | Pan/zoom, fit-to-screen, Sync View, and the camera every push carries |
| `player/playerWindow.js` | The Player window's life: opening it, warming one, what it is sent and when |
| `player/panes.js` | Two-column mode: the columns, the divider, the messages sent to them |
| `player/stageWindow.js` | The DM's side of the Player screen in two-map mode: open, warm, bind, close |
| `player/stage.js` | The Player window in two-map mode: a Player in each half, the chasm between |
| `player/minimap.js` | Minimap render + drag/zoom remote, view sync both ways, zoom nudge |
| `render/video.js` | Animated-map handling |
| `render/videoDiag.js` | The video diagnostics overlay and its disk log |
| `render/display.js` | Display detection |
| `scenes/backup.js` | Zip backup/restore, including a picked or dropped `.zip` |
| `scenes/dragDrop.js` | What a file dropped on the DM window becomes |
| `ui/toolbar.js` | DM UI wiring. Calls `initRoomPanel` and `initControlPanel` last |
| `ui/colorPicker.js` | The fog colour picker: square, hue strip, hex field, HSV maths |
| `ui/controlPanel.js` | Tabbed Fog/Grid/Player panel over the hidden legacy controls |
| `rooms/roomPanel.js` | Map room labels and the pure geometry that places them |
| `rooms/roomCard.js` | The room card: its fields, where it places itself, the drag that moves it |
| `content/moduleText.js` | Module parsing, storage, name-field dropdown |
| `content/moduleTextPanel.js` | The import panel and the name-field dropdown. Parses nothing |
| `content/pdfLayout.js` | Pure PDF reading-order kernel. Unit-tested, dependency-free |
| `content/pdfExtract.js` | pdf.js in a `utilityProcess`. No `<script>` tag |
| `ui/confirmDialog.js` | The app's only sanctioned confirmation dialog |
| `ui/about.js` | The About block in the legend footer: mark, version, repo |
| `ui/changelogData.js` | The release list. GENERATED; never edit it |
| `ui/changelog.js` | The What’s new panel |
| `ui/updater.js` | The update toast, the update line under About, and the restart button |
| `ui/musicPlan.js` | Pure music kernel: link parsing, filenames, the fade curve. Unit-tested |
| `ui/music.js` | The music bubble: track library and playback |
| `ui/musicDownload.js` | The Add music panel: paste a link, pick tracks, download |
| `rooms/floorPlan.js` | Floor-plan lookup, the import question, and drawing the rooms |
| `player/player.js` | Player-mode runtime: the loading card, the handshake, resize, pan/zoom |
| `player/playerMap.js` | A map payload landing on the Player: the cover, the fog mask, image or video |
| `player/playerMessages.js` | The Player's inbox: one handler per message the DM sends |
| `player/paneRuntime.js` | The column's inbox: the control messages a column accepts from the shell |
| `dev/stress.js` | `?stress=1` harness |
| `dev/memProbe.js` | `?memprobe=1` memory-footprint probe |

### The main process

One file per subject in `electron/`, each registering its own IPC on require. `main.js` keeps
the windows, the display push and the app lifecycle, and hands every module its paths.

| Module | Owns |
|---|---|
| `electron/videoFiles.js` | An animated map's file on disk: written, read back, listed, removed |
| `electron/music.js` | The music folder as the library, and the downloader that fills it |
| `electron/floorPlan.js` | The `.dd2vtt` sitting beside a map on disk |
| `electron/diagLog.js` | The playback log every window writes to, and its rotation |
| `electron/updates.js` | The check for a newer release, its download, and the state About reads |
| `electron/pdfText.js` | PDF text extraction, in a process of its own |
| `electron/backupZip.js` | What goes into a backup zip, and what comes back out |

### Load order

Declarations must precede use at init time. All under `src/`:

```
lib/pixi.min.js → lib/polygon-clipping.umd.js → render/renderer.js → render/playerFogPass.js →
render/dmFogLayer.js → state.js → render/display.js → render/video.js → render/videoDiag.js →
fog/fogGeometry.js → fog/fogColor.js → shapes/doorGeometry.js → rooms/vttPlan.js →
fog/fogClouds.js → fog/fog.js → fog/fogAnim.js → fog/fogControls.js → shapes/roomOps.js →
shapes/shapeDetail.js → shapes/shapeCommit.js → shapes/toolPoly.js → shapes/toolShapes.js →
shapes/toolBrush.js → shapes/toolDoor.js → shapes/toolCut.js → shapes/toolPreview.js →
shapes/tools.js → shapes/shapeHit.js → shapes/shapeSelect.js → shapes/shapeBox.js →
shapes/shapeClipboard.js → scenes/mapLoader.js → scenes/mapConvert.js → undo.js →
scenes/sceneGroups.js → scenes/sceneStore.js → scenes/scenes.js → scenes/sceneManager.js →
scenes/sceneCards.js → scenes/sceneDelete.js → scenes/mapImport.js → scenes/sceneSwitch.js →
render/viewport.js → player/playerWindow.js → player/panes.js → player/stageWindow.js →
scenes/backup.js → render/grid.js → render/effectMaterials.js → render/effectShader.js →
render/effects.js → scenes/dragDrop.js → ui/toolbar.js → shapes/shapeMenu.js → player/player.js →
player/playerMap.js → player/playerMessages.js → player/paneRuntime.js → ui/input.js →
dev/stress.js → dev/memProbe.js → render/render.js → render/gridCalibrate.js → player/minimap.js →
ui/colorPicker.js → ui/controlPanel.js → ui/confirmDialog.js → rooms/floorPlan.js →
content/moduleText.js → content/moduleTextPanel.js → rooms/roomPanel.js → rooms/roomCard.js →
ui/changelogData.js → ui/changelog.js → ui/about.js → ui/updater.js → ui/musicPlan.js →
ui/music.js → ui/musicDownload.js → inline <script>
```

### Repo layout

Browser modules in `src/<subsystem>/`: `fog`, `shapes`, `rooms`, `scenes`, `player`, `render`,
`ui`, `content`, `dev`. Only `state.js` and `undo.js` sit at `src/` root, because every
subsystem reads them. Stylesheets in `src/css/`. The main process is `main.js` plus one file
per subject in `electron/`. Both HTML entry points, `preload.js` and `package.json` stay at the
repo root. Docs in `docs/`; settings, hooks and skills in `.claude/`, skills as
`.claude/skills/<slug>/SKILL.md`. `tools/` is outside the build glob and must stay that way.

### Rules kept outside this file

- Stylesheets and the `src/css/` cascade → `src/css/CLAUDE.md`, loaded when you touch a file
  in that folder.
- Room card, room labels, half-shroud, control-panel button identity → the `dm-ui` skill.
- Module text, parser rules, file loading, PDFs, packaging traps, import panel → the
  `module-text` skill.
- UVTT coordinates, winding-not-area, what the room import refuses → the `floor-plan` skill.
- Driving the test rig, writing a scenario, its traps → the `rig` skill.

## Dialogs

**NEVER call `confirm()` or `alert()`. Use `confirmDialog` (`confirmDialog.js`).** A native
dialog is a separate OS window, and closing one desyncs the page's focus beyond any in-page
repair.

`confirmDialog` answers **asynchronously** via `onConfirm`/`onCancel`, so a caller that used
to write on `if (confirm(…))` must split into "what happens regardless" and "what happens on
yes" - see `applyModuleEntryToRoom`.

`messageDialog` is its one-button variant, for a statement that needs no answer. Every
error goes through it; no `alert()` ships.

## Rooms are polygons

1. **Never reorder the `polygons` array.** `rebuildFogFromPolygons` walks it in reverse, so
   array order IS fog compositing precedence. A feature needing its own ordering sorts a
   copy or carries a separate field.
2. **Never normalize a polygon from a fixed key list.** Backfilling a field must be an
   additive spread; a whitelist drops `cornerRadii` from every saved scene on load.
3. **The map is the interaction surface.** Selecting is the Select tool's job alone; a shape
   tool's click keeps drawing, overlapping and nested rooms included.
4. Rooms never reach the Player, so room notes are DM-only for free; no stripping guard.
5. **Map effects live in `effects`, never in `polygons`** (`effects.js`), and are called
   effects, never tokens. They are the same record with a `material` where a room has a fog
   `mode`, and persist alongside rooms - scene, backup, undo.

## The render loop

- **`doRender` rides the PixiJS ticker** (`pumpDirtyRender`, registered in
  `initPixiRenderer` at `UPDATE_PRIORITY.HIGH`), and the frame cap lives on `ticker.maxFPS`.
  An rAF fallback covers `pixiApp === null`.
- **Do not "simplify" this into a self-scheduling rAF loop with its own throttle.** A
  throttle on top of a throttle is the phase bug this replaced.
- `videoFrameIntervalMs` (`state.js`) throttles `video.js`'s frame pump every frame. It is
  live; don't delete it as leftover FPS-slider code.

## Testing

- Node's built-in runner (`node:test`). `npm test` for all, `node --test test/x.test.js` for
  one. Tests live in `test/`.
- **Only pure-function modules that export via `module.exports`.** Don't write tests against
  DOM-coupled code.
- **Testability follows from decoupling, not file count.** Don't inject render state into
  `fog.js`; its behavior is pixel output. New pure fog logic extends `fogGeometry.js`.
- Deliberately untested, don't add tests here: `render.js`, `scenes.js`, `state.js`,
  `renderer.js`, `toolbar.js`, `player.js`, `mapLoader.js`, `input.js`, `sceneStore.js`,
  `stress.js`.
- **Never run a rig set while building** - not even `smoke`. A run is the DM's time. `/commit`
  gates the diff and CI runs the full set against the built `.exe`. See the `rig` skill.
- **Never ask the DM to hand-verify what the rig can check.** Look, feel and performance are
  theirs; correctness is yours. Backup, export and restore are the exception - the save dialog is
  native and cannot be driven.

## Guard hooks

Eleven fail-open hooks in `.claude/settings.json`, baselines beside them. **Every guarded file
has one**, and each explains its own fix when it fires. `guard-skill-hint.js`, the `PreToolUse`
one, names the skill owning a file you edit.

## Conventions

- **No dated fix logs, changelog entries, or debugging narrative here.** Rules only.
- Code comments: keep the rule, one clause of why, and any warning about a specific trap.
  Cut named examples that disambiguate nothing, "an earlier version was tried", measurement
  dates and counts, and restatements of the code.
- **Write no sentence that already sits in another file.** Explain a trap once, at the line
  where someone hits it; a module's purpose and its rejected shapes stay in the docs. To
  connect two places, name the file. `guard-comment-echo.js` ratchets the repeat count DOWN.
- **Comment share of shipped JavaScript ratchets DOWN**, codebase-wide, never per file.
  `guard-comments.js` holds the ceiling; `node tools/comment-density.js` reports it, and
  `--verify` diffs comment-stripped code against HEAD after a comment-only pass. A comment
  that warns about a real trap earns its line - pay for it by tightening another.

## Running the app

No build step. `npm start` for the Electron app (after `npm install`). Local installers:
`npm run build` (Windows `.exe`), `build:mac` (`.dmg`), `build:linux` (`AppImage`).
**The DM runs `npm start` and the `.exe`. Never open or suggest Chrome.**

**Never put a window on the DM's screen.** The rig is the only sanctioned way to launch the
app; it parks every window off-screen. `npm start`, the stress and memprobe runs, a built
`.exe`, and the rig's own visible flag are the DM's to run and never yours. `guard-screen.js`
refuses them.

## Distribution and releases

**A SHIPPING COMMIT IS A RELEASE.** `.github/workflows/release.yml` fires on a push to
`release/**` or `change/**`, never on `main`, and releases when `package.json` holds a version
with no tag. **That commit's message becomes the release notes verbatim**, so it is public
writing; `/commit` carries the rules.

**NEVER PUSH TO `main`.** It is protected. The workflow's `land` job fast-forwards it once the
gate is green, and **nothing public exists until then**. A red gate blocks that change alone.

**When to bump the version.** A bump now means "release this", so bump **only when a change
touches the shipped app** (anything in `build.files`). Patch for normal changes, minor for a
notable feature, major for a breaking overhaul. Docs, tests, `.claude/` tooling and a module
split that changes no behaviour get **no bump**; they take a `change/**` branch and land
without building anything.

**ONE VERSION IS ONE COMMIT.** A version a red gate rejected keeps its number, and the fix
amends that commit - never a second commit on top.

**To pull a bad release: `/rollback`.** A `git revert` does not undo one.

**Never tag or publish by hand.** The workflow owns both, or neither.

**Never write `src/ui/changelogData.js` by hand.** `tools/build-changelog.js` turns release commit
subjects into it. Run it after the bump commit and amend, or the panel misses that release.

**Pipeline rules:**
- **Upload with `softprops/action-gh-release@v2`, NOT `electron-builder --publish`.**
  electron-builder only uploads to *draft* releases and silently skips otherwise.
- **The action creates a DRAFT and carries no `files:`.** Files go up one at a time with retries,
  and the draft turns public only once every size matches. `uploads.github.com` 500s on the
  100MB+ installers, and a parallel upload loses every file in flight to the first failure.
- **Unsigned by deliberate choice.** `CSC_IDENTITY_AUTO_DISCOVERY=false` must stay set in the
  workflow env and the local Windows `build` script, or the mac build fails.
- **Never redirect `userData` beside the `.exe` again** - the old portable folder orphaned a
  library on upgrade.
- **Windows ships an NSIS installer, not portable.** A portable build extracts to a temp folder
  and cannot replace itself, which kills auto-update.
- **Every release must carry `latest*.yml` and `*.blockmap`**, or electron-updater finds nothing
  and every installed copy silently stops updating - in both directions, rollback included.
  `tools/check-update-metadata.js` guards it per platform.
