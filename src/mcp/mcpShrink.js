'use strict';
// mcpShrink.js — Claude's shrink_map: an animated map already in the library re-encoded into a smaller box, the way
// Compression shrinks one at import, with every room, door, effect, light and the grid moved onto the new size.
// ⚠ PERMANENT: the original file is not kept (PRODUCT.md, "Compression is opt-in"), so there is no undo step. The old
// file stays until the new record is saved, and a failed swap puts the old record back.

async function _mcpShrinkMap(args) {
  const found = _mcpScene(args);
  if (found.error) return _mcpNo(found.error);
  const s = found.scene;
  const name = args.size === undefined ? '4K' : String(args.size);
  const box = MCP_SHRINK_BOXES[name];
  if (!box) return _mcpNo('size is 4K, 2K or 1080p.');
  return mcpInTurn('map:' + s.id, () => _mcpShrinkNow(s, name, box));
}

const _mb = n => Math.round(n / 104857.6) / 10 + ' MB';

// ⚠ A map is re-encoded by playing it in this window, and a window Evermist never showed (started for a call with
// --background) is not proven to present video frames, so it is refused before anything is read.
async function _mcpShrinkNow(s, name, box) {
  if (appInBackground) return _mcpNo('Not done: Evermist is running without its window, as it does when the AI assistant starts it. Shrinking plays the map once, which needs the window. Ask the DM to open Evermist, then try again.');
  const pinned = _mcpScenePinned(s, 'shrinking it');
  if (pinned) return pinned;
  const old = await sceneStore.loadScene(s.id);
  if (!old) return _mcpNo('The map "' + s.name + '" is no longer in the library.');
  if (old.mapType !== 'video' || !old.mapPath) return _mcpNo('"' + s.name + '" is not an animated map, so there is nothing to shrink. Only animated maps can be shrunk.');
  if (!fitInsideBox(old.mapWidth, old.mapHeight, box.w, box.h).changed) return _mcpOk('"' + s.name + '" is ' + old.mapWidth + '×' + old.mapHeight + ', already inside ' + name + ' (' + box.w + '×' + box.h + '). It was left as it is.');
  const bytes = await window.electronAPI.readVideoFile(s.id);
  if (!bytes) return _mcpNo('Nothing changed: the animated map file of "' + s.name + '" is not on this computer yet.');
  const type = /\.mp4$/i.test(old.mapPath) ? 'video/mp4' : 'video/webm';
  const shrunk = await convertVideoForImport(new File([bytes], s.id + (type === 'video/mp4' ? '.mp4' : '.webm'), { type }), { box });
  if (!shrunk.converted) return _mcpNo('Nothing changed: this computer could not re-encode "' + s.name + '". The map stays as it was.');
  const ext = await window.electronAPI.saveVideoPending(s.id, await shrunk.file.arrayBuffer(), 'video/mp4');
  const drop = () => window.electronAPI.settleImportVideo(s.id, ext, false).catch(() => {});
  // The DM may have opened it during the re-encode; their open copy would save the old positions over the new ones.
  const late = _mcpScenePinned(s, 'shrinking it');
  if (late) { await drop(); return late; }
  let saved = false;
  try {
    await sceneStore.updateScene(s.id, rec => {
      if (rec.mapPath !== old.mapPath || rec.mapWidth !== old.mapWidth) return false;
      Object.assign(rec, mcpRescaleScene(rec, shrunk.outW, shrunk.outH), { mapPath: 'maps/' + s.id + ext });
      delete rec.mapBlob;
      saved = true;
    });
  } catch (err) { await drop(); return _mcpNo('Nothing changed: the shrunk map could not be saved (' + (err && err.message) + ').'); }
  if (!saved) { await drop(); return _mcpNo('Nothing changed: "' + s.name + '" changed while it was being shrunk. Try again.'); }
  try { await window.electronAPI.settleImportVideo(s.id, ext, true); } catch (err) {
    await sceneStore.putScene(old);
    await drop();
    return _mcpNo('Nothing changed: the new file could not take the old one\'s place (' + (err && err.message) + '). The map stays as it was.');
  }
  if (typeof syncIndex !== 'undefined' && syncIndex.isOn()) syncIndex.sceneFileReplaced(s.id);
  return _mcpOk('Shrank the map "' + s.name + '" from ' + old.mapWidth + '×' + old.mapHeight + ' (' + _mb(bytes.byteLength) + ') to ' + shrunk.outW + '×' + shrunk.outH + ' (' + _mb(shrunk.file.size) + '). ' +
    'Its rooms, doors, effects, lights, grid and fog sit where they were. This is permanent: the original file is gone, and undo_last_change cannot bring it back. Sync carries the new file to the DM\'s other computers.');
}

const MCP_SHRINK_TOOLS = { shrink_map: _mcpShrinkMap };
