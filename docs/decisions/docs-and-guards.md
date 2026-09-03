# Decisions - docs, rules and guards

Split out of [DECISIONS.md](../DECISIONS.md) so the main ledger stays readable. Same
question, same past tense: what was decided about **this repo's own documentation, its
rules, and the guard hooks that enforce them**, and why it held.

Decisions about the app itself stay in the main ledger. Testing and the rig are in
[testing-and-the-rig.md](testing-and-the-rig.md).

**Status tags** and the one-heading-one-paragraph budget are the main ledger's; read its
header before adding an entry here.

---

### The Player keeps its mouse cursor · `SETTLED` (2026-08-14)
CLAUDE.md read "no buttons, no cursor, no overlays" while `base.css` has set `cursor: default`
on the Player's canvas since 1.5.2, and the rig surfaced the contradiction. The CSS is right:
the DM drags the Player's view by hand on the TV constantly, and that needs a cursor you can
see. The rule was wrong, so the rule changed. **Removing working behaviour always loses against
keeping it** - that is the general call this settled, not just this line.

### The rig's rules go in a skill, not a folder `CLAUDE.md` · `SETTLED` (2026-08-14)
A folder's `CLAUDE.md` loads when a file *in that folder* is edited, which is the moment you are
working on the rig and precisely not the moment you need telling to run it. That is the same
failure `guard-skill-hint.js` already exists to fix: a pointer only fires if someone is already
reading that section. The `rig` skill is findable by description from any file, and the hook now
matches on path (`tools/rig/`) rather than basename, because a scenario file can be called
anything and the orphan check only scans the app's own directories.
The split: the rule about *when* to run it is in CLAUDE.md, since only a rule earns space there;
how to drive it and its traps are in the skill; what it is and how it works is in
ARCHITECTURE.md. Raising the CLAUDE.md byte cap for those two lines was the sanctioned path, not
a workaround.

### A `src/` edit with no scenario is hinted, never blocked · `SETTLED` (2026-08-14)
`guard-scenario.js` fires `PostToolUse` on an edit under `src/` when nothing under
`tools/rig/scenarios/` has moved in the working tree, and hands back one line. It is the sixth
guard and the only one that does not exit 2, which was the whole design question. **A hard block
on every `src/` edit gets the hook commented out inside a week, and then the rule is gone
permanently** - most edits genuinely need no new scenario (a fix an existing file already covers,
a comment, a mutation check being restored), so a refusal would be wrong more often than right.
Once per session, keyed on the `session_id` the payload carries, with the marker under the OS
temp dir because rig output never enters the working tree. No baseline file, unlike the other
five: this is a state check against the working tree, not a ratchet against a number.
The rule it enforces was already in CLAUDE.md and was already being missed, which is the same
"a pointer is not a trigger" failure recorded above.

### Rules about rules don't work here; hooks do · `SETTLED`
Two rules lived in CLAUDE.md: "don't grow the inline blob" and "don't write history in this
file". The one with a `PostToolUse` hook held for months. The one without it failed
completely. Every structural rule about this repo's files should ask whether it can be a
hook.

### Why the "no history in CLAUDE.md" rule failed · `SETTLED` — this file is the fix
Three causes, and the third is the one that mattered. **The rule's destinations didn't
work**: it sent post-mortems to commit messages, but a fresh session never reads `git log`,
so "put it in the commit" read as "throw it away". **A rule without its reason gets
simplified away**, so reasons got smuggled back in as narrative - right instinct, wrong
container. **Nobody owned the file's total size**, because appending a section is always
locally cheap.

### One question per doc, and the mood proves it · `SETTLED`
Splitting the docs by *subject* failed, because subject is always arguable and a paragraph
about product positioning has a plausible claim on three files at once. The criterion that
holds is one question per file, each with a grammatical mood only that file may use: rules are
imperative, `ARCHITECTURE.md` is present indicative, this file is past tense, `PRODUCT.md` is
declarative intent. A past-tense sentence in `CLAUDE.md` is a rule leaking its history; an
imperative here is a rule that escaped the rulebook. The test is answerable without judgement,
which is why it survives contact with an ambiguous paragraph.

