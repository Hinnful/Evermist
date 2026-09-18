'use strict';
// dragDrop.js — what a file dropped on the DM window becomes: a map goes to the import loop, a
// floor plan on its own attaches to the open scene.

function initDragDrop() {
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files || []);
    if (!dropped.length) return;
    // A floor plan dropped ON ITS OWN attaches to the open scene, for the case where it got
    // separated from its map. Nothing to attach it to means nothing happens.
    const plans = dropped.filter(f => /\.dd2vtt$/i.test(f.name));
    const maps  = dropped.filter(f => !/\.dd2vtt$/i.test(f.name));
    if (plans.length && !maps.length) {
      plans[0].text().then(text => attachPlanText(text).then(ok => { if (ok) offerStoredFloorPlan(); }))
        .catch(() => {});
      return;
    }
    // A plan dropped alongside its map needs nothing — the import finds it on disk — so it is
    // dropped from the list rather than reported as a failure. The loop is mapImport.js's.
    if (maps.some(isImportableMapFile) || maps.length > 1) importMapFiles(maps);
  });
}
