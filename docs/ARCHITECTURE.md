# Architecture

A plain-language tour of how Evermist works, for anyone reading the code. It's a
client-side app with no server and no cloud database. Everything happens in two browser
windows running inside an Electron shell. The one listener it opens is on 127.0.0.1, for the
Claude desktop app (see "The Claude connection").

**Where to look for what.** This page gives the big picture and lists the subsystems; each one's
workings sit in its own file in [architecture/](architecture/), in the present tense, and nothing else. [CLAUDE.md](../CLAUDE.md) is the rulebook: the constraints you must obey when
changing something. [DECISIONS.md](DECISIONS.md) is the ledger of settled calls, including
everything that was tried and rejected - check there first if you're about to redesign
something, along with its topic files in [decisions/](decisions/). [PRODUCT.md](PRODUCT.md)
says what the app is for and what it will never do.

A sentence here that explains *why* belongs in one of those. This page says what is.

## The big picture

There are three HTML pages. `splash.html` is the startup splash, `stage.html` is the two-map
shell described below, and `index.html` is the app itself. It serves both screens:

- Open it normally, and you get the **DM window** with all the controls.
- Open it with `?mode=player`, and you get the **Player window**: no buttons and no panels,
  just the map. The pointer stays visible, so the DM can point at something on the TV. The DM
  window opens this automatically.

The map is drawn on the GPU with **PixiJS** (WebGL), which is what lets a 10000×6000 map
pan and zoom smoothly. The fog, grid, and cursor are drawn separately and stacked on top.

### Motion and start-up

Every surface on the DM screen opens from what called it and leaves back to it, through `motion.js` and its pure kernel `motionPlan.js`, by kind: menu, popup, window, pane, dialog, toast, bar, layer and list. The kind sets the duration and curve; rows glide wherever a list reorders. The interface does not read reduced-motion. At start-up the splash stays until `bootUnderSplash` (`playerWindow.js`) has finished the start-up work and sent `boot-idle`; the fog's cloud set is built once and the warm TV window copies it, and the toolbar fire's WebGL programs are built under the splash.

### Floating surfaces

Every popup, list, menu, pop-out, hint and HUD of the DM window is placed by one rule, `placeSurface` (`place.js`, kernel `placePlan.js`): its own side of its anchor, else the opposite side, else pinned inside an 8px window margin with a max height so it scrolls. Open surfaces are placed again on a window resize. The map's popups and the material palette stay above the bottom bars (`placeFloor()`). The Notes window and the Bestiary are fitted back inside a smaller window, and the Campaign's Open/More bar slides along the edge to stay inside the area left of the rail.

### The DM screen

The map fills the DM window. Over it sit three things: the toolbar at the bottom, the minimap in
the bottom-left corner, and **the dock** on the right edge. The left side of the window is empty.

The dock is an icon rail with one pane open beside it. The rail opens the Campaign (the world map), the
Bestiary as a free window, and the fight table as a free window. Its panes are **Map
settings** (grid first, then fog, rooms, lights), **Notes**, **Music**,
**Sounds**, **Pictures** (`gallery.js`) and **Settings**. Clicking the open tab again shuts the pane and leaves the rail. The
dock sits over the map rather than beside it, so opening a pane never moves the map or changes
what the TV is sent. Its inner edge drags to resize it, and it gives way so the toolbar stays
clear. The toolbar stays centred on the window whatever either side does.

**Music, Sounds and Pictures share one list pattern.** `libraryList.js` is the DOM (the ⋯ on the item under the pointer, drag
with a blue line, hold over a middle to group, edge autoscroll, inline rename, Ctrl+R); `libraryPlan.js` is the pure part
(the stored shapes and their cleaners); the order and group kernel is `sceneGroups.js`. Three local keys hold the result,
each a `local:` sync record (`syncIndex.js` LOCAL_KEYS, `syncMerge.js` KINDS; the whole record with the newer `at` wins):
`evermist.musicOrder` (order and labels; the groups stay in `evermist.musicGroups`), `evermist.soundsLayout` (order, groups,
labels, hidden built-ins) and `evermist.picturesLayout`. Locally they key by file name or picture id, and the synced form
keys music and own sounds by content hash. A rename is a label, never the file. A group exists only while it holds items.
The previous release never reads these keys, so it shows file names and every built-in sound.

**Sounds** hold the thirty built-ins plus the DM's own (`soundFiles.js`, files in `userData/sounds`, over 10 MB refused),
all as 30px rows that rename, move, group and delete the same way; the six built-in groups and "My sounds" are the starting
layout and follow the interface language until renamed. A left click plays one more copy, a right click stops the newest, and the
card's round button stops every sound. A deleted sound goes to the Trash with Undo (a built-in is a `builtins` entry holding its
file name). Sounds stay out of the backup zip.