`CLAUDE.md` also carries a size cost the others don't: it loads into every session, so it is
shrink-only. The rest are read on demand, where *findability* is everything.

### Two module lists, on purpose · `SETTLED`
`CLAUDE.md` carries a terse module map and `ARCHITECTURE.md` carries a plain-language table of
the same files. Deleting either looks like an easy win and is not. The rule "extend the module
that owns the concern, don't duplicate it" is unusable without a map already in context, and
`CLAUDE.md` is the only file guaranteed to be there; the prose table is for a reader who needs
to know what a file does before opening it. `guard-architecture.js` checks both against `src/`
on every module write, so the duplication cannot drift.

### The command ledger is private, the docs ledger is public · `SETTLED`
Entries about the private slash commands moved to a memory file rather than staying in the repo,
because they are unreadable without the commands: "auto-running `/redteam` inside `/handoff` was
rejected" means nothing to someone who has neither. Decisions about **this repo's** docs, rules
and guard hooks stayed here, since anyone editing the repo needs them and they name nobody. The
test is the one the docs criterion already uses: useful to someone working on the project, or
only to whoever owns the tooling.

### A pointer is not a trigger · `SETTLED`
Links from `CLAUDE.md` to another doc only fire if someone is already reading that exact
section, which is how `ARCHITECTURE.md` drifted seven modules stale without anyone noticing.
The fix was not another rule: every doc now has a guard hook that fires on a write, `/wrap`
files into all of them, and `/brief` reads the ledger as a rejection filter. **A doc with no
reader and no writer in the actual workflow will rot, however well written.**

### DECISIONS.md is guarded by a NOTICE, not a ratchet · `SETTLED`
This ledger is meant to grow, so its guard never blocks an addition and says so in every
message it prints. It fires once per subject on total size, on any `##` section passing 40% of
the file, and on any `###` entry passing 14 lines. The first two call for splitting a section
out to `docs/decisions/<topic>.md` behind a pointer, which is scheduled work rather than a
mid-turn edit; the third is fixed on the spot. **One-file-per-decision, the usual ADR layout,
was rejected**: it optimises for many readers browsing a directory over years, while this file
is read whole. The per-entry budget is the real size control, because ledgers bloat by entries
growing into stories rather than by accumulating decisions.

### Grinding CLAUDE.md down to a byte target · `REJECTED`
The split targeted "under 16KB" and landed at 23.7KB. The estimate was wrong, not the
execution: the rule density in the one oversized section was higher than guessed. Getting to
16KB would mean deleting real rules to hit a number. The distribution was the actual problem
and it is fixed — one section was 80.7% of the file, and now the largest is 28%.

### CLAUDE.md shrank by relocation, not deletion · `SETTLED` — the byte rejection above stands
402 lines to 219, 23.7KB to 12.2KB, nothing removed; a script asserted every non-blank old line
still lands in exactly one destination. The rejection above holds, because no rule was deleted
and no number was targeted. What changed is that two containers now exist: a child `CLAUDE.md`
in `src/css/`, loaded only when a stylesheet is touched, and two skills (`module-text`, `dm-ui`)
whose bodies load on invocation.
**The judgement that mattered was refusing to move rules that can't be triggered by filename.**
"Rooms are polygons" governs `polygons` across 16 modules, so a skill keyed on room editing would
miss the session editing `sceneManager.js`, and the penalty is silent data loss in every saved
scene. Dialogs, Testing, the render loop and Distribution stayed on the same test. Half-shroud
moved into `dm-ui`, but its trigger list carries `fog.js`, where its rules actually bind.
The trigger is `guard-skill-hint.js`, a `PreToolUse` hook mapping filename to skill; the pointers
left in CLAUDE.md are documentation, since a pointer is still not a trigger.

### Comment density as a target, applied per file · `REJECTED`
The codebase-wide figure is the meaningful one, and the trim took `src/` from 22.6% to 19.3%.
Per-file targets are a bad instrument: `state.js` is 70 lines of one-line declarations, so its
43% is almost entirely load-bearing trap warnings rather than padding, and a parser needs a
reason attached to each rule or someone simplifies it away. Do not "finish the job."

