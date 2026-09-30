# Process

How work on Evermist gets done: who decides what, where every instruction lives, and the steps a
change takes from an idea to a release. Open this first in a new account, a new machine or a
cloud session.

This file is written in the **present tense** and describes the process as it runs. The rules
you must obey are in [CLAUDE.md](../CLAUDE.md); why a step has its shape is in
[DECISIONS.md](DECISIONS.md), the process's own reasons in
[decisions/process.md](decisions/process.md). `guard-process.js` refuses
a sentence about a person or a dated story here, because this file is public.

## Who does what

The split itself is in CLAUDE.md, "Who owns what". In practice:

- **The DM** answers questions about what the app looks like and does at the table, and nothing
  else.
- **Claude** decides every technical question, the rig, CI and the release pipeline included, and
  says in one line what it chose.
- **The one human gate is the DM's yes on a commit's notes.** Everything after it is automatic.

## Where everything lives

| What | Where | Who can see it |
|---|---|---|
| Rules | `CLAUDE.md`, folder `CLAUDE.md` files, `.claude/rules/`, `.claude/skills/` | Public |
| How the app works | `docs/ARCHITECTURE.md`, `docs/architecture/` | Public |
| Why it is shaped this way | `docs/DECISIONS.md`, `docs/decisions/` | Public |
| What the product is and is not | `docs/PRODUCT.md` | Public |
| This process | `docs/PROCESS.md` | Public |
| Guards | `.claude/hooks/` and `.claude/settings.json` | Public |
| Reply style | `.claude/output-styles/steering.md`, set in `.claude/settings.json`; `~/.claude/output-styles/` holds the copy other projects use | Public |
| Why the process has this shape | `docs/decisions/process.md` | Public |
| Slash commands | `.claude/commands/` | Public |
| `/commit`'s step rules and scripts | `.claude/commit/` | Public |
| What comes next | `docs/BACKLOG.md` | Public |
| Specs waiting to be built | `.claude/private/specs/` | Gitignored, this machine only |
| The `/voice` skill and its samples | `~/.claude/skills/voice/` | This machine only |
| The plain-language reminder | `~/.claude/hooks/plain-language.txt`, wired in `~/.claude/settings.json` | This machine only |
| Claude's memory | `~/.claude/projects/<this folder>/memory/` | This machine only |

**Everything public names nobody.** The DM is "the DM"; no name, address, chat quote, map name
or campaign detail appears in a tracked file, and the guards on the ledgers, the backlog and this
file refuse a person reference. Only specs, the voice samples and memory stay private. A cloud
session clones the public repo and runs the whole loop; a spec it needs travels in the chat.

**Memory holds only who the DM is and how the DM likes to be written to.** A habit worth keeping
becomes a rule in one of the public files above, where a check or a reader can find it.

### A new Claude account on this machine

1. Sign in and open the Evermist folder. The repo's rules, guards, skills and reply style load
   from the folder by themselves.
2. Run `gh auth status`. `gh` is authenticated to GitHub, not to Claude, so it keeps working.
3. The Code tab's CI monitor, cloud environments and published artifacts belong to the old
   account. Re-create what is still needed; nothing in the repo depends on them.

## The loop

1. **`/brief`** reads the backlog and the ledgers and recommends a session-sized chunk. It asks
   nothing and stops at the recommendation.
2. **`/spec`** drills the pick into a Definition of Ready and a Definition of Done in plain
   language, one question at a time, and writes a spec file.
3. **A fresh session builds it** from the spec file.
4. **`/commit`** gates the change, files what it settled into the docs, writes the notes, and
   pushes on the DM's yes.
