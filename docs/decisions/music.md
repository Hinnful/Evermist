# Decisions - music

Split out of [DECISIONS.md](../DECISIONS.md). What was decided about the music player, playlists and sync of music, and why it held.

Status tags and the paragraph budget: see the main ledger's header.

---

### Web Audio was built for the crossfade and rejected · `REJECTED` (2026-09-08)
`createMediaElementSource` into two `GainNode`s was the obvious route, and it risks total
silence: Chromium taints a source it reads as cross-origin, and the app is served from
`file://`, whose origin is opaque. Nothing would have caught it before playback existed.
Playback is two `HTMLAudioElement`s with a volume ramp on a 40ms timer instead, each deck
owning its own timer. The stutter that a gain ramp would have avoided only bites on a
minimised window, which is not a state anyone is in while clicking tracks.

### No ffmpeg, and the audio format is sorted by quality not container · `SETTLED` (2026-09-08)
`bestaudio[protocol^=http]`. YouTube serves audio-only streams as whole files, so nothing needs
converting and ffmpeg stays out of the installer - 80-140MB per platform. The protocol filter
excludes HLS manifests, which arrive as segments and would need ffmpeg to join.
An earlier selector preferred `ext=m4a` and took 129k AAC where the same upload offered 131k
Opus. Chromium decodes both natively, so a container preference buys nothing and costs bitrate
on an upload carrying a high-quality track. Never constrain the format by container.

### Only an address the main process built reaches yt-dlp's argv · `SETTLED` (2026-09-08)
yt-dlp reads `--exec` off its own command line, so a pasted string beginning with `-` would be
arbitrary command execution from the main process. `ytdlpTarget` rebuilds a canonical address
from the parsed id; anything not YouTube goes through the URL parser, whose output always starts
with its scheme. Every call carries `--ignore-config`, ends its options with `--`, and spawns
with an argument array and no shell. A track name from the renderer is checked for containment
inside the music folder the same way - `isSafeId` cannot be used, because a name carries spaces
and Cyrillic.

### yt-dlp is pinned for the build and self-updating at runtime · `SETTLED` (2026-09-08)
`tools/fetch-ytdlp.js` fetches a named release tag from `postinstall` into a gitignored
`vendor/`, so two builds of one release tag ship the same binary. What RUNS is a copy in
`userData`, because a binary inside the install cannot rewrite itself and yt-dlp stops working
within weeks when YouTube changes. The download panel's Update button rewrites that copy, and
appears only when a newer release exists.

### The music library has no database · `SETTLED` (2026-09-08)
The folder is the library: a download writes a file, a delete removes one, and every list is a
read of the folder. Track durations are read off the files each run rather than stored. The
"already downloaded" check reads the video id back out of the filename, so nothing has to
predict yt-dlp's per-OS sanitisation - a predicted name stops matching silently.

### A rig run never makes a sound · `SETTLED` (2026-09-08)
`--mute-audio` at launch in `run.js`, plus `muted` on both decks in the music scenario. Two
independent guarantees, because a loud hour-long track out of an unwatched run is the same class
of intrusion as a window appearing on screen. `muted` does not touch `volume`, so a crossfade
stays fully measurable.

### A door split by a new vertex holds its map point · `SETTLED` (2026-09-11)
Inserting a vertex into a wall halves the edge a door names, and a door stores a fraction along
that edge, so the same fraction pointed somewhere else - a measured 186px jump onto another wall
of the same room. Two other answers were dropped: deleting a door whose wall was split loses work
already done, and refusing the insert makes vertex editing read as broken with nothing on screen
to explain it. The remap takes the split's own fraction and moves the door onto whichever half now
carries it, which preserves the point exactly. The notch still caps to the wall the door ends up
on, so a split made right beside a door draws it narrower than a cell.

### A scene switch waits for the outgoing scene's own save · `SETTLED` (2026-09-17)
`switchScene` used to start `doAutoSave()` and move on. The save's write sits inside a `toBlob`
callback, so a switch away and back could read the store before the outgoing scene's edits landed
in it, and the scene came back as it was two switches ago. It is awaited now, which costs one fog
canvas encode on a switch that already awaits a scene load and a video decode.
A map import had the same race and got the same await in 3.10.1: once the new scene is current, the
old scene's save is dropped, and a slow decode got there first.

The race is only reachable where the machine is slow enough to lose it. It survived every local run
and took a release gate down on a CI runner, three times slower. **A mutation check cannot be got
here**: with the await removed, `floor-plan.js`'s door-survives-a-switch criterion passed three runs
in a row on the dev machine. That criterion is the guard; the gate is where it fires.

### My seat turns the whole canvas stack, never each drawing · `SETTLED` (2026-09-29)
The TV sits in the table turned from the laptop, so the DM map turns in quarter steps to match. The
map, fog, grid and overlay are drawn by separate code on separate canvases, and turning each one's
drawing would have touched every tool and left any one missed drawing sliding off the map. One CSS
turn on every canvas in the map area keeps them together by construction, and the conversion moves
to the handful of places that meet a mouse position. Free angles for a round table were left for
later: at 30° the rectangle tool drags along the map's diagonal on screen, which is a design
question, not a code one.

### Fit to TV turns the TV's picture, never the laptop and never the file · `SETTLED` (2026-10-17)
**Reshaped 2026-10-23:** the menu became TV setup's three-picture Turn, offered for every map, and Manual holds the turn until Send (see "TV setup is one window" in decisions/ui-and-control-panel.md); the saved `{step, turn}` and the whole-canvas turn stand. A sideways map is turned per scene from the minimap's menu: Off, Fitted, Flipped. The TV draws the turn
with the whole-canvas turn My seat uses on the laptop, so an animated map needs no re-encoding and
rooms, fog and effects keep their coordinates. Fitted reads the DM's seat to pick its direction:
upright from a side chair, clockwise from a long side, where no quarter turn reads upright. The laptop
follows the seat alone, so with a fit on it no longer matches the TV as seen from the chair; turning
both was rejected, since a DM at a right angle would still sit at a right angle. A later seat change
leaves a fit as it was. In Manual mode the fit reaches the TV at once in its own message, so it never
carries an unsent reveal.
