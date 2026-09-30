---
description: Adversarial critique of a plan, spec, or decision via an independent reviewer - every claim defaults to FAIL until evidence says otherwise
argument-hint: "[plan|spec|diff|<path>]  (optional - auto-detects if omitted)"
allowed-tools: Agent, Read, Grep, Glob, Bash
---

# Red Team

Critique a **plan, spec, or decision** before it gets built. Code diffs are supported but are the secondary case - for a diff, the built-in `/code-review` covers correctness better, and this command's value is on the reasoning that produced the diff.

**The rule that gives this teeth: an unverified claim defaults to FAIL.** Not "assume the work is flawed" - that produces combative output, not sharper output. The bar is evidence. A plan that says a function exists, a path is safe, or a change was verified must be checkable, and anything that isn't checkable fails on that ground alone.

Target from `$ARGUMENTS` (`plan`, `spec`, `diff`, or a file path). If empty, infer: a design, plan or spec document → plan mode; code changes → diff mode. A bare `spec` means the newest file in `.claude/private/specs/`. **Default to plan mode when unclear** - that is what this command is for.

## Step 0 - Independence gate (the rule that makes this real, not theater)

**If you wrote or shaped the target in THIS conversation, you MUST dispatch an independent subagent via the Agent tool.** A model critiquing its own work in the same context rationalizes instead of scrutinizing. A plan reviewed by the mind that wrote it inherits that mind's blind spots.

**Give the reviewer the ARTIFACT, not the ARGUMENT for it.** Pass the target file/text and the codebase. Never pass your reasoning for why it's good, never pass the conversation that produced it. The moment your justification leaks in, this is biased self-review wearing a costume.

```
Agent({
  subagent_type: "general-purpose",
  description: "Independent red-team critique",
  prompt: `You are an adversarial reviewer with NO stake in this work and NO knowledge of why it was written. You have not seen the conversation that produced it.

Target to critique: TARGET

Read CLAUDE.md first for the project's rules, then docs/DECISIONS.md for what has already been tried, rejected, reverted or parked, and docs/PRODUCT.md for what the app deliberately will never do. Then read the target. Verify every claim against the actual codebase with Read/Grep/Glob/Bash, and run the project's own test command if one exists.

CRITERIA_BLOCK

Work the criteria, then run the verification pass and the output rules below.`
})
```

Let the subagent inherit the session model - do not pin one.

**Run inline (no subagent) ONLY** when critiquing work you did NOT write here. If the Agent tool is unavailable, run inline but prepend: `WARNING: Self-critique - author bias may be present.`

## Step 1 - Context gate

Confirm you can actually judge this: have you read the target and the files it names? Do you know the repo well enough to spot a violated convention? If not, STOP and emit a `CONTEXT INSUFFICIENT` block listing what's missing. A confident critique on thin context is worse than none - it manufactures false confidence.

## Step 2 - Read the standards, then steel-man

1. Read `CLAUDE.md` (the rules), `docs/DECISIONS.md` (what is already settled, rejected or parked) and `docs/PRODUCT.md` (what is out of scope by design). In another repo, substitute its equivalents.
2. Grep for the dominant pattern around what's being changed. If several places do it one way and this work bypasses that, it fails even if no document says so.
3. **State the strongest version of the plan in one or two sentences before attacking it.** This is not politeness. It stops you critiquing a weaker plan than the one on the page, which is the most common way a critique wastes everyone's time.

## Step 3 - Work the criteria

Mark each **PASS** (with evidence), **FAIL** (with a location and a mandatory `Fix:`), or **N/A** (does not apply here, one clause of why).

**N/A is not a PASS.** Never convert an inapplicable criterion into a pass to make the list look complete - that inflates the result and is how a critic ends up reassuring instead of checking. N/A rows are excluded from every count.

### Criteria

```
Premise:        problem-real · no-reopened-decision · assumption-named
Coverage:       req-coverage · no-placeholders · edge-cases
Verifiability:  verification-named · claim-measured · references-verified · real-input-verified
Ship safety:    packaging-verified · rollback-complete · landmine-clear · untrusted-file-safe
Fit:            boundaries-respected · no-overengineering · ordering-correct
```

**Premise** - the part a plan critic is uniquely for.
- `problem-real` - does this solve the problem that was actually reported, or a restatement of it? A plan that solves an adjacent, tidier problem fails here. If the report was terse, the honest finding is "the problem statement is thin, ask before building", not a guess dressed as a diagnosis.
- `no-reopened-decision` - does this resurrect anything marked REJECTED, REVERTED or PARKED in `docs/DECISIONS.md`, or cross a line drawn in `docs/PRODUCT.md`? If it revives a *variant*, say which variant died and why, so the call is made with that in hand.
- `assumption-named` - is each assumption the plan depends on stated as an assumption, or smuggled in as fact? An assumption named is cheap; one buried in a step costs the session when it's wrong.

**Coverage**
- `req-coverage` - everything asked for is addressed, and nothing extra is smuggled in.
- `no-placeholders` - no "TBD", no "decide during the build", no step whose content is a promise.
- `edge-cases` - the shapes that actually bite here: real-world data (mixed alphabets, unexpected encodings, page furniture), oversized input, empty input, and the first run where nothing is saved yet.

