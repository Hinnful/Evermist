'use strict';

// claude-sees.js — CLAUDE LOOKS AT A MAP.
//
// THE GOAL OF THIS FEATURE: before Claude draws rooms it sees the map. view_scene hands it the map as
// a picture with a percent grid over it (or a zoomed area of it), and read_scene lists everything the map
// holds, in percent. Both only read: the DM's screen and the TV never change.
//
// It drives src/mcp/mcpSee.js and mcpSeePlan.js through the bridge, as claude-prep.js does.
//
//   A. read_scene on the open map gives its size and type, whether the TV shows it, the grid, and every room in
//      polygons order with name, notes, fog and an outline in percent.
//   B. read_scene also lists effects and says whether a floor plan is loaded.
//   C. view_scene of the whole map answers a JPEG no longer than 1568 px on its long side, in the map's proportions,
//      under 1 MB, with the grid step in its text.
//   D. view_scene with an area crops to it, enlarged to 800 px, with a finer grid.
//   E. A map that is not open is seen too: a still from the library, and an animated map from its file.
//   F. Looking changes nothing: the open scene, its rooms and the page's canvases and videos are as they were.
//   G. A wrong name or an area off the map is refused.

const fs = require('fs');
const path = require('path');
const lib = require('../../lib');

const MAP = { w: 1600, h: 1000 };
const TALL = { w: 1200, h: 1500 };

// The pixel size a JPEG declares, from its first start-of-frame marker.
function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

