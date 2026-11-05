## Step 2 - The gate

Three checks, and nothing else locally:

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

**The rig is not part of this step.** The release gate runs its blocker set on every platform, so a
local run answers nothing the gate will not. It stays a probe for a question code cannot answer:
one scenario, or a throwaway probe file deleted afterwards (the `rig` skill carries how).

**Never verify by eye what a check can drive.** Look, feel and performance are the DM's call.
Correctness is yours.
