---
name: dm-ui
description: Load BEFORE editing src/ui/dock.js, src/css/dock.css, src/rooms/roomCard.js, src/rooms/roomPanel.js, src/ui/controlPanel.js, src/ui/colorPicker.js, src/fog/fogControls.js, src/render/gridCalibrate.js, src/ui/toolbar.js, src/ui/fogBar.js, src/ui/repairBar.js, src/ui/effectsRow.js, src/rooms/roomSwitcher.js, src/render/playersView.js, src/shapes/shapeMenu.js, src/shapes/repairKeys.js, src/shapes/toolPreset.js, src/css/toolbar.css, src/css/roomCard.css, src/css/sceneManager.css, src/css/music.css, src/css/panes.css, src/css/worldMap.css, src/world/worldMap.js, src/world/worldMapEdit.js, src/world/worldMist.js, or the half-shroud paths in src/fog/fog.js. Also load when the task mentions the dock, its rail or a pane, the Room tab, Scene control, Settings, room labels, the notes field, corner radius, half-shroud or fogHalfAlpha, toolbar toggles, chevrons or their lists, the repair icon, the size field, the material palette, which tools a placement mode shows, the fog clouds, the music or sounds player, the world map's toolbar, the two-maps toggle, the minimap's Sync and Lock, or the calibration HUD and what arming calibration puts away. Carries layout and button-identity rules that are invisible in code review.
---

# DM interface identity and layout

Binding rules for the DM-facing interface. The look comes from the dock prototype (v23) the DM
picked; each rule below was settled with them, and most by building the alternative first.

## The dock (`dock.js`, `dock.css`)

One dock on the right edge holds every control that is not on the map or the toolbar.

- **It sits OVER the map and never narrows it.** The canvas keeps the whole window; a window
  resize keeps the map where it is.
- **Every rail icon carries its name in text under it**, because a first-time DM read none of the
  icons. Three groups split by dividers: Campaign and Bestiary (windows), Map settings and Notes
  (panes), Music, Sounds, Pictures and Fights. Settings and Help sit at the bottom.
- **The rail is 60px with 12px between items; each button is the whole hit area, and the ONLY
  highlight is a 34x30 rounded square (radius 8) behind the 17px icon**, so hover and the open tint
  have one shape. The label sits 5px below it, 9.5px on one line trimmed to its capitals
  (`text-box`); Map settings alone breaks onto two lines (`width: min-content`, so it survives
  translation). The open pane's tab tints the indicator and turns icon and label blue; a window open
  outside the rail wears a dot on the indicator's corner (the fight table and the Bestiary, nothing
  else). Dividers run edge to edge with no margin of their own.
- **Clicking the open tab again closes the pane, leaving the rail.** The rail never hides.
- **One pane at a time.** The dock has no Room tab: the selected room lives in the Notes tab.
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

