---
name: research
description: Load whenever the DM asks to research something, to see how other apps do X, or to compare competitors, and before a scope or product call. Carries how a study is run and reported. Not for mockups or UI options (the mockup skill), a bug fix, or a change whose shape the DM already gave.
---

# Research

A study answers how others solve a problem. It ends at the report with one recommendation and
stops; building waits for the DM's "build it" (CLAUDE.md).

## When to skip

- **A bug fix needs no research.** Diagnose it and fix it.
- **A change whose shape the DM already gave needs no research.** Build that shape.
- **A technical question with one obvious answer in the official docs** is a lookup, not a study.

## Before searching

- **Reuse earlier studies first.** Memory holds links to past research artifacts; read the ones
  on this topic with the Artifact tool and extend them. Search again only for what they lack.
- **Check the ledgers.** `docs/DECISIONS.md`, `docs/decisions/` and `docs/PRODUCT.md` hold settled
  calls; a study never reopens one without saying which entry it challenges and why.
- **Write the question in one line** and the decision it feeds. A study with no decision behind
  it is not started.

## Sources

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
- **Reddit blocks every tool; skip it.**

## Running it

- **Run independent searches in parallel subagents**, one axis each: one competitor, one
  pattern, one technical practice. The brief names the question, the axis, the sources to open,
  and asks for every claim with its link and a verified or inferred mark.
- **Keep each brief narrow.** A subagent handed the whole question returns a survey; one handed
  one app returns evidence.
- **Read what comes back critically.** A subagent's confident claim with no link is dropped.

## Reporting

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
