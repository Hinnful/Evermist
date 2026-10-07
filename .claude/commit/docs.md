## Step 4 - File what the work settled

Everything here describes CODE, so it is true the moment the code is written. Check each
destination, skip any that has nothing, never manufacture an entry. `npm test` holds the shape
rules for all of them, so a red test names the fix.

**A settled call → one of three ledgers.** Anything the session decided rather than deferred: an
approach built then rejected, something reverted, a design settled so it stops being re-litigated.
The destination follows the question it answers:

- *Why is the code, or the repo's tooling, this shape?* → `docs/DECISIONS.md`, or the matching file
  in `docs/decisions/`. Past tense.
- *What is the product, what will it never do?* → `docs/PRODUCT.md`. Declarative.
- *Why does the working process have this shape?* → `docs/decisions/process.md`. Past tense.
- *How does the process run now?* → `docs/PROCESS.md`. Present tense.

One heading, a status tag from the file's own vocabulary, at most a short paragraph. A guard hook
rejects an untagged entry and one over 14 lines. A style preference is a rule, and rules go to
`CLAUDE.md` or `PRODUCT.md`.

**Write about the decision, never about the people.** The repo is public. "the user said", "he
ruled", "I recommended" and verbatim chat quotes read as leaked notes about a named person. Write
"rejected on product grounds: …" instead. The same rule holds in `ARCHITECTURE.md` and `CLAUDE.md`.

**Changed behaviour → `docs/ARCHITECTURE.md`.** A changed subsystem, or a description there this
change made wrong. A bug fix that preserves behaviour needs no edit. A new, moved or renamed module
fails `npm test` until both module maps and the skill trigger map name it.

**A spent spec → deleted.** If this chunk came from a file in `.claude/private/specs/`, delete it.
If only half of it shipped, leave the file and say so.

**This step asks nothing.** Report what you filed in a line or two.
