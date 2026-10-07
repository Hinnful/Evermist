# Decisions - the working process

The public, past-tense ledger of decisions about **how work on Evermist runs**: the slash commands
(/brief, /spec, /commit, /rollback, /redteam), the order they run in, and what CI took over from
them. What was tried, what was rejected, and why. [PROCESS.md](../PROCESS.md) says how the process
runs now; this file says why it has that shape. Decisions about the repo's docs, rules and guard
hooks are in [docs-and-guards.md](docs-and-guards.md), what the product is in
[PRODUCT.md](../PRODUCT.md), and open work in [BACKLOG.md](../BACKLOG.md).

**2026-09-11: `/wrap` was deleted and its work moved into `/commit`** - see the entry of that
name. Every older `/wrap` entry below is history, not current behaviour.

**One heading, a status, and at most a short paragraph.** Guarded by the same hook as the other
ledgers.

---

### A prototype of an existing window renders the app's own code, and audits itself · `SETTLED` (2026-10-03)
Item 150's first round rebuilt each window by hand in a mock page. It drifted from the app twice:
it lost the stat block's positioned lines and hints, and its parts disagreed with one another -
icons sat high beside labels, destructive buttons came in three styles, outlines came and went.
The rounds that held loaded the app's real stylesheets and rendered the real windows from the
app's own scripts, with the proposal as one override stylesheet that maps onto the edits a build
makes. A script on the page measured every rule (heights, outlines, icon against label baseline,
destructive styling, footer placement, widths) and was proven by breaking each rule on purpose.
The prototype stays in `.claude/private/design/`, and the audit ports into the rig.

### `/commit` is a spine that resumes, with its rules read per step · `SETTLED` (2026-09-29)
At ~300 lines, one stop midway could leave a dirty tree, a release without its What's new entry or
an unwatched gate. The command is now a sub-100-line spine; each step reads its own file in
`.claude/commit/` when it gets there. Step 0 reads `run.json` and git state to resume, and
reports the last release's Build & Release run. `ship.js` runs commit-to-PR with every stage
idempotent; `check-notes.js` refuses what a machine can see in the notes. Doc filing stayed in the
command (2026-09-11). **Rejected: a separate docs command** - one more gap to forget, the reason
`/wrap` died. Pushed state is SHA equality, never `--contains`, which reads every old release as
in flight. `commit.md.pre-slim` is the restore path until a real release proves the new shape.

### `/commit` deletes merged local branches before it pushes · `SETTLED` (2026-09-28)
The release workflow's `cleanup` job deletes the remote branch, but each release had also been
checked out as a local branch, and ten of them piled up in the app's branch picker. `/commit` now
pushes by refspec and deletes every local branch already in `main` first. Cleaning up at the end
of a release was rejected: a green run wakes nobody, so no step runs after it.

### A commit's Summary and Description both name the part of Evermist that changed · `SETTLED` (2026-09-13)
The Summary rule read "imperative", which produced headers addressed at the reader, telling them
to do something. The subject is now the thing in the app, called by its name on screen, stated
declaratively: "Merge, Cut out and Split work on effects". A verb is optional, so a noun phrase
like "Split Map mode for two scenes at once" is a valid header.
Filler goes: no "too", "as well", "now", "instead". No reason, no comparison against the old
behaviour, no opinion, no example.
**Every one of those rules binds each Description line too**, so a Description is the same sentence
shape rather than a looser register. The reader never holds the subject slot: "marks the one you are
running" becomes "marks the running version". An effect is an effect and never a burn, and nothing
from a table, a session or a campaign enters either block.

### `/commit` is six steps and ends at the push · `SETTLED` (2026-09-11)
The eight-step version blocked a session for fifteen minutes on `gh run watch`. Step 8 is gone:
the command arms the desktop app's CI monitor (`set_monitor` with `auto_fix`) and ends the turn.
**The monitor wakes the session on failure only**, so the backlog close moved up into the push
step rather than waiting for green. That is safe because a red gate keeps the same version and
amends the same commit, so nothing the backlog recorded stops being true; only an abandoned
change would need an edit.

