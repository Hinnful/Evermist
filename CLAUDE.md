# CLAUDE.md

Behavioral rulebook for this repo: the constraints you must obey. Rules only, imperative,
one clause of reason at most.

- How the app works → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Why a thing is shaped the way it is, and what was already tried → [docs/DECISIONS.md](docs/DECISIONS.md)
- **A size-guard hook enforces this file's shape: it may shrink, it may not grow.** If you
  are about to add a paragraph here, it belongs in one of the two files above.

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

`package.json` `build.files` has exactly two globs: `src/**/*.js` and `src/css/**/*.css`.

- A new `.js` in `src/` or a new `.css` in `src/css/` ships automatically.
- Anything OUTSIDE those two paths needs an explicit `build.files` entry.
- A runtime npm dependency is a third case: `build.files` carries per-package include and
  exclude rules (see the pdfjs-dist entries), and anything loaded as ESM additionally needs
  `asarUnpack`.
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
| `player.js` | Player-mode runtime |
| `stress.js` | `?stress=1` harness |

### Load order

Declarations must precede use at init time. All files under `src/`:

```
lib/pixi.min.js → renderer.js → state.js → display.js → video.js → fogGeometry.js →
fog.js → tools.js → mapLoader.js → undo.js → sceneStore.js → scenes.js → sceneManager.js →
viewport.js → backup.js → grid.js → toolbar.js → player.js → input.js → stress.js →
render.js → minimap.js → controlPanel.js → confirmDialog.js → moduleText.js → roomPanel.js →
inline <script> (last)
```

### Repo layout

Browser modules in `src/`, stylesheets in `src/css/`. The Electron shell (`main.js`,
`preload.js`), both HTML entry points, and `package.json` stay at the repo root. Docs in
`docs/`; project settings and hooks in `.claude/`. `tools/` is outside the build glob and
must stay that way.

## CSS

Eight files in `src/css/`, split by screen region: `base.css`, `controlPanel.css`,
`toolbar.css`, `roomCard.css`, `playerPane.css`, `legend.css`, `sceneManager.css`,
`overlays.css`.

- **`index.html` has no `<style>` block.** A guard hook blocks one in the head.
- **The `<link>` order in `index.html` IS the cascade.** `base.css` first (it defines
  `--ui-zoom`), `overlays.css` last, and `controlPanel.css` before `roomCard.css` because it
  defines `@keyframes cpAdvIn`, which must stay defined exactly once.
- **No `player-mode.css`.** The `body.player-mode` overrides deliberately sit next to what
  they override, in `toolbar.css` and `sceneManager.css`.
- No `@import`, no preprocessor, no runtime style injection.
- Don't add scoping schemes or cascade layers. Separate files bought findability and small
  diffs, not encapsulation; CSS is one global cascade regardless of file count.
- `splash.html` keeps its own inline `<style>`. It shares no rules with the app.

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

⚠️ 8 `alert()` calls still ship (in `backup.js`, `scenes.js`, `video.js`, `mapLoader.js`,
`sceneManager.js`). The codebase violates this rule today; sweeping them needs a
message-only variant of `confirmDialog`.

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

## Room card (`roomPanel.js`)

Layout, top to bottom: a **titleless drag bar** (six-dot grip + Close), the name field, the
description textarea, ONE unlabelled properties row (the Reveal/Half/Shroud `.cp-seg` pill,
then the corner-radius field pushed right), and Delete at full width behind a hairline.

- **Visibility is gated on selection only, never on the active tool**, so the card survives
  tool switches.
- **The description is the card's scarcest resource.** Don't add a label column or a second
  properties row without taking the height from somewhere other than the textarea.
- **No title on the drag bar, no underline or leading icon on the name field, no vertex
  readout, no radius-mode toggle.** Each was built and removed; see DECISIONS.md.
- **The name is just a FIELD**, with the same box and 10px text inset as the description.
  The 14px column is where *boxes* start, 24px is where *text* starts. Read the CSS comment
  on `.rp-name` before restyling it.