**Verifiability** - the group that carries the most weight in this repo.
- `verification-named` - the plan says how anyone will know it worked, chosen from the three that exist: `npm test` against a pure module, a **built** `.exe` exercised by hand, or the user's own eyes at the screen. "Verify it works" is a FAIL. Naming which one, and what result counts as success, is the pass.
- `claim-measured` - every "verified", "confirmed", "measured" or "tested" carries a number, a command, or a file behind it. A restated claim is a FAIL. Watch for measurement methods the repo has already ruled worthless, such as comparing CPU across separate runs on this machine.
- `references-verified` - every file, function, module and line reference named in the plan exists and does what the plan says. Line numbers drift; grep, don't trust.
- `real-input-verified` - if this tunes a parser or a threshold, is it checked against real data? Synthetic fixtures prove only the shapes already known, and they have validated a wrong parser here before. N/A when nothing is being tuned.

**Ship safety** - each of these is a class of failure this repo has actually paid for.
- `packaging-verified` - does this touch `build.files`, add or change a runtime dependency, or load anything at runtime? Then a **built** artifact has to be exercised, because `npm start` cannot see this class of bug and the packaged app fails silently. A new dependency also carries asar and build-filter cost; the bar on adding one is high, not low.
- `rollback-complete` - does this write a new shape into persistent storage or an exported backup? Then reverting the code is not a rollback, and the plan needs a data sweep that fails **closed** (toward hidden, never toward revealed).
- `landmine-clear` - does this touch the display-critical path, allocate per frame or per scene, or go near anything documented as a landmine? Name the risk and the measurement, or fail.
- `untrusted-file-safe` - does content from a user-supplied file (PDF, txt, zip, video, image) reach a parser, the DOM via `innerHTML`, or a privileged process? That is this app's only real attack surface and it is live.

**Fit**
- `boundaries-respected` - module ownership per the project's own map, no feature logic in wiring-only files, shared state in its one home, and no crossing a line the project has explicitly refused to cross.
- `no-overengineering` - YAGNI. **The sharpest tell: is a mechanism generating its own guards?** A debounce plus a zero-value check plus a re-entrancy flag around one listener means the listener is the wrong mechanism, not that it needs three guards.
- `ordering-correct` - no step depends on a later one, and if a new file is added it is wired in at the position where its declarations precede their use.

**Diff mode adds three rows:** `tests-pass`, `no-dead-code`, `error-handling`. Everything above still applies to a diff.

## Step 4 - Verification pass (do not skip - this is what makes the output trustworthy)

Before anything is reported, take each candidate FAIL and try to kill it. Re-read the code it accuses. Ask what would have to be true for the plan to be right, then check whether it is.

Each candidate ends up in exactly one bucket:

- **FAIL** - anchored in evidence you can point at: a `file:line`, a named rule, a quoted line of the plan. A claim about how the code behaves needs a citation in the source, never an inference from a name.
- **QUESTION** - a real doubt you could not anchor. Report it as a question, never as a finding. This is the honest home for "this looks wrong but I could not confirm it."
- **DISCARD** - below the bar. Do not report it, do not mention it, do not count it. Style preferences, restatements of the plan, and anything you would not spend the user's time on go here.

**Surface at most five FAILs.** If there are more, report the five that matter and give a count for the rest. A blocker buried in a list of twelve equals gets read as one of twelve.

## Output format

```
RED TEAM - [target]

Strongest version: [one or two sentences]

  Premise:
    problem-real ............ PASS - [evidence]
    no-reopened-decision .... FAIL - [what it reopens, where]
                              Fix: [concrete]
    assumption-named ........ N/A - [one clause]
  [... remaining groups ...]

Verdict: [BLOCKED - n must-fix] | [PROCEED WITH CHANGES - n fixes] | [APPROVED]
[If FAILs were capped: "plus n lower-severity fails not listed."]

Questions (unanchored doubts, not findings):
• [question]

Unverified:
• [MANDATORY - at least one thing you did NOT check, and why]
```

No pass ratio, no score, no percentage. A count of real problems is information; a fraction reads as a grade and the grade is always flattering.

`APPROVED` is a legitimate outcome and should be used when it's true. Say it plainly and stop.

## Rules

- Be genuinely critical, not performatively critical. Every point anchored in evidence.
- **Do not manufacture problems to look thorough.** A run that finds nothing real and says so is a success. Padding the list to justify the invocation is the main way this command loses its value.
- Distinguish "this is wrong" from "I don't have enough to tell." The second is a Question. Collapsing it into the first is the failure mode that costs the most trust.
- If anything FAILS, end by offering to fix it and re-run. For a plan, "fix" means amending the plan, not building it.
- This command does not write logs into the repo and does not touch git.

## The report is not the deliverable - your summary is

The block above is a working artifact. The user does not read it, and the reviewer's
prose is not written for the DM. Do not style the subagent's prompt for readability and
do not ask the user to read the report.

**After the report, always give the user three to five plain-language lines**, under
the talking rules that govern every other reply:

- What the review changed about the target, in terms of the work rather than the
  criteria. Name the thing that would have gone wrong.
- Any FAIL you disagree with, and why. An independent reviewer with no context can be
  confidently wrong, and folding a bad finding in silently is worse than the finding.
- Any QUESTION that needs the DM's intent rather than the codebase. That is the only part
  the DM can answer.

Then offer the fix and re-run, as the rules above require. If the verdict is
`APPROVED`, say so in one line and stop - do not restate the criteria that passed.
