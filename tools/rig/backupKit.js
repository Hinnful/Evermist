'use strict';

// backupKit.js — what the backup scenarios share: a library with every kind of record a backup carries,
// a digest of that library, a wipe that leaves the app empty, and a reader for the zip's own table of contents.
// Nothing here asserts. The scenarios are backup-large-library, backup-two-laptops and backup-every-record.
//
// ⚠ THE LIBRARY IS BUILT THROUGH THE APP'S OWN STORES (sceneStore.saveScene, worldPlaceSet, notesEntryAdd,
// cbSave, mtStore, galleryAddFile), never by writing IndexedDB or localStorage directly, so every record carries
// the edit times the app really gives it. `at(ms, fn)` runs one edit under a fixed clock, which is how two
// "laptops" get edits in a chosen order without waiting for them.
//
// ⚠ A WIPE IS PROVEN BY A RESTART. The caches in the page (places, roads, entries, fights, module text) are
// module-private, so only a restart empties them; `wipe` clears the stores and the scenario restarts and asserts the
// app came up empty.

const fs = require('fs');

// ─── The page side ───────────────────────────────────────────────────────────

const KIT = `
globalThis.__bk = globalThis.__bk || {};
(() => {
const B = globalThis.__bk;
B.realNow = B.realNow || Date.now.bind(Date);

// ── A fixed clock for one edit ──
B.at = async (ms, fn) => {
  Date.now = () => ms;
  try { return await fn(); } finally { Date.now = B.realNow; }
};

// ── Pictures made in the page ──
// A noise tile, drawn over a per-map colour: the bytes stay as large as a real map's, which a flat fill does not.
B.noiseFile = async (name, w, h, seed, quality) => {
  if (!B.tile) {
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const x = c.getContext('2d'), img = x.createImageData(512, 512);
    for (let o = 0; o < img.data.length; o += 65536) crypto.getRandomValues(img.data.subarray(o, Math.min(o + 65536, img.data.length)));
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    x.putImageData(img, 0, 0);
    B.tile = c;
  }
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = 'hsl(' + ((seed * 47) % 360) + ' 45% 32%)'; x.fillRect(0, 0, w, h);
  x.save(); x.translate((seed * 131) % 512, (seed * 71) % 512); x.globalAlpha = 0.6;
  x.fillStyle = x.createPattern(B.tile, 'repeat'); x.fillRect(-512, -512, w + 512, h + 512); x.restore();
  x.fillStyle = '#fff'; x.font = Math.round(h / 20) + 'px sans-serif'; x.fillText(name, w / 20, h / 10);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', quality || 0.9));
  c.width = c.height = 1;
  return new File([blob], name + '.jpg', { type: 'image/jpeg' });
};

B.smallPng = async (seed) => {
  const c = document.createElement('canvas'); c.width = 96; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = 'hsl(' + ((seed * 53) % 360) + ' 60% 45%)'; x.fillRect(0, 0, 96, 64);
  x.fillStyle = '#fff'; x.fillRect(seed % 60, 10, 20, 20);
  return new Promise(r => c.toBlob(r, 'image/png'));
};

// A fog layer with one clear disc, in the ground no room covers (a room repaints its own fog): its spot is the map's own, and the fog came back if that spot is clear.
B.fogDisc = async (w, h, k) => {
  const fw = Math.ceil(w / FOG_SCALE), fh = Math.ceil(h / FOG_SCALE);
  const c = document.createElement('canvas'); c.width = fw; c.height = fh;
  const x = c.getContext('2d');
  x.fillStyle = '#0b1020'; x.fillRect(0, 0, fw, fh);
  const cx = Math.round(fw * (0.6 + 0.25 * ((k * 37 % 100) / 100))), cy = Math.round(fh * 0.8);
  x.globalCompositeOperation = 'destination-out';
  x.beginPath(); x.arc(cx, cy, Math.round(fh / 12), 0, Math.PI * 2); x.fill();
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  return { blob, mx: cx * FOG_SCALE, my: cy * FOG_SCALE };
};

// ── A map's own records ──
// opts: { pictured } gives room 1 a picture. Saved through saveScene, so every part is stamped.
B.decorate = async (id, k, opts) => {
  const o = opts || {};
  const sc = await sceneStore.loadScene(id);
  const w = sc.mapWidth, h = sc.mapHeight;
  const rect = (a, b, c, d) => [{ x: a * w, y: b * h }, { x: c * w, y: b * h }, { x: c * w, y: d * h }, { x: a * w, y: d * h }];
  const modes = ['reveal', 'shroud', 'half'];
  const spots = [rect(0.08, 0.08, 0.4, 0.4), rect(0.5, 0.08, 0.92, 0.4), rect(0.08, 0.5, 0.5, 0.9)];
  sc.polygons = spots.map((v, i) => ({ id: i + 1, uid: 'rm' + k + 'x' + (i + 1), name: sc.name + ': зал ' + (i + 1),
    desc: 'Описание зала ' + (i + 1) + ' карты ' + k, mode: modes[i], cornerRadius: 0, vertices: v }));
  sc.nextPolygonId = 4;
  const mat = Object.keys(EFFECT_MATERIALS)[0];
  sc.effects = [{ id: 1, uid: 'fx' + k + 'x1', vertices: rect(0.55, 0.55, 0.7, 0.7), cornerRadius: 0, material: mat },
                { id: 2, uid: 'fx' + k + 'x2', vertices: rect(0.75, 0.55, 0.9, 0.7), cornerRadius: 0, material: mat }];
  sc.lightShapes = [{ id: 3, uid: 'lt' + k + 'x1', vertices: rect(0.1, 0.1, 0.2, 0.2), cornerRadius: 0, light: true }];
  sc.lightsHidden = false;
  sc.nextEffectId = 4;
  sc.notes = 'Заметки к карте ' + k + ': ' + sc.name;
  sc.floorPlanName = 'План ' + k + '.dd2vtt';
  sc.fogSettings = sc.fogSettings || undefined;
  sc.weather = ['rain', 'snow', 'none'][k % 3];
  sc.fogTheme = k % 2 ? 'fire' : 'ice';
  if (k % 2 === 0) sc.tvFit = { step: 1, turn: 1 };
  sc.gridConfig = Object.assign({}, sc.gridConfig, { opacity: 0.2 + (k % 5) * 0.05 });
  const fog = await B.fogDisc(w, h, k);
  sc.baseFogBlob = fog.blob;
  if (o.pictured) {
    const pid = 'pic' + k + 'rig';
    sc.polygons[0].pictures = [{ id: pid, name: 'Рисунок ' + k }];
    sc.pictureBlobs = Object.assign({}, sc.pictureBlobs, { [pid]: await B.smallPng(k) });
  }
  await sceneStore.saveScene(sc);
  return { fogAt: { x: fog.mx, y: fog.my } };
};

// One scene record, read through the store, a field at a time.
B.editScene = async (id, mutate) => {
  const sc = await sceneStore.loadScene(id);
  await mutate(sc);
  await sceneStore.saveScene(sc);
};

// The campaign-level records: groups, roads, entries, the campaign note, fights, bestiary, module text, pictures.
B.campaign = async (ids, tag) => {
  const sq = (x, y, s) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
  worldPlaceSet('Север', sq(0, 0, 500));
  worldPlaceSet('Юг', sq(700, 0, 500));
  notesPlaceSet('Север', 'Заметка о Севере ' + tag);
  notesPlaceSet('Юг', 'Заметка о Юге ' + tag);
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i], north = i % 2 === 0;
    const pos = { x: (north ? 60 : 760) + (i % 3) * 120, y: 60 + Math.floor(i / 3) * 110 };
    await B.editScene(id, sc => { sc.group = north ? 'Север' : 'Юг'; sc.worldPos = pos; });
    const meta = allScenes.find(s => s.id === id);
    if (meta) { meta.group = north ? 'Север' : 'Юг'; meta.worldPos = pos; }
  }
  const roads = [];
  if (ids.length >= 2) {
    const a = allScenes.find(s => s.id === ids[0]).worldPos, b = allScenes.find(s => s.id === ids[1]).worldPos;
    const uid = worldRoadCreate([a, { x: (a.x + b.x) / 2, y: a.y + 60 }, b],
      [{ kind: 'scene', ref: ids[0] }, { kind: 'scene', ref: ids[1] }]);
    worldRoadRename(uid, 'Королевский тракт');
    notesRoadSet(uid, 'Заметка о тракте ' + tag);
    roads.push(uid);
  }
  const f1 = notesEntryAdd('faction', 'Гильдия воров'); notesEntrySetNote(f1.id, 'Гильдия: заметка ' + tag);
  const f2 = notesEntryAdd('faction', 'Орден Рассвета', f1.id); notesEntrySetNote(f2.id, 'Орден: вложенная фракция');
  const l1 = notesEntryAdd('lore', 'Падение империи'); notesEntrySetNote(l1.id, 'Предание: заметка ' + tag);
  notesCampaignSet('Заметка кампании ' + tag);
  // The party marker needs a map to stand on.
  if (typeof worldPartyPlace === 'function' && ids.length) { try { worldPartyPlace({ scene: ids[0] }); } catch (_) { /* a marker is optional here */ } }
  return { roads, entries: [f1.id, f2.id, l1.id] };
};

B.fights = (tag) => {
  const wolf = combatBlankBlock(0, 'Волк'); wolf.hp = '11'; wolf.ac = '13'; wolf.notes = 'Волк ' + tag;
  const drake = combatBlankBlock(0, 'Дракончик'); drake.hp = '52'; drake.ac = '16';
  cbAddBlocks([wolf, drake], 'rig');
  cbState.rows.push({ id: cbState.nextId++, init: '14', name: 'Волк', hp: '11', ac: '13', conds: [], side: 'enemy', sbChanged: false });
  cbState.rows.push({ id: cbState.nextId++, init: '9', name: 'Боец', hp: '30', ac: '18', conds: [], side: 'ally', sbChanged: false });
  const open = cbState.fights.find(f => f.id === cbState.openId);
  if (open) open.name = 'Засада на тракте';
  combatAddFight(cbState, combatFightId);
  cbState.rows.push({ id: cbState.nextId++, init: '11', name: 'Дракончик', hp: '52', ac: '16', conds: [], side: 'enemy', sbChanged: false });
  const second = cbState.fights.find(f => f.id === cbState.openId);
  if (second) second.name = 'Логово';
  cbSave();
};

B.moduleText = (name) => mtStore([
  { num: '1', name: 'Вход', title: '1. Вход', body: 'Текст зала один для ' + name },
  { num: '2', name: 'Склеп', title: '2. Склеп', body: 'Текст склепа для ' + name }], name);

B.gallery = async (n, prefix) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const f = new File([await B.smallPng(i + 7)], (prefix || 'Рисунок') + ' ' + (i + 1) + '.png', { type: 'image/png' });
    const p = await galleryAddFile(f);
    if (p) out.push(p.id);
  }
  return out;
};

// ── The digest ──
B.hash = async (blob) => {
  if (!blob) return null;
  const buf = await blob.arrayBuffer();
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return Array.from(h.slice(0, 10)).map(v => v.toString(16).padStart(2, '0')).join('') + ':' + buf.byteLength;
};

// Every part of a scene as its own string, so a difference names the part.
B.sceneDigest = async (id) => {
  const sc = await sceneStore.loadScene(id);
  const pics = {};
  for (const k of Object.keys(sc.pictureBlobs || {})) pics[k] = await B.hash(sc.pictureBlobs[k]);
  const d = {
    name: sc.name, group: sc.group || '', worldPos: JSON.stringify(sc.worldPos || null),
    map: sc.mapType === 'video' ? 'video:' + sc.mapWidth + 'x' + sc.mapHeight : await B.hash(sc.mapBlob),
    size: sc.mapWidth + 'x' + sc.mapHeight, type: sc.mapType,
    rooms: JSON.stringify((sc.polygons || []).map(p => [p.uid, p.id, p.name, p.desc || '', p.mode, p.vertices, (p.pictures || []).map(x => x.id)])),
    effects: JSON.stringify((sc.effects || []).map(e => [e.uid, e.id, e.material, e.vertices])),
    lights: JSON.stringify([sc.lightsHidden, sc.lightShapes || []]),
    nextIds: sc.nextPolygonId + ',' + sc.nextEffectId,
    notes: sc.notes || '', grid: esCanon(sc.gridConfig || {}), fogLook: esCanon([sc.fogSettings, sc.fogTheme]),
    weather: String(sc.weather || ''), tvFit: esCanon(sc.tvFit || null),
    floorPlan: sc.floorPlan ? String(sc.floorPlan.length || JSON.stringify(sc.floorPlan).length) : '',
    floorPlanName: sc.floorPlanName || '',
    fog: await B.hash(sc.baseFogBlob), thumb: sc.thumbnail ? 'yes' : 'no', pictures: JSON.stringify(pics),
    stamps: esCanon(sc.edits || null),
  };
  const video = sc.mapType === 'video' ? await window.electronAPI.getVideoFilePath(id) : null;
  return { d, video };
};

// A row's stat block copy is made when the table first shows the row, so a blank one is not part of what came back.
B.combatText = () => {
  const raw = cbBackupPayload();
  if (!raw) return '';
  const d = JSON.parse(raw);
  const blank = sb => !sb || (!sb.ac && !sb.hp && !sb.meta && !sb.notes);
  const strip = rows => (rows || []).forEach(r => { if (blank(r.sb)) delete r.sb; });
  strip(d.rows); (d.fights || []).forEach(f => strip(f.rows));
  return esCanon(d);
};

B.digest = async () => {
  if (currentScene) await doAutoSave();
  const scenes = {}, videos = {};
  for (const s of allScenes) {
    const r = await B.sceneDigest(s.id);
    scenes[s.id] = r.d;
    if (r.video) videos[s.id] = r.video;
  }
  const mt = mtBackupPayload();
  const gallery = [];
  for (const p of await galleryStore.all()) gallery.push([p.id, p.name, p.named || 0, await B.hash(p.blob)]);
  gallery.sort();
  // A restored map's room pictures join the gallery (galleryAdoptScenes), so those are told apart.
  const roomPics = gallery.filter(g => /^pic.*rig$/.test(g[0])).length;
  const world = {
    places: JSON.stringify(worldPlacesExport()), placeNotes: JSON.stringify(notesPlacesAll()),
    roads: JSON.stringify(worldRoadsExport()), roadNotes: JSON.stringify(notesRoadsAll()),
    party: JSON.stringify(worldPartyExport()), groupUids: JSON.stringify(mxGroupUids()),
    entries: JSON.stringify(notesEntriesAll()), campaignNote: notesCampaignGet(), campaignNoteAt: String(notesCampaignAt()),
    combat: B.combatText(), moduleText: mt ? JSON.stringify(JSON.parse(mt).e) + '|' + JSON.parse(mt).src : '',
    gallery: JSON.stringify(gallery.filter(g => !/^pic.*rig$/.test(g[0]))), roomPicsInGallery: String(roomPics),
  };
  const wb = await worldBackgroundBackupPayload();
  world.worldBg = wb ? wb.meta + '|' + await B.hash(new Blob([wb.buffer])) : '';
  const music = (await window.electronAPI.listMusicFiles()).map(m => m.name).sort();
  return { scenes, videos, world, music };
};

// ── Empty ──
B.wipe = async () => {
  const ids = allScenes.map(s => s.id);
  deleteScenesWithUndo(ids);
  commitPendingDelete();
  for (const id of ids) { await sceneStore.deleteScene(id); await window.electronAPI.deleteVideoFile(id).catch(() => {}); }
  for (const p of await galleryStore.all()) await galleryStore.remove(p.id);
  for (const m of await window.electronAPI.listMusicFiles()) await window.electronAPI.deleteMusicFile(m.name).catch(() => {});
  localStorage.clear();
  return ids.length;
};

B.emptyNow = async () => ({
  scenes: allScenes.length, entries: notesEntriesAll().length, places: Object.keys(worldPlacesExport()).length,
  roads: Object.keys(worldRoadsExport()).length, note: notesCampaignGet(), module: mtBackupPayload() ? 1 : 0,
  combat: cbBackupPayload() ? 1 : 0, gallery: (await galleryStore.all()).length, music: (await window.electronAPI.listMusicFiles()).length,
});

// Messages the app would have put on screen, kept instead.
B.said = [];
B.say = (m) => { B.said.push((m && m.title ? m.title : '') + ' | ' + (m && m.message ? m.message : '')); };
})();
0`;

