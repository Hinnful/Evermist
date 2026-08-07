# CLAUDE.md

Behavioral rulebook for this repo: the constraints you must obey. Rules only, imperative,
one clause of reason at most.

- How the app works → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Why a thing is shaped the way it is, and what was already tried → [docs/DECISIONS.md](docs/DECISIONS.md)
- A rule that applies only inside one folder → that folder's own `CLAUDE.md`.
- A rule cluster that applies only to a few named files → a skill in `.claude/skills/`.
  `guard-skill-hint.js` fires on an edit to an owning file and names the skill; the pointers
  below are documentation, not the trigger.
- **A size-guard hook enforces this file's shape: it may shrink, it may not grow.** A
  paragraph you are about to add here belongs in one of the destinations above.

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
- Player view must have **zero UI**: no buttons, no cursor, no overlays.
- Fog must never be flat black. Blur + noise texture is required.
- Images up to 30MB / 10000×6000px. Never block the main thread on load; decode into an
  offscreen canvas asynchronously. No artificial size limit beyond the browser's ~16384px.

## What ships in the build

`package.json` `build.files` lists each shipped path. Only two entries are globs:
`src/**/*.js` and `src/css/**/*.css`; the rest name one file each.

- A new `.js` in `src/` or `.css` in `src/css/` ships automatically. Anything else needs its
  own entry.
- A runtime npm dependency also needs per-package include/exclude rules (see pdfjs-dist),
  and anything loaded as ESM needs `asarUnpack` too.
- **This whole class of bug is invisible to `npm start`, and the packaged app fails
  silently** (a missing stylesheet just renders unstyled). Verify with
  `npx electron-builder --win --dir` and run the real `.exe`.

## Code organization

Hard rules. "It's easier to just add it to the inline script" is never a valid reason.

- **Never add feature logic to the inline `<script>` in `index.html`.** It is wiring and
  init only: DOM/canvas refs, PixiJS init, module `init` calls, lifecycle listeners. A new
  concern gets a new `.js` file in `src/`.
- **Migrate-on-touch.** If you modify a concern that still lives in the blob, extract *that
  concern only* into its own module first, then build the new behavior there.
- **Shared mutable state has one home: `state.js`.** Move a piece there when a feature
  touches it. Grow it lazily; never move all globals at once.
- **No big-bang refactors.** The blob shrinks as a byproduct of feature work. If a task is
  purely file-shuffling with no feature attached, stop and confirm with the user.
- **Extend the module that owns the concern**, don't duplicate it elsewhere.

### Module map

| Module | Owns |
|---|---|
| `state.js` | Shared state: fog display constants, grid config, fog RAF handles, map/camera/pan-zoom/polygon/scene/auto-sync/player-sync/dirty flags |
| `renderer.js` | PixiJS/WebGL wrapper; map + DM fog GPU path |
| `render.js` | Render orchestration: `doRender`, `syncSize`, `scheduleRender`, `getViewportSize`/`calcViewport`, `drawCursor` |
| `fog.js` | Fog canvases, blur + cloud pipeline, reveal/hide, transitions |
| `fogGeometry.js` | Pure fog geometry + math kernel. Unit-tested |
| `vttPlan.js` | Pure UVTT floor-plan → room-polygon kernel. Unit-tested, dependency-free |
| `tools.js` | Drawing tools + polygon editing |
| `input.js` | DM mouse/wheel/keyboard, shape helpers, legend toggle. **Drag-drop is in toolbar.js, not here** |
| `undo.js` | Undo/redo for fog edits |
| `grid.js` | Grid config + render |
| `scenes.js` | Fog persistence + scene fade helpers |
| `sceneManager.js` | Scene CRUD, `switchScene`, scene-manager UI |
| `sceneStore.js` | IndexedDB read/write |
| `mapLoader.js` | Image-map loading + the shared progress-bar helpers used by backup.js and sceneManager.js |
| `viewport.js` | Pan/zoom, Sync View, Player map delivery, `scheduleAutoSync`, `dmVisibleRegion` |
| `minimap.js` | Minimap render + drag/zoom remote, view sync both ways, `minimapGetZoom`/`SetZoom`/`NudgeZoom` |
| `video.js` | Animated-map handling |
| `display.js` | Display detection |
| `backup.js` | Zip backup/restore |
| `toolbar.js` | DM UI control wiring + drag-drop. Calls `initRoomPanel` and `initControlPanel` last |
| `controlPanel.js` | Tabbed Fog/Grid/Player panel. Presentational layer over the hidden legacy controls |
| `roomPanel.js` | The room card + map room labels |
| `moduleText.js` | Module parsing, storage, and the name-field dropdown |
| `pdfLayout.js` | Pure PDF reading-order kernel. Unit-tested, dependency-free |
| `pdfExtract.js` | pdf.js in a `utilityProcess`. No `<script>` tag |
| `confirmDialog.js` | The app's only sanctioned confirmation dialog |
| `floorPlan.js` | Floor-plan lookup, the import question, and drawing the rooms |
| `player.js` | Player-mode runtime |
| `stress.js` | `?stress=1` harness |
| `memProbe.js` | `?memprobe=1` memory-footprint probe |