**Pictures** (`gallery.js`) is the only place pictures live: portraits, monsters, letters, kept
under a name with no scene or room attached, in a database of their own (`galleryStore.js`). A
find field narrows the grid by name, "+ Add" or a drop adds, the shared ⋯ renames, moves to a group and deletes; the tiles
keep their size and gain groups and a hand-made order. Delete sends the picture to the Trash. A click puts the picture on the TV over the dimmed map (`tvPicture.js`), a second
click or Escape takes it down, and a Player that opens or reconnects gets the picture that is up.
With Two maps on, the DM window has no Player of its own, so the picture goes to the shared Player
window and covers both halves; Escape typed inside a column asks the DM window to take it down.
A still picture shrinks to the Compression size on the way in (4K when it is off) and stays PNG only
when it has transparency; an animated GIF, WebP or PNG and an SVG are kept whole. The first launch
of a build with the gallery copies every picture the rooms of any saved scene hold into it under
the picture's own id (`galleryMigrate.js`), once. Scenes keep their rooms' `pictures` and
`pictureBlobs` through every save, undo, paste and backup, so the previous release still shows them.

**The Campaign** (the world map; `worldMap.js`, `worldMapEdit.js`) is a DOM layer over the map. It replaced the Scene library, which is gone.
A place IS a scene group (`scene.group`) and each scene stores where it sits as `worldPos`, written by one
helper (`worldMapStore.js`) to the store, the open scene and, with two maps on, the column holding it. Scenes are
framed 110x77 prints, shown only zoomed in, where they stand as the DM put them and wear their names inside the
print. Zoomed out no scene in a place is shown: the places show, each with a name plate (the shared name plate below)
at the top left of the outline, with a pill after the name counting its maps (none when it holds none; hidden while renaming). Each place holding maps also shows a hand of cards
(`worldMapFan.js`): its first three maps as overlapping, slightly rotated cards and a "+N" card for the rest, seated by the
pure kernel `wmFanSpot` (`worldMapPlan.js`) at the spot nearest the place's centre that is inside the outline and clear of the
plate, shrinking through 0.85, 0.72, 0.6 and 0.5 before giving up (the place then shows its count only). The hand is hidden at
the scenes level, while drawing, dragging or editing that place, and follows Find's dim. Hover lifts a card and names its map;
a click picks the map and flies to it after a short delay a double-click cancels; a double-click opens it; "+N" flies into
the place; a right-click opens the scene's menu.
**One name plate** wears every renameable name: room labels (canvas), place plates, stray-map labels, road names, map-print names
and picture names. Its look is the `--plate-*` tokens on `:root` in `base.css` ("NAME PLATES"), which the canvas room label reads
through `rpPlateSkin()`. Every fill is opaque in every state, so no map line or art shows through a name. States: pointer, picked, renaming, Find's dim; room labels have none of the first and last-but-one (rooms
are renamed in the Notes window). One size rule, `roomLabelFontPx(z, uz, small)` in `roomPanel.js`: 12 x interface zoom x clamp(z^0.4, 1, 2.5)
for map names, 11 for names inside a picture, so every label follows the interface zoom and print names grow with the Campaign zoom.
In the Pictures pane a picture's name is a small plate at its bottom left, renamed in place (a click on it does not toggle the TV; a
double-click renames), the TV tag sits top left, and the picture on the TV wears the picked look. A scene with no place is
a black diamond with its name beside it. The camera cannot leave the map: zoomed out until every card, place and the picture fit the window with about 30% room (a small map stops at the zoom split times 0.85), and the
camera may go a fifth of the map's size beyond. The mist stops at the picture's edge. a scene with no place is a black diamond with its name beside it. Zoomed in the prints wear their
names and the places have none. Under the prints sits the mist (`worldMist.js`): a drifting veil that thins
inside the places, over the backdrop, which is greyed outside them. A place's white 2px line is painted above by
the room code. The bar is the scene's own toolbar lent to the layer and given back on closing,
with words only on Map and Group: Select, Map (adds into the picked group), Group (Rectangle, Circle, Polygon), Road (L), Marker, a divider, Find. No Straight walls row. Places
take no Merge, Cut out or Split (`worldMapShapes.js` draws them). Find opens the search over a dimmed map
(`search.js`: one box from any view, Ctrl+F or the toolbar's Find). One backdrop image, set in Settings, sits behind the places
(`worldBackground.js`, its own IndexedDB). A double-click, or the Open bar over the one picked map
(`worldMapOpenBar.js`), opens a scene. Add imports maps off screen, frames them and picks the first, and never opens
one. With no maps the app starts on the Campaign, which shows one centred card, "Add your first map" (`worldMapEmpty.js`); a place is called a group in the UI. Opening the
map frames everything on it in the part of the window the dock leaves clear, and with no place drawn it stays at the
prints. A right-click menu (`worldMapMenu.js`) offers each thing's actions (verb first, fixed blocks, keys shown; "Ungroup" Ctrl+Shift+G keeps the maps; Ctrl+G groups the picked maps, Shift+1 fits, Shift+2 zooms to group; a click on overlapping outlines picks the smallest group), a place is a room-shaped record (`worldPlaces.js`) drawn with the rectangle, circle or polygon tool and edited by the room's own selection code, and a scene belongs to the outline that holds all of its card. The room code reads the camera from globals, so each of its calls is made inside `_wmWithCamera`, which lends it the world's. The layer is a sibling of the canvas, so none of the map's
own handlers see it, and while it is up the map's keys are held back so nothing reaches the TV. Place notes
live in `evermist.placeNotes` by name and ride a backup in `campaign.json`.

**The party marker** (`worldParty.js`, pure `worldPartyPlan.js`) is one per library, in localStorage `evermist.worldParty`
as a point or a point tied to a map id. The Marker button places or moves it with one click, then returns to Select. Right-click a map, group or the ground: "We're here" (hidden on the map that
holds it); right-click the marker: "Take the marker off". Dragging moves it; released within a few screen pixels of a
card it lands on that map (top edge centre), else it stays free. It follows its map, live during a card drag; a deleted
map leaves it free at its last spot. World-map undo snapshots carry it. The mist thins in a soft circle of 280 world
units around it (`worldMist.js`); the TV never shows it. "Back up everything" writes it to `campaign.json` as `party`,
a pick export leaves it out, and import sets it only when the library has none, keeps the map link when that map came
in, and shifts a free point with the layout.

**The Notes window** (`notesWindow.js`, `notesTree.js`, `notesPanel.js`) is a free window the DM opens from the rail
(Notes, after Campaign), moves by its header and resizes by its corner; its place, size, tree width and
hidden tree are a viewing setting (`evermist.notesWin`). Every row but a section title has a ⋯, and every list reorders by drag (`notesTreeDrag.js`); rooms and roads take Notes-only groups, and a map dropped on a Campaign group moves its card inside the outline (`notesMapDrop.js`). The order is `evermist.notesOrder` (`notesOrder.js`, pure rules in `notesOrderPlan.js`), one record per list keyed by uids (the stored `monster` list is left untouched so a rollback shows the section as before) so a restore or undo finds its place; it never touches the fog, syncs as a `local:` record, merges per list and rides in a backup's `campaign.json`; a missing target is skipped, never pruned. Left is the tree of the whole campaign (groups nested
by the outline that holds them, maps and rooms, roads, factions and lore; creatures are not here); right is
the note of one thing, with its path as breadcrumbs in the header. What it shows is a target: what the DM picked, else
what the selection follows (the Campaign's pick, the selected room, the open map, the campaign). A room pick with the
window shut leaves it shut and the rail as it was. A map's notes go to whoever holds the map: the open map's
live copy, a column's inbox, or the stored record for a map nobody holds (a room patched by id). Room notes
render in the window but keep their logic in `roomCard.js`. Scene notes are a `notes` string on the scene record,
written by `doAutoSave`; campaign notes are one `localStorage` value; a creature's note is its `notes` field in the
Bestiary and is shown and edited only on its Bestiary page; factions and lore are `evermist.notesEntries` (`notesEntries.js`), which the previous release never
reads. All ride in a backup, the campaign's, the entries and the roads' in `campaign.json` at the zip root; a restore
adds the entries the library lacks and never replaces one. Nothing in the window reaches the TV. In two-map mode the
window follows the selected column, and an edit goes back to the column it was filled from. Grid calibration puts
the window away and brings it back.

**Mentions** (`notesEditor.js`, `mentionPlan.js`, `mentionIndex.js`, `notesAppears.js`) link any note to any entry. A mention is
stored inside the note's plain text as `@[Shown name](kind:id)`, so the field stays one string with its 20000 cap;
`mentionPlan.js` parses, writes and remaps it, and a token that does not parse cleanly is plain words. Ids are ones the app
never reuses: `fight:<fight id>`, `room:<scene id>:<room uid>`, `monster:<uid>` (a `uid` on the Bestiary entry, fresh on every copy), `group:<uid>`
(`evermist.groupUids`, name to uid, carried by backups), `road:<uid>`, `map:<scene id>`, `entry:<id>` and `campaign`. The id finds
the entry, so a rename rewrites no note: a label shows the entry's current name and the stored name is refreshed when the note is
next saved. A label is blue while its entry exists and red when it does not; a monster goes red only when it leaves the Bestiary. A creature link, a creature row in either "Appears in" list and a creature picked in the search open its Bestiary page, never the Notes window; with the Bestiary shut it opens straight on that page (`bestiaryOpenOn`), so the list's first monster is not in Back's history.
Every notes field in the window, room notes and the Bestiary page's included, is one contenteditable `plaintext-only` editor whose
`value` speaks the stored form, with its own undo and plain-text paste. "Appears in" reads the notes search already gathers and
finds the entry's ref in their stored form; it ends every note in the Notes window and sits at the bottom of a Bestiary page under "Your notes" (entry page and a fight row's copy), same rows, a dim count in the title. A transfer import rewrites `map:`, `room:` and `group:` mentions to the ids it
assigns, in every imported note.

