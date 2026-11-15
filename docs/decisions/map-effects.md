# Decisions - map effects

Split out of [DECISIONS.md](../DECISIONS.md). What was decided about **map effects** -
drawable areas of burning ground that persist like a room - and why it held.

An effect is a polygon carrying a `material` where a room carries a fog `mode`. The rules
that bind while editing them are in [CLAUDE.md](../../CLAUDE.md); how the two render
passes work is in [ARCHITECTURE.md](../ARCHITECTURE.md); what effects will never be is in
[PRODUCT.md](../PRODUCT.md).

Status tags and the paragraph budget: see the main ledger's header.

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
**Reversed in part 2026-10-16 (see "The fog and the toolbar are rebuilt for a first-time DM"):** the three material buttons leave the row; one material button
wears the picked material's glyph and opens a palette of the materials that exist. The glyph-not-swatch rule holds.

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

### Lights are polygons in a list of their own, edited in Effects mode · `SETTLED` (2026-10-03)

Items 118 and 145 built lights as polygons stored in `lightShapes`, edited in Effects mode as a
material beside Fire. PRODUCT.md calls a light a map effect, and it is one for the DM, but not in
the data: an older release maps `effects` through `copyShapeRings`, which would draw a stored light
as fire, so `/rollback` needs them apart.

- **Fires and lights are one list in Effects mode, two arrays on disk.** They share one id counter.
  The lights sit under the fires in that list so a click lands on a small fire, not the large lit
  area beneath it.
- **A third placement mode was built and dropped.** It kept lights apart, but a torch pulled out at
  the table was a trip to another mode, and a separate Light tool was redundant beside the material.
- **No light has an off switch, a name or a description.** Delete takes one, the eye hides all.

---

### Two earlier light builds were rejected · `REJECTED` (2026-10-03)

The first read the plan's walls and cast rays from each light. It bent round corners, lit through
doorways and left dark corners in oddly shaped rooms, and the plan's lights looked wrong on real
maps. The second kept the file's lights and let the DM move, resize and switch them off: not enough,
because a good light map needs every polygon editable. A soft glow outside the edge and a thin line
were both tried as the look and were too heavy or too faint.

---

### A floor plan seeds lights by where each one sits · `SETTLED` (2026-10-03)

Seeding makes each light a polygon once, and nothing follows the plan afterwards.

- **Indoors, a light fills its room** up to the walls or its radius, and a room's lights blob by
  overlap: 30% of the smaller, or 90% of the room between them.
- **Outdoors, a light keeps its native circle, cut by every room's wall**, and never joins another,
  so a lone torch stays lonely and a torch outside a house never lights the inside. Merging every
  light turned fourteen yard lamps on Постоялый Двор into a blob over 75% of the map; snapping a wall
  torch into its room left every exterior torch dark.
- **No light passes a portal.** The `closed` flag is ignored, because the fixtures mix both values.
- **One colour for every light**, and the Player is sent outlines, never the plan.

---

### The TV shows a light only over cleared fog, as a faint inner glow · `SETTLED` (2026-10-03)

- **Under half fog the light showed through and gave the room away**, so the Player masks the light
  texture by its fog data: ground not fully revealed draws none. The polygons stay on the DM.
- **The look is Falloff, at 60%:** light pooled along the inside of each edge, a wide dim glow under
  a tight bright one. The TV and the idle DM map show 60%; the DM map shows it whole while a light
  is in hand, and only the picked light's outline is drawn at full strength.
- **Dim light, darkvision, flicker and light colours from the file** were left out.

---

### A name clash once blanked every outline · `SETTLED` (2026-10-03)

The lights module called `flattenRing`, a name `fogGeometry.js` owns with another meaning, so every
outline was NaN and nothing drew on either screen, though a sprite existed and the rig passed. The
rig now reads the light texture's pixels, not only that a sprite is there.

---

### Acid joined Fire, and both took a toon look · `SETTLED` (2026-10-11)

Picked in a lab prototype (`.claude/private/design/item-46/acid-lab.html`) by mixing rows, then judged
in the app. A material is now a record carrying its whole look, not a colour ramp alone: acid adds a
flowing pool, bubbles that pop and coloured steam; fire adds flat-banded toon flames in clumps, char,
tiny drift sparks, a hot inner tongue and a soft glow past its edge. Toon is the effects' look from
here on. The flames' clumps lower the flame threshold rather than gate it: gated, a small zone sat
empty for seconds whenever the empty part of the clump pattern drifted over it. Their sway is a noise
field, because a sine of height or time moved every flame the same way at once.

