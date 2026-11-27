# Architecture - two maps at once

Split out of [ARCHITECTURE.md](../ARCHITECTURE.md): two-map mode on the DM screen and the TV, in the present tense.

A fight in a multi-storey building moves between floors, and every mini standing on the TV has
to stay where it is. So the DM window's map area can split into two columns, each showing a
different map, and one Player window on the TV showing both.

- **A column is the whole app again.** It runs in an `<iframe>` pointed at the same
  `index.html` with `?mode=pane`, and CSS hides the toolbar, the dock and the minimap inside
  it. So a column has its own scene, camera, grid, rooms,
  fog and undo history without any of those being written a second time.
- **The chrome stays where it is and acts on the column you last touched.** A click anywhere in
  a column both selects it and does whatever the click was for, in the one press. The selected
  column wears a blue frame.
- **The selected room is edited in the DM window.** A column reports the room selected in it,
  and the Notes window shows the selected column's room, and a map's notes from the column that holds it (`paneView.sceneNotes`). Every edit goes back to that column alone.
- **Every button sends a message.** The toolbar, Scene control and the minimap all
  reach a column the same way the DM window reaches the Player window: by `postMessage`. A
  column then presses the control it already has, so nothing is implemented twice.
- **One minimap, and it follows the selection.** It draws the selected column's own map, fog and
  grid, reaching straight into that column because both pages come from the same folder. Reading
  is the only thing done that way; every command is still a message.
- **The DM window gives its own map up on the way in.** Entering two columns tears the parent's
  map, video and fog canvases down rather than hiding them, because hiding frees no memory, and
  cancels its pending save so it cannot write over a map a column now owns. Leaving loads the
  map back out of the library.
- **One Player window carries both floors**, split where the DM's divider sits, with a whole
  Player in each half. Entering and leaving two-map mode NAVIGATES that one window rather than
  closing it and opening another, so whatever the DM set up on the TV - fullscreen above all -
  survives the switch. Two windows was the first shape and it cannot work: Windows gives one
  fullscreen window per display, so a pair on one TV would show two title bars and the desktop
  behind them. The shell is `stage.html`, and it owns only the split and the chasm.
- **The chasm is the seam between the two floors on the TV**: a dark band with each floor's own
  fog colour bleeding into it, embers drifting up through it and a faint seam of light down its
  centre. Its numbers are fixed in `stage.js` with no UI over them, the way the fire effect's
  look is fixed in `effects.js`.
- **The second column opens empty and waits to be picked.** Pressing the toggle splits the map
  area and opens the world map with the empty column selected, so the next double-click fills it.
  Its half of the Player screen shows drifting fog and nothing else until then. Filling it with
  whichever map came next put a map on the TV the DM never chose.
- **A column keeps the camera it was given.** Pressing Two maps hands the column the zoom and
  centre the DM window had, and every later change of width - the second map landing, a
  divider drag - holds that centre rather than refitting. `resizeViewport` in `viewport.js`
  captures the camera before `syncSize` changes the reported size, which is the only moment
  the centred map point can still be read.
- **Two columns cannot open the same map.** They would save over each other, so the library
  refuses and says so.
- **One map alone is untouched by all of this.** The DM window renders its own map exactly as it
  did before any of it existed.
