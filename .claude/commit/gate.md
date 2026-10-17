## Step 2 - The test plan, then the gate

**Write the plan before anything runs.** Afterwards it is a description of a pass that already
happened.

Read the criteria off the diff in plain language, one line each: what a DM can now do, or what no
longer goes wrong. Then say where each lands - an existing acceptance file, a new one, or nowhere
(docs, tooling, anything the rig cannot reach). **The build normally wrote the scenario already**,
so name the file and its lettered criteria, and confirm they say what the diff actually does.
Criteria drift while a thing is built, and the header is what gets read a year later.

**BLOCK when shipped behaviour changed and no criterion covers it.** Write the criteria and their
checks now, then run.

**Never verify by eye what the rig can drive.** Look, feel and performance are the user's call and
go to `rig.byEye`. Correctness is yours.

Then the gate:

- **Cheap checks first, whatever the diff touched.** Run `node tools/build-changelog.js` (CI writes
  the What's new list before its tests, and the committed copy is stale, so `npm test` is red
  without it), then `npm test`, `npm run lint` and `node tools/check-guards.js`. Restore the generated
  file afterwards with `git checkout -- src/ui/changelogData.js`; it never rides in a commit. The
  guards are a CI job of their own that `npm test` does not run, and `ship.js` runs them again and
  refuses a guarded file the commit would not carry. The house rules on comments, file size, the
  module maps and the public docs are tests, so a red here can be one of those; its message says
  what to fix.
- **Skip the rig entirely** when the diff touches no app file: anything under `src/`, `index.html`,
  `main.js`, `preload.js` or `electron/`, and no changed scenario. Say you skipped it.
- **Otherwise let the map pick the set.** CI records which functions of which file each scenario
  actually ran, and keeps the latest green run's map. This reads it and picks:

```
node tools/rig-ci.js pick
```

  It prints the scenarios to run with the time each took in CI, what it left to CI because the set
  would pass about 10 minutes, and the one command to run. **Name the set, the time and anything left
  to CI in one line**, so the DM sees what you decided not to run.
- **BLOCKED means a changed `src/` script has no scenario that runs it**, by the map or by a header
  that names the file. Write the scenario (its header names the file), then pick again. Do not
  hand-pick around it.
- **When the map is missing, or a file is absent from it** - a new file, a map older than 90 days -
  the pick falls back to `smoke` plus the scenarios whose header names the file, and says so. Pass
  that on. A stylesheet, `main.js` and `electron/` cannot be recorded (the profiler reads a page),
  so smoke plus the header-named scenarios is their check, and the pick says so.
- **Run exactly what it printed.** It adds `--low-priority`, so the DM's games and apps keep the
  CPU, and the rig parks its windows off-screen and never takes focus. Run it in the background:
  a set of several minutes outlives a foreground tool call.
- **The repeat-flake check, once:** `node tools/rig-ci.js flakes`. A scenario that needed a rerun in
  three or more recent runs is a proposed backlog item (fix it, or retire it), reported to the DM
  with the push report. Never write the backlog without a yes.

**BLOCK on red.** Report which scenario failed and what its FAIL line said. The rig has already
rerun it once in a fresh app, so a red here failed twice. Do not set the version and do not write
notes. If the failure is the rig rather than the app - the Player window never becoming visible is
the known one - say which of the two it is.

A new scenario was mutation-checked when it was written; the `rig` skill carries how.
