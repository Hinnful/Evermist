'use strict';

// pictures.js — A ROOM'S PICTURES, SHOWN ON THE TV.
//
// THE GOAL OF THIS FEATURE: the DM keeps a portrait or a letter on the room it belongs to, and one
// click puts it on the TV over the dimmed map.
//
//   A. A room with no pictures shows no strip; the card carries a "+" for adding one.
//   B. A picture is shrunk to the Compression size when added, JPEG unless it has transparency,
//      and a file that is not a picture is named in one dialog.
//   C. A picture dropped on the card is added; one dropped elsewhere on the window makes no scene.
//   D. A click puts the picture on the TV, a second click takes it down.
//   E. Escape takes the picture down before it does anything else.
//   F. A drag reorders the strip, and Ctrl+Z puts the order back.
//   G. × deletes a picture and takes it off the TV; Ctrl+Z brings it back.
//   H. Deleting the room, or switching scene, takes the picture off the TV.
//   I. A Player that reloads gets the picture that is up.
//   J. Pictures are saved with the scene and come back after a switch away and back.
//   K. A room copied into another scene carries its pictures.
//   L. An animated GIF and an SVG are kept as they are, so the GIF still plays and the SVG stays
//      sharp; each keeps its own format.
//   (Two-map mode, one picture over both halves: two-maps.js, criterion R.)

const lib = require('../../lib');

const MAP_W = 1600, MAP_H = 1000;

// Two 1x1 frames and a loop block: the smallest file the decoder reads as animated.
const GIF_2_FRAMES = Buffer.from('47494638396101000100800000' + 'ffffff000000' +
  '21ff0b4e45545343415045322e300301000000' +
  ('21f904000a000000' + '2c00000000010001000000' + '0202440100').repeat(2) + '3b', 'hex').toString('base64');

const OWN_HELPERS = `
globalThis.__picFile = (name, w, h, alpha) => new Promise(r => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (!alpha) { g.fillStyle = '#7a0f18'; g.fillRect(0, 0, w, h); }
  g.fillStyle = '#d9c9b8'; g.fillRect(w / 4, h / 4, w / 2, h / 2);
  c.toBlob(b => r(new File([b], name, { type: 'image/png' })), 'image/png');
});
globalThis.__picPick = files => {
  const inp = document.getElementById('rp-pic-input');
  const dt = new DataTransfer(); files.forEach(f => dt.items.add(f));
  inp.files = dt.files;
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  return 0;
};
globalThis.__picDrop = (target, files) => {
  const dt = new DataTransfer(); files.forEach(f => dt.items.add(f));
  target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  return 0;
};
globalThis.__picRoom = () => polygons.find(p => p.id === 1);
globalThis.__picIds = () => (__picRoom() ? roomPictureRefs(__picRoom(), pictureBlobs).map(p => p.id) : []);
globalThis.__picThumbs = () => Array.from(document.querySelectorAll('#rp-pics .rp-pic'));
globalThis.__picEsc = () => { document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true })); return 0; };
0`;

