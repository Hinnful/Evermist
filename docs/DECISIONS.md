# Decisions

The list of topics in the ledger of settled calls: what was tried, what was rejected, what was
reverted, and why. Each topic keeps its entries in its own file in [decisions/](decisions/). Before
deciding, or re-proposing, anything in a topic, read that topic's file; a new entry goes there too.

This file is written in the **past tense**: what was built, what was tried, what was rejected.
Rules live in [CLAUDE.md](../CLAUDE.md), how the app works in
[ARCHITECTURE.md](ARCHITECTURE.md), and what the product is and will never be in
[PRODUCT.md](PRODUCT.md). A scope call or a positioning statement belongs there, not here.

**Status tags:** `SETTLED` (this is the shape, don't redesign it) · `REJECTED` (built or
proposed, then killed) · `REVERTED` (shipped, then taken back out) · `PARKED` (wanted,
deferred) · `WON'T FIX` (real, deliberately not fixed) · `SHIPPED` (landed in a named
version) · `REOPENED` (closed once, now live again). A guard rejects an entry with no tag.

**Adding an entry:** one heading, a status, and at most a short paragraph. If an entry needs
more than that, the excess belongs in the commit message.

**Write about the DECISION, never about the people.** This file is public. No "the user", no
"he/she said", no "I recommended", no quoted remarks from a chat log. Those read as leaked
internal notes about a named person, and the attribution carries no information anyway: what
a future reader needs is what was decided and why it held, not who said it. Write
"rejected on product grounds: …", not "he rejected it because …". Where a decision came from
someone's judgement rather than a measurement, say that impersonally ("judged not worth the
cost") and move on.

---

## Audit misses

In [decisions/audit-misses.md](decisions/audit-misses.md) - what the DM found after an interface audit
said it was done, and which audit step now catches each.

---

## Discoverability

In [decisions/discoverability.md](decisions/discoverability.md) - which sites list Evermist,
what each listing says, and what was ruled out.

---

## Rendering and fog

Moved to [decisions/rendering-and-fog.md](decisions/rendering-and-fog.md) - the two
views' render paths, the fog pipeline, and the dirty-flag render loop.

---

## Rooms and the room card

In [decisions/rooms-and-room-card.md](decisions/rooms-and-room-card.md) - drawing, repairing, editing and labelling rooms, and where the room is edited.

---

## Module text import

In [decisions/module-text.md](decisions/module-text.md) - reading a published module and its PDF into entries and room notes.

---

## Player sync and the minimap

In [decisions/player-sync.md](decisions/player-sync.md) - how the TV follows the DM screen, two screens, and the minimap.

---

## UI and the control panel

Moved to [decisions/ui-and-control-panel.md](decisions/ui-and-control-panel.md) - the dock,
the toolbar, the scene library, and the dialogs. The dock (2026-10-02) reversed the tab bar,
the floating room card and the icon-rail rejection.

---

## Storage, packaging and the shell

Moved to [decisions/storage-and-packaging.md](decisions/storage-and-packaging.md) - data
storage, Electron packaging traps, and the release pipeline.

---

## Video

In [decisions/video.md](decisions/video.md) - animated maps and video playback.

---

## Floor-plan derivation

In [decisions/floor-plan.md](decisions/floor-plan.md) - rooms, walls and doors drawn from a Universal VTT floor plan.

---

## Docs, rules and guards

Moved to [decisions/docs-and-guards.md](decisions/docs-and-guards.md) - the doc
architecture, the guard hooks, and the calls about what CLAUDE.md may hold.

---

## Testing and the rig

Moved to [decisions/testing-and-the-rig.md](decisions/testing-and-the-rig.md) - the CDP
rig, acceptance scenarios, and mutation coverage.

---

## Map effects

Moved to [decisions/map-effects.md](decisions/map-effects.md) - burning ground, the
flaming border, the Cone tool and the material picker.

---

## Positioning

In [decisions/positioning.md](decisions/positioning.md) - where Evermist draws its line against virtual tabletops.

---

## Campaigns

In [decisions/campaigns.md](decisions/campaigns.md) - the Campaign board, groups, the world map and notes.

---

## Corrections worth keeping

In [decisions/corrections.md](decisions/corrections.md) - reasoning that turned out wrong in a way that would repeat.

---

## Music

In [decisions/music.md](decisions/music.md) - the music player, playlists and sync of music.

---

## Sounds

In [decisions/sounds.md](decisions/sounds.md) - one-shot sounds and their library.