module.exports = async function claudeSees(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, MAP);
  await lib.settle(dm, 'fogCoverT === 0', 30000);

  const address = await lib.poll(async () => {
    try { return JSON.parse(fs.readFileSync(path.join(rig.profileDir, 'mcp.json'), 'utf8')); } catch { return null; }
  }, 15000);
  rig.check(!!(address && address.port && address.token), 'the app wrote no mcp.json with a port and a key into its profile');
  if (!address) return;
  const call = async (tool, args) => (await fetch('http://127.0.0.1:' + address.port + '/call', {
    method: 'POST', body: JSON.stringify({ tool, args: args || {} }),
    headers: { 'content-type': 'application/json', 'x-evermist-token': address.token },
  })).json();

  const scene = await dm.evaluate('({ id: currentScene.id, name: currentScene.name })');
  await dm.evaluate(`polygons = [
    { id: 1, vertices: [{x:160,y:100},{x:480,y:100},{x:480,y:300},{x:160,y:300}], mode: 'shroud', cornerRadius: 0, name: 'Vestry', desc: 'Two acolytes.' },
    { id: 2, vertices: [{x:800,y:500},{x:960,y:500},{x:960,y:600},{x:800,y:600}], mode: 'half', cornerRadius: 0 },
    { id: 3, vertices: [{x:1000,y:100},{x:1400,y:100},{x:1400,y:400},{x:1000,y:400}], mode: 'reveal', cornerRadius: 0, name: 'Hall', desc: '' }];
    nextPolygonId = 4; rebuildFogFromPolygons(); refreshRoomPanel(); doAutoSave(); 0`);

  // ── A. Reading a map ──────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const read = await call('read_scene', { name: scene.name });
  const info = read.isError ? null : JSON.parse(read.text);
  rig.check(info && info.map.widthPx === MAP.w && info.map.heightPx === MAP.h && typeof info.onTv === 'boolean' && info.grid && typeof info.grid.cellPx !== 'undefined',
            'read_scene gave no map size, TV flag or grid: ' + JSON.stringify(read).slice(0, 300));
  if (!info) return;
  rig.check(info.rooms.map(r => r.name + ':' + r.fog).join() === 'Vestry:hidden,null:half,Hall:revealed' && info.rooms[0].notes === 'Two acolytes.',
            'read_scene did not list the rooms in order with name, notes and fog: ' + JSON.stringify(info.rooms.map(r => [r.name, r.fog])));
  rig.check(JSON.stringify(info.rooms[0].outline) === '[[10,10],[30,10],[30,30],[10,30]]',
            'read_scene gave the first room\'s outline as ' + JSON.stringify(info.rooms[0].outline) + ', not percent points');

  // ── B. Effects and the plan ───────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(Array.isArray(info.effects) && info.floorPlan && info.floorPlan.loaded === false && info.floorPlan.walls === 0,
            'read_scene did not list effects, or reported a floor plan on a map without one: ' + JSON.stringify({ effects: info.effects, plan: info.floorPlan }));

  // ── C. The whole map as a picture ─────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const before = await dm.evaluate('JSON.stringify([currentScene.id, polygons.length, mapWidth, mapHeight, document.querySelectorAll("canvas").length, document.querySelectorAll("video").length])');
  const whole = await call('view_scene', { name: scene.name });
  const bytes = whole.image ? Buffer.from(whole.image.data, 'base64') : null;
  const size = bytes && jpegSize(bytes);
  rig.check(!whole.isError && whole.image && whole.image.mimeType === 'image/jpeg' && size, 'view_scene gave no JPEG: ' + JSON.stringify(whole).slice(0, 200));
  if (size) {
    rig.check(Math.max(size.w, size.h) <= 1568 && Math.abs(size.w / size.h - MAP.w / MAP.h) < 0.01,
              'the picture is ' + size.w + 'x' + size.h + ', over 1568 on the long side or not the map\'s proportions');
    rig.check(bytes.length < 1000000, 'the picture is ' + bytes.length + ' bytes, too big for a reply');
    rig.check(/every 10%/.test(whole.text) && /Vestry/.test(whole.text), 'the text names no 10% grid or no room: ' + whole.text);
  }

  // ── D. An area ────────────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const zoom = await call('view_scene', { name: scene.name, area: { x: 10, y: 10, w: 25, h: 25 } });
  const zsize = zoom.image && jpegSize(Buffer.from(zoom.image.data, 'base64'));
  rig.check(zsize && zsize.w === 800 && zsize.h === 500 && /every 2\.5%/.test(zoom.text),
            'the zoomed picture is not the 400x250 crop enlarged to 800x500 with a 2.5% grid: ' + JSON.stringify({ zsize, text: zoom.text }));

  // ── E. A map that is not open ─────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const still = await rig.fixtures.stillMap(dm, rig.fixtureDir, { w: 800, h: 500, name: 'claude-sees.png' });
  const mapDir = path.join(rig.fixtureDir, 'claude-sees-maps');
  fs.mkdirSync(mapDir, { recursive: true });
  fs.copyFileSync(still.path, path.join(mapDir, 'claude-sees.png'));
  await call('create_scene', { path: path.join(mapDir, 'claude-sees.png'), name: 'Stored Still' });
  const stored = await call('view_scene', { name: 'Stored Still' });
  const ssize = stored.image && jpegSize(Buffer.from(stored.image.data, 'base64'));
  rig.check(ssize && ssize.w === 800 && ssize.h === 500 && /no rooms yet/.test(stored.text), 'a map in the library, not open, was not seen: ' + JSON.stringify(stored).slice(0, 200));
  const second = await rig.fixtures.tableMap(dm, rig.fixtureDir, TALL);
  await dm.evaluate('createNewScene(' + await rig.fixtures.asFileExpr(dm, second) + ')', 180000);
  const other = await dm.evaluate('({ id: currentScene.id, name: currentScene.name })');
  await dm.evaluate('switchScene(' + JSON.stringify(scene.id) + '); 0');
  await lib.settle(dm, 'currentScene && currentScene.id === ' + JSON.stringify(scene.id) + ' && fogCoverT === 0', 30000);
  const video = await call('view_scene', { name: other.name });
  const vsize = video.image && jpegSize(Buffer.from(video.image.data, 'base64'));
  rig.check(vsize && Math.abs(vsize.w / vsize.h - TALL.w / TALL.h) < 0.01, 'an animated map, not open, was not seen from its file: ' + JSON.stringify(video).slice(0, 200));

  // ── F. Looking changes nothing ────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const after = await dm.evaluate('JSON.stringify([currentScene.id, polygons.length, mapWidth, mapHeight, document.querySelectorAll("canvas").length, document.querySelectorAll("video").length])');
  rig.check(after === before, 'looking at maps changed the open scene or left canvases or videos on the page: ' + before + ' became ' + after);

  // ── G. Refusals ───────────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const nameless = await call('view_scene', { name: 'No Such Map' });
  const offMap = await call('view_scene', { name: scene.name, area: { x: 150, y: 0, w: 10, h: 10 } });
  rig.check(nameless.isError && /create_scene/.test(nameless.text) && offMap.isError && /area/.test(offMap.text),
            'a missing map or an area off the map was not refused: ' + JSON.stringify({ nameless, offMap }));
};
