---
name: dm-ui
description: Load BEFORE editing src/roomPanel.js, src/controlPanel.js, src/toolbar.js, src/css/toolbar.css, or the half-shroud paths in src/fog.js. Also load when the task mentions the room card, where the card places itself, room labels, the description textarea, corner radius, half-shroud or fogHalfAlpha, toolbar toggles or segments, control-panel buttons, pills, segmented controls, or destructive-button styling. Carries layout and button-identity rules that are invisible in code review.
---

# DM interface identity and layout

Binding rules for the DM-facing interface: the room card, half-shroud, and control-panel
button identity. Each was arrived at by building the alternative and removing it.

## Room card (`roomPanel.js`)

Layout, top to bottom: a **titleless drag bar** (six-dot grip + Close), the name field, the
description textarea, ONE unlabelled properties row (the Reveal/Half/Shroud `.cp-seg` pill,
then the corner-radius field pushed right), and Delete at full width behind a hairline.

- **Visibility is gated on selection only, never on the active tool**, so the card survives
  tool switches.
- **The description is the card's scarcest resource.** Don't add a label column or a second
  properties row without taking the height from somewhere other than the textarea.
- **No title on the drag bar, no underline or leading icon on the name field, no vertex
  readout, no radius-mode toggle.** Each was built and removed; see DECISIONS.md.
- **The name is just a FIELD**, with the same box and 10px text inset as the description.
  The 14px column is where *boxes* start, 24px is where *text* starts. Read the CSS comment
  on `.rp-name` before restyling it.
- **`_rpScreenToStyle()` is the only correct screen-px → pre-zoom-px conversion.** The
  mapping is **affine**: a slope plus a constant origin, both derived from measurement.
  Never reintroduce a bare `/ uiZoom`.
- Card position (`_rpManualPos`) is screen px, re-clamped every reposition, cleared on close.
- **`clampPanelPosition` takes the room's screen BOUNDING BOX, never its centroid**, and the
  card must clear the whole outline. Anchoring on a point is what let a big room swallow the
  card. Automatic placement is **frozen for the length of a vertex or edge drag** (`_rpAutoPos`)
  or the card flips sides mid-edit; the four drag-release paths in `tools.js` each repaint so it
  re-places once on mouseup. **Visibility is still selection-only** — creating a room leaves
  nothing selected, which is what keeps the card shut while drawing, so don't add a tool check.
- Description height is ONE global `localStorage` preference (`RP_DESC_H_KEY`), saved on
  **mouseup**, never per-room and never in a scene or backup. **CSS owns the bounds** via
  `.rp-desc`'s own min/max-height; don't add JS range constants.
- The radius field's target derives from `selectedVertexIndex` and is never stored.
- `refreshRoomPanel()` is the reflection hook. Called from `drawCursor()` and the paths that
  rewrite modes or reset polygons wholesale. **Not** from `setPolygonMode()`, which updates
  the pill in place so a rebuild can't steal field focus mid-edit.
- Room labels: `roomLabelFontPx(zoom)` is screen px and **clamped at both ends**. Placement
  is top-left INSIDE the room via `fitLabelBox()`, which scanline-samples in MAP units so the
  cached anchor is pan-independent. `_rpLabelCache` clears per scene.
- Pure kernel (unit-tested): `normalizeRoomFields`, `sanitizeRoomName`, `sanitizeRoomDesc`,
  `clampPanelPosition`, `ellipsizeToWidth`, `roomLabelFontPx`, `polygonRowSpans`,
  `cornerInsetAt`, `fitLabelBox`.

## Half-shroud

`poly.mode === 'half'` rides the reveal path in `applyPolygonToFog`, erasing to completion,
then repaints fog at `fogHalfAlpha` through the same mask. **Absolute, not subtractive:** a
partial erase can't re-fog ground already clear, i.e. the room the party just left.

- **Flatten the interior on the SCRATCH MASK, not on the fog.** A reveal clears
  cloud-erosion residue with a hard `clearRect`; the repaint can't, and residue in the mask
  reads as blotchy density. Flattening the inset region to white on `_fogScratch` fixes it
  and keeps the feathered edge band.
- `fogHalfAlpha` is ONE global `localStorage` value (`FOG_HALF_ALPHA_KEY`), never per-room,
  never in a scene or backup, and deliberately absent from Fog Reset.
- The Player needs nothing new: the stencil crosses as a PNG and partial alpha propagates
  for free.
- The toolbar's `#btn-half` brush is deliberately unwired. Only the card's pill and `T`
  reach this state.
- **Reverting this feature requires a data sweep**, not just a code revert. See DECISIONS.md.


## Bottom-toolbar button identity

Three signals, and they must not blur into each other:

- A dark inset pill (`.tb-seg`) means **pick exactly one** of the buttons inside it. Only the
  fog-mode group qualifies. The picked one goes bare blue (`.mode-btn.active`).
- An **independent on/off switch is a bare `.tb-toggle`** behind a `.tb-div` hairline, outlined
  blue + faint blue fill when on. Snap-to-grid and straighten-walls are these. **Never put a
  toggle inside a pill** — one alone reads as harmless, and a second one makes the pill a lie.
- The tool row (`.tool-btn`) is pick-one *and* wears the outlined blue box. That collision is
  deliberate: the tool picker is unique in the app and is meant to look unlike everything to
  its right. Position and the hairline carry the distinction, so don't "fix" it by restyling
  either side.

## Control-panel button identity

- A black inset pill (`.cp-tabs` / `.cp-seg`) means *pick one of these*. The selected option
  goes bare/blue inside it.
- An independent action or toggle is a `.cp-btn`: outlined at rest, outlined + blue-filled
  when `.active`. Never put one inside a pill.
- Value fields (`.cp-field`, `.cp-stepper`) use the light surface, not the black pill.
- A **destructive** action keeps the ordinary full-width `.cp-btn` shape plus
  `.cp-btn-danger` and a hairline footer (`.rp-foot`). The hairline is what stops it reading
  as the primary action. Don't shrink it to signal danger.