**Splitting the test plan out was REJECTED.** `CLAUDE.md` bans running a rig set while building,
so the plan cannot move ahead of the run it plans, and a gate must sit before the irreversible
step it protects - the rule that already killed `/wrap`. Filing the decisions stays in the command
for a different reason: no hook can fire on "a decision was made", since every guard hook here
hangs off a tool call. A prose rule in `CLAUDE.md` decays inside a long session.

### `/commit` pushes a branch and opens a PR, never `main` · `SETTLED` (2026-09-11)
`main` is protected, so Step 6's `git push origin main` no longer works. The commit goes to
`release/<version>` when the version moved and `change/<slug>` when it did not, and `gh pr create`
opens the pull request. **The command never merges it** - the pipeline's `land` job fast-forwards
`main` and the PR closes itself. A merge, squash or rebase would put a tree on `main` that no gate
drove.

Step 7 changed with it. Every push is now watched, bump or not, because a no-bump change still has
to be landed by the pipeline. On green the command brings the local `main` forward with
`git branch -f main origin/main`. On red it amends the commit and force-pushes the BRANCH; `main`
never saw the failure, so a red gate no longer blocks other releases and must not be reported as
an outage.

### `/wrap` runs before `/commit` · `SETTLED` (2026-08-10)
The docs `/wrap` files are working-tree changes, so running it first means `/commit` sees them
and folds them into the same commit as the code they describe. Run the other way round, every
doc update lands under the next unrelated commit. **Deliberately not enforced in the command
files**: the two are independent, `/wrap` alone mid-session is normal, and an auto-check that
refuses one without the other would block the legitimate case.

### Manual test checklists in `/handoff` and `/wrap` · `REJECTED`
Checklists went unread, and the rejection stands. **The reason recorded here in August was wrong
and is corrected:** the app CAN be agent-driven - `tools/rig/` attaches to the real Electron shell
over the DevTools protocol and drives both windows. So correctness is no longer the DM's to
hand-verify; only look, feel, performance at the table, and the export's native save dialog are.
The DM is asked for those and nothing else.

### `/wrap` blocks on a red rig, and mutation-checks each new scenario · `SETTLED` (2026-08-14)
Three parts, all in Step 1. Skip the rig entirely when the diff touches no shipped file, so a
docs-only session pays nothing. Otherwise run `npm run rig -- regression` and **stop on red** -
deliberately unlike the `npm test` check beside it, which is only flagged, because filing backlog
entries and decisions about broken work wastes the entries. And mutation-check every scenario the
session added rather than trusting it: break the line under it, confirm the FAIL names the *right*
check, restore, verify `git diff -- src/` is empty. **The failure mode that forced this is real and
recorded** - one of the grid session's four scenarios passed its mutation check for a reason other
than the code under it, which looks identical to working. A green-only scenario proves nothing.
Also reconcile each new file's criteria header against what actually shipped; criteria drift during
a build and the header is what gets read a year later.

### `/handoff` puts the rig in the numbered steps, not at the end · `SETTLED` (2026-08-14)
A bug fix reproduces the bug with a scenario **before** the fix, as its own early step; a feature
writes its acceptance scenario in the same step as the behaviour, with an explicit note that it
must be proven red once. Both had to be numbered steps: a reminder at the end of a spec is read
after the work is done, which is exactly too late for the reproduce-first half, and a scenario
listed last is the thing dropped when a session runs long.
**No step telling the build session to run `/wrap`** - that stays the DM's own call, same as
`/commit` and `/release`.

### Auto-running `/redteam` inside `/handoff` · `REJECTED`
Slow, expensive, and mostly grading a *spec* against criteria that don't apply to an offline
single-user app. Replaced by a mandatory verdict line with a reason. The standalone run on a
**diff** is where the value is.

### Talking rules reached the commands · `SETTLED` (2026-08-26)
An earlier claim was wrong and is corrected here: `/brief` and `/handoff` run **inline**, not as subagents, so the Steering output style and the `plain-language.txt` hook already applied to both. The jargon in their output came from the command files themselves, which instructed the banned words. "load-bearing" was stripped from `brief.md`, `handoff.md` and `redteam.md`, and two other stock phrases from `wrap.md` and `brief.md`.

