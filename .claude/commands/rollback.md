---
description: Pull a bad release back - delete it and its tag so every installed copy is offered the last good version
argument-hint: "[version to pull, e.g. 2.9.0 — defaults to the newest release]"
allowed-tools: Read, Grep, Glob, Bash
---

# Mode: Pull a Release

Something shipped broken and reached people. This command takes it back.

**⚠ REVERTING THE COMMIT DOES NOT UNDO A RELEASE, and reaching for `git revert` first is the whole reason this command exists.** `electron-updater` serves whatever the newest release is. Until the bad release is gone, every installed copy keeps being offered it, and a revert commit just publishes yet another version on top.

**What actually pulls it back:** delete the release and its tag. The newest release becomes the previous one, and `allowDowngrade` (set in `electron/updates.js`) means installed copies already sitting on the bad version get offered the older one through their own Restart button. Nothing auto-installs, so each person still presses it.

## Optional steering input

The version to pull, if not the newest: $ARGUMENTS

## Step 1 — Establish what is live

Read-only:
- `gh release list --limit 5` and `gh api repos/Hinnful/Evermist/releases --jq '.[0:3] | .[] | .tag_name'`
- `git ls-remote --tags origin` — the remote's tags, never `git tag --list`, which shows only local ones.
- `node -p "require('./package.json').version"`

Name three things back in one line each: **the version being pulled**, **the version that becomes newest after it goes**, and **whether that older release still carries its `latest*.yml` and installers**.

**BLOCK if the version becoming newest has no `latest*.yml`.** Deleting the bad release would then leave every installed copy with no update path at all, in either direction. Say so and stop; the fix is to ship a good version forward, not to pull this one back.

**BLOCK if the release being pulled is the only one.** There is nowhere to fall back to.

## Step 2 — Confirm, in their words

State the plan in three lines: which release and tag get deleted, which version people land on, and that anyone already on the bad version will be offered the older one on their next check.

Then **ask, and wait.** This is public and it takes installers away from a download page. An ambiguous answer is a no.

## Step 3 — Pull it

```
gh release delete v<X.Y.Z> --yes
git push origin :refs/tags/v<X.Y.Z>
git tag -d v<X.Y.Z>
```

The release first, then the tag. A tag with no release confuses nothing; a release whose tag is gone still serves its assets.

## Step 4 — Verify, and say what happens next

- `gh release list --limit 3` — the pulled version is gone and the expected one is newest.
- `gh release view v<newest> --json assets` — it carries its installers and its `latest*.yml`.

Then two lines the user needs:

- **Anyone still on the bad version is offered the older one on their next start.** They press Restart to update, same as always.
- **`package.json` still holds the pulled version.** Nothing publishes under a tagged version, and that number is now untagged, so the next `/commit` will try to release it again. Decide with them: bump past it, or fix the bug and let the same number ship properly. Do not edit `package.json` here.

**No `git revert`, no new commit, no version edit.** This command deletes two things and reports.
