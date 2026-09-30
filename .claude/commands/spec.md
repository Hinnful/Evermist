---
description: Drill a task into an agreed Definition of Ready and Definition of Done, then write it to a file a fresh session can build from.
argument-hint: "[a backlog id, or a few words about what you want]"
---

# Mode: DoR / DoD Drill

Turn a task into a **Definition of Ready** and a **Definition of Done** the DM has agreed to, then
write both to a file. Nothing gets built in this mode.

**You are the one who drills.** The DM is a product manager, not a developer. The DM sets the target;
you find the gaps in it. Do not wait for the DM to notice a missing acceptance criterion.

## Input

What the DM wants specced: $ARGUMENTS

A bare number is a backlog id. Read that item in full. Empty means ask the DM what, in one question
with the open backlog items as the options.

## Before you say anything - read

**Never ask the DM something the repo already answers.**

- `docs/BACKLOG.md` - the item and any neighbour that overlaps it.
- `docs/DECISIONS.md` and every file in `docs/decisions/` - what was already tried or rejected.
  **A task that reopens a settled call is the most expensive thing this command can produce.**
- `docs/PRODUCT.md` - what the app will never do.
- `CLAUDE.md`, the folder `CLAUDE.md` files, and any `.claude/skills/*/SKILL.md` that owns a file
  the work would touch.
- The actual source, enough to know whether each DoD line is reachable.

## The shape you hand the DM

Every run produces these six headings, in this order, and nothing else.

    ## What we're fixing
    ## Questions
    ## Definition of Ready
    ## Definition of Done
    ## Out of scope
    ## Risk

**Under 400 words on the first pass.** The DM rewrites anything over-built, and the DM's version is
usually better. If the DM hands you a shape of their own, take it and stop defending yours.

## What we're fixing

Two to four sentences. What is wrong now, and what it costs the DM. No file names.

## Questions

**Only the ones that change the work.** A question you can answer from the repo is not a
question. A choice with an obvious default is not a question - pick it and say you did.

Ask **one** where one will do. Four questions in a list is how a drill turns into a form.
Use the option picker: two to four options, your recommendation first and marked.

## Definition of Ready

The standard checklist, and you fill in every line before the DM sees it. Mark each one
**met**, **not met**, or **needs the DM's answer**.

1. **The outcome is stated in what the DM would see**, not in what the code does.
2. **Every acceptance criterion is testable**, and you have said by what - the rig, a unit test,
   or the DM's own eye.
3. **Nothing is blocked.** Name any dependency and whether it is done.
4. **It is sized.** Half a sitting, one, or more than one. Say which.
5. **No open decision changes the work.** Anything still open goes in Questions above.

A line that is not met is not a blocker on its own. Say what would meet it.

## Definition of Done

**The DM's to set, yours to make honest.** Draft it, then hand it over for the DM to cut or add to.

Each line is one thing, phrased so it can be checked rather than argued about. Number them,
because the DM reports against them by number and asks "where are we on the DoD".

Three things you owe the DM here:

- **Name what the DM's version adds that yours missed**, and say what each addition costs in sittings.
  The DM grows the DoD on purpose and wants the price with it.
- **Say which lines a local run can answer and which need CI.** The DM treats those differently.
- **Two kinds of exception, and only two.** Judged by eye - does the fog look right. Physically
  unreachable - a native dialog, the network, a second display. The DM allows the first without being
  asked; name the second explicitly or it reads as a gap you are hiding.

## Out of scope

What you are deliberately not doing, each with half a line of why. A bare "not doing X" gets
argued about later; a reason settles it.

If something in the task belongs in a different session, say so and propose it as a backlog item
rather than filing one. **Propose, never file silently.**

## Risk

One or two lines. What could cost time or force rework, and what would catch it. Technical debt
and untidiness are not risks. If there is none worth naming, write `Risk: none worth naming.`

Then the red-team verdict, one line, every time:

- `Red team: not needed - <reason>.`
- `Red team: recommended - <reason>. Say the word and I'll run it.`

**Recommend it when** the work breaks the DM's live use if it is wrong, is hard to undo, writes a new
shape into saved data, or rests on an assumption you could not verify against the code.

## Writing it down

Once the DM has agreed, write `.claude/private/specs/<slug>.md`:

    # <Task name>

    ## What we're fixing
    ## Definition of Ready
    ## Definition of Done
    ## Out of scope
    ## Risk
    ## Steps

**Steps** is the only section the DM does not see during the drill. Numbered, in build order, each
small enough to finish in a few minutes, each naming the DoD line it serves.

Rules the step list follows:

- **Never tell the build session to halt between steps.** It posts a line per step and keeps
  going. It stops only if something contradicts the spec, and says what.
- **No commit, version or release step.** Those belong to `/commit`, which the DM starts.
- **The rig goes in the numbered steps whenever the work touches shipped code** - anything under
  `src/`, or `index.html`, `main.js`, `preload.js`. A pointer at the end is read too late.
  A feature writes its acceptance scenario in the same step as the behaviour, or the one after.
  Writing a scenario is not running one; `/commit` runs them.
- **Reference, don't copy.** Point at `CLAUDE.md`, a skill or a commit by path. A spec padded
  with copied detail degrades the session that reads it.
- Point the build session at the `rig` skill rather than restating its traps.

## Language

**Every word of the drill goes to the DM**, so the Steering output style applies in full.

**No module names, no file paths, no jargon in anything the DM reads.** Describe a thing by what the DM
sees: "the Send button", "the scene library's selection bar". The DM has said a report full of file
names tells the DM nothing. Paths belong in the spec file, which a machine reads.

## When the answer is no

The drill may kill a task, and that is a good outcome. If the DoD cannot be met at a price worth
paying, say so in one short paragraph with the reason and write no file. If the DM agrees, delete the
item from the backlog and record the verdict in `docs/DECISIONS.md` where a future reader could
otherwise repeat it.

## Closing

Three lines and nothing else:

1. What the next session will build, in plain language.
2. *Build the spec at `.claude/private/specs/<file>`.*
3. The red-team verdict line.

**Do not ask the DM to read the spec file.** The DM agreed to every line in it, one answer at a time.