- `brief.md` gained a `## How to write it` section: all of its output is user-facing, so the style and the hook apply to every word.
- `handoff.md` gained `## Which parts follow the talking rules`: the summary above the code block and the red-team verdict line below it follow the rules in full; the block keeps the sentence rules but drops the word cap and the one-word-one-meaning rule, because a spec must name the same file the same way every time. **A hook was explicitly rejected** - it fires once per prompt and cannot tell the block from the summary, so the split lives in the command file.
- `/redteam` was **left unstyled on purpose.** The DM never reads a red-team report directly, only Claude's account of what it changed about the handoff. So the reviewer's prose is not user-facing and its subagent prompt stays as it is. What was missing was the summary itself - `redteam.md` printed the structured report and stopped, so the plain-language wrap-up the DM actually reads was habit rather than a rule. It is now a required section, `## The report is not the deliverable - your summary is`: three to five lines covering what the review changed about the work, any FAIL Claude disagrees with, and any QUESTION that needs the DM's intent rather than the codebase.

### Evermist-specific setup lives inside Evermist · `SETTLED` (2026-08-26)
The governing principle: **anything Evermist-specific lives inside Evermist and must not reach other projects on the same machine.** Private content gets gitignored rather than moved out.

What moved into the repo:
- **All six slash commands** → `.claude/commands/`, gitignored. They were global and every one of them is Evermist-shaped (`wrap.md` alone had 11 repo-specific references), so they fired in other projects against docs and a rig that do not exist there.
- **The Chrome deny rule** → the repo's `.claude/settings.json`. As a global rule it blocked Chrome in other projects too, which was a real bug against the principle.
- **The `.exe` / `npm start` / Chrome / rig-is-a-last-resort rules** → `.claude/hooks/evermist-context.txt`, read by a project-level `UserPromptSubmit` hook. **An output style could not carry them:** only ONE style can be selected at a time, so the Evermist half needed a different container. A project hook was the answer.

What stayed global in `~/.claude/`: `steering.md` (now purely about how the DM decides and reads), `plain-language.txt`, `collect-voice-samples.js`, and the `voice` skill. `steering.md` gained a rule forbidding project-specific lines in itself.

**Correction to record:** the memory directory is **already per-project** - `~/.claude/projects/<slug>/memory/`, and every other project has its own. So the backlog and this ledger never leaked to other projects. Moving them into the repo buys backup and visibility in GitHub Desktop, not isolation, and it costs auto-recall through `MEMORY.md`. Left as the DM's open call.

### Both private ledgers left the memory directory · `SETTLED` (2026-08-26)
The backlog (380 lines) and this ledger moved to `.claude/private/` in the repo, gitignored. They have since moved again, to `docs/BACKLOG.md` and `docs/decisions/process.md`.

**Gained:** the repo folder is synced to cloud storage, so the backlog finally had a second copy. It previously existed once, on one disk, under the user profile's `.claude` folder, covered by neither sync nor git. The DM could also open and diff it.

**Not gained:** gitignored files get no git history and no copy on GitHub. Committing them was rejected at the time because the repo is public and the backlog quoted the DM by name on ten lines; rewriting 380 lines to be publication-safe cost more than the bluntness was worth.

**Unaffected:** `guard-backlog.js` matches on `path.basename`, so it still fires. `/brief` and `/wrap` were repointed at the new paths. `MEMORY.md` keeps a pointer line for each.

### `evermist-context.txt` was created and deleted the same day · `REJECTED` (2026-08-26)
The DM spotted that it duplicated `CLAUDE.md`, and was right: its rig line was already in `CLAUDE.md`, and its `npm start` line restated the `## Running the app` section.

**The rule this settles:** a project-level `UserPromptSubmit` hook is only worth its per-turn cost for behaviour that **decays inside a session**, which is why `plain-language.txt` is a hook. Stable facts about a project - which command runs it, which tool never to reach for, when to use the rig - belong in `CLAUDE.md`, read once at session start. Duplicating them into a hook creates two copies that drift apart.

