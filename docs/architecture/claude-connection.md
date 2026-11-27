# Architecture - the Claude connection

Split out of [ARCHITECTURE.md](../ARCHITECTURE.md): the local MCP connection that lets Claude prep in Evermist, in the present tense.

The DM brainstorms in the Claude desktop app and asks it to write the prep into Evermist. Settings'
Connect (Integrations) hands Claude a desktop extension (`Evermist.mcpb`), which Claude asks to install.
Inside it is a small MCP server over stdio (`electron/mcpShim.js`) that runs on Claude's own Node,
holds the tool list and relays each call to the app. Evermist never writes Claude's files.

The app side is a server on 127.0.0.1 (`electron/mcpBridge.js`) behind a key made at each launch.
Its port and key sit in `mcp.json` in the data folder, which is gone once the app quits. Settings' Disconnect makes the server refuse every call with a plain reason until Connect; the state is `claude.json` (`{off, seen}`), which the previous release never reads, so a rollback leaves Claude answering. Main
hands each call to the DM window, and `mcpTools.js` answers it there, because the campaign lives in
that window's storage.

With Evermist closed, the shim starts it with `--background`: no splash, no window, no map opened
and no Player warmed. The app holds one copy per library, so the DM opening Evermist reaches the
same app, which reloads its page as a normal start and shows it. Unseen, it quits after fifteen
minutes with no call.

On Linux the shim first repairs the app's environment from the desktop session (display, Wayland socket, runtime dir, bus, Xauthority; only what is missing or dead, `sessionEnv`), because Claude Desktop's extension process lacks them, and starts the app under `systemd-run --user --scope` when available, so the AppImage's FUSE runtime does not share Claude Desktop's cgroup scope.

Claude does the DM's prep and none of the play. Its tools make, rename, move, change and delete
scenes, places, roads, the world map's backdrop, fights, bestiary monsters and gallery pictures, and
add to or replace notes at every level the Notes window holds (level `monster` reads and writes a creature's note; `read_notes_order` and `set_notes_order` refuse level `monsters`, the list is gone). `mcpEntries.js` (rules in
`mcpEntriesPlan.js`) makes, nests and deletes factions and lore, makes a blank Bestiary entry for an NPC,
and answers where an entry appears. Claude writes a mention as `@{Name}`, or `@{fight: Name}` for a fight; every tool that writes notes
resolves it to the stored form and reads stored mentions back as `@{Name}`, or as the stored form when
the entry is gone, so a read-then-write keeps a red label. The shim's `instructions` tell it
what a place, a scene and a room are, and a `guide` tool returns plain-language how-to text per topic
from `mcpGuideText.js`, which the in-app guides can read too. Tools are grouped one file per subject in
`src/mcp/`, and `mcpTools.js` is the dispatcher.

Claude sees a map through `view_scene` and `read_scene` (`mcpSee.js`, rules in `mcpSeePlan.js`). `view_scene` draws the
map, or an area of it given in percent, offscreen with no fog: a still is decoded straight to the picture's size,
the open map is cropped from its decoded canvas, an animated map gives one frame of its file. A percent grid
(about ten lines across, at a round step) and the rooms' outlines go on top, and the JPEG comes back beside the text
as `image` in the reply; the shim turns it into an MCP image content item. The picture stays under 750 KB, lowering
JPEG quality before shrinking. `read_scene` answers the map's size, grid, rooms in polygons order with fog, outline
and doors in percent, effects and floor-plan counts, from the window's live state when the map is open.

A scene is made from a map file or a folder of them. Main finds the files (`mapScan.js`, searching
Downloads, Desktop, Documents and Pictures two folders deep) and reads their bytes, and the window runs
the quiet import that the world map's Add uses. The scene is never opened and never sent to the TV. `copy_scene` copies a stored map with its own copy of the file (`getVideoFilePath`, then `saveVideoFile` under the
new id) and the record built by `mcpSceneCopy` (`mcpMapFilePlan.js`). Both replies state the pixel size and warn about
an animated map past 4K. `shrink_map` (`mcpShrink.js`) re-encodes a closed animated map with `convertVideoForImport`,
writes the result beside the old file as `.import`, saves the record rescaled by `mcpRescaleScene`, then settles the
file into place and asks `syncIndex.sceneFileReplaced` to hash the map again; it records no undo step.

Every change records how to put it back before it returns, in a history of the last 30 steps held
in memory (`mcpHistory.js`). `undo_last_change` reverts the newest. Each change shows the undo toast
naming it, whose button runs the same undo. A deleted scene, place, fight or picture is kept whole in the
step, so undo restores it. Delete tools carry MCP's destructive hint, so Claude's app asks the DM before
each one runs, and the shim's instructions tell Claude to name what goes in chat first. The app enforces
the yes too: delete_scene, delete_place, delete_fight and delete_picture delete nothing unless called with
`confirmed: true`, and without it answer with what would go (`mcpWouldDelete` in `mcpPlan.js`). Settings
shows these rules under Claude's Connect, and the guide's `claude` topic states them.

Claude's map tools draw, edit, delete, merge, cut and split rooms (a room may also come from a point on a floor-plan map, `mcpRoomFromPoint`, with closers stored on the plan as portals) and add or remove doors; set room fog,
reveal or hide a rectangle or circle or the whole map, and set the fog theme by name (an old extension still sending preset, tint or fogColor is told to press Connect to Claude again); load a .dd2vtt floor
plan (asking before it replaces rooms or lights), module text or a PDF, and link rooms to entries one by one;
merge an Evermist export zip (asking first with the plan, and refused when it would replace an existing animated
map's video); fit and style the grid; place, edit and delete Fire and Acid effects and lights; keep the music
library (files, YouTube up to 20 tracks per call that fill in the background, groups, delete with undo until
Evermist closes; it never plays); and handle groups, map spots, roads, the backdrop, fights before they run
and bestiary monsters. A new IPC reads prep files from a path, type-checked by extension.

Nothing Claude does reaches the TV. A change to fog, fog colour, the map or a delete is refused for a scene
the TV shows (`sceneOnTv` in `panes.js`, which asks each column in two-map mode), and while the DM is mid-gesture. A map
the DM has open but the TV does not show is changed live: `mcpEditMap` carries every map change, and the change
also goes on the DM's own Ctrl+Z stack, so neither undo drops or resurrects the other. The fight open at the table is never deleted, and an edit to it may only add monsters or raise a count,
written into the live table rows in place so existing rows keep their HP; rename, remove, side change
and a lower count are refused (`mcpOpenFightRefusal`), and undo removes the added rows. Claude's edit, delete and undo refusals target the started fight by id, and it refuses to add to an open started fight. A picture on the TV is not removed.
An animated map is not deleted by Claude, since its file on disk cannot come back. A note for a scene
held in a column goes through that column, so its autosave keeps it. A call that reads a PDF book or imports
a folder of maps gets five minutes to answer; the rest get twenty seconds. `undo_last_change` is a slow call, and a second undo while one runs is refused. Undo of a map Claude made moves it to Recently deleted. Room notes over 20 000 characters are refused, never cut. A call over 1 MB gets "the call is too large" from the shim and a 413 from the bridge. `create_scene` on a folder reads files one at a time.