5. **CI** gates, lands and releases it. See [The pipeline](#the-pipeline).
6. **`/rollback`** pulls a bad release. **`/redteam`** criticises a plan or a decision when a
   spec's trigger list calls for it or the DM asks.

A bug report is an ordinary message and needs no command.

## Building

- **Read the owning skill before editing its files.** `guard-skill-hint.js` names it.
- **Before look-and-feel work starts,** state what the result should look like and get the DM's
  agreement. The prototype rule is in CLAUDE.md.
- **Correctness work gets its check during the build.** A shipped behaviour needs a unit test or
  a rig scenario behind it, and Claude writes it without asking.
- **On this machine the rig runs once, at `/commit`, or when the DM asks.** A cloud session runs
  it freely. The rig skill carries how to write and run a scenario.
- **Never ask the DM to hand-verify, run a build, or open Chrome.** The DM runs `npm start` and
  the installed app and judges look, feel and speed.

## Shipping

- **The branch says what the change is.** `release/<version>` carries a version bump and changes
  the installed app. `change/<slug>` carries docs, tests, tooling or the rig, with no bump.
  Nobody pushes `main`. `tools/check-release.js` refuses a branch whose parts disagree.
- **The version commit's message is the public release note.** It is short and names what a DM
  can now do. It never names the DM, the DM's maps or campaign, a fixture, or an internal tool.
  `/commit` carries the full rules and `check-notes.js` enforces the mechanical ones.
- **A yes covers one push.** A follow-up that changes what ships needs a new yes.
- **Stage only the paths the notes describe.** A path nobody named is a path nobody reviewed.
- **Never merge the pull request.** The `land` job fast-forwards `main` to the gated commit, and
  the PR closes as merged by itself.
- **A red gate caused by the rig, a workflow or a guard is fixed and pushed back without
  asking**, then reported. A red gate that found a real app bug goes back through the notes and
  the DM's yes.
- **A red gate keeps the version number.** The fix amends the version commit and force-pushes
  the same branch.
- **A failure that comes and goes gets `probe.yml`**, one scenario in many parallel copies,
  never another full gate run. A CI-only failure is reproduced on this machine at the runner's
  window size first: `npm run rig -- <name> --dm-size 1008x681 --player-size 1024x768`.
- **Reading CI is free; starting a run is a push.** Read runs with `gh run view <id> --log`.
  Dispatching a workflow needs the same yes as a push.
- **`git tag --list` shows local tags only.** Ask the remote: `git ls-remote --tags origin`.
- **Rebuilding a published version** means deleting its release and tag first, because `decide`
  stops at an existing tag. The DM runs `gh release delete`.
- **The Mac build stays unsigned.** Never propose paying for signing or notarising.

## The pipeline

A push to `release/**` or `change/**` runs `.github/workflows/release.yml`:

1. **Decide.** Is there an untagged version? Did the rig change? Do the branch, the version and
   the files agree?
2. **Unit tests and guards**, side by side.
3. **The gate**, only for a new version or a rig change: Windows, Mac and Linux each build the
   installer, and the rig drives it through every scenario in four shards per platform.
4. **Update proofs**, only for a new version: each platform steps back to an older build and
   forward again through its Restart button.
5. **Land.** `main` fast-forwards to the gated commit.
6. **Publish**, only for a new version: a draft release takes each file with retries, every size
   is checked, and only then does the release go public and the tag appear.
7. **Clean up.** The staging branch is deleted.

A red step stops everything after it, so nothing public exists for a change that failed. The
Tests workflow runs the unit tests and guards on every push to any branch. `soak/**`, `probe/**`
and `platformrig/**` run rig experiments and ship nothing.

## Talking with the DM

The reply style in `.claude/output-styles/steering.md` governs every reply. On top of it:

- **Describe a change by what the DM sees at the table**, never by the file that does it. A
  function name, a file name or a raw percentage is never a headline, in a reply or in the backlog.
- **Ask only questions whose answers look different at the table.** When every option gives the
  same screen, pick one and say which.
- **Offer a recommendation with every option** so the DM can accept a batch in one word.
- **Report against the DM's Definition of Done by number** when asked where things stand.
- **Size honestly and correct a bad estimate out loud.**
- **When the DM says "I'm lost", cut scope** instead of explaining harder.
- **Hand over one visual change per build**, so the DM can keep the good half of a pair. A rig
  screenshot is Claude's evidence, never the thing the DM judges.
- **Public prose follows the DM's voice.** `/voice` rewrites a draft. The README speaks to a
  newcomer DM in plain instructions; commit notes stay flat.

## The backlog

- **An item belongs only if someone could pick it up and do it.** Nothing already decided,
  shipped or refused. A shipped item is deleted, not annotated.
- **The backlog never grows silently.** Claude lists what it would add or close in plain
  language, the DM strikes any, and only the rest is written. No task-suggestion chips.
- **Being in the backlog is not proof the DM wanted it.** When challenged, say whether an item
  came from the DM or from Claude.
- **No watch items.** A problem nobody reported is not work.

## What checks what

| Check | Runs | Enforces |
|---|---|---|
| Guard hooks in `.claude/hooks/` | On every edit in a Claude session | Doc size and shape, the inline script, comment share, repeated sentences, module size, skill hints, the screen |
| `tools/check-guards.js` | CI, every push | The blocking guards over the whole tree, whoever edited it |
| `npm test` | CI, every push; `/commit` | App logic, packaging, and the prose rules in `test/rules.test.js` |
| `tools/check-release.js` | CI, `decide` | Branch, version and release-title agreement |
| The rig | `/commit` locally; CI on three platforms | What the app does in both windows |
| `check-notes.js` | `/commit` | Release-note mechanics |
| `permissions.deny` in `.claude/settings.json` | Always | No Chrome browser tool |

Everything else in this file depends on being read. A habit that keeps slipping earns a check in
this table.
