## When the monitor wakes you on red

**Nothing public happened.** No tag, no release page, users untouched on the last release. `main`
keeps the last release and the next change is free to go, so do not report a red as an outage.

- Read the log (`gh run view <id> --log`) and say which job failed and what its FAIL line said.
- **Classify it before proposing a fix:** app bug, scenario fault, or infrastructure. Do not report
  a scenario fault as the app being broken.
- **Reproduce a geometry or layout failure locally rather than by pushing again.** A runner has a
  1024x768 virtual display; `npm run rig -- <name> --dm-size 1008x681 --player-size 1024x768`
  reproduces it here, digit for digit, in half a minute.
- **THE VERSION DOES NOT MOVE.** Nothing published under it, so the number is unused.
- **A skipped or errored run is not a green one.** Infrastructure trouble is not permission to
  publish.

### The fix AMENDS, it never lands on top

**ONE VERSION IS ONE COMMIT.** A red gate published nothing, so the commit carrying the version is
still yours to edit.

```
node .claude/commit/ship.js --amend -- <paths>
```

If `notes.txt` is gone, write it from `git log -1 --format=%B` first. `--amend` folds the paths into the commit instead of adding one, takes the message from
`notes.txt`, and force-pushes the branch with a lease on the SHA it last saw. Without it the
script refuses to push over a different commit.

**Never `git commit` a fix on top of an untagged version bump.** Two commits for one version put the
green checks on the wrong one. The force-push lands on the BRANCH, and the open pull request keeps
both attempts' checks on its timeline.

**Amend the message only when the fix changed what users get** - edit `notes.txt` before the run. A rig or CI fix changes nothing
users see. A fix to shipped behaviour gets its own line in the Description.

**Force-pushing rewrites a commit other branches may sit on.** Check `git branch --contains HEAD`
first, and say which branches need a rebase.

**Who says yes depends on what the fix touches.** A fix outside `build.files` - a scenario, a
workflow, a guard - changes nothing users get: prove it at the runner's window size, push it
straight back with `--amend`, and report afterwards. A fix to a real APP bug changes what
installs, so it goes back through the notes (`notes.md`) and the user's yes.
