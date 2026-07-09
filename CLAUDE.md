# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. It is a behavioral rulebook — the constraints and conventions you must obey here. For conceptual explanation of how the app works, see [ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What this is

**Evermist** — a client-side web app for displaying D&D dungeon maps on a TV with fog of war.
No backend, no VTT features (tokens, initiative). Just: map + fog + grid + two screens.

## Tech decisions (constraints — respect these)

- Vanilla JS, no frameworks, no bundler.
- **No ES modules** — plain `<script src="...">` tags only; `import`/`export` break on `file://` protocol.
- **PixiJS (WebGL) is the primary render path** for both DM and Player. Canvas 2D is used only for fog compositing (fog.js canvases) and the Player's fog-on-top overlay. There is no Canvas 2D map fallback.
- Single HTML entry point: `index.html` serves both DM view and Player view (`?mode=player`).
- postMessage for DM → Player sync (works on `file://` in Chrome).
- Electron wrapper for desktop packaging (Windows `.exe`, macOS `.dmg`, Linux `AppImage`) — core app is identical to browser version.

## Key constraints

- Images up to 30MB / 10000×6000px — never block the main thread during load; decode into offscreen canvas asynchronously.
- Must work offline from `file://` protocol.
- Player view (`?mode=player`) must have zero UI — no buttons, no cursor, no overlays.
- Fog must not be flat black — blur + noise texture is required, not optional.
- No artificial image size limit; browser canvas max (~16384×16384px) is the only hard ceiling.
- Browser-runtime modules live in `src/`; a new one is picked up by the `src/**/*.js` glob in `package.json` `build.files` automatically. A new `.js` placed OUTSIDE `src/` still needs an explicit `build.files` entry or it won't ship in the Electron package.

## Code organization (READ BEFORE ADDING ANY FEATURE)

The inline `<script>` in `index.html` is an oversized blob (~2400+ lines) inherited from an earlier era. **It is being actively dissolved, not extended.** Treat it as legacy, not as the home for new work.

Hard rules — these override convenience, and "it's easier to just add it to the inline script" is never a valid reason:

- **Never add new feature logic to the inline script in `index.html`.** A new concern gets a **new `.js` file**. The entry script is for wiring modules together and kicking off init — nothing else, long-term.
- **Migrate-on-touch.** When you modify a concern that still lives in the inline blob, extract *that concern* (and only that concern) into its own module as the first half of the change, then build the new behavior in the clean module. Do not extract unrelated code in the same change.
- **Shared mutable state has one home: `state.js`.** Today state is scattered as top-level globals in the inline script. When a feature touches a piece of state, move *that piece* into `state.js` and reference it from there. Grow `state.js` lazily — never attempt to move all globals at once.
- **No big-bang refactors.** Never schedule or perform a standalone "refactor the blob" pass. The blob shrinks only as a byproduct of normal feature work under the rules above. If a task is purely cosmetic file-shuffling with no feature attached, stop and confirm with the user first.
- **Target module map** — extracted modules that already exist: `state.js` (shared state — fog display constants, grid config, fog RAF handles, and all map/camera/pan-zoom/polygon/scene/auto-sync/player-sync/dirty-flag state migrated from the inline blob), `viewport.js` (pan/zoom/sync-view, Player map delivery, `scheduleAutoSync`), `grid.js` (grid config + render), `scenes.js` (fog persistence + scene fade helpers), `video.js` (animated-map handling), `display.js` (display detection), `backup.js` (zip backup/restore), `fogGeometry.js` (pure fog geometry + math kernel — unit-tested), `toolbar.js` (DM-only UI control wiring — toolbar, sliders, fog color, anim presets, poly context panel, scene/backup modals, player controls, section toggles, UI-scale), `sceneManager.js` (scene CRUD, switchScene, scene-manager UI — initScenes/createNewScene/switchScene/renderSceneManager and friends), `player.js` (player-mode runtime — cloud-texture pre-gen, PLAYER_READY handshake, resize handler, DM message handler, player pan/zoom), `input.js` (DM mouse/wheel handlers, keyboard shortcuts, shape helpers, legend toggle — drag-drop is NOT here, it lives in toolbar.js), `mapLoader.js` (image-map loading + shared progress-bar helpers — `loadMapFromFile`, `showMapProgress`, `updateMapProgress`, `hideMapProgress` — used by backup.js and sceneManager.js), `render.js` (render orchestration — dirty-flag dispatcher `doRender`, canvas sizing `syncSize`, RAF `scheduleRender`, viewport helpers `getViewportSize`/`calcViewport`, cursor/polygon overlay `drawCursor`). `fog.js` and `tools.js` already exist — extend them, don't duplicate their concerns elsewhere.
- **Testability follows from decoupling, not file count.** Most of `fog.js` — Canvas-2D compositing, the RAF anim/transition loops, the Player fog-on-top path — is not `node:test`-testable no matter how state is injected: its behavior *is* pixel output, and there is no `canvas` dep. So don't chase testability by injecting render state. The pure geometry/math (polygon inset, rounded-path building, DPI-radius scaling, anim offset/alpha/blend arithmetic) lives in `fogGeometry.js`, which takes args and returns values with zero DOM/global reads — that is what's covered by tests. Extend that kernel when new pure fog logic appears; leave the imperative canvas layer calling into it.

