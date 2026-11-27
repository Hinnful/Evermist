# Architecture - reading a published module

Split out of [ARCHITECTURE.md](../ARCHITECTURE.md): how a module text or PDF becomes entries and room notes, in the present tense.

The biggest prep cost for a DM isn't typing a room description, it's finding the room in a
400-page book eighty times. So the app reads the book once.

Point it at a published module (`.txt` or `.pdf`), and it parses out the numbered locations:
`K12. The Chapel`, and so on. After that the room's name field in the Notes window becomes a **searchable
dropdown** over those entries. Pick one, and it fills the name and the description together.
A counter shows how many are placed, because a finite shrinking list is a different
psychological object than an open-ended chore.

Some things this deliberately doesn't do:

- **It never auto-assigns.** A module has sub-locations, where one heading covers several
  rooms on the map, so any automatic 1:1 mapping desyncs within a few rooms. Only the DM
  knows which blob on the map is K12, and that one choice per room is irreducible.
- **Module text never talks to a network or an LLM.** Parsing has to keep working offline
  from a local file, and a stranger who downloads the installer has to get the full value
  with nothing else installed. The update check is the app's only outbound request.
- **The parsed text is campaign-level.** It lives in `localStorage` rather than inside a
  scene, because one book serves every map in a campaign. It does ride in a backup zip, as
  one entry for the whole campaign rather than a copy per scene.

**PDFs get parsed in a separate isolated process.** A module is an untrusted file and pdf.js
is a large parser, so it runs somewhere with no access to the filesystem helpers, the
dialogs, or any window. The parse is forked per import and killed as soon as it answers.

The parser itself is full of rules that look arbitrary and aren't. Every one of them exists
because a real 255-page book broke the previous version. Read them in CLAUDE.md before
touching the parser, and read the method warning in DECISIONS.md before trusting a green
test suite: synthetic fixtures validated the wrong parser twice.
