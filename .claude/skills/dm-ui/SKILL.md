---
name: dm-ui
description: Load BEFORE editing src/roomPanel.js, src/controlPanel.js, src/toolbar.js, or the half-shroud paths in src/fog.js. Also load when the task mentions the room card, room labels, the description textarea, corner radius, half-shroud or fogHalfAlpha, control-panel buttons, pills, segmented controls, or destructive-button styling. Carries layout and button-identity rules that are invisible in code review.
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


## Control-panel button identity

- A black inset pill (`.cp-tabs` / `.cp-seg`) means *pick one of these*. The selected option
  goes bare/blue inside it.
- An independent action or toggle is a `.cp-btn`: outlined at rest, outlined + blue-filled
  when `.active`. Never put one inside a pill.
- Value fields (`.cp-field`, `.cp-stepper`) use the light surface, not the black pill.
- A **destructive** action keeps the ordinary full-width `.cp-btn` shape plus
  `.cp-btn-danger` and a hairline footer (`.rp-foot`). The hairline is what stops it reading
  as the primary action. Don't shrink it to signal danger.

