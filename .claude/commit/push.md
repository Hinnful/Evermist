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
- **Catch up with `origin/main` first.** While another session's release or change is in CI, the script
  stops with `WAIT` and prints a wait loop: run it with the Monitor tool, then run the script again.
  It then moves this work onto the new main, replays the bump on main's version and renumbers the
  Summary. The DM's yes stands, since it covers the text; say the new number in the report. A
  conflict stops it with the files named. Then it **checks the branch, the version and the files
  agree** with the same rules CI applies.
- **Push a BRANCH by refspec, never `main`, and never create the branch locally.** The script
  picks `release/<version>` for an untagged version and `change/<slug>` otherwise.
- **Open a pull request yourself** (the DM's yes to push covers it and the CI monitor), so the run and every failed attempt before it keep a permanent page.
  The script prints the `gh pr create` line; run it in Bash, as its own command. When another
  session opened the branch's pull request, the line closes that one first: the app arms Auto-fix
  only for a pull request it watched this session open. The app arms Auto-fix
  only for a pull request it watched this session open, never one a script opened. If the call is
  refused anyway, say so to the DM in one line and end the turn; never ask the DM to run it.
- **Refuse a release without proven acceptance.** Pass `--accept <spec>` for every item the release ships.
  The script refuses a spec whose DoD has a line with no mark of how it was proven, or a user line not
  written as does → sees. Mark the lines before Step 5, after checking each one yourself; never mark a
  line from a builder's report alone.
- **Refuse without the yes, the backlog or a disclosure.** The script checks them itself: notes that
  passed `check-notes.js` unchanged, then a message from the DM; `docs/BACKLOG.md` among the paths of
  a new release (`--no-backlog` when it truly has nothing); a disclosure line for each test an amend edits.
- **Record the push** in `pushed.json` in the run folder, and clear `notes.txt`.

```
node .claude/commit/ship.js [--slug <short-slug>] [--accept .claude/private/specs/<item>.md]... -- <path> <path>
```

It prints the branch, the short hash and the pull request URL or the line that opens it, and fails loudly at the stage that
broke. CI writes the in-app What's new list when it builds, so nothing is amended after the commit.

- **Never merge the pull request yourself.** The `land` job fast-forwards `main` once the gate is
  green and the PR closes as merged; `cleanup` then deletes the branch. A merge, rebase or squash
  would put a tree on `main` that no gate drove.
- **Arm the CI monitor right after `gh pr create`**: `mcp__ccd_pr__set_monitor` with `auto_fix: true`,
  before anything else. If it reports no pull request, bind it by URL with `mcp__ccd_pr__bind_pr` and
  set it again. Reading `get_status` first and ending the turn left the monitor off in 35 of 39
  releases. **It wakes this session on failure only.** A green run notifies nobody here, which is why the backlog is closed
  before the push rather than after the gate.
- **Rename the chat to the Summary line** with `mcp__ccd_session_mgmt__set_session_title` (load it
  with ToolSearch), so the session list names each release.
- Report the short hash and the pull request URL, then **end the turn**. No `gh run watch`. The Stop
  hook (`stop-checklist.js`) holds the turn open until the monitor is armed and the chat renamed.
