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
- **Half is a shape-tools-only paint direction.** The brush paints into a cleared-or-opaque
  fog canvas with no third value, so `#btn-half` disables while the brush is picked and a
  live `tool === 'half'` falls back to `'shroud'` — the highlight moving is the DM's only
  signal, so never make that fallback silent. Reached from the toolbar, the card's pill or `T`.
- **Reverting this feature requires a data sweep**, not just a code revert. See DECISIONS.md.


## Bottom-toolbar button identity

Three signals, and they must not blur into each other:

- **A pick-exactly-one group gets its OWN pill**, floating beside or above the bar with the
  bar's own surface: `#context-row` (fog trio, or materials + radius, plus brush size) and
  `#place-pill` (Rooms vs Effects). The picked one goes bare blue (`.mode-btn.active`).
- **Never nest a pill inside a pill.** Each of those groups once carried its own rounded box
  inside a larger one, and two rounded boxes at different heights read as a mistake. A group
  inside a pill is a bare `.tb-group`: no background, no border, no radius. The old inset
  `.tb-seg` is deleted; do not bring it back.
- **Every standalone pill is the same height as `#toolbar-bottom`.** The bar is 4px padding on
  34px buttons; a pill of 30px buttons therefore takes 6px. Check it after any padding change.
- An **independent on/off switch is a bare `.tb-toggle`** on the bar, set off by a wider gap,
  outlined blue + faint blue fill when on. Snap-to-grid and straighten-walls are these.
  **Never gather toggles into a pill** — one alone reads as harmless, and a second one makes
  the pill a lie.
- The tool row (`.tool-btn`) is pick-one *and* wears the outlined blue box. That collision is
  deliberate: the tool picker is unique in the app and is meant to look unlike everything to
  its right. Position alone carries the distinction, so don't "fix" it by restyling either
  side. **No hairline dividers on this bar** — one was tried and read as a scratch on the TV.

## Control-panel button identity

- A black inset pill (`.cp-tabs` / `.cp-seg`) means *pick one of these*. The selected option
  goes bare/blue inside it.
- An independent action or toggle is a `.cp-btn`: outlined at rest, outlined + blue-filled
  when `.active`. Never put one inside a pill.
- Value fields (`.cp-field`, `.cp-stepper`) use the light surface, not the black pill.
- A **destructive** action keeps the ordinary full-width `.cp-btn` shape plus
  `.cp-btn-danger` and a hairline footer (`.rp-foot`). The hairline is what stops it reading
  as the primary action. Don't shrink it to signal danger.

