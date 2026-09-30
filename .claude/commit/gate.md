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

- **`npm test` once, whatever the diff touched.** It costs seconds.
- **A SMOKE pass, never the full regression set.** CI runs regression against the packaged `.exe`
  after the push. This local pass catches a break while the change is still in front of you.
- **Skip the rig entirely** when the diff touches no file under `src/` and no `index.html`,
  `main.js` or `preload.js`. Say you skipped it.
- Otherwise always include `smoke`, then add each acceptance scenario covering a file this commit
  touched, plus each one covering a caller or reader of what changed. Read the scenario headers
  rather than guessing from names.

```
npm run rig -- smoke <scenario> <scenario>
```

**Name the set you chose and why, in one line.** The user needs to see what you decided not to run.
If most of the suite qualifies, say so and run `regression` instead.

**BLOCK on red.** Report which scenario failed and what its FAIL line said. Do not set the version
and do not write notes. If the failure is the rig rather than the app - the Player window never
becoming visible is the known one - say which of the two it is.

**One red is expected on every version bump.** `help-and-about`'s check that the What's new panel
marks the running version as installed fails, because the changelog is regenerated only after the
commit exists (`push.md`). Read it as expected, confirm nothing ELSE is red, and carry on. Any
other red still blocks.

**Mutation-check every NEW scenario.** Break the line in `src/` that implements it, re-run that one
scenario, confirm it goes FAIL *and that the failure names the right check*, then restore and verify
`git diff -- src/` is empty. A scenario can pass a mutation check for the wrong reason - a timeout,
or a different assertion - and that reads exactly like success.
