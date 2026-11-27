# Decisions - Corrections worth keeping

Split out of [DECISIONS.md](../DECISIONS.md). What was decided about reasoning that turned out wrong in a way that would repeat, and why it held.

Status tags and the paragraph budget: see the main ledger's header.

---

Reasoning that turned out wrong in a way that would repeat. Each is here so it doesn't.

**"It's a big refactor."** Said about the comment trim. It conflated *deleting reasons* with
*trimming verbosity*. Different operations: the second is comment-only edits with no code
change, and the test suite catches the one real risk.

**"An initiative tracker loses to a physical one."** True of a paper tracker on the table, and
beside the point for a DM who tracks HP, AC and saves in a browser. The comparison has to be
against what the DM actually uses, not against the best physical object that exists.

**"PDF support isn't worth it."** Measured the wrong thing - the cost was never the extra
rooms, it was the DM having to prepare a file at all.

**"The whole-book numbers."** "301 locations, 88/88 castle" was measured by the parser *before*
sub-locations landed. The current parser finds strictly more and nobody has re-run it. Don't
quote those figures as current.

**"Universal VTT carries a still image."** True of the format's own specification and false of
the tool: Dungeon Alchemist's UniversalVTT export offers video file types, writes the video as
a sibling file and leaves `image` an empty string. Reading a spec is not checking what the
exporter does.

**"Loose wall segments mean face-finding is several evenings."** Judged before the portals were
unioned in. Walls plus portals close the plan, and the derivation took one pass. A partial read
of a data file is not a basis for an estimate.

**"Brush radius is applied in map-space, so 40px isn't 40 screen px."** Carried as an open bug
for months and false on inspection: both places that turn the slider value into a fog radius
divide by `zoom`, and the cursor ring is drawn in screen px to match. `brushSize` has no third
reader. A bug filed from reasoning rather than a repro can outlive the code it described.

### The Player window came up invisible because Windows called it occluded · `SETTLED` (2026-08-28)
A long-running fault where the rig's Player window reported itself hidden and rendered nothing.
It looked intermittent, then sat at 100% for whole sittings, and no amount of asking the window
to go fullscreen cleared it. The cause was Windows reporting the window covered, at which point
Chromium stops painting it and the page reports `document.hidden`. Working on the machine during
a run produced it, which is why it appeared to come and go. Three Chromium switches at launch
turn occlusion handling off, and a run now survives being held at the back of the z-order for its
whole length. Proven both directions: remove the switches and the exact old error returns.
Fullscreen was only ever a workaround for this, so the Player is windowed now.

### The rig runs off the screen, and four pieces hold that up · `SETTLED` (2026-08-28)
A run used to own the machine. It now parks every window the app opens at -9000,-9000 through a
PowerShell helper, moving them while still hidden so none ever appears. Four pieces depend on one
another and must not be separated: the occlusion switches keep a parked window painting; not
asking for fullscreen is what allows parking at all; parking hidden windows is what removes the
flash; and a device-metrics override gives the Player the real display size its rendering depends
on without putting the window back on screen. Focus still moves to the app on launch, which is
the app calling `focus()` on itself; changing that would be an app change made to serve a test.

### An acceptance scenario covers one feature and ends at the Player · `SETTLED` (2026-08-28)
Scenario files had grown one per bug fixed or feature shipped, which left the set arbitrary: one
file asked "does rounding work on fire", another "does everything work". They are now one file
per feature, opening with the feature's goal in a sentence, covering every success state it has
including the edge ones, and finishing at the Player window. The many combinations a feature
allows are swept on the DM; the Player is checked once per distinct OUTCOME, because everything
crosses in one `fog-update` message and checking each combination there proves the same delivery
repeatedly. Rooms never cross, so a Player check reads the fog a room paints, never a room.

### Two Electron startup messages are filtered, and only a preload check makes that safe · `SETTLED` (2026-08-28)
Electron's sandboxed-renderer bootstrap failed about one boot in thirty and ended runs on the
rig's own noise. The splash window takes Electron's defaults - sandboxed, no preload - and is
destroyed as soon as the DM paints, so its bootstrap can be cut off midway. Filtering those two
messages alone would be unsafe: a real preload failure logs the same words, and the app degrades
quietly rather than failing, so a run would go green with no disk access at all. Both windows are
therefore checked directly for `electronAPI` on every boot. Delete either check and the two
filter terms have to come out with it.

