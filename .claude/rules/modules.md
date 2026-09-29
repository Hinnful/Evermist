---
paths:
  - "src/**"
  - "electron/**"
  - "index.html"
  - "main.js"
  - "preload.js"
---

# Where code lives

Loaded when you work on app code. A new module gets a row here and a line in `docs/architecture/module-map.md`; `guard-architecture.js` checks both.

## Module map

| Module | Owns |
|---|---|
| `state.js` | Shared state: fog constants, grid config, fog RAF handles, and every dirty flag |
| `i18n/i18nPlan.js` | Pure interface-language kernel: lookup, `{name}` fill, plural pick. Tested |
| `i18n/ru.js` | The Russian dictionary, keyed by the English text. Data only |
| `i18n/i18n.js` | The interface language: `t()`, the pass that swaps on-screen English, the About switch |
| `render/renderer.js` | PixiJS/WebGL wrapper: the context, the map sprite, the texture pool |
| `render/playerFogPass.js` | The Player's fog: one full-screen GPU pass and its shaders |
| `render/dmFogLayer.js` | The DM's fog: map-sized sprites, crossfade, cloud mask |
| `render/render.js` | Render orchestration: `doRender`, `syncSize`, `scheduleRender`, `drawCursor` |
| `fog/fogClouds.js` | The drifting noise texture, built once and shared |
| `fog/fog.js` | Fog canvases, the blur + cloud pipeline, reveal/hide |
| `fog/fogAnim.js` | Fog on a clock: the drift, the reveal crossfade, the scene cover, the colour ease |
| `fog/fogControls.js` | The Fog tab's controls: anim presets, sliders, colour, feather, half-shroud, doors |
| `fog/fogGeometry.js` | Pure fog geometry kernel. Tested |
| `fog/fogColor.js` | Pure fog colour kernel: base, tint, the step between two, a scene's settings. Tested |
| `shapes/doorGeometry.js` | Pure door-notch kernel. Tested |
| `rooms/vttPlan.js` | Pure UVTT floor-plan → room-polygon kernel. Tested, dependency-free |
| `shapes/roomOps.js` | Pure Join/Trim/Cut kernel. Tested |
| `shapes/shapeDetail.js` | Pure kernel: curves, radii and doors across a repair. Tested |
| `shapes/tools.js` | The tool in hand, shared tool state, the click registry |
| `shapes/shapeCommit.js` | A drawn shape into a room, an effect or a repair; every refusal |
| `shapes/toolPoly.js` | The Polygon tool: a vertex per click, and the two ways it closes |
| `shapes/presetGeometry.js` | Pure effect-preset kernel: sizes, outlines, labels. Tested |
| `shapes/toolPreset.js` | Effect presets: the size row, the cursor preview, the wheel, placing |
| `shapes/toolShapes.js` | The drag-a-shape tools: rectangle, circle, cone |
| `shapes/toolBrush.js` | The fog brush: the queued stroke and the pass that paints it |
| `shapes/toolDoor.js` | The Door tool and its notch in the fog |
| `shapes/toolCut.js` | The Cut tool and the two pieces it leaves |
| `shapes/shapeMarkers.js` | The corner and hole-hatch markers a picked shape's chrome draws |
| `shapes/toolPreview.js` | What a tool draws before it is committed |
| `shapes/shapeHit.js` | Pure hit-test kernel: point-in-room, distance to a wall, where along it. Tested |
| `shapes/shapeSelect.js` | The selection: its levels, hand edits, outline drawing |
| `shapes/shapeBox.js` | The bounding box, its handles, rotate, scale |
| `shapes/shapeClipboard.js` | Copy, paste, duplicate, across scene switches |
| `shapes/shapeMenu.js` | The one shape button and its right-click flyout |
| `ui/input.js` | DM mouse/wheel/keyboard, legend. **Drag-drop is in `scenes/dragDrop.js`** |
| `undo.js` | Undo/redo for fog edits |
| `render/effects.js` | Map effects: the `effects` array's model and its meshes |
| `render/effectMaterials.js` | One record per material: ramp, warmth, swatch |
| `render/effectShader.js` | An effect's two fragment passes and their vertex cap |
| `render/grid.js` | Grid config + render |
| `render/gridCalibrate.js` | The calibration square that fits the grid to the map |
| `scenes/scenes.js` | Fog persistence + scene fade helpers |
| `scenes/sceneManager.js` | Scene CRUD and the library popup around the list |
| `scenes/sceneCards.js` | The library list: cards, group sections, reorder drag |
| `scenes/sceneDelete.js` | The trash and its undo |
| `scenes/mapImport.js` | Import: accepted kinds, the batch loop, video maps to disk |
| `scenes/sceneSwitch.js` | `switchScene` and each of its steps |
| `scenes/sceneGroups.js` | Group names on scenes; heading order + collapse. Tested |
| `scenes/sceneStore.js` | IndexedDB read/write |
| `scenes/mapLoader.js` | Image-map loading + progress-bar helpers |
| `scenes/mapConvert.js` | Animated-map shrink at import. `fitInsideBox` tested |
| `render/viewport.js` | Pan/zoom, fit, Sync View, the camera a push carries |
| `render/mapTurn.js` | My seat: the DM map turned in quarter steps, and client ↔ view conversion |
| `render/ping.js` | The ping at a map point, drawn in both views |
| `player/playerWindow.js` | The Player window: opening, warming, what it gets |
| `player/panes.js` | Two-column mode: the columns, the divider, the messages sent to them |
| `player/stageWindow.js` | The two-map Player window, DM side |
| `player/stage.js` | The Player window in two-map mode: a Player in each half, the chasm between |
| `player/minimap.js` | Minimap render, drag/zoom remote, two-way view sync, zoom nudge |
| `render/video.js` | Animated-map handling |
| `render/videoDiag.js` | Video diagnostics overlay and disk log |
| `render/display.js` | Display detection |
| `scenes/backup.js` | Zip backup/restore, including a picked or dropped `.zip` |
| `scenes/dragDrop.js` | What a file dropped on the DM window becomes |
| `ui/toolbar.js` | DM UI wiring. Calls `initRoomPanel` and `initControlPanel` last |
| `ui/colorPicker.js` | The fog colour picker: square, hue strip, hex field, HSV maths |
| `ui/controlPanel.js` | Tabbed Fog/Grid/Player panel over the hidden legacy controls |
| `rooms/roomPanel.js` | Map room labels and the pure geometry that places them |
| `rooms/roomCard.js` | The room card: fields, placement, drag |
| `content/moduleText.js` | Module parsing, storage, name-field dropdown |
| `content/moduleTextPanel.js` | The import panel and the name-field dropdown. Parses nothing |
| `content/pdfLayout.js` | Pure PDF reading-order kernel. Tested, dependency-free |
| `content/pdfExtract.js` | pdf.js in a `utilityProcess`. No `<script>` tag |
| `ui/confirmDialog.js` | The app's only sanctioned confirmation dialog |
| `ui/about.js` | The About block: mark, version, repo |
| `ui/changelogData.js` | The release list. GENERATED; never edit it |
| `ui/changelog.js` | The What’s new panel |
| `ui/updater.js` | Update toast, About's update line, restart button |
| `ui/musicPlan.js` | Pure music kernel: link parsing, filenames, the fade curve. Tested |
| `ui/music.js` | The music bubble: track library and playback |
| `ui/musicDownload.js` | Add music panel |
| `combat/combatPlan.js` | Pure fight kernel: HP sum, order, a row's copy. Tested |
| `combat/fightPlan.js` | Pure: the fight list, its save shape, a backup merge. Tested |
| `combat/attackLine.js` | Pure: attacks read from a stat block. Tested |
| `combat/multiattack.js` | Pure: Multiattack reading. Tested |
| `combat/attackPills.js` | Attack pills and glyphs |
| `combat/bestiaryPlan.js` | Pure bestiary kernel. Tested |
| `combat/combatTracker.js` | The fight table: rows, name search, saving |
| `combat/combatStatBlock.js` | The stat block popup |
| `combat/combatFights.js` | The fight picker and its list |
| `combat/statBlockParse.js` | Pure stat block parser. Tested |
| `combat/statBlockBook.js` | Pure: a book into stat blocks, and the clean-read gate. Tested |
| `combat/statBlockImport.js` | The link queue and the book import |
| `combat/bestiary.js` | The bestiary: table, filters, selection |
| `combat/bestiaryPage.js` | A bestiary monster's page |
| `rooms/floorPlan.js` | Floor-plan lookup, the import question, and drawing the rooms |
| `player/player.js` | Player-mode runtime: the loading card, the handshake, resize, pan/zoom |
| `player/playerMap.js` | A map landing on the Player: cover, fog mask, image or video |
| `player/playerMessages.js` | The Player's inbox: one handler per message the DM sends |
| `player/paneRuntime.js` | A column's inbox from the shell |
| `dev/stress.js` | `?stress=1` harness |
| `dev/memProbe.js` | `?memprobe=1` memory probe |

