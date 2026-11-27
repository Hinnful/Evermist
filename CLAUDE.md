# CLAUDE.md

The technical rulebook: what you must never do to the code, the build and the DM's machine. Rules only,
imperative, one clause of reason at most. How we work is in `.claude/rules/process.md`, which loads with this
file in every session; its table says which other document to read, and when. A test keeps each file under
200 lines.

**A doc grows only by a decision.** Add a rule here only after trying to tighten or relocate an existing one;
if it still does not fit, raise `maxBytes` in `.claude/hooks/claudemd-baseline.json` by hand and say so. **The
ledgers are meant to grow**: when one gets too big to read whole, move its largest `##` section to its own
file and leave a pointer, never delete an entry.

## What this is

**Evermist** - a desktop app that shows D&D maps on a TV with fog of war and runs the DM's prep and fights on
the DM's screen. No backend. No tokens or dice on either screen; what reaches the TV is listed in
`docs/PRODUCT.md`. One or two maps at a time.

## Tech constraints

- Vanilla JS. No frameworks, no bundler, no build step.
- **No ES modules.** Plain `<script src="...">` only; `import`/`export` break on `file://`.
- **PixiJS (WebGL) is the render path** for both views, fog included. Canvas 2D only builds the fog mask.
  There is no Canvas 2D map fallback.
- Three HTML pages: `index.html` serves DM and Player (`?mode=player`), `stage.html` is the two-map shell,
  `splash.html` the boot splash.
- postMessage for DM → Player sync. Must work offline from `file://`.
- Player view has **no controls**: no buttons, menus or hints. The turn order is its one overlay. Keep the
  cursor.
- Fog must never be flat black. Blur + noise texture is required.
- Images up to 30MB / 10000×6000px, decoded into an offscreen canvas asynchronously. Never block the main
  thread; no size limit beyond the browser's ~16384px.
- **Prove code is dead before deleting it**: no caller, no string lookup, no HTML or IPC reference.
- **A new persisted field must load safely on the previous release.** `/rollback` puts the DM back on it
  with the same data.

## What ships in the build

`package.json` `build.files` lists what ships.

- A new `.js` under `src/` or `electron/`, or a `.css` in `src/css/`, ships automatically. Anything else needs
  its own entry.
- A runtime npm dependency needs per-package include/exclude rules (see pdfjs-dist); ESM also needs
  `asarUnpack`.
- **This whole class of bug is invisible to `npm start`, and the packaged app fails silently**. Verify with
  `npx electron-builder --win --dir` and run the real `.exe`.
- **Never write or commit `src/ui/changelogData.js`.** `build-changelog.js` writes it.

## Code organization

- **Never add feature logic to the inline `<script>` in `index.html`.** It is wiring and init only: DOM/canvas
  refs, PixiJS init, module `init` calls, lifecycle listeners. A new concern gets a new `.js` file in the
  `src/` folder that owns its subsystem.
- **A module belongs to one subsystem folder**, and a file that would sit in two belongs in neither: split it.
  `src/` root holds only what every subsystem reads.
- **A set that grows by one more of the same thing is a folder, not a branch.** A tool, a material, a Player
  message and a column control each arrive as one file or one record.
- **State two subsystems write lives in `state.js`**; `globals.test.js` fails cross-folder writes.
- **Extend the module that owns the concern**, don't duplicate it elsewhere.
- **Build nothing for a case that does not exist yet.** No option no caller passes, no wrapper around a single
  call, no branch for a state the app cannot reach. Delete it; git has it.

Browser modules live in `src/<subsystem>/`; only `state.js` and `undo.js` sit at `src/` root, because every
subsystem reads them. Stylesheets in `src/css/`. The main process is `main.js` plus one file per subject in
`electron/`. The HTML pages, `preload.js` and `package.json` stay at the repo root. Docs in `docs/`; settings,
hooks, rules and skills in `.claude/`. `tools/` is outside the build glob and must stay that way.

Rules kept with the code they bind: the module map and load order in `.claude/rules/modules.md`; button
identity and the look in `.claude/rules/design-system.md`; the cascade in `src/css/CLAUDE.md`; the dock, Room
tab, room labels and half-shroud in the `dm-ui` skill; module text, PDFs and the import panel in `module-text`;
UVTT coordinates and the room import in `floor-plan`; driving the rig in `rig`.

## Dialogs

**NEVER call `confirm()` or `alert()`. Use `confirmDialog` (`confirmDialog.js`).** A native dialog is a
separate OS window, and closing one desyncs the page's focus beyond any in-page repair.

`confirmDialog` answers **asynchronously** via `onConfirm`/`onCancel`, so a caller that used to write on
`if (confirm(…))` must split into "what happens regardless" and "what happens on yes" - see
`applyModuleEntryToRoom`. `messageDialog` is its one-button variant; every error goes through it.

## Rooms are polygons

