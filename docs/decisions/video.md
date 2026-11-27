# Decisions - video

Split out of [DECISIONS.md](../DECISIONS.md). What was decided about animated maps and video playback, and why it held.

Status tags and the paragraph budget: see the main ledger's header.

---

### The rs=2 stall fix · `SETTLED` — keep every piece
The Player plays from its **own** in-memory blob, not the shared `file://` clip both windows
read concurrently. Keep: the `disable-features BackgroundVideoTrackOptimization` switch,
`backgroundThrottling:false` on both windows, the `onVideoWaiting` pause-poll-until-rs≥3
resume, the RVFC loop in `startVideoLoop`, and the Player texture-sync dedup on
`currentTime`. The diagnostics (on-screen overlay, stress rig, rotated disk logs) are
permanent, not temporary. Fallback if it ever recurs: throttle the Player's per-frame
`drawImage(video)`.

### Playback logs are kept by size, not by session count · `SETTLED` (2026-09-17)
A stall at the table is chased by restarting the app, so a count-based limit evicts the session
holding the fault within a few restarts - two archives per mode lost three sessions of a reported
split-view stall before anyone could read them. The archives are pruned oldest-first once the
`logs` folder passes 500MB, and the newest is never dropped whatever it weighs. A count would also
throw away one long session to keep several short ones, which is backwards.

Each line names the window that wrote it. Two-map mode puts two columns in the DM file and two
Player halves in the Player file, each timing from its own start, so untagged lines interleave and
every duration read out of them pairs events from different windows. Two wrong readings came out
of one such file before the tag existed.

### The ~30s jitter · `SETTLED`
Root cause was Chromium's `BackgroundVideoTrackOptimization` dropping tracks on "occluded"
muted loops. The `disable-features` switch above is the fix.

**The "unverified across the Chromium 120 → 150 bump" worry is retired, 2026-08-09.** It held
that a renamed feature would silently turn the switch into a no-op, and it carried a soak test
to prove otherwise. Two full table sessions after the bump ran clean, so the switch is doing its
job. The related rs=2 stall is **not a version regression either** - it occurred on 120, occurs
on 140, and occurs in between, so any future freeze is new evidence rather than this cause
recurring, and should be diagnosed from scratch.

### The Player's map texture is viewport-sized · `SETTLED` (2026-08-07)
The Player's animated-map texture was the size of the display-scaled map and was re-uploaded
to the GPU every frame. It is now the viewport plus a 32px margin, carrying only the region
under the camera at one texel per screen pixel: **90.7 MB to 3.9 MB** on the 12900x11700 map
(one instance, 20s apart), resident and per-frame alike. `USE_REGION_TEXTURE` reverts it.

**The region is the viewport grown by a margin, NOT `visibleMapRegion()`**, which shrinks as
you pan to an edge and would change the texel-per-pixel ratio with the camera. The
un-intersected rect makes the sprite land on the SAME screen rect at every pan and zoom, so
no sub-pixel drift can open a rim between the map and the Canvas-2D fog above it.

**`bleedRegionEdges` replaces the clamp a full-map texture got for free**, and must read the
VIDEO: a canvas drawn onto itself forces a readback, measured at 0.185 ms/frame.
**`onDisplayInfoUpdated` must not fall through here** - it rebuilds a full-map sprite at 0,0.
`PLAYER_COVERAGE_FACTOR` no longer reaches animated maps; it still governs image maps.

### Frame timing for the two Player texture paths · `SETTLED` (method + result)
**The lever this was measured with no longer exists** (noted 2026-08-13): `USE_REGION_TEXTURE`
and `npm run memprobe:no-region` are both gone from the code, so the A/B below cannot be re-run
as written. Rebuilding a runtime flip is the prerequisite for re-measuring it.
The method was: flip at runtime and start on the other side, so the comparison runs inside one
instance in both orders. Clean run, same map both windows: region 351 frames / 0.370 ms,
full-map 337 / 0.320 ms. No smoothness difference. **The region texture's win is memory, not
frame time**, and import-time compression narrowed even that - the full-map alternative on a
boxed map is ~27MB against the region's ~15MB, where it was 91MB against 15MB when this landed.

**ms/frame measures the wrong half**: the timer wraps the canvas draw and
`pixiUpdateMapTexture()`, which only marks the texture dirty, so the GPU upload it schedules
falls outside it. Frames delivered in a wall-clock window is the metric. **A flip that races
the DM's scene sequence measures a different map per window** and three runs were void for
exactly that. Distrust any result whose two lines do not print the same `map=`.

### Three allocations nothing read · `SETTLED` (2026-08-07)
- `fogTransBlendCanvas` and `fogTransBlurPrev` are read only by the Player's `renderFog`,
  which returns early for the DM. Now inside the `isPlayer` branch of `startFogTransition`;
  36 MB each off the DM on the 12900 map.
- `rebuildFogBlur`'s padded canvas is cached on dimensions as `_fogPadded` and cleared on
  reuse, since the `drawImage` into it is source-over. **Not** `_fogScratch`: assigning
  `.width` reallocates, so sharing one canvas between two resizing callers saves nothing.
- `pixiFlushTexturePool()` on minimize was dead. Its calls after `pixiInitFog` stay.
- The minimap's fog-composite scratch is the same pattern, added 2026-08-09: cached on the
  preview's dimensions instead of allocated per redraw. **Its reset must run on every reuse,
  not only after a resize** — the composite exits with `source-atop` and alpha 0.35 still set,
  and "no resize" is the steady state, so a resize-only reset would make the dirty path the
  normal one.

### `UNDO_MAX_BYTES` is one budget for both stacks · `SETTLED`
`redoStack` had no cap, so the pair could reach ~218 MB against a 120 MB budget. Capping each
stack separately would allow 240 MB and fix nothing, so `evictUndoPair` trims them together,
**redo first** - it is empty during ordinary drawing, so undo depth is untouched in the case
that matters. Redo keeps a one-entry floor: `redo()` checks the length, then pushes and
evicts before popping, so a stack that eviction could empty would pop `undefined`.

### Streaming the Player's video over a private scheme · `REJECTED` - built, measured, removed
Would have dropped the 280 MB Blob the Player pins for the session, by serving the same file
over `evermist-video://map/<sceneId>`. Built and working: no canvas taint, correct 206/Range,
no return of the rs=2 stall, fine inside the asar. Removed rather than parked, because a
privileged scheme handler that nothing reaches is live surface for zero benefit, and the Blob
path is a SETTLED stall fix that any replacement has to beat rather than merely match.

It did not beat it. The Player pauses ~0.8s at every loop wrap on both sources, and the
streaming numbers (0.97-1.03s) sat inside the Blob's spread (0.56-0.99s) - no win to show for
the surface. Retrieve from git history if revisited.

**Traps already paid for, and none announces itself.** `registerSchemesAsPrivileged` must run
at module scope with `secure`+`corsEnabled`, alongside `crossOrigin='anonymous'` and an ACAO
header, or the canvas taints and the map renders BLACK rather than slow. Responses must be
cacheable. The id goes in the pathname, never the host, which lowercases.

### The old Canvas-2D grid path · `SETTLED` — deleted
Only `renderPlayerGrid(vp)` on `playerGridCanvas` is the live Player grid path. Don't
resurrect `drawGridLines(mapCtx)`.
