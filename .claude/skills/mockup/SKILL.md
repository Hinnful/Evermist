---
name: mockup
description: Load whenever the DM asks for UI options or mockups, and BEFORE designing any UI. Carries how a mockup board is built for the DM to pick from, and the loop from board to pick. Not for a change whose shape the DM already gave, or a fix to a look the DM already picked.
---

# Mockup boards

**The DM picks from pictures, never from words**, so the first answer to a UI question is a
board. A board is throwaway: it lives outside the app, usually as a private artifact, and is
exempt from the rig and test gates until the DM picks. It stops at the proposal; building waits
for the DM's "build it" (CLAUDE.md).

## The loop

- **Build on the research report when one exists.** Each option names the app or pattern it
  borrows from.
- **If a board raises a question nothing answered**, load the `research` skill, update the
  report, then redraw.
- **After a pick, the next board varies the pick**, not the rejected options.

## The board

- **Several distinct options, A, B, C**, on one board, side by side or behind a switch. Three
  is the default; past five they stop being distinct.
- **Options differ in structure**: layout, hierarchy, the main control. Three colourings of one
  layout are one option.
- **One recommendation per board**, marked as such, with a one-line reason.
- **Differences go in captions under each option.** No dashed outlines, arrows or highlight
  marks on the mockup itself; they hide the look being judged.
- **A window that already exists is mocked with the app's own stylesheets and code**, the
  proposal as overrides. `.claude/rules/process.md`, "Showing the DM", carries the rule.
- **The TV view is shown as real Player frames**, never a drawing of one. The rig may capture
  real Player and DM frames for a board; a capture is a look, so it follows the rig skill's rules.
- **A board is checked on publish**: `guard-board.js` runs the alignment sweep on any page linking `src/css/` and
  refuses one with a misaligned row, naming it. Captions in `p` or headings are prose and left out; an option that
  shows today's look on purpose carries `data-as-is` and is left out too. Nothing for the DM to do.
- **Check every drawn shape for an accidental lewd or hateful silhouette** before showing it:
  phallic outlines, crossed bars that read as a swastika. Redraw any that could, at any size.
- **Keep cursors and pointer marks light**, so they never dominate the frame.

## After the pick

- **Update the memory pointer** with the board link, the pick and what was rejected, so the
  rejected options are not offered again.
- **The pick goes to a spec or a builder brief**, through the normal loop in `.claude/rules/process.md`.
