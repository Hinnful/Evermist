'use strict';
// picturePlan.js — pure: a room picture's size, order, and the names it travels under. No DOM.

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

// A room holds { id, name } only; the bytes are the scene's. A ref whose bytes are gone reads as
// absent, which is also what a backup restored by an older build leaves behind.
function roomPictureRefs(poly, blobs) {
  const list = poly && Array.isArray(poly.pictures) ? poly.pictures : [];
  return list.filter(p => p && typeof p.id === 'string' && blobs && blobs[p.id]);
}

// Every edit builds a NEW array: undo snapshots and a pending save share the old one.
function picturesMoved(list, from, to) {
  if (from === to || from < 0 || from >= list.length) return list.slice();
  const out = list.slice();
  const [m] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, m);
  return out;
}

function picturesWithout(list, id) {
  return (list || []).filter(p => p.id !== id);
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

// What a backup carries: each picture a room still points at, once.
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

// The scene's bytes, trimmed to what its rooms point at.
function picturesReferenced(polygons, blobs) {
  const out = {};
  for (const poly of polygons || []) {
    for (const p of roomPictureRefs(poly, blobs)) out[p.id] = blobs[p.id];
  }
  return out;
}

// Whether the picture on the TV still exists where it was shown from.
function tvPictureLive(tv, sceneId, polygons, blobs) {
  if (!tv || tv.sceneId !== sceneId) return false;
  const room = (polygons || []).find(p => p.id === tv.roomId);
  return !!room && roomPictureRefs(room, blobs).some(p => p.id === tv.picId);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PICTURE_MAX_BOX, pictureBox, pictureFit, roomPictureRefs, picturesMoved,
    picturesWithout, pictureType, pictureZipName, pictureBackupList, picturesReferenced, tvPictureLive };
}
