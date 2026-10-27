# Decisions - discoverability

The public, past-tense ledger of decisions about **how people and AI search find Evermist**: which
sites list it, what each listing carries, and what was ruled out. [PROCESS.md](../PROCESS.md),
"Where Evermist is listed", says what each listing needs now; this file says why it has that shape.

**One heading, a status, and at most a short paragraph.**

---

### Listings aim at AI search, not at the sites' own visitors · `SETTLED` (2026-10-26)
AI assistants recommend an app once several sources describe it the same way, and they read
catalog sites such as AlternativeTo and itch.io heavily. Each listing exists to be one more such
source. A listing's own audience and its reaction to it carry no weight in what the listing says.

### Every listing says plainly who Evermist is not for · `SETTLED` (2026-10-26)
Each description ends with "not a virtual tabletop: players don't connect to it, and it has no
tokens or dice". An AI answer that matches Evermist to a question about online play costs a
recommendation that fits nowhere, and the README's same line already did the matching well.

### AlternativeTo lists Evermist as an alternative to five apps · `SETTLED` (2026-10-26)
Dungeon Revealer, FreeVTT, Roll20, Foundry Virtual Tabletop and Owlbear Rodeo. An app with no
alternatives rarely appears in AlternativeTo's search, and "alternative to X" is the question its
pages answer. The free review queue was chosen over the paid priority review.

### The itch.io download is a link to GitHub's latest release · `SETTLED` (2026-10-26)
The page carries one external file, pointed at `releases/latest`, for Windows, macOS and Linux.
Uploading the installers to itch.io on every release, by hand or by `butler` in the release
workflow, was ruled out: it adds an API secret and a step that can fail, for no gain in search.
Installed copies update from GitHub either way.

### The itch.io AI disclosure marks code only · `SETTLED` (2026-10-26)
itch.io asks every project whether it holds generative-AI output. The answer is yes, for code.
Text & Dialog was judged excessive for the interface wording and the page text, and stays unticked.

### Posting on Reddit · `REJECTED` (2026-10-26)
Reddit is a source AI search quotes often, but the large D&D subreddits refuse self-promotion and
their communities react badly to AI-made work. A real user's mention does the same job and needs
no post.

### A landing page · `PARKED` (2026-10-26)
A one-page site on GitHub Pages would give Evermist a home Google trusts more, and it would open
Google Search Console to show which searches find it. Parked until GitHub and the listings have
had a few weeks to show how far they reach on their own.
