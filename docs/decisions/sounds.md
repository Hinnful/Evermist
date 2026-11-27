# Decisions - sounds

Split out of [DECISIONS.md](../DECISIONS.md). What was decided about one-shot sounds and their library, and why it held.

Status tags and the paragraph budget: see the main ledger's header.

---

### The soundboard plays decoded buffers through Web Audio · `SETTLED` (2026-10-01)
Copies of one sound overlap by design, and one file open on two `<audio>` elements stalls
Chromium's media pipeline. So the main process reads each file's bytes over IPC and the renderer
decodes them into an `AudioBuffer` once. That leaves no `file://` source for Web Audio to taint,
which was the reason music rejected it, and any number of copies can play at once.

### Rooms are layered by what they contain · `SETTLED` (2026-11-12; Bring to front / Send to back REMOVED 2026-11-19)
A new room goes below the rooms it contains and above those that contain it or that it only partly overlaps, so a room drawn
inside a hidden hall can be revealed. Bring to front / Send to back on the room's popup were meant to fix old maps; no
automatic re-layering. 2026-11-19: both buttons removed, rejected on product grounds, they did not earn their place on the
popup and placement layering covers new rooms. An old map layered wrongly before this has no UI to fix its order, accepted.
Layer order travels through sync and import as a stamped scene part. A click picks the smallest room under the pointer and a
second still click cycles outward; this reverses "rooms keep top-most" (Campaign menus entry) for rooms. Effects keep their
own order. CLAUDE.md's "never reorder `polygons`" became "only a new room's placement reorders `polygons`".

### Thirty built-in CC0 sounds, and the DM adds none · `REOPENED` (2026-11-11, superseded by "The DM adds their own sounds")
A curated set in six groups of five ships inside the app, as Freesound HQ previews of sounds
each page licenses CC0; `assets/sounds/SOURCES.md` lists them. Uploading the DM's own files
waits for a later version. The groups and their place in the panel are how a sound is found,
so there are no pins and no search.

### The DM adds their own sounds · `SHIPPED` (5.12.0, 2026-11-11; built-ins fixed, no sound groups and rename-by-file REVERSED 2026-11-12)
Asked for crystal, jingle-bell and gear sounds, the answer was an Add sound button rather than more built-ins, too small
for a backlog item. Files copy into `userData/sounds`, sit in one "My sounds" group (no DM-made groups), are named by file
name, and rename by renaming the file, so no new persisted field. × on hover trashes with Undo (an exception to the trash
icon). Sync follows music; sounds stay out of the backup zip; over 10 MB is refused. The built-ins cannot be hidden,
renamed or deleted. Rolling back to 5.11.0 leaves a trashed sound as a track that will not restore and its purge leaves the
file behind, accepted.

### A left click adds a copy, a right click stops the newest · `SETTLED` (2026-10-01; "no stop-all" reversed 2026-11-12: the Sounds card has a round stop-all button)
A second press of a playing sound starts another copy over it, for a second thunderclap or a
longer laugh. There is no stop-all control: the sounds last seconds. A prototype where a second
press stopped the sound was rejected on product grounds.

### Turn order on the TV took design H1 · `SHIPPED` (5.12.0, 2026-11-11, BACKLOG 290)
Two sheets in haze, names at 2.7% of window height. Rejected for monsters: glowing eyes (hard to read), a skull, an
italic word, a blank nameplate, "???", and a dark band behind monster rows (a band behind one row reads as the current
turn, a band behind every row too); a darker haze behind the sheet was kept. Rejected for showing: a plain TV toggle, a
Turns button on the minimap, automatic showing while the table is open; Start fight / End fight on the table won. All
rows show, as an earlier default of hiding rows with no initiative left the TV empty on first use. **Reversed 2026-11-14:** see "The fight table teaches itself". Alegreya was first left
unbundled, since that needs a `build.files` entry; 5.13.1 bundled it (SIL OFL allows redistribution, licence file beside
it, about 200 KB of installer) because names fell back to Georgia or the system serif.

