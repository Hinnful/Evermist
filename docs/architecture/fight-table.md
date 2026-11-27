# Architecture - the fight table

Split out of [ARCHITECTURE.md](../ARCHITECTURE.md): the fight table, the bestiary, spells, counters and the turn order on the TV, in the present tense.

**Turn order on the TV.** Start fight on the table shows the open fight's rows on the TV, End fight hides them, and only End fight ends it (no automatic end). The TV keeps the started fight's turn order while other fights are opened and edited; it changes only on End fight (on that fight) or Start on another fight, which replaces it, and deleting the started fight takes it off the TV. The fight list marks it with a "На TV" status word. The started state is never saved. Saved rows carry the open fight's id, so a failed list write cannot swap rows after a restart; "+ New fight" closes an open copy page, and the default fight name follows the interface language. Allies always show; an enemy shows once it has an initiative typed and while above 0 HP, in the table's own order (`initiativeSlots` in `initiativePlan.js`; `initiativeTv.js`, Player side `initiativePanel.js`): two sheets, bottom-left upright and top-right turned 180°, each in a pool of haze in the map's fog theme (a darker extra pool behind the sheet). Names are 2.7% of the Player window's height, never map zoom, one column to 10 slots, then balanced columns, in Alegreya (bundled in `assets/fonts/`; the first draw waits for it to load, then redraws, as canvas text never waits for a web font), then Georgia, "Times New Roman", serif. Monsters read "Monster" (Russian "Монстр"), always red, back-to-back ones merged as "Monster ×N". In two-map mode the shell shows the panel once: the bottom-left sheet takes column A's fog theme, the top-right column B's. There is no current-turn marker.

The Combat button opens a table for the fight in progress: a row per creature with initiative,
name, HP, AC and attacks. The title is a picker over a list of fights (combatFights.js),
none tied to a scene, and the open one stays put through a scene switch, two maps at once and a
restart. Max HP comes from the stat block and is fixed in the row; AC is editable and writes to the row's stat-block copy, making the monster custom (Save to Bestiary stays a separate step). The HP cell keeps what was
typed after the max, "- 9 - 12", with "= 24" beside it, yellow below half and red at zero. An empty
Init field hints the DEX bonus. A press that travels 5px drags a row. One icon header row (`combatHead.js`): the fight picker, a fixed 200px "Add creature" search that adds a bestiary monster as an enemy by Enter or click ("+ New creature" keeps the typed name), Clean up (solid blue, only while defeated enemies are listed), Sort (`combatSort.js`: sorts by initiative once, solid blue when live rows are out of order, moved rows glide to their places), the fight button and close. A click on the Init title sorts too; a drag on its strip resizes. Conditions sit in the Name cell as a first chip and "+N" (hover lists all), with a "+" at its right edge and right-click "Conditions" opening the checklist. An enemy at 0 HP or below dims and strikes through once its HP field is left; Clean up sets its `cleaned` flag and it renders in a folded "Defeated" line at the list's end (a render grouping, never a move in the array). Allies never fold, Sort ignores cleaned rows, adds land above the line, drag never crosses it, and HP above 0, Duplicate, a suggestion pick or "Return to fight" clear the flag. A long HP line widens over AC and Attacks while focused, only when its hits do not fit; unfocused it shows max, "…", the last hits and the sum. Ctrl+Z restores a deleted row. The empty HP field of the first two enemy rows with a max HP shows a dim italic "-12 damage" / "+5 healing" sample. Row hover actions are a toolbar plate centred over the row's right end (`combatRows.js`): stat block, duplicate, a devil|angel side switch (a missing side counts as enemy), delete. The Attacks cell shows each damaging action as a pill (attackLine.js reads it,
attackPills.js draws it): a glyph and colour per damage type, and damaging bonus actions after
the rest under a Bonus tag. multiattack.js reads the Multiattack into one frame: counted attacks,
a pick, a swap, or two alternatives joined by "or". Wording that needs more than one of those gives
a dashed Multiattack pill. It keeps them until the DM
double-clicks it to write a line of their own, and holds the row's icons on hover: stat block,
duplicate, switch side, delete. The right-click menu carries the same actions, and Ctrl+D
duplicates. Every column resizes (widths in `evermist.fightCols`), and the table resizes from its right and bottom edges. It grows down to the window's bottom and stays 8px inside the window and left of the dock's rail on a move or resize, as do the Bestiary and Notes windows (`dockFreeRight` in `dock.js`), so no window hides a rail button. The row's stat block is the row's own copy shown as a page in the Bestiary (below); `statW`/`statH` in the fight columns key remember the size it opens at, and a resize of that window updates them.

A row owns a copy of its stat block. Typing in a name field offers matching bestiary entries; a
pick copies the entry into the row, and after that the two never affect each other. The row's
name without its copy number, its AC and its max HP are the copy's own fields, so an edit on
either side shows on both. A hand-typed row starts from an empty copy. Save to Bestiary
lights after any edit to a copy and adds it to the bestiary as a new entry.

