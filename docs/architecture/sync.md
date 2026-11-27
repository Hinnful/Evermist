# Architecture - how the two windows stay in sync

Split out of [ARCHITECTURE.md](../ARCHITECTURE.md): how the TV follows the DM screen: what the Player keeps in memory, the minimap, seat alignment, Fit to TV, the ping, effects and lights, in the present tense.

The DM window is the boss. The Player window follows.

- They talk via **`postMessage`**, the standard browser way for two windows to send each
  other messages. The DM sends things like "here's the new fog", "the camera moved here",
  "switch to this map".
- **The Player window exists before it is opened.** One is built a couple of seconds after the
  DM starts and waits out of sight, so pressing Open Player has no page load behind it. The DM
  ignores that waiting window until the button is pressed, so nothing is sent to it and no map
  is pulled into it.
- **The window goes up straight away, showing a full screen of the app's own drifting fog**, and
  swaps to the map when it has decoded. The fog is the real thing - the same cloud texture and the
  same drift the map's fog uses - so the players see weather rather than the app starting up.
  Nothing else is on that screen: no name and no status line.
- **A new Player screen copies the cloud texture** from the DM window instead of building its own.
  Two-map mode opens four documents at once on one thread, and four builds stalled every window.
- The map image or video is sent as a **URL** rather than copied pixel by pixel, so opening
  the Player window doesn't double the memory used.
- **Names.** The Auto/Manual switch reads "Updates"; the camera push reads "Match the TV to my view"
  (the old "Sync View"). "Sync" no longer means both.
- **Auto vs Manual.** With Auto on, every change the DM makes appears on the TV instantly.
  With Auto off, the DM holds everything about the map until **Send**: opening a map (the TV
  keeps the old one, with no fog cover), minimap drag and zoom, Sync, Turn and the fog animation.
  `state.tvWait` {scene, view, turn, anim} records what waits and Send delivers it in one go;
  Manual to Auto sends it too. The first map opened while the TV shows none (a fresh TV, or one cleared
  by a delete) waits for Send, though Show on TV with nothing waiting shows it at once. Turning Two maps
  on or off is not a Send: each TV half waits for its own, and the single TV after leaving waits too. In Manual, Stop showing then Show on TV (or a TV reconnect) sends only what was last sent; unsent reveals wait for Send. A Player's retry for a missing map asks for the map alone. Both Send keys, Space and Shift+S, send in either mode. TV setup states the rule under
  Updates in one line. The ping stays live but does nothing while the TV shows a different
  map from the open one; a gallery picture on the TV stays live.
- **Match the TV to my view** (Sync View in the code) snaps the Player's camera to match the DM's. The Player camera glides to
  new positions rather than jumping.
- The Player reports a few things back, so DM controls can show what is actually true rather
  than what was last asked for: its screen size, whether it has been panned away from the
  DM's camera, and whether it is fullscreen. Fullscreen is the odd one - it is the window
  going fullscreen rather than the page, so only the app shell can see it, and it travels
  shell → Player → DM.

**The camera crosses the wire as a region, not a zoom level.** This is the part worth
understanding. If the DM sent "centre here, at 1.4× zoom", a bigger TV would show *more
map* than the DM sees, rather than the same map bigger. So the DM sends the rectangle of
map it is looking at, in map units, and the Player fits that rectangle to its own screen.
Matching screen shapes land exactly edge to edge. Mismatched ones fit rather than crop, so
the players can never see less than the DM intended.

### What the Player keeps in memory

The Player doesn't hold a copy of the whole map to draw from. It holds one screen's worth.

This matters on animated maps. The Player has to redraw its map picture from the video and
hand it to the graphics card on every frame, so the size of that picture is a cost thirty
times a second, not just a cost once. Sized to the whole map, a large animated map meant
pushing 91MB to the card on every frame. Now it's the size of the Player's own
screen plus a small margin, holding only the patch of map the camera is over, at one picture
pixel per screen pixel. That's about 15MB on a 1440p TV whatever the map's resolution, and
the same figure is what crosses to the card each frame.

The patch is recomputed every frame from the camera, so it can't go stale, and it's always
sized so one pixel lands on one pixel. The map stays as sharp when you zoom in as it was
before.

The piece that makes it safe: the patch always lands on exactly the same rectangle of the
screen, whatever the pan and zoom. The fog is drawn separately on top, in screen
coordinates, so anything that shifted the map by a fraction of a pixel against the fog would
show up as a bright or dark rim along the map's edge. Holding that rectangle still is what
prevents it.

The clip itself is still loaded the expensive way. The Player can't read the same file the DM
window is reading, because two video players on one file starve each other and both freeze, so
it loads a whole private copy of the clip into memory - 280MB on the largest map. A streaming
replacement was built and measured, and it saved the memory without making anything faster, so
it was taken back out.

### The minimap

The bottom-left corner carries a small live preview of what the Player camera is framing,
and dragging or scrolling it **drives** the TV. It's a remote control rather than a second
independent camera: it feeds the same camera message the Player already listens for. Each
camera move on the TV travels back to it, from a Send and a new map to a finished snap.

