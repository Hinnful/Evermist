# Decisions - rooms and the room card

Split out of [DECISIONS.md](../DECISIONS.md). What was decided about drawing, repairing, editing and labelling rooms, and where the room is edited, and why it held.

Status tags and the paragraph budget: see the main ledger's header.

---

### The room card became the dock's Room tab · `REVERTED` (2026-10-08, the left panel)
The floating card, its placement and its drag are gone; the selected room is edited in the left
panel now, and the dock has no Room tab.
The entries below on the card's position and shape are the record of the old shape. The calls it
reverses: [decisions/ui-and-control-panel.md](decisions/ui-and-control-panel.md), "The dock".

### Room repair leans on a vendored clipping library · `SETTLED` (2026-09-02)
Join and Trim run on `polygon-clipping` 0.15.7, vendored to `lib/` as its UMD
build and pinned as a devDependency for the tests. A hand-written boolean kernel was rejected:
union and difference over hand-drawn cave outlines is a known hard problem, and the library
fails loudly where a hand-rolled one fails quietly.

The library throws from fourteen sites. Every call is wrapped, and a throw becomes the same
refusal a rule-based rejection produces - the cost of letting one escape is spelled out at the
wrapper in `roomOps.js`.

### Repairs act on what a shape overlaps, not on a selection · `SETTLED` (2026-09-02)
**Reversed in part 2026-11-19 (5.15.0): picking several and pressing a boolean is back; see "Several picked, and the first pick leads" in decisions/ui-and-control-panel.md.** Drawing with Shift, Alt or Ctrl still repairs as described here. The "most hidden fog" call below is reversed too: a merge takes the first pick's fog.
Figma's model - select two objects, press a boolean - was rejected because the app holds exactly
one `selectedPolygonId` and building multi-select was the expensive half. Owlbear's model shipped
instead: pick a mode, draw a shape, and it combines with every room it lands on. One drag joins
two rooms with no selection at all.

Three calls fell out of it. A join takes the **most hidden** fog mode of its parts, never the
earliest one's, so it cannot hand the table ground that was shrouded a moment earlier. A result
that would leave a hole is refused whole, because a room is one ring of points and storing a
second one would change every saved scene — **reversed 2026-09-12, a repair now leaves a hole.**
And rounding and door marks were dropped rather than remapped — **reversed 2026-09-17: see "A
repair carries the curve, the radius and the door" below.**

### Cut is its own geometry, not a thin Trim · `SETTLED` (2026-09-02)
**Reversed in part 2026-10-16 (see "The fog and the toolbar are rebuilt for a first-time DM" in decisions/ui-and-control-panel.md):** Split is Ctrl on a shape.
With a Rectangle or Circle it divides along the shape's edge (`splitShapes`, the library's difference and intersection);
with the Polygon it is the open line below. Today's line split survives as that Ctrl-with-Polygon path.
Trim can already split a room by removing a strip, so a separate Cut looks redundant. It is not:
the strip leaves a gap, which is correct on a dungeon where the gap is the wall, and wrong in a
cave where it puts a fogged line across open rock. A repair that leaves no gap whatsoever is not
something a difference operation can produce, so Cut is hand-written ring walking in
`roomOps.js`, deliberately outside the clipping library; `cutRing` says how it keeps the two
pieces flush.

### A wall curves through bezier handles, and the bend gesture sets them · `SETTLED` (2026-09-17)
A wall is a cubic between its two anchors, and each anchor carries `{ix,iy,ox,oy}` — offsets to
its incoming and outgoing control point, flat-indexed beside `cornerRadii`. Ctrl+drag a wall bends
it and Ctrl+click straightens it, Figma's own gesture; no Bend tool went on the bar - **reversed 2026-11-19 (5.15.0): Bend is a tool in the edit row; Ctrl still bends.**

**A single bow number per edge was proposed and rejected the same day.** It gives a symmetric arc,
and a bend has to lean toward where the wall was grabbed: the drag is shared between the two
control points by their weight at that point, which is what a bow cannot express. A bend dragged
back near straight snaps flat, so undoing one needs no key.

