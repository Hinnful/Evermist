# Decisions - Module text import

Split out of [DECISIONS.md](../DECISIONS.md). What was decided about reading a published module and its PDF into entries and room notes, and why it held.

Status tags and the paragraph budget: see the main ledger's header.

---

### An LLM in the loop · `REJECTED`
Parse or match in a chat, import the result. Killed on product grounds: it would make the app
infrastructure for one particular campaign rather than a standalone feature anybody can use.
**The test to apply to anything in this area: does a stranger who downloads the `.exe` get
value with nothing else installed?**

### A notes scratch pad in the app · `REOPENED` (2026-09-29)
Rejected because it competed with Notion and lost (tables, initiative tracking, folders,
embedded links), which kept the room note to the five seconds when the party opens a door.
Reopened by the one-stop positioning in PRODUCT.md: a feature is judged by the work it takes
off the DM, not by another tool doing the job better, so notes on a scene or a place are in scope.

### Auto-assigning entries in click order (a queue) · `REJECTED` (reopened 2026-10-19 for Claude only)
Killed by the real text: sub-locations mean one heading covers several polygons, so it
desyncs within a few rooms. The DM picking is the irreducible step, because only they know
which blob on the map is K12.
Reopened for Claude only: it may name a room from a module or notes, because it reads both and the DM
reviews the result. The app itself still never assigns.

### Importing a DM's own Notion prep notes · `REJECTED`
They are unstructured and often do not exist. The bulk input is the module, which is highly
structured; the homebrew delta gets typed over the top in the card.

### The paste textarea, the Preview button, the explanatory paragraph · `REJECTED`
All three cut from the import panel. Preview was actively broken-looking: it re-parsed the
*textarea*, so with a file loaded it answered "paste some text first". A module is a file,
choosing one already parses it, and the parser's rules are not something a DM can act on.

### PDF support · `SETTLED` — the recommendation against it was wrong
Recommended against on the grounds that it bought only ~3 extra rooms over exporting a `.txt`
by hand. That measured the wrong thing: campaign modules ship as PDFs, and the cost was never
the rooms, it was making someone prepare a file at all. **The lesson: when the recommendation
is "have the user do a manual step", weigh the step, not the output delta.**

### pdf.js runs in a `utilityProcess`, not the main process · `SETTLED`
A module is an untrusted file and pdf.js is a large parser; in the main process it would sit
beside the filesystem helpers, dialogs, window handles and every renderer channel. What the
move buys: no Electron APIs, no renderer channel, crash and hang isolation, no state across
imports. What it honestly does not buy: it is still a Node process, so `fs` exists. Full
isolation needs a sandboxed renderer plus a custom protocol to load ESM from, which is a
bigger change to the `file://` architecture than the residual risk justifies.

### Storage is localStorage, not IndexedDB · `SETTLED`
`sceneStore.js` is one store keyed by scene id at `DB_VERSION 1`, so a campaign-level store
would need a version bump plus an upgrade path on the database holding the user's maps, to
buy nothing for a few hundred KB. The Electron store takes 52,428,705 characters in one key, measured
by `storage-full.js`, far more than the campaign holds; a failed save is reported by `notesSaveFailed`.

### Module text is campaign-level, and belongs in the backup anyway · `SHIPPED` 1.7.6 (2026-08-08)
Imported entries live in `localStorage`, deliberately outside any scene, because one book serves
every map in a campaign. The corollary drawn at the time - that they therefore stay out of the
export zip - does not follow. A zip is the only way a campaign moves between machines, and the
moment a missing room description gets noticed is at the table rather than during prep. Room
notes already survive the round trip; the source they were filled from should too.

Three shape calls settled while building it. **One entry at the zip ROOT, `moduleText.json`
beside `manifest.json`** - per-scene metadata would store the whole book once per scene and
re-import it N times on restore. **Replace or keep, never merge**: two books share no key space,
so a merged one would be neither. **Adopted after the scene loop and after the progress bar is
down**, so a question never opens on top of the bar and a storage failure cannot strand a
half-restore. Absence of the entry is the normal case, not an error - it is every zip written
before this - so the reader IPC resolves null where the manifest reader rejects.

