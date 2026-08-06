---
name: floor-plan
description: Load BEFORE editing src/vttPlan.js or src/floorPlan.js. Also load when the task mentions the Universal VTT / .dd2vtt floor plan, auto-generated rooms, the Draw Rooms button, open-wall reporting, or the find-floor-plan IPC. Carries rules whose violation silently produces wrong rooms rather than an error.
---

# Reading a Dungeon Alchemist floor plan

Binding rules for the auto-polygon path. Every one of these fails **silently** if broken -
the app produces rooms, they are just wrong.

## Coordinates

- **The file's coordinates are GRID SQUARES, not pixels.** 1 square = 5 ft. Work in squares
  for the whole derivation, so every tolerance is resolution-independent; a tolerance
  applied in pixels needs re-tuning for every map.
- **The final conversion is `(coord - map_origin) * pixels_per_grid`, never just the
  multiply.** Drop the origin term and every room comes out correctly shaped and uniformly
  displaced - invisible on a zero-origin export, wrong on any other. A test pins it against
  a deliberately non-zero origin.
- `map_size × pixels_per_grid` equals the sibling map's own pixel size at uniform scale 1.0,
  so the grid calibrates itself and no manual alignment is needed for a DA map.

## The derivation

- **Union `line_of_sight` with `portals[].bounds`.** Walls alone have a gap at every opening
  and are not a closed plan; the portals fill those gaps exactly and share endpoints.
- **Never read `objects_line_of_sight`.** It is vision-blocking props - columns, boulders,
  crates - so unioning it turns every pillar into a fake room inside a real one. Ordinary
  furniture never appears there: a fully furnished test room produced an absent field.
- **Split edges at T-junctions.** A wall abutting another mid-span is the normal way DA rooms
  share a wall, and the face walk cannot turn at a junction the graph does not know about.
  Skipping it costs real rooms.
- **Classify faces by WINDING, never by area.** Interior faces come out of the
  clockwise-turn walk with positive shoelace area and each island's outer boundary with
  negative. Area looks like a usable signal right up until a map holds two detached
  buildings, and then the smaller building's own boundary outranks a real room.
- Every tolerance is a **named exported constant with a test pinning it**. Coincident
  endpoints are not safe to compare with exact float equality; half the segments on a real
  map are diagonal or curved.
- A plan that yields nothing returns **empty arrays, never a throw**. Callers must not offer
  to draw zero rooms.
- `JSON.parse` is the **caller's** job and is wrapped in try/catch there: a truncated
  `.dd2vtt` must behave exactly like no plan at all, because an unhandled rejection in the
  import path strands the map-progress overlay forever.

## What the feature refuses to do

- **Gap closing is deliberate, and bounded.** An archway with no door still bounds a room the
  DM wants to shroud, so a wall end bridges to whatever it almost reaches within
  `VTT_CLOSE_GAP_MAX`. It reverses an earlier refusal to auto-close. Three things keep it
  safe and all three must stay: the bridge is a straight line between two points the file
  already contains, two loose ends join only when they are each other's nearest feature, and
  `VTT_MIN_FACE_AREA` refuses the sliver a corner bridge can chip off. Beyond the ceiling the
  room is refused rather than guessed at.
- **A loose end must never measure its own wall.** Skipping edges incident to the end is not
  enough: projecting onto a SIBLING edge clamps to the corner they share, so the end reports
  a gap the length of its own wall and then bridges to a node it is already joined to. Both
  the edge list and the projected foot need the neighbour exclusion.
- **Nothing can close a wall that is simply absent**, only a gap between two ends. A room
  missing a whole wall stays refused, and that is correct.
- **No cave subdivision.** There is no ground truth for where one cave ends. Per-chamber
  rooms are the split tool's job, not detection's - the cavern outline is already accurate.
- **A doorless wall loop is solid, and its faces are refused.** A run of walls that closes
  on itself with no portal anywhere is rock, not a room. Two things make it safe and both
  must stay: it is judged on the WHOLE connected run, so a windowless cellar keeps its
  building's doors, and it is computed BEFORE the portals are unioned in, because
  afterwards every chain is a loop. T-split the wall-only graph first, or a door in one
  wall leaves the other three looking like an untouched ring and the building is refused.
  A floor that is one sealed room comes back empty; that is the accepted cost.
- **A wall stub must never bridge into a doorless wall.** Compute them BEFORE closing and
  pass them to `vttLooseEnds` as targets to skip. Otherwise both ends of a room's open side
  bridge into the nearer rock, which glues the wall to the cave, closes nothing, and spends
  the ends so they never find each other - the room is then silently lost into the cavern.
- **A mutual pair of loose ends reaches `VTT_CLOSE_PAIR_MAX`, a stub reaches
  `VTT_CLOSE_GAP_MAX`.** Both ends picking each other is far better evidence than a stub
  projecting onto a wall's mid-span. Tightening the base ceiling must tighten the pair
  ceiling with it, or `closeGapMax: 0` stops meaning "no closing".
- **No door or window rendering.** Portals carry no type field, so doors and windows are
  indistinguishable, and secret doors would hand the players a map of every hidden passage.
- **No room naming from module text.** Nothing in the file to match on. Rooms arrive as
  `Room 1`..`Room N` and the name-field dropdown fills them.

## The app side

- **Electron only.** Finding the sibling file needs the preload bridge, so under `npx serve`
  or bare `file://` no plan is ever found. Degrade to silence, not to an error.
- **Main resolves the sibling path itself.** `find-floor-plan` takes the map's path and reads
  `<same dir>/<basename>.dd2vtt`; it must never accept an arbitrary path to read. A floor
  plan is untrusted input.
- **Store the plan on the scene in the pass that creates it.** `persistVideoMap` copies the
  map into `userData/maps`, so afterwards it no longer sits beside its `.dd2vtt` and a later
  disk lookup finds nothing. Both `backup.js` field whitelists must carry `floorPlan` or
  export silently drops it.
- Importing is **wipe-and-rebuild**, so it runs the full wholesale-polygon chain: `pushUndo`,
  null `activePolygon` and `selectedPolygonId`, then rebuild fog and `refreshRoomPanel()`.
  Without the selection reset the room card stays open on a room that no longer exists.

## The offer is a notice, not a dialog

- **`#fp-notice`, no backdrop.** A found floor plan is good news, not a question that must be
  answered before the map can be touched. A modal here blocks panning and zooming the very
  map it is talking about. One CTA, one close.
- **It says the room count and the map name, and nothing else.** No coordinates - they are
  unreadable as text - and no open-wall report: a gap is an edge case, and putting it in the
  first thing the DM sees costs more attention than it earns. The kernel still finds every
  gap and `openWalls` still carries it, so a cheaper home for it later stays open.
- **Only a destructive step gets a dialog.** Pressing Draw Rooms draws; a confirmation for
  something explicitly asked for is noise. Replacing rooms that already exist is the one
  case that asks.
- **Draw Rooms lives in its own `Rooms` group**, never as a third button beside Reveal All
  and Shroud All. Those two paint fog and this one creates rooms; three identical outlines in
  a row said they were the same kind of thing.
