# Decisions - campaigns

Split out of [DECISIONS.md](../DECISIONS.md). What was decided about the Campaign board, groups, the world map and notes, and why it held.

Status tags and the paragraph budget: see the main ledger's header.

---

### A relationship graph of the party, NPCs and places · `REJECTED` (2026-10-04)
Proposed beside the world map (BACKLOG 140), after the R-maps of Japanese RPGs and the Pathways
map of the Smallville RPG. Rejected on product grounds: the view shows the DM relationships they
already know, so it does not help them run the game, even when it fills itself. A pre-written
module already carries its relationships, so only homebrew writers would fill one by hand, and
a search answers the forgotten-NPC case without lines. The pointcrawl stays, because there the
shape of the graph is the answer: lines decide where the party can go and how long it takes.

### Evermist writing itself into Claude's config file · `REJECTED` (2026-10-10)
Built first: every launch merged an entry into `claude_desktop_config.json`, in `%APPDATA%\Claude`
and the Microsoft Store build's package folder. A running Claude rewrote the file from the copy it
read at startup and dropped the entry, so it held only when Evermist launched while Claude was
closed. Replaced by a desktop extension (`.mcpb`) Settings hands to Claude, which Claude installs
and keeps. Evermist never writes another app's files.

### Claude's map tools: shapes and limits · `SHIPPED` (4.13.0)
Positions are percent of the map; rooms, effects and lights are numbered from 1 in `read_scene`. Cut and
split act on the named room only, where the DM's tools act on every room the shape crosses: a recorded
departure. Lights have no per-light switch, so Claude toggles all of a map's lights at once. A YouTube
download returns at once and fills in the background, since it outlasts the call's 330 s limit. A deleted
music track or map goes to the Trash for 30 days (amended 2026-11-09, see "Each computer keeps its own Trash"); Claude still asks in the chat first, which is where a wrong target is caught, and may now delete an animated map.
One IPC reads prep files from a path, checked by extension (floor plans 150 MB, text and PDF 20 MB, bestiary
.json 20 MB). One helper, `mcpEditMap`, carries every live map change, and the change also goes on the
DM's Ctrl+Z stack so neither undo drops or resurrects the other.

### Moving the campaign out of the browser storage for a closed app · `REJECTED` (2026-10-10)
Claude reaching the campaign with Evermist closed would have needed it in plain files. Rejected as
a large change with risk to saved data. A closed Evermist starts unseen for the call instead, one
copy per library, and quits after fifteen idle minutes.
**Reopened 2026-11-05** for sync only: a library in a cloud folder as plain files (BACKLOG 271); it does not replace Export/Import, resolved in `docs/decisions/storage-and-packaging.md`, "Sync runs through Google Drive, beside Export and Import".

### Notes as Markdown files on disk · `REJECTED` (2026-10-30)
Proposed as BACKLOG 195. Editing notes in another tool helps no DM, and files bring two writers,
sync gaps, renames that cut notes off their rooms, and a harder rollback. Links between notes are
built inside the app instead.

### Custom tags on notes · `REJECTED` (2026-10-30)
A lore entry naming an arc, with mentions and its "Appears in" list, groups things across kinds
without a second system.

### Notes navigation is one tree with sections · `SETTLED` (2026-10-30)
Places, with maps and rooms nested, then Monsters and NPCs, Factions, Lore. **Rejected:**
browse-by-kind (separates rooms from their map and flattens nesting) and context-only breadcrumbs
(prototyped, disorienting without a tree).

### Notes live in a movable window like the fight table · `SETTLED` (2026-10-30)
**Rejected:** a wide dock pane (covers about 600px of map), a stacked pane (the tree folds away),
and tree-in-dock plus a note window (the dock would leave Music or Sounds at the table, and two
surfaces open and close separately).

### Global search is Ctrl+F, opened from Find on the map toolbar · `SETTLED` (2026-10-30)
Ctrl+F is Figma's key and already the Campaign map's find. The button sits at the end of the map
toolbar, matching the Campaign map's toolbar, not on the rail, which holds campaign elements.

### The search box is one list of groups, with no best-match row · `SETTLED` (2026-10-30)
One list under the field, built from the app's window parts (`sm-win`, `sm-x`, `sm-field`, the window scroll bar, the
menus' divider between groups), the match bold in its own line's colour. Groups are ordered by their own strongest
result; the first row of the first group is selected and Enter opens it, so a result appears once. Ties put maps first,
then rooms, groups and roads, monsters and NPCs, fights, music, pictures. Five rows a group, so one big kind cannot push
the others out; "N more" opens the rest of that group in place. Recent holds 6, with no Clear. The selected row names its
action (Open, Open and send, Open map, Show on Campaign, Stat block, Fight table, Pick track, Open picture, Show notes).
Text is one short line each, with no Manual/Auto hint in the footer.
**Rejected:** a list with a preview pane (the map thumbnail in the row already identifies a map; search is a quick tool,
not a table); filter tabs across the top; a pulled-out "Best match" row (it read as a duplicate of the rows below).
**Reverses:** the Campaign map's Find showing every map as a picture when empty and cards when typing ("The world
map's bar has no words, and Find is a large search in the middle", the picture and card part only). That Find is this search now.