**The two handles are INDEPENDENT, and a mirrored rule was rejected with them.** A round tower
meeting a straight corridor needs a sharp corner between a curved wall and a flat one, and
mirroring would smooth every anchor. **An anchor carrying a corner radius OR handles, never
both, is REVERSED** — see "A corner may carry rounding and a curve at once" below.

Offsets rather than absolute control points, because a handle then rides its anchor through a
move, a rotate and a scale with no work at all.

### A corner may carry rounding and a curve at once · `SETTLED` (2026-09-21)
**Reverses the "never both" call above.** Figma keeps the radius on an anchor with bezier
handles, and the standing rule for this epic is to copy Figma when unsure. `computeFillet`
(`fogGeometry.js`) fillets a curved side against its own tangent at the point the fillet starts,
rather than the chord to the far vertex, and reprojects the fillet circle's tangent point back
onto the curve so the drawn segment and the arc meet within sampling tolerance. A curve whose
tangent leaves no sane fillet — nearly parallel to the other side's line — is refused rather than
drawn as a wild, distant arc, the same "refuse rather than guess" rule auto-polygons already uses.
The room card's radius field, the wall-bend gesture, and a repair's restore path all stopped
clearing the radius; an effect's own rounded outline shares the identical fillet, moved into
`fogGeometry.js` as `roundEffectRing` so the fog pipeline and an effect round a curved corner the
same way.

### The bounding box is axis-aligned, and no angle is stored · `SETTLED` (2026-09-18)
Figma keeps its box tilted with a rotated object, which needs an angle stored per shape. A hole has
nowhere to keep one: `holes` is re-indexed by a delete and rebuilt entirely by a repair, so a
parallel array of angles would fall out of step and a tilted box would have shipped for rooms and
not for holes. A rotate therefore rewrites the points and the box re-derives from them.

The cost is that resizing a turned room works along the map's axes rather than the room's. Accepted
because one rule covers a room, an effect and a hole, and because the alternative breaks the rule
that anything a room can do, a hole can do. Reversible: storing the angle is additive, and an older
build ignores it because the vertices are already in world coordinates.

### A copy lands on the pointer, and the clipboard outlives the scene · `SETTLED` (2026-09-18)
Batch 4 of the vector editing epic, and the last one: Figma's Ctrl+C, Ctrl+V and Ctrl+D, and its
rule that a paste centres on the pointer. A copy keeps its name, its description and its fog state,
so a revealed room pastes revealed.

**The clipboard is a module variable**, which is what lets it outlive a scene switch - copying a
guard post between floors is the case the feature exists for. **It remembers which list it came
from**, so an effect pastes among the effects from Rooms mode with no change of mode, drawn faint
until the mode changes. **A hole pastes as a hole** into the shape under the pointer, held to
`holeStaysOnRoom` so it can never land where a drag would refuse to leave it.

**Ctrl+D on a hole takes the room the hole already sits in, by name** - a hit test on the offset
point hands the copy to an overlapping neighbour. It never lays a ring over the original: a
duplicate nobody can see is worse than one that never arrived, so the opposite offset is tried and
a `noticeToast` reports a hole with no room left. **`tools.js` was not touched**, so the slice the
epic records as outstanding stays outstanding.

### A hole is a level of its own, not a second thing on screen · `SETTLED` (2026-09-18)
A box and a vertex set are never drawn together, so a picked hole needed somewhere to put its own
box. It became a third level, matching how Figma descends into a boolean group: a double-click opens
the room, a click boxes a hole, a second double-click opens the hole's corners, and Escape climbs
back one step per press. Only one level answers the mouse at a time - a boxed hole answers through
its box alone, and an open hole answers on its own ring - because a hit test that outlives what the
app draws lets a press reshape a room by landing on nothing.

### A repair carries the curve, the radius and the door · `SETTLED` (2026-09-17)
**This REVERSES the 2026-09-02 call above**, where Join, Trim and Cut dropped `cornerRadii` and
`doors` from every shape they touched. The drop was cheap and it threw away work the DM had done
by hand on walls the repair never came near.

