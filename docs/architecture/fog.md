# Architecture - how the fog works

Split out of [ARCHITECTURE.md](../ARCHITECTURE.md): the fog mask, its clouds, themes and the half-shroud, in the present tense.

The fog is the heart of the app, so it's worth understanding.

1. **A low-res hidden/revealed map.** Behind the scenes there's a small canvas, a quarter of
   the map's size for speed, that records one thing per pixel: is this spot **hidden**
   (navy) or **revealed** (transparent)? Painting with the brush or dropping a reveal shape
   edits this canvas.

2. **Two sources, combined.** Brush strokes are kept on one layer. The reveal/hide shapes
   (rectangles, polygons) are kept as editable objects. The final hidden/revealed map is
   those two combined. Keeping shapes as objects is why you can re-select and edit a room
   you carved out earlier.

3. **Making it look like fog rather than a stencil.** That hard-edged map is blurred and
   overlaid with a drifting **cloud texture** (procedural noise). This is the "living fog":
   soft edges and slow motion instead of a flat black cutout. The texture doesn't only slide
   across the screen, it also slowly changes shape, which is what stops the fog reading as one
   repeating pattern on a conveyor belt.

4. **A fog theme, picked by name.** Map settings' Fog row is a five-icon pill of fixed themes
   (Default, Blood, Toxic, Ice, Fire). There is no custom colour, tint, movement
   preset or movement switch; each theme carries its own colour, tint and motion. Every theme shares
   one base: cloud volume lit from the top left, a living edge, depth layers, clouds at room size
   and fog darker against walls. Default adds slow breathing and pale depth haze (base #1A1A2E); Ice
   adds a honeycomb icy edge, near-still motion, soft glints, crystal growth and a light sweep.
   Blood is slow, with a wet sheen, dried patches, even blood vessels, a few hearts beating on their
   own and a thin dark edge. Toxic has fumes, a glow from below, bubbles, sparse corroded patches and
   a thin acid edge. Fire rises, lit from below, with a burning edge, rising sparks and rare small
   flames. The Player's fog pass cannot read the map under it, so no theme distorts the map.
   Each scene remembers its theme as `fogTheme`, saved beside `weather` (Default is an absent
   field), and it rides through Export/Import. `fogSettings` is passed through untouched. A theme
   stays inside fogged rooms and never seeps into revealed ones. All themes share Default's cloud
   warp, so a switch never rebuilds cloud frames. The Player has one shader per theme, the theme
   baked in as a constant, compiled and drawn once at launch; edge effects read three blurred
   copies of the fog mask built on the CPU at a capped 960x540, and the shader returns early on
   clear ground. Shrouded rooms are grown by a 2px stroke in the mask so two hidden rooms sharing a
   wall leave no seam. A pick reaches the TV like a colour change, colour and motion together (in
   Manual it waits for Send, a held TV holds it, and on a map switch it changes during the close),
   and on the Player it also recolours the area around the map.

   **A fog change on the TV is not a uniform crossfade.** Room reveal/hide, brush and Reveal/Hide
   all give each pixel its own progress: a CPU rank (noise shaped per theme, rank-normalised over the
   changed region plus a ring round it so edge effects follow) and a start time per change, so
   overlapping changes run independently, and a change landing on pixels still moving starts from a GPU bake of what the TV shows. `fogTransitionPlan.js` is the pure kernel, `playerFogTrans.js` holds the order
   texture, the overlapping changes and the outgoing mask, and `playerFogShader.js` the shader
   source. Each theme's `trans` record carries `dur` (about 1.5-3.2 s), `front`, `tint`, the GLSL
   `fogStep`/`screenRank` and its CPU rank. Default parts like clouds with fuzzy edges and a soft
   pale line; Ice creeps from the walls in on hide and thaws from the middle on reveal; Fire burns
   like paper; Toxic rusts in ragged pits; Blood drips down in blots. Transition lines keep a constant
   screen-pixel width (`fwidth`), so the Player's fog programs compile as ESSL 3.00 on WebGL2, with a
   fixed-width fallback. Fire's fog also wavers (heat shimmer), strongest deep inside, zero at the
   edges.

   **Doors glow on the TV.** The DM sends the lit notches (`doorLightQuads()` in `toolDoor.js`: four
   corners and width of each notch the fog carves, only doors `doorGlows` passes) on both `fog-update`
   messages as `doors`, since rooms never reach the Player; the Player keeps them in the
   non-persisted `doorLights` global. `playerFogPass.js` builds a door-light texture beside the mask
   at its UV (red = the notch blurred by a sixth of its width, green = the notch), rebuilt only when
   the list or size changes, and `playerFogShader.js` samples it once (`uDoor`, `uDoorCol`, the colour
   crossfading with the theme). A door glows only where it leads from a revealed room into fully hidden
   fog (`doorGlows` in `doorGeometry.js`, decided on the DM side; a wall only one room runs through has
   hidden fog beyond it). The glow, in the theme's `doorLight` colour, spreads from a lit notch into fog that
   stays fogged, fading over about a third of the door's width, and the map in the notch is
   lifted about 25% (additive). It never thins the fog, so nothing past the door shows. It follows the
   fog's own reveal/hide change and is gone where both sides are revealed. The DM view draws none. A
   newly placed door's light appears at once rather than fading in.

5. **The DM sees through it, players don't.** On the DM screen the fog is semi-transparent
   so you can plan. On the Player screen it's fully opaque. This matters when judging any
   fog setting by eye: the DM window shows roughly half the density the TV does. It shows the
   theme's colour only; holding H shows it at full strength, and the full theme draws on the TV only.

6. **A third state: half-shroud.** A room can be marked Half, which leaves it at partial
   fog density instead of clearing it. It's an absolute setting, not a partial erase: the
   room lands on the Half density whatever was there before, so marking a room the party
   has already walked through does dim it back down.

7. **The fog is also what covers a scene switch.** Changing scenes on the TV isn't a screen
   fading to black and back. The fog closes over the map the party is looking at, holds while
   the next map loads, then clears off the new one - the cover closes in 3 s and opens in 4 s. The
   fog moves in the theme's own hide (close) and reveal (open) over the whole screen. While it
   is fully closed nothing is revealed at all, which is what lets the map underneath change
   size, shape and camera without anything showing; the cover reaches every mask read, the blurred
   near copies included. Between two themes the incoming one washes over the outgoing in its own
   hide style under the closed cover (1.8 s), the outgoing keeping its colours; a live theme pick
   on one map switches at once and blends the two looks over 1.5 s in one composited pass. The cloud texture and theme
   patterns hold their size and position across the swap instead of resizing to the new map, and
   theme effects fade with the fog. The Player shares the DM window's thread, so the DM window
   defers loading the new map until the TV's cover has closed and dims its own map area at the
   click. Nothing is written on screen during a switch - the scene's name was
   shown there for a while and was taken back out.

8. **Both windows draw fog on the GPU, in different shapes.** The DM's fog is map-sized
   sprites. The **Player's fog is one pass over the whole window**, masked inside the map.
   Two layers meeting at the map's edge leave a faint seam on animated maps, and one
   window-wide pass has no edge for a seam to sit on. See [DECISIONS.md](DECISIONS.md).
