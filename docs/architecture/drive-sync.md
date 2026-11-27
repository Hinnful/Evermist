# Architecture - syncing through Google Drive

Split out of [ARCHITECTURE.md](../ARCHITECTURE.md): sync of maps and music between computers through Google Drive, in the present tense.

Two computers can share one library through the DM's Google Drive, with Evermist open on both.
Every user sees it: each signs in to their own Google account, and the data goes to their own
Drive. Sync stays off until **Connect to Google** in Settings.

- **The Google client is built into the release.** The workflow writes `electron/googleClient.json`
  from the `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` repository secrets
  (`tools/write-google-client.js`, which fails the build when either is missing) before
  electron-builder packs it. The file is gitignored and never committed. A dev run without it
  reads the same two environment variables; with neither, Settings shows nothing new and the app
  keeps no sync data at all.
- **`sync/config.json` in the data folder overrides the built-in client** when it holds a usable
  one: the rig points it at its fake Drive with a test client. Nothing else needs it.
- **Nothing runs until the first Connect.** The section shows wherever there is a client, but the
  hashes and the engine start only on a computer that has connected (signed in, or its sync
  database already made), so a DM who never connects pays nothing on a save.

- **Connect** opens Google's consent page in the system browser, asking only for the app's own
  hidden Drive folder. Google sends the answer back to a one-shot listener on 127.0.0.1, which
  checks it belongs to this sign-in, shows a short page saying to return to Evermist, and closes.
  The refresh token is kept encrypted by the operating system's store (`safeStorage`: DPAPI on
  Windows, the Keychain on a Mac, KWallet or the Secret Service on Linux). Where Linux has no such
  store, the token lives in memory only, the status line says the sign-in is not remembered on
  this computer, and Connect is needed again after each start. **Disconnect** forgets the token and keeps the sync marks; Connect to a Drive holding none of this machine's records clears them and asks the first-sync question. A failed token refresh caused by a Google error is a failed sync with a retry; only a refused refresh signs out.
- **What syncs:** every map with its rooms, fog, effects, notes and map file; the gallery; the
  monsters, fights and bestiary; factions and lore; the campaign note; the module text; and the
  Campaign's places, roads, party marker and backdrop. Each part merges by Import's rules (see
  above): the part edited later wins. Module text takes the newer copy and asks nothing. Music, sounds and pictures sync too: every track, the music groups, and the three layout records (order, names, groups; the later edit wins), and a built-in sound or picture deleted elsewhere lands in this Trash. A map's floor plan travels with its file name.
- **When:** about four seconds after a change is saved, every 30 seconds while the app is open,
  at start, when the network comes back, and on **Sync now**. A tick compares content hashes kept
  in the `evermist-sync` database and moves only what changed. A map's picture or video goes up
  once; a fog or room edit sends only the small record; a change pulled from the other computer
  is not sent back.
- **Where on the Drive:** in the app's hidden `appDataFolder`, which the Drive's own file list
  does not show and cleaning the Drive does not touch. Each computer writes its records into a
  `rec-<computer>` folder of its own, and map files sit in one shared `blobs` folder named by
  their owner and content hash. A file exists only once its upload has finished, so a cut upload
  resumes and is never read as complete. A map file no computer uses any more is removed. A blob is re-hashed before upload and skipped if its bytes no longer match its name; a resumable record upload is keyed on name and sha256, and a resumed upload that already finished is not removed as an older copy.
  Music: each computer's music record is `rec-<computer>/music.json`, and track files sit in a `music/<computer>.<sha256>` folder of their own, never in `blobs`, which the previous release's cleanup empties of anything it does not know. Local music sync state sits under `$music` in the `synced` store.
  A gallery picture deleted on any computer loses every computer's record and its file on the Drive.
- **Holds:** a change never lands under the DM's hands. Changes for the open map, the map on the
  TV and both maps in Two maps wait until that map is closed or changed; fight and bestiary
  changes wait while the fight table is shown; a note's change waits while that note is open, and an open monster note holds both combat records; a held map is re-checked right before a pulled record is written; a
  delete in its undo window defers everything. Nothing on screen reloads, and each pulled record
  is applied in its own short slice between frames.
