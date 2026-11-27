# Process

How work on Evermist gets done. Loaded into every session and every agent, with `CLAUDE.md`; a test keeps
each under 200 lines. Present tense, public, and naming nobody. Why the process has this shape:
[docs/decisions/process.md](../../docs/decisions/process.md).

## Who decides

- **The DM owns the product**: vision, ideas, steering, feedback, and whether the app is worth it. The DM
  answers only questions about what the app looks like and does at the table.
- **Claude owns whether it works**: every technical question, the rig, CI and the release pipeline included.
  Claude decides, says in one line what it chose, and never waits for approval on those.
- **The one human gate is the DM's yes on a release's notes.** Everything after it is automatic.
- **A rename of anything the DM sees, CI job names included, waits for the DM's yes.**

## Which document, and when

| When | Read | What it holds |
|---|---|---|
| Every session | `CLAUDE.md`, this file | Tech constraints and bans; how we work |
| Editing a file | its folder `CLAUDE.md`, `.claude/rules/` with `paths`, the skill `guard-skill-hint.js` names | That area's rules |
| A step of `/commit`, `/spec`, `/brief` | the step's own file | How to do that step |
| Designing UI, studying rivals | the `mockup` or `research` skill | Boards, studies |
| Before deciding, or re-proposing, anything in a topic | that topic's file in `docs/decisions/` (list: `docs/DECISIONS.md`) | What was settled, tried and rejected |
| Changing or diagnosing a subsystem | its file in `docs/architecture/` (list: `docs/ARCHITECTURE.md`) | How it works now |
| A scope call, or text a user reads | `docs/PRODUCT.md` | What Evermist is and will never be |
| `/brief`, `/commit` | `docs/BACKLOG.md` | What comes next |

- **Everything tracked is public and names nobody.** The DM is "the DM": no name, chat quote, map or campaign
  detail. Specs (`.claude/private/specs/`), the `/voice` samples and Claude's memory stay on this machine.
- **Memory holds who the DM is, how to write to the DM, and links to boards and studies.** A working habit
  becomes a rule in a tracked file, where every session and a check can find it.
- **A habit that keeps slipping earns a hook or a test**, never another paragraph.

## The loop

1. **`/brief`** reads the backlog and the ledgers and recommends a session-sized chunk. It stops there.
2. **`/spec`** drills the pick into a Definition of Ready and a Definition of Done, one question at a time, and
   writes a spec file. Every item gets one; each DoD line reads what the DM does → what the DM sees.
3. **On "build it", the `builder` agent builds it** and the main session checks the result. "Build it here"
   keeps the build in the main session.
4. **`/commit`** gates the change, files what it settled, writes the notes and pushes on the DM's yes.
5. **CI** gates, lands and releases it (`docs/architecture/releases.md`).
6. **`/rollback`** pulls a bad release. **`/redteam`** runs only when the DM asks; a spec says whether to.

A bug report is an ordinary message. A brainstorm ends at the proposal and an analysis at the answer: no tests,
rig runs or commits. Studies follow the `research` skill; UI options and new UI, the `mockup` skill.

## Building

- **The main session keeps diagnosis, design and release notes.** `scout` (Sonnet) searches code and reads CI
  logs; `builder` (Opus) builds a spec or a fix whose cause is known; `filer` (Sonnet) runs `/commit` Step 4.
- **A builder starts from a brief with `Cause:`, `Change:`, `Done-check:` and `Accept:`**, and on Opus unless a
  `Mechanical:` field says why no judgment is needed (`guard-builder.js`). It gets two rig runs, then stops and
  reports; one rig run goes at a time (`guard-rig.js`).
- **Check the ledger before re-proposing an idea or restoring removed code.**
- **A feature that replaces another keeps everything the old one did**, unless the DM drops it.
- **Prove a fix both ways**: the check fails without the fix and passes with it. **A check that flakes is
  suspect first.** **When a fix fails, say so and re-diagnose** from the evidence, one approach at a time.
- **A bug found during the work is fixed and ships in the same release**, never filed. A commit holds only
  finished work; the backlog gets only work that waits on the DM's own design call.
- **While the DM tests a build and sends findings, each round ends with what changed and what was checked.**
  No notes, `/commit` or push offer until the DM asks to commit.

## Proving it works

