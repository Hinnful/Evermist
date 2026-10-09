# Architecture - rooms

Split out of [ARCHITECTURE.md](../ARCHITECTURE.md). How a room is drawn, selected, repaired,
given doors and pictures, and drawn from the map's own floor plan, in the present tense.

A "room" is a polygon the DM draws on the map. It carries a fog mode (Revealed, Half, or
Shrouded), an optional name and description, optional per-corner rounding, and optional curves on
its walls.

Rooms are DM-only, and that comes for free rather than by enforcement: fog crosses to the
Player as flattened pixels, so the polygon list never leaves the DM window. There's no
channel to strip and no risk of leaking a room's notes to the TV.

**Selecting a room is the Select tool's job alone.** The other tools keep drawing new rooms
when you click, including ones that overlap or nest inside existing ones.

**The Select tool works at two levels, the way a vector editor does.** One click picks a room as a
whole object: its outline highlights and the whole thing drags, with no corner handles on screen.
A double-click opens it for editing, which puts its corners, its walls and any hole it carries in
reach, and Ctrl+click opens it in one press. Inside an open room Ctrl keeps its wall job below. Escape climbs back out one level per press - the picked part, then editing, then the room
itself. The two levels never show at once, because the map already carries doors and room labels.

**A wall can curve.** Hold Ctrl and drag a wall and it bends; Ctrl and click straightens it again.
The bend leans toward the point you grabbed, so pulling near one end curves that end harder - the
same asymmetry a vector editor gives you. Drag a bend back to nearly straight and it snaps flat,
so flattening a wall needs no key at all.

Each corner of a curved wall grows two control points, shown only for the corner you have picked.
They move independently, which is what keeps a sharp corner where a round tower meets a straight
corridor. A corner can carry rounding and a curve at once: the fillet is cut against the curved
wall's own direction at the corner.

**Corners round on the map, the way Figma rounds them.** A picked room, effect or light shows a
small circle inside each corner while the pointer is over it. Dragging a circle rounds every corner
to the same radius; Alt+drag rounds that corner alone. Inside edit mode only the picked corner shows
its circle, and dragging it rounds that corner. A double-click on a circle opens a number field
beside it for an exact radius. A shape too small on screen, and a corner that barely turns (the
points along a circle or an arc), show no circle.

The curve reaches the fog, the grid inside an effect and the players, because all of them trace the
same outline. Everything that has to walk straight lines - the clipping library behind a repair,
the effect shader, and hit-testing a click - samples the curve into points first.

A hole is picked by clicking its empty middle, which nothing else uses: that ground reads as
outside the room, so a click there at the object level falls through to whatever sits behind.
A picked hole drags as one ring and Delete takes it whole. It stops where it would leave its room
entirely, so it can hang over a wall and bite the edge but cannot float free.

**The bar carries only the tools the current mode can use.** Rooms shows Select, the shape
button, the operations button, Brush and Door; Effects shows all of those but Brush and Door,
which need fog to paint and a wall to sit on. A tool
the mode cannot use is not on the bar at all, so the bar changes width between the two and stays
centred. The shapes stand behind one button: a left click picks the shape it is showing, and the
arrow beside it or a right click lists the rest, with Cone, Line and Ring greyed outside Effects.
Merge, Cut out and Split stand behind the operations button the same way, and it wears the last
one picked. Each mode remembers the shape it last drew with, for the length of the session. The strip
above the bar shows only what the picked tool uses, and is blank for Select and Split.

Two toggles sit between the tools and the mode switch. **Snap to grid** pulls each corner onto
the nearest grid intersection. **Straighten walls** pulls a corner level with the one before it
when it's already nearly level, so a wall comes out square without a steady hand - it's an
alignment nudge, not a lock, so a wall you genuinely want diagonal stays diagonal. It works while
dragging a corner of a finished room too. Each shows it is on with a blue tint, which is a
different mark from the solid blue the tool in hand wears. Neither setting
is saved, both are off when the app starts, and both keep their state across a mode switch.

**Array order is fog compositing order.** The fog rebuild walks the room list in reverse, so
reordering the list silently changes what the fog looks like wherever shapes overlap. There
is no separate display order, and no room list UI to need one.

## Repairing a room

The floor-plan import draws most rooms correctly, and the rest need fixing rather than redrawing.
Three repairs cover it, and none of them asks you to select anything first: you pick what the
next shape should do, then draw it over the rooms you mean. All three stay armed until you press
the lit button again, so a run of repairs is drawn without re-arming between rooms. Split is a
tool in the pick-one row and stays picked like any other.