- **`_rpScreenToStyle()` is the only correct screen-px → pre-zoom-px conversion.** The
  mapping is **affine**: a slope plus a constant origin, both derived from measurement.
  Never reintroduce a bare `/ uiZoom`.
- Card position (`_rpManualPos`) is screen px, re-clamped every reposition, cleared on close.
- Description height is ONE global `localStorage` preference (`RP_DESC_H_KEY`), saved on
  **mouseup**, never per-room and never in a scene or backup. **CSS owns the bounds** via
  `.rp-desc`'s own min/max-height; don't add JS range constants.
- The radius field's target derives from `selectedVertexIndex` and is never stored.
- `refreshRoomPanel()` is the reflection hook. Called from `drawCursor()` and the paths that
  rewrite modes or reset polygons wholesale. **Not** from `setPolygonMode()`, which updates
  the pill in place so a rebuild can't steal field focus mid-edit.
- Room labels: `roomLabelFontPx(zoom)` is screen px and **clamped at both ends**. Placement
  is top-left INSIDE the room via `fitLabelBox()`, which scanline-samples in MAP units so the
  cached anchor is pan-independent. `_rpLabelCache` clears per scene.
- Pure kernel (unit-tested): `normalizeRoomFields`, `sanitizeRoomName`, `sanitizeRoomDesc`,
  `clampPanelPosition`, `ellipsizeToWidth`, `roomLabelFontPx`, `polygonRowSpans`,
  `cornerInsetAt`, `fitLabelBox`.

## Half-shroud

`poly.mode === 'half'` rides the reveal path in `applyPolygonToFog` at
`globalAlpha = 1 - fogHalfAlpha`. One branch, and it is **subtractive**.

- **Flatten the interior on the SCRATCH MASK, not on the fog.** A reveal clears
  cloud-erosion residue with a hard `clearRect`; a partial erase can't, because
  `destination-out` multiplies and the residue reads as blotchy density. Flattening the
  inset region to white on `_fogScratch` fixes it and keeps the feathered edge band.
- **It cannot re-fog already-clear ground.** A Half room overlapping a reveal shows no
  change in the overlap. Deliberate.
- `fogHalfAlpha` is ONE global `localStorage` value (`FOG_HALF_ALPHA_KEY`), never per-room,
  never in a scene or backup, and deliberately absent from Fog Reset.
- The Player needs nothing new: the stencil crosses as a PNG and partial alpha propagates
  for free.
- The toolbar's `#btn-half` brush is deliberately unwired. Only the card's pill and `T`
  reach this state.
- **Reverting this feature requires a data sweep**, not just a code revert. See DECISIONS.md.

## Module text (`moduleText.js`)

`initModuleText()` is called from `initRoomPanel()`. The room-field write stays in
`roomPanel.js` (`applyModuleEntryToRoom`), because that module owns the room.

- Scope is **campaign-level**: `localStorage` (`evermist.moduleText`), never a scene or a
  backup. Don't move it into `sceneStore.js`, which is keyed by scene id and would need a
  `DB_VERSION` bump.
- Store **parsed entries only**, never the raw file.
- **No auto-assign, no queue, no "fill all rooms."** Sub-locations mean one heading serves
  several polygons, so any 1:1 mapping desyncs.
- **No LLM and no network, ever.**
- `ROOM_DESC_MAX` is **20000**. Truncation is silent, so don't lower it without making it
  visible.
- Don't commit copyrighted module text. Test fixtures are **synthetic**.

### Parser rules - each one exists because a real book broke the previous version

- Match headings on `\p{Lu}`, never `[A-Z]`. The verified source is Russian and its
  sub-location letters are Cyrillic homoglyphs of Latin ones.
- A heading number may carry **one capital prefix** (`К12.`), part of the room's key. The
  prefix must touch the digits, so "В 1. Комнате" stays prose.