### Load order

Declarations must precede use at init time. All files under `src/`:

```
lib/pixi.min.js → renderer.js → state.js → display.js → video.js → fogGeometry.js →
vttPlan.js → fog.js → tools.js → mapLoader.js → undo.js → sceneStore.js → scenes.js →
sceneManager.js → viewport.js → backup.js → grid.js → toolbar.js → player.js → input.js →
stress.js → memProbe.js → render.js → minimap.js → controlPanel.js → confirmDialog.js →
floorPlan.js → moduleText.js → roomPanel.js → inline <script> (last)
```

### Repo layout

Browser modules in `src/`, stylesheets in `src/css/`. The Electron shell (`main.js`,
`preload.js`), both HTML entry points, and `package.json` stay at the repo root. Docs in
`docs/`; project settings, hooks and skills in `.claude/`, skills as
`.claude/skills/<slug>/SKILL.md`. `tools/` is outside the build glob and must stay that way.

### Rules kept outside this file

- Stylesheets and the `src/css/` cascade → `src/css/CLAUDE.md`, loaded when you touch a file
  in that folder.
- Room card, room labels, half-shroud, control-panel button identity → the `dm-ui` skill.
- Module text, parser rules, file loading, PDFs, packaging traps, import panel → the
  `module-text` skill.
- UVTT coordinates, winding-not-area, what the room import refuses → the `floor-plan` skill.

## Dialogs

**NEVER call `confirm()` or `alert()`. Use `confirmDialog` (`confirmDialog.js`).** A native
dialog is a separate OS window, and closing one leaves the page's focus desynced: the field
that was focused stays `document.activeElement` while the caret machinery lets go, so
clicking it places no caret and fires no `focus` event. Nothing inside the page can repair
it.

`confirmDialog` answers **asynchronously** via `onConfirm`/`onCancel`, so a caller that used
to write on `if (confirm(…))` must split into "what happens regardless" and "what happens on
yes". See `applyModuleEntryToRoom`: it writes the name up front, because the dialog's focus
change blurs the name field and runs its commit, which must find the new value already there.

⚠️ 8 `alert()` calls still ship (`backup.js`, `scenes.js`, `video.js`, `mapLoader.js`,
`sceneManager.js`). Sweeping them needs a message-only `confirmDialog` variant.

## Rooms are polygons

1. **Never reorder the `polygons` array.** `rebuildFogFromPolygons` walks it in reverse, so
   array order IS fog compositing precedence. A feature needing its own ordering sorts a
   copy or carries a separate field.
2. **Never normalize a polygon from a fixed key list.** Backfilling a field must be an
   additive spread; a whitelist drops `cornerRadii` from every saved scene on load.
3. **The map is the interaction surface.** Selecting a room is the Select tool's job alone.
   Rectangle/Circle/Polygon clicks must keep drawing new rooms, including overlapping and
   nested ones.
4. Rooms never reach the Player, so room notes are DM-only for free. No stripping guard
   needed.

## The render loop

- **`doRender` rides the PixiJS ticker** (`pumpDirtyRender`, registered in
  `initPixiRenderer` at `UPDATE_PRIORITY.HIGH`), and the frame cap lives on `ticker.maxFPS`.
  An rAF fallback covers `pixiApp === null`.
- **Do not "simplify" this into a self-scheduling rAF loop with its own throttle.** A
  throttle on top of a throttle is the phase bug this replaced.
- `videoFrameIntervalMs` is a `const` in `state.js` and `video.js` throttles the frame pump
  on it every frame. It is live; don't delete it as leftover FPS-slider code.

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

## Guard hooks

Four fail-open hooks in `.claude/settings.json`; baselines beside them in `.claude/hooks/`.
`guard-blob.js` (`index.html`), `guard-claudemd.js` (this file) and `guard-decisions.js`
(`docs/DECISIONS.md`) are `PostToolUse` size guards that explain themselves and their own fix
when they fire. `PreToolUse` `guard-skill-hint.js` names the skill that owns a file you edit.

## Conventions

- **No dated fix logs, changelog entries, or narrative debugging history here.** Rules only;
  the two destinations are at the top of this file, and process narrative goes nowhere.
- Code comments: keep the rule, one clause of why, and any warning about a specific trap.
  Cut named examples that disambiguate nothing, "an earlier version was tried", measurement
  dates and counts, restatements of the code, and anything duplicating this file.

## Running the app

No build step. `npm start` for the Electron app (after `npm install`). Local installers:
`npm run build` (Windows `.exe`), `npm run build:mac` (`.dmg`), `npm run build:linux`
(`AppImage`). Alternatively `npx serve .` and open `http://localhost:3000`; the Player view
opens as a second window.

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