`CLAUDE.md` absorbed the one genuinely new rule ("The DM runs `npm start` and the `.exe`. Never open or suggest Chrome.") by dropping the `npx serve` browser path from `## Running the app`, which the DM never uses. The file came down to 12,907 bytes against its 12,940 ceiling, so no baseline raise was needed. The Chrome tools stay hard-denied in `.claude/settings.json`; the prose rule exists only to stop Claude *suggesting* Chrome, which a deny rule cannot do.

### The rig gate moved from `/wrap` to `/commit` · `SETTLED` (2026-08-26)
The real order in use was `/commit`, push to `main`, then `/wrap`. The gate lived in `/wrap`, so a red rig reported what had already been pushed. It was not a gate at all.

- `commit.md` gained **Step 2 - The rig gate (blocks everything below)**, sitting between "analyze the changes" and "set the version". It needs Step 1's diff to decide whether shipped code changed at all. On red it stops before the version is touched and before any notes exist, so there is nothing to paste.
- It carries **both** rig jobs: the `regression` run and the mutation check on every new scenario. Both need the rig running, so both belong at the same point.
- `wrap.md` keeps only the criteria-header reconciliation, which is a documentation task and needs no run.
- Repointed at `/commit`: `CLAUDE.md`, the `rig` skill, and two lines in `handoff.md`.

**The rule this settles:** a gate must sit before the irreversible step it protects. `/wrap` files documentation, so nothing downstream of it can be prevented.

### `/handoff` became `/spec`, and it drills before it writes · `SETTLED` (2026-09-02)
`/handoff` wrote a spec and asked questions only where the writing snagged, so the questions were
incidental. The fire-ground saga is the cost: three days scrapped because the problem was never
stated before the building started. `/spec` inverts the order - seven gated stages (Frame,
Problem, Done, Approaches, Sketch, Edges, Spec), each ending with the reader and none starting
until it is answered. It may also conclude "don't build this", and it proposes any backlog split
it turns up rather than filing one.
**Chosen against the alternatives:** one command replacing `/handoff`, because a loop already
skipped does not survive another step; a **file** in `.claude/private/specs/` rather than a chat
block, which outlives the session and lifts the single-code-block rule that banned code fences;
**two or three approaches side by side** at Stage 3, against the output style's no-variants rule,
because options are the deliverable while specifying; a **drawing** as the default sketch, with a
prototype asked for rather than started, since it costs a session. Depth is judged per task. The
rig-in-the-steps, no-halting, no-commit-step, verdict and talking-rules splits carried over.

### `/brief` gains a Spec column and asks nothing · `SETTLED` (2026-09-02)
Running questions inside `/brief` was rejected: triage answers *what is worth a session*, and
drilling makes picking slow. What it owes the DM instead is one column per row - `ready` when the
item already says what to build, `needed` when a choice is still open. `needed` is the normal
answer for anything bigger than a small fix.

### `/wrap` deletes the spec that started the chunk · `SETTLED` (2026-09-02)
Step 2e. The ledgers carry every decision the spec held once the work lands, so a leftover spec is
the already-shipped clutter the backlog rule exists to keep out. A half-built spec stays and gets
reported.

### `/commit` smoke-tests the diff; the regression set moved to CI · `SETTLED` (2026-08-28, second half reversed 2026-09-08)
The full acceptance set ran on every commit, which cost minutes each time. `/commit` now picks
`smoke` plus the scenarios covering what the diff touched, and names the set it chose so what was
skipped is visible. **The full pass no longer runs from a command at all**: `release.yml` drives it
against the packaged `.exe` on every shipping push. The local smoke pass stayed local on purpose -
a commit reaches public `main` the moment it is pushed, so a CI check on that push reports a break
rather than stopping one.

### `/release` was DELETED, and `/commit` absorbed it · `SETTLED` (2026-09-08)
Its rig gate moved to CI, its version check was already automatic, and what was left was a text
generator. Deleting it would have lost the part that mattered: the rules on what reaches a public
page - no name, no campaign, no map, no quoted chat, no fixture, and the humanized voice. **One
commit is one release and the commit message IS the release notes**, so those rules moved into
`/commit` Step 5 rather than going away. Do not restore the command.