### Picking a map or a room follows Manual/Auto, and the map on the TV shows Live · `SETTLED` (2026-10-30)
Switching the map is a change the players see, so it follows the rule on every view: Manual opens it and the TV waits
for Send; Auto asks first. A room pick sends its map the same way. The map already on the TV wears the minimap pill's
pulsing blue dot and "Live" (chosen over an "On TV" chip and a dot alone) and opens without the question. Auto asks only
when the map is neither the open map nor already on the TV.

### Search internals: DM-only, cached scene reads, marks without playing · `SETTLED` (2026-10-30)
Search does nothing in Player and column windows. Rooms and notes are read from scene records once and cached per scene,
dropped when that scene is saved, imported or deleted; the open scene is read from memory. Recent keys live in
localStorage (`evermist.searchRecent`), a per-viewer convenience. Campaign notes are one row, "Campaign notes", in
Groups and roads, with the action word "Show notes". In two-map mode a room pick opens its map in the selected column
but does not select the room, since room selection there belongs to the column. Picking a track or picture marks it in
Music or Pictures and does not play or show it on the TV. The loading bar is light blue (`--b-icon`), because solid blue
means "press this" (`test/blueMeaning.test.js`).

### Mentions between notes are plain text with ids the app never reuses · `SETTLED` (2026-10-30)
A mention is stored as `@[Shown name](kind:id)` inside the note's text, so the previous release shows it as words and
no new persisted field is needed. Ids: a room is `room:<scene>:<uid>` (the numeric polygon id is reset by floor-plan
import, MCP import and undo); a monster gets a new `uid` (`b<n>` is reused by `combatNextBlockId`); a group uses a uid
from a name-to-uid map stored beside the place notes and carried by backups and transfer files (the place record's
`legacy-<name>` uid fails the id rule and record-less groups have none). Every copy of a Bestiary entry mints a fresh
uid, a re-read stat block keeps its own, and `combatMerge` matches by uid with uid out of its comparison, so an older
backup adds no duplicate. Rename rewrites no note; the shown name refreshes on the note's next save. Caps are counted on
the stored form and an over-cap edit is refused with a notice, never cut. A monster's label turns red only when it
leaves the Bestiary; the tree's Delete on a monster clears its note and leaves labels blue. A group's uid is not pruned
on delete or ungroup, so a same-named group or undo takes the old labels back. A transfer import remaps map, room, group
and monster-note mentions; one that would pass a cap stays red and the summary counts it. An imported monster keeps its
uid when no local entry shares it. The Bestiary notes field uses the same editor and cap as the Notes window.
**Rejected:** numeric polygon ids and `b<n>` as targets (both reused); rewriting notes on rename; cutting an over-cap note.

### The assistant fills the whole notes model · `SHIPPED` (4.18.0, 2026-10-31)
Claude gets everything the Notes window offers: create, rename, nest, reorder and delete factions and lore, and read and write every note kind with mentions and "Appears in". Deletes keep `confirmed: true`, and deleting an entry lists its children. A module NPC with no stat block becomes a blank Bestiary entry with a note, as "+ New monster or NPC" does. `create_entry` refuses a name already in that kind and names the existing entry, so reuse comes before create. The assistant may add mentions to the DM's own notes, changing only the name into a link.
**Link rule:** the first mention of a thing per note is linked, later ones stay plain, and an entry is never linked inside its own note. Per note and not per campaign, so "Appears in" lists every note naming it. This is guide text and not enforced by the app, as is "one session's chapters at a time", which has no size cap. **Rejected:** a per-campaign link rule; an app-side size cap. **Parked:** links to fights (BACKLOG 250). *Now built in 5.1.0, see "A fight is a mention kind".*

### The Settings line says to press Connect again after an update · `SETTLED` (2026-10-31)
The sentence "After an update, press Connect to Claude again." is permanent under Connect to Claude, because the installed extension holds its own copy of the tools. **Rejected:** showing it only after pressing Connect, or only after an update.

