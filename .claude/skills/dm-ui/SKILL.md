---
name: dm-ui
description: Load BEFORE editing src/ui/dock.js, src/css/dock.css, src/rooms/roomCard.js, src/rooms/roomPanel.js, src/ui/controlPanel.js, src/ui/colorPicker.js, src/fog/fogControls.js, src/render/gridCalibrate.js, src/ui/toolbar.js, src/shapes/shapeMenu.js, src/shapes/toolPreset.js, src/css/toolbar.css, src/css/roomCard.css, src/css/sceneManager.css, src/css/music.css, src/css/panes.css, src/css/worldMap.css, src/world/worldMap.js, src/world/worldMapEdit.js, src/world/worldMist.js, or the half-shroud paths in src/fog/fog.js. Also load when the task mentions the dock, its rail or a pane, the Room tab, Scene control, Settings, room labels, the notes field, corner radius, half-shroud or fogHalfAlpha, toolbar toggles, chevrons or their lists, the operations button, which tools a placement mode shows, the fog trio, the music or sounds player, the world map's toolbar, the two-maps toggle, the minimap's Sync and Lock, or the calibration HUD and what arming calibration puts away. Carries layout and button-identity rules that are invisible in code review.
---

# DM interface identity and layout

Binding rules for the DM-facing interface. The look comes from the dock prototype (v23) the DM
picked; each rule below was settled with them, and most by building the alternative first.

## The dock (`dock.js`, `dock.css`)

One dock on the right edge holds every control that is not on the map or the toolbar.

- **It sits OVER the map and never narrows it.** The canvas keeps the whole window; a window
  resize keeps the map where it is.
- **The rail is icons only, in three groups split by dividers**: World map and Bestiary
  (windows), Scene control (pane), Music, Sounds and Combat. Settings and Help sit at
  the bottom. The open pane's tab wears the blue tint; a window that is open wears a dot.
- **Clicking the open tab again closes the pane, leaving the rail.** The rail never hides.
- **One pane at a time.** The dock has no Room tab: the selected room lives in the left panel.
- **The open pane and the width persist under `evermist.dockPane` and `evermist.dockWidth`.**
  Never write `evermist.cpPane`: the previous release reads it and would open a panel on a tab
  that no longer exists.
- **The width is dragged on the dock's inner edge**, and stops short of the toolbar. **The toolbar
  is centred on the window, ALWAYS**: no pane, panel or minimap moves it, and only a pane's narrowest
  width may cover it (`_dockMaxW`). The dock carries `zoom: var(--ui-zoom)`, so a pointer delta goes
  through `_rpScreenToStyle()`, never a bare `/ uiZoom`.
- **Hidden in `body.player-mode` and `body.pane-mode`.** A column window shows no dock.
- **Pop-outs** (a colour picker, Custom movement) open to the dock's LEFT, level with the row that
  opened them, in the `.dk-pop` shell. **A dropdown's list (`.dk-drop`, the movement presets)
  opens under the dropdown, Figma's way**, the check on the left.

## The dock's skin

- **Grey surfaces, no outlines.** Fields and buttons are filled grey (`--g-field`), hover one
  step lighter, a pick inside a segment is the lighter `--g-pick` plate. Defined once on `:root`
  in `base.css`; a control that writes its own hex drifts.
- **Blue means on or in use, and nothing else.** Solid blue (`--b-solid`) with a white icon is
  the tool in hand: one thing on screen. A blue tint (`--b-tint`) with a blue icon is a switch
  that is on: snap, straighten, Rooms/Effects, Two maps, Lock, the open rail tab, an armed
  Merge or Cut out, a closed eye. Pick-one segments, fields and an open eye stay grey.
- **Two levels of type**: a 12px bold section title, and an 11px dim sub-header over a group.

## Scene control pane

Rules from Figma's right panel, and they bind every section:

1. A section title carries at most two icons, each acting on the whole section.
2. **The eye means shown/hidden and ends its row.** A hidden row dims, and its closed eye turns
   blue. The room-names eye sits on the Rooms title (the one exception); the grid's eye sits on
   the Grid title and dims the whole section.