Every writer of campaign data (campaign, place and road notes, places, roads, the party marker, the groups'
order) reports a failed `localStorage` save through `notesSaveFailed` (`notesPanel.js`): one `messageDialog`
per kind per launch, logged with `console.warn`. Notes keep a pending in-memory copy that reads prefer until
the next successful save; the other records already live in memory. A house-rule test lists the writers.

## The files

Moved to [architecture/module-map.md](architecture/module-map.md) - one row per file, what
it owns, in plain language.

## Bringing an animated map in

Moved to [architecture/animated-maps.md](architecture/animated-maps.md) - how a video map is read, played and stopped.

## Bringing in a folder of maps

Moved to [architecture/map-folders.md](architecture/map-folders.md) - how a folder or zip of maps becomes a group of maps.

## How the fog works

Moved to [architecture/fog.md](architecture/fog.md) - the fog mask, its clouds, themes and the half-shroud.

## Weather

Moved to [architecture/weather.md](architecture/weather.md) - rain, snow and the other weather layers.

## First-use hints

Moved to [architecture/hints.md](architecture/hints.md) - the first-use hints and when each shows.

## How the render loop works

Moved to [architecture/render-loop.md](architecture/render-loop.md) - the frame loop on the PixiJS ticker and what marks a frame dirty.

