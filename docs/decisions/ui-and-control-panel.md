# Decisions - UI and the control panel

Split out of [DECISIONS.md](../DECISIONS.md). What was decided about the **DM's chrome** - the
toolbar, the control panel and its tabs, the scene library, the minimap's furniture and the
dialogs - and why it held.

The Player view has no UI at all, so nothing here reaches it. The layout and
button-identity rules that bind while editing this chrome are in the `dm-ui` skill; the
stylesheet cascade is in [src/css/CLAUDE.md](../../src/css/CLAUDE.md); how the panels are
wired is in [ARCHITECTURE.md](../ARCHITECTURE.md).

Status tags and the paragraph budget: see the main ledger's header.

---

## The dock (2026-10-02)

Twenty-three prototypes settled the DM screen's new shape; the last one, v23, is what shipped.
Each entry below names the earlier call it reverses. Those entries stay as the record of why
the old shape held while it did.

### The DM screen is one dock on the right edge, with an icon rail · `SETTLED` (2026-10-02)
Five floating places held the controls - the control panel, the room card, the top play group,
the Scenes button and the help corner - and each opened its popups somewhere else. One dock now
holds them: an icon rail on the right edge, one pane beside it, over the map and never narrowing
it. Reverses the icon rail rejected on 2026-08-30 ("icons alone do not say fog or grid"): the
panes now carry their own titles, so a rail icon only has to find the pane. Reverses the
Fog/Grid/Player tab bar and the panel's place under it. The open pane and the width persist under
new keys, never `evermist.cpPane`, which the previous release reads.

### A panel docked to the window's edge, for the fight table · `REJECTED` (2026-10-02, stands)
The dock is not the fight table's model. A dock pane was too narrow for the fight table and for
the Bestiary's stat blocks, so the fight table stays a free window and the Bestiary and the scene
library open from the rail as centred windows. All three wear the dock's grey.

### Scene control follows Figma's right panel · `SETTLED` (2026-10-02)
Fog, Rooms, Grid, Player and My seat, one section each. An eye means shown or hidden and ends its
row; a closed eye wears the blue tint. Numbers are fields with a leading icon you drag to scrub,
with no slider and no label. Movement is a preset dropdown and an eye, and Custom… opens the dials
beside the dock. Reverses "The Animation and Grid Type rows carry no pill": both rows are gone,
into the dropdown and a two-way segment. Reverses PRODUCT.md's "Cell size keeps its slider": the
cell size is a scrub field. The pane drives `#cp-legacy`, so no behaviour code changed.

### The TV zoom stepper is gone · `REVERTED` (2026-10-02)
The − / % / + stepper in the Player tab duplicated the minimap's wheel, which stays. The minimap
moved to the bottom-left corner, square, with Sync View and Lock on it and the TV's edges dotted
across it.

### The room card became the dock's Room tab · `REVERTED` (2026-10-08, the left panel)
Name as the header, Delete where Close was, the notes, pictures inline below them, the corner
radius. Reverses the card's automatic placement and its drag (clampPanelPosition is deleted),
"The card shows everything" (the fog pill left for the toolbar), the stored description height
(the notes grow with their text; `evermist.roomDescHeight` is no longer read) and "A destructive
button should keep the standard shape" for this one button: Delete is a header icon now, and a
room delete is undoable. The tab still follows the selection alone. The tab itself went on
2026-10-08: its name, notes and pictures live in the left panel, and the dock has no Room tab.

### The fog trio is the selected room's fog while Select is in hand · `SETTLED` (2026-10-02)
With Select in hand and a room selected, Reveal / Half / Shroud above the toolbar show and set
that room's fog, and T cycles it. With a drawing tool or the Brush in hand the trio is the paint
direction, as before. The room card's pill had been a second control for the first meaning.

### Two maps: the Room tab edits the room in its column · `SETTLED` (2026-10-02)
A column has no dock, so it reports its selected room to the DM window and every edit goes back to
that column alone, aimed at the column the fields were filled from rather than the one selected
now. A column refuses an edit once its selection has moved on. Two columns number rooms alike, so
the tab tells rooms apart by column too. The left panel is that tab now.

### The toolbar follows Figma: chevron lists and one operations button · `SETTLED` (2026-10-02)
Select, Shape ▾, Merge / Cut out / Split ▾, Brush, Door, then snap, straighten and Rooms/Effects,
in 36px boxes. A chevron or a right-click opens each list. Reverses "Every repair is on both bars"
as three buttons: they are still on both bars, behind one button wearing the last pick, and
picking Split disarms the other two. Reverses the corner tick and the right-click-only flyout, and
"A helper that is on no longer wears the picked tool's box": its underline went with the outlined
pick. Blue now means on or in use: solid for the tool in hand, a tint for a switch.

### On the narrowest window the toolbar gives way into the minimap's corner · `REVERTED` (2026-10-08)
The toolbar centres between the minimap and the dock. On a window too narrow for both, such as the
rig's 1008px, it slides over the minimap's right edge and never under the dock. Reversed by "The
toolbar is centred on the window, always" below.

### Settings gathers what applies to every scene · `SETTLED` (2026-10-02)
Language, Shrink big maps, Half and Feather, and the About block with the version and What's new.
Reverses "About moved into the legend" and the compression pill in the library header. Feather now
persists under `evermist.fogFeather`, like Half; Fog Reset still sets it back. Backup stayed in
the library.

### Flat-top hex is gone, with a one-way loss · `REVERTED` (2026-10-02)
A saved flat-top grid loads as pointy-top through a normaliser in `applyGridConfig`, with no
error. Its cells need one recalibration, and a rollback does not bring flat-top back.

### Music and Sounds are players in the dock · `SETTLED` (2026-10-02)
A round play/pause, the track, level bars, the state line, the volume slider and the download bar;
the sounds are tiles two to a row. The top play group and its pills are gone. Music groups came
later the same day, below.

### A music group is a name a track carries, never a subfolder · `REJECTED` (2026-10-02)
Subfolders of the music folder were built as groups and dropped the same day: nothing in the app
can make one, and a DM will not arrange an app's data folder by hand. Where a group is kept and why
is in `musicGroups.js`.

### A group is renamed by its name alone · `SETTLED` (2026-10-02)
The pencil beside a group's name is gone, in the scene library and in Music: two ways to the same
action is one too many. It had been added because a bare name read as a label; the name now
lightens on hover instead.

### A Sources row is the button · `SETTLED` (2026-10-02)
The grey row was already button-shaped, so it is the button: the floor plan row picks a
`.dd2vtt` and then names its room count, the module text row opens its panel. The icon beside
each does the next thing: Draw Rooms, and removing the module text. A folder icon beside the
row was built and dropped as the same action twice.

### A dropdown's list opens under the dropdown · `SETTLED` (2026-10-02)
Figma's way, the check on the left, at least as wide as the dropdown, above it where the window
runs out. Pop-outs that are panels (a colour picker, Custom movement) still open beside the dock.

### The toolbar never moves with the dock's pane · `SETTLED` (2026-10-02)
Its place comes from the window alone, and the pane stops at it. A rail border that only appeared
with the pane open, and a zoom read off the dock's own snapped border, each moved it a pixel;
the rail border is now always there and the zoom is read off a rail button. Its place is now the
window's centre, not the gap between the minimap and the dock (see the left panel, below).

### Grid and fog colour are undoable · `SETTLED` (2026-10-02)
They never were, 3.11.0 included: a focused field's own text undo made it look so. They ride the
same history as light entries with no fog image, one per drag or scrub. With two maps, Ctrl+Z
reaches the selected column. A successful undo says "Undone", because a note or a colour can
change with nothing on screen showing it.

## The left panel (2026-10-08)

Notes for the campaign, the scene and the room, and the room itself, moved to a panel on the left.
Backlog item 140 part 1; the spec was gitignored and is not needed to pick the work up.