### The fight table teaches itself · `SHIPPED` (5.13.2, 2026-11-14)
A first-time DM missed the hidden sort, ran every fight as one so unmet and dead monsters reached the TV, never found the side icon, and did not know HP takes "-12" / "+5". Settled: (1) a "Sort" header-bar button, lit only when rows are out of order; rejected: auto-sort, an icon in the 64px Init header, icon-only, the header cell as a button. (2) The TV shows allies always and an enemy only with an initiative typed and above 0 HP, **reversing** "every row shows" (2026-11-11). (3) No automatic fight end, **reversing** the auto-end with Undo: initiative without monsters is real. (4) A dim "-12 damage" / "+5 healing" sample in the empty HP of the first two enemy rows with a max HP; rejected: popovers, a sample in normal contrast (reads as real damage). (5) AC editable in the row, writing to its stat-block copy, **reversing** the read-only AC. (6) Hover actions: a solid devil|angel switch, inline Duplicate (clicked fast, many times), and ⋯ with the right-click menu, **reversing** "no ⋯" in the 2026-09-26 table entry; rejected: text or letter switches, sword/shield, hand-drawn art, an always-visible switch, a saved party roster. (7) A missing side counts as enemy. Mockups in `.claude/private/prototypes/initiative/`.

### Notes opening on a room pick, and a phone remote · `REJECTED` (2026-11-05)
Opening the Notes window when a room is picked (was BACKLOG 249) and a phone remote for the DM (was BACKLOG 144) were dropped
as not needed now. Closed unbuilt.

### Module text furniture filter reads climbing page numbers · `SETTLED` (2026-11-05)
A line is a running header only when its page numbers climb, the stat-block finder's rule; a one-column line split by a
bold or italic run stays whole. Tuned against Curse of Strahd and five other books.

### The fight table, smaller and easier to run a fight in · `SHIPPED` (5.17.0, 2026-11-20)
The table was ~1040 screen px wide, hid delete and the stat block in a ⋯, and left dead monsters either in the way or deleted. Settled: (1) one icon header: fight picker, a fixed 200px "Add creature" search (Enter or click adds an enemy; "+ New creature" keeps the typed name), Clean up (solid blue, only while defeated enemies are listed), Sort, the fight button, close; words and icons are never mixed, as words force ~990px. (2) Columns Init, Name, HP, AC, Attacks; conditions moved into the Name cell as a first chip plus "+N", with a "+" and right-click "Conditions"; Attacks stays, as the most useful column for hordes. (3) Every column resizes, Init and AC too, in a new key `evermist.fightCols` (the old key stays for the previous release); a click on the Init title sorts. (4) **Reverses part (6) of "The fight table teaches itself":** the row toolbar returns as a plate centred over the row's right end and the ⋯ goes; a plate above the row was rejected, its clicks landed on the row above. (5) Defeated: an enemy at 0 HP or below dims and strikes through once its field is left; Clean up sets a per-row `cleaned` flag drawn as a folded "Defeated" line (a render grouping, never a move in the array); allies never fold, Sort ignores cleaned rows, adds land above the line, drag never crosses it, and HP above 0, Duplicate, a suggestion pick or "Return to fight" clear it. The previous release shows such rows as ordinary rows. (6) HP widens over AC and Attacks only while focused and only when its hits do not fit; unfocused it shows max, "…", the last hits and the sum. (7) Ctrl+Z restores a deleted row. (8) **Reverses part of "A fight is a mention kind":** the table's "Appears in" is gone, as not needed; the Notes window keeps its own. (9) The table and the stat block popup stay 8px inside the window on every move and resize, the table growing to the bottom edge; covering the dock rail is allowed. **Parked:** whether the stat block button opens the Bestiary on the row's copy instead of the popup.

### Creatures live only in the Bestiary · `SHIPPED` (5.22.1, 2026-11-27)
A creature's note was already one record (`b.notes` on its block); the duplicate was a second entry point in the Notes tree. Settled: (1) a creature link, a creature row in either "Appears in" list and a creature picked in the search open its Bestiary page, and the Notes tree has no "Monsters and NPCs" section; (2) an NPC with no stats keeps the stat block page, AC and HP as dashes and an empty Lore hidden in read mode, because one click opening one page beats a special case per edge; (3) "Appears in" sits at the page's bottom under "Your notes"; (4) New > "Monster or NPC" creates the creature and opens its page in edit mode; (5) a creature opened from a note with the Bestiary shut opens straight on its page (`bestiaryOpenOn`); (6) the AI's notes-order tools refuse level `monsters`, level `monster` still reads and writes the note; (7) the stored `monster` order list is left so a rollback shows the section. Rejected: merging the Notes and Bestiary windows into one knowledge base (no felt problem: rooms open from the map, a creature opens for its stat block), notes on top with stats folded, and a "take stats from a monster" button.
