## Step 6 - On their yes: push, arm the monitor, close the backlog

**A yes covers the commit in front of them and nothing else.** Not the next one, not a follow-up
fix, not a re-push after an edit. Anything ambiguous is a no - a question, a new task, or silence.
If they answer with an edit to the notes, make it and offer again.

Then run the tail. `ship.js` does all of it, in order, and each stage checks whether it is
already done before acting, so a re-run after a stop finishes the tail and repeats nothing:

- **Stage exactly the paths the notes and Step 4 describe**, never `git add -A`. A path nobody
  named is one nobody reviewed. Pass them to the script; it stages nothing else.
- **Commit** with the Summary as subject and the Description below it, read from `notes.txt`. No
  `Co-Authored-By` trailer.
- **On a version bump, regenerate the in-app changelog and amend**, so the panel carries this
  release. The generator reads the commit that must already exist.
- **Delete every local branch already in `main`**, except `main`, the current branch and any
  branch checked out in another worktree. `cleanup` deletes the remote branch, but a local one
  stays in the app's branch picker forever.
- **Push a BRANCH by refspec, never `main`, and never create the branch locally.** `main` is
  protected. Name it `release/<version>` when the version moved, `change/<short-slug>` when it
  did not. The workflow fires on those two prefixes only, and the script refuses any other.
- **Open a pull request**, so the run and every failed attempt before it keep a permanent page.

```
node .claude/commit/ship.js --branch release/2.11.0 -- <path> <path>
```

It prints the short hash and the pull request URL, and fails loudly at the stage that broke.

- **Never merge the pull request yourself.** The `land` job fast-forwards `main` once the gate is
  green and the PR closes as merged; `cleanup` then deletes the branch. A merge, rebase or squash
  would put a tree on `main` that no gate drove.
- **Arm the CI monitor.** Read `mcp__ccd_pr__get_status` to confirm the app picked the PR up, bind
  it by URL if it did not, then `mcp__ccd_pr__set_monitor` with `auto_fix: true`. **It wakes this
  session on failure only.** A green run notifies nobody here, which is why the backlog is closed
  below rather than after the gate.
- Report the short hash and the pull request URL **together with the backlog proposal below**,
  then **end the turn**. No `gh run watch`. Write the backlog on the user's answer.

### The backlog proposal goes out with the push report

The backlog lives at `docs/BACKLOG.md`. This edit comes after the push, so it rides into the
next commit. Read it first so you match its structure and do not duplicate an entry.

- **Close what shipped.** Delete every item this change built. Record it in the dated note at the
  top, naming any dead end the work paid for, so nobody re-investigates it.
- **File what was deferred.** Anything discovered, skipped, or left as a follow-up. Use the
  backlog's own fields - plain-language *what it is*, *where it shows* (DM/Player/both), rough
  effort, risk, any blocker. This is the shape `/brief` reads back.

**Never touch the backlog silently.** List what you intend to close and what you intend to add, in
plain language, and let the user strike any of them before you write.

**An item earns its place only if someone could pick it up and do it.** Convert relative dates to
absolute. Nothing already decided, shipped or refused belongs there.

A red gate does not invalidate this. The fix keeps the same version and amends the same commit, so
what the backlog recorded still shipped. Only an abandoned change needs an edit.