**Join**, which the bar calls Merge, unions the shape you draw with every room it lands on, so
one rectangle straddling two rooms leaves one room. The result keeps the name and notes of the earlier of the two, and takes
the *most hidden* fog mode of the pair - joining a revealed room to a shrouded one gives a
shrouded room, so a repair can never uncover ground on the TV by accident. **Trim** subtracts the
shape instead, and the bar calls it Cut out. One rectangle over a wall cuts a notch; one drawn
clean across a room splits it in two; one covering a room whole deletes it. **Cut**, called Split
on the bar, takes a clicked path rather than a shape: the
room becomes two rooms whose edges touch exactly, with no strip removed between them. That
distinction matters in a cave, where a Trim strip would leave a fogged line across open rock.

All three are one undo step, save with the scene, and reach the Player like any other room,
because a room's outline *is* the fog stencil.

**A repair keeps the curves, the corner rounding and the doors on the walls that survive it.** All
three are stored by position in the corner list, and a repair renumbers every position, so each one
is matched back onto the wall it came from afterwards. A wall the repair passed by comes out
unchanged; a wall it cut through keeps the half that is left, still a curve. The one thing with
nowhere to go is a door on a wall the repair removed outright: it goes, and a line appears on
screen saying how many went. A corner's rounding disappearing with the corner raises nothing,
because you drew the cut that took it.

All three repairs are on both bars and act on whichever list the mode names, so a Merge drawn in
Effects joins two effects and never touches a room. A repair armed in one mode is still armed in
the other, because its button is on both bars to show it and to cancel it.

A repair that cannot produce a valid room refuses and changes nothing, with the reason on screen.
There are two such cases: the clipping maths failed, or a cut path did not enter and leave the
room exactly once each. Pieces smaller than one grid square are discarded rather than kept as
slivers, and so are holes.

A Trim or a Cut landing wholly inside a room leaves a **hole** on that room rather than a second
room: the record gains `holes`, a flat list of inner rings one level deep beside `vertices`. Every
index the editing paths carry runs flat across the outer outline and then each hole, so an inner
wall has the same handles, corner rounding and door marks as any other. Drawing still makes a
room, so a shape drawn inside a courtyard is its own room standing in the void. A record with no
hole is byte-for-byte what it always was, and a saved room that has one is written as a shroud
carrying its real mode in `modeWithHoles` - an older build after a rollback then hides the whole
shape rather than opening the courtyard on the TV.

The geometry lives in `roomOps.js` over the vendored `polygon-clipping` library, and is unit
tested against rooms derived from a real Dungeon Alchemist cave export rather than against
rectangles alone.

## Doors

A revealed room reads as a sealed box: its outline is what the players see from across the table,
and a rectangle with no break in it says there is no way out. A door fixes that by changing the
outline. It is a notch of cleared fog one grid square wide, straddling the wall so it reads as a
gap punched through it rather than a bump on the room.

Pick the **Door** tool and click a wall. The click snaps to the grid cell it landed in, so every
door is the same size and lands on the same lines as the squares. Clicking the same cell again
closes it; clicking the cell beside it opens a ten-foot doorway. While the tool is picked the grid
draws on the DM screen even if it is switched off, and every wall carries a tick at each cell
boundary, which is the only way the cells of a diagonal wall are predictable.

A door on a curved wall follows the curve, because "where along it" is a fraction of the wall's
real length rather than of the straight line between its corners. The notch turns with the wall it
sits on.

A door stores nothing but which wall it is on and where along it. Width and depth come from the
scene's grid cell when it is drawn, so correcting a grid resizes every door already placed instead
of forcing a redraw. Two percentages under the tool set them, at 100% and 10% of a cell by default.

Reshaping the room keeps its doors where they are. Add a vertex to a wall carrying a door and the
door holds the same point of the map, moving onto whichever half of the split wall now carries it.
Delete a vertex and the doors on the two walls it joined go with them, having no wall left to sit
on.

A door belongs to a room, so it appears only when that room does. Its density, though, is the most
revealed of every room whose wall runs through it - which stops the choice of owner mattering on a
wall two rooms share, and gives half-shroud an answer. Doors reach the Player for free: they are
cut into the same fog stencil that crosses to the TV.

## The room in the left panel

Select a room and the left panel shows its level: the name as the header, Delete beside it, the
notes and the pictures. A shut panel opens on the pick without changing what the DM keeps open. It
stays on the room when you switch tools, so you can read the notes while painting fog. **Drawing a
room doesn't select it** - a new room is created with nothing selected, so the panel stays on the
scene while you draw the next one. The notes grow with what is written in them. Corners are rounded
on the map by their circles, not in the panel. The panel's other levels, the scene's and the
campaign's notes, are in [ARCHITECTURE.md](../ARCHITECTURE.md).

The room's fog is set from the toolbar: with Select in hand and a room selected, Reveal, Half and
Shroud above the bar show and set that room's fog, and T cycles it.