1. **Only placing a new room or piece reorders `polygons`.** `rebuildFogFromPolygons` walks it backwards:
   index 0 wins the fog. Anything else sorts a copy or keeps its own field.
2. **Never normalize a polygon from a fixed key list.** Backfilling a field must be an additive spread; a
   whitelist drops `cornerRadii` from every saved scene on load.
3. **The map is the interaction surface.** Selecting is the Select tool's job alone; a shape tool's click
   keeps drawing, overlapping and nested rooms included.
4. Rooms never reach the Player, so room notes are DM-only for free; no stripping guard.
5. **Map effects live in `effects`, never in `polygons`** (`effects.js`), and are called effects, never
   tokens. They are the same record with a `material` where a room has a fog `mode`, and persist alongside
   rooms - scene, backup, undo.

## The render loop

- **`doRender` rides the PixiJS ticker** (`pumpDirtyRender`, registered in `initPixiRenderer` at
  `UPDATE_PRIORITY.HIGH`), and the frame cap lives on `ticker.maxFPS`. An rAF fallback covers
  `pixiApp === null`.
- **Do not "simplify" this into a self-scheduling rAF loop with its own throttle.** A throttle on top of a
  throttle is the phase bug this replaced.
- `videoFrameIntervalMs` (`state.js`) throttles `video.js`'s frame pump every frame. It is live; don't delete
  it as leftover FPS-slider code.

## Testing

- Node's built-in runner: `npm test` for all, `node --test test/x.test.js` for one, in `test/`.
- **`npm test` and `npm run lint` hold the house rules.** A file past a limit, listed in
  `test/houseRules.allow.json` or `eslint-suppressions.json`, may only shrink.
- **Only pure-function modules that export via `module.exports`.** Don't write tests against DOM-coupled code.
- **Testability follows from decoupling, not file count.** Don't inject render state into `fog.js`; its
  behavior is pixel output. New pure fog logic extends `fogGeometry.js`.
- Never add unit tests for `render.js`, `scenes.js`, `state.js`, `renderer.js`, `toolbar.js`, `player.js`,
  `mapLoader.js`, `input.js`, `sceneStore.js`, `stress.js`.

Fail-open hooks in `.claude/settings.json` guard the screen, rig sets, stashes and shipping, name the skill and
ratchet the inline script and this file. Every other house rule is a test, and each failure says how to fix it.

## Conventions

- **No dated fix logs, changelog entries, or debugging narrative here.** Rules only.
- Code comments: keep the rule, one clause of why, and any warning about a specific trap. Cut named examples
  that disambiguate nothing, "an earlier version was tried", measurement dates and counts, and restatements of
  the code.
- **Write no sentence that already sits in another file.** Explain a trap once, at the line where someone hits
  it; a module's purpose and its rejected shapes stay in the docs. To connect two places, name the file.
- **Comments stay at or under 20% of shipped JavaScript**, codebase-wide. `node tools/comment-density.js`
  reports it, and `--verify` diffs comment-stripped code against HEAD after a comment-only pass.

## Running the app

No build step. `npm start` for the Electron app (after `npm install`). Local installers: `npm run build`
(Windows `.exe`), `build:mac` (`.dmg`), `build:linux` (`AppImage`). **The DM runs `npm start` and the
`.exe`.** Claude may use browser previews.

**Never kill an Evermist process**, a background copy included: it may be the DM's open app. Ask the DM to
quit it.

**Never put a window on the DM's screen.** The rig is the only sanctioned way to launch the app; it parks every
window off-screen. `npm start`, the stress and memprobe runs, a built `.exe`, and the rig's own visible flag
are the DM's to run and never yours. `guard-screen.js` refuses them.

## The release pipeline

`.github/workflows/release.yml` fires on a push to `release/**` or `change/**`, never on `main`, and releases
when `package.json` holds a version with no tag. How it runs: `docs/architecture/releases.md`.

- **Upload with `softprops/action-gh-release@v3`, NOT `electron-builder --publish`.** electron-builder only
  uploads to *draft* releases and silently skips otherwise.
- **The action creates a DRAFT and carries no `files:`.** Files go up one at a time with retries, and the
  draft turns public only once every size matches. `uploads.github.com` 500s on the 100MB+ installers, and a
  parallel upload loses every file in flight to the first failure.
- **Unsigned by deliberate choice.** `CSC_IDENTITY_AUTO_DISCOVERY=false` must stay set in the workflow env
  and the local Windows `build` script, or the mac build fails.
- **Never redirect `userData` beside the `.exe` again** - the old portable folder orphaned a library on
  upgrade.
- **Windows ships an NSIS installer, not portable.** A portable build extracts to a temp folder and cannot
  replace itself, which kills auto-update.
- **Every release must carry `latest*.yml` and `*.blockmap`**, or electron-updater finds nothing and every
  installed copy silently stops updating - in both directions, rollback included.
  `tools/check-update-metadata.js` guards it per platform.
