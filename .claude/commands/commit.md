---
description: Gate the change, file what it settled, write the notes as public release notes, then push on the user's yes and arm the CI monitor
argument-hint: "[optional emphasis, or an explicit version to use]"
allowed-tools: Read, Grep, Glob, Bash, Edit, Write, mcp__ccd_session_mgmt__set_session_title
---

# Mode: Ship This Change

Six steps, each one feeding the next. The diff decides the test plan, the plan decides the gate,
the version heads the notes, and the notes wait for the user's yes. **The turn ends at the push.** Nothing here watches a pipeline.

**⚠ A SHIPPING COMMIT IS A RELEASE.** `.github/workflows/release.yml` fires on a push to
`release/**` or `change/**`. When `package.json` carries a version with no tag, it runs the unit
tests, builds all three installers, drives the packaged app through the full regression set on
Windows, Mac and Linux (Windows and Mac block, Linux only warns), proves each platform's update, then
fast-forwards `main`, tags and publishes. **The commit message
becomes the release notes verbatim.** Nothing public exists until the gate is green. **You never tag
and never publish** - the workflow does both, or neither.

**A commit message is SHORT.** Step 4 files the reasoning in the docs that own it. A commit that
re-tells those files is duplicated work that goes stale.

Optional steering input - anything to emphasize, or an explicit version: $ARGUMENTS

**Each step's rules live in `.claude/commit/`. Read that step's file when you reach the
step, not before**, so the rules are fresh when they apply.

## Step 0 - Find where the last run stopped

`git fetch --prune origin`, then take the first row that matches and say in one line what you
found:

| State | Go to |
| --- | --- |
| `.claude/commit/disclosure.txt` present | Show its lines to the DM as part of the next report, then delete it |
| `.claude/commit/notes.txt` present | A run stopped at the notes or the push. Show the notes again and ask; a yes never carries across sessions. On a yes, re-run `ship.js`, which skips finished stages |
| Dirty tree | Step 1, a fresh run |
| Anything else | Nothing in flight. Say so and stop |

A failed release wakes the session that pushed it through the CI monitor, so Step 0 never goes
looking for one. A red that CI or a test caused is fixed without a message to the DM.

## Step 1 - Read the diff

`git status`, then `git diff HEAD --stat` for the shape, then `git diff HEAD` and any untracked
file contents. Read enough to describe *what* changed and why it matters. If the tree is clean,
say so and stop.

## Step 2 - The test plan, then the gate

Read `.claude/commit/gate.md` now. **BLOCK on red.**

## Step 3 - Set the version

Read `.claude/commit/version.md` now.

## Step 4 - File what the work settled

Hand this step to the `filer` agent: list every call the session settled and every behaviour
that changed, and it follows `.claude/commit/docs.md`. Check its edits in `git diff` before the
notes. It finishes before the notes, so its edits ride into this commit.

## Step 5 - Hand over the notes and the backlog proposal, then stop

Read `.claude/commit/notes.md` now. The notes go to `notes.txt` and pass
`check-notes.js` before the user sees them. **Then STOP** and offer to push.

## Step 6 - On their yes: write the backlog, push, arm the monitor

Read `.claude/commit/push.md` now. `ship.js` runs the tail. Once it has pushed, delete
`notes.txt`.

## When the monitor wakes you on red

Read `.claude/commit/red-gate.md` now.