- **Trash:** every delete goes to this computer's own Trash (`sceneTrash.js`), with or without sync: the map record in IndexedDB
  `evermist-trash`, an animated map's file in `userData/trash/`, for 30 days. A map deleted on another computer moves this
  computer's copy into its Trash (`syncMerge.drop`). Settings' "Trash" (one line in Campaign opening a pop-out, `trashPanel.js`)
  shows each name with "N days left", **Restore** and **Empty now**. Restore uses this computer's copy first, offline too, and
  marks the deletion record restored before the copy returns; a computer with no copy restores from the Drive. Pictures and hidden built-in sounds are kept in a second database, `evermist-trash-more` (stores `pictures`, `builtins`), so `evermist-trash` is never version-bumped; a picture deleted on another computer lands here too, and a restore stamps its name time so it syncs back. After 30
  days the Drive's copy is purged and the deletion record gains `purgedAt`. A purged deletion is remembered, so a computer that was
  offline longer than that cannot bring it back, except through a first sync (below); a purge without `purgedAt`, as 5.21.0 writes, always stands. A deletion an edit beat does not purge the map. Tracks carry `purgedAt` too. Deleting a whole map travels by sync only; Export
  and Import keep their own rules.
- **Music deletes:** a deleted track moves into this computer's Trash (`userData/trash/music/`, store `tracks`) beside maps, on this computer and on the other, with the same 30 days, Restore and Empty now. A track that is playing is held until it stops; an incoming track whose name is taken gets the music folder's " (2)" name. Deleting the last fight syncs with an empty bestiary. Within a tick, maps, records and notes move before music (a track already uploading finishes first). A Claude map or music delete goes to the Trash like the DM's.
- **Before a computer's first sync**, a successful Connect asks first: how many maps this
  computer holds, how many the Drive holds and from how many other computers, and that they will
  be merged with nothing deleted. Nothing syncs while the question is open. **Start syncing**
  starts the first sync; **Cancel**, or closing the app on the question, signs out again and
  leaves everything as it was. A computer that has synced before is not asked again.
- **The first sync** merges two filled libraries: it deletes nothing, keeps every map this computer holds even one another computer deleted and purged (the deletion record is revived with `restoredAt` after `purgedAt`, the map goes up and returns on the computer that deleted it; 5.21.0 treats a revived map as purged), replaces no map file, and
  keeps a copy of every record it changes for 30 days. The status line shows its progress.
- **A map file a sync replaces is kept 30 days.** When a later sync takes another computer's
  picture or video for a map, the one it replaces moves to `sync/kept/<map id>.<time>.<ext>` in
  the data folder, and is purged at the first start or replacement after its 30 days.
- **Replaced map pictures:** a map's right-click menu offers "Restore previous picture" while it has a
  kept file (the list left Settings). Each kept picture or video has its map's name and date. The list reads this
  computer's own kept files, so it shows offline and signed out. Restore on a picture makes it the
  map's picture; on a video it swaps with the map's current file, which goes into the kept list in
  its place, so a restore is undoable. A restored picture counts as the map's newest edit and syncs
  to the other computers. If the map is open, on the TV, in a column or in the Notes window, Restore
  does nothing and a "Close this map first" dialog says why.
- **The status line** says when the last sync ran, or that it is syncing, offline, signed out,
  that the Drive is full, how full it is (" · N% full", hidden under 70%, amber from 70%, red from 90%; read through Drive's about() at most once per tick and after a quota error), that the other computer runs a newer Evermist, or that a sync failed
  and is tried again in 30 seconds. Offline, the app works as before and edits go up later.
- **What stays per computer:** the TV screen, seat alignment and the other Settings, the music folded-shut state and volume, and the sign-in itself. The thirty built-in sounds ship inside the app; the DM's own sounds sync like music (own Drive folder and record, own "Recently deleted" rows), and a rename after the other computer has the sound does not reach it.

The page side is `sync.js` (the triggers, the outbox and inbox), `syncIndex.js` (the hashes),
`syncMerge.js` (applying a pulled record silently) and `syncSettings.js` (the Settings section);
`syncMusic.js` and `syncMusicPlan.js` carry music (the plan is pure and tested); `syncPlan.js` decides what moves and is pure and tested. In the Electron shell, `syncRemote.js`
talks to the Drive and keeps replaced map files, `musicHashes.js` hashes tracks, `syncAuth.js` signs in and keeps the token, and
`syncConfig.js` picks the Google client.