### One review and one undo for a whole assistant prep run · `REJECTED` (2026-10-31)
Closed unbuilt (was BACKLOG 243). No real prep run has shown the need. The official MCP servers of Notion, Figma, Linear and GitHub have no run-level undo and lean on the host app's own history. The assistant can delete what it made (each delete asks), and a backup before a big run restores everything. **Gap left:** notes the assistant rewrites while Evermist is closed are recoverable only from a backup, and an Evermist started unseen for an AI call loses its undo history when it idle-quits or the DM opens the app, because the page reloads. Revisit only if a real prep run shows the problem. **Note 2026-11-05:** a backup is no longer a stated purpose for recovery (PRODUCT.md, "Backup exists to sync the DM's machines"), so that net is not promised. Summary-UI prototypes sit in `.claude/private/design/item-243/review.html`.

### A fight is a mention kind · `SHIPPED` (5.1.0, 2026-11-02)
The @ picker lists fights and a link is `@[Name](fight:<fight id>)`, reusing the fight's existing id, so no persisted field is new and an older release shows the link as plain text. A click opens the fight table on that fight, hover shows the kind and "N enemies · N allies", a rename follows by id, and a deleted fight's link turns red and keeps its words. The fight table ends with "Appears in", the notes that mention the open fight, hidden when none. Claude writes `@{fight: Name}`; a bare `@{Name}` matching a fight and another entry stays plain and is reported ambiguous. **Rejected:** a new fight uid (the id already never repeats).

### The assistant's fight HP: the damage box and a per-fight max · `SHIPPED` (5.14.7, 2026-11-19)
A row's `hp` is the table's damage and healing line, after the max its stat-block copy holds. The tool gave it no description and `read_fight` called it HP, so max HP went into it as a bare number, which the table cannot add up (no bloodied, no down). Settled: a bare number is refused with what to send instead; `maxHp` sets one row's max in its own stat-block copy, so a fight can differ from the bestiary without touching it; `read_fight` answers max HP, current HP and the damage line apart. **Rejected:** taking a bare number as the max, as the table's own first typed number does, since the assistant meant damage as often as max.

### The assistant copies a map instead of importing it again · `SHIPPED` (5.14.7, 2026-11-19)
With no copy tool, a map copy was made by importing its source file again, and Compression is per computer, so the copy landed uncompressed (6000×5250, 245 MB) while the original was small. `copy_scene` copies the stored record with its own file (a shared path would go with the first delete), fresh edit times so sync sends it as a new map, and the source's own mentions pointed at the copy. `create_scene` and `copy_scene` state the pixel size and warn about an animated map past 4K (`mcpSizeNote`).

### The assistant shrinks a map already in the library · `SHIPPED` (5.14.7, 2026-11-19)
`shrink_map` runs the import's converter on a stored animated map and scales every pixel-space field by the width ratio: rooms with holes, rounded corners and curve handles, effects, lights, the grid's cell and crossing (`mcpRescaleScene`, additive, never a key list). Doors are `{edge, t}`, the fog picture is drawn stretched and the floor plan scales by `mapWidth`, so those stay. The new file waits as `.import` until the record saves, a failed swap puts the old record back, and sync hashes the map again once the file is in place. **Permanent, with no undo step**: the original is not kept (PRODUCT.md, "Compression is opt-in"), so the tool asks for the DM's yes in its description. Refused for the TV's map, for a map the DM has open, whose live copy would save the old positions back, and while Evermist runs without its window (`--background`), where video frames are not proven to arrive. `tools/rig/scenarios/map-shrink.js` drives a 4800×2700 VP9 WebM through it.

### A floor-plan room from a point · `SHIPPED` (5.14.7, 2026-11-19)
A doorless plan merges rooms through every opening, and tracing one by hand took a 58-point outline. `create_room` takes `at` and `close`: each closer's ends snap onto the plan's walls within 0.75 of a square, join the stored plan as portals marked `evermistCloser`, and the unchanged face walk closes the room; the smallest face under the point wins, wall loops inside become holes (`mcpRoomFromPoint`). The closers stay, so a later room needs only its point; an older release reads them as ordinary portals. **Rejected:** showing the plan's walls in `read_scene`, and a fixed-shape split line, which needs exactly two crossings.

### The assistant lays out notes like a module · `SETTLED` (2026-11-19, 5.14.7)
Option C of three. Place notes are timeless: a group is the region and who lives there, a map its overview, terrain rules and exits, a room what is seen, hidden, checked and found, with its fight linked. A character's own note is their Bestiary entry. Each session's plan is a lore entry under "Сессии", and no episode number or order goes into place notes. Prep kept outside Evermist is the source the notes copy. Guide text and tool descriptions only.

### Timing the search's first open · `REJECTED` (2026-11-02)
Dropped unbuilt (was BACKLOG 248): no user value. A real item comes only if a DM feels a lag on the first Ctrl+F.
