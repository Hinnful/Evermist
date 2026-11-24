# CSS rules

Scoped to `src/css/`. The root [CLAUDE.md](../../CLAUDE.md) carries everything else. What a stylesheet may
say (tokens, sizes, radii, contrast, which selector is which atom) is
[.claude/rules/design-system.md](../../.claude/rules/design-system.md), which `test/designSystem.test.js` holds.

## CSS

Split by screen region: `base.css`, `controlPanel.css`, `toolbar.css`, `roomCard.css`,
`playerPane.css`, `legend.css`, `sceneManager.css`, `about.css`, `music.css`, `panes.css`,
`combat.css`, `dock.css`, `notesWindow.css`, `worldMap.css`, `search.css`, `overlays.css`.

- **`index.html` has no `<style>` block.** A guard hook blocks one in the head.
- **The `<link>` order in `index.html` IS the cascade.** `base.css` first (it defines
  `--ui-zoom` and the motion tokens), `overlays.css` last. `dock.css` sits after every stylesheet whose
  controls it reskins.
- **No stylesheet opens or closes a surface.** A window, menu, popup, pane, dialog or toast moves through
  `motion.js`; a `transition` or `animation` here rides the `--m-*` tokens, is the hover colour, plays a Loop or sits on
  an Exempt selector (design-system.md, "Motion"), and `designSystem.test.js` fails anything else.
- **No `player-mode.css`.** The `body.player-mode` overrides deliberately sit next to what
  they override, in `toolbar.css`, `sceneManager.css` and `music.css`.
- No `@import`, no preprocessor, no runtime style injection.
- Don't add scoping schemes or cascade layers. Separate files bought findability and small
  diffs, not encapsulation; CSS is one global cascade regardless of file count.
- `splash.html` keeps its own inline `<style>`. It shares no rules with the app.

