# Architecture - first-use hints

Split out of [ARCHITECTURE.md](../ARCHITECTURE.md): the first-use hints and when each shows, in the present tense.

Cues ride the `hints.js` contract: once ever, one at a time, off with Hints Off. `hintsPlan.js` holds the
pure triggers and `hintsCues.js` the cues. A hint the DM's own action triggers (a stroke, a pane opening)
replaces the toast up; one read off the screen (the Campaign, a map opened) waits while another is up. The
first brush stroke with no TV live shows "Put it on the TV", and the Rooms hint moves to the next stroke. So does a map
opened with something revealed and the TV not live; either closes when the TV goes live. A map hint skips a map that
holds what it teaches: Reveal skips a revealed area (the brush layer, read once per map open on a 64px copy) or any room
not in shroud, Effects skips a map with an effect. "Show a room" shows beside the room nearest the view's centre when
all rooms are in shroud, wins over Reveal there, and closes when any room's fog changes. A hint closed by Got it starts a
one-minute quiet gap (`_hintQuietMs`) for screen-read hints; own-action hints ignore it and any other close starts none.
The effects hint shows on the second map open, counted across launches in localStorage `evermist.mapOpens`
(restoring at launch counts). `electron/screenLog.js` writes `screens.log` for the first 10 s after launch,
on change only, replaced each launch. On the Campaign, right-click menus offer New group here, Add maps
here..., Background picture... (presses the picker directly, no pane opens) and Notes for a group or map, and picking a map offers its own Notes level without opening it.
On launch with no last map to open (none remembered, or it is gone) the Campaign opens, empty library or not; a hidden
background window (`?background=1`) never opens it, so first-use hints cannot fire unseen. The Open button over a picked map reads "Open"; the Help sheet lists "Pan with a mouse".
