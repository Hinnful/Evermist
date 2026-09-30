# CLAUDE.md

Behavioral rulebook for this repo: the constraints you must obey. Rules only, imperative,
one clause of reason at most.

**Every doc answers one question.** This one answers *what must I never do?* A paragraph
that doesn't belongs elsewhere:

- How does it work? Present tense → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Why this shape, what was tried? Past tense → [docs/DECISIONS.md](docs/DECISIONS.md),
  plus one file per split-out topic in [docs/decisions/](docs/decisions/)
- What is it for, what will it never do? → [docs/PRODUCT.md](docs/PRODUCT.md)
- How do we work, and where does each instruction live? → [docs/PROCESS.md](docs/PROCESS.md)
- What comes next? → [docs/BACKLOG.md](docs/BACKLOG.md)
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

## Who owns what

- **The DM owns the product**: vision, ideas, steering, feedback, and whether the app is worth it.
- **Claude owns whether it works**: implementation, quality, testability, tests and maintenance.
  Never wait for approval on those.

## Habits

- **Check the ledger before re-proposing an idea or restoring removed code.** `docs/DECISIONS.md`
  and `docs/decisions/` hold every settled call.
- **Prove code is dead before deleting it**: no caller, no string lookup, no HTML or IPC reference.
- **A new persisted field must load safely on the previous release.** `/rollback` puts the DM
  back on it with the same data.
- **Prove a fix both ways**: the check fails without the fix and passes with it.
- **A check that flakes is suspect first.** Rule out the check before changing the app for it.
- **When a fix fails, say so and re-diagnose** from the evidence, never a second guess on the first.
- **Look-and-feel work is a throwaway prototype**, one at a time, for the DM to pick. It skips
  the rig and test gates until it is picked.

## Tech constraints

- Vanilla JS. No frameworks, no bundler, no build step.
- **No ES modules.** Plain `<script src="...">` only; `import`/`export` break on `file://`.
- **PixiJS (WebGL) is the render path** for both views, fog included. Canvas 2D only builds
  the fog mask. There is no Canvas 2D map fallback.
- Three HTML pages: `index.html` serves DM and Player (`?mode=player`), `stage.html` is the
  two-map shell, `splash.html` the boot splash.
- postMessage for DM → Player sync.
- Must work offline from `file://`.
- Player view has **zero UI**: no buttons, no overlays. Keep the cursor.
- Fog must never be flat black. Blur + noise texture is required.
- Images up to 30MB / 10000×6000px, decoded into an offscreen canvas asynchronously. Never
  block the main thread; no size limit beyond the browser's ~16384px.

## What ships in the build

`package.json` `build.files` lists what ships.

- A new `.js` under `src/` or `electron/`, or a `.css` in `src/css/`, ships automatically.
  Anything else needs its own entry.
- A runtime npm dependency needs per-package include/exclude rules (see pdfjs-dist); ESM
  also needs `asarUnpack`.
- **This whole class of bug is invisible to `npm start`, and the packaged app fails
  silently** (a missing stylesheet just renders unstyled). Verify with
  `npx electron-builder --win --dir` and run the real `.exe`.

## Code organization

- **Never add feature logic to the inline `<script>` in `index.html`.** It is wiring and
  init only: DOM/canvas refs, PixiJS init, module `init` calls, lifecycle listeners. A new
  concern gets a new `.js` file in the `src/` folder that owns its subsystem.
- **A module belongs to one subsystem folder**, and a file that would sit in two belongs in
  neither: split it. `src/` root holds only what every subsystem reads.
- **A set that grows by one more of the same thing is a folder, not a branch.** A tool, a
  material, a Player message and a column control each arrive as one file or one record.
- **Shared mutable state has one home: `state.js`.** Move a piece there when a feature
  touches it.
- **Restructuring is its own task.** Splits, moves and renames happen on the DM's yes to a
  stated scope, in their own commit, never inside a feature change, so a feature diff stays
  readable.
- **Extend the module that owns the concern**, don't duplicate it elsewhere.
- **Build nothing for a case that does not exist yet.** No option no caller passes, no
  wrapper around a single call, no branch for a state the app cannot reach. Delete it; git has it.

### Repo layout

Browser modules in `src/<subsystem>/`. Only `state.js` and `undo.js` sit at `src/` root, because every
subsystem reads them. Stylesheets in `src/css/`. The main process is `main.js` plus one file
per subject in `electron/`. The HTML pages, `preload.js` and `package.json` stay at the
repo root. Docs in `docs/`; settings, hooks and skills in `.claude/`, skills as
`.claude/skills/<slug>/SKILL.md`. `tools/` is outside the build glob and must stay that way.

### Rules kept outside this file

- Module map, main-process table, load order → `.claude/rules/modules.md`, loaded with app code.
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
- **Never run a rig set on the DM's machine while building** - not even `smoke`. A run is the
  DM's time. A cloud session runs it freely. `/commit`
  gates the diff and CI runs the full set against the built app on all three platforms. See the `rig` skill.
- **Never ask the DM to hand-verify what the rig can check.** Look, feel and performance are
  theirs; correctness is yours. Backup, export and restore are the exception - the save dialog is
  native and cannot be driven.

## Guard hooks

Twelve fail-open hooks in `.claude/settings.json`, baselines beside them. **Every guarded file
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
**The DM runs `npm start` and the `.exe`. Never ask the DM to open Chrome**; Claude may use
browser previews.

**Never put a window on the DM's screen.** The rig is the only sanctioned way to launch the
app; it parks every window off-screen. `npm start`, the stress and memprobe runs, a built
`.exe`, and the rig's own visible flag are the DM's to run and never yours. `guard-screen.js`
refuses them.

## Distribution and releases

**A shipping commit is a release.** `.github/workflows/release.yml` fires on a push to
`release/**` or `change/**`, never on `main`, and releases when `package.json` holds a version
with no tag. That commit's message becomes the release notes verbatim, so it is public
writing; `/commit` carries the rules.

**Push to a `release/**` or `change/**` branch, never to `main`.** The workflow's `land` job
fast-forwards `main` once the gate is green, and nothing public exists until then. A red gate
blocks that change alone.

**When to bump the version.** A bump now means "release this", so bump **only when a change
touches the shipped app** (anything in `build.files`). Patch for normal changes, minor for a
notable feature, major for a breaking overhaul. Docs, tests, `.claude/` tooling and a module
split that changes no behaviour get **no bump**; they take a `change/**` branch and land
without building anything.

**One version is one commit.** A version a red gate rejected keeps its number, and the fix
amends that commit.

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