- **The rig is the UI test, and a DoD line is proven only by doing what it says.** The rig clicks, types,
  drags and presses keys with real CDP input and asserts what the DM would see. Reading state or an attribute,
  a JS `.click()` or a synthetic event proves nothing. A part the rig cannot reach (an OS tooltip, a native
  dialog) is named exactly and everything around it is checked.
- **Every DoD line is marked in the spec** after the main session re-checks it against the builder's report:
  `[rig: <scenario> "<check>"]`, `[unit: <test>]`, `[eye]` or `[unreachable: <what>; around: <check>]`. A
  reachable line is never reported unchecked. `ship.js --accept <spec>` refuses an unmarked line.
- **A fix's scenario runs once and is deleted.** Only `blockers/`, `design-sweep` and `record.js` stay.
- **On this machine the rig is a probe, never a gate.** `/commit` runs unit tests, lint and the guards; the
  release gate runs the blocker set on three platforms. The DM may ask for `blockers` at low priority.
- **A change to the interface is done when `test/designSystem.test.js` passes and `design-sweep` is clean.**
  CI runs the sweep on interface changes, as a trial that warns. An audit walks `tools/rig/inventory.js`, never
  a sample; its close-ups go to a fresh reviewer with only `design-system.md`; its report opens with what it did
  not check; a finding the DM makes afterwards gets a line in `docs/decisions/audit-misses.md`.
- **Never ask the DM to hand-verify, run a build, or open Chrome.** Look, feel and speed are the DM's;
  correctness is Claude's. Backup, export and restore are the exception: their save dialog is native.

## Showing the DM

- **A change to a look the DM already picked is shown before it stays:** "I propose this" and a picture, a
  board or a screenshot of the build, then the DM's yes. A defect the DM named is fixed first and shown the
  same way. New UI goes to a mockup board. One visual change per build.
- **A board of an existing window loads the app's stylesheets and code**; the proposal is overrides on top.
- **Describe a change by what the DM sees at the table**, never by a file, function or raw number.
- **Ask only questions whose answers look different at the table**, each with a recommendation. Every question
  goes in the message; `wrap_up` carries a recap only.
- **Report against the DoD by number** when asked where things stand. **Size honestly** and correct a bad
  estimate out loud. **When the DM says "I'm lost", cut scope.**
- **Public prose follows the DM's voice.** `/voice` rewrites a draft; commit notes stay flat.

## Shipping

- **Every edit ships, from main or from a branch.** A branch or worktree carries parallel work and goes out
  through `/commit`; a stash is refused (`guard-stash.js`). Stage only the paths the notes describe, and ship
  every edit of your own. `session-status.js` names every branch and worktree holding unlanded work.
- **A shipping commit is a release, and its message is the public release note.** `/commit` carries the
  rules; `check-notes.js` enforces the mechanical ones.
- **Push to `release/<version>` or `change/<slug>`, never to `main`.** A version bump means "release this":
  only when a change touches `build.files`. Patch for normal changes, minor for a notable feature, major for
  a breaking overhaul. Docs, tests, tooling and the rig take `change/**` and no bump.
- **A yes covers one push.** A follow-up that changes what ships needs a new yes.
- **Never merge the pull request, and never tag or publish by hand.** The `land` job fast-forwards `main` to
  the gated commit; the workflow tags and publishes (`guard-ship.js`).
- **While another release or change is in CI, `ship.js` waits**, then catches up with main and renumbers.
- **A red gate keeps its version number**: the fix amends the version commit. A red caused by the rig, a
  workflow, a guard or a stale test is fixed and pushed back with no message; the DM hears when the release
  lands, and again only for a real app bug. A test edited to turn a run green is disclosed in the report.
- **A job that ran and failed is a red, never rerun.** Only a job GitHub never gave a machine is rerun, at most
  twice per run (`guard-ship.js`).
- **A blocking check that fails while the app works is rewritten or deleted the same day, never loosened.**
- **Reading CI is free; starting a run is a push**, and needs the same yes.
- **To pull a bad release: `/rollback`.** A `git revert` does not undo one.
- **The Mac build stays unsigned.** Never propose paying for signing or notarising.

## The backlog

- **An item belongs only if someone could pick it up and do it.** A shipped item is deleted, not annotated.
- **The backlog never grows silently.** Claude lists what it would add or close; the DM strikes any; only the
  rest is written. No watch items: a problem nobody reported is not work.
- **When challenged, say whether an item came from the DM or from Claude.**
