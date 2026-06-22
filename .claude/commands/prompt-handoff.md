# Mode: Session Handoff Prompt Crafter

You are helping the DM craft a handoff prompt for the NEXT Claude Code session. This prompt must be self-contained — the next session starts fresh with no memory of previous work.

## Initial input

The user's initial description: $ARGUMENTS

## Gather info

Based on the initial description, ask follow-up questions **in a single batch** (not one by one). Only ask what's missing — skip questions already covered. Typical gaps:

- **Project context** — 1-2 sentence summary of the app/feature area. (If it's Foggy Dungeon, you likely know this already — confirm rather than re-ask.)
- **What's the goal for next session** — what feature, fix, or chunk of work should CC tackle?
- **Scope boundaries** — what's IN scope vs explicitly OUT of scope? What should CC NOT build or touch?
- **Data model / technical details** — any specific structures, formats, or patterns CC needs to follow? (Only ask if the task involves new data or architecture.)
- **Key workflows** — are there user-facing flows CC needs to understand to build this right?
- **Testing / acceptance** — how will the DM verify it works? Specific scenarios to check?
- **Landmines** — anything CC tends to get wrong, forget, or over-engineer on this kind of task?

Handoffs vary a lot in complexity. A small bug fix needs 2-3 of these. A major feature like the scene management system needs most of them. Match your questions to the scale of the task.

## Output format

When you have enough info, produce the final prompt inside a code block. Scale the sections to the task — don't force a massive template onto a small job.

For **larger features**, use this structure:

```
## [Feature/Task Name]

### Context
[1-3 sentences: what the app is, what area we're working in. Enough for a fresh session to orient.]

Read CLAUDE.md for full architecture. [Add any other files CC should read first, e.g. "Review sceneStore.js for the current storage pattern."]

[If the feature is substantial:] Use /plan before coding.

### What we're building
[Clear description of the deliverable. Include data models, UI changes, and workflow descriptions as needed. Be specific — CC should not have to guess intent.]

### What NOT to build
[Explicit exclusions. Things CC might assume are in scope but aren't.]

### Instructions
Work through this step by step. After completing each task, stop and report what you did and what's next. Do not implement everything in one go.

[Numbered task list, ordered by implementation sequence. Group related work but keep steps small enough that each one completes in a few minutes.]

Keep me updated as you work — don't go silent for long stretches.

### Testing
[Checklist of scenarios to verify. Include both happy path and edge cases.]
```

For **smaller tasks** (bug fix, minor feature), trim to:

```
## [Task Name]

### Context
[1-2 sentences + CLAUDE.md reference]

### Task
[What to do, with enough detail to avoid ambiguity]

### Instructions
[Same step-by-step + report pattern, just fewer steps]

### Testing
[Key scenarios to verify]
```

After outputting the prompt, ask: "Want me to adjust anything, or is this good to go?"