3. **Numbers are fields with a leading icon you drag to scrub.** No sliders and no labels in
   this pane. The scrub icon writes the same `<input>` the old slider row drove, so the app's
   own `input`/`change` handlers do the work.
4. Movement is an effect row: a preset dropdown, then the eye. Custom… opens the dials.
5. A sub-header leads straight to its controls. A control never carries a second label.
6. **A Sources row is the button.** The icon beside it does the next thing (Draw Rooms, remove the
   module text), never the row's own action again.

`#cp-legacy` stays as the back end the pane drives: behaviour code clicks and reads those
elements, and the pane mirrors their state. Keep the colour picker's zoom-safe box reads and
the `width: 0` on `.cp-chip-pre input` and `.cp-stepval input` through any restyle.

## The room in the left panel (`roomCard.js`)

The room card's module renders into the left panel's room level; there is no floating card and no Room tab.

- **Name as the header, Delete where Close was**, then the notes and the pictures inline below
  them, inside `#notes-panel` (`notesPanel.js`), which wears the dock's grey and type. No boxes.
- **No corner radius in the tab or on the Effects row.** Corners round on the map by their circles
  (`cornerRound.js`), and the typed radius is the `#corner-field` a double-click on a circle opens.
- **The module dropdown stays on the name field.**
- **A click on the map takes focus off the tab's fields**; the fields stop their own events.
- **The fog state is NOT in the tab.** It is the toolbar's fog trio (below).
- `refreshRoomPanel()` is the reflection hook. Called from `drawCursor()` and the paths that
  rewrite modes or reset polygons wholesale. **Not** from `setPolygonMode()`, which updates the
  trio in place so a rebuild can't steal field focus mid-edit.
- **In two-map mode the selected room lives in a column.** The column reports it to the shell,
  the tab edits it, and every edit goes back to that column only through `paneForward`.
- Room labels (`roomPanel.js`): `roomLabelFontPx(zoom)` is screen px and **clamped at both
  ends**. Placement is top-left INSIDE the room via `fitLabelBox()`, which scanline-samples in
  MAP units so the cached anchor is pan-independent. With My seat turned it fits against
  `turnShape(poly)`. `_rpLabelCache` clears per scene.
- Pure kernel (unit-tested): `normalizeRoomFields`, `sanitizeRoomName`, `sanitizeRoomDesc`,
  `ellipsizeToWidth`, `roomLabelFontPx`, `polygonRowSpans`, `cornerInsetAt`, `fitLabelBox`.

## The left panel (`notesPanel.js`, `notesPanel.css`)

- **Breadcrumbs Campaign › Place › Scene › Room, then one level's notes.** The levels never merge. The
  Place crumb exists for a scene in a group and holds that place's notes (`evermist.placeNotes`, by name).
  By default the panel follows the selection: the room if one is selected, else the scene. A crumb picks
  a level (`notesLevelPick`, `state.js`) and changes nothing else: the room stays selected and keeps its
  crumb. A new room pick, a deselect or a scene switch puts the pick back to following.
- **A crumb never touches the TV.**
- **It is the dock's mirror: a full-height pane, shut to a floating icon** (`#np-fab`, top left).
  The chevron in its header shuts it and the icon opens it (`evermist.notesPanelOpen`); picking a
  room opens a shut panel without changing what is kept. Its width is dragged on its inner edge
  (`evermist.notesWidth`) and stops short of the toolbar. **The minimap sits to its right**
  (`--np-right`) and moves with it. The notes area carries the app's own 8px scrollbar. It is put away
  while grid calibration is armed, as the dock pane is.
- **`#rp-desc` and the pictures render inside it**, but their logic stays in `roomCard.js` and
  `roomPictures.js`. Scene and campaign notes are the separate `#np-field`, with the field's own undo.
  It fills the panel and scrolls itself, under the app's own 8px scrollbar; the room level scrolls the body.
