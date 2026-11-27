# Decisions - Floor-plan derivation

Split out of [DECISIONS.md](../DECISIONS.md). What was decided about rooms, walls and doors drawn from a Universal VTT floor plan, and why it held.

Status tags and the paragraph budget: see the main ledger's header.

---

### A floor plan beside a map is `.dd2vtt`, `.uvtt` or `.df2vtt` · `SETTLED` (2026-11-09, BACKLOG 285)
Tried in that order, first that reads wins; drag-and-drop and the plan picker take all three. The parser needed no change.
Only the file beside the map is read, as before. Fixtures are built from the published format, since no real DungeonFog or
Dungeon Scrawl export could be found. Texts the DM sees say "floor plan" with no file format (BACKLOG 291); the AI
assistant's texts name all three.

### Auto-polygons read the map's own floor plan, not pixels · `SETTLED` (design)
Dungeon Alchemist exports Universal VTT (`.dd2vtt`) beside the map: wall segments, doors and
windows, light sources and the grid calibration, as vector data in grid-square units. Every
hard problem in pixel tracing is simply absent - no doorway leaks, no furniture holes, no
tolerance dial, no ragged vertices along a curve. It calibrates the grid for free, and alignment
with the paired video is exact (`map_size × pixels_per_grid` equals the video's own pixel size,
uniform scale 1.0).

Walls arrive as loose two-point segments with gaps at the openings, and the portals fill those
gaps exactly, sharing endpoints. **Walls unioned with portals is a closed floor plan; walls
alone are not.** Derivation is then five pure-geometry steps: union walls with portals, split
edges at T-junctions, walk the planar faces, drop collinear vertices, discard boundary faces by
winding, and scale by `pixels_per_grid`.

### The UVTT derivation's two silent traps · `SETTLED`
**Classify faces by winding direction, never by area.** Interior faces wind one way and
boundaries the other. Size looks like a usable signal right up until a map holds two detached
buildings, and then the smaller building's own boundary outranks a real room by area. Fails
silently, and only on multi-building maps.

**Never read `objects_line_of_sight`.** It is a vision-blocking list - columns, boulders, tall
crates - so unioning it in turns every pillar into a closed loop inside a real room, and the
face walk reports the hall as a ring plus a fake little room. Ordinary furniture never appears
there anyway: a fully furnished test room produced an absent field.

### An open wall loses its room · `SETTLED` (both halves reversed 2026-08-06)
A missing wall segment does not distort a room, it deletes it: the gap joins the interior to
the outside and the two merge into one face.

**Auto-closing gaps was rejected, then shipped bounded.** An archway with no door still bounds
a room worth shrouding, so refusing every gap failed the common case to guard a rare one. Three
things keep it safe: the bridge is a straight line between two points the file already
contains, two ends join only when each is the other's nearest feature, and a minimum face area
refuses the sliver a corner bridge chips off. Wider gaps are still refused, and nothing can
close a wall that is simply absent.

**Reporting each gap's coordinates was built, then cut from the UI** - unreadable as text, and
an edge case placed in front of every successful import. `openWalls` still computes.

### A doorless wall loop is solid, not a room · `SETTLED` (kernel rule)
A wall run that closes on itself carrying no portal anywhere does not bound a room: it is a
rock formation or the cave's own shell. Every real room reaches somewhere through a doorway,
so its walls arrive as an OPEN chain that closes only once the portals are unioned in. On the
cave export the false rooms scored 100%, 100% and 84% of their outline in doorless wall and
every real room scored exactly zero — so the test is "any at all", with no threshold to tune.
That is the point: a blind area threshold is the instrument the winding-not-area trap already
punished once.

Two properties keep it safe. It judges **a whole connected run of walls, not one room**, so a
windowless cellar or a prison cell keeps its building's doors; only a structure isolated from
everything else is refused. And it runs **before the portals are unioned in**, since afterwards
every chain is a loop and the distinction is gone. Accepted cost: a floor that is one sealed
room, an attic reached by a hatch, comes back empty rather than wrong. That trade is deliberate:
confidently correct, or no polygons at all.

