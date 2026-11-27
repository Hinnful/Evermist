# Architecture - how a version reaches you

Split out of [ARCHITECTURE.md](../ARCHITECTURE.md): the release pipeline, its gate and how installed copies update, in the present tense.

No change is pushed to `main` directly. `main` is protected, and the check it demands is the
pipeline's own unit-test job, so the server refuses any commit that job never passed. The refusal
covers everyone, the repo's owner included. Every change goes to a branch first, and a pull request is opened from it so
the run, and any failed attempt before it, keeps a page of its own.

A push to that branch runs the release pipeline. It looks at `package.json`'s version, and if that
version has no tag yet, it treats the push as a release. A change that bumps nothing skips
straight to the landing step and builds nothing.

What happens then, in order. The unit tests run first, on one machine, because there is no point
building anything if the arithmetic is wrong. Then the gate (`gate.yml` builds the installers, `rig.yml` drives the app) runs on Windows, macOS
and Linux at once. On each platform one machine builds the installer and checks its update
pointer, and another builds the packaged app and drives it through the rig: the blocker set on
Windows and Mac, `launch` alone on Linux, whose runner has no graphics card and draws at five
frames a second. No sharding. A run whose app never started reruns once; any other failure is red.
A run whose only red jobs never got a machine is rerun by the session watching CI, at most twice; a job that ran and failed stays red.
All three platforms block the release. Every scenario runs against the real
packaged application rather than the loose source files, which catches a file that works during
development and is simply missing from the installer. Alongside the gate, `update-proofs.yml`
proves each platform's update: it installs the new build, lets it walk back to an older one and
forward again through the Restart button, and checks that each swapped copy opens.

Only if all of that passes does `main` move. The pipeline fast-forwards it onto the exact commit
the gate drove, which is why the merge is never a squash or a rebase: those mint a new commit, and
`main` would then carry a tree nothing ever tested. The pull request closes as merged on its own.

Before it moves, `tools/check-gate-jobs.js` reads the run attempt's own job list through the API and
refuses unless every job except land, publish and cleanup finished with conclusion success. A whole
called workflow may be skipped only when the version check said it was not needed. The `land` job's
`if:` tests each result for `success` (or `skipped` when not needed), never "not failure".

The last job then creates the tag, creates the release page, and attaches the installers. So a
failure anywhere leaves nothing behind: no tag, no release, no download, and nothing on `main`
either. Whoever is running the app stays on the version they have and never learns anything was
attempted. The branch keeps the failure, and the next change is free to go.

A red gate also uploads what the rig left behind: each scenario's logs and every
screenshot, kept for two weeks under the run.

The release notes are a commit message, and the publisher takes it from the newest commit titled
"<version> - " (`tools/release-notes.js`), falling back to the commit that set the version, rather
than from whatever sits at the top of the branch. One version is one commit, so
the message is written for the person reading the release page rather than for the person who
wrote the code. When the gate goes red, the fix amends that same commit instead of landing on
top of it, which keeps the notes and the passing checks on the commit the release is named
after.

**Taking a release back** is not a matter of undoing the commit. The app asks GitHub for the
newest release, so a broken version keeps being offered until that release and its tag are
deleted. Once they are, the previous version becomes the newest, and because the app is allowed
to move backwards it offers that older version through the same Restart button. Nothing installs
itself, so each person still chooses when.

## The pipeline, step by step

A push to `release/**` or `change/**` runs `.github/workflows/release.yml`:

1. **Decide.** Is there an untagged version? Did the rig change? Do the branch, the version and
   the files agree?
2. **Unit tests, lint and the size guards**, side by side.
3. **The gate**, only for a new version or a rig change: Windows, Mac and Linux each build the
   installer, and the rig drives the packaged app, no sharding: `blockers` (launch, prep, a table
   session, work kept) on Windows and Mac, `launch` alone on Linux. A run whose app never started
   reruns once; any other failure is red. A run whose only red jobs never got a machine is rerun by the session watching CI, at most twice; a job that ran and failed stays red. **Every platform blocks the release.**
4. **Update proofs**, only for a new version: each platform steps back to an older build and
   forward again through its Restart button.
5. **Land.** `main` fast-forwards to the gated commit.
6. **Publish**, only for a new version: a draft release takes each file with retries, every size
   is checked, and only then does the release go public and the tag appear.
7. **Clean up.** The staging branch is deleted.

A red step stops everything after it, so nothing public exists for a change that failed. No other
workflow runs on a release or change push. `platformrig/**` runs the gate's three installers,
three rig legs and the update proofs as one row named after the branch, and ships nothing.

## What `/commit` holds by script

- `check-notes.js` stamps notes that pass, and refuses private words and the campaign names read
  from the running app.
- A UserPromptSubmit hook records the time of each DM message. Subagent hand-backs, task
  notifications and app events are ignored. `ship.js` refuses to push without a DM message after
  the stamp; an amend that touches nothing shipped skips the check.
- `ship.js` also refuses a release without `docs/BACKLOG.md` among its paths (unless
  `--no-backlog`) and an amend that edits a test or scenario with no disclosure line naming it. It
  clears `notes.txt` after the push. It opens no pull request: it prints the `gh pr create` line and
  the session runs it, so the app can arm Auto-fix. An open pull request is kept only when this
  session pushed its branch before; otherwise the printed command closes the other one and opens a new one.
- A Stop hook holds the turn after a push until the CI monitor is armed and the chat carries the
  Summary line as its title. It reminds once per push, then lets the stop through.
- `guard-ship.js` refuses a hand-typed `git push`, `gh pr merge`, tag creation and
  `gh release create/edit/upload`. `/rollback` runs through `tools/rollback.js`.
- `session-status.js` names leftover run folders and disclosures.
- Still prose: the bump size, what to file, `/voice`, and sending
  `notes.txt` as a file.

## A new Claude account on this machine

1. Sign in and open the Evermist folder. The repo's rules, guards, skills and reply style load
   from the folder by themselves.
2. Run `gh auth status`. `gh` is authenticated to GitHub, not to Claude, so it keeps working.
3. The Code tab's CI monitor, cloud environments and published artifacts belong to the old
   account. Re-create what is still needed; nothing in the repo depends on them.
