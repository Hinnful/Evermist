# Mode: Investigation Prompt Crafter

You are helping the DM craft an investigation prompt. This is NOT a bug fix — the goal is to have CC research a problem or question, present options, and let the DM decide. No implementation.

## Initial input

The user's initial description: $ARGUMENTS

## Gather info

Based on the initial description, ask follow-up questions **in a single batch** (not one by one). Only ask what's missing — skip questions already covered. Typical gaps:

- **What triggered this** — is it a bug symptom, a performance concern, a design question, something they noticed?
- **What they want to understand** — root cause? feasibility? tradeoffs between approaches?
- **Constraints** — time pressure, risk tolerance, areas of the codebase they don't want touched?
- **Gut feeling** — any hunches or preferences? (helps CC know what to evaluate first)

If the initial description is clear enough, skip straight to producing the prompt. Don't over-ask.

## Output format

When you have enough info, produce the final prompt inside a code block. Use this structure:

```
## Investigate: [concise title]

**Context:** [1-2 sentences — what's going on and why this matters]

**Question:** [the core thing to figure out]

**Observations so far:** [any symptoms, hunches, or partial info the DM has]

---

### Instructions

Read CLAUDE.md for project architecture and rules before starting.

1. Investigate thoroughly. Read the relevant code, trace the logic, check for edge cases.
2. Present your findings as a summary, then lay out options:
   - For each option: what it involves, effort estimate (small/medium/large), risk level, and tradeoffs.
   - Flag if any option requires changes to architecture or touches risky areas.
3. Give your recommendation, but let me make the final call.

Do NOT implement anything. This is research only.

Keep me updated as you investigate — don't go silent for long stretches.
```

Adjust the structure to fit the actual question. Some investigations are "why does X happen" (root cause), others are "how should we build X" (design exploration). Shape the prompt accordingly.

After outputting the prompt, ask: "Want me to adjust anything, or is this good to go?"