## The main process

One file per subject in `electron/`, each registering its own IPC on require. `main.js` keeps
the windows, the display push and the app lifecycle, and hands every module its paths.

| Module | Owns |
|---|---|
| `electron/videoFiles.js` | An animated map's file on disk |
| `electron/music.js` | The music folder as the library, and the downloader that fills it |
| `electron/floorPlan.js` | The `.dd2vtt` sitting beside a map on disk |
| `electron/diagLog.js` | The playback log every window writes to, and its rotation |
| `electron/updates.js` | The update check, download, About's state |
| `electron/macUpdate.js` | The Mac's swap and relaunch |
| `electron/pdfText.js` | PDF text extraction, in a process of its own |
| `electron/backupZip.js` | What goes into a backup zip, and what comes back out |
| `electron/statBlockFetch.js` | A monster page, in a hidden window |

## Load order

Declarations must precede use at init time. All under `src/`:

```
i18n/i18nPlan.js → i18n/ru.js → i18n/i18n.js → lib/pixi.min.js → lib/polygon-clipping.umd.js → render/renderer.js → render/playerFogPass.js →
render/dmFogLayer.js → state.js → render/display.js → render/video.js → render/videoDiag.js →
fog/fogGeometry.js → fog/fogColor.js → shapes/doorGeometry.js → shapes/presetGeometry.js → rooms/vttPlan.js →
fog/fogClouds.js → fog/fog.js → fog/fogAnim.js → fog/fogControls.js → shapes/roomOps.js →
shapes/shapeDetail.js → shapes/shapeCommit.js → shapes/toolPoly.js → shapes/toolShapes.js →
shapes/toolPreset.js → shapes/toolBrush.js → shapes/toolDoor.js → shapes/toolCut.js → shapes/shapeMarkers.js →
shapes/toolPreview.js →
shapes/tools.js → shapes/shapeHit.js → shapes/shapeSelect.js → shapes/shapeBox.js →
shapes/shapeClipboard.js → scenes/mapLoader.js → scenes/mapConvert.js → undo.js →
scenes/sceneGroups.js → scenes/sceneStore.js → scenes/scenes.js → scenes/sceneManager.js →
scenes/sceneCards.js → scenes/sceneDelete.js → scenes/mapImport.js → scenes/sceneSwitch.js →
render/viewport.js → render/mapTurn.js → render/ping.js → player/playerWindow.js → player/panes.js → player/stageWindow.js →
scenes/backup.js → render/grid.js → render/effectMaterials.js → render/effectShader.js →
render/effects.js → scenes/dragDrop.js → ui/toolbar.js → shapes/shapeMenu.js → player/player.js →
player/playerMap.js → player/playerMessages.js → player/paneRuntime.js → ui/input.js →
dev/stress.js → dev/memProbe.js → render/render.js → render/gridCalibrate.js → player/minimap.js →
ui/colorPicker.js → ui/controlPanel.js → ui/confirmDialog.js → rooms/floorPlan.js →
content/moduleText.js → content/moduleTextPanel.js → rooms/roomPanel.js → rooms/roomCard.js →
ui/changelogData.js → ui/changelog.js → ui/about.js → ui/updater.js → ui/musicPlan.js →
ui/music.js → ui/musicDownload.js → combat/combatPlan.js → combat/fightPlan.js →
combat/multiattack.js → combat/attackLine.js → combat/attackPills.js → combat/bestiaryPlan.js →
combat/combatStatBlock.js → combat/statBlockParse.js → combat/statBlockBook.js →
combat/statBlockImport.js →
combat/bestiaryPage.js → combat/bestiary.js → combat/combatTracker.js → combat/combatFights.js →
inline <script>
```
