'use strict';
// galleryMigrate.js — the pictures rooms used to hold, copied into the gallery once.
//
// ⚠ IT ONLY COPIES. Each scene keeps its `pictureBlobs` and its rooms their `pictures`, because the
// previous release opens them from there. The flag keeps a picture the DM later removes from
// coming back.

const GALLERY_MIGRATED_KEY = 'evermist.galleryMigrated';

// Resolves how many pictures came in, or -1 when it has already run or could not finish (the
// next launch tries again).
async function galleryMigrate() {
  try { if (localStorage.getItem(GALLERY_MIGRATED_KEY)) return -1; } catch (_) { return -1; }
  const found = [];
  for (const meta of await sceneStore.listScenes()) found.push(...galleryFromScenes([await sceneStore.loadScene(meta.id)]));
  const now = Date.now();
  found.forEach((p, i) => { p.added = now - i; });
  const added = await galleryStore.addMissing(found);
  try { localStorage.setItem(GALLERY_MIGRATED_KEY, '1'); } catch (_) {}
  return added.length;
}
