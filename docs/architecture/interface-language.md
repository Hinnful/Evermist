# Architecture - the interface language

Split out of [ARCHITECTURE.md](../ARCHITECTURE.md): the interface languages and how text is translated, in the present tense.

The DM's screen is English or Russian. The language is picked once when a window opens: the
DM's choice from the About block if there is one, otherwise the computer's language. It stays
fixed for the life of that window, so a new choice shows after a restart.

The English text is written in the code as it always was, and a dictionary maps each English
string to its Russian (`src/i18n/ru.js`). In Russian, one pass swaps every piece of English on
the page it finds in the dictionary, and a watcher swaps text and tooltips added later. A
sentence the code builds around a number or a name goes through `t()`, which fills the values
into the Russian sentence and picks the Russian plural form for a count. The DM's own text is
marked and skipped, and so is anything being edited. In English none of this runs. The Player screen has no text.

A unit test reads the code for English with no Russian entry, or a sentence built from pieces,
and fails while there is any, so a release never ships a gap. `node tools/i18n-report.js` prints
the same lists.