### A sidebar classifier · `REJECTED`
A page of general rules between two headings is absorbed into the preceding room and the DM
deletes it (roughly 1 room in 13). Every signal is either language-specific or
indistinguishable from a long description, and a false positive silently loses real prep. A
test pins the behaviour rather than endorsing it.

### Synthetic fixtures validated the wrong parser twice · `SETTLED` (method)
Both serious parser bugs passed 77 green synthetic tests and died within seconds of touching
real text, and one synthetic fixture actively made a **correct** threshold look wrong (it
put paragraph-final lines at 41-44 chars; real ones run 15-30). Synthetic fixtures remain
right for the repo, because copyrighted text must not be committed, but **they prove only
the shapes already known. Get real input before believing a text parser.**

### A single false heading is catastrophic, not cosmetic · `SETTLED`
One cross-reference inside room К1's text cost К2-К6 plus К7's name: six rooms for one line.
That is why the sequence prefers its immediate successor over a forward jump, and why that
fix had to be gated on `prev > 0` after it regressed the numbered-list guard.

### A dash separating a BARE numbered key · `REJECTED` (2026-09-16)
Accepting `2 - Common Room` alongside `K12 - Chapel` reads a book's first random-encounter table
as its room list: the table's `1 - …` claims the number and every room after it reads as a
restart. Measured on real books: one module swapped all nineteen of its rooms for nineteen
encounters, and a one-page-dungeon collection lost nine. A dash behind a PREFIX shipped, because
the prefix is the evidence a bare number lacks. The cost is the one module keying rooms
`2 - Common Room`, which stays unread.

### A place word may key a room, from a CLOSED list and only in a run · `SETTLED` (2026-09-16)
`Area 1: Entry chamber` keys whole books, so a place word stands in for the capital prefix. An
open rule was rejected: `Глава 1:`, `Part 1:` and `Карта 1:` carry the identical shape and would
import a contents page as rooms. Two further guards, both found by running real books rather than
fixtures: a place-word key must appear more than once, and its numbering must start at 1. One
alone is a cross-reference in a paragraph; two references to the same book make a run between
themselves, so the count alone lets both in.

### A candidate FILLING the text column is prose · `SETTLED` (2026-09-16)
A heading is typeset on its own line and stops short; wrapped prose runs to the margin. Measured
on one book: the longest real heading line was 37 characters against a 51-character column, and
the eight false ones were 46 to 50. Rejecting them recovered 26 real rooms, because a numbered
sentence claims a number and drops every room after it. A threshold anywhere from 75% to 90% of
the column gave the identical result on seventeen books, so the rule is not balanced on an edge.

### The parser regression guard · `PARKED`
All test fixtures are synthetic, so nothing checks the thresholds that were tuned against a
real book. Change any one and every test still passes while every room silently arrives as a
wall of text. Deferred on the grounds that a gap with no risk attached can wait, which holds
while the parser sits still. **The trigger that changes that: if anyone retunes a threshold,
this guard lands in the same session**, because without it the retune is unverifiable. The
cheap fix carries no copyright risk: commit the **fingerprint** (line-length array, ordered
heading keys, per-entry body lengths), which is a statistics table rather than the work.

---

### Stat blocks read a second layout of the book, tagged with fonts · `SETTLED` (2026-09-25)
The rooms keep `plDocumentText` byte for byte; the stat block finder reads `plDocumentBlockText`,
where each line carries its dominant font and the font it starts in, and a band starts at a wide
two-column stat block box. Text shape alone failed on real books: a 2024 box read the lore beside
it into the block, a sidebar's bold lead-in looked exactly like an action name, and a wrapped name
merged into the entry above. Fonts separate all three within one book, and the finder learns them
per book rather than from a list. A diff of room entries on three books before and after showed no
change.