### Notes live in a left panel, and the Room tab is gone · `SETTLED` (2026-10-08)
A scene with no rooms had nowhere to keep notes, and neither did the campaign. A full-height panel
on the left, the dock's mirror, holds breadcrumbs Campaign › Scene › Room over one level's notes. The
selected room's name, module dropdown, Delete, notes and pictures render in it, so the dock lost
its Room tab and `dockSyncRoom`. Picking a room opens a shut panel without changing what the DM
keeps open. The room's logic stayed in `roomCard.js` and `roomPictures.js`; only the host moved.
Reverses "The room card became the dock's Room tab". Nothing in the panel reaches the TV.

### The three levels never merge, and a crumb only picks a level · `SETTLED` (2026-10-08)
The panel follows the selection: the room if one is selected, else the scene. A crumb picks a level
(`notesLevelPick`) and changes nothing else, so the room keeps its crumb while the scene's notes
show. A new room pick, a deselect or a scene switch returns to following. Rejected: a crumb that
deselects the room. Never trust the `hidden` attribute on `#panel-room`: `.dk-room` sets `display`,
which beats it, and both levels then showed at once until `notesPanel.css` ruled it out.

### The toolbar is centred on the window, always · `SETTLED` (2026-10-08)
No dock pane, notes panel or minimap moves it. Each panel stops short of it where the window allows,
and only a panel's narrowest width may cover it, as the dock can on the rig's 1008px. Reverses the
toolbar's slide between the minimap and the dock, and the `--tb-left` and `--tb-right` that did it.

### The shut panel is a floating icon, not a rail · `REJECTED` (2026-10-08)
A 44px rail with one button was built first and read as an empty strip. The panel now shuts to a
36px plate at the top left, and a chevron in its header shuts it. The minimap sits to the panel's
right and moves with it.

### Notes are stored as a scene field and one campaign value · `SETTLED` (2026-10-08)
Scene notes are a `notes` string on the scene record, never snapshotted in `doAutoSave` or an edit
made while the fog encodes is overwritten. Campaign notes are `localStorage` `evermist.campaignNotes`.
The IndexedDB version did not move, because the previous release cannot open a newer one. A backup
carries `notes` per scene and the campaign's as `campaign.json` at the zip root. A restore adds the
backup's campaign notes below the DM's, once, and names anything unreadable in one dialog. Pictures
stay on rooms until the gallery (backlog 161).

---

## The windows (2026-10-03)

Item 150 redesigned every window the dock redesign had only recoloured. The prototype rendered
the app's own markup under the proposed stylesheet, and an audit measured each rule below.

### Every window outside the dock is one shell · `SETTLED` (2026-10-03)
Item 150, settled over four prototype rounds. A centred window has a 48px header with a 14px bold
title, its count, its actions and one close cross last; a free window (the fight table, the stat
block) carries the dock's 12px bold title. Controls in a window are 28px, a step above the dock's
26px. Widths are three: 360 for a question or a progress bar, 480 for a list, 720 for a reference;
the scene library and the Bestiary fill the screen. A window's title is the name of the button
that opens it, so "Scenes" became "Scene library" and "Add music" became "Add from YouTube".
Rejected: the first round, which gave each window its own header, close and button sizes and read
as inconsistent at a glance.

### Buttons are three kinds and an icon button · `SETTLED` (2026-10-03)
Primary wears the blue tint, one per window, and only where the window has an action it exists
for: the stat block popup has none. Secondary is grey. Destructive has no fill and carries the
trash; it turns red only under the pointer, and sits on the right in every footer and dialog.
No button has an outline; a focus ring shows only on keyboard focus. An icon beside a label sits
1px under the box centre, because Segoe UI's letters sit low in the line; the trash stays centred,
since its lid makes it read low once moved. Rejected: a grey-filled destructive button, one red at
rest, one on a footer's left while the next dialog put its own on the right, and a Done button in
a window where nothing waits to be accepted.

### Selection follows Gmail, not a tinted header · `SETTLED` (2026-10-03)
Reverses the selection bar that replaced the header in the scene library, the Bestiary and the
music download panel. The header never changes now: each list has a toolbar above it starting
with an all/none tick, a partial selection shows a dash, and ticking writes "N selected" with the
actions beside it, Delete last, and the list's count on the right. Ticks in a list show at all
times. Rejected: Material's tinted bar, on product grounds and because it squared off the panel's
rounded top corners; a Select all button beside the tick; ticks shown only on hover; "picked" for
"selected".

### Toasts are one style in one stack · `SETTLED` (2026-10-03)
Five toasts in four styles and three places became one stack above the toolbar: Undone, a removed
scene with Undo, a notice, the floor plan found, and an update. The update toast keeps the reason
it sat where it did: it stays clickable over any window's dimmer. A toast's action is blue text
with no fill; a filled button was tried and read as heavier than the message. The floor-plan
toast keeps its door count after the rooms, because the Draw them it offers draws both. Rejected: a toast
that announces an install as a fact, because an update is always the DM's choice.

### Both stat blocks share the Bestiary page's type · `SETTLED` (2026-10-03)
Reverses "the system blue" kept in "The bestiary is a table beside a one-column page": blue now
means on or in use, so the labels, dice and to-hit turned white or dim. The size and weight stay:
AC and HP as large heavy numbers, Initiative and Speed bold, each ability its own big modifier,
the name and the section headings large. Flattening them to the dock's type was tried and
rejected - the headings are how a monster is navigated, and the numbers are read mid-fight. The
fight table's popup reads at the same sizes, loses its grip, and its Save to Bestiary is a grey
button.

### The fight table reads at the app's 12px · `SETTLED` (2026-10-03)
It was 13 to 14px with 40px rows, larger than every other window. It now has 12px type, 32px
rows and sentence-case column titles. Add creature moved from the row under the table to the
header's primary button, and the close reaches the window's right edge, where it had followed the
fight's name. Rejected: an HP bar and other additions slipped into a restyle.

### The Bestiary imports from one file button · `SETTLED` (2026-10-03)
From a file takes a .json export or a PDF book and reads the extension; two menu items for two
file types asked the DM a question the file already answers. Search moved into the header, as in
the scene library, and the page's close became a collapse icon, since two crosses one above the
other read as the same button.

### The minimap draws no grid · `SETTLED` (2026-10-02)
It only ever appeared once a zoom made a cell four pixels wide, which read as a glitch.

---

### The interface translates by its English text, one language per window · `SETTLED` (2026-09-29)
The English on screen is the key to a Russian dictionary, so English stays the only language
the code is written in and a missing entry falls back to it. Keys were rejected: hundreds of
elements would each need one. A live switch was rejected: text the code had already built in one
language stayed in it after a switch, so the choice applies after a restart. The DM's own text
and every field being edited are skipped, because an edited field writes its text back to saved
data and a typed "Poisoned" would save as Russian.

### A missing Russian entry fails the release · `SETTLED` (2026-09-29)
`test/i18nGaps.test.js` fails on English with no entry, a count with no Russian forms, or a
sentence built from pieces, and the release workflow runs the tests. Rejected: a guard hook, which
misses edits made outside the edit tools; a `/commit` step, which loads an already long command;
a rule in CLAUDE.md, which nothing enforces. A warning-only report was the first shape, reversed
because a warning is skipped.

### A homebrew pill is written in the book's wording · `REJECTED` (2026-10-07)
Item 139 asked for a way to make a pill for an action not in book wording. A form in the stat
block that wrote the book's sentence was built, then taken out before release: an
action worded like the Bestiary's already gets its pill, so the form only saved remembering the
wording, which the DM knows. A typed shorthand such as `Bite: (+5){DC 13}[2d6+3]*fire*` was
rejected for the same reason, and because it is a second syntax beside the book's.