### A wall stub never bridges into solid, and a mutual pair reaches further · `SETTLED`
A room whose whole side is open to a cave was lost, and gap closing looked innocent. Both
ends of the opening bridged sideways into the rock a few feet away — nearer than each other —
which glues the wall to the cave, achieves nothing, and consumes the end so the real partner
is never found. 8 of 10 bridges on the cave map were that mistake, and raising the reach
could not fix it because the ends were already spent.

So the doorless walls are computed BEFORE closing and excluded as targets. Once nothing solid
can steal an end, the two sides of an opening find each other — at 3.7 and 4.3 squares, past
the 2.5 a stub is allowed. Hence a second, wider ceiling for a MUTUAL PAIR only, where both
ends pick each other: far better evidence than a stub projecting onto some wall's mid-span,
which keeps the tight one. Tightening the base ceiling tightens both, so "closing off" still
means off. Result on the cave map: 13 rooms, all real, none false.

### A portal becomes a door only where two rooms share the wall · `SETTLED` (2026-09-01)
Portals carry no type field, so the only evidence a plan gives about an opening is what stands on
either side of it. One rule uses that: a portal whose midpoint sits within a quarter cell of two
derived rooms' outlines is a doorway; one room means a window or an outside entrance and nothing
is placed. Measured on both fixtures before it was built - 2 of 19 portals qualify on the interior
map, 16 of 25 on the cave - and the counts are identical at tolerances of 0.1, 0.25 and 0.5 of a
cell. At a full cell they smear, one portal claiming three rooms. A quarter cell is also what
`doorMouseDown` already uses to decide two clicks are the same door.

**A derived door is the identical record a click makes**, `{edge, t}` and nothing else. Width and
depth stay global, so a double doorway in the file comes out one square wide - accepted, because a
per-door size field would reach the fog rebuild, the click hit-test, the grid-change rebuild, scene
save, backup and undo, and split doors into two kinds that look different from each other. The
match runs in `fogGeometry.js`; `vttPlan.js` only gained the portal midpoints, and stays
dependency-free.

### Grid Size comes from the plan at import, size only · `SETTLED` (2026-08-14)
A Dungeon Alchemist export used to mean typing its DPI into Grid Size, and a compressed map broke
that trick: the right size became 150 × 3840/srcW, which nothing on screen could tell you.
Derived instead as **pixels across divided by squares across** (`mapWidth / squaresX`), not from
the plan's own `pixels_per_grid`. The division self-corrects any resolution mismatch, the same rule
`vttScaleRooms` already uses for the rooms; reading the file's own number would hand back the
untouched export's value and put the grid out of step with the map on screen. `vttDerivePlan` gained
`squaresX`/`squaresY`/`gridPx` additively; the clamp to the control's 10–400 range and the writing
of both slider and chip live in `floorPlan.js`.
**The import path only, never `applyPlanToScene`.** Draw Rooms runs that function again at any
later point, and a hand-tuned grid has to survive it - auto on first load, the DM's value wins
forever after. **Size, not offset:** `map_origin` means a correctly-sized grid can still sit out of
phase, and deriving the offset too was judged the wrong trade against a manual nudge. A map with no
plan gets nothing, and no hint about the shrink factor either; both accepted, not gaps.

### Grid calibration measures a square across N cells, not one cell and not automatically · `SETTLED` (2026-09-09)
Three flows were prototyped in a throwaway harness and judged in the running app. The gesture that
shipped is described in ARCHITECTURE.md; what follows is why it beat the other two.
**The box is forced square**, which is what made this flow win: a cell is a square, so one
side carries the whole reading and the second axis contributes nothing but a chance to disagree
with the first. Rejected on the way: sizing from ONE cell between two draggable anchors, which
asks for a precise gesture over the shortest distance available; and Owlbear Rodeo's three gated
steps, which walk the DM through sizing a cell on maps a floor plan already sized. Owlbear,
Roll20 and Foundry all size from a FIXED 3x3 sample and then correct drift at a distance. An
adjustable count is that same shape and also serves a large map, at the cost of a guess that has
to be confirmed.

