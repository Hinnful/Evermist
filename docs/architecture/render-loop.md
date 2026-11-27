# Architecture - how the render loop works

Split out of [ARCHITECTURE.md](../ARCHITECTURE.md): the frame loop on the PixiJS ticker and what marks a frame dirty, in the present tense.

Everything the app draws rides **one clock**: the PixiJS ticker.

Each layer has a dirty flag. When you pan, the viewport is marked dirty; when you paint,
the fog is marked dirty. Once per tick, `doRender` looks at the flags and redraws only what
changed, which is why painting fog doesn't force the expensive map layer to redraw.

The part that's easy to get wrong: `doRender` is registered **on the PixiJS ticker itself**,
at a priority above Pixi's own render, rather than running its own animation loop. Two
independent loops at the same frame rate drift out of phase, and the Canvas-2D layers start
leading the WebGL map, which looks like the grid sliding against the map during a pan. One
clock keeps them registered to each other.

The frame rate is capped at 30fps. There's no user-facing control for this. A tabletop map
doesn't need 60, and the TVs barely support it. The Player's cap rises to 60 while a fog change
or the cover moves, then returns to 30, and its fog uniforms refresh every ticker frame.

Fog reaches the TV as raw ImageData, not a PNG. Discrete fog edits (room fog buttons, Reveal/Hide
all, doors, undo/redo) send at once; brush strokes keep the 300 ms debounce.