`shapeDetail.js` holds both halves. A curve is sampled into straight points on the way into the
clipping library, and the answer is matched back onto the walls it came from by coordinate — the
library repeats a surviving input point bit for bit. Each surviving stretch of wall is put back
with de Casteljau, so a wall the repair passed by keeps its shape to the last decimal and a wall
it cut through keeps the half that survived. A corner radius rides its anchor.

**A door whose wall the repair removed is the one thing with nowhere to go.** It is dropped and a
`noticeToast` says how many went — a self-clearing line, because a repair comes in runs and a button
on each one is friction. A radius lost with its corner raises nothing; the cut that took it is the
one just drawn.

**⚠ ONLY THE FLATTENING'S OWN SAMPLE POINTS MAY BE DISCARDED,** and they are keyed for it. A repair
puts new corners exactly ON a wall - a Trim's notch does it four times - and matching by distance
alone reads those as sampling, deletes them and widens the cut. Caught by `room-repair.js`.

### A saved room with a curve persists as a shroud · `SETTLED` (2026-09-17)
The same call the holes feature made in 2.11.0, extended. An older build draws a bent wall as the
straight line between its anchors, so a wall bent inward would uncover ground the curve was cutting
away — fog failing OPEN on the TV after a rollback. Such a room is written as a shroud carrying its
real mode. **`modeWithHoles` keeps its name and covers both**: an old build ignores the field
either way, and a second field would mean a second decode branch for no gain.

### Doors ride a curved wall on its own arc · `SETTLED` (2026-09-17)
A door is `{edge, t}`, and `t` is a fraction of the wall's LENGTH. `doorEdgeFrame` now builds the
sampled arc of a bent wall and reports its arc length, so a notch placed at a half stays halfway
along the curve instead of sliding to the chord. The notch's own direction and normal turn with
the wall, and the normal KEEPS THE SIDE the straight frame chose: a curve can reverse the sign of
its perpendicular, which would carve the notch into the room.

The bezier parameter and the fraction of length are not the same number on a curve. Geometry is
cut by the first and a door is placed by the second, which is why `wallParamAt` answers with both.

### A hole is a field on the room, and the gesture decides · `SETTLED` (2026-09-12)
A room or an effect gained `holes`, an optional flat list of inner rings beside `vertices`, one
level deep. Two alternatives were rejected: a general `rings` array, which changes every read site
and rewrites every saved scene, and a child record with a parent id, which fights the rule that
array order is fog compositing precedence and puts the hole in the room card as a room.

**The gesture decides what you get.** Cut or Trim against an existing shape makes a hole on it;
drawing always makes a new room, even inside a courtyard. So a hole can never nest, which is what
keeps `holes` one level deep. `REASON_HOLE` went with it - that refusal was the feature's absence.

Every vertex and edge index the editing paths carry is FLAT across the outer ring then each hole,
so `selectedVertexIndex` and `edgeDragIndex` stay plain integers.

### A room with a hole persists as a shroud · `SETTLED` (2026-09-12)
`/rollback` is a supported path, and a build predating this feature ignores `holes` entirely. Left
alone that is fog failing OPEN on the TV, so the persisted mode is rewritten to fail closed
instead; `encodeShapeForSave` in `fogGeometry.js` carries the rule. Backfilling old scenes was
rejected: absent `holes` is byte-for-byte the record that always shipped, and a normalising pass
over a fixed key list is what drops `cornerRadii`.

### The fire shader marks ring starts per vertex · `SETTLED` (2026-09-12)
A bagel-shaped effect needs each ring closed at its own first point, or the distance walk bridges
the outline into the hole and fills it. Ring start/count uniforms were rejected: indexing `uVerts`
by `start + j` is dynamic array indexing, which WebGL1 does not guarantee. A `uBreak` float per
vertex is read by the loop index alone, and is derived AFTER decimation so a ring that lost points
still closes in the right place.

