'use strict';
// galleryPlan.js — pure: the gallery's pictures, their sizes, names and the shapes they travel in.
// No DOM.
//
// ⚠ A ROOM STILL CARRIES `pictures` ({ id, name }) AND A SCENE `pictureBlobs`, untouched: the
// previous release reads them. Nothing here edits either; it only reads them out.

// Compression Off still fits a picture inside 4K: nothing larger reaches a TV.
const PICTURE_MAX_BOX = { w: 3840, h: 2160 };

function pictureBox(compress) {
  return compress && compress.w ? { w: compress.w, h: compress.h } : PICTURE_MAX_BOX;
}

// Never upscales.
function pictureFit(w, h, box) {
  const s = Math.min(1, box.w / w, box.h / h);
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

const PICTURE_ID_RE = /^[a-z0-9]{1,32}$/;

// The types a picture is stored as. Anything else was re-encoded to JPEG or PNG on the way in.
const PICTURE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' };

function pictureType(type) {
  return PICTURE_EXT[type] ? type : 'image/jpeg';
}

// ⚠ THE ZIP NAME IS BUILT FROM THE ID AND A FIXED EXTENSION, never taken from a manifest string.
function pictureZipName(id, type) {
  if (typeof id !== 'string' || !PICTURE_ID_RE.test(id)) return null;
  return 'pic-' + id + '.' + PICTURE_EXT[pictureType(type)];
}

// A file name without its extension, or the whole name when that would leave nothing.
function galleryNameFromFile(fileName) {
  const s = String(fileName == null ? '' : fileName).trim();
  return s.replace(/\.[^./\\]+$/, '').trim() || s;
}

// ─── What a scene's rooms still hold ─────────────────────────────────────────

// A room holds { id, name } only; the bytes are the scene's. A ref whose bytes are gone reads as absent.
function roomPictureRefs(poly, blobs) {
  const list = poly && Array.isArray(poly.pictures) ? poly.pictures : [];
  return list.filter(p => p && typeof p.id === 'string' && blobs && blobs[p.id]);
}

// The scene's bytes, trimmed to what its rooms point at.
function picturesReferenced(polygons, blobs) {
  const out = {};
  for (const poly of polygons || []) {
    for (const p of roomPictureRefs(poly, blobs)) out[p.id] = blobs[p.id];
  }
  return out;
}

// What a scene backup carries: each picture a room still points at, once.
function pictureBackupList(polygons, blobs) {
  const seen = new Set();
  const out = [];
  for (const poly of polygons || []) {
    for (const p of roomPictureRefs(poly, blobs)) {
      if (seen.has(p.id) || !pictureZipName(p.id)) continue;
      seen.add(p.id);
      out.push({ id: p.id, type: pictureType(blobs[p.id].type) });
    }
  }
  return out;
}

// ─── Migration ───────────────────────────────────────────────────────────────

// Every picture any of these scenes' rooms holds, once by id, named as its first room named it
// without the file extension. The id is the picture's own, so a rerun adds nothing twice.
function galleryFromScenes(scenes) {
  const seen = new Set();
  const out = [];
  for (const scene of scenes || []) {
    if (!scene) continue;
    const blobs = scene.pictureBlobs || {};
    for (const poly of scene.polygons || []) {
      for (const p of roomPictureRefs(poly, blobs)) {
        if (seen.has(p.id) || !PICTURE_ID_RE.test(p.id)) continue;
        seen.add(p.id);
        out.push({ id: p.id, name: galleryNameFromFile(p.name) || p.id, blob: blobs[p.id] });
      }
    }
  }
  return out;
}

// The incoming pictures the gallery does not hold yet. A restore adds, never replaces or removes.
function galleryMissing(haveIds, incoming) {
  const have = new Set(haveIds || []);
  const out = [];
  for (const p of incoming || []) {
    if (!p || !PICTURE_ID_RE.test(p.id) || have.has(p.id)) continue;
    have.add(p.id);
    out.push(p);
  }
  return out;
}

// ─── Backup ──────────────────────────────────────────────────────────────────

// The list a backup writes beside the picture files.
function galleryBackupMeta(pics) {
  return (pics || []).filter(p => p && pictureZipName(p.id, p.blob && p.blob.type))
    .map(p => ({ id: p.id, name: p.name, added: p.added || 0, type: pictureType(p.blob.type) }));
}

// The list a backup holds, or [] when it is not one. An entry with a bad id or no name is dropped.
function galleryParseMeta(raw) {
  let list;
  try { list = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { return []; }
  if (!Array.isArray(list)) return [];
  return list.filter(p => p && pictureZipName(p.id, p.type) && typeof p.name === 'string' && p.name.trim())
    .map(p => ({ id: p.id, name: p.name.trim().slice(0, 200), added: Number(p.added) || 0, type: pictureType(p.type) }));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PICTURE_MAX_BOX, pictureBox, pictureFit, pictureType, pictureZipName,
    galleryNameFromFile, roomPictureRefs, picturesReferenced, pictureBackupList,
    galleryFromScenes, galleryMissing, galleryBackupMeta, galleryParseMeta };
}