The bestiary is the DM's list of every monster, opened by the Bestiary button in a free window with its own shell (`bestiaryWindow.js`): a header with a list toggle, back/forward, crumbs and close; it moves by its header, resizes by its corner and stays 8px inside the app window. Place, size, list widths and list state persist in `evermist.bestiaryWin` (the previous release ignores it). It stacks with the fight table like ordinary windows: whichever the DM pressed last is in front (`bswFront`, the `over-fight` class), and both sit above the Notes window; both can be open. It switches by its own width (`bestiaryWidths.js`): wide (860px and up) keeps the header search, the filter row and the columns; medium moves search into the list, folds filters into one button and shows CR and name; narrow (list hidden, or under 500px with a page open) shows the page alone. Opened from the dock with no page open, it selects the list's first monster. An NPC with no stats keeps the stat block page: AC and HP as dashes, an empty Lore section hidden in read mode and kept in edit mode. New > "Monster or NPC" in the Notes tree creates the creature and opens its page in edit mode with the name focused. The search's action word for a creature is always "Stat block". Its shortcuts (Ctrl+A/C/V/D, Delete, Esc) act only while focus is inside it. A fight row's stat block opens as a copy page (`bestiaryCopy.js`): crumbs "fight › row", a strip naming AC and HP where they differ from the entry and holding Save to Bestiary (add-only), the pencil editing the copy (name, AC and Table line reach the row), notes being the source entry's note, and a book icon opening the entry. Back and Forward remember a monster by uid. The entry is found by uid (`combatBackfillUids` gives older entries one), falling back to base name and source, never when the copy has no source. Deleting the row, switching or deleting the fight, or closing the fight table closes the page. A redrawn page keeps its scroll, and a synced change is held while a page is edited (`syncMerge.js`). Grid calibration puts the window away and restores it. The list is a sortable
table, a name search and filters that read size, type and alignment in English or Russian
as one vocabulary (`bestiaryPlan.js`), and the picked monster's page beside it (`bestiaryPage.js`),
read-only until Edit keeps the same page with each value typeable in place (`combatStatBlock.js`): no field at rest, empty lines hidden behind "Add line", spells as text until Done. The page draws a spellcasting trait or action as rows: `spellcasting.js` (pure) reads it into a lead sentence and groups by level or frequency, or returns null and the paragraph stays. Each row is a chip on a plate with crystal cells, then spell labels. Limited abilities use the same crystals (`limitedUses.js`, pure: `usesFromName`, `legendaryPool`, `usesKeys`): "(N/Day)" gives N, a rest recharge one, the legendary pool N per round in its section heading, under keys `use|<name>` and `legendary` in the same `spent` maps; a grey plate leads the paragraph (`_bpCounters`). "Restore all" (`bpRestoreSync`) leads the page head's tools on an entry and a fight copy, inert with nothing spent, and `bpFitHead` drops its words to the icon only when the head would wrap (re-fitted by `bestiaryWidths.js`). A clicked crystal toggles a content key (innate|cast, slots:<level>/day:<n>/will, by spell name): on a fight copy it sits in the row's `spent` (synced, in backups); on an entry it sits in `evermist.entrySpent` by entry uid (this computer only, pruned at start-up to existing entries). Links pasted in go through a queue one at a
time; each is fetched in a hidden window that waits until the page text stops changing, so a site
that draws its stat block with its own scripts reads whole. `statBlockParse.js` finds the block by
its Armor Class line, names it from the line the page title starts with when one is there, and keeps the page's description as lore, a lair set inside it as lair
actions. The block ends at a site footer ("Habitat:", "Source:"), and unheaded text past the
element holding the last section is read as lore. A page whose block does not read clean is
refused with its reason, the same check a book import makes. Export writes the selected entries to a file. From a file takes either kind of file through one input and reads its extension: a .json is an export and is added back, a .pdf is a book.

A book read from a PDF gives every stat block in it at once. The picker hands over only the file's
path, and the extraction process reads the file itself, so a 300MB book never crosses into the
window. That process lays the text out a second time for monsters: each line carries the font it
is set in, and a band starts at a stat block's name when the other column is empty there, or
where the other column's half of the same box starts level with the name, which keeps a wide
two-column box from being read into the lore beside it or into the box above it. Where the box
above runs on past a name in the other column, each column is cut at its own height, and a page of
blocks set three abreast reads one column at a time. The rooms keep the first
layout untouched. `statBlockBook.js` learns which fonts the book uses for lore and ends a block
where the text changes to one, and starts an entry where a line opens in a font of its own; plain
text uses a short heading after a finished sentence for both.
A module import runs the same finder on its file, so its monsters arrive beside its rooms. Every
monster is sourced to the file name without its extension, a name already there under that
source is skipped. A block that does not read clean (no challenge rating, fewer
than six scores, an unnamed entry, a credit or caption left inside it) is left out: the import
names it in one message at the end, whose Import anyway adds it for the DM to fix by hand. A book that does not fit
in storage is taken back whole.

The open fight and the bestiary are one JSON value in localStorage, in the shape saved before the
list existed, and the other fights sit under a second key an older build never reads
(fightPlan.js). Both go into backups as `combat.json`; a restore adds entries the bestiary lacks
and fights the list lacks, never replacing one. Column widths and where the panel sits are kept apart, as viewing settings. The
Player window never builds any of it. `combatTracker.js` owns the table and saving, `combatRows.js` the rows, `combatHead.js` the header,
`combatStatBlock.js` typing into a stat block in edit mode (an entry's page and a fight row's copy), `bestiary.js` the list and its logic, `bestiaryWindow.js` the shell, `statBlockImport.js`
the queue and the book import, `combatPlan.js` the arithmetic and a row's copy.
