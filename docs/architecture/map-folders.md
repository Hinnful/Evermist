# Architecture - bringing in a folder of maps

Split out of [ARCHITECTURE.md](../ARCHITECTURE.md): how a folder or zip of maps becomes a group of maps, in the present tense.

Select ten maps in the file dialog and they import one after another - never overlapping, because two maps decoding at once is how a video import lands
on top of the one still being saved. The progress bar says which map of how many is going through
and names it, over the top of whatever that map is doing at the time.

You land on the first map of the batch, not the last, so a run of ten leaves you where you started
reading rather than at the far end. A clean run ends silently. A run with a casualty ends in one
message naming exactly what did not make it, and nothing interrupts mid-run to ask about a single
bad file - the alternative is an unattended import stopping on map three and waiting all evening.
One unreadable map costs that map and nothing else.

Close the app halfway through and the maps that finished are there. The rest simply never existed.

A copy the AppImage updater starts (`APPIMAGE_SILENT_INSTALL=true`) retries the single-instance lock every 250 ms for 10 s and logs "[update] the relaunched copy took the lock" or "gave up"; the old copy ignores second-instance while quitting.

Closing the DM window from outside (close button, quit, updater, idle quit) is held in `main.js` until the page has flushed the open note, autosave, a pending delete and the two-map panes, capped at 5 s; a page's own `window.close()` skips the hold and relies on `beforeunload`.

A backup zip is the exception: on its own it still restores the library, but one sitting inside a
multi-file selection imports nothing at all and says why. Restoring adds to the library rather than
replacing it and carries the module text, of which the app holds one - so it is a question, and a
question in the middle of a run nobody is watching is the thing this feature exists to avoid.