The preview **is the TV**: its box has the TV's shape (16:9 with no TV known) and the picture
fills it edge to edge, with no frame and no margin of map around it. Seat alignment swaps the box's sides at 90 and 270 and turns the
picture inside it; the buttons never turn. With two maps both columns are drawn side by side,
split where the TV splits them, and a press on a half selects its column.

**Show on TV** (`tvControl.js`) is the control over the picture. Off, it is one blue button and
the name of the screen it will use. The TV is every screen but the one holding the DM window,
decided by `tvPick.js` from the list `electron/displays.js` reports: one candidate is used, several
ask once and are remembered, none opens a help box. While none is found the button is grey but still opens that box, and the list is re-read every second until the Player is live. Pressing it opens the Player and moves it onto
that screen in fullscreen. Live, the minimap's edge breathes blue and a pill reads "Live on TV" or
"Live in a window", turning to "Stop showing" under the pointer; one blue outline runs round the pill and Send.
The minimap keeps only what play uses many times: 1 inch and Sync side by side at its top left (each with its icon and
word, shown only while live), "…", and Show on TV or the live pill with Send. 1 inch (`tvOneInch.js`) is one press, not a
mode: it zooms the TV about its centre so a map square (the scene's cell size, grid lines shown or not) is 1.1 inches
wide, sent by the wheel's own path, so Manual waits for Send and two maps scale the selected half. `tvInch.js` does the
sum from the TV's diagonal and its full pixel width, never the work area a taskbar shrinks. With no size for this TV it
opens TV setup with the size row marked blue, and Done zooms. On a narrow minimap 1 inch and Sync drop their words first,
Show on TV drops its icon, then shortens, then goes
small; the pill's last step leaves Stop as its icon. In two-map mode Send acts on the selected column only.

**TV setup** is one centred window: the screen, Fullscreen when the screen is a window, Updates Auto/Manual,
Turn as three pictures, and TV size (43, 50, 55, 65, 75, Other with a field for 10 to 120 inches), with a note that "…"
reopens it. The size is kept per TV, by name and resolution, in `evermist.tvSizes` on this computer only. On the first
look at a TV each launch `electron/tvSize.js` reads the size the TV reports in its EDID (the registry on Windows,
`/sys/class/drm` on Linux, `ioreg` on a Mac); a believable one starts picked when nothing is stored, and a line under the
picker says whether the TV gave it. Zero, an aspect ratio standing in for a size (16 x 9, 160 x 90 cm) and anything outside
10 to 120 inches are ignored. It opens on the first Show on TV of each launch and on
every "…" click or click on the screen name. The TV menu (`#tv-pop`) carries only the "which screen is the TV?"
question and the no-TV help box. The Players' view has no minimap button; hold H is its only way in. Unplugging the TV takes the
map off it. Under the rig's `--offscreen` no window is moved and the window route is taken. On Linux Wayland no app can place its window, so `displays.js` answers `canPlace:false`, `pickTv` offers no candidates and setup says to drag the window to the TV and press Fullscreen. A window the DM wanted fullscreen is asked once, when the Player reports loaded.

### Seat alignment

Settings' "Your seat at the TV" (`seatAlignment.js`) is four icons: a TV with a chair below,
above, left or right. A click on one turns the DM's map 0°, 90°, 180° or 270°, so the laptop shows
the map the way the table shows it from the DM's chair. It is a setting of the laptop, kept in
local storage, never in a scene or a backup, and the TV never sees it.

Every canvas over the map turns together as one piece, so the map, fog, grid, effects and the
tool overlay cannot slide apart. The animated map is a video element with its own transform, and
takes the same turn. The map area itself stays upright and takes the mouse, so the few places that
meet a mouse position or place a panel beside the map convert through `mapTurn.js`. Text on the
map turns back to read upright. Sync View sends the TV the region the laptop would show at 0°
around the same centre, so the TV's framing does not change with the seat. In two-map mode each
column turns its own map.

### Fit to TV

TV setup's Turn is a turn of the TV picture kept per scene as `tvFit: {step, turn}` (absent is upright),
offered for every map, square ones included, and never disabled. It is three pictures: upright and the two
quarter-turns, mapped by `fitTile` and `fitForTile` in `tvFit.js`. The saved form stays `{step, turn}` so
4.7.0 reads it, and `cleanFit` still reads an older step 2. The laptop never follows the turn.

The Player takes the turn the way the DM takes My seat: one turn of the whole canvas stack, so the
map, fog, grid, effects and ping cannot drift, with `seatTurn` set directly from the fit and never
through `setSeatTurn`, which writes the key the DM window reads. The Player's own pan and wheel convert
through `mapTurn.js`, and the animated map's region texture is rebuilt after a turn. A pick sends the
Player a `tv-fit` message of its own in Auto; in Manual it waits in `tvWait.turn` until Send;
a new map's payload carries the scene's turn and the Player applies it behind the transition cover. The
minimap turns each half's picture by its own fit on top of the seat, and Sync View swaps the region it
sends only when exactly one of the seat and the fit is sideways.

### The ping

Ctrl+middle-click, or Q with the pointer over an open map, on the DM map sends a map point to the TV, and both windows draw the same gold
mark there for about two and a half seconds, sized to the window and not the map. A plain middle
drag still pans, as does a two-finger scroll on a touchpad, where a pinch zooms. In two-map mode a column sends to its own half. The ping rides the PixiJS ticker
only while one is showing, and nothing of it is stored.

### Effects

Effect looks beyond flames are one-pass kinds, one file each in `src/render/effectKinds/`, each adding itself to
`_FX_KIND_FRAG`. The shared prefix in `effectShaderKinds.js` gives them `uHub` (the web hub: the outer ring's area centroid
moved up 8% of its height), `uInR` (the shape's depth, from `ringsInRadius` in `shapeHit.js`) and `fit(ref, lo)`, which
scales edge work down on thin shapes. It also carries the cloud helpers `sN`, `drift` and `cellsF`: faint patches riding the drift, each opening and closing on its own timer. Darkness, Fog cloud (`fogCloud.js`) and Poison cloud (`poisonCloud.js`, kind `miasma`) draw them; every cloud takes the Rolling edge. The palette renders sections from each material's `group` (Ground, Cloud, Marks; Light
is a mark). Every effect and light relights the grid at its edge: `grid.js` builds a falloff mask per shape and cell size
(the shape less its blurred copy) and draws the lines in the material's colour, and `lights.js` marks the grid dirty.
`shapeSelect.js` outlines a held effect in its material's colour. Claude's effect tools take a material by key or by its
English or Russian label.

### Lights

A light is a polygon, the same record as a room or an effect, in a list of its own. Lights are edited
in Effects mode beside the fires, as one list with the lights under the fires, so a click on a small
fire lands on it and not on the large lit area beneath. Both take their ids from one counter.
Every tool a room has works on a light: draw, select, move, reshape, round corners, rotate, scale,
Merge, Cut out, Split, copy and paste. Light is an effect type, a material beside Fire: pick a shape, pick the Light material, place it,
by hand or with the size presets. A repair acts on the kind being drawn,
fires or lights, never both. With Cut out, Merge or Split armed, a Ring acts only on the band its preview shows. The Lights switch in Map settings hides them all; a single light is
deleted, not switched off.

A picked effect shows a popup (`#fx-pop`) with its material and size. A placed effect stores an additive `preset`, and size
rescales from its current outline; any reshape drops it and the popup reads "By hand". Effects mode opens on the row's own
Select. A double-click on an effect opens the edit row; booleans combine like with like and refuse a light.

A floor plan seeds lights once. Map settings' Rooms and lights section loads one floor plan (`.dd2vtt`, `.uvtt` or `.df2vtt`, the same Universal VTT JSON; beside a map they are tried in that order and the first that reads wins) as a file card showing the plan's file name without its ending (ellipsis when long, full name in the tooltip; a scene stored before the name was kept reads "Floor plan"; the scene field `floorPlanName` travels with `floorPlan` and clears on remove), whose Draw rooms and Draw lights act on the file and whose trash removes the plan (`removeFloorPlan`) while the drawn rooms and lights stay. Each light in the file becomes one
polygon, by where it sits. A light inside a room fills the room up to the walls or its radius: the whole room when the radius reaches every corner, the part the radius
covers when it does not. The lights of one room become one polygon when they share 30% of the
smaller one, or fill 90% of the room together, so a table of candles is not fifty polygons. A light
in no room keeps its native radius and never joins another, so a lone torch stays lonely; only a
shape wholly inside another is dropped. An outdoor light is stopped by the rooms' walls: its circle
less every room, so a torch outside a house never lights the inside. Walls, doors and windows are not read, so
light stays in its own room and a doorway never lets it through; the DM drags the polygon through a
door by hand. After seeding the polygons are the DM's, and nothing follows the plan. A daytime map
has no lights in its file and is drawn by hand.

The TV draws a light only where the fog is fully cleared: a shrouded or half-shrouded room shows no
light, though its polygon stays, and a reveal brings the light with it. Both windows draw the union
of the lights on the effects layer, under the fog, as light pooled along the inside of each edge and
fading inward: a wide dim glow under a tight bright one, with no fill and no line. It is drawn at 60%
strength on the TV and the idle DM map, and at full strength on the DM map while a light is in hand.
In Effects mode only the picked light's outline is drawn at full strength. The DM sends the Player
the outlines as lists of points, so the TV holds no plan. The texture is rebuilt only when the
lights, the fog, the map, the grid cell or the strength change. Every change pushes an undo step,
rides Auto/Manual sync and saves with the scene.

The scene holds `lightShapes` and `lightsHidden`, beside `effects` and never in it, because an older
release maps `effects` through a function that would draw a light as fire. A scene without them has
no lights. In two-map mode each column holds and sends its own scene's lights.
