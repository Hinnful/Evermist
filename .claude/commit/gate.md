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

- **`npm test` and `npm run lint` once, whatever the diff touched.** They cost seconds. The house
  rules on comments, file size, the module maps and the public docs are tests, so a red here can
  be one of those; its message says what to fix.
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

A new scenario was mutation-checked when it was written; the `rig` skill carries how.