async function install(session) {
  await session.evaluate(KIT);
}

// ─── The node side ───────────────────────────────────────────────────────────

// The zip's own table of contents, read off its central directory. Names only; a zip64 file is not expected.
function zipEntries(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tailLen = Math.min(size, 70000), tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0) throw new Error('no end-of-central-directory record: not a zip');
    const count = tail.readUInt16LE(eocd + 10), cdSize = tail.readUInt32LE(eocd + 12), cdOff = tail.readUInt32LE(eocd + 16);
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOff);
    const out = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('central directory is damaged at entry ' + i);
      const nameLen = cd.readUInt16LE(p + 28), extraLen = cd.readUInt16LE(p + 30), commentLen = cd.readUInt16LE(p + 32);
      out.push({ name: cd.toString('utf8', p + 46, p + 46 + nameLen), size: cd.readUInt32LE(p + 24) });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  } finally { fs.closeSync(fd); }
}

// The digest with each animated map's file hashed from disk, here, where the bytes can be read.
function withVideoHashes(digest) {
  const crypto = require('crypto');
  for (const id of Object.keys(digest.videos || {})) {
    const f = digest.videos[id];
    let h = null;
    try { h = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 20) + ':' + fs.statSync(f).size; } catch (_) { h = 'no file'; }
    digest.scenes[id].videoFile = h;
  }
  return digest;
}