### A running head needs a climbing page number and a heading font · `SETTLED` (2026-09-25)
"The same words with a different number" also matched "пассивное Внимание 10" across monsters, and
a filter on lines repeated ten times deleted common speed and immunity lines. Both were reverted.
A running head now needs numbers that climb through the book, facing pages when seen only twice,
and a font that is neither the book's body font nor its lore font.

### A stat block that does not read clean is left out · `SETTLED` (2026-09-25)
No challenge rating, fewer than six scores, an unnamed entry, or a credit, caption or callout
number left inside it: the import leaves the block out and names it, with Import anyway. A
half-read monster that looks whole is worse than a gap, because nothing prompts a fix; the link
import and the editor fill a gap.

**No actions stopped being a refusal on 2026-09-29, reversing this entry's earlier call.** It was
kept as the check that caught a block whose actions a page break or a sidebar cut off. Across 29
books every such cut was fixed in the reader instead, and every block the rule still refused was
printed with no actions (Frog, Sea Horse, Shrieker, a guardian portrait); the DM pressed Import
anyway on each. A cut block now imports without its actions, so a reader change is diffed across
the book set before it ships. A challenge rating that runs into a new sentence is refused as page
text: it was the one misread the rule had been hiding.

### A link that does not read clean is refused · `SETTLED` (2026-09-28)
The link import took any page it found an Armor Class on, so a site whose layout merged traits or
dropped a score row added a half-read monster that looked whole. It now runs the book import's
clean-read check and names the reason in the failed row; the editor and Retry cover the gap.

### A book is read from its path · `SETTLED` (2026-09-25)
The Monster Manual PDF is 305 MB. The book import hands `getPathForFile`'s path to the extraction
process, which reads the file itself, so the bytes never cross IPC; the module import still sends
bytes. A module text store of 2M characters and a whole bestiary fit in this app's localStorage,
measured at about 50M characters.

### Two stacked boxes cut where the second one's other half starts · `SETTLED` (2026-09-28)
A 2014 page stacks two wide boxes, and a cut only where the other column is empty mixed their
halves: an adult dragon lost its breath and the young one below took the adult's legendary
actions, both reading as clean. The band now also starts at a name when the other column has a
gap ending level with it and the line under that gap is set in this block's fonts. Without those
two conditions the cut fired inside side-by-side blocks, before an Actions heading or at a
neighbour's name, and cost 2014 SRD monsters. A column mark on every line was built for this and
removed unused.

### Page text is skipped inside a block, never removed from the book · `SETTLED` (2026-09-29)
Footers, doubled page numbers and chapter heads rode on the last action of about 70 blocks.
Dropping those lines from the whole book moved block ends elsewhere, because lore fonts are learned
from how each font runs, so the reader skips them only inside a block. Two broader rules were built
and dropped: lines repeated ten times word for word, which deleted repeated attack lines, and a
block ending at any line in a font it never used, which cut spell lists and actions. What stayed
ends a block at two lines of flavour text in unused fonts, and reads on when an entry of the block
follows them. A publisher's legal footer is dropped by its wording.

### A scanned book is not read · `REJECTED` (2026-09-28)
Machine-read text misreads 13 as "l3" and 1d6 as "ld6". Scores, HP and damage could be checked
against their modifiers and dice, but AC, attack bonus, save DC and challenge rating have nothing
to check against, so a misread one reaches the fight table looking whole. Reading scans with those
checks was rejected; a book with real text and the sites cover the same monsters. Standing in 5.19.0: the 2014 Monster Manual in English reads 383 blocks and the import refuses all 383; English test coverage comes from SRD 5.1 and SRD 5.2.1.

### A site's missing average is worked out from its dice · `SETTLED` (2026-09-28)
A page printing "Hit: (2d6 + 5)" gets the average every book prints, the dice's average rounded
down plus the bonus. Without it the reader took the next number in the text, a disease's damage.