---

### Both passes blend normally, and an unpicked effect carries no chrome · `SETTLED` (2026-10-11)

The light pass was additive. An animated map is a `<video>` under the canvas on the DM and a sprite
inside it on the Player, so ADD added to the map on the TV alone: the same effect came out see-through
and hue-shifted there. Painted over the map, it is one look on both screens. The DM's orange wash and
edge over every effect went for the same reason; a picked effect keeps its gold outline (reversed 2026-11-14: it outlines in its own colour).

---

### Effect looks tried in the lab and dropped · `REJECTED` (2026-10-11)

Realistic flame patches, cartoon flame icons, inward waves, rising ribbons, glowing lava cracks,
streaked sparks (they read as lanterns) and stepped or boiled frames (they read as low frame rate).
A colour picker per effect was refused too: an effect is typed by material, and three clouds
(Darkness, poison, fog) are one future look with three materials, not a picker (reversed 2026-11-14: each cloud is its own look).

---

### Area and Difficult terrain joined the materials, each a look of its own · `SETTLED` (2026-10-28)

Picked over five rounds of throwaway prototypes (`.claude/private/design/item-187/`). **Area** marks where a
spell like Slow or Silence holds: a gold bezel of two edge lines (light over dark, so it reads on snow and
on dark stone), ticks crawling along the edge, a small glyph every sixth tick, a slow shimmer round the
glyphs and a faint fill. Glyphs were chosen knowingly, though the ping refused a rune circle for tying a map
to fantasy. **Difficult terrain** is one material for every ground: rough relief whose lumps rise and sink,
dark pools crawling over it, a ragged edge with a faint ink line. A material record now carries `kind`
(`flame`, `ward`, `rough`) and a `label`, the name the DM sees and the AI tools accept. Non-flame kinds draw
one normal-blend pass from `effectShaderKinds.js`, no grid relight (reversed 2026-11-14: every effect relights its edge squares), lengths scaled by gridSize/36. Known
limit: on an effect with a hole, ticks and glyphs follow the outer ring only. A rollback draws them as fire until the next update.
Rejected, do not retry: a colour picker per effect; one terrain per ground type (vines, grass, bog,
thornbrush; a bog on a snowy mountain reads wrong); static hatching and per-square triangle markers; shadow
fingers from the edge (read as triangles); static or "too magical" Area looks (dashed wash, glow bands,
aurora, caustics, soap film), one-colour tints, corner diamonds. Dark pools are faint on dark stone: accepted.

### Floor-plan holes and curve-keeping shape ops · `SETTLED` (2026-11-04)
Floor-plan rooms get the free-standing buildings they enclose as holes (`vttHoles.js`, used by `planPolygons`), because the
face walk emits only outer rings and a hall covered its vault. Merge, Cut out and Split restore curves and doors on a wall
walked backwards, so an anticlockwise room keeps them; a Split line cuts the flattened outline (`cutRings`), so its
crossings land on a bent wall rather than its chord.

### The effect palette is grouped by where an effect sits · `SETTLED` (2026-11-14)
Ground (Fire, Acid, Difficult terrain, Ice, Web, Grease), Cloud (Darkness), Marks (Area, Light), after Baldur's Gate 3's
surfaces and clouds. Rejected: one flat list (Table Slayer); groups by what an effect does (Hurts, Slows, Blocks sight,
Marks), because Cloudkill, Spike Growth and Hunger of Hadar belong to several; a form-by-harm grid (too much to read before
a pick); tabs (a cloud takes two clicks and search must cross them). Damage-type grounds and clouds join one at a time
when a spell needs them, not every type up front. Clouds are not one look in several colours: smoke and fog differ in
particles and light, and Hunger of Hadar is its own cloud. Poison cloud and Fog wait for later rounds.

---

### Darkness, Ice, Web and Grease, each a look of its own · `SETTLED` (2026-11-14)
Picked over board rounds (`.claude/private/design/item-286/`), one file per kind in `src/render/effectKinds/`.
- **Darkness**: Difficult terrain's recipe as a heavy, slow, blurry void. Churning billows (each point orbits a small
  circle out of phase with its neighbours, so eddies twist and return and the cloud never turns as a whole, as with the fog's
  whirlpool), a wavering violet edge, purple light on folds and pockets, rare dark motes. Rejected: cartoon puff billows,
  a feathered haze, a flat veil, a faster swirl, wisps past the edge.
