## Step 6 - On their yes: write the backlog, push, arm the monitor

**A yes covers the commit in front of them and nothing else.** Not the next one, not a follow-up
fix, not a re-push after an edit. Anything ambiguous is a no - a question, a new task, or silence.
If they answer with an edit to the notes, make it and offer again.

**Write the backlog first**, without the items they struck, so `docs/BACKLOG.md` rides in this
commit and the tree is clean after the push.

Then run the tail. `ship.js` does all of it, in order, and each stage checks whether it is
already done before acting, so a re-run after a stop finishes the tail and repeats nothing:

- **Stage exactly the paths the notes and Step 4 describe, plus `docs/BACKLOG.md`**, never `git add -A`. A path nobody
  named is one nobody reviewed. Pass them to the script; it stages nothing else, and names every
  edit it leaves behind. Name each one to the DM: another session's work in progress, or yours to ship.
- **Commit** with the Summary as subject and the Description below it, read from `notes.txt`. No
  `Co-Authored-By` trailer.
- **Refuse a HEAD that does not contain `origin/main`**, and **check the branch, the version and
  the files agree** with the same rules CI applies.
- **Push a BRANCH by refspec, never `main`, and never create the branch locally.** The script
  picks `release/<version>` for an untagged version and `change/<slug>` otherwise.
- **Open a pull request**, so the run and every failed attempt before it keep a permanent page.
- **Refuse without the yes, the backlog or a disclosure.** The script checks them itself: notes that
  passed `check-notes.js` unchanged, then a message from the DM; `docs/BACKLOG.md` among the paths of
  a new release (`--no-backlog` when it truly has nothing); a disclosure line for each test an amend edits.
- **Record the push** in `pushed.json` in the run folder, and clear `notes.txt`.

```
node .claude/commit/ship.js [--slug <short-slug>] -- <path> <path>
```

It prints the branch, the short hash and the pull request URL, and fails loudly at the stage that
broke. CI writes the in-app What's new list when it builds, so nothing is amended after the commit.

- **Never merge the pull request yourself.** The `land` job fast-forwards `main` once the gate is
  green and the PR closes as merged; `cleanup` then deletes the branch. A merge, rebase or squash
  would put a tree on `main` that no gate drove.
- **Rename the chat to the Summary line** with `mcp__ccd_session_mgmt__set_session_title` (load it
  with ToolSearch), so the session list names each release.
- **Arm the CI monitor.** Read `mcp__ccd_pr__get_status` to confirm the app picked the PR up, bind
  it by URL if it did not, then `mcp__ccd_pr__set_monitor` with `auto_fix: true`. **It wakes this
  session on failure only.** A green run notifies nobody here, which is why the backlog is closed
  before the push rather than after the gate.
- Report the short hash and the pull request URL, then **end the turn**. No `gh run watch`. The Stop
  hook (`stop-checklist.js`) holds the turn open until the monitor is armed and the chat renamed.
