# Decisions - positioning

Split out of [DECISIONS.md](../DECISIONS.md). What was decided about where Evermist draws its line against virtual tabletops, and why it held.

Status tags and the paragraph budget: see the main ledger's header.

---

### The VTT line was narrowed from a feature list to a screen · `SETTLED` (2026-09-24)
The line used to list what the app would never hold: tokens, initiative, character sheets. It
now names what may reach the Player screen: the map and its effects. The old list was justified
by the physical-object test, and that test had only been checked against the table. At the DM's
side, combat was run from a browser and a notes app, so a DM-side combat helper replaces a
window switch, not a paper tracker. Tokens and dice stay out, because the physical-object test
still holds for them.

### The physical-object framing was kept out of the 3.0.0 README · `REJECTED` (2026-09-24)
Proposed as the README headline, with "Evermist does what your table can't" as the pitch.
Rejected on the grounds that it argues for the scope instead of describing the app, and a reader
who disagrees with the argument can still want the app. The README leads with prep and states
the boundary as a fact about the TV.

### The Russian README was deleted · `REVERTED` (2026-09-24)
A Russian README shipped from 2.0.0 and was kept in step by hand at every rewrite. It was
deleted at 3.0.0, because the app has no Russian interface and each rewrite cost a second pass.
It is in git history if a translated app ever needs it back. The "no Russian interface" reason
lapsed at 3.9.0, which shipped a Russian DM screen (see "A missing Russian entry fails the
release" in [decisions/ui-and-control-panel.md](decisions/ui-and-control-panel.md)); the README
stayed English-only.
