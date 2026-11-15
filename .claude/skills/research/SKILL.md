---
name: research
description: Load BEFORE designing any UX or UI change, before a scope or product call, and whenever the DM asks to research something, to see how other apps solve a problem, to compare competitors, or to see options or mockups. Carries how a study is run and reported, and how a mockup board is built for the DM to pick from. Not for a bug fix or a change whose shape the DM already gave.
---

# Research and mockup boards

Two steps, in this order. **Research** answers how others solve the problem and ends in one
recommendation. **A mockup board** follows only when the job is UI or UX, and shows the DM
several options to pick from. Both stop at the proposal; building waits for the DM's "build it"
(CLAUDE.md).

## When to skip

- **A bug fix needs no research.** Diagnose it and fix it.
- **A change whose shape the DM already gave needs no research and no board.** Build that shape.
- **A technical question with one obvious answer in the official docs** is a lookup, not a study.

## Research

### Before searching

- **Reuse earlier studies first.** Memory holds links to past research artifacts; read the ones
  on this topic with the Artifact tool and extend them. Search again only for what they lack.
- **Check the ledgers.** `docs/DECISIONS.md`, `docs/decisions/` and `docs/PRODUCT.md` hold settled
  calls; a study never reopens one without saying which entry it challenges and why.
- **Write the question in one line** and the decision it feeds. A study with no decision behind
  it is not started.

### Sources

- **Primary sources only**: the app itself, its official docs, its changelog, its store page,
  its source code, a video of it in use. A blog post about an app is a pointer to the app, not a
  finding.
- **Every claim carries a link to where it was seen.** A claim nobody opened is not reported,
  however likely it sounds.
- **Separate what was verified from what is inferred.** "Verified" means opened and seen; label
  everything else as inference.
- **Say plainly where nothing good was found.** "No source shows how X handles Y" is a finding;
  a guess filling the gap is not.
- **Flag sources that disagree** instead of picking one silently.
- **Reddit refuses web fetch.** It opens only in the DM's own Chrome through Claude in Chrome,
  which needs the DM's go-ahead; without it, list the threads as unread.

### Running it

- **Run independent searches in parallel subagents**, one axis each: one competitor, one
  pattern, one technical practice. The brief names the question, the axis, the sources to open,
  and asks for every claim with its link and a verified or inferred mark.
- **Keep each brief narrow.** A subagent handed the whole question returns a survey; one handed
  one app returns evidence.
- **Read what comes back critically.** A subagent's confident claim with no link is dropped.

### Reporting

- **Results go to a private claude.ai artifact, never a tracked file.** The repo is public, and a
  study names other products, prices and people's posts.
- **Save a pointer in memory**: the artifact link, the question, the date and the open
  candidates, so the next study starts from it.
- **The artifact shows the evidence before the verdict**: per app or pattern, what it does, with
  links and screenshots where they help; then what holds across them; then the gaps.
- **It ends in one recommendation and stops there.** Name what to adopt, what to skip and why,
  in terms the DM sees at the table. No tests, rig runs, specs or code follow from a study alone.
- **Describe options by what the DM sees**, never by the file that would change (PROCESS.md,
  "Talking with the DM").

## Mockup board (UI and UX only)

A board is throwaway. It lives outside the app, usually as a private artifact, and is exempt
from the rig and test gates until the DM picks (CLAUDE.md).

### Before drawing

- **Describe the target look in words and get the DM's agreement before polishing.** A board
  built on a misread goal is thrown away whole.
- **Build on the research.** Each option names the app or pattern it borrows from.

### The board

- **Several distinct options, A, B, C**, on one board, side by side or behind a switch. Three
  is the default; past five they stop being distinct.
- **Options differ in structure**: layout, hierarchy, the main control. Three colourings of one
  layout are one option.
- **One recommendation per board**, marked as such, with a one-line reason.
- **Differences go in captions under each option.** No dashed outlines, arrows or highlight
  marks on the mockup itself; they hide the look being judged.
- **A window that already exists is mocked with the app's own stylesheets and code**, the
  proposal as overrides. PROCESS.md, "Building", carries the rule.
- **The TV view is shown as real Player frames**, never a drawing of one. The rig may capture
  real Player and DM frames for a board; a capture is a look, so it follows the rig skill's rules.
- **Check every drawn shape for an accidental lewd or hateful silhouette** before showing it:
  phallic outlines, crossed bars that read as a swastika. Redraw any that could, at any size.
- **Keep cursors and pointer marks light**, so they never dominate the frame.

### After the pick

- **Iterate on the pick alone.** The next board varies the chosen option, not the rejected ones.
- **Update the memory pointer** with the board link, the pick and what was rejected, so the
  rejected options are not offered again.
- **The pick goes to a spec or a builder brief**, through the normal loop in PROCESS.md.