module.exports = async function picturesFeature(rig) {
  const dm = rig.dm;
  await lib.openMap(rig, { w: MAP_W, h: MAP_H });
  await dm.evaluate(OWN_HELPERS);
  await dm.waitFor('fogCoverT === 0', 30000, 'the scene cover to lift');
  await dm.evaluate("localStorage.setItem(MAP_COMPRESS_KEY, '1080');" +
    " polygons = [{ id: 1, vertices: [{ x: 200, y: 200 }, { x: 700, y: 200 }, { x: 700, y: 600 }," +
    " { x: 200, y: 600 }], mode: 'reveal', cornerRadius: 0, name: 'Parlour' }]; nextPolygonId = 2;" +
    ' selectedPolygonId = 1; rebuildFogFromPolygons(); refreshRoomPanel(); scheduleRender(); 0');
  await lib.settle(dm, 'getComputedStyle(document.getElementById("panel-room")).display !== "none"', 6000);
  const tv = await rig.player();
  await dm.evaluate('sendToPlayer(); 0');
  await tv.waitFor('mapWidth > 0 && fogCoverT === 0', 30000, 'the map to reach the TV');

  const tvUp = () => tv.evaluate(`(() => { const el = document.getElementById('tv-picture');
    const img = el && Array.from(el.querySelectorAll('img')).find(i => i.getAttribute('src'));
    return { up: !!el && el.classList.contains('up'), w: img ? img.naturalWidth : 0 }; })()`);
  const waitTv = async want => lib.poll(async () => {
    const s = await tvUp();
    return s.up === want ? { s } : null;
  }, 8000);

  // ── A. no strip, and a "+" ─────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const bare = await dm.evaluate(`({ strip: getComputedStyle(document.getElementById('rp-pics')).display,
    add: !!document.getElementById('rp-pic-add') && document.getElementById('rp-pic-add').offsetWidth > 0 })`);
  rig.check(bare.strip === 'none', 'a room with no pictures shows a picture strip');
  rig.check(bare.add, 'the room card carries no "+" for adding a picture');

  // ── B. shrunk on the way in, JPEG unless transparent, a bad file named ─────
  // RED BY DESIGN: written against the feature, never re-proved
  await dm.evaluate(`(async () => { const a = await __picFile('portrait.png', 3000, 4000, false);
    const b = await __picFile('token.png', 400, 400, true);
    const c = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    __picPick([a, b, c]); return 0; })()`);
  await lib.settle(dm, '__picIds().length === 2', 20000);
  const added = await dm.evaluate(`(async () => {
    const out = [];
    for (const id of __picIds()) {
      const b = pictureBlobs[id]; const bmp = await createImageBitmap(b);
      out.push({ type: b.type, w: bmp.width, h: bmp.height }); bmp.close();
    }
    return out; })()`);
  rig.note('added: ' + JSON.stringify(added));
  rig.check(added.length === 2, 'two pictures and a text file did not add exactly two pictures');
  rig.check(added[0] && added[0].type === 'image/jpeg' && added[0].h === 1080 && added[0].w === 810,
            'a 3000x4000 picture was not shrunk to 1080 high as a JPEG: ' + JSON.stringify(added[0]));
  rig.check(added[1] && added[1].type === 'image/png' && added[1].w === 400,
            'a transparent picture lost its transparency or its size: ' + JSON.stringify(added[1]));
  await lib.settle(dm, "document.getElementById('cd-anchor').style.display === 'flex'", 6000);
  rig.check(await dm.evaluate("document.getElementById('cd-msg').textContent.includes('notes.txt')"),
            'the file that is not a picture was not named');
  await dm.evaluate("document.getElementById('cd-ok').click(); 0");
  rig.check(await dm.evaluate('__picThumbs().length === 2'), 'the strip does not show the two pictures');

  // ── C. a drop on the card adds, a drop on the window does not import ───────
  // RED BY DESIGN: written against the feature, never re-proved
  const scenes0 = await dm.evaluate('allScenes.length');
  await dm.evaluate(`(async () => { const f = await __picFile('letter.png', 600, 800, false);
    __picDrop(document.getElementById('panel-room'), [f]); return 0; })()`);
  await lib.settle(dm, '__picIds().length === 3', 20000);
  rig.check(await dm.evaluate('__picIds().length === 3'), 'a picture dropped on the card was not added');
  await dm.evaluate(`(async () => { const f = await __picFile('stray.png', 600, 800, false);
    __picDrop(document.body, [f]); return 0; })()`);
  await lib.hold(1500, 'long enough for a dropped picture to have started a map import, then prove it did not');
  rig.check(await dm.evaluate('allScenes.length') === scenes0, 'a picture dropped off the card became a scene');
  rig.check(await dm.evaluate('__picIds().length === 3'), 'a picture dropped off the card was added to the room');

  // ── D. click on, click off ─────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  await dm.evaluate('__picThumbs()[0].click(); 0');
  const shown = await waitTv(true);
  rig.check(!!shown && shown.s.w > 0, 'a click on a thumbnail did not put the picture on the TV');
  rig.check(await dm.evaluate('__picThumbs()[0].classList.contains("on")'),
            'the thumbnail on the TV is not marked');
  await dm.evaluate('__picThumbs()[0].click(); 0');
  rig.check(!!(await waitTv(false)), 'a second click did not take the picture down');
  rig.byEye('the picture sits centred over a dimmed map and comes and goes in patches of fog');

  // ── E. Escape first ────────────────────────────────────────────────────────
  // RED ON: takeDownTvPicture gated off with false && in the Escape case (input.js) — 2026-09-30
  await dm.evaluate('__picThumbs()[1].click(); 0');
  await waitTv(true);
  await dm.evaluate('__picEsc()');
  rig.check(!!(await waitTv(false)), 'Escape did not take the picture down');
  rig.check(await dm.evaluate('selectedPolygonId === 1'),
            'Escape closed the room card before it took the picture down');

  // ── F. reorder, undone ─────────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const order0 = await dm.evaluate('__picIds()');
  await dm.evaluate(`(() => { const t = __picThumbs(); const dt = new DataTransfer();
    t[0].dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    t[2].dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    t[0].dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true })); return 0; })()`);
  const order1 = await dm.evaluate('__picIds()');
  rig.check(order1.join() === [order0[1], order0[2], order0[0]].join(),
            'a drag did not move the first picture to the end: ' + JSON.stringify({ order0, order1 }));
  await dm.evaluate('undo(); 0');
  rig.check((await dm.evaluate('__picIds()')).join() === order0.join(), 'Ctrl+Z did not put the order back');

  // ── G. delete, off the TV, undone ──────────────────────────────────────────
  // RED ON: reconcileTvPicture gated off with false && (roomPictures.js) — 2026-09-30
  await dm.evaluate('__picThumbs()[0].click(); 0');
  await waitTv(true);
  await dm.evaluate("__picThumbs()[0].querySelector('.rp-pic-x').click(); 0");
  rig.check((await dm.evaluate('__picIds()')).length === 2, '× did not delete the picture');
  rig.check(!!(await waitTv(false)), 'deleting the picture on the TV left it on the TV');
  await dm.evaluate('undo(); 0');
  rig.check((await dm.evaluate('__picIds()')).join() === order0.join(), 'Ctrl+Z did not bring the picture back');

  // ── H. room deleted, scene switched ────────────────────────────────────────
  // RED ON: reconcileTvPicture gated off with false && (roomPictures.js) — 2026-09-30
  await dm.evaluate('__picThumbs()[0].click(); 0');
  await waitTv(true);
  await dm.evaluate('selectedPolygonId = 1; deleteSelectedPolygon(); 0');
  rig.check(!!(await waitTv(false)), 'deleting the room left its picture on the TV');
  await dm.evaluate('undo(); selectedPolygonId = 1; refreshRoomPanel(); 0');
  await lib.settle(dm, '__picThumbs().length === 3', 6000);

  // ── I. a Player reload ─────────────────────────────────────────────────────
  // RED ON: resendTvPicture gated off on PLAYER_READY (toolbar.js) — 2026-09-30
  await dm.evaluate('__picThumbs()[0].click(); 0');
  await waitTv(true);
  await tv.evaluate('location.reload(); 0').catch(() => {});
  await lib.installHelpers(tv).catch(() => {});
  rig.check(!!(await lib.poll(async () => {
    const s = await tvUp().catch(() => ({ up: false }));
    return s.up ? { s } : null;
  }, 20000)), 'a Player that reloaded did not get the picture that was up');

  // ── J. saved with the scene ────────────────────────────────────────────────
  // RED BY DESIGN: written against the feature, never re-proved
  const sceneA = await dm.evaluate('currentScene.id');
  await dm.evaluate('doAutoSave()');
  const stored = await dm.evaluate(`sceneStore.loadScene(${JSON.stringify(sceneA)}).then(s =>
    Object.keys(s.pictureBlobs || {}).length)`);
  rig.check(stored === 3, 'the saved scene does not carry its three pictures: ' + stored);
  await dm.evaluate('copySelectedShape(); 0');
  await lib.openMap(rig, { w: MAP_W, h: MAP_H });
  await lib.settle(dm, 'currentScene && currentScene.id !== ' + JSON.stringify(sceneA), 60000);
  rig.check(!!(await waitTv(false)), 'switching scene left the picture on the TV');

  // ── K. pasted into another scene ───────────────────────────────────────────
  // RED ON: the pictureBlobs merge in _clipDrop gated off (shapeClipboard.js) — 2026-09-30
  await dm.evaluate('pasteShapeAtCursor(); 0');
  const pasted = await dm.evaluate('(() => { const p = polygons[polygons.length - 1];' +
    ' return p ? roomPictureRefs(p, pictureBlobs).length : -1; })()');
  rig.check(pasted === 3, 'a room pasted into another scene lost its pictures: ' + pasted);

  await dm.evaluate('switchScene(' + JSON.stringify(sceneA) + ')');
  await lib.settle(dm, 'currentScene && currentScene.id === ' + JSON.stringify(sceneA), 60000);
  await dm.evaluate('selectedPolygonId = 1; refreshRoomPanel(); 0');
  rig.check(await dm.evaluate('__picThumbs().length === 3'),
            'the pictures did not come back after a switch away and back');

  // ── L. animated and vector files kept whole ────────────────────────────────
  // RED ON: the animated-file keep in decodeRoomPicture gated off with false && (pictureDecode.js) - 2026-09-30
  const before = await dm.evaluate('__picIds().length');
  await dm.evaluate(`(() => {
    const gif = Uint8Array.from(atob(${JSON.stringify(GIF_2_FRAMES)}), c => c.charCodeAt(0));
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#7a0f18"/></svg>';
    __picPick([new File([gif], 'candle.gif', { type: 'image/gif' }),
               new File([svg], 'sigil.svg', { type: 'image/svg+xml' })]); return 0; })()`);
  await lib.settle(dm, '__picIds().length === ' + (before + 2), 20000);
  const kept = await dm.evaluate('__picIds().slice(' + before + ').map(id => pictureBlobs[id].type)');
  rig.check(kept.join() === 'image/gif,image/svg+xml',
            'an animated GIF or an SVG was re-encoded instead of kept: ' + JSON.stringify(kept));

  rig.byEye('a backup exported and restored through the real save dialog brings the pictures back');
};