- **Ice**: a cracked see-through sheet, blue frost rim, crystal clusters and a honeycomb near the rim (from the Ice fog
  theme). Blue, because a white rim vanished on snowy maps. Rejected: frost alone, a cartoon slab, long spiky crystals,
  crystals all round the edge.
Every non-flame look fits thin and small shapes (1 ft Ring and Wall, 5 ft presets): the shape's depth at its deepest scales
each look's edge work, so the fill still shows.

---

### Web and Grease looks · `SETTLED` (2026-11-14)
Picked over the same board rounds.
- **Web**: ONE orb web per effect (spokes from a hub near the middle, one spiral, the edge as frame), the old variant with
  broken threads. Several webs side by side read as unnatural; a tangle net and a milky sheet were rejected. Over a hole the
  web spans it and the hole cuts the threads.
- **Grease**: bubbling black tar whose flow turns (a flow map whose directions shift per region), amber rim. A one-way flow
  read as static. Rejected: oil slick, cartoon puddle, rainbow film, creeping lobes.

---

### Edge-squares grid relight and one colour per material · `SETTLED` (2026-11-14)
Every effect and light relights the grid as "Edge squares": lines in the effect's colour, bright at its edge, gone within
one cell inward, the plain map grid in the middle; DM and TV, square and hex. It replaces Fire and Acid's every-line relight,
which buried a look under squares (a web became unreadable, darkness a checkerboard), and the rule that non-flame kinds draw
none. Rejected: every line bright, faint lines, corner crosses, a stepped outline of covered squares (Foundry's centre-in
rule), the grid drawn under the effect. A material has one colour, used for its edge, grid relight, picked outline, palette
icon and drawing preview. A picked effect or light outlines in its own colour, not gold; editing stays white. Difficult
terrain became sand #e0bf8a; Fire's grid colour became its edge colour.

---

### Fog cloud joins the effects · `SETTLED` (2026-11-15)
Key `fogcloud`, kind `fogbank`, in the Cloud group after Darkness, one colour #d8e6f6. Picked over six board rounds
(`.claude/private/design/item-294/`): a rolling grey-blue bank lit pale on top, a rolling edge with a pale line over a dark one,
faint patches where the map ghosts through, at full speed. Named "Fog cloud" because "Fog" (Russian "Туман") already names the
fog of war. Grey-blue rather than white so it holds on snowy maps, as Ice taught.
- Every fog-like cloud, Darkness included, has faint patches at most, never holes or seams. Darkness gained faint patches with a
  faint dark veil under each so the map never shows bare, and keeps its 5.14 speed.
- Rejected, do not retry: a wall of fog with streaming wisps (its pockets were kept), droplets with light shafts and a beaded
  edge, rare clear holes, thin tears along the lumps, a few wide round patches, and slowed speeds (half, a third, a quarter, 66%).
- Trap: a drift whose direction turns must be the integral of that direction (`drift(t)` in the shared prefix), never the
  direction times t. The effect clock is seconds since page load and reaches hours on the TV, so the product speeds up with it
  (twice the movement per half second at 3 h as at 60 s); the integral moves the same at any hour.


---

### Poison cloud joins the effects, and every cloud takes the Rolling edge · `SETTLED` (2026-11-15)
Key `poisoncloud`, kind `miasma` (`poisonCloud.js`), Cloud group after Fog cloud, one colour #8fe060 (greener than Acid's #d8f040),
placeable by the AI assistant. Picked over six board rounds (`.claude/private/design/item-294-poison/`): a pale washed-out green
gas of soft lit lumps, rings of gas swelling out from points and breaking into wisps, a paler haze drifting on its own path, a
thick heart with a slightly thinner rim that is never see-through, faint patches only, the Rolling edge. Icon: the cloud outline
with two bubble rings inside (below reads as rain, side by side as eyes, outside as a speech bubble).
- Rule for every cloud effect: the Rolling edge (Fog cloud's, slow waves driven by the cloud's own body noise). The lumpy edge
  deformed the drawn shape and confused the table; it may be revisited. Darkness switched from its wavering edge to it.
- Rejected, do not retry: curling see-through streams with specks, toon puffs alone, seething rings over opaque murk alone,
  puffs rising and sinking as lit domes, lumps with rings across them, opaque gooey dark murk, an evenly thin haze, separate puffs
  in thin gas, a thin rim showing the ground clearly, a lumpy edge and a wavering edge.
- Rejected: a grid relight following a cloud's moving edge (prototyped, dropped); the static Edge squares stay.