### The comment share is a ratchet, not a target · `SETTLED` (2026-08-29)
A number reached by hand does not stay reached: a deliberate trim set the share at 19.3% and it
was back past 24% within three weeks, because every individual comment reads as justified when
it is written and nobody owns the total. `guard-comments.js` now holds the ceiling the same way
`guard-claudemd.js` holds CLAUDE.md's - codebase-wide, falling on its own, rising only by a
deliberate edit. It ranks the offer of where to cut by comment COUNT rather than share, so it
cannot become the per-file instrument rejected above.
What it measures: whole-line comments as a share of non-blank lines, over the exact set
`build.files` ships minus the vendored PixiJS. A comment sharing a line with code is free, so a
trailing note never costs anything. `tools/comment-density.js` reports the same figure by hand.

### Verifying a comment-only change with the test suite alone · `REJECTED`
Strip comments and blank lines from HEAD and the working copy, then diff the pure code, per
file. It caught two things 375 green tests did not: two declarations quietly reordered while
regrouping, and a **real functional regression** where retyping a line turned a literal
non-breaking space inside a character class into an ordinary space. The two versions are
visually identical. Reuse this for any comment-only pass, and treat invisible characters in
source as something a comment must warn about.

### The docs grow by decision, and the rule now says so · `SETTLED` (2026-08-29)
`CLAUDE.md` read "This file may shrink, never grow" while its own guard printed "GROWTH IS
ALLOWED" in the same message, and the ledger guard prints "these files are SUPPOSED to grow".
The sentence was stricter than any mechanism under it, so a real new rule had no stated route
in. The rule now names the route: tighten or relocate first, then raise `maxBytes` by hand and
say so. Two containers behave differently on purpose - the rulebook loads into every session,
so its ceiling ratchets down and rises only by a deliberate edit; the ledgers are read on
demand, so they grow freely and are split by topic when one stops being readable whole.

### The ledger split three ways, by topic, not by decision · `SETTLED` (2026-08-29)
`DECISIONS.md` hit 103 KB against a 90 KB soft ceiling. Three topics moved to
`docs/decisions/`: this file, `testing-and-the-rig.md` and `map-effects.md`, leaving a pointer
section each. The main ledger returned to 82 KB. Map effects had been filed under "Docs, rules
and guards" purely because that was the newest section, which is how a ledger section stops
matching its own name; the toolbar-pill entry went back to "UI and the control panel" at the
same time. One-file-per-decision stays rejected - the split is by topic, and each file is still
read whole.

### The second ledger split leaves its pointer in place, not in a cluster · `SETTLED` (2026-09-02)
`DECISIONS.md` reached 93.9 KB, so two more topics moved out: `rendering-and-fog.md` (the two
views' render paths, the fog pipeline and the render loop) and `ui-and-control-panel.md` (the
toolbar, the control-panel tabs, the scene library and the dialogs). The main ledger came down
to 56.7 KB across five topic files. The render loop went with rendering rather than staying a
sibling section, because a reader asking why a frame is scheduled is already asking about the
render path.
**The pointer position is the new call.** The first split moved its three pointer sections to a
cluster near the bottom of the file. These two stay where their content was, so a reader
scanning the top-level headings finds "Rendering and fog" in the place they expect and follows
the link from there. A lookup table is read by heading, not front to back.

### ARCHITECTURE.md is guarded on mood, and only noticed on size · `SETTLED` (2026-08-29)
The doc had a drift guard and no size or shape check at all, so it could pad indefinitely as
long as every module stayed listed. `guard-architecture.js` gained a second trigger: a write to
the doc runs a size notice at 45 KB, a 40% section-share notice, and a past-tense check. The
size rules never block, because this doc must grow when the app does; the split they ask for is
`docs/architecture/<topic>.md` behind a pointer. **The mood rule is the real size control** -
the file pads by explaining what was tried instead of how the app works, and a byte count
cannot see that. A shrink-only ratchet was rejected for the same reason: it would punish the
doc for the app growing. The file starts green at 35 KB, zero narrative hits, largest section
21%.

