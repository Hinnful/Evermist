# CLAUDE.md

Behavioral rulebook for this repo: the constraints you must obey. Rules only, imperative,
one clause of reason at most.

**Every doc answers one question; the mood it is written in proves it.** This one answers
*what must I never do?* A paragraph that doesn't belongs elsewhere:

- How does it work? Present tense → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Why this shape, what was tried? Past tense → [docs/DECISIONS.md](docs/DECISIONS.md)
- What is it for, what will it never do? → [docs/PRODUCT.md](docs/PRODUCT.md)
- Scoped to one folder → that folder's own `CLAUDE.md`. To a few named files → a skill in
  `.claude/skills/`; `guard-skill-hint.js` fires on an edit and names it.

**Every one has a guard hook.** This file may shrink, never grow.

## What this is

**Evermist** - a client-side web app for displaying D&D dungeon maps on a TV with fog of
war. No backend, no VTT features (tokens, initiative). Map + fog + grid + two screens.

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
- Images up to 30MB / 10000×6000px. Never block the main thread on load; decode into an
  offscreen canvas asynchronously. No artificial size limit beyond the browser's ~16384px.

## What ships in the build

`package.json` `build.files` lists each shipped path. Only two entries are globs:
`src/**/*.js` and `src/css/**/*.css`; the rest name one file each.

- A new `.js` in `src/` or `.css` in `src/css/` ships automatically. Anything else needs its
  own entry.
- A runtime npm dependency needs per-package include/exclude rules (see pdfjs-dist); ESM
  also needs `asarUnpack`.
- **This whole class of bug is invisible to `npm start`, and the packaged app fails
  silently** (a missing stylesheet just renders unstyled). Verify with
  `npx electron-builder --win --dir` and run the real `.exe`.

## Code organization

Hard rules. "It's easier to just add it to the inline script" is never a valid reason.

- **Never add feature logic to the inline `<script>` in `index.html`.** It is wiring and
  init only: DOM/canvas refs, PixiJS init, module `init` calls, lifecycle listeners. A new
  concern gets a new `.js` file in `src/`.
- **Migrate-on-touch.** Modifying a concern still in the blob? Extract *that concern only*
  into its own module first, then build the new behavior there.
- **Shared mutable state has one home: `state.js`.** Move a piece there when a feature
  touches it. Grow it lazily; never move all globals at once.
- **No big-bang refactors.** The blob shrinks as a byproduct of feature work. If a task is
  purely file-shuffling with no feature attached, stop and confirm with the user.
- **Extend the module that owns the concern**, don't duplicate it elsewhere.

### Module map

| Module | Owns |
|---|---|
| `state.js` | Shared state: fog constants, grid config, fog RAF handles, map/camera/polygon/scene/sync/dirty flags |
| `renderer.js` | PixiJS/WebGL wrapper; map + DM fog GPU path |
| `render.js` | Render orchestration: `doRender`, `syncSize`, `scheduleRender`, viewport sizing, `drawCursor` |
| `fog.js` | Fog canvases, blur + cloud pipeline, reveal/hide, transitions |
| `fogGeometry.js` | Pure fog geometry + math kernel. Unit-tested |
| `vttPlan.js` | Pure UVTT floor-plan → room-polygon kernel. Unit-tested, dependency-free |
| `tools.js` | Drawing tools + polygon editing |
| `input.js` | DM mouse/wheel/keyboard, shape helpers, legend toggle. **Drag-drop is in toolbar.js, not here** |
| `undo.js` | Undo/redo for fog edits |
| `effects.js` | Map effects: the `effects` array's model and its render path |
| `grid.js` | Grid config + render |
| `scenes.js` | Fog persistence + scene fade helpers |
| `sceneManager.js` | Scene CRUD, `switchScene`, scene-manager UI |
| `sceneGroups.js` | Group names on scenes; heading order + collapse. Tested |
| `sceneStore.js` | IndexedDB read/write |
| `mapLoader.js` | Image-map loading + progress-bar helpers |
| `mapConvert.js` | Import-time animated-map shrink. `fitInsideBox` unit-tested |
| `viewport.js` | Pan/zoom, Sync View, Player map delivery, `scheduleAutoSync`, `dmVisibleRegion` |
| `minimap.js` | Minimap render + drag/zoom remote, view sync both ways, zoom get/set/nudge |
| `video.js` | Animated-map handling |
| `display.js` | Display detection |
| `backup.js` | Zip backup/restore |
| `toolbar.js` | DM UI control wiring + drag-drop. Calls `initRoomPanel` and `initControlPanel` last |
| `controlPanel.js` | Tabbed Fog/Grid/Player panel over the hidden legacy controls |
| `roomPanel.js` | The room card + map room labels |
| `moduleText.js` | Module parsing, storage, name-field dropdown |
| `pdfLayout.js` | Pure PDF reading-order kernel. Unit-tested, dependency-free |
| `pdfExtract.js` | pdf.js in a `utilityProcess`. No `<script>` tag |
| `confirmDialog.js` | The app's only sanctioned confirmation dialog |
| `about.js` | The About box: mark, version, repo |
| `floorPlan.js` | Floor-plan lookup, the import question, and drawing the rooms |
| `player.js` | Player-mode runtime |
| `stress.js` | `?stress=1` harness |
| `memProbe.js` | `?memprobe=1` memory-footprint probe |

