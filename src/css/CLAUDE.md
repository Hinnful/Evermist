# CSS rules

Scoped to `src/css/`. The root [CLAUDE.md](../../CLAUDE.md) carries everything else.

## CSS

Eight files in `src/css/`, split by screen region: `base.css`, `controlPanel.css`,
`toolbar.css`, `roomCard.css`, `playerPane.css`, `legend.css`, `sceneManager.css`,
`overlays.css`.

- **`index.html` has no `<style>` block.** A guard hook blocks one in the head.
- **The `<link>` order in `index.html` IS the cascade.** `base.css` first (it defines
  `--ui-zoom`), `overlays.css` last, and `controlPanel.css` before `roomCard.css` because it
  defines `@keyframes cpAdvIn`, which must stay defined exactly once.
- **No `player-mode.css`.** The `body.player-mode` overrides deliberately sit next to what
  they override, in `toolbar.css` and `sceneManager.css`.
- No `@import`, no preprocessor, no runtime style injection.
- Don't add scoping schemes or cascade layers. Separate files bought findability and small
  diffs, not encapsulation; CSS is one global cascade regardless of file count.
- `splash.html` keeps its own inline `<style>`. It shares no rules with the app.