### The rig never puts a window on the DM's screen, and a hook enforces it · `SETTLED` (2026-08-29)
`offscreen.ps1` parked each app's windows, but run.js started it AFTER the app launched, and
PowerShell needs ~1s to start and compile its C#. Measured: a focused splash window sat on screen
~600ms per scenario, so a 15-scenario regression took the machine 15 times while a single smoke
run only blinked once. The fix is ONE parker per run, started before the first app and awaited on
a ready file, matching on the run's own output directory so it can never move the real Evermist.
Proven both ways: 40 on-screen samples over three scenarios before, 0 after.
`guard-screen.js` refuses the launches that take the screen. A rule alone was rejected on this
file's own evidence that rules about the repo's habits fail where hooks hold. It matches per shell
segment with heredoc bodies stripped, because an unanchored match refused every doc edit that
QUOTED one of those commands in order to forbid it.

### Repeated text between files gets its own ratchet · `SETTLED` (2026-08-30)
A sweep asked whether the comments here explain the non-obvious. They do: almost all of them
warn about a trap rather than restate the code. The bloat sat elsewhere. One explanation gets
written in the module, in a neighbour, and in a ledger, and every copy reads as justified
where it sits. `guard-comments.js` cannot see it, since dropping one copy and adding
one warning leaves the share flat. So the count of 12-word runs shared by two files is now its own
falling number in `guard-comment-echo.js`, which compares shipped comments against each other and
against CLAUDE.md, the ledgers and the skills. Twelve words was picked by measurement: eight
matched coincidence between files naming the same function, sixteen let whole sentences through.
It started at 55, and it blocks rather than hints, because unlike a missing scenario a duplicate
is never the right answer.

### Bloat is a rule in CLAUDE.md, not a second reviewer · `SETTLED` (2026-08-30)
The built-in `/code-review` hunts correctness and does not look for speculative code, so three
ways to add that were weighed. Cloning it was impossible: its instructions ship inside the CLI
and exist nowhere on disk to copy, and a rewritten prompt would lose the verify pass and the
structured findings that make its output worth reading. A second reviewer inside `/commit` was
`REJECTED` on ordering - it edits after the smoke gate proved the code, which makes the green
result describe a version that no longer exists, and moving it earlier just pays for two agents
reading one diff. What remains is the file the review already reads. `Build nothing for a case
that does not exist yet` sits in Code organization as a ban, not as a hunting instruction,
because this file answers what must never be done and a procedure written here would be the only
paragraph in another mood. It binds the session that would write the code, and the review gets a
checkable rule instead of a matter of taste.

### Module size is a per-file ratchet, seeded lazily · `SETTLED` (2026-09-01)
`guard-blob.js` bounded only the inline script in `index.html`, so nothing bounded a module.
`guard-module-size.js` copies `guard-claudemd.js` per file rather than setting one number for all
of them: modules differ by an order of magnitude, and a shared ceiling would fire on the largest
file forever. Existing size stayed out of scope, so no module was shrunk to satisfy the guard - a
file missing from the baseline adopts its measured size on the next edit and is bounded from then
on. Nothing is bounded until a file is touched, which is accepted: an untouched module is not
growing.
A baseline that exists and will not parse leaves the file alone rather than rewriting it. That map
carries every module's ceiling, so treating a malformed file as absent would drop all of them at
once and re-seed in silence - a reachable path, because raising a number by hand is the escape
hatch the notice recommends.

### An echo ceiling raised for someone else's repeats has to say so · `SETTLED` (2026-09-02)
The repeated-text ratchet jumped from 54 runs to 72 on the first shipped-code edit after the
second ledger split, and every one of the 18 new repeats came from the two new files in
`docs/decisions/` - their shared preamble, plus prose lifted out of module comments. None came
from the code being written at the time. Parking those two files and re-running the guard is what
proved it, and it is the check to repeat before raising this number again.

The ceiling was raised to 72 rather than editing another session's uncommitted docs. **A ratchet
raised for debt the session did not create must name the cause in the handover**, or the next
session inherits a ceiling nobody can account for and stops trusting the guard.
