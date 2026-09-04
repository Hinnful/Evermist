---
name: dm-ui
description: Load BEFORE editing src/roomPanel.js, src/controlPanel.js, src/toolbar.js, src/shapeMenu.js, src/css/toolbar.css, src/css/roomCard.css, src/css/sceneManager.css, or the half-shroud paths in src/fog.js. Also load when the task mentions the room card, where the card places itself, room labels, the description textarea, corner radius, half-shroud or fogHalfAlpha, toolbar toggles or segments, the shape button or its flyout, which tools a placement mode shows, control-panel buttons, pills, segmented controls, destructive-button styling, or the scene library popup and its header. Carries layout and button-identity rules that are invisible in code review.
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

Four signals, and they must not blur into each other:

- The tool row (`.tool-btn`) is pick-one *and* wears the **outlined blue box**, which now
  belongs to the picked tool and to nothing else on the bar. Don't lend it to anything, and
  don't "fix" the collision by restyling the row. **No hairline dividers on this bar** — one
  was tried and read as a scratch on the TV.
- An **independent on/off switch is a bare `.tb-toggle`** on the bar, set off by a 12px gap.
  On is a soft fill plus a 20px blue underline, never the outlined box. Snap-to-grid and
  straighten-walls are these, and **both keep their state across a mode switch**.
  **Never gather toggles into a pill** — one alone reads as harmless, and a second one makes
  the pill a lie.
- **The Rooms/Effects switch is a `.tb-seg` sunken track** at the right-hand end of the bar,
  behind the same 12px gap. It governs every tool to its left, so it must look unlike all of
  them; a well with a lighter plate in it is that shape. **`.tb-seg` is for this switch and
  nothing else.**
- **A pick-exactly-one group inside `#context-row` gets NO pill of its own**: a bare
  `.tb-group`, no background, no border, no radius. Two rounded boxes at different heights
  read as a mistake. `#context-row` is itself the pill, wearing the bar's surface, and it is
  the same height as `#toolbar-bottom` — 4px padding on 34px buttons there, 6px on 30px here.

Two more rules the bar's shape depends on:

- **A tool a mode cannot use is ABSENT, not greyed.** Rooms shows Select, Shape, Brush, Door,
  Split, Merge and Cut out; Effects shows Select and Shape. The bar sizes itself to whichever
  set is up and `#bar-row` keeps it centred. Half is the one control left that greys, and only
  while the Brush is picked.
- **Taking a button off a mode's bar means disarming what it held.** `setPlaceMode` returns
  `shapeOp` to `'new'` on the way into Effects; an armed Merge with no button there is a mode
  the DM can neither see nor cancel, and it swallows the next effect they draw.
- **`#context-row` hides with `visibility`, never `display`.** Select and Split leave it blank,
  and a `display: none` takes its box out of `#tools-wrapper` — the whole cluster then jumps up
  by the row plus the 11px gap on every Select. Its explicit `height` is what stops the box
  collapsing once every child inside it is hidden.

## Control-panel button identity

- **One floating surface, and it is four CSS variables in `base.css`** (`--panel-bg`,
  `--panel-border`, `--panel-radius`, `--panel-shadow`). The Scenes button, the bottom toolbar,
  the tab bar, the settings panel, the advanced fog panel (`#anim-advanced-panel`), the module
  text modal (`#mt-modal`), the confirm dialog (`#cd-modal`) and the room card (`#panel-room`)
  all read them. `#sm-panel` reads the border only — it is a full-screen modal over a veil, so
  its heavier shadow and its own radius stay. A control that writes its own hex drifts.
- **The Fog/Grid/Player tabs live OUTSIDE the panel**, in `#cp-tabbar`. Picking the lit tab shuts
  the panel. `.cp-tabs` is now the in-pane Auto/Manual pair alone.
- A black inset pill (`.cp-tabs` / `.cp-seg`) means *pick one of these*. The selected option
  goes bare/blue inside it. **The Animation and Grid Type rows carry no pill** - the pane's 207px
  fits five 30px icons plus a reset only when nothing boxes them, so any pill costs icon size.
- An independent action or toggle is a `.cp-btn`: outlined at rest, outlined + blue-filled
  when `.active`. Never put one inside a pill.
- Value fields (`.cp-field`, `.cp-stepper`) use the light surface, not the black pill.
- A **destructive** action that stands alone keeps the full-width `.cp-btn` shape plus
  `.cp-btn-danger` and a hairline footer (`.rp-foot`) - the room card's Delete. The hairline is
  what stops it reading as the primary action; don't shrink it to signal danger.
- A **destructive** action that belongs to one control sits beside it as a `.cp-btn-icon`, wears
  no red, and asks through `confirmDialog` instead. Fog and Grid Reset are these. The question is
  the whole warning, so never drop it to save a click.