- In two-map mode the panel follows the selected column. A notes edit goes to the column it was
  filled from with `sendToPane`, never `paneForward`.
- **Hidden in `body.player-mode` and `body.pane-mode`**, and absent from `stage.html`.

## The world map (`worldMap.js`, `worldMapEdit.js`, `worldMap.css`)

A dark layer over the map, opened from `#btn-world` on the rail or M. Its toolbar is the scene's own: Select, Shape
(rectangle, circle, polygon: V, R, O, P), Merge / Cut out / Split, Straighten, then Add a scene and Find. Brush,
Door, Snap and the Rooms/Effects switch are hidden, and the tool, mode and repair the scene held are put
away on opening and given back on closing. The context row hides with `visibility` so the bar does not move.
One level of name shows at a time: zoomed out only the place plates, zoomed in only the scene names (the split is `WM_SPLIT`, 0.75). A scene is a 110x77 framed print shown only zoomed in, its name a plate inside it at the top left; zoomed out no scene in a place is shown (a grid was built and removed, see the ledger), and a scene with no place is a black diamond with a white rim and its name beside it. Under the prints sits the mist (`worldMist.js`): a drifting veil that clears 90% inside a place, over a backdrop greyed outside the places and 70% in colour inside them, a 20 soft edge. A place's outline is white, 2px (`POLY_LOOK.place`). A place's name is a small black plate inside its top left (`_wmLayoutLabels`, via the room's `fitLabelBox`), blue when picked, boxed in edit colours while edited. Rename is off while its name is hidden, and the backdrop image is set in Settings
(`worldBackground.js`).

- **The TV never changes while it is open.** Its keys are caught at the document in the capture phase,
  and `input.js` stands down on `worldMapOpen`. A field and a dialog keep their own keys.
- **Esc, M and the button return to the open scene. With none open they do nothing; with two maps on they close the map.**
- **With two maps on the world map shows a Left and a Right chip** (`worldMapColumns.js`): the active one solid blue, the other
  solid black. A double-click fills the active column and closes the map.
- **The notes panel follows the world map's pick**, Campaign › Place, and shows with no scene open.
- **Add a scene adds and never opens**: the open scene and the TV stay as they are.
- **A place is a room-shaped record, and the polygons decide membership.** A scene belongs to the smallest
  outline that holds ALL of its card (rounded corners and curved walls count); one pixel outside takes it
  out. Every move, edit, draw and add ends in `worldAssignAll`, so a scene's `group` follows the geometry.
- **A place is edited by the room's own code**, not a copy of it: `activeShapeList()` answers the places
  while `worldMapOpen`, and `worldMap.js` runs `selectMouseDown` and its kin inside `_wmWithCamera`, which
  lends them the world's camera for one synchronous call. Rounding circles, corner points, Ctrl+drag
  bends, curve handles, the scaling box and Escape's levels are therefore the room's. A change to that code
  must keep working with `worldMapOpen` true, and `pushUndo`, `commitShapeDrag`, `persistShapeEdit` and
  `deletePolygonById` each stand down for the places.
- **The room's overlay canvas rides above the layer** (`body.world #cursor-canvas`) and paints the places,
  so a polygon is drawn at every zoom.
- **Drawing a place is an addition to dragging.** A scene dropped on a loose scene still makes a place, as
  the rectangle that fits both. A group with no place (one made before the world map) gets that
  rectangle on first open, and a scene filed under a place is moved inside it.
- **Scenes are picked together with Shift** (`worldMapPick.js`, rules in `worldPickPlan.js`): Shift-click toggles, a
  Shift-dragged box adds, a plain click drops the pick, Esc clears it. A pick is scenes only and moves as one.
- **Settings wears Scene control's parts**: three sections (Interface, Fog in every scene, World map), each a 12px title
  over 11px sub-headers and 26px fields. The backdrop is a Sources row (the picture's name in a `.dk-src`, a trash
  icon at its right to remove it, which asks first); Half shroud, Feather, Size and Opacity are scrub fields with no
  slider. The long hint lives in a tooltip.
- **Settings' World map section holds the backdrop and the backup.** Export wears the pick ("Export 3 scenes"),
  and with none picked saves everything; Restore is a picker or a .zip dropped on the layer (`worldBackup.js`).
- **The right-click menu is the `.sm-menu` look** (`sceneManager.css`). Delete works on any scene: deleting the open
  one switches the window to the first scene, as it always did. Delete has no red until the pointer is on it.

## Half-shroud

`poly.mode === 'half'` rides the reveal path in `applyPolygonToFog`, erasing to completion,
then repaints fog at `fogHalfAlpha` through the same mask. **Absolute, not subtractive:** a
partial erase can't re-fog ground already clear, i.e. the room the party just left.

- **Flatten the interior on the SCRATCH MASK, not on the fog.** A reveal clears cloud-erosion
  residue with a hard `clearRect`; the repaint can't, and residue in the mask reads as blotchy
  density. Flattening the inset region to white on `_fogScratch` fixes it and keeps the
  feathered edge band.
- `fogHalfAlpha` is ONE global `localStorage` value (`FOG_HALF_ALPHA_KEY`), never per-room,
  never in a scene or backup, and deliberately absent from Fog Reset. Feather is the same kind
  of value under `evermist.fogFeather`, except Fog Reset does set it back.
- The Player needs nothing new: the stencil crosses as a PNG and partial alpha propagates.
- **Half is a shape-tools-only paint direction.** The brush paints into a cleared-or-opaque
  fog canvas with no third value, so `#btn-half` disables while the brush is picked and a live
  `tool === 'half'` falls back to `'shroud'` - the highlight moving is the DM's only signal, so
  never make that fallback silent.
- **Reverting this feature requires a data sweep**, not just a code revert. See DECISIONS.md.

## The fog trio (`#ctx-rooms`)

Reveal / Half / Shroud above the toolbar means one of two things, decided by the tool in hand:

- **Select in hand and a room selected**: the trio shows that room's fog and sets it, and `T`
  cycles it.
- **A drawing tool or the Brush in hand**: the trio is the paint direction, as
  `setPaintDirection` sets it, with Half greying under the Brush and the trio disabling under
  Merge and Cut out.

## The bottom toolbar

- **Order**: Select, Shape ▾, Merge / Cut out / Split ▾, Brush, Door, then snap, straighten and
  Rooms/Effects. Every button id stays.
- **Sizes**: a 36px box around a 22px icon on screen. A button and its chevron form one group,
  2px apart; groups sit about 11px apart. **No hairline dividers on this bar.**
- **Each chevron opens Figma's list**: a check on the current pick, the icon, the name, the
  key; the row under the pointer turns solid blue; an Effects-only shape is greyed in Rooms
  mode. A right-click on the button opens the same list.
- **The operations button wears the last pick.** Split is a tool in hand (solid blue); Merge
  and Cut out are switches that stay armed (tint). Each keeps its arming behaviour.
- **Snap and straighten are bare `.tb-toggle`s** and keep their state across a mode switch.
  **Never gather toggles into a pill.** The Rooms/Effects switch is the `.tb-seg` track at the
  right-hand end; `.tb-seg` is for that switch and nothing else.
- **A tool a mode cannot use is ABSENT, not greyed.** Rooms shows every tool; Effects drops
  Brush and Door. Half is the one control that greys, and only under the Brush.
- **Taking a button off a mode's bar means disarming what it held.** An armed mode with no
  button on screen swallows the next shape the DM draws.
- **`#context-row` hides with `visibility`, never `display`**, or the cluster jumps by the row
  plus its gap on every Select. A pick-one group inside it gets NO pill of its own.

## The calibration HUD (`gridCalibrate.js`, `#gridcal-hud` in `toolbar.css`)

A floating row over the map, borrowing the app's controls.

- **It carries `position: fixed` + `zoom`**, so `_rpScreenToStyle()` is the only correct way
  to write its `left`/`top`.
- **The count is a `.cp-stepper`** with the unit as a `.cp-pct` suffix. It does NOT go in
  `#context-row`, which is hidden for the whole of calibration.
- **`pointer-events` sit on the children, never the box.** A box straddling the shape would
  eat the drag that moves it.
- No entry animation: `cpAdvIn` slides on `translateX`, and the placer measures the box every
  frame.

**Arming calibration puts the dock pane and the left panel away and gives them back.** The pane
shuts, **without touching `selectedPolygonId`**, and leaving restores the pane that was open,
unless the DM picked another tab meanwhile. The rail never hides, so that is a real click and
it wins. The panel commits its fields on the way out, the same as the deselect path.

## Music and Sounds panes

Players, not forms: Scene control's field rules do not apply here, and **volume is always a
slider** (`.cp-slider`'s markup, never a styled native range).

- **Music opens on a player**: a round play/pause, the track, level bars, the state line, the
  volume slider and the download bar. Pause keeps the position.
- **Sounds opens on its volume slider**, then its groups as tiles two to a row. Left click plays
  one more copy, right click stops the newest; ×N and the draining bar show what is playing.
- **The filter and URL fields are `.cp-field`.** The black inset pill means *pick one of these*
  and never wraps a field the DM types into.
- **Add from YouTube selects as the Bestiary does** (Windows, below), and a track already
  on disk wears `.sm-tick.done` and an In library chip.
- **A per-row delete is an icon with the app's trash SVG**, hidden until the row hovers, and it
  asks through `confirmDialog`.
- **Music groups** (`musicGroups.js`): New group in the header,
  a row dragged onto a heading, Ungrouped first. **A group is renamed by its name, never a pencil.**
  A track's file never moves.

## Windows

The Bestiary opens from the rail as a centred window over a veil; the
fight table stays a free window. Backup Export and Restore are in Settings' World map section.

- **Every window is built from the parts in `sceneManager.css`**: `.sm-win` with `.w-s`
  (360, a question or progress), `.w-m` (480, a list) or `.w-l` (720, a reference);
  `.sm-whead` 48px with a 14px title and the `.sm-x` close last; `.sm-wbody`, `.sm-wfoot`.
  The Bestiary fills the screen. A free window's title is the dock's 12px bold.
- **The title repeats the label of its opening button**, word for word.
- **Controls in a window are 28px with no outline**, a focus ring only on keyboard focus.
  `.sm-hbtn` is secondary, `.primary` the one action the window exists for, `.danger` the
  destructive kind; `.sm-bare` an icon button. An icon beside a label carries
  `--icon-nudge`; the trash (`i-trash`) does not. Icons come from `icons.js` (`uiIcon`).
- **Selection is Gmail's.** The header never changes. A list's `.sm-ltb` toolbar starts with the
  all/none `.sm-tick`: with nothing ticked it selects what the list shows, with anything ticked
  it clears, and a partial selection shows a dash. The count and the actions take the toolbar
  while anything is ticked (decisions/ui-and-control-panel.md, "Selection follows Gmail").
- **No footer button only closes its window.** A footer exists for an action; the cross closes.
- **Every toast goes in `#sm-toasts`**, built by `toastEl` (`confirmDialog.js`): an icon, the
  message, at most a blue-text action and a close. The stack sits above every veil, so the update
  toast stays clickable over any window.
- `.claude/private/design/item-150/` holds the board the windows were built to, and
  `tools/rig/scenarios/acceptance/windows.js` audits every window against it.

## Destructive actions

- **A destructive action is a header icon or sits beside the control it belongs to**, wears no
  red at rest, and asks through `confirmDialog` where the loss is not undoable. Room Delete is
  undoable and does not ask; Fog and Grid Reset ask.
- **A destructive button has no fill and carries the trash**, red only under the pointer, and
  sits on the right of every footer, dialog and list toolbar. A dialog that loses data ends on it,
  any other question on primary, and Cancel holds the focus.
- The question is the whole warning, so never drop it to save a click.
