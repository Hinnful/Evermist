---
description: Gate the change, file what it settled, write the notes as public release notes, then push on the user's yes and arm the CI monitor
argument-hint: "[optional emphasis, or an explicit version to use]"
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
---

# Mode: Ship This Change

Six steps, each one feeding the next. The diff decides the test plan, the plan decides the gate,
a green gate releases the version, the version heads the notes, and the notes wait for the user's
yes. **The turn ends at the push.** Nothing here watches a pipeline.

**⚠ A SHIPPING COMMIT IS A RELEASE.** `.github/workflows/release.yml` fires on a push to
`release/**` or `change/**`. When `package.json` carries a version with no tag, it runs the unit
tests, builds all three installers, drives the packaged app through the full regression set on
Windows, Mac and Linux, proves each platform's update, then fast-forwards `main`, tags and publishes. **The commit message
becomes the release notes verbatim.** Nothing public exists until the gate is green. **You never tag
and never publish** - the workflow does both, or neither.

**A commit message is SHORT.** Step 4 files the reasoning in the docs that own it. A commit that
re-tells those files is duplicated work that goes stale.

Optional steering input - anything to emphasize, or an explicit version: $ARGUMENTS

**Each step's rules live in `.claude/commit/`. Read that step's file when you reach the
step, not before**, so the rules are fresh when they apply. After each step, write its number to
`.claude/commit/run.json` as `step` (keep the other fields).

## Step 0 - Find where the last run stopped

`git fetch --prune origin` first; a stale remote-tracking ref otherwise reads as in flight. Then
take the first row that matches and say in one line what you found:

| State | Go to |
| --- | --- |
| `run.json` present | The step after its `step`. Inside Step 6, re-run `ship.js`; it skips finished stages. If `run.json`'s `head` differs from HEAD and no step since the commit explains it, say so and stop |
| No `run.json`, dirty tree | Step 1, a fresh run |
| No `run.json`, clean tree, HEAD equal to an `origin/release/*` or `origin/change/*` ref and not on `origin/main` | A pushed change whose gate has not landed. Report its PR and Build & Release run (below). Red: read `red-gate.md`. Running: say so and stop |
| Anything else | Nothing in flight. Say so and stop |

"Pushed" means `git rev-parse origin/<branch>` equals HEAD. Never test with `--contains`: every
finished release contains `main`. Local `release/*` branches are not a signal; `ship.js` never
creates one, and another worktree's branch belongs to another session.

**Before Step 1 on a fresh run, HEAD must contain `origin/main`**
(`git merge-base --is-ancestor origin/main HEAD`). The `land` job refuses a branch that does not,
after the whole gate has run. If it does not, say so and offer
`git stash && git merge --ff-only origin/main && git stash pop`; run it on a yes. In a worktree
the app made, use `sync_with_base_branch` instead.

**A yes never carries across sessions.** Resuming at Step 5 or 6 in a new session shows
`notes.txt` again and asks again, unless `run.json`'s `stage` is past `commit`.

**An open PR this session has not bound:** find it with
`gh pr list --head <branch> --state open --json number,url`. If `mcp__ccd_pr__get_status` shows no
PR for this session, bind it with `mcp__ccd_pr__bind_pr` and arm `mcp__ccd_pr__set_monitor` with
`auto_fix: true`. A monitor armed by a closed session wakes no one.

**The previous release**, reported on every start: take the newest `release/` head from
`gh pr list --state all --limit 10 --json headRefName,state,url`, then
`gh run list --branch <it> --workflow release.yml --limit 1 --json status,conclusion,url`. Name the
workflow: the Tests workflow fires on the same push and can come back first. Report it only if it
is running or red.

## Step 1 - Read the diff

`git status`, then `git diff HEAD --stat` for the shape, then `git diff HEAD` and any untracked
file contents. Read enough to describe *what* changed and why it matters. If the tree is clean,
say so and stop.

## Step 2 - The test plan, then the gate

Read `.claude/commit/gate.md` now. **BLOCK on red.**

## Step 3 - Set the version

Read `.claude/commit/version.md` now.

## Step 4 - File what the work settled

Read `.claude/commit/docs.md` now. It finishes before the notes, so its edits ride into
this commit.

## Step 5 - Hand over the notes, then stop

Read `.claude/commit/notes.md` now. The notes go to `notes.txt` and pass
`check-notes.js` before the user sees them. **Then STOP** and offer to push.

## Step 6 - On their yes: push, arm the monitor, close the backlog

Read `.claude/commit/push.md` now. `ship.js` runs the tail. Once the backlog is written
on the user's answer, delete `run.json` and `notes.txt`.

## When the monitor wakes you on red

Read `.claude/commit/red-gate.md` now.
