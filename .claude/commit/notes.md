## Step 5 - Hand over the notes, then stop

Output exactly two blocks, formatted for GitHub Desktop's Summary + Description fields:

1. **Summary** - one line, at most 70 characters. See the shape below.
2. **Description** - one line per concern, at most 8 lines. No sub-bullets, no headings, no
   sections. More than 8 concerns means the commit is a batch: say what the batch is and list only
   the parts a future reader would search for.

**Summary plus Description stay under ~12 lines.** If the change is one thing, a Summary alone is
right. Do not pad it.

### Both blocks name the part of Evermist that changed

**Every rule below binds each Description line exactly as it binds the Summary.** A Description is
not a looser register; it is the same sentence shape, one per concern.

**The subject is the thing in the app, called by its name on screen.** A control, a mode, a tool, a
panel. Declarative, present tense. A verb is optional in the Summary.

```
Merge, Cut out and Split work on effects
Split Map mode for two scenes at once
Repairs stay armed after an action
```

**Never the reader as subject.** "You can drag a scene out of a group" becomes "A scene drags out
of its group". "Marks the one you are running" becomes "marks the running version". Rewrite with
the app as subject rather than dropping the fact.

**Never an instruction to the reader.** "Repair an effect the way you repair a room" and "Read what
each version changed" are the shape this replaced.

**No filler.** Cut every word in this list, and every adverb that survives deletion.
`check-notes.js` reads this block, so it is the list's only home:

```filler-words
too
as well
now
instead
already
finally
delve
robust
seamless
```

**No reason, no comparison, no opinion, no example.** Say what changed. Not why, not what it used
to do, not what it is better than, not which release it reverses.

**Evermist's own vocabulary only.** An effect is an effect, never a burn or a flame. A room is a
room. Nothing from a table, a session or a campaign enters either block.

### The reader is a stranger who just downloaded the app

**These notes land on a public release page, permanently.** Never include:

- **The author, in any form.** No name, no "he", no "your test map". The subject rule above already
  keeps the reader out of the subject slot, so *you* survives only as an object or a possessive.
- **Their content.** Campaign, map, place and character names. A map used to find a bug is not a
  feature.
- **Their words, quoted.**
- **Their process.** What they tested, when, what they judged by eye.
- **Internal artefacts.** Fixtures, scratchpad tools, guard hooks, skill files.

When a bug's story needs a specific map, describe the map's *kind*: "a map mixing caves with built
rooms".

**"In the author's voice" means register, not subject matter.** Borrow the plainness, not the
vocabulary for their own belongings.

**Never an em-dash in the Summary or Description** - use " - ". No "not X but Y", no rule-of-three
triples, nothing from the `filler-words` list.

**Cut:** rationale, a diff restated in prose, test counts, docs churn that rides along, anything
`git diff` shows more precisely.

State the version you set, or that you set none and why, in one line above the two blocks.

**Write both blocks to `.claude/commit/notes.txt`** - line 1 the Summary, then the
Description lines - and run the checker. It fails loudly with each offending line; fix and re-run
until it passes, then show the notes. It cannot judge the privacy rules above; you do.

```
node .claude/commit/check-notes.js
```

CI runs the same checker on the commit before anything is published.

**Rename the chat to the Summary line** with `mcp__ccd_session_mgmt__set_session_title`, so the
session list names each release.

### The backlog proposal goes out with the notes

The backlog lives at `docs/BACKLOG.md`. Read it first so you match its structure and do not
duplicate an entry. Nothing is written yet; Step 6 writes it on the yes, so it rides in this commit.

- **Close what shipped.** Delete every item this change built and update the open count in the
  header. A dead end the work paid for goes to the decisions ledger, never to the backlog.
- **Propose repeat flakes.** If `node tools/rig-ci.js flakes` named a scenario that needed a rerun
  three times across recent runs, list it as an item to fix or retire.
- **File what was deferred.** Anything discovered, skipped, or left as a follow-up. Use the
  backlog's own fields - plain-language *what it is*, *where it shows* (DM/Player/both), rough
  effort, risk, any blocker. This is the shape `/brief` reads back.

**Never touch the backlog silently.** List what you intend to close and what you intend to add, in
plain language, and let the user strike any of them in the same answer as the push.

**An item earns its place only if someone could pick it up and do it.** Convert relative dates to
absolute. Nothing already decided, shipped or refused belongs there.

A red gate does not invalidate this. The fix keeps the same version and amends the same commit, so
what the backlog recorded still shipped. Only an abandoned change needs an edit.

**Show the notes and the backlog proposal in the closing message, after `wrap_up`**, and send
`notes.txt` with `SendUserFile`. The push question goes in that message, never in the next-step
box (`docs/PROCESS.md`, Talking with the DM).

**Then STOP.** The notes are a proposal. Do not stage, commit or push in the same turn. The user is
the only reviewer this repo has, and reading the Summary is where they do it. End with one short
line offering to push.