### `/commit` pushes on a yes, and watches the gate it started · `SETTLED` (2026-09-08)
Handing over paste-ready notes stopped making sense once `gh` was installed. Step 6 offers, stops,
and pushes to `main` only on an explicit yes - one yes per commit, staging only the paths the notes
describe, because reading the Summary is the only review this repo gets. Step 7 then watches the
release run, because a red gate reported by email arrives after the context is gone. A geometry
failure is reproduced with `--dm-size` / `--player-size`, never by pushing again.

### A red gate caused by the RIG is fixed and re-pushed without asking · `SETTLED` (2026-09-09)
Step 6's one-yes-per-commit rule covers what SHIPS. It was applied to a gate failure too, which
put a question in front of the DM for a tolerance in a scenario file - work they cannot judge and
did not ask to see. A red gate blocks every release until it is off `main`, so the pause also
costs time nobody chose to spend.
**The boundary is what the fix touches, and it was drawn deliberately.** Anything outside
`build.files` - a scenario, a workflow, a guard - is fixed, proven at the runner's window size, and
pushed straight back with a report afterwards. **A gate that found a real APP bug stays manual**:
that changes what installs, so it goes back through the notes and the yes. Held as "for now", so
it can widen later. The version never moves either way, because nothing was published under it.
Amending is the default when the fix rides a version that has not released: the workflow reads
the notes off `git log -1`, so a separate fix commit would publish its own subject as the release
notes.

### `/rollback` exists because the intuitive move is the wrong one · `SETTLED` (2026-09-08)
`git revert` does not undo a release: the updater offers the newest release, so the bad
installer stays on offer and a revert only publishes another version on top. The command
deletes the release and its tag, which makes the previous one newest, and `allowDowngrade` walks
installed copies back. It blocks when the version it would fall back to has no `latest*.yml`,
because that would leave every copy with no update path in either direction.

### `/brief` opens with the whole backlog before any recommendation · `SETTLED` (2026-08-28)
Item IDs are permanent and never reused, so the highest number is always far above the number of
open items and reads as a count. `/brief` now leads with a stated count, a one-row-per-item table
of everything open, and the note that IDs are retired rather than reassigned. The detail section
covers every row; items not worth recommending get a line rather than disappearing. An item is
also never referred to by bare number in conversation, which is what made the list unreadable.

### `/wrap` was deleted and its work moved into `/commit` · `SETTLED` (2026-09-11)
`/wrap` did no work of its own that another command needed doing separately. It was typed only
so `/brief` would have a current backlog to read, and it had to run BEFORE `/commit` so its doc
edits rode into the same commit - which meant the backlog recorded a release that had not
happened yet.

Its two halves moved to the two moments each becomes true. Ledgers, `ARCHITECTURE.md`, the skill
trigger map and a spent spec describe CODE, so they are Step 5 of `/commit`, before the notes,
and they ride into the commit that carries the code. The backlog describes the RELEASE and is
gitignored, so it is Step 8, after the gate reports green, where the version is a fact.

Rejected: leaving `/wrap` and adding a hook that reminds the DM to type it. A hook can print a
line; it cannot propose backlog items and wait for an answer. Rejected too: moving the backlog
half into `/brief`, which would have cost `/brief` its read-only, asks-nothing shape.

### `/commit`'s own gate cannot be green on a version bump · `SETTLED` (2026-09-19)
Step 2 runs the rig before the commit exists. `help-and-about.js` asserts the What's new panel
marks the running version as installed, and `src/ui/changelogData.js` is generated by
`tools/build-changelog.js` from the release commit's own subject - which Step 6 creates and
amends. So on any bump, Step 2 reads a `package.json` version the changelog cannot yet carry and
that one check goes red.

It is not the app and not the scenario. CI sees the amended tree and passes. Read it as expected
on a bump, confirm nothing ELSE is red, and carry on. Rejected: loosening the check to tolerate a
`package.json` ahead of the changelog, which would stop it catching a changelog nobody regenerated
- the exact fault it exists for.

