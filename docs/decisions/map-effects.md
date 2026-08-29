# Decisions - map effects

Split out of [DECISIONS.md](../DECISIONS.md) so the main ledger stays readable. Same
question, same past tense: what was decided about **map effects** - drawable areas of
burning ground that persist like a room - and why it held.

An effect is a polygon carrying a `material` where a room carries a fog `mode`. The rules
that bind while editing them are in [CLAUDE.md](../../CLAUDE.md); how the two render
passes work is in [ARCHITECTURE.md](../ARCHITECTURE.md); what effects will never be is in
[PRODUCT.md](../PRODUCT.md).

**Status tags** and the one-heading-one-paragraph budget are the main ledger's; read its
header before adding an entry here.

---

### Map effects were built, shipped and then removed · `REVERTED` (2026-08-21)

Drawable areas of burning ground - a polygon carrying a material, persisted like a room - shipped
as 2.2.1 and were removed whole: the commit was dropped and the app returned to 2.2.0. The
mechanics worked. Removed on product grounds, and the cause was the process, not the code:
developing the look by eye took many rounds, each fixing a real defect and exposing another, and
it never converged. Recoverable from the dropped commit in git.

Three findings are worth not re-deriving:
- **An effect texture with no alpha channel paints a black rectangle** wherever any compositing
  step draws it normally instead of adding it - a filter that fails to apply is enough. Additive
  artwork needs real transparency, not black where it means "nothing".
- **A looping flipbook cannot hold one-way motion.** Every displacement inside it must return by
  the last frame, so it reads as travelling out and back. One-way motion belongs where time is
  unbounded: the draw path, not the sheet.
- **Layers sharing one frame clock give the whole composite a single visible cycle**, however
  well each layer behaves on its own. Independent rates hide the loop; nothing in the art can.

### Map effects reopened as grid-fire indication · `REOPENED` (2026-08-22)

After the removal above, effects were reframed from rendered fire to INDICATION and are being
rebuilt on that basis. Rendering is a fiery grid - the shape's border and the interior grid lines
lit, clipped to the true outline so a circle stays a circle - not a filled texture. Procedural, no
assets, ships, and stays legible when zones overlap or seen across a room on a TV.
Readymade fills were tried and rejected; do not retry:
- Photoreal fire CLIPS (Jinker's JAA) look right at native size, smear when stretched to a room,
  and carry no licence to ship.
- Seamless MAGMA surfaces fill any shape but were rejected on look and ran heavy.
- Baking a custom fire surface had no reference to measure and never converged.
Prototyped in a throwaway harness under `tools/`, since removed along with its wiring.

### Map effects settled as a flaming border, rendered in two passes · `SETTLED` (2026-08-25)

The grid-fire idea above gave way to a flaming BORDER chosen by eye: the outline burns INWARD from
the edge with tongues that dissolve to embers, over a faint interior fill, with sparks, smoke and
haze. Grid-fire's lit interior grid survives only as an ember RELIGHT of the map grid inside the zone.
Three shape calls that a future session would otherwise re-derive:
- **The fire is a fragment shader over each polygon's own signed-distance field** (`effects.js`), not
  a tiled texture and not stroked lines - so it works on any drawn shape and rounds with the corners.
- **Two PixiJS meshes per effect: an ADD pass and a NORMAL pass.** Fire/fill/sparks emit light (ADD);
  smoke/haze DARKEN the map, which addition cannot do. One blend mode cannot be both, and a single
  NORMAL mesh was tried and dimmed the approved border - rejected.
- **The ember grid relight lives in `grid.js`, not the effect shader.** The map grid is a Canvas-2D
  layer above the effect layer, so an ember grid drawn in the effect sits under it and never shows.
Also corrected here: effect sync rides the Auto/Manual gate like fog; the removed 2.2.1 build
force-pushed effects to the Player even in Manual.

### The Cone tool draws a D&D cone, apex-first, at a fixed 53.13° · `SETTLED` (2026-08-26)

Dragged from its point of origin: the press sets the apex, the drag sets direction and length.
Straighten walls rounds that direction to 15°.

**The spread is fixed and should not become a slider without a request.** A D&D cone is as wide at
its far end as it is long, which fixes the apex angle at 53.13° - Foundry's default, Roll20's
"lock width to height". Any other spread measures a different area than the players' own rulers,
which is the one thing an indication tool must not do. A 90° breath is the Polygon tool's job.

**The far edge bows out 8% of the length (`CONE_BULGE`); a bare triangle read as a paper cut-out.**
The two corners do not move when the bulge changes, so width-equals-length holds at any bulge, and
every measurement is taken between the FIRST and LAST vertex - everything between them is arc. The
bow costs reach: the arc's middle stands 8% past where the drag ended. Set it to 0 for the triangle.

A cone commits as ordinary vertices and needs no editing path of its own. `coneVertices` in
`fogGeometry.js` is pure and unit-tested, so the width rule is checked by arithmetic.

### The effect look was tuned through a temporary panel, then baked · `SETTLED` (2026-08-26)

The fire's height, liveliness, fill, sparks, smoke, haze and grid glow were settled by putting a
dev slider panel in the DM window, tuning on a real map, and reading the numbers off it. The panel
and everything built to serve it are gone: the sliders, the cross-window message that pushed live
values to the Player, and the per-frame uniform writes that fed them.

`FX_LOOK` in `effects.js` is now a fixed set of numbers with no UI over it. Change one only on a
fresh look call. Two findings from that tuning are worth keeping: haze gated to a band near the
outline reads as a second smoke ring rather than as air over the area, so it covers the whole
interior; and a look value edited on the DM reached nothing, because each window holds its own copy.

### The material picker is a glyph, not a painted swatch · `SETTLED` (2026-08-26)

The picker button was painted with a canvas showing the real material - a rounded box burning at
its own edge - on the reasoning that an icon OF fire is a drawing of the thing rather than the
thing. It drew a box, inside the button's own selected box, inside the row's pill. Three nested
boxes, rejected twice. The button is now a plain SVG glyph like every other button on that bar.

The glyph is a wide low flame on a ground line. A tall flame alone read as the same icon as the
Rooms/Effects switch beside it, and both go blue at once in Effects mode; an angular crest read as
a mountain range.

`acid` was removed at the same time. `fireRamp` is hardcoded orange and reads only the material's
`warm`, so a green swatch shipped a button that painted orange fire. A second material needs the
ramp to read the material's own colours first; until then the picker can only lie.

### Map effects: what was offered alongside them and dropped · `REJECTED` (2026-08-26)

Three things came up while the effects feature was being finished, and each was refused rather than
deferred. Recorded so none of them is proposed again as an obvious gap.

- **A Line shape.** Offered next to the Cone, which shipped. Not wanted.
- **A "clear all effects" control.** Refused on how the feature is actually used: one or two effects
  are on the map at a time, so hunting and deleting each is not a burden worth a button.
- **Effect render cost on a TV.** Raised as an unproven risk - two shader meshes per effect, a
  64-step distance loop per pixel. Judged fine in real use at the table. Do not refile it as a risk
  without a fresh report of stutter.

Also settled at the same time: the fire's spark colour and similar look details are not tracked as
work. Visual polish on a settled look has no end, so it happens only on a specific request.

---
