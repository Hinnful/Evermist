# Audit misses

What the DM found after an audit said the interface was done, and which step of the audit now catches it
(`.claude/rules/process.md`, "Proving it works"). A step that shows up here twice is not working.

## 2026-11-23, after the design-system audit

The audit compared 12 screens at rest with the previous release and ran the alignment sweep. It opened no
pop-up, menu or row state, and read whole screens at a quarter size.

| Finding | Should have caught it | Now caught by |
|---|---|---|
| Right-click menus outside the fight table 1.2x smaller | Opening every menu | `design-sweep` opens three menus and compares their size |
| Plate swallowed by a hovered fight row | Hover state | `lib.hoverSweep` |
| Open Bestiary row loses its tint under the pointer | Hover over a state | `lib.hoverSweep` |
| CR plate merges with a ticked row | Ticked state | `lib.hoverSweep`'s merge floor, the inventory's ticked row |
| Checkbox jumps 3px when ticked | A state change | `lib.shiftSweep` |
| Filters: native scrollbar, native range select | Opening every pop-up | The inventory, `lib.surfaceSweep`'s native check, one scrollbar in `base.css` |
| Text against the select's sides | Padding inside controls | `lib.surfaceSweep`'s padding check |
| Filters' two secondary buttons side by side; a line over "Save" in the legend; the source tag's height | Reading close-ups against the rules | The outside reviewer |

## 2026-11-23, after the first round of fixes

| Finding | Should have caught it | Now caught by |
|---|---|---|
| The range filter's open list is the browser's own | Opening the list | The inventory's open-list state, `lib.surfaceSweep`'s native check |
| Text against the select's sides | Padding inside controls | `lib.surfaceSweep`'s padding check |
| The source tag on the baseline reads low | Reading close-ups against the rules | The outside reviewer; the rule now names the tag's centring |
| A trashed sound's name cut at the bottom, on the audit's own close-up | The clip check, which looked only at cap-trimmed text | `lib.surfaceSweep`'s clip check, now for any box whose line is shorter than its letters |

The first inventory run then found what no one had reported: 70 rows off on surfaces the sweep had never opened,
and the outside reviewers found the cap trim cutting the tails of у and р in every search and filter field, which
`lib.surfaceSweep`'s clip check now catches.

## 2026-11-23, BACKLOG 311 and 312

| Finding | Should have caught it | Now caught by |
|---|---|---|
| The CR badge's hover, the item's first line, never performed | A check written from the item's words, run with real input | `guard-builder.js` `Accept:`, `ship.js --accept` |
| 312's new-action placeholder reported as passed, never exercised | Re-checking each DoD line against the builder's report | `ship.js --accept` marks per line |

## 2026-11-24, the vertical-alignment bug, again

| Finding | Should have caught it | Now caught by |
|---|---|---|
| Small texts 3.6px below the buttons in a head with a big title; the crumbs' › 2px low; 13 more rows | An alignment check measuring what the eye sees | `lib.alignSweep`: every item on the row's centre line (capitals, ink, box), no window between texts |