## How the two windows stay in sync

Moved to [architecture/sync.md](architecture/sync.md) - how the TV follows the DM screen: what the Player keeps in memory, the minimap, seat alignment, Fit to TV, the ping, effects and lights.

## Two maps at once

Moved to [architecture/two-maps.md](architecture/two-maps.md) - two-map mode on the DM screen and the TV.

## Rooms

Moved to [architecture/rooms.md](architecture/rooms.md) - drawing and selecting rooms, repair,
doors, the room in the Notes window and the floor-plan import.

## Reading a published module

Moved to [architecture/module-text.md](architecture/module-text.md) - how a module text or PDF becomes entries and room notes.

## The fight table

Moved to [architecture/fight-table.md](architecture/fight-table.md) - the fight table, the bestiary, spells, counters and the turn order on the TV.

## The Claude connection

Moved to [architecture/claude-connection.md](architecture/claude-connection.md) - the local MCP connection that lets Claude prep in Evermist.

## Exporting and importing your maps

Moved to [architecture/export-import.md](architecture/export-import.md) - backup export and import of the library.

## Syncing through Google Drive

Moved to [architecture/drive-sync.md](architecture/drive-sync.md) - sync of maps and music between computers through Google Drive.

## How the app tests itself

Moved to [architecture/testing.md](architecture/testing.md) - unit tests, the house rules and the test rig.

## How a version reaches you

Moved to [architecture/releases.md](architecture/releases.md) - the release pipeline, its gate and how installed copies update.

## The pointer and its crystal companion

Moved to [architecture/pointer-companion.md](architecture/pointer-companion.md) - the pointer and the crystal companion that follows it.

## The interface language

Moved to [architecture/interface-language.md](architecture/interface-language.md) - the interface languages and how text is translated.

## Where Evermist is listed

Moved to [architecture/listings.md](architecture/listings.md) - the sites that list Evermist and
what a release asks of them.

## How it's put together

- **Plain JavaScript in `<script>` tags.** No framework, no bundler, no build step, and no ES
  modules. The app runs straight off the local filesystem.
- **Separate canvases for map, fog, grid, and cursor.** Each is its own layer the GPU stacks
  together, so painting fog doesn't force the expensive map to redraw.
- **The code lives in `src/`, and `index.html` is only wiring.** A guard hook blocks any edit
  that grows the inline script.

---

Rules for changing any of this: [CLAUDE.md](../CLAUDE.md). Whether an idea was already tried:
[DECISIONS.md](DECISIONS.md). Whether it belongs in the app at all: [PRODUCT.md](PRODUCT.md).