### The room LIST · `REJECTED` (reopened 2026-11-12 for the Notes tree, see "The Notes tree uses the library pattern")
A full Rooms tab with a vertical room list (rows, `listOrder`, drag-reorder, 3-state pill,
click-to-jump, hover-to-outline) was built and then rejected on UX grounds: **the map is
the better interface**, because it is the biggest target on screen and it shows an actual
room instead of a room's name. Killed with it: `listOrder`, drag-reorder, pin/dock for the
card, search over descriptions, read-mode vs edit-mode, per-room thumbnails.

### Card position and description height are user-controlled, not computed · `SETTLED`
The card floats over the map, so the DM drags it and double-clicks the bar to send it back.
The description height is one global preference, because a box's height belongs to a screen
rather than to a room. **Partially reversed 2026-08-06 — see the entry below: automatic
placement now clears the room's whole outline, so it is no longer true that no placement
rule is worth having. The drag stays; it is the escape hatch, not the only mechanism.**

### Automatic placement clears the room's whole box, not its centre · `SETTLED` (2026-08-06)
The card used to be anchored 22px off the room's **centroid**, so any room bigger than the
card swallowed it, and selecting a room to edit it covered the thing being edited.
`clampPanelPosition` now takes the room's screen **bounding box** and takes the first side
fully clear of it: above, below, right, left.

Two consequences that are not optional. Placement is recomputed on every repaint, so a
vertex or edge drag reshaping the room under the pointer made the card flip sides mid-edit;
it is now **held still for the length of such a drag** and re-placed once on release. That
release re-place also had to be added to all four drag-release paths in `tools.js` — without
it the card only caught up on the next pointer move.

**The residual case is arithmetic, not a bug.** If no side has a clear band as large as the
card, no placement can be fully outside the room; the fallback pins the card to the viewport
edge furthest from the room. Card height is the lever, and most of it is the DM's own saved
description height.

### Drawing a room does not select it · `SETTLED` (2026-08-06)
Finishing a rectangle, circle or polygon used to set `selectedPolygonId`, which opened the
room card over the map exactly as the next room was about to be drawn. Rooms are now created
unselected, matching what floor-plan import already did, and naming becomes a deliberate
second pass with the Select tool.

**Not done by gating the card on the active tool** — visibility stays keyed to selection
alone so the card survives tool switches. Also rejected as answers to the same complaint: a
delay before the card opens, and a collapsed card state. Both add a mechanism to soften a
behaviour that simply should not happen. The fog crossfade direction was checked and does not
depend on the selection: the creation paths read `tool` / `poly.mode`, and the paths that read
`selectedPolygonId` are all drag paths that only run in Select mode.

### Axis-lock is an alignment snap, not a pointer constraint · `SETTLED` (2026-08-06)
The straighten-walls toggle does **not** clamp mouse movement to a horizontal or vertical
track. It snaps a point onto a reference point's exact x or y when it is already within a
threshold of sharing one, and leaves genuinely diagonal segments alone. The goal is
straightening a nearly-straight wall without a steady hand, which an alignment snap does and
a movement lock does not — a lock also makes a deliberate diagonal impossible to draw.

Details that matter: the threshold is SCREEN px divided by `zoom`, so the slack feels the
same at every zoom; only the axis with the smaller deviation snaps, so a near-45° segment
cannot flip unpredictably between them; drawing references the previous vertex, a vertex drag
references both ring neighbours. Grid snap runs first and axis-lock layers on top, so on an
aligned grid coordinate it is a no-op. Whole-polygon and edge drags are deliberately excluded
— neither changes any wall's angle. Runtime-only state, like `snapToGrid`: not per scene,
not in a backup.

### A `ResizeObserver` on the description · `REVERTED`
Everything ugly about it followed from it firing continuously: a debounce, a 0×0 guard, and
a real bug where re-clamping every tick slid the card up under the pointer during a
downward resize drag. Replaced by a `mouseup` listener. **The transferable lesson: when a
mechanism's own chattiness is generating its guards, the mechanism is wrong.**

### `RP_DESC_H_MIN` / `RP_DESC_H_MAX` JS constants · `REVERTED`
CSS `min-height`/`max-height` already clamp anything written to `style.height` (verified:
9999→620, 1→120), so they guarded nothing and needed a "keep in step with the CSS" note.
The note was the tell.