### Load order

Declarations must precede use at init time. All under `src/`:

```
lib/pixi.min.js → renderer.js → state.js → display.js → video.js → fogGeometry.js →
vttPlan.js → fog.js → tools.js → mapLoader.js → mapConvert.js → undo.js → sceneGroups.js →
sceneStore.js →
scenes.js → sceneManager.js → viewport.js → backup.js → grid.js → effects.js → toolbar.js →
player.js → input.js → stress.js → memProbe.js → render.js → minimap.js → controlPanel.js →
confirmDialog.js → floorPlan.js → moduleText.js → roomPanel.js → about.js → inline <script>
```

### Repo layout

Browser modules in `src/`, stylesheets in `src/css/`. The Electron shell (`main.js`,
`preload.js`), both HTML entry points, and `package.json` stay at the repo root. Docs in
`docs/`; settings, hooks and skills in `.claude/`, skills as `.claude/skills/<slug>/SKILL.md`.
`tools/` is outside the build glob and must stay that way.

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
yes" - see `applyModuleEntryToRoom`, which writes the name up front because the dialog's
focus change blurs that field and runs its commit.

`messageDialog` is the same file's one-button variant, for a statement that needs no answer.
Every error goes through it; no `alert()` ships.

## Rooms are polygons

1. **Never reorder the `polygons` array.** `rebuildFogFromPolygons` walks it in reverse, so
   array order IS fog compositing precedence. A feature needing its own ordering sorts a
   copy or carries a separate field.
2. **Never normalize a polygon from a fixed key list.** Backfilling a field must be an
   additive spread; a whitelist drops `cornerRadii` from every saved scene on load.
3. **The map is the interaction surface.** Selecting a room is the Select tool's job alone.
   Rectangle/Circle/Polygon clicks must keep drawing new rooms, including overlapping and
   nested ones.
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
  `fog.js`; its behavior is pixel output. New pure fog logic extends the `fogGeometry.js`
  kernel, which the canvas layer calls into.
- Deliberately untested, don't add tests here: `render.js`, `scenes.js`, `state.js`,
  `renderer.js`, `toolbar.js`, `player.js`, `mapLoader.js`, `input.js`, `sceneStore.js`,
  `stress.js`.
- **The rig is a last resort, not a development tool** - reading code is faster. Use it for
  an end result, what code cannot show, or a bug code cannot find. `/commit` smoke-tests the
  diff; `/release` runs the full set. Both block on red.
- **Never ask the DM to hand-verify what the rig can check.** Look, feel and performance at the
  table are theirs; correctness is yours. Backup, export and restore are the one exception and
  always get their hand test: the export's save dialog is native and cannot be driven.

## Guard hooks

Six fail-open hooks in `.claude/settings.json`, baselines beside them. **Every guarded file has
one**, and each explains its own fix when it fires. `guard-skill-hint.js` is the `PreToolUse`
one: it names the skill owning a file you edit.

## Conventions

- **No dated fix logs, changelog entries, or debugging narrative here.** Rules only;
  destinations are at the top, and process narrative goes nowhere.
- Code comments: keep the rule, one clause of why, and any warning about a specific trap.
  Cut named examples that disambiguate nothing, "an earlier version was tried", measurement
  dates and counts, restatements of the code, and anything duplicating this file.

## Running the app

No build step. `npm start` for the Electron app (after `npm install`). Local installers:
`npm run build` (Windows `.exe`), `build:mac` (`.dmg`), `build:linux` (`AppImage`).
**The DM runs `npm start` and the `.exe`. Never open or suggest Chrome.**

## Distribution and releases

Releases are built by **GitHub Actions** (`.github/workflows/release.yml`) on
`windows-latest`, `macos-latest` (universal `.dmg`) and `ubuntu-latest` in parallel,
because a Mac `.dmg` cannot be built on Windows.

**When to bump the version.** A bump means "a new app users can install", so bump **only
when a change touches the shipped app** (anything in `build.files`). Patch for normal
changes, minor for a notable feature, major for a breaking overhaul. Docs, tests and
`.claude/` tooling get a plain commit with **no bump and no tag**, and ride along into the
next release.

**To cut a release:** get the changes onto `main`, bump `version` in `package.json` to match
the tag, then on GitHub create the release with tag `vX.Y.Z`.

**Pipeline rules:**
- **Upload with `softprops/action-gh-release@v2`, NOT `electron-builder --publish`.**
  electron-builder only uploads to *draft* releases and silently skips otherwise. The
  workflow builds with `--publish never`, then softprops attaches the files.
- **Unsigned by deliberate choice.** `CSC_IDENTITY_AUTO_DISCOVERY=false` must stay set in
  the workflow env and the local Windows `build` script, or the mac build fails.
- Repo Actions settings need "Allow all actions" and `contents: write`.
- The portable `evermist-data` copyable-folder trick is **Windows-only**
  (`PORTABLE_EXECUTABLE_DIR`). Mac and Linux fall back to the OS-default per-user location.
