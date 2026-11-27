# Architecture - the pointer and its crystal companion

Split out of [ARCHITECTURE.md](../ARCHITECTURE.md): the pointer and the crystal companion that follows it, in the present tense.

`src/cursor/` draws every pointer at runtime at 1x and 2x and serves them as `--cur-*` CSS custom properties. Every
stylesheet cursor is `var(--cur-*)` or `none`, and script assignments go through `cursorFor()`. The pack holds a white
dart with a navy edge that turns blue over anything clickable, glove badges (grab, holding), rotate, text, draw, move, four
resizes and the column divider. Dropdowns, sliders and colour pickers keep the arrow; text fields get the text cursor.

The crystal companion is a glow-core crystal with an orb eye, one per screen, on the DM screen, the Player TV and in
two-map columns and halves. It follows close and fast. Its outline morphs with the mood (dart following, bloom over a
clickable, diamond on click, uneven red star when angry, pebble asleep, fast dizzy spin, hexagon with a spinner while
busy) and with the tool (bar for text, cross for drawing, square for move, lens for resize, turning triangle for rotate,
hexagon for grab, flattened hexagon for holding). Anger needs 6 fast clicks on empty map (8 s cool-down), dizziness has a
6 s cool-down, it naps after 25 s idle, and it is busy while the map progress overlay is up or a PDF is read. It arrives
and leaves with the pointer, hops sides at window edges, backs off and fades with precise tools, and hides while the app
hides the cursor. The Settings switch "Crystal companion" is on by default and stored only when off; OS reduce-motion keeps
it still. It never draws on the map and never reaches a saved scene or backup.