### Every Multiattack is one frame, and a busy one stays dashed · `SETTLED` (2026-09-28)

Amends the entry below. A Multiattack is one action, so every reading is one frame, plain counts
included, and a pill outside it is a separate action. A frame shows a count plus at most one of a
pick, a swap ("only one of which can be X" is one), or two full alternatives joined by "or". A
condition, a spell, an extra damaging action, a count the DM tracks (the Hydra's heads) or two of
those shapes at once stays dashed: a glance-sized frame cannot say it, and the stat block can. The
swap tag lost its divider line. An attack that only grapples gets a pill for its roll and DC, since
a Multiattack counts it. A non-damage step (Frightful Presence) still shows nothing.

### A Multiattack pick or swap is one frame, and bonus actions get pills · `SETTLED` (2026-09-27)

Amends the entry below. A pass over the Russian 2024 Monster Manual, the Free Rules and Curse of
Strahd found most Multiattacks fell back, because the 2024 books write "in any combination" or "can
replace one attack". The count on one pill read as if that attack alone repeated, so a pick or a
swap is now one outlined frame: the count once at its front, the options inside joined by "or", and
the swap as a tag naming its target. The swap target stays text, and its own pill keeps its place.
Two full alternatives ("either ... or ...") keep the dashed pill. A damaging bonus action is
easy to miss in the stat block, so it gets a pill tagged Bonus, outside every Multiattack count. Book
misprints stay as printed.

### The Attacks cell is pills, one per damaging action · `SETTLED` (2026-09-26)

A line of words gave most of the cell to type names. Each action that deals damage is now a pill:
name, to-hit or save DC, then a glyph and number per damage type, with colours after Baldur's
Gate 3 and glyphs from Tabler (the game's own icons are not free to copy). Segments separate by
tint alone; an outline, faint dividers, dots and a name outside the pill were sketched and
rejected as busy or hard to scan. A Multiattack gives counts only when its wording holds no choice
or swap, otherwise a dashed Multiattack pill; wrong counts are worse than none. Only Actions get
pills, and a Multiattack's non-damage step (Frightful Presence) shows nothing. Rejected on scope: a
universal action display with bonus, legendary and lair actions, moves and pools - a game
mechanic rather than a DM tool; the stat block covers them.

### A list of fights, and the table settled over twelve prototypes · `SETTLED` (2026-09-26)

Reverses four calls in "The fight table is a spreadsheet grid" below: one fight for the app (now a
list of fights, none tied to a scene), every number the same weight (AC and max HP are bold because
the stat block fixes them), a restore landing only on an empty table (it adds the fights missing),
and the row grip (a press that travels 5px drags). Bloodied moved from half or below to below half.
Rejected: a header that swaps into the picked row's actions, a ⋯ column, icons floating outside
the panel, fight notes (they wait for scene notes), and an Attacks line that only parses; the DM
can overwrite it. The open fight keeps the pre-list save shape under its old key, so a pulled
release still opens it and never overwrites another fight. The music pill's left corners square
off where it joins Bestiary in the top play group.

### A fight row owns a copy of its stat block · `SETTLED` (2026-09-25)

Reverses "numbered copies share one stat block" in the entry below. The bestiary is the source of
truth and the fight table a snapshot of it: a pick copies the entry, and nothing in the fight
writes back except Save to Bestiary, which always adds a new entry. Sharing one block between
copies was dropped because an edit to one copy is meant to reach that copy alone, which makes the
sharing invisible. Max HP belongs to the copy and is not typable in the row.

### The bestiary is a table beside a one-column page · `SETTLED` (2026-09-25)

Rejected layouts: a floating list panel, a list with the page inside a scene-library window, and a
full-window wiki with the stat block as an infobox. Rejected for the page: two columns, gold
highlights, number rows without boxes, printed-block lines, and every number the same size. Kept:
the system blue, AC and HP as the two large boxes, Initiative and Speed as smaller horizontal
boxes, ability cards keyed once in a caption, a sign hung outside the digits so they centre, and
an icon group in the page head that becomes an Editing strip. A floating Edit button was rejected
because it covers text while scrolling.

### The fight table is a spreadsheet grid in a floating panel · `SETTLED` (2026-09-24)

Eleven prototypes led here. Rejected: a text-only list that opened a field on click (HP must be
typeable with no click first), rows floating on the map with no panel, a panel docked to the
window's edge, serif type (every number carries the same weight), shields and bars as side
markers, and a Next turn button. Kept: a full grid with a divider on every column, initiative
in a darker strip, the side read from the name's colour, and a table that fills its panel edge
to edge. Numbered copies share one stat block. A backup restore merges the fight rather than
asking, because the module-text question may already be on screen.

### Every repair is on both bars · `SETTLED` (2026-09-13)

Merge, Cut out and Split were Rooms-only buttons while `commitShapeOp` already read `placeMode`,
so the reach was there and the gesture was not: putting a hole in an effect meant calling
`setShapeOp` by hand. All three sit on both bars now and act on whichever list the mode names.
`commitCutPath` was the last path still reading `polygons` directly.

The disarm on the way into Effects went with them. A repair armed in one mode survives the
switch, because its button is on the other bar to show it and to cancel it. The rule behind that
disarm holds: a button taken off a bar must disarm what it held.

The Brush and the Door stay Rooms-only. One needs fog to paint and the other needs a wall.

The clipping kernel's refusals name a room, and `refuseShapeOp` swaps the noun in Effects, so
`roomOps.js` stays pure and its unit tests keep comparing against the constant.

### A repair stays armed until it is pressed again · `REVERTED` (2026-09-13)

Merge and Cut out spent themselves on one shape for a day, on the reasoning that a mode set
correctly reads as armed twenty minutes later and eats the next room drawn. Use answered it:
repairs come in runs, and re-arming between each room cost more than the stale mode ever did.
All three repairs are sticky again and go out when they are pressed again, which is the way back
the buttons always offered.

The lit button is the whole signal, and it is on screen for as long as the mode is live. A shape
that lands on nothing changes nothing and leaves the mode where it was.

Split never moved. It is a tool in the pick-one row wearing the outlined blue box, so making it
jump back to Shape would drop the DM on a tool they did not pick with nothing lit to say so.

Entering Effects still disarms a repair, for the separate reason that no button there could show
or cancel it.

### The calibration count rides the map, and arming borrows the panel rather than taking it · `SETTLED` (2026-09-09)
The count stepper first went in `#context-row`, where it was never once visible: that row hides
for the whole of calibration, so the control shipped as dead markup. It sits on the map now, on
the app's own floating surface, under the shape and following it through a pan, a zoom and a
drag. It carries Done, which was the only way out that nothing on screen offered.
Arming shuts the control panel because it covers the map's right edge, and shifts the room card
away for the same reason - **the card's selection is untouched**, so the same card returns on the
same room, which keeps the selection-only visibility rule intact. Leaving restores the tab that
was up, unless the DM picked another one meanwhile: `#cp-tabbar` never hides, so that is a real
click and it wins.

### The Fog/Grid/Player tabs left the panel, and the panel now shuts · `SETTLED` (2026-08-30)
The panel covered about 288 screen px of map on the DM's right edge, so a zoomed-in DM framed the
TV against a viewport narrower than the one the players saw. **Trimming the region sent to the
Player by the panel width stays reverted** - it crops the TV to the DM's readable area, so content
stops reaching the table. What ships instead: `#cp-tabbar` floats above `#sidebar-right` and never
hides, and picking the lit tab shuts the panel, which gives the strip back without touching the
region. An acceptance check compares `dmVisibleRegion()` open against shut so the trim cannot
return unnoticed.
Rejected on the way, all built or sketched first: a vertical icon rail (icons alone do not say
"fog" or "grid", and the rail left an empty column beside the open panel); a pane header carrying
the reset; and stretching the reset button to the selector's height, which made it a rectangle.

### The Animation and Grid Type rows carry no pill · `SETTLED` (2026-08-30)
The pane gives 207px. Five 30px icons plus a 30px reset button only fit with nothing boxing them,
so the two rows follow the bottom toolbar's rule that a group inside a bar has no box of its own.
Both come out 30px tall with no rule forcing it. Any pill around the icons costs icon size, which
is what makes the smaller variants worse rather than merely different.

### Reset asks rather than offering an undo · `SETTLED` (2026-08-30)
Reset lost its full-width red footer button when it moved beside the selector it resets, so the
shape no longer warns and `confirmDialog` does. The undo toast was considered and rejected: it
belongs to `sceneDelete.js` and its button is wired to one fixed action, so sharing it means
rewiring scene deletion - more risk than the safety here needs.

### The UI scale slider is gone, and About moved into the legend · `SETTLED` (2026-08-30)
The slider set `--ui-zoom` from a bottom-left strip; that strip also held the two help buttons.
One button replaces all three: it opens the shortcut legend, and `about.js` now fills that
legend's footer instead of building a dialog of its own. `--ui-zoom` keeps its `base.css` default,
and the stored `evermist-ui-zoom` key is dead - a DM who had moved the slider returns to 120%.

### `window.open` reuses a Player window by NAME, and both directions bite · `SETTLED` (2026-08-30)
Every Player window is opened as `window.open(url, 'evermist-player')`, so a second call finds the
first by name and NAVIGATES it rather than creating one. Two live consequences, both found by
review after the pre-warm shipped. Warming a window while a Player is open re-navigates the live
one, so the TV reloads mid-session - `prewarmPlayer` refuses when `playerWindow` is open. And
warming one in the same tick as a close can land on the window still closing, leaving the warm
handle on a corpse and the next press paying the page load again - the close hands the dying
window over and the warming waits for it, bounded at two seconds.

### The landing card is the Player's loading state, not a hidden window · `SETTLED` (2026-08-30, replaced a hold)
Opening the Player used to put the app's own boot on the TV: the landing card carrying the app
name, then a flat navy cover, then the map. **Holding the window hidden until the map painted was
built first and rejected** - it removed the ugly part by removing the window, so the button had a
silent two-and-a-half-second wait behind it and nothing said the app was working. What ships
instead: the window goes up on the press, and the landing card stays on screen through the first
map's decode carrying a "Loading map…" line.
**`#landing.loading` sits at z-index 1000, ABOVE `#scene-fade` (999), and that is what makes it
work.** The cover has to stay opaque or the players see the map with no fog on it while `loadFog`
is still running; the card simply sits on top of it. ⚠ The rule is SCOPED to `.loading` and must
stay that way: the DM shows the same element when no scene is open, and unscoped it outranks the
scene library, the About box and every dialog.
Two things from the rejected version are kept because they are worth having on their own.
**Every Player window is created hidden** - `show: false` in `overrideBrowserWindowOptions` does
NOT work for a `window.open` child, so `did-create-window` hides it again - and `main.js` shows it
on the DM's `player-reveal`. That is what lets a window be pre-warmed at all.

**The Player's need-map retry starts on the DM's first message, never at init.** It runs for about
thirty seconds and used to start when the button was pressed, by which time a map had arrived and it
never fired. A pre-warmed window starts that clock long before the button, so the retry was still
running at adoption; the DM accepted the stale `need-map`, cleared `playerMapSent` and re-sent the
whole map mid-session, which reset the fog the players were looking at. It showed up as a shrouded
room reading fully clear on the TV, in one regression run out of five. Do not move the start back to
`initPlayer`.

A window is also **pre-warmed at DM startup and left hidden**, which takes the page load and the
blocking cloud-texture generation off the button. `playerWindow` deliberately stays null until the
button is pressed: adopting the warm window early would send every fog push, and pull every map,
into a window nobody opened. The cost is a second renderer process idle for the session. The map
is NOT pre-loaded into it, so what remains behind the button is the map's own decode - measured at
roughly 2.4-2.7s on an animated map on this machine.

### Player view has essentially no interface · `SETTLED`
An epic step called "Player view redesign" was wrong and was shrunk. `body.player-mode`
hides the sidebar, toolbar, minimap, scene dropdown, UI-scale row and the cursor. Exactly
three surfaces reach the TV: the scene transition fade plus scene name, the map loading bar,
and the landing/empty state. Keep them precisely because they are the only part of the app
the players ever see.

### A dark toolbar pill means pick exactly one · `SETTLED` (2026-08-06)
Snap-to-grid shipped alone inside a `.tb-seg` pill, which read as harmless because a group of
one has nothing to be picked between. Adding a second independent toggle beside it made the
pill say something false. Both toggles left the pill and became bare `.tb-toggle` buttons
behind a hairline, outlined blue when on.

The toolbar now carries three signals: a dark pill is pick-one, an outlined blue box is a
switch that is on, and the tool row wears that same outlined box while also being pick-one.
**The collision is deliberate and must not be "fixed"** — the tool picker is the one control
of its kind in the app and is meant to look unlike everything to its right. Rules are in the
`dm-ui` skill.

**The hairline is gone, and position alone carries the distinction · `REVERTED` (2026-08-09).**
The 1px `.tb-div` read as a scratch on the real monitor, which no amount of correctness in the
grouping argument survives. The gap it occupied is preserved as a margin on the first switch, so
the switches still read as their own group. **Don't reintroduce a divider on this bar.**

### The alpha slider's 1px edge fringe was `background-origin` · `SETTLED` (2026-08-06)
The opacity track painted a 1px column of the fully opaque colour on its left edge and of the
bare base grey on its right. Cause: `background-origin` defaulted to `padding-box` while
`background-clip` was `border-box`, so the gradient tile was 1px narrower than the visible
track and `background-repeat` wrapped it into the border ring. Fixed with
`background-origin: border-box` on `.ev-slider`.

Worth recording because of how it hid: the fog and hue tracks have the identical flaw and
neither shows it — fog's picked colour is dark against a dark checkerboard, and the hue
gradient starts and ends on the same red. **A colour-dependent rendering artefact is not a
colour bug**; the one visible instance was the only evidence three sliders were wrong.

### The FPS slider · `REVERTED` — deleted outright
It was a hidden `display:none` row, unreachable since the control-panel redesign, so it was
removed rather than restored. Deleted: the markup, the wiring, `fpsToFrameInterval` and its 7
tests, and the `videoFrameIntervalMs` field from the DM→Player `anim-params` message.
**`videoFrameIntervalMs` itself survives as a `const` = 1000/24 and is live** - `video.js`
throttles the frame pump on it every frame.

### The video codec hint · `REJECTED`
Carried for months without ever being wanted.

### Manual resolution slider · `REJECTED`
Irrelevant for images, and the display epic auto-downscales video textures.

### A click on the map takes focus off the room card · `SETTLED` (2026-08-09)
The map canvas is not focusable, so clicking it blurred nothing: once the DM typed in the room
card's name or description, that field held focus for the rest of the session and every later
Ctrl+Z reached its text history instead of the fog's undo. A mousedown on the map now blurs an
`INPUT`/`TEXTAREA`, which also runs the field's ordinary commit.

**The split is deliberate and was not changed:** while the caret is in a field, Ctrl+Z is that
field's text undo; on the map it is the fog's. Making Ctrl+Z always undo fog was considered and
rejected — it would make a room description uneditable in practice.

**WIDENED to any click outside the field (2026-09-16).** The map was the only thing that took
focus back, so a click on the toolbar, the control panel or the scene library left the field
holding it with nothing on screen saying so, and every later Ctrl+Z was still the text's. The
blur now hangs off a document-level mousedown in the CAPTURE phase: the room card and scene
fields stop the event bubbling, and capture also puts their commit-on-blur ahead of whatever the
clicked control then does. The split above is unchanged and is the rule — focus decides whose
undo it is.

### Every map shortcut reads `e.code`, never `e.key` · `SETTLED` (2026-09-16)
`e.key` is the character produced, so every letter shortcut was case-sensitive and
layout-sensitive: Caps Lock or a Russian layout killed the lot, and `S` and `L` had carried
hand-written capital branches to paper over half of it. `e.code` is the physical key and has
neither problem. Named keys — Escape, Enter, the arrows — keep `e.key` in the field handlers,
because the two strings are identical for them and `e.code` would break Numpad Enter.

The letters were remapped with it: `V` Select, `R` Rectangle, `O` Circle, `P` Polygon, `C` Cone,
`B` Brush. **Reveal and Shroud lost their keys** so the bare letters mean tools and nothing else.
The Ctrl branch now returns whatever the key was, which reserves Ctrl+C and Ctrl+V for the copy
and paste that do not exist yet; without it Ctrl+C picked the Cone.

### The What's new panel swallows every key while it is open · `SETTLED` (2026-09-16)
Letting the map shortcuts through it was built and `REVERTED`. The panel is modal and is being
read, so Delete would take out the room that was selected. The cost is that Ctrl+Z is dead while
the panel is up, which is correct for a modal and is what `help-and-about.js` criterion E pins.

### The Player's fullscreen state comes from the event, never from `isFullScreen()` · `SETTLED` (2026-08-09)
Fullscreen on the Player window is native window fullscreen driven from `main.js`, so the
renderer sees no `fullscreenchange` and `document.fullscreenElement` stays null — the state
exists only in the main process and has to be pushed to the DM to be shown.

**On Windows, `win.isFullScreen()` still returns the OLD value inside the window's own
`enter-full-screen` / `leave-full-screen` handler** (verified against Electron 43). Reading it
there reports every change backwards and the button lights up exactly when it shouldn't. Take
the state from which event fired. Reading the flag is correct only where no transition is in
flight, such as the initial push on `did-finish-load`.

### Switching UI scaling off CSS `zoom` · `PARKED`
Moving to `transform: scale` or rem-based units would retire a bug class at the root, but the
Electron 43 bump already did that job. Don't take on the refactor without a new reason.

### Errors go through the app's own one-button dialog · `SETTLED` (2026-08-08)
Eight native `alert()` calls shipped on error paths against CLAUDE.md's outright ban. They are
gone, replaced by `messageDialog()` in `confirmDialog.js` - the same `#cd-modal` as the yes/no
dialog with Cancel hidden by a `cd-solo` class, the single button taking focus, and Escape plus
the backdrop still dismissing. The cost being paid off here was never cosmetic: a native popup is
a separate OS window, so closing one left the page's focus desynced and a later click into the
room name field placed no caret.

A modal, **not** the existing non-modal notice pattern. `#scene-undo-toast` and the floor-plan
notice are deliberately non-modal because they carry good news that can be ignored, and an error
cannot. One behaviour followed from answering asynchronously: a failed scene load now starts its
recovery immediately rather than waiting to be dismissed, so walking away from the message cannot
strand a broken scene on screen.

### The backup export modal and the native restore picker · `REVERTED` — deleted as unreachable (2026-08-08)
Both were superseded by the scene dropdown, and neither had a caller left. Selecting scenes in the
dropdown and pressing bulk export calls `doExport` directly, so the modal's checkbox list,
thumbnails and select-all controls had no way to open; the "+" button noticing a `.zip` calls
`restoreFromZipPath` directly, so `doRestore`'s file picker was stranded the same way. Deleted:
`openExportModal`/`closeExportModal`/`updateBemButton` with their parse-time wiring, the
`#backup-export-*` markup, the `#bem-*` CSS, `doRestore`, and the orphaned `show-open-dialog` IPC
on both sides of the preload. Export and restore themselves are untouched. **Do not rebuild either
as a missing feature** - the dropdown is the entry point for both.

### A drag follows the mouse BUTTON, not the pointer over chrome · `SETTLED` (2026-08-26)
`mouseleave` on `#canvas-container` used to clear `isDrawing` and `isPanning`. The bottom
toolbar is `position: fixed` over that container, so every brush stroke along the lower edge
crossed it and ended there. Worse, `toolWindowMouseUp()` is gated on `isDrawing`, so the whole
release path was skipped: the DM's fog stayed stuck showing the raw stencil, and the reveal
reached neither the Player nor the scene save.

The handler now only clears the brush ring, and the window `mouseup` owns every release. Ending
the stroke at the edge instead was considered and rejected — it saves the pixels but still cuts
a normal gesture short. `lastMapX`/`lastMapY` survive the crossing on purpose, so leaving the
map and coming back is one continuous stroke.

### One dialog at a time, and none is dropped · `SETTLED` (2026-08-26)
`confirmDialog` and `messageDialog` share one pair of callback slots, and both used to write
straight over them. A second dialog raised while one was up left the first caller waiting for
an answer that could never arrive — a restore asking whether to adopt the backup's module text
simply never heard back.

A second request now queues and appears once the first is answered. Letting the newest replace
the first and treating the first as declined was rejected: it answers a question the DM never
saw, and the answer it invents is silently "no".

### A pick-one group gets its own pill, not an inset one inside the bar · `SETTLED` (2026-08-26)

The toolbar's "pick exactly one of these" signal used to be a dark inset pill (`.tb-seg`) drawn
inside `#toolbar-bottom`. With the fog trio moved to a row above the bar and a Rooms/Effects switch
added, that put a rounded box inside a rounded box at two different heights, which reads as a
mistake rather than as a grouping. Rejected on sight.

The signal is now a STANDALONE pill wearing the bar's own surface: `#context-row` above the bar,
`#place-pill` beside it. A group inside one of those is a bare `.tb-group` with no background,
border or radius. `.tb-seg` is deleted; do not reintroduce it.

Every standalone pill matches `#toolbar-bottom`'s height - 4px padding on 34px buttons there, 6px
on 30px buttons elsewhere. The placement switch sits outside the bar because it governs every tool
on it; inside, behind a wide gap, it read as one more segment.

### Two of the four 1.4.3 engine workarounds are gone, one is permanent · `SETTLED` (2026-08-29)
1.4.3 blamed all four on Chromium 120's `zoom` handling and 1.4.4 moved to Chromium 150 the same
day, so none had been retested. Measured on the current engine: `getBoundingClientRect` now folds
an ancestor `zoom` in, within 0.5px. The colour picker's reconstructed box and the Advanced
panel's hard-coded sidebar widths both went; each now reads the real element box, checked by a
real pointer event and by where the panel lands.
**`width: 0` on `.cp-chip-pre input` and `.cp-stepval input` is NOT an engine workaround and must
stay.** Removing it takes the field from 88px to 168px and overflows its row by 149px on Chromium
150. An `<input>`'s intrinsic width beats `min-width: 0` alone, on every engine. The comment
blaming Electron 28 is what invited the deletion, and it has been corrected in place.
The fourth, the opacity track's linear-gradient checkerboard, was judged by eye and left alone:
the payoff is three lines of CSS.

### The over-engineering sweep found almost nothing · `SETTLED` (2026-08-29)
Recorded so the same ground is not re-swept. Every top-level function is reachable, no CSS rule
or custom property is orphaned, no IPC handler lacks a caller, no constant table has an unused
key, and no config points at a moved file. What it did find: five unreferenced declarations, a
`getElementById` for an element that never existed, an unused `set-fullscreen` IPC route, and one
dead CSS rule.
Three leads were checked and struck rather than left open. `PLAYER_COVERAGE_FACTOR` is live and
covered by tests; only its comment was stale. The Player region-texture helpers earn their place
on a correctness ground the backlog had not credited - `bleedRegionEdges` stops a dark rim at the
map border. Properties that look write-only are browser and WebGL APIs the platform reads.
Deliberately not acted on: `memProbe.js` and `stress.js` ship unreachable in an install but remain
the only tools for two open questions, and 27 silently-swallowing catches are a diagnosability
question rather than dead code.

### The placement switch is back inside the bar, and `.tb-seg` with it · `REOPENED` (2026-09-04)
`#place-pill` was a standalone pill beside the bar so it would not read as one more group on it.
Two objects at the bottom of the screen is what that cost, and the bar sat off centre beside it.
The switch is a sunken `.tb-seg` track at the right-hand end of `#toolbar-bottom` now: a well cut
into the bar is the one shape nothing else on it wears, so it still reads as governing the tools
rather than joining them. `.tb-seg` is restored **for this switch and nothing else** - a pick-one
group inside `#context-row` stays a bare `.tb-group`, which is the rule that deleted the class the
first time. The bar sizes itself to whichever mode's tools are up, and `#bar-row` keeps it centred
while it changes width.

### A helper that is on no longer wears the picked tool's box · `REOPENED` (2026-09-04)
Snap and Straighten took the outlined blue box when on, the same mark the picked tool wears, and
only the gap between the two groups kept them apart. On a bar that now changes width with the
mode, that reading failed: a lit helper read as one more tool. `.tb-toggle.active` drops
`border-color` and takes a soft fill plus a 20px blue underline instead. **Nothing else on this
bar carries an underline**, so the outlined box belongs to the picked tool alone. The 1px divider
stays rejected - it read as a scratch on the TV, and the on-state is what was wrong, not the gap.

### A tool a mode cannot use leaves the bar rather than greying · `SETTLED` (2026-09-04)
Two of eight tools greyed out on whichever placement mode was not theirs, so a dead control held
prime position on every bar. Greying says "not now"; the DM reads it as "not here", and it is
never coming back inside that mode. The bar now carries only the tools the mode can use, sizes
itself to them, and `#bar-row` keeps it centred as it changes width. The four shapes collapsed
behind one button at the same time, opened on right click, which is what made the shorter bar
possible without losing a tool. Half is the only control still greying, because the Brush can
genuinely paint the other two fog states.
Two consequences that must hold together. **Each mode remembers the shape it last drew with**,
restored only when the current tool is unavailable in the mode being entered - Select is in both
lists, so it is never replaced. And **taking a button off a bar means disarming what it held**:
Merge armed in Rooms would otherwise survive into Effects, where nothing shows it or cancels it,
and swallow the next effect drawn. `commitShapeOp` still reaches the effects list, so restoring
those two buttons to Effects is markup plus deleting one line.

### The Select tool copies a vector editor's two levels · `SETTLED` (2026-09-17)
One click picks a room whole and shows its outline alone; a double-click opens it for editing and
puts its corners, walls and holes in reach. The two never show at once. Showing both would put a
bounding box's handles over every corner of every room, on a map already carrying doors, labels
and the room card, and the curve handles planned next are the smallest target of the three.
Reshaping costs a double-click first, which was accepted: rooms are prep work and are mostly left
alone once drawn. A Bend tool and a Transform tool were each offered for the bar and refused - the
whole gesture set lives on the shape itself.

### A hole stops at its room's wall instead of floating free · `SETTLED` (2026-09-17)
A dragged hole may overlap its room's wall and bite the edge; it may not leave the room entirely.
This is a deliberate departure from the vector editor the rest of the model copies, which lets a
subpath go anywhere: a hole clear of its room cuts nothing, so it reads as vanished rather than
moved. Tested on the ring's average point, where a circle's and a rectangle's centroid both sit,
because a stop that can be predicted beats an exact one. A hole whose centre is already outside -
reachable by dragging a wall inward past it - drags free until it is home, or it could never be
recovered. Marked reversible on product grounds.

### Ctrl+click means one thing per level, and Alt+drag copies on the first movement · `SETTLED` (2026-09-24)
Ctrl+click on a shape that is not open opens its corners, as Figma's Cmd+click reaches past a
group. Inside an open shape it keeps straightening a wall, as Figma straightens inside edit mode.
The two never meet, because each answers at one level only. Ctrl+click opens without starting a
drag. Alt+drag makes its copy on the first movement, so an Alt+click leaves nothing behind, and
Alt anywhere a Select press would grab nothing still pans. Inside an open shape a corner or wall
under Alt drags as it would without it.


### Effect presets: a size row above the bar, the wheel steps it, a click places · `SETTLED` (2026-09-29)
A shape with preset sizes lists them in `#context-row` as bare pick-one numbers, with no unit (the
cursor label names it). The picked size wears the tool row's outlined box, so the
pick reads at a glance; the dashed shape glyph first means draw by hand. Line and Ring have no
hand tool, so picking one arms a size. A preset never snaps: the grid sets its size once, at
placement, and a later grid change leaves it alone. The wheel steps through the listed sizes and
wraps; Ctrl+wheel still zooms. A cone or line aims by press-and-drag from its origin, like the
cone tool. Rejected in the prototype: a popup of size chips (read as a table), hover to open the
sizes, "Free" as a word, a unit at the end of the row, and an Effects tab in the right panel. An
aim handle on the placed effect was dropped because it needs an origin and angle saved on every
effect. The searchable material palette waits for a second material (backlog 46).

### Corners round by circles on the map, and the dock's radius fields went · `SETTLED` (2026-10-07)
Copied from Figma. A focused room, effect or light shows a circle inside each corner while the
pointer is on it: a drag rounds every corner, Alt+drag one. Circles on every corner in edit mode,
beside every vertex dot, were built in the prototype and rejected as too busy, so edit mode shows
the picked corner's alone. Focus hides them until the pointer is on the shape, because focus is
what the DM uses at the table. The Room tab's and the Effects row's radius fields were removed
rather than kept beside the circles: a double-click on a circle opens the one number field. A
corner that barely turns (a circle's or an arc's own points) shows no circle.

### The world map v1 · `SETTLED` (2026-10-08)
A map of the campaign beside the Scene library, which stays as it is. A place IS a scene group, so
making, renaming or emptying one is the same act in both views, and a scene stores only its own
position (`worldPos`). Positions are written once on the first open. A scene opens on a double-click; a
single click picks it and the notes panel shows its place. Add a scene imports off screen and never
opens: the TV and the open scene stay as they are. With two maps on, a double-click fills the selected
column and every change reaches the column that holds the scene, because a column saves its whole
record. With no scene open, Esc does nothing. Place notes follow their group on a rename. A right-click
menu carries delete, rename and take-out; the open scene cannot be deleted there, since that would switch
the TV. Roads, the fight flag and a background image are later. The place outline derived from its
scenes, the corner-scaling resize and the pushing apart of outlines were built here, then replaced.
**Later entries replace parts of this one:** the library is gone ("The Scene library is removed"), places are drawn polygons ("Places are polygons"), and roads and the background are built ("Roads are open lines", "The world map wears the scene's toolbar").

### Places are polygons, and the geometry decides who belongs · `SETTLED` (2026-10-08)
Replaces the place whose outline was derived from the scenes inside it, and with it the corner-scaling
resize and the pushing apart of outlines (both built, then removed). A place is a named polygon, drawn
with a rectangle, circle or polygon tool beside the existing way of dropping one scene on another, which
now makes the rectangle that fits both. A scene belongs to the smallest polygon holding all of its card;
one pixel out takes it out, so every move and edit re-files the scenes, and the library's group follows.
A group with no polygon gets the rectangle that fits its scenes, and a scene filed in the library is
moved inside its polygon. Polygons live under `evermist.placeShapes` and ride a backup in `campaign.json`.
Overlapping polygons are the DM's call: the smaller one wins a scene.

### A place is edited by the room's own code, and keeps its polygon zoomed out · `SETTLED` (2026-10-08)
Replaces the world map's own corner handles. A place is stored as a room-shaped record (vertices, corner
radii, curve handles), and while the map is up the room's selection code runs on it: rounding circles,
Ctrl+drag bends, curve handles, corner points, the scaling box, Escape's levels and Ctrl+Z are the
room's, not a copy. The room code reads its camera from globals, so each call borrows the world's for one
synchronous step; three of its release paths and `pushUndo` stand down for places. A copy on SVG was the
alternative and was refused, because two editors drift. A scene belongs to the outline as drawn, rounded
corners and curved walls included. Zoomed out, the polygon stays. (The scenes' shrinking to a count was replaced by the Mist look, below.)


### The world map wears the scene's toolbar, its names the room's plate, its background lives in Settings · `SETTLED` (2026-10-08)
Replaces the world map's own four tool buttons. The bar is the scene's: Select, Shape (rectangle, circle,
polygon), Merge / Cut out / Split, Straighten, then Add a scene and Find. The Rooms/Effects switch and Snap
are gone, and so are Brush and Door, which act on fog and walls a place does not have. The tool in hand is
the toolbar's own `shape` and `shapeOp`; the layer reads them, so a tool, a key and an armed repair mean
the same thing here as on the map. The scene's tool, mode and repair are put away on opening and given
back on closing. Merge, Cut out and Split run the room kernel on places: the first place keeps its name,
and a merged-away place hands its notes to it. A result with a hole in it is refused, since a place keeps
no holes. Picking a drawing tool no longer zooms the map in. A place's name uses the room label's plate,
size rule and top-left placement, and stays visible when the place is picked, because it is how a place is
renamed. The background image is one picture chosen in Settings, behind the places, with a size, an
opacity and a Move switch; its file sits in a database of its own and a backup does not carry it yet.
Roads wait for a spec.
**Later entries replace parts of this one:** a backup of everything carries the background ("With two maps on, the world map fills columns"), roads are built ("Roads are open lines"), the bar's order is "The world map's toolbar reads in three clusters", and a place's name is the room's label ("Zoomed out, the world map shows no scenes").

### The world map shows one level of name at a time · `SETTLED` (2026-10-08)
Refines the entry above. Zoomed out, the places wear their names and no scene in a place has one. Zoomed in,
the scenes wear their names and the places have none. A scene with no place is the exception: its name
shows at every zoom, over a bare marker. The count chip and the place marker are gone. Rename is off while
the name it would edit is hidden.

### A place's name is a small black plate inside its top left · `SETTLED` (2026-10-08)
Tried and replaced, in order: a plate that scaled with the zoom, a Figma-style name above the outline, and
bare shadowed text. White text over the picture was unreadable and bare text had no edge, so the plate
returned: 12px type on solid black with a hairline, inside the outline where a room's name sits. It is laid
by the room's own `fitLabelBox`, which finds the highest row the plate fits in against the left wall; the
earlier "highest vertex" rule jumped to the right on a slanted top. One size on screen at every zoom, cut
short where the shape narrows, and left out under 48px wide. The focus colour marks a picked place. Scene
names wear the same plate.
**Replaced by** "Zoomed out, the world map shows no scenes; a place's plate is a room's label".

### A place is drawn as a room is, in black · `SETTLED` (2026-10-08)
A slight black line, a slight black wash, a soft inner edge, and the gold line when picked. White, colour
and heavy casings were refused as foreign to a black and blue app. The wash is a layer of its own under the
scene cards, so a card sits on its place and is never tinted by it; the line and the edge stay on the
overlay canvas above.
**Replaced by** "The world map wears the Mist look": the outline is white and 2px, and the wash is gone.

### The world map wears the Mist look · `SETTLED` (2026-10-08)
Replaces three things. Scenes no longer shrink and hide when zoomed out: they stay as prints, with no names.
Places are no longer black outlines over a dark wash: the outline is white, 2px, and the wash is gone. Cards
are no longer 200x140: they are 110x77 framed prints with the name plate inside at the top left, so a module
with 200 scenes fits. The DM picked the look from a prototype and set its values: mist cleared 90%, colour
inside 70%, outline at full strength, edge softness 20. The mist drifts over the whole map with no setting,
and over the dark ground when there is no backdrop, where the places are clearings. The backdrop is greyed
outside the places, and 70% of its colour returns inside them. The zoom split moved from 0.5 to 0.75, where
a name plate fits in a print. A scene with no place is a black diamond with a white rim when zoomed out.
A card that used to sit inside an outline may now need re-filing on the next edit, because the card is smaller.
The mist is one svg built once, so the drift never restarts. If it stutters on a large layout, the fallback
is to render the masked mist to a canvas once per place edit and move only the texture.

### Zoomed out, a place shows its prints in a grid; the camera stays on the map · `SETTLED` (2026-10-08)
Refines the Mist look after the DM's first look at it. The prints sat where the DM had put them, so they ran under
the place's name plate and looked small in the old, wide spacing. Now, below the zoom split, each place seats its
prints in a grid inside its outline at the largest size that fits, up to 1.5 times the card, with its plate's
space kept clear at the smallest zoom the map allows. The grid is a view only: the stored positions do not change,
and zoomed in the prints are back where they were put. The prints cannot be picked or dragged zoomed out. Zoomed
out is also limited: no further than the layout with a margin fills the window; a small map stops where the places
level opens. With a backdrop picture the camera may go a fifth of the map's size past it, so far places are easy
to reach, and the mist stops at the picture's edge.
Plates and prints follow the interface zoom (`--ui-zoom`), because they read small next to the rest of the app at 1.2.
**The grid is replaced by** "Zoomed out, the world map shows no scenes", which also stops the interface zoom scaling the plate. The camera limits above still stand.

### The grid is one block; a place's plate sits a fixed gap from its top left corner · `SETTLED` (2026-10-08)
Refines the entry above after the DM saw nine grids in a prototype and picked the block. Zoomed out, a place's
prints stand in one rectangular block of rows and columns, centred in the roomiest part of the place, the last row
centred. The whole block is tested against the walls
and the plate, not each cell, so no print crosses a wall. A print's frame reaches outside its box, and the first
grid ignored that, so frames stuck out of the outline; the margin now counts the frame and keeps 8 screen px clear
of walls and plate. Refused after a look: fit in reading order, centred rows, keep-the-map, tight, mosaic,
honeycomb, centre cluster and a stack with a count. The plate no longer takes the highest row the room code finds,
which put it under the top-right corner of a place with a sloping top. It takes the spot nearest the top-left
corner of the place's bounds, 8 screen px from the walls, so the gap is the same in every place.
**Replaced by** "Zoomed out, the world map shows no scenes; a place's plate is a room's label".

### Every grid print is one size, and the plate's reach counts every zoom · `SETTLED` (2026-10-08)
Refines the entry above. The block no longer shrinks its prints for a small place: every print is the size of a
card and every block uses the same gaps, so places differ only in how many prints fit. A place too small for all
its scenes shows the first that fit, in reading order, and hides the rest zoomed out. A plate laid for one zoom
alone was overlapped at another, because the plate keeps its size on screen, grows in world units as the camera
moves out, and on a sloping or round wall its spot moves. The grid now keeps clear of the rect that holds the
plate at every zoom from the smallest the map allows up to the split.
**Replaced by** "Zoomed out, the world map shows no scenes; a place's plate is a room's label".

### Zoomed out, the world map shows no scenes; a place's plate is a room's label · `SETTLED` (2026-10-08)
Replaces the grid of prints. Three attempts at a grid (reading order, block, block of one size) each failed in
use: prints crossed walls, a plate was overlapped at some zoom, and a place showed none of its scenes. The plate's
spot moves with the zoom and the grid needs a layout for every zoom, so the cost of keeping them apart was a
kernel the DM could not trust. Now zoomed out only the places show, with the mist and the white outlines; scenes
appear at the zoom split, standing where the DM put them. A scene with no place is still a diamond. A place's plate
takes the room label's own type size (by zoom, clamped), weight, padding, radius, fill and gap from `roomPanel.js`,
and differs from a room's only in that a double click renames it. It sits at the top left of the place a fixed gap
from its walls. The interface zoom no longer scales the plate, because a room label is not scaled by it either.

### Roads are open lines the room editor edits, kept by a stored id · `SETTLED` (2026-10-09)
A road joins a scene with no place, a place, or nothing. Two scenes inside one place get no road; the DM said they
are not needed. A road end keeps the spot it was drawn at, relative to the place's centre, and moves with the
place; a reshape that leaves the spot outside puts it on the nearest point of the outline. Deleting a scene or a
place leaves its roads with an open end, and a scene's delete opens it only when the undo toast ends, so the toast
can still bring it back. A road scene is ungrouped in the library and held by the road's own list, so no scene
record gains a field and `/rollback` loses nothing. A scene dropped where a road runs inside a place belongs to the
place. Roads are keyed by a stored id and their notes by the same id, so a rename moves nothing and names need not
be unique.
The editor is the room's own, run on a record flagged `open`: no inside, no closing wall, two points at least, no
box and no corner circles. A second editor was refused again ("two editors drift"). An end dragged by hand sticks to
what it lands on when the drag ends. The road is drawn in the layer as an svg line with a wide hit stroke, and the
overlay canvas draws only the picked road's corners and curve handles.

### The Road tool draws as Figma's pen does · `SETTLED` (2026-10-09)
The first build drew a road by bare clicks, shown only as a dashed rubber band, with the name field opening at once.
The DM found it poor and asked for Figma's behaviour. Figma's help pages confirm only a click adding a point, Esc
leaving the path open, and a small circle over a point that closes it; the rest below is from memory of the app and
was not checked against it. A press puts a point and shows it. A drag out of the point bends the line through it,
the two sides mirrored, and the next stretch follows the pointer. Shift locks 45 degrees. The scene or place an end
will stick to is ringed before the press. Enter, a double-click or Esc finishes, and the road stays picked with its
points open; the name is set by double-click on its plate or the menu. A press on the open end of a road picks it up
again, walking the road so that end is last. An end that sticks to a scene or a place is not offered for pick-up,
because a click there starts a second road from that thing, which is how a junction is made.

### A road's corners round with the room's own circle · `SETTLED` (2026-10-09)
A road corner rounds exactly as a place's does: a circle shows while the pointer is near the road (a line has no
inside, so near stands in for over), and edit mode shows the picked corner's. Dragging it sets that corner's radius,
Alt or edit mode keeps it to one corner, and a double-click on it opens the number field. The fillet is the room's
own (`computeFillet`), so a corner between curved segments rounds as on a wall. The two ends have no corner and no
circle. The radius is stored per point (`cornerRadii`), beside the road's `cornerRadius` for all of them, and a rounded
road is drawn as its sampled line instead of exact curves.

### Scenes are picked together with Shift; the pick is scenes only · `SETTLED` (2026-10-09)
Shift-click toggles a scene in or out of the pick, and Shift-drag on the ground draws a box that adds every scene it
touches (zoomed out, only the diamonds, which are all that is shown). A plain click picks one scene and drops the rest.
A picked scene is dragged with the whole pick, and the right-click menu on a pick exports or deletes all of it. A place
or a road is always picked alone. The last scene clicked is the one the notes panel follows. The pick is a list in
`state.js` that counts only while that scene is in it, so a stale list can never act on scenes the DM is not looking at.

### The backup lives in Settings' World map section, and the pick is its scope · `SETTLED` (2026-10-09)
Settings' "World map" section holds the Background and, below it, the Backup: one line saying what a backup would hold,
Export and Restore. Export wears the pick ("Export 3 scenes") and, with nothing picked, saves everything. There is no
scope window. A backup of picked scenes carries the places that hold them, and a road only when it holds one of them,
so a scene keeps the road it stood on; a road end that points at something left out comes back open. The campaign note
stays out of a partial backup. Restore is a file picker, or a .zip dropped on the world map, and it is the library's
own restore, which merges and never replaces. A preview window before the merge was prototyped and not built.

### Settings is three sections in Scene control's own parts · `SETTLED` (2026-10-09)
Settings was five stacked headers with a sub-header inside World map and a header over a single switch. It is now
Interface (language, shrink big maps), Fog in every scene (Half shroud and Feather) and World map (background, position,
backup), each a section title over small sub-headers, in the parts Scene control uses. The background is the Sources
pattern: the picture's name in a field and a trash icon at its right that asks first, since the stored file cannot come
back. Half shroud, Feather, Size and Opacity are scrub fields, dragged by their icon, with no slider. Three layouts were
built in a lab (rows, an accordion, a drill-in page) and the rows won. The accordion stays the first thing to try if
Settings grows long.

### With two maps on, the world map fills columns; the app launches on the world map · `SETTLED` (2026-10-09)
Two maps opens the world map with a Left and a Right chip, the active one blue, each naming the scene its column holds.
A double-click on a scene fills the active column and the map closes on the columns; to change the other column,
reopen the map and pick its chip. A scene a column holds wears an L or an R. Esc, M and the button close the map and leave both columns as
they are. The app now launches on the world map with the last scene open underneath, flying out from it; two maps are
not kept across a launch, so a launch is always one map. The rig and the stress and memory probes ask for the scene's
own screen. A backup of everything always carries the background image (a tick to leave it out was built and removed), and a
restore adopts it only when the DM has none.
**The launch half is reversed by** "The app starts on the scene it was left on". The two-maps half stands.

### The app starts on the scene it was left on, not on the world map · `SETTLED` (2026-10-09)
This reverses the launch half of "With two maps on, the world map fills columns". The app opens on the last scene, as it
always did, and the world map is one press of M or its rail button away. The DM did not want the map between them and
the scene at every start. Part 3 of item 140 is dropped.

### The Scene library is removed; the world map is where scenes are made, found and deleted · `SETTLED` (2026-10-09)
The rail button, the window and its two modules are gone. Everything the library did has a place on the map: add, rename,
delete with undo (any scene, and deleting the open one switches to the first, as before), file into a place by outline,
find, export and restore, and the Live badge is the L or R chip. Dropped on purpose: collapsing groups, an empty named group,
dragging to reorder (a scene's place is where it sits), and duplicating a scene, which the library never had. The group
names stay a scene field and `sceneGroups.js` keeps their order and the pure kernel the music groups share. The code is in
git if any of it is wanted back.

### The world map's toolbar reads in three clusters · `SETTLED` (2026-10-09)
Select, the drawing tools, the boolean operations and Road; then Add a scene and Find; then Straighten, set apart as the
scene's bar sets its groups, with no dividers. Add a scene wears a plus, since not every scene is a picture. Road is a
tool in hand, so it wears the solid blue like a shape. Find is still the old field and is the next piece (item 163).
**Find is replaced by** "Find lists places, scenes and roads under the field".

### Find lists places, scenes and roads under the field, best match first · `SETTLED` (2026-10-09)
Find was a field that dimmed what did not match and flew to one hit. It now shows a list above the field: a count, then
Places, Scenes (with a thumbnail and the place they sit in) and Roads, six rows a group, the whole name first, then a
name's start, a word's start, any part. Arrow keys walk it, Enter or a click flies to the row and picks it, and Esc closes.
The map still dims what does not match. It finds a scene wherever it sits, in view or not. Names only for now; searching the
notes text is the next step if the DM wants it.
