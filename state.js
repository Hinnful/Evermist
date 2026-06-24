// state.js — shared mutable state, extracted lazily from the inline blob.
// Loaded BEFORE fog.js so these globals exist when fog functions reference them.
// Grow this file on-touch (one concern at a time) — never a big-bang move. See CLAUDE.md.

// ─── Fog RAF lifecycle handles ──────────────────────────────────────────────────
// requestAnimationFrame ids for the two independent fog loops. Held here (not in
// fog.js) so teardown — stopFogAnim / stopFogTransition — can be reasoned about as
// explicit lifecycle state. null = loop not running.
let fogAnimRafId  = null; // drifting cloud animation loop (fogAnimTick)
let fogTransRafId = null; // reveal/shroud crossfade loop (fogTransTick)
