'use strict';
// dragDrop.js — what a file dropped on the DM window becomes: a floor plan on its own attaches to
// the open scene. A map dropped here imports nothing; maps come in through "+". A picture dropped
// on the room card is roomPictures.js's and never reaches this handler.

function initDragDrop() {
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files || []);
    const plans = dropped.filter(f => /\.dd2vtt$/i.test(f.name));
    // Only a plan ON ITS OWN: it got separated from its map. Nothing open means nothing happens.
    if (!plans.length || plans.length !== dropped.length) return;
    plans[0].text().then(text => attachPlanText(text).then(ok => { if (ok) offerStoredFloorPlan(); }))
      .catch(() => {});
  });
}
