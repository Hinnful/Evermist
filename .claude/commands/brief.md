---
description: Triage the backlog and recommend a session-sized chunk to build next (read-only, stops at the recommendation)
argument-hint: "[optional theme or constraint, e.g. 'UI only', 'quick wins', 'freeze-safe']"
allowed-tools: Read, Grep, Glob, Bash
---

# Mode: Backlog Triage & Session Pick

The user wants to look at the backlog and decide what to do next. Your job: read the backlog wherever it lives, present the **open** items grouped and risk-scored, and recommend a tightly-scoped chunk worth picking up right now. The user picks in their own words.

**This command STOPS at the recommendation.** It does NOT drill the pick or write a spec. `/spec` is a separate step the user runs manually - do not auto-run it, do not treat it as "the next step," do not nudge toward it beyond a single closing line.

**No questions here either.** Triage answers *what is worth a session*, and drilling an idea makes picking slow. The one thing this command owes the user about readiness is the `Spec` column in the table below: whether an item is settled enough to build, or needs `/spec` first.

You do NOT write code or change anything in this mode. Planning only, read-mostly.

## How to write it

Every word of this output goes to the user, so the active output style and the
plain-language reminder apply to all of it. State the claim. Do not build toward a
phrase. One idea per sentence, plainest word available, same name for the same thing
throughout.

No coined shorthand and no metaphor standing in for a fact. When an item is risky,
say what breaks and what it costs, not what the code resembles. File paths, identifiers
and quoted backlog text keep their exact wording.

## Optional steering input

Anything the user wants to narrow with - a theme ("UI only", "quick wins"), a constraint ("nothing that needs a new build", "freeze-safe only"), or a target size: $ARGUMENTS

## Step 1 - Find the backlog

The canonical backlog is `docs/BACKLOG.md` in this repo. Read it in full. Then check for items that live elsewhere and may not be in it:
- `CLAUDE.md` - rules sometimes carry a "not yet addressed" line.
- **`CLAUDE.md` is no longer the whole rulebook.** Conditional rules live in `.claude/skills/*/SKILL.md` and in child `CLAUDE.md` files under subfolders, and they carry the same kind of "still open" and "don't do this yet" lines. Read them too, or an item looks unconstrained when it isn't.
- Repo planning docs (e.g. a `*_approaches.md`) - research-heavy items often sit there.

**Read the two ledgers as a filter, not as a source of items.** `docs/DECISIONS.md` records what was already tried, rejected or reverted. `docs/PRODUCT.md` records what the app deliberately will never do, and a scope call kills a candidate just as hard as a failed attempt. Recommending something already killed is the single most expensive mistake this command can make, because it looks like a fresh idea and burns a session before anyone remembers why it was dropped.

A third ledger, `docs/decisions/process.md`, covers the slash commands themselves. Read it only when the pick is about the workflow rather than the app.

Read enough to know each item's **real status**, not just its title.

## Step 2 - Filter to what's actually open

The backlog mixes finished and live work. Present **only open items** as actionable. Treat status markers as the filter - skip anything flagged `✅ DONE`, `DEPRECATED`, `REVERTED`, or closed. `SHELVED` items are open but parked - include them, flagged as such.

Be skeptical of staleness: the backlog itself warns that items may need re-testing and that line numbers drift. If an item looks like it might already be handled (e.g. it references a fix that later commits seem to cover), say so rather than presenting it with false confidence. If a borderline candidate is quick to spot-check against the code, do it - but don't go deep. This is planning, not implementation.

**Cross-check every candidate against both ledgers before it reaches the list.** If it was rejected or reverted in `DECISIONS.md`, or ruled out of scope in `PRODUCT.md`, it is not an open item - drop it. If a *variant* of it was rejected, you may still present it, but say which variant died and why, so the user judges it with that in hand rather than re-approving something that already failed.

## Step 3 - Open with the full inventory, before anything else

**The first thing the user sees is the whole backlog in one table.** Not a summary, not the
recommendation, not the highlights. They cannot judge what to spend a session on until they can
see everything that is waiting.

Lead with a count line in this shape:

> **N open items.** IDs run to M; numbers are never reused, so M is not a count.

**Item IDs are arbitrary and permanent.** A deleted item's number is retired, never reassigned,
so the highest ID is always larger than the number of open items. Say the real count explicitly
every time. Never let the user infer backlog size from an ID.

Then one table, every open item, one row each, no omissions:

| # | Item | Area | Effort | Risk | Spec | State |
|---|------|------|--------|------|------|-------|

- **#** - the backlog's own ID.
- **Item** - a short phrase in plain language, not the backlog's heading verbatim if that heading
  is jargon.
- **Area** - DM, Player, both, rig, or process. "Rig" and "process" mean nothing ships.
- **Effort** - ½ / 1 / 1+ sitting, or `?` when it is genuinely unknown.
- **Risk** - L / M / H.
- **Spec** - whether the idea is settled enough to hand to a build session. `ready` when the
  item already says what to build and every open call in it has an answer. `needed` when a
  choice is still open - a shape to settle, a scope question, a look-and-feel call. `needed`
  means run `/spec` on it before building, and it is the normal answer for anything larger
  than a small fix.
- **State** - blank when ready to pick up. Otherwise the one word that stops it: `blocked`,
  `needs-a-call`, `parked`, `discussion`, `lead-only`.

Sort the table by group, in the same order the detail below uses, so the two read together.

**Every open item appears in this table.** An item you judge unimportant still gets its row. The
table is the inventory; the recommendation is your opinion, and the user must be able to see the
first without your filter on it.

## Step 4 - Analyze, score, group

After the table, expand the same items **grouped by theme or implementation logic** - e.g. correctness/anti-spoiler, performance, identity/UI, marquee feature, quick wins. Lead each group with its highest-value item.

**The detail covers every row in the table.** Items you would not recommend get a line or two rather than a paragraph, but none disappears between the table and the detail.

For each item give, kept skimmable:
- **What it is** - plain language. The user is a non-dev PM: high-level first, code/file refs as footnotes.
- **Where it shows** - DM view, Player view, or both.
- **Effort** - rough (½ / 1 / 1+ sitting). Fuzzy is fine and expected.
- **Risk** - low / med / high (regression risk, how much other behaviour depends on the touched code). A file governed by a skill has many dependents by definition, which is why its rules were worth extracting.
- **Blockers** - anything that must happen first (e.g. "needs your clarification on desired behavior", "blocked until per-scene storage exists").

Reuse the backlog's own effort/risk annotations as a starting point, but re-judge them - they can be stale.

## Step 5 - Recommend a pick

Recommend a chunk sized to roughly **one session, or even one chat**. Sizing is deliberately fuzzy - aim small enough to finish *and verify* in a single sitting. Prefer items that:
- group naturally (same area, same file, same de-blob trigger) so the work compounds,
- are unblocked,
- respect any agreed roadmap order in the backlog (if you deviate, say why),
- honor freeze/constraint notes (don't recommend ship-gated work while a freeze is on).

Give a **primary recommendation** with a one-line why, plus a **backup pick for a different mood** (e.g. "if you'd rather do visible work than plumbing"). Two or three options total is plenty - don't hide the recommendation under ten.

## Then stop

Present it as a readable list and let the user pick freely in their own words - do NOT force a structured selector (they prefer choosing conversationally). One closing line may note that `/spec` is available for any item marked `needed`, then end.