Mechanics that constrain all of the above (do not violate): no ES modules (`import`/`export` break on `file://`), plain `<script src>` only, load order matters (declarations must precede use at init), and a new module belongs in `src/` (shipped via the `src/**/*.js` glob — see Key constraints above for the outside-`src/` exception).

**Repo layout:** browser-runtime modules live in `src/` and load via `<script src="src/…">` from `index.html`. The Electron shell (`main.js`, `preload.js`), the two HTML entry points (`index.html`, `splash.html`), and `package.json` stay at the repo root. Docs (`ARCHITECTURE.md`, `Fog_animation_approaches.md`) live in `docs/`.

**Load order** (critical — declarations must precede their use at initialization time; all module files are under `src/`):
```
lib/pixi.min.js → src/renderer.js → src/state.js → src/display.js → src/video.js → src/fogGeometry.js →
src/fog.js → src/tools.js → src/mapLoader.js → src/undo.js → src/sceneStore.js → src/scenes.js → src/sceneManager.js → src/viewport.js → src/backup.js → src/grid.js → src/toolbar.js → src/player.js → src/input.js → src/stress.js → src/render.js →
inline <script> (loads last)
```

## Conventions

- **Do not write dated fix logs, changelog entries, or narrative debugging history into this file.** CLAUDE.md is behavioral rules only. Decisions and post-mortems go in commit messages; conceptual explanation goes in ARCHITECTURE.md.
- Tests use Node's built-in test runner and only cover pure-function modules that export via `module.exports`. Add tests there, not against DOM-coupled code.

## Running the app

No build step. For the Electron desktop app: `npm start` (requires `npm install` first). Build a local installer with `npm run build` (Windows portable `.exe`), `npm run build:mac` (`.dmg`), or `npm run build:linux` (`AppImage`).

Alternatively, `npx serve .` and open `http://localhost:3000` for browser testing. Player view opens automatically as a second window.

**Tests** use Node's built-in test runner (`node:test`). Run all: `npm test`. Run a single file: `node --test test/grid.test.js`. Test files live in `test/`.

## Distribution & releases

Building a Mac `.dmg` cannot be done on Windows locally, so releases are built in the cloud by **GitHub Actions** (`.github/workflows/release.yml`), which builds on `windows-latest`, `macos-latest` (universal `.dmg`), and `ubuntu-latest` in parallel and attaches `dist/*.{exe,dmg,AppImage}` to the release.

**To cut a release:**
1. Get the changes onto `main` (push directly or via PR-merge).
2. Bump `version` in `package.json` to match the tag you're about to create (the `version` field names the installer files; the tag triggers the build — keep them in sync).
3. On GitHub: Releases → Draft a new release → create a new tag `vX.Y.Z` on publish → Publish.

**Pipeline gotchas (do not regress):**
- **Use `softprops/action-gh-release@v2` to upload, NOT `electron-builder --publish`.** electron-builder's own publisher only uploads to *draft* releases; creating the release as published via the web UI made it silently skip the upload (build still went green, but no installers attached). softprops uploads regardless of draft/published state. The workflow builds with `electron-builder --publish never`, then softprops attaches the files.
- **Unsigned, by deliberate choice** (no paid certs). `CSC_IDENTITY_AUTO_DISCOVERY=false` is set in the workflow env (and the local Windows `build` script) so electron-builder doesn't hunt for a signing identity — without it the mac build fails. Users get a one-time OS security warning; the README's "First-time open" section explains how to bypass it per platform.
- Repo Actions settings must allow third-party actions ("Allow all actions") and grant `contents: write` (set in the workflow) for the upload to work.
- The portable `evermist-data` copyable-folder trick is **Windows-only** (`PORTABLE_EXECUTABLE_DIR`, `main.js`). Mac/Linux fall back to the OS-default per-user data location — the app works, it just isn't a copyable self-contained folder there. Not yet addressed.

## How things work (see ARCHITECTURE.md)

These are explained conceptually in [ARCHITECTURE.md](docs/ARCHITECTURE.md); read there before touching them, and read the code for exact behavior:

- **Fog** — the data canvas, blur + cloud-texture pipeline, DM-transparent / Player-opaque split, and the Player's Canvas-2D fog-on-top (the seam fix). See ARCHITECTURE.md, "How the fog works".
- **Two-window sync** — postMessage, map-as-URL delivery, Auto/Manual, Sync View. See ARCHITECTURE.md, "How the two windows stay in sync".
- **Backup** — zip export/restore via the Electron shell. See ARCHITECTURE.md, "Backing up your maps".
- **File roles** — what each module owns. See ARCHITECTURE.md, "The files".

Concerns that live mostly in code (no dedicated doc): scene management (IndexedDB via `sceneStore.js`, 5s auto-save debounce, `switchScene` guarded by `switchGeneration`), video map support (`video.js`, filesystem storage under `userData/maps/`), polygon editing (`tools.js`, Select tool), grid (`grid.js`), and portable data (`main.js`, `PORTABLE_EXECUTABLE_DIR`). Follow the migrate-on-touch rule when extending any of them.