### The five-second autosave is the promise, so the switch-time save is not a bug · `SETTLED` (2026-08-28)
`switchScene` calls `doAutoSave()` and nulls `currentScene` in the same task, so the `toBlob`
callback's identity guard rejects that write every time. A rig criterion was written against it
and reported data loss: reveal ground, change map inside five seconds, and the reveal is gone from
the saved scene. Closed as expected behaviour on product grounds. The app promises an autosave on
a five-second timer, not a save the instant the map changes, and the criterion was demanding a
guarantee that was never offered. The scenario now waits for the autosave to commit, then checks
that switching away does not damage what it committed, which is the success state. Two rules
follow: do not "tighten" that scenario by dropping the wait, and do not make the switch-time save
land in order to satisfy a test - it would change behaviour at the table to serve the rig.

### Every acceptance scenario runs on an animated map · `SETTLED` (2026-08-28)
The suite generated a still PNG everywhere, and animated maps are the only kind in real use, so it
proved the app worked in a case that never happens. The open question was scope: whether to switch
every scenario or only the Player-facing ones, because a recorded clip costs real time per run.
Measurement settled it - all fourteen files switched for four extra seconds across the whole pass.
Three things make that affordable and all three must hold: the clip is one second, it is cached by
size for the whole run so scenarios at the same size share it, and it stays inside the shrink box
so no import pays for a re-encode. `smoke.js` keeps one still map, because its own job is holding
the animated render path against the still one.

### The backup export's field whitelist is checked by reading its own source · `SETTLED` (2026-08-28)
`doExport` opens a native save dialog as its first act, and `electronAPI` comes through
contextBridge, so it cannot be stubbed and the payload builder behind it cannot be reached. A
scenario can only rebuild the same payload itself, which proves the archiver works and says
nothing about the export's own field list - and a field missing from that list is dropped
silently, leaving a valid zip and a room without its corner radii. So the scenario reads
`doExport.toString()` and asserts every field the restore needs appears inside the `metadata:`
literal. A source-text assertion in a behaviour test is deliberate here, not laziness: nothing
else in reach can see that loss.

### The scene library is a popup, and a group is a name the scene carries · `SETTLED` (2026-08-29)
The scene list was a 208px dropdown showing six of sixteen scenes with every long name
truncated. Three shapes were weighed: a denser row list in the same dropdown, a full-screen
view, and a popup over the map. The popup won because a card keeps its old size and the map
stays behind as context, and a full-screen view was priced as the same outcome for more work.
A second HTML file was ruled out outright: `switchScene`, the canvas and the open scene all
live in the main window, so a second document would have to message back for every action.
A group is a NAME on the scene record, never a container that holds scenes. That is what makes
it ride the scene through IndexedDB and the backup zip with no new store, and what makes
deleting a heading cost no maps. `sceneGroups.js` keeps only the display order, the collapse
state, and a heading made before anything was dragged into it. Those live in localStorage
because losing them costs a fold and an empty heading rather than a map.

### One floating surface, and the panels were brought to it · `SETTLED` (2026-09-01)

`base.css` defines the app's floating panel as four variables. Five panels wrote their own values,
so the room card and the settings panel sat side by side over the map with edges that disagreed.
All five now read the variables.

**The panels moved to the shared value; the shared value did not move.** The four full shells - the
advanced fog panel, the module-text modal, the confirm dialog and the room card - went from a 1px
hairline at 5.5% white, 10px corners and a `0 6px 22px/0.36` shadow to the shared 1.5px at 10%, 12px
corners and `0 5px 16px/0.28`. They sit visibly FLATTER on the map now, and that is the chosen
result, not a regression. `#sm-panel` is the exception and takes the border alone, for the reason
the `dm-ui` skill records.

### A denser scene list was built and rejected: the thumbnail is the identifier · `SETTLED` (2026-08-29)
Two of the three sketches shrank the picture to fit more scenes: a 30px row with a 38x22
thumbnail, and the same row under collapsible headings. Both were rejected on product grounds.
Picking the wrong scene puts the wrong map on the TV, and at that size a thumbnail reads as a
colour rather than a map, so the picture is a safety control instead of decoration. The name
follows from the same call: it wraps inside the picture over a darkened foot and is never
ellipsized, because a name cut short cannot be told from its neighbour either.
Do not reopen density as a way to fit more cards. The answers already taken are a wider panel
and a find field, and both leave the picture alone.
