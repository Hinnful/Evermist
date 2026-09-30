'use strict';
// pictureDecode.js — a dropped or picked file turned into the Blob a room keeps. roomPictures.js
// calls it.

async function _picHasAlpha(canvas) {
  const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
  return false;
}

// Frames would be lost to the canvas, so an animated file is kept whole.
async function _picAnimated(file) {
  if (!/^image\/(gif|webp|png)$/.test(file.type) || typeof ImageDecoder === 'undefined') return false;
  try {
    const dec = new ImageDecoder({ data: file.stream(), type: file.type });
    await dec.tracks.ready;
    const anim = !!(dec.tracks.selectedTrack && dec.tracks.selectedTrack.animated);
    dec.close();
    return anim;
  } catch (_) { return false; }
}

// createImageBitmap refuses SVG, which an <img> draws.
function _picViaImg(file) {
  return new Promise(res => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img.naturalWidth ? img : null); };
    img.onerror = () => { URL.revokeObjectURL(url); res(null); };
    img.src = url;
  });
}

// Resolves a Blob, or null for a file that will not decode.
async function decodeRoomPicture(file) {
  if (file.type === 'image/svg+xml') return (await _picViaImg(file)) ? file : null;
  if (await _picAnimated(file)) return file;
  let src;
  try { src = await createImageBitmap(file); } catch (_) { src = await _picViaImg(file); }
  if (!src) return null;
  const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
  const fit = pictureFit(w, h, pictureBox(compressBox()));
  const done = () => { if (src.close) src.close(); };
  if (file.type === 'image/jpeg' && fit.w === w && fit.h === h) { done(); return file; }
  const cv = document.createElement('canvas');
  cv.width = fit.w; cv.height = fit.h;
  const g = cv.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, fit.w, fit.h);
  done();
  const png = file.type !== 'image/jpeg' && await _picHasAlpha(cv);
  return new Promise(r => cv.toBlob(b => r(b), png ? 'image/png' : 'image/jpeg', 0.9));
}