- **One divider rule app-wide**: a divider runs edge to edge across its container (a bar's full height, a
  menu's or the rail's full width, a field's full height), 1px, `--g-divider`. A menu's padding is
  cancelled with negative side margins so the line touches both edges.

- **Grey surfaces, no outlines.** Fields and buttons are filled grey (`--g-field`), hover one
  step lighter, a pick inside a segment is the lighter `--g-pick` plate. Defined once on `:root`
  in `base.css`; a control that writes its own hex drifts.
- **Solid blue is press this, the blue tint is picked** (`test/blueMeaning.test.js` holds the list of
  what may be solid). The tint (`--b-tint`) with a blue icon (`--b-icon`) marks what is on or in hand:
  the tool, the row under the pointer in any list, a ticked box, the active column chip, snap,
  straighten, Two maps, Lock, the open rail tab, the Door button on a room's popup while Door is
  armed, a closed eye. Pick-one wells (the fog clouds),
  fields and an open eye stay grey. A repair in force wears its own colour: Merge green, Cut out
  red, Split yellow.
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

## The room in the Notes tab (`roomCard.js`)

The room card's module renders into the Notes pane's room level; there is no floating card and no Room tab.

- **Name as the header, Delete where Close was**, then the notes below
  it, inside `#dock-pane-notes` (`notesPanel.js`), which wears the dock's grey and type. No boxes.
- **No corner radius in the tab or on the Effects row.** Corners round on the map by their circles
  (`cornerRound.js`), and the typed radius is the `#corner-field` a double-click on a circle opens.
- **The module dropdown stays on the name field.**
- **A click on the map takes focus off the tab's fields**; the fields stop their own events.
- **The fog state is NOT in the tab.** It is the selected room's own popup on the map (below).
- `refreshRoomPanel()` is the reflection hook. Called from `drawCursor()` and the paths that
  rewrite modes or reset polygons wholesale. **Not** from `setPolygonMode()`, which updates the
  room's popup in place so a rebuild can't steal field focus mid-edit.
- **In two-map mode the selected room lives in a column.** The column reports it to the shell,
  the tab edits it, and every edit goes back to that column only through `paneForward`.
- Room labels (`roomPanel.js`): `roomLabelFontPx(zoom)` is screen px and **clamped at both
  ends**. Placement is top-left INSIDE the room via `fitLabelBox()`, which scanline-samples in
  MAP units so the cached anchor is pan-independent. With My seat turned it fits against
  `turnShape(poly)`. `_rpLabelCache` clears per scene.
- Pure kernel (unit-tested): `normalizeRoomFields`, `sanitizeRoomName`, `sanitizeRoomDesc`,
  `ellipsizeToWidth`, `roomLabelFontPx`, `polygonRowSpans`, `cornerInsetAt`, `fitLabelBox`.

## The Notes tab (`notesPanel.js`, `notesPanel.css`)

- **Breadcrumbs Campaign › Place › Scene › Room, then one level's notes.** The levels never merge. The
  Place crumb exists for a scene in a group and holds that place's notes (`evermist.placeNotes`, by name).
  By default the pane follows the selection: the room if one is selected, else the scene. A crumb picks
  a level (`notesLevelPick`, `state.js`) and changes nothing else: the room stays selected and keeps its
  crumb. A new room pick, a deselect or a scene switch puts the pick back to following.
- **A crumb never touches the TV.**
- **It is a rail tab like the others** (`#dock-tab-notes`, right after Scene control), with the dock's
  width and one pane at a time. **A new room pick, or a switch from one room to another, brings Notes
  up if the dock is open on another pane** (`dockRoomPicked`). With the dock shut it stays shut and the
  tab wears the open tint with no pane (a state in `dock.js`, never persisted); a click on it opens
  Notes, another tab or shutting clears it. A deselect does nothing, and a DM who switched away is not
  pulled back until the next new pick. The notes area carries the app's own 8px scrollbar.
- **The tab is disabled, and its pane put away, with no scene open (the world map excepted), while grid
  calibration is armed and on an empty world map.** The left side of the window is empty.
- **`#rp-desc` renders inside it**, but its logic stays in `roomCard.js`. Scene and campaign notes are the separate `#np-field`, with the field's own undo.
  It fills the pane and scrolls itself, under the app's own 8px scrollbar; the room level scrolls the body.
- In two-map mode the pane follows the selected column. A notes edit goes to the column it was
  filled from with `sendToPane`, never `paneForward`.
- **Hidden in `body.player-mode` and `body.pane-mode`**, and absent from `stage.html`.

## The world map (`worldMap.js`, `worldMapEdit.js`, `worldMap.css`)

A dark layer over the map, opened from `#btn-world` on the rail or M. Its toolbar is the scene's own, with words only on + Map and Group: Select (always leftmost), + Map,
Group, a divider, Find. Add is a grey labelled "Map" button like Group (plus icon, word), never solid blue. Place's list holds Rectangle (R), Circle (O), Polygon (P), then Road (L),
and its button wears the last pick; V, R, O and P put Road down, and L takes it on the world map only. Road's own button (`#wm-road`) stays in the page as
the back end. Places take no Merge, Cut out or Split: the options row over a place tool holds Straight walls alone. The Brush, the fog
clouds, Reveal all and Hide all, the Effects tool and Snap are hidden, and the
tool, mode and repair the scene held are put away on opening and given back on closing. The context row hides with
`visibility` so the bar does not move. Find (or Ctrl+F) opens a large search in the middle of the window over a dimmed map (`#wm-finder`): every map as
a picture while nothing is typed, result cards while typing, with its own fade-and-rise (the window's pop-in would fight its centring).
One level of name shows at a time: zoomed out only the place plates, zoomed in only the scene names (the split is `WM_SPLIT`, 0.75). A scene is a 110x77 framed print shown only zoomed in, its name a plate inside it at the top left; zoomed out no scene in a place is shown (a grid was built and removed, see the ledger), and a scene with no place is a black diamond with a white rim and its name beside it. Under the prints sits the mist (`worldMist.js`): a drifting veil that clears 90% inside a place, over a backdrop greyed outside the places and 70% in colour inside them, a 20 soft edge. A place's outline is white, 2px (`POLY_LOOK.place`). A place's name is a small black plate inside its top left (`_wmLayoutLabels`, via the room's `fitLabelBox`), blue when picked, boxed in edit colours while edited. Rename is off while its name is hidden, and the backdrop image is set in Settings
(`worldBackground.js`).

- **The TV never changes while it is open.** Its keys are caught at the document in the capture phase,
  and `input.js` stands down on `worldMapOpen`. A field and a dialog keep their own keys.
- **Esc, M and the button return to the open scene. With none open they do nothing; with two maps on they close the map.**
- **With two maps on the world map shows a Left and a Right chip** (`worldMapColumns.js`): the active one wears the tint, the other
  is solid black. A double-click fills the active column and closes the map.
- **The Notes pane follows the world map's pick**, Campaign › Place, and works with no scene open.
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
  fog canvas with no third value, so the row's Half cloud (and `#btn-half`) is absent while the
  brush is picked and a live `tool === 'half'` falls back to `'shroud'` - the highlight moving
  is the DM's only signal, so never make that fallback silent.
- **Reverting this feature requires a data sweep**, not just a code revert. See DECISIONS.md.

## The fog on the bar, the room's popup and the one system

Three controls, one meaning each (`fogBar.js`, `roomSwitcher.js`). The fog is a cloud, in three
states: struck out is Reveal (green), striped is Half (teal), solid is Hide (purple); the lit one
wears the colour of the room outline it will draw. Reveal all and Hide all wear the struck-out and solid clouds and act now.

- **Reveal all and Hide all are two bare clouds on the bar** (struck out, solid), after a divider, right after Select,
  Brush and Shape. One click acts on the whole map, every room included (`revealAllMap`,
  `hideAllMap`), and undo restores it. They stay in Effects mode. Hovering either previews its result on the DM's map alone (`fogPreview.js`). `#btn-clear-fog` and
  `#btn-fill-fog` stay in Scene control as the hidden back end, not shown.
- **The fog mode is the first thing in the picked tool's row**: the three clouds in a well. It is
  the paint direction and nothing else: a click calls `setPaintDirection`, never changes the tool
  and never touches a room. Half is shapes only and is ABSENT under the Brush. The clouds grey
  while a repair is lit. Select shows no row.
- **A selected room carries its own popup, on the map just above it**: the same three clouds in a
  well (a click sets that room's fog at once; `T` still cycles it), a divider, then the door as a
  bare button. It is hidden while the room is dragged, in the players' view and on the world map,
  and `drawCursor` is what places it. The door button arms Door; Esc or Select ends it and the
  room stays selected.
- **The old trio (`#ctx-rooms`) and its ids are the hidden back end.** Pressed with Select in hand
  and a room selected it still sets that room, which is what the rig clicks.
- **The players' view** (`playersView.js`): holding H, or the minimap's TV button, puts the fog at
  full strength and hides the cursor canvas (outlines and labels), inside a blue frame. Its button
  wears a TV icon, never an eye.
- **One rule for every pick-one control and divider.** A well is 30px tall, field grey, 8px radius,
  2px padding, 26px items with a 6px radius, the pick lifted with a soft shadow. A divider runs the
  full height of its strip with 8px clear on each side. The row's pointer never sits under one:
  `placeContextRow` slides the row until it clears. A bare icon is an action or a tool.

## The repairs

A drawn shape draws a room. Held while it is drawn, Shift merges it into every room it touches,
Alt cuts it out of them, Ctrl splits them (`repairKeys.js`). The keys are read from the press or
release event; the key listeners only feed the outline, a tag by the pointer (Merge green, Cut out
red, Split yellow) and the bar's repair icon.

- **Ctrl with Rectangle or Circle splits along the shape's edge**: the part inside becomes a room of
  its own. **Ctrl with Polygon draws an open line**, finished by a double-click, which splits every
  room it crosses (`cutRing`). A shape that touches nothing changes nothing.
- **The repair icon ends the row of every shape** (`repairBar.js`): two overlapping squares at rest,
  the held or armed repair's glyph and colour otherwise. Its list, "Change the rooms it touches",
  arms Merge, Cut out or Split and greys "Needs a room" on a map with none. An armed repair stays
  armed until its lit icon is clicked. The hidden Split button arms Ctrl with the Polygon.
- **A shape from a size (Effects) takes no key**: Shift snaps its angle there, and the keys act on
  shapes drawn by hand. An armed repair still applies to it.
- **Alt+drag no longer pans under a shape tool**; the middle button pans. Under Select Alt+drag
  copies, and under any other tool Alt still pans.
- **In two-map mode** a column reports the held key up (`pane-repair-key`) and the bar's icon lights.
- **Places take no repairs.** The keys stand down while the world map is open, and its options row has no repair icon.

## The bottom toolbar

- **Order**: Select, Brush, Room ▾, Effects, a divider, Reveal all, Hide all. There is no Fog / Effects switch on the
  screen: Effects is a tool beside Room (below). Every old button id stays, as the hidden back end the new controls drive
  (Merge, Cut out, Split, Door, the fog trio, and `#btn-place-rooms` / `#btn-place-effects` in the hidden `.tb-seg`).
- **Sizes**: a 36px box around a 22px icon on screen. A button and its chevron form one group,
  2px apart; groups sit 8px apart.
- **Each chevron opens Figma's list** (`openBarList`, `shapeMenu.js`): a check on the current pick,
  the icon, the name, the key; the row under the pointer wears the tint; an Effects-only shape is
  greyed in the Room list. A right-click on the Room or Effects button opens its list.
- **A labelled button** (Room, Group, + Map: `.tb-labeled`) is as tall as the others, padding 0 11px 0 9px, 6px
  between a 16px block icon and a 12px word trimmed to its capitals, so both centre on the button.
- **The Room list holds room shapes only, and the Room button always wears the room shape you draw with.**
  Effects has no list: its shapes are the row's well, Square, Circle, Cone, Line (one square wide), Wall (1 ft thick),
  Ring (a Wall bent into a circle) and Polygon. Line, Wall and Ring take a length alone.
- **Effects' row**: the shape well (icons built as the fog clouds' `.fx-track`, the lit one `.active` and tinted in the material's
  colour as a lit cloud wears its own, none lit with Select; a click arms the shape at the current size), a divider, the
  material field (glyph, name and arrow on one grey field, like the size field), the size field at the row's 8px gap, a divider,
  Snap, Straight walls, the repair icon. The material palette opens above the row, a "Find a material" field over glyph
  and name (Fire, Acid, Light). **The material glyphs alone carry colour and depth**, a gradient fill under the
  outline; their gradients are defined once in `index.html` outside any hidden element, because the glyphs are copied and a
  copied id resolves to the first copy. Every other bar icon stays a flat outline. The size field steps one grid square (5 ft) by drag, typing, scroll or [ ]; it stops at
  both ends, and its chevron lists the sizes largest first with "By hand" last for the shapes that have it.
- **The map's wheel never leaves the size.** While an effect shape with a size is armed it steps the size and stops at the
  smallest and the largest: never "by hand", never the zoom (Ctrl+wheel still zooms). By hand is the size list's or typing's.
- **Snap and Straight walls are icons with no words**, their names in tooltips, and keep their
  state across a mode switch. **Never gather toggles into a pill.**
- **The options row hangs over the tool it belongs to with a pointer down to it** (`placeContextRow`):
  the clouds and brush size over the Brush; over a shape the clouds in Fog mode; in Effects mode (any tool, Select too) the shape well, material and size, over the Effects
  button, then Snap, Straight walls and the repair icon; the door fields centred with no
  pointer. Select shows no row.
- **A tool a mode cannot use GREYS IN PLACE and does nothing**, so nothing on the bar moves or changes width: Effects
  mode greys Brush and Room with its arrow, whose tips say why ("Room - leave Effects to draw a room"). The Room button
  stays Room, with the room shape and the word, in both modes. The one control that is absent inside a row is Half
  under the Brush.
- **Effects is a switch, the Room button's twin** (`#btn-effects`, `effectsTool.js`): the word and the glyph and colour of the
  current material (fire, acid or light, `effectEdgeColor`; Light its own outline colour), no arrow. A click or E turns Effects
  mode on with the last effect shape armed at the last size (Circle, 20 ft at first). In the mode, a click or E with Select in
  hand arms that effect again, because a placement ends on Select; with an effect armed it turns the mode off (Fog, Select).
  It owns its sub-toolbar: while on, the button wears the blue tint of a switch that is on (`.fx-on`), its glyph blue with it,
  and `#context-row` stays up with every tool, Select included. Esc puts an armed effect down (Select; mode and row stay), a
  second Esc with Select leaves the mode.
- **The bar burns while the mode is on** (`effectsBarFire.js`): a band of the current material's real effect ON the bar's border, 2px either side of it with
  flames sized by an 8px cell, and the border itself in the material's colour (Light has a soft record of its own there), on
  a small canvas of its own under the bar, fading with the mode and running no frame loop while it is off.
- **Taking a button off a mode's bar means disarming what it held.** An armed mode with no
  button on screen swallows the next shape the DM draws.
- **`#context-row` hides with `visibility`, never `display`**, or the cluster jumps by the row
  plus its gap on every Select.

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

**Arming calibration puts the dock pane away, Notes included, and gives it back.** The pane
shuts, **without touching `selectedPolygonId`**, and leaving restores the pane that was open,
unless the DM picked another tab meanwhile. The rail never hides, so that is a real click and
it wins. Notes commits its fields on the way out, the same as the deselect path.

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
