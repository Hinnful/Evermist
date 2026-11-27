# Architecture - exporting and importing your maps

Split out of [ARCHITECTURE.md](../ARCHITECTURE.md): backup export and import of the library, in the present tense.

Everything you make lives in the browser's local database, and for video maps, on disk next
to the app. That's fast but tied to one machine, so there's a backup feature for moving
between PCs.

- **Export** bundles the scenes you pick into a single `.zip`: the fog, the polygons, the
  thumbnails, and the actual map and video files. The imported module text goes in too, once
  for the whole campaign rather than once per scene. The gallery goes in too, a list and one file per
  picture under `gallery/`, and a restore adds the pictures whose id is not already there and
  removes none. A backup of picked scenes leaves the gallery out. The pictures a scene's rooms
  still hold travel beside the scene, so a backup restores in the previous release; they join the
  gallery on restore. File names come from a picture's own id, never from anything the zip claims.
  Picture groups and their order travel as `gallery-layout.json`. A video map not on disk is exported from the copy the app plays, and two-map columns are flushed before export. The export is written as `<name>.part` and renamed on success. An import cut short by a close is undone at the next start from the `evermist-import` IndexedDB journal, and the DM is told. The page and the shell exchange one map per call in both directions, so a library of any size
  exports and restores; the zip's root entries are written after the maps and read by name.
  The world map's background image goes in with every export, a picked one included. Every scene,
  room, effect, place and road also carries the time each of its parts last changed, and the uid
  that identifies a room or effect on every machine.
- **Import** reads that zip back and merges it into your library part by part. A scene the library
  already holds is matched by its id and updated: the part edited later wins, a part with no time is
  the oldest, and a tie goes to the file. Rooms and effects match by uid, so a room new from the file
  arrives hidden after the local rooms, and a room deleted on one machine goes on the other unless
  that one edited it later. Places match by uid and then by name, roads by their key, and the
  background follows the same rule. A scene the library does not hold is added, and a name already
  taken gets a "Name (2)" style rename. Where nothing matched, the new scenes land beside the
  existing layout. A monster or fight matches by id and the newer copy replaces the old, so no "Goblin 2".
  Factions, lore, picture names, the party marker and a map's group and Campaign spot follow the same
  newer-wins rule. The newer campaign note replaces the old one, and is never appended under it.
  A deletion is an edit with a time: `{id: time}` records per kind (monsters, fights, factions, lore, pictures, groups,
  roads) sit in `edits.gone*` in the combat data, `gone` beside Notes entries, localStorage `evermist.gonePictures`,
  `evermist.gonePlaces` and `evermist.goneRoads`, and `gone` in `campaign.json`. The later of edit and deletion wins, a
  record with no edit time loses, and the newest 300 per kind are kept. Whole maps and music are not covered.
  Where neither copy has an edit time, a differing monster still arrives as a copy once. Stopping an
  import puts the Campaign cards' names, thumbnails, groups and spots back.
  Afterwards the world map opens on what came in and a report names what was added,
  updated and kept, and each edit the file overwrote.
- **A map file that has gone is named, both ways.** A scene whose video was moved or deleted
  still exports its record, so the export says which scenes went out without a map, and a
  restore says which came back without one rather than producing a scene that fails on opening.
- **The module text is adopted last**, after every scene is safely saved. If a module is
  already loaded, the app asks which one to keep and names both; if there is no room left in
  storage for it, the scenes still restore and the app says the text didn't. A zip written
  before this existed carries no module text and restores exactly as it always did.
- **Cancel stops either one, after asking.** A stopped export deletes its half-written zip. A
  stopped import puts the scenes it had matched back as they were and deletes the scenes and map
  files it had added, so the library is as it was.
  The same Cancel stops a batch import after the map in hand, and a shrink before it imports.

The zip reading and writing happens in the Electron shell, driven by `backup.js` (export) and
`transferImport.js` (import) on the page. `editStamps.js` times the parts at each save and
`transferPlan.js` decides which copy of each part wins; both are pure and tested.
`moduleText.js` owns the module-text format at both ends: `backup.js` asks it for a payload
and hands one back, and never touches storage itself.
