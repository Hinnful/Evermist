## Step 2 - The gate

Three checks, and for a release that changes the app the design sweep below:

```
npm test
npm run lint
node tools/check-guards.js
```

`npm test` regenerates the gitignored What's new list first. The guards are a CI job of their own
that `npm test` does not run, and `ship.js` runs them again and refuses a guarded file the commit
would not carry. The house rules on comments, file size, the module maps and the public docs are
tests, so a red here can be one of those; its message says what to fix.

**BLOCK on red.** Report which check failed and what it said. Do not set the version and do not
write notes.

**A release that changes the app also runs the design sweep, once:**

```
npm run rig -- --dm-size 1280x1500 design-sweep
```

A clean run stamps the app's files; `ship.js` refuses a release whose files changed since. A fault is fixed
before the notes, and the sweep runs again. It runs here and nowhere else: never during iterations, never in CI.
Every screen opens in every state on every run, but a state whose rows, letters and paint match a clean read on this
machine is not shot again, so a run after a fix shoots only what changed. Every fault it finds is fixed in this release.

**No other rig run is part of this step.** The release gate runs its blocker set on every platform, so a
local run answers nothing the gate will not. It stays a probe for a question code cannot answer:
one scenario, or a throwaway probe file deleted afterwards (the `rig` skill carries how).

**Never verify by eye what a check can drive.** Look, feel and performance are the DM's call.
Correctness is yours.