### A hex grid calibrates corner to opposite corner · `SETTLED` (2026-09-24, reverses the centre press below)
Pressing a cell centre asked the DM to aim at a point the map does not draw. Dungeon Alchemist
bakes the hex lines into the image and exports only pointy-top hexes, so the corners are the
visible marks. The drag runs from one corner to the opposite corner of one big hex, snapped to
the nearest of the six corner directions, and the grid's hexes draw inside it. A straight line of
hexes was built first and dropped the same day: along a corner diagonal neighbours touch only
through a wall, so it drew separate hexes with gaps. An odd-only count was built and dropped the
same day on product grounds: an even count centres the big hex on a wall so four of its corners
miss the grid, and that costs less than a stepper that skips numbers. The hex the pressed corner belongs to
becomes the offset, so what `gridOffset` stores never had to shape the gesture; the stagger rule
below still applies to it.

### Calibration hides the DM's grid · `SETTLED` (2026-09-24)
It used to force the grid on for the gesture, as the Door tool does. The old grid over the map art
is the one thing the DM is not aiming at, so it now hides, and the shape draws its own cells.

### A hex grid calibrates from a cell CENTRE, and the phase must undo the stagger · `REVERTED` (2026-09-24, shipped 2026-09-09)
Reverses the refusal filed a day earlier, which held that a dragged square would write a hex's
circumradius as if it were a square's side. The gesture draws the shape the grid is made of, so
the objection disappears: press a cell's middle, drag out a circumradius, and the count divides it.
The press is the CENTRE rather than a corner because a hex grid's `gridOffset` names where a
centre sits, not a vertex.
**The phase is where this goes wrong quietly.** `drawGridLines` offsets alternate columns
(flat-top) or rows (pointy-top) by half a step, so taking both offsets as a plain modulo of the
centre-to-centre step lands the lattice half a cell from the point pressed - for every odd index,
which is about half of all presses. The anchor's own stagger comes off before the modulo.
Measured 92.38px out on a 106px cell before the fix, 0.0000px after, over both orientations.
The correction handle stays square-only; a staggered lattice with two axis steps was judged too
much for the same session.

### Finding the grid from the map's own pixels · `REJECTED` (2026-09-09)
A detector was built and tried: sum the absolute gradient down sampled rows and columns, recover
the repeating period and its phase from those profiles, set the grid from that. It recovered
synthetic profiles to within 0.08px and came out wrong on real Dungeon Alchemist exports, so it
was dropped rather than pursued. The maths is not where it failed; the profiles built from a real
map are. Two dead ends inside it are worth not repeating. Scoring a candidate period by the mean
energy under its teeth makes every MULTIPLE of the true period win, because a sparser comb
averages fewer samples - the answer is a significance score weighted by the square root of the
tooth count. And an integer comb scan cannot find a fractional period at all, because it walks
off a 94.4px grid within a few cells while a multiple of it drifts three times slower - the answer
is an autocorrelation coarse pass. It is also the wrong gap to close, which is the reason this
stays shut rather than parked: a Dungeon Alchemist export already derives its cell size at import
(the entry above), so reading pixels would serve only maps with no plan - and those now have the
calibration gesture, which lands within 0.1px by hand.

### Owlbear Rodeo's automatic fogging is not a template · `REJECTED` (as a model)
Their "Forecast" feature is a server-side computer vision pipeline gated to their top paid
tier, which an offline `file://` app cannot replicate at any effort. Worth knowing for a
second reason: with cloud compute and a purpose-built pipeline they still ship Slice, Trim and
Join to correct its output. Any local pixel approach should expect to need correction tools
too, which is a further argument for reading vector data instead.