### A title on the drag bar · `REJECTED`
It briefly read "ROOM", directly above a field placeholdered "Room name": the same word
twice, and noise the moment the room is actually named. There is nothing else a title here
could say, because the card only ever shows a room. The six-dot grip advertises what the
bar *is* instead.

### The name field's alignment · `SETTLED` after three half-solutions
The trap: the 14px column is where **boxes** start and 24px is where **text** starts, and
the description is itself a 10px-padded field, so matching its box puts the name on both
columns at once. Earlier passes read "everything starts at 14px" as being about text and
stripped the name to a bare underline, buying a clean rest state at the cost of the focus
state. Verified by measurement: name, description, fog pill and Delete all share
left=75.4 w=288.4.

### The screen-px → pre-zoom-px mapping is affine · `SETTLED`
Two earlier versions got this wrong. Assigning screen px raw drifted the card ~20% off the
room; dividing by the slope alone left a constant ~8px offset that automatic placement hid
but a drag exposes as a jump on grab. Both the slope and the ~9.6px horizontal origin are
derived from measurement.

### A `roomRadiusMode` toggle · `REVERTED`
A flag in `state.js` plus a toggle button, both removed: it was a control for a decision the
selection had already made, and two things to keep in sync. The radius field derives its
target from `selectedVertexIndex` and swaps its own glyph to say which.

### The `v3/8` vertex readout · `REVERTED`
It reported what the map already shows by highlighting the selected handle, in a notation
opaque enough that nobody wanted to admit not knowing what it meant.

### A second properties row, a label column, a leading icon on the name · `REJECTED`
All three cost height, and the description is the card's scarcest resource.

### A destructive button should keep the standard shape · `SETTLED`
Delete is a full-width `.cp-btn` with `.cp-btn-danger` behind a hairline footer. The
hairline is what stops it reading as the primary action. Shrinking it to signal danger only
costs it the shape every other button in the app has.

### Room notes are DM-only for free · `SETTLED`
Polygons never cross to the Player (fog crosses as pixels, `initScenes()` is DM-gated), so
there is no channel to strip and no guard needed. Area markers, when built, will not get
this for free.

### The card shows everything, and the description is load-bearing · `SETTLED`
Whether the description is actually wanted on screen, or whether a room name alone would do,
was an open question that sized half of module text import. Answered: the full card - name,
description and fog controls together - is the point. The description half of the import
feature is therefore load-bearing, and the confirm-before-overwrite machinery is correctly
scoped rather than over-built.

### Rooms and effects draw as areas, not outlines · `SETTLED` (2026-09-22)
The stroked, glow-heavy outline gave way to a translucent wash carrying the fog state, a soft
inner edge, and a thin line separating neighbours. Two other ways to signal "this one is open
for editing" were prototyped and rejected: a Figma-style diagonal hatch over the fill, and a
hollowed-out fill with a brightened border. The line simply turning white on entering edit mode
won, since it changes nothing about the fill a DM is reading for fog state.

### A shape's bounding box keeps only its four corner handles · `SETTLED` (2026-09-22)
The box's four edge-midpoint handles - a single-axis stretch - were dropped after they read as
extra room vertices once their count matched a simple room's own four corners. Corner-drag scale
survives; single-axis resize has no replacement handle.

### A room picture comes and goes in patches of fog · `SETTLED` (2026-09-30)
Ten entrances were prototyped side by side: a blur-and-settle, a slow zoom, a dropped card, a
soft-edged circle, a darkroom develop, and five built from cloud noise. The plain noise dissolve
won, patches appearing at random and joining, at 1.9s in and 1.0s out. A CSS mask regenerated per
frame was rejected before it shipped: each new mask image decodes asynchronously, and the bare
picture can flash between two of them. A canvas draws the frames instead.

### Maps no longer import by a drop on the window · `REVERTED` (2026-09-30)
A map dropped on the DM window used to import like a picked one. It went when the room card started
taking picture drops, so a picture missing the card by a few pixels cannot become a scene. Maps come
in through the "+" picker; a floor plan dropped on its own still attaches to the open scene.