// What differs between two digests, as { where, key } lines. `ignore` drops keys (the stamps, say).
function diffDigests(a, b, ignore) {
  const skip = new Set(ignore || []);
  const out = [];
  const same = (x, y) => x === y;
  for (const id of Object.keys(a.scenes)) {
    const x = a.scenes[id], y = b.scenes[id];
    if (!y) { out.push({ where: 'map ' + x.name, key: 'missing' }); continue; }
    for (const k of Object.keys(x)) if (!skip.has(k) && !same(x[k], y[k])) out.push({ where: 'map ' + x.name, key: k, was: x[k], now: y[k] });
  }
  for (const id of Object.keys(b.scenes)) if (!a.scenes[id]) out.push({ where: 'map ' + b.scenes[id].name, key: 'appeared' });
  for (const k of Object.keys(a.world)) if (!skip.has(k) && !same(a.world[k], b.world[k])) out.push({ where: 'campaign', key: k, was: a.world[k], now: b.world[k] });
  if (JSON.stringify(a.music) !== JSON.stringify(b.music)) out.push({ where: 'music', key: 'tracks', was: a.music.join(','), now: b.music.join(',') });
  return out;
}

const brief = (s, n) => { s = String(s == null ? '' : s); return s.length > (n || 90) ? s.slice(0, n || 90) + '…' : s; };
const around = (x, i) => brief(String(x).slice(Math.max(0, i - 30)), 90);
function describe(d) {
  if (d.was === undefined) return d.where + ' / ' + d.key;
  const a = String(d.was), b = String(d.now);
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return d.where + ' / ' + d.key + ' (differs at ' + i + ': was ...' + around(a, i) + ' now ...' + around(b, i) + ')';
}

// A check for a bug already filed. It never fails the run: while the bug stands it is a noted line naming the item,
// and once the cause is fixed it says so, so the check can be promoted to a real one.
function known(rig, item, holds, message) {
  rig.note((holds ? 'NOW HOLDS (item ' + item + ' looks fixed, make this a check): ' : 'KNOWN, item ' + item + ': ') + message);
}

module.exports = { install, zipEntries, withVideoHashes, diffDigests, describe, known, brief };