- A **prefixed** heading may have a lowercase name; a bare-numbered one may not. Same
  licence for a lowercase sub-letter (`N6e.`).
- A heading number may carry **one trailing letter**, a sub-location (`N6А.`), part of the
  key and displayed as written. Without it a whole building arrives as one entry.
- **Sub-locations sequence on UNIQUENESS of the letter under the parent number, never on
  letter order.** No ordinal survives the real data. The parent is the bound instead: a sub
  may sit on the current number or open the next one, but a sub numbered *below* the current
  room is a cross-reference and is dropped.
- A **single trailing period** is stripped. What disqualifies a line is ending mid-clause or
  carrying two sentences.
- Heading selection is **greedy numeric continuation per prefix**. Not
  longest-increasing-subsequence (a numbered list forms a longer chain and wins), and not one
  shared counter (it rejects the next chapter's low numbers).
- The sequence **prefers its immediate successor over a forward jump**
  (`MT_SUCCESSOR_LOOKAHEAD`), because a cross-reference is shaped exactly like a heading. It
  must NOT apply before the sequence has started (`prev > 0`). A test pins this.
- Homoglyph prefixes are **canonicalised for sequencing only, never for display**
  (`mtCanonPrefix`).
- Page furniture is identified by **"the same text with a DIFFERENT number attached"**, never
  by a repeat count, which would delete legitimate recurring sub-headings. A line with no
  number attached is untouchable. Digits fused against a capital condemn that key outright.
- **Paragraph recovery is load-bearing** (`mtEndsParagraph`). A real extraction has no blank
  lines at all. It fires on a short line followed by a capital and must NOT require a full
  stop. Its threshold hangs off `mtWrapWidth`, the **p90** of line lengths, because the wrap
  margin lives at the top of the distribution.
- **Tune thresholds against real text, never a synthetic fixture.**
- Two unprefixed chapters in one file collide. Guidance is one chapter at a time.
- **`parseModuleText` does not detect sidebars.** Don't add a classifier. A test pins the
  behaviour rather than endorsing it.

### File loading

Decode UTF-8 first and Windows-1251 second, both with `fatal: true`: a CP1251 file decodes
as UTF-8 into replacement characters rather than an error, so the order is the safeguard.
`_mtBinaryKind` names any other container format instead of parsing its bytes as prose.

### PDFs

`_mtIsPdf` checks raw magic bytes in the first KB and routes to the converter before any
decode.

- **The parse runs in a `utilityProcess`** (`src/pdfExtract.js`), forked per import and
  killed on reply, with a `PDF_EXTRACT_TIMEOUT_MS` backstop. Do not move it back into the
  main process. It can't go in the renderer either: pdfjs-dist is ESM-only.
- main.js resolves the pdfjs directory and hands it to the child. It is the only place that
  knows the asar rewrite. Handle all three of `message`, `exit` and the timeout.
- **Bytes cross as an ArrayBuffer, never a path.** Electron removed `File.path` in v32.
- Keep `pdfLayout.js` dependency-free.
- **COLUMNS FIRST, THEN LINES.** A two-column page's left and right lines share a baseline,
  so grouping by `y` first interleaves the columns sentence by sentence. Spanning lines cut
  the page into bands, which keeps a mid-page heading with its rooms.
- Leave page furniture in for `moduleText.js`; it identifies it better than coordinates can.

### Packaging traps - only a BUILT `.exe` shows these

- pdfjs-dist must be in `asarUnpack`; ESM resolves through real filesystem paths.
  `pdfExtract.js` does not need it (`utilityProcess.fork` resolves an asar-packed entry).
- **Set `GlobalWorkerOptions.workerSrc`.** With no `Worker` global, pdf.js builds a fake
  worker from it; unset, it guesses a file that isn't shipped.
- `build.files` ships only `pdf.min.mjs`, `pdf.worker.min.mjs` and the package's
  `package.json`, and excludes `@napi-rs/**`.
- **Re-run `npx electron-builder --win --dir` and exercise a real PDF whenever this path is
  touched.**

### Import panel - three controls: Choose file, Remove, Close. Do not add a fourth.

- No paste box, no Preview button, no explanatory paragraph. Errors explain themselves in
  the status line.
- **Importing happens on choose**, no confirm step. Three things keep that safe and all
  three must stay: an empty parse never writes, the panel lists what is loaded every time it
  opens, and Remove is present.
- **Clear `#mt-file-input.value` before opening the dialog.** A file input fires no `change`
  for the same file twice, so a repeat pick is silently dead without this.
- Shell is the app's floating-panel pattern at 320px (flat `#1a1a1c`, hairline border,
  `.cp-adv-head`/`.cp-adv-body`, stock `.cp-btn`), not the backup modal's `.glass-panel`.
  Keep the backdrop, the centring anchor, and the `zoom` + max-height rule.
