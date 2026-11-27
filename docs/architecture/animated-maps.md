# Architecture - bringing an animated map in

Split out of [ARCHITECTURE.md](../ARCHITECTURE.md): how a video map is read, played and stopped, in the present tense.

A still map arrives, gets decoded, and that's the end of it. An animated map is a different
proposition: it costs a video decoder in every window that shows it, for as long as the scene is
open, and that is comfortably the heaviest thing the app does. A Dungeon Alchemist export runs
13 to 20 megapixels, several times what any table television can show.

So Settings' Campaign section carries a **Shrink big maps** size: Off, 1080p, 2K (2560×1440) or 4K
(3840×2160). With a size picked, any animated map larger than it is re-encoded on import to fit
that box. 4K is the largest because it sits under the 4096-pixel ceiling where a laptop's built-in
graphics stop decoding video in hardware and fall back to the processor. A map already inside the
box is stored exactly as it arrived.

It is off until switched on, and it replaces what the app stores rather than keeping both. The
cost is time: re-encoding runs at the speed the map plays, so a thirty-second map takes about
thirty-five seconds behind a progress bar that says what it's doing. Everything about the
conversion happens in the browser engine the app is already built on - nothing is bundled for it.

Two things it deliberately won't do. It won't touch maps already saved, or maps restored from a
backup zip, because their rooms are recorded in the old map's pixel space and would end up in the
wrong place. And it never asks per map: the machine doing the importing is usually not the
machine that has to play the result, so a question at import is asked of the wrong computer.

**What the DM window keeps for an animated map is nothing.** The map is the video element itself,
handed to the browser's own compositor - the same path a media player uses, with no copying per
frame. The graphics layer holds no picture of the map at all on that side, which is the
counterpart to the Player's one-screen patch described below.

### When an animated map stops

A decoder that runs dry is the one fault the app cannot fix from inside. It pauses the picture,
waits for the buffer to refill, and restarts the frame loop if that died - and when the data never
comes back, all three recoveries run forever against a map that has stopped.

So every window playing an animated map writes a line to disk for each of those events, into
`logs/video-diag-dm.log` and `logs/video-diag-player.log` under the app's own data folder. A line
carries the wall clock, the window that wrote it, and the map that window is playing. **The window
matters because two-map mode puts two columns in the DM file and two Player halves in the other**,
each timing from its own start - untagged, their lines interleave and no gap in either file means
anything.

Each launch retires the live file to a dated archive. **The archives are pruned by total size, not
by a count of sessions**: a stall is chased by restarting, and a count throws away the session that
holds the fault within a few restarts. The newest is never dropped, whatever it weighs.
