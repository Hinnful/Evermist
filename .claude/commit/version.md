## Step 3 - Set the version

Read `version` from `package.json`. **`CLAUDE.md`'s "When to bump the version" section is the
authority.** As it stands:

- **Bump only when the change touches the shipped app** - anything matched by `build.files`. Check
  the diff against those globs.
- **Patch** for fixes and ordinary changes, **minor** for a notable feature, **major** for a
  breaking overhaul, **no bump** for docs, tests and `.claude/` tooling.
- **A mixed diff takes the highest applicable bump.**
- **Edit `package.json` yourself.** A tag whose `package.json` disagrees builds wrongly named
  artifacts.
- **Put the version at the front of the Summary line**: `1.7.3 - Draw rooms without the card in
  the way`. A no-bump commit has no prefix.
- **Honour an explicit version in the steering input**, but say if it skips a number.
- **Check the version is not already ahead.** An unreleased bump from a previous commit keeps its
  number rather than being bumped twice.
- **Ask only when the call is genuinely ambiguous.** One question, with a recommendation.