### `/spec` became a DoR / DoD drill · `SETTLED` (2026-09-19)
The DM asked for it directly after the rig audit: drop the problem and prototyping stages and
drill on the Definition of Ready and Done with the usual frameworks. The seven stages and the
depth table went; a fixed six-heading report replaced them - What we're fixing, Questions,
Definition of Ready, Definition of Done, Out of scope, Risk. 271 lines to 162.
**Why the stages went.** They led to a decision the DM had usually already made; the useful part
was pinning down what "done" means and whether the work is ready. On item 104 the DM rewrote
Claude's nine-section DoD as three numbered lists, and that version was better.
**What the drill owes the DM.** Name what the DM's DoD adds that Claude's missed, priced in
sittings. Say which DoD lines a local run can answer and which need CI. Allow two kinds of
exception: judged by eye, allowed unasked, and physically unreachable - a native dialog, the
network, a second display - which must be named or it reads as a hidden gap.
**Under 400 words, one question at a time**, since four questions at once turn a drill into a
form. **No file names in anything the DM reads**; paths belong in the spec file.

### The whole process went public, and only specs, voice samples and memory stay private · `SETTLED` (2026-09-30)
The slash commands, `/commit`'s steps and scripts, this ledger and the backlog moved out of
gitignored folders into the repo, with every person reference removed. A cloud session clones the
public repo alone, so a private backlog and private commands meant no `/brief` or `/commit` from a
phone. A closed repo was ruled out: installed copies update from public releases, and a private
repo needs a token in every copy. Secrecy was also not what kept contributors in bounds; `main`
is protected, and nothing lands without the gate and the DM's yes.

### Habits moved out of memory into the repo · `SETTLED` (2026-09-30)
About thirty working habits lived only in Claude's memory notes, which a session loads as one-line
titles and recalls by chance. Each went to the file that owns its question: rules to `CLAUDE.md`,
product calls to `PRODUCT.md`, the process to `PROCESS.md`. Memory keeps the DM's profile and the
writing setup. A habit that keeps slipping gets a check, not a memory note.

### The release check refuses a second author · `SETTLED` (2026-09-30)
Cloud sessions committed as Claude with a co-author line, which put Claude in the repo's
contributor list, so `tools/check-release.js` refuses any commit whose author differs from
`main`'s latest, or that carries one. It compares against `main` so no address is written into a
public file. The repo settings also turn the co-author line off.

### The backlog sorts by release and category, not by effort and risk · `SETTLED` (2026-10-03)
The backlog serves prioritising, and the DM weighs size and risk only once an item is picked, so
items drop their effort and risk marks and `/brief`'s table drops those columns. Each item carries
a category (Prep, Play, Campaign, Polish, Upkeep, Bug, at most two) and a release, and the file is
grouped by release. Upkeep is split from Polish because it ships nothing the DM sees, so a triage
can skip it. The DM's first list called Polish "tech debt", which reads as invisible code work.

### `/commit` hands its mechanical steps to CI and `ship.js` · `SETTLED` (2026-10-07)
CI writes the What's new list before each build, so the amend after the commit and the help-and-
about red expected on every bump are gone; that scenario checks the installed mark only when the
running version is listed. CI runs `check-notes.js` on the version commit. `ship.js` picks the
branch from the version, refuses a HEAD without `origin/main`, and runs `check-release.js` before it
pushes. **Dropped:** `run.json` (a leftover `notes.txt` is the resume signal), the previous-release
report (the CI monitor wakes the session on red), the humanizer pass, and the merged-branch cleanup
of 2026-09-28, which a release does not need.

### CI writes the What's new list before the unit tests too · `SETTLED` (2026-10-07)
Moving the list's generation to build time left the suite's check that it opens with
`package.json`'s version running against the committed copy, which a bump commit no longer
updates, so every release would have gone red at its unit tests. The test and release workflows
now run `tools/build-changelog.js` on a full-history checkout before `npm test`. Locally the
check stays red on a bump until the release commit exists, as before.
