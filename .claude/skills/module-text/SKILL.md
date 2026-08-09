---
name: module-text
description: Load BEFORE editing src/moduleText.js, src/pdfLayout.js, src/pdfExtract.js, or the pdfjs handling in main.js. Also load when the task mentions module text import, the room name-field dropdown, heading or sub-location parsing, PDF text extraction, reading order, or the import panel. Carries binding rules whose violation silently corrupts parsed module entries or breaks the packaged .exe only.
---

# Module text import

Binding rules for Evermist's module-text import path. Every rule here exists because a
real book or a real build broke the previous version. They are constraints, not advice.

## Module text (`moduleText.js`)

`initModuleText()` is called from `initRoomPanel()`. The room-field write stays in
`roomPanel.js` (`applyModuleEntryToRoom`), because that module owns the room.

- Scope is **campaign-level**: `localStorage` (`evermist.moduleText`), never a scene. Don't move
  it into `sceneStore.js`, which is keyed by scene id and would need a `DB_VERSION` bump.
- It DOES ride in the backup zip, as **one entry at the zip root**, never per-scene metadata.
  `mtBackupPayload` / `mtRestorePayload` are the whole contract; `backup.js` must never learn the
  serialised format or touch `MT_KEY`. A zip without the entry must restore exactly as before.
- Store **parsed entries only**, never the raw file.
- **No auto-assign, no queue, no "fill all rooms."** Sub-locations mean one heading serves
  several polygons, so any 1:1 mapping desyncs.
- **No LLM and no network, ever.**
- `ROOM_DESC_MAX` is **20000**. Truncation is silent, so don't lower it without making it
  visible.
- Don't commit copyrighted module text. Test fixtures are **synthetic**.

### Parser rules - each one exists because a real book broke the previous version

- Match headings on `\p{Lu}`, never `[A-Z]`. The verified source is Russian and its
  sub-location letters are Cyrillic homoglyphs of Latin ones.
- A heading number may carry **one capital prefix** (`К12.`), part of the room's key. The
  prefix must touch the digits, so "В 1. Комнате" stays prose.
- A **prefixed** heading may have a lowercase name; a bare-numbered one may not. Same
  licence for a lowercase sub-letter (`N6e.`).
- A heading number may carry **one trailing letter**, a sub-location (`N6А.`), part of the
  key and displayed as written. Without it a whole building arrives as one entry.
- **Sub-locations sequence on UNIQUENESS of the letter under the parent number, never on
  letter order.** No ordinal survives the real data. The parent is the bound instead: a sub
  may sit on the current number or open the next one, but a sub numbered *below* the current
  room is a cross-reference and is dropped.
- A **single trailing period** is stripped. What disqualifies a line is ending mid-clause or
  carrying two sentences.
- Heading selection is **greedy numeric continuation per prefix**. Not
  longest-increasing-subsequence (a numbered list forms a longer chain and wins), and not one
  shared counter (it rejects the next chapter's low numbers).
- The sequence **prefers its immediate successor over a forward jump**
  (`MT_SUCCESSOR_LOOKAHEAD`), because a cross-reference is shaped exactly like a heading. It
  must NOT apply before the sequence has started (`prev > 0`). A test pins this.
- Homoglyph prefixes are **canonicalised for sequencing only, never for display**
  (`mtCanonPrefix`).
- Page furniture is identified by **"the same text with a DIFFERENT number attached"**, never
  by a repeat count, which would delete legitimate recurring sub-headings. A line with no
  number attached is untouchable. Digits fused against a capital condemn that key outright.
- **Paragraph recovery is load-bearing** (`mtEndsParagraph`). A real extraction has no blank
  lines at all. It fires on a short line followed by a capital and must NOT require a full
  stop. Its threshold hangs off `mtWrapWidth`, the **p90** of line lengths, because the wrap
  margin lives at the top of the distribution.
- **Tune thresholds against real text, never a synthetic fixture.**
- Two unprefixed chapters in one file collide. Guidance is one chapter at a time.
- **`parseModuleText` does not detect sidebars.** Don't add a classifier. A test pins the
  behaviour rather than endorsing it.

### File loading

Decode UTF-8 first and Windows-1251 second, both with `fatal: true`: a CP1251 file decodes
as UTF-8 into replacement characters rather than an error, so the order is the safeguard.
`_mtBinaryKind` names any other container format instead of parsing its bytes as prose.

### PDFs

`_mtIsPdf` checks raw magic bytes in the first KB and routes to the converter before any
decode.

- **The parse runs in a `utilityProcess`** (`src/pdfExtract.js`), forked per import and
  killed on reply, with a `PDF_EXTRACT_TIMEOUT_MS` backstop. Do not move it back into the
  main process. It can't go in the renderer either: pdfjs-dist is ESM-only.
- main.js resolves the pdfjs directory and hands it to the child. It is the only place that
  knows the asar rewrite. Handle all three of `message`, `exit` and the timeout.
- **Bytes cross as an ArrayBuffer, never a path.** Electron removed `File.path` in v32.
- Keep `pdfLayout.js` dependency-free.
- **COLUMNS FIRST, THEN LINES.** A two-column page's left and right lines share a baseline,
  so grouping by `y` first interleaves the columns sentence by sentence. Spanning lines cut
  the page into bands, which keeps a mid-page heading with its rooms.
- Leave page furniture in for `moduleText.js`; it identifies it better than coordinates can.

### Packaging traps - only a BUILT `.exe` shows these

- pdfjs-dist must be in `asarUnpack`; ESM resolves through real filesystem paths.
  `pdfExtract.js` does not need it (`utilityProcess.fork` resolves an asar-packed entry).
- **Set `GlobalWorkerOptions.workerSrc`.** With no `Worker` global, pdf.js builds a fake
  worker from it; unset, it guesses a file that isn't shipped.
- `build.files` ships only `pdf.min.mjs`, `pdf.worker.min.mjs` and the package's
  `package.json`, and excludes `@napi-rs/**`.
- **Re-run `npx electron-builder --win --dir` and exercise a real PDF whenever this path is
  touched.**

### Import panel - three controls: Choose file, Remove, Close. Do not add a fourth.

- No paste box, no Preview button, no explanatory paragraph. Errors explain themselves in
  the status line.
- **Importing happens on choose**, no confirm step. Three things keep that safe and all
  three must stay: an empty parse never writes, the panel lists what is loaded every time it
  opens, and Remove is present.
- **Clear `#mt-file-input.value` before opening the dialog.** A file input fires no `change`
  for the same file twice, so a repeat pick is silently dead without this.
- Shell is the app's floating-panel pattern at 320px (flat `#1a1a1c`, hairline border,
  `.cp-adv-head`/`.cp-adv-body`, stock `.cp-btn`), not the backup modal's `.glass-panel`.
  Keep the backdrop, the centring anchor, and the `zoom` + max-height rule.
- Remove sits **outside the scrolling body** behind a hairline (`.mt-foot`).
- The dropdown's **footer row is the only entry point**, and the dropdown sits inside the
  card in `.rp-ident` so `--ui-zoom` applies for free.
- **The dropdown acts on `click`; its `mousedown` only calls `preventDefault`.** That
  preventDefault stops the pointer blurring the name field and closing the list; acting one
  event later keeps a dialog out of the middle of a mouse gesture.