- Remove sits **outside the scrolling body** behind a hairline (`.mt-foot`).
- The dropdown's **footer row is the only entry point**, and the dropdown sits inside the
  card in `.rp-ident` so `--ui-zoom` applies for free.
- **The dropdown acts on `click`; its `mousedown` only calls `preventDefault`.** That
  preventDefault stops the pointer blurring the name field and closing the list; acting one
  event later keeps a dialog out of the middle of a mouse gesture.

## Control-panel button identity

- A black inset pill (`.cp-tabs` / `.cp-seg`) means *pick one of these*. The selected option
  goes bare/blue inside it.
- An independent action or toggle is a `.cp-btn`: outlined at rest, outlined + blue-filled
  when `.active`. Never put one inside a pill.
- Value fields (`.cp-field`, `.cp-stepper`) use the light surface, not the black pill.
- A **destructive** action keeps the ordinary full-width `.cp-btn` shape plus
  `.cp-btn-danger` and a hairline footer (`.rp-foot`). The hairline is what stops it reading
  as the primary action. Don't shrink it to signal danger.

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
- **Testability follows from decoupling, not file count.** Don't chase testability by
  injecting render state into `fog.js`; its behavior is pixel output. Extend the
  `fogGeometry.js` kernel when new pure fog logic appears and leave the imperative canvas
  layer calling into it.
- Deliberately untested, don't add tests here: `render.js`, `scenes.js`, `state.js`,
  `renderer.js`, `toolbar.js`, `player.js`, `mapLoader.js`, `input.js`, `sceneStore.js`,
  `stress.js`.

## Guard hooks

Two `PostToolUse` hooks in `.claude/settings.json`, both fail-open so a bug in one never
wedges editing. Each feeds its reason back so you fix it in the same turn.

**`guard-blob.js`** (on `index.html`):
1. The inline `<script>` only ever shrinks, measured in non-blank lines and ratcheting down.
   If you trip it, move the added JS into a `src/` module. Only if the growth is genuinely
   wiring/init raise `maxLines` in `.claude/hooks/blob-baseline.json`.
2. No `<style>` before `<body>`. Scoped to the pre-`<body>` region because the body is full
   of inline SVG, which may legally carry its own `<style>`.

**`guard-claudemd.js`** (on this file): same ratchet, measured in bytes, baseline in
`.claude/hooks/claudemd-baseline.json`. If you trip it, the content belongs in
ARCHITECTURE.md or DECISIONS.md. Raise the baseline only for a genuinely new rule that
cannot be stated in the space freed by tightening an existing one.

## Conventions

- **No dated fix logs, changelog entries, or narrative debugging history in this file.**
  Rules only. Reasoning goes to `docs/DECISIONS.md`, explanation to `docs/ARCHITECTURE.md`,
  and process narrative goes nowhere.
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
`windows-latest`, `macos-latest` (universal `.dmg`) and `ubuntu-latest` in parallel, which
is required because a Mac `.dmg` cannot be built on Windows.

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