Room names are also drawn on the DM map itself, sized relative to zoom and placed inside the
room's outline rather than at its bounding box corner, which is what makes circles and
heavily-rounded rectangles work without special cases. `L` toggles them.

## Room pictures

A room can hold pictures: a portrait, a letter, a drawing of an item. They show in the left
panel below the room's notes, added with Add a picture or by dropping files on the panel. A
click puts one on the TV over the dimmed map, and a second click or Escape takes it down. The
picture comes and goes in soft patches of cloud noise, drawn on a canvas that hands back to the
plain image once it is whole, so an animated GIF plays throughout and a picture that is up costs
the TV nothing.

A still picture shrinks to the Compression size on the way in (4K when Compression is off), and
stays PNG only when it has transparency. An animated GIF, WebP or PNG and an SVG are kept as they
came, since a canvas would keep one frame of the first and blur the second.

The bytes belong to the scene, never to a room. A room holds only each picture's id and name, so
its record stays plain data an older build can save and back up. The TV loses the picture whenever
what it came from goes: the picture, its room, or the scene. In two-map mode one picture covers the
whole TV, and a column showing a second one replaces the first.

## Drawing the rooms from the map's own floor plan

Dungeon Alchemist writes a `.dd2vtt` floor plan beside every map it exports: wall segments,
doors and windows, light sources, and the grid calibration, all as vector data. So the rooms
don't have to be traced by hand or guessed at from pixels - they're already in a file.

Importing a map asks the Electron shell whether a plan sits beside it. That question is asked
**first, before anything else touches the file**, for two reasons: the map is about to be copied
into the app's own folder and will no longer have a sibling to find, and if the map gets
compressed on the way in, the file that arrives at the far end was built in memory and has no
place on disk to look beside at all. A notice then appears with the room count, and Draw Rooms
in the Fog tab stays available for later.

The plan's coordinates are in the pixel space of the export it was written beside, so the rooms
are scaled onto whatever size the map actually is before they're drawn. Without that step a
compressed map would get rooms half again too large - correctly shaped, sitting in the wrong
place, with nothing to indicate anything went wrong.

**Draw Rooms also marks the doorways.** The plan lists every opening in the walls, but it does not
say which are doors, which are windows and which are the way out of the building. What separates
them is what stands either side: an opening on a wall two rooms share is a doorway between them,
and one with a room on a single side is a window or an outside entrance. Only the first kind gets a
door, so a plan with ten to fifteen internal doorways stops being ten to fifteen clicks. A derived
door is the same thing a click makes, so it takes the same size dials, comes off with one click,
and is saved with the scene.

**The plan also sets Grid Size**, which used to mean typing the export's DPI in by hand and
guessing after a map had been compressed. The plan says how many squares wide the map is, the map
says how many pixels wide it is, and dividing one by the other is the answer - which stays right
whatever happened to the map's resolution on the way in. It happens once, when the map first
arrives; pressing Draw Rooms later never moves a grid that has been adjusted since. Grid offset is
still yours to nudge, because a plan can declare its own origin and a correctly-sized grid can
still sit half a square out of phase.

The geometry is five steps and lives in `vttPlan.js`, entirely separate from the app. Wall
segments are unioned with the portals that fill their gaps, because walls alone have a hole at
every opening and are not a closed plan. Edges are split where one wall meets another
mid-span. Then the enclosed faces are walked, and each is classified by which direction it
winds: one way is a room, the other is the outline of the whole building.

Two properties are deliberate. **Coordinates are grid squares, not pixels**, so every
tolerance is resolution-independent. And a room whose wall has a gap gets bridged only if the
two loose ends are each other's nearest feature and close enough to be no coincidence;
anything wider is refused rather than invented, because a confidently wrong room costs more
than a missing one. Two ends that pick each other are allowed to reach twice as far as a
single end reaching for a wall, since they are far better evidence of a wall that was once
whole.

**Cave maps need one more idea: telling a room from solid rock.** A cave is drawn with walls
exactly like a building, so a boulder standing in a cavern encloses a face and looks like a
small room, while the cavern itself encloses a huge one that wraps around every building
inside it. The signal that separates them is the doorway. A real room always reaches
somewhere, so its walls arrive as an open chain that closes only once the doorways are filled
in; a rock closes on itself with no door anywhere. Anything bounded by a doorless wall is
refused, which drops the cavern and the rocks together with no size limit to tune.

That test is also applied *before* gaps are bridged, because rock must never be a target. A
room whose whole side opens onto a cave has a loose wall end at each side of the mouth, and
the nearest thing to each is the cave wall a few feet away, not its real partner across the
opening. Left alone, both ends glue themselves to the cave, close nothing, and the room is
swallowed into the cavern.

What a cave map cannot give is the cave's own chambers. They are one continuous space with no
wall between them, so nothing in the file says where one ends. Splitting the cavern polygon by
hand is the intended route.
