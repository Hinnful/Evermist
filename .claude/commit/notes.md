## Step 5 - Hand over the notes, then stop

The notes are a short message from whoever builds Evermist to a DM who just updated it. Three
parts, formatted for GitHub Desktop's Summary + Description fields:

1. **Summary** - one line, at most 70 characters: the version, then what changed for the DM, in
   plain words.
2. **Intro** - the first Description line: one sentence saying what the release is about.
3. **Points** - one `* ` line each, at most 7. More than that is a batch: keep the ones a DM would
   notice.

A one-thing change is a Summary and an Intro, or a Summary alone. Do not pad it.

```
4.9.2 - Hints are no longer annoying
Hints now don't suggest things you've already done

* "Reveal part of the map" no longer shows on maps that already have something revealed
* Effects hint skips maps that already have effects
* After "Got it", the next hint now waits a minute
```

```
4.9.0 - Effects got their own button
Effects is now a separate mode next to Room

* E is the new hotkey for Effects
* Effects button is now blue while it's on. Toolbar border glows in the selected material's color
* Esc drops the current effect. Second Esc leaves Effects
```

### How a point reads

**One piece of news per sentence: "X is now Y", "X no longer Z", "X now does Y".** Short sentences
joined by a full stop, never chained by commas and dashes. The article can go: "Toolbar border
glows" reads fine.

**Say what changed, not how to operate it.** "Effects button is now blue" is the news. "Press E or
click Effects - it turns blue" is a manual. Name a key or a click only when the key IS the news.

**The thing in the app, called by its name on screen.** Quote a label when it would otherwise read
as part of the sentence: `"Reveal part of the map" no longer shows`.

**Plain words over exact ones.** "Groups now display maps inside them at high zoom-out", not "a
group shows its first three maps as a fan of cards". A verb like "wears", "burns" or "carries" for a
button is a tell: say "has", "is", "shows".

**"you" is fine, "now", "no longer" and "already" are the point.** A short reason is fine when a DM
would ask why. An opinion is not: "much better", "finally".

**No filler.** `check-notes.js` reads this block, so it is the list's only home:

```filler-words
as well
finally
delve
robust
seamless
```

**Evermist's own vocabulary only.** An effect is an effect, never a burn or a flame. A room is a
room. Nothing from a table, a session or a campaign enters the notes.

### Run it through /voice

**Once the draft passes the checker, run `/voice` on it** and keep the rewrite if it still passes.
The skill rewrites toward how the DM writes; the checker and the rules here still win.

### The reader is a stranger who just downloaded the app

**These notes land on a public release page, permanently.** Never include:

- **The author, in any form.** No name, no "he", no "your test map". "you" means any DM reading.
- **Their content.** Campaign, map, place and character names. A map used to find a bug is not a
  feature.
- **Their words, quoted.**
- **Their process.** What they tested, when, what they judged by eye.
- **Internal artefacts.** Fixtures, scratchpad tools, guard hooks, skill files.
- **"Claude".** The feature is the "AI assistant".

When a bug's story needs a specific map, describe the map's *kind*: "a map mixing caves with built
rooms".

**Never an em-dash** - use " - ". Nothing from the `filler-words` list.

**Cut:** a diff restated in prose, test counts, docs churn that rides along, anything `git diff`
shows more precisely.

State the version you set, or that you set none and why, in one line above the notes.

**Write the notes to `notes.txt` in `.claude/commit/runs/$CLAUDE_CODE_SESSION_ID/`** - line 1 the Summary, line 2 the
Intro, a blank line, then the points - and run the checker. It fails loudly with each offending line; fix and re-run
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
