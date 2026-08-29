'use strict';

// mapConvert.js — re-encoding an oversized animated map at import so it fits MAP_BOX_W ×
// MAP_BOX_H. A Dungeon Alchemist WebM export runs 13-20 megapixels and TWO decoders hold one at
// once, which is the app's largest single memory cost.
//
// ⚠ H.264 is required, not preferred: there is no hardware VP9 encoder, and the codec string must
// be High 5.1 or 5.2 — a lower level caps resolution below the box and MediaRecorder rejects it.
//
// Loaded after mapLoader.js and before sceneManager.js, its only caller.

// ─── The box fit (pure) ──────────────────────────────────────────────────────
// Fits srcW×srcH inside boxW×boxH, preserving aspect. changed:false lets the caller skip the
// re-encode, which would cost a generation of quality for nothing.
//
// ⚠ Dimensions are forced EVEN: H.264's chroma planes are half-resolution in both axes, so an odd
// dimension is rejected or silently padded.
function fitInsideBox(srcW, srcH, boxW, boxH) {
  var sw = Number(srcW), sh = Number(srcH);
  if (!isFinite(sw) || !isFinite(sh) || sw <= 0 || sh <= 0) {
    return { w: 0, h: 0, changed: false };
  }
  var bw = Number(boxW), bh = Number(boxH);
  if (!isFinite(bw) || !isFinite(bh) || bw <= 0 || bh <= 0) {
    return { w: sw, h: sh, changed: false };
  }

  // Never upscale: a small map stays exactly as it is.
  var scale = Math.min(bw / sw, bh / sh);
  if (scale >= 1) return { w: sw, h: sh, changed: false };

  var w = Math.max(2, Math.round(sw * scale));
  var h = Math.max(2, Math.round(sh * scale));
  // Round DOWN to even, so rounding can never push a side back outside the box.
  w -= w % 2;
  h -= h % 2;

  return { w: w, h: h, changed: w !== sw || h !== sh };
}

// ─── The setting ─────────────────────────────────────────────────────────────
// A SETTING, NOT A QUESTION. An answer the app remembers is a setting however it was asked for, so
// this is the state in one place, applied to every import with no confirmation.
//
// OFF by default: re-encoding is a one-way door and the playback hardware is unpredictable.
var MAP_COMPRESS_KEY = 'evermist.compressBigVideos';

function compressBigVideosEnabled() {
  try { return localStorage.getItem(MAP_COMPRESS_KEY) === '1'; } catch (_) { return false; }
}

// Explained ONCE PER APP RUN, on the way on: a silent setting still has to say what it does, as a
// statement rather than a question. Per run, not per install — it is a reminder.
var _compressExplained = false;

// Flips, persists, explains if it just came on. Returns the new state so the caller can paint.
function toggleCompressBigVideos() {
  var on = !compressBigVideosEnabled();
  try { localStorage.setItem(MAP_COMPRESS_KEY, on ? '1' : '0'); } catch (_) {}
  if (on && !_compressExplained && typeof messageDialog === 'function') {
    _compressExplained = true;
    messageDialog({
      title: 'Compression',
      message:
        'Animated maps bigger than ' + MAP_BOX_W + '×' + MAP_BOX_H + ' will be re-encoded to fit ' +
        'that size on import. This improves performance on low-end PCs and laptops.\n\n' +
        'Leave it off if your machine can handle full-size maps.',
      buttonLabel: 'Got it',
    });
  }
  return on;
}

// ─── The conversion (browser only) ───────────────────────────────────────────
// ⚠ H.264 High 5.1. Main 4.0 is REJECTED by MediaRecorder, because the level caps resolution below
// the box, so this string is not interchangeable with a shorter one.
var MAP_CONVERT_MIME = 'video/mp4;codecs=avc1.640033';

// A frame this long overdue means the decode is stuck rather than slow, so the import falls
// back to the original file instead of hanging on a progress bar forever.
var MAP_CONVERT_STALL_MS = 20000;

// ⚠ NEVER rejects: on any failure it resolves with the original file and converted:false. A map
// that imports at full size is a memory problem; one that does not import is a broken app.
//
// A RESULT OBJECT, not a bare File: the caller needs srcW to correct the floor plan's coordinates,
// which are in the original export's pixel space.
//
// onStart fires only after the DM has said yes, so the caller raises its progress overlay then.
function convertVideoForImport(file, hooks) {
  var h = hooks || {};
  var onProgress = h.onProgress;
  return new Promise(function(resolve) {
    var video = null, url = null, rec = null, stream = null, rvfc = null, stallTimer = null;
    var settled = false, srcW = 0, srcH = 0;

    function cleanup() {
      if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
      if (video) {
        if (rvfc != null && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(rvfc);
        video.onerror = null; video.oncanplay = null; video.onended = null;
        try { video.pause(); } catch (_) {}
        video.src = '';
        if (video.parentNode) video.parentNode.removeChild(video);
        video = null;
      }
      if (stream) { stream.getTracks().forEach(function(t) { t.stop(); }); stream = null; }
      if (url) { URL.revokeObjectURL(url); url = null; }
    }

    // The one exit that always leaves the import working.
    function giveUp(why) {
      if (settled) return;
      settled = true;
      if (why) console.warn('[mapConvert] keeping the original file:', why);
      if (rec && rec.state !== 'inactive') { try { rec.stop(); } catch (_) {} }
      rec = null;
      cleanup();
      resolve({ file: file, srcW: srcW, srcH: srcH, outW: srcW, outH: srcH, converted: false });
    }

    function armStall() {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(function() { giveUp('decode stalled'); }, MAP_CONVERT_STALL_MS);
    }

    try {
      if (typeof MediaRecorder === 'undefined'
          || !MediaRecorder.isTypeSupported
          || !MediaRecorder.isTypeSupported(MAP_CONVERT_MIME)) {
        giveUp('no H.264 recorder');
        return;
      }

      url = URL.createObjectURL(file);
      video = document.createElement('video');
      video.muted = true;
      // NOT loop: the source has to reach `ended` for the recording to have an end.
      video.loop = false;
      video.playsInline = true;
      // ⚠ 'auto', not 'metadata'. A Dungeon Alchemist WebM will not decode frame 0 under
      // 'metadata', and a source that never presents a frame records an empty file.
      video.preload = 'auto';
      video.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;pointer-events:none;opacity:0;';
      document.body.appendChild(video);

      video.onerror = function() { giveUp('source would not load'); };

      video.oncanplay = function() {
        if (settled) return;
        video.oncanplay = null;
        srcW = video.videoWidth;
        srcH = video.videoHeight;
        var dur = video.duration;

        function keepOriginal() {
          settled = true;
          cleanup();
          resolve({ file: file, srcW: srcW, srcH: srcH, outW: srcW, outH: srcH, converted: false });
        }

        var fit = fitInsideBox(srcW, srcH, MAP_BOX_W, MAP_BOX_H);
        // Already inside the box: hand the original straight back. Re-encoding it would cost a
        // generation of quality and a realtime wait for no memory saved at all.
        if (!fit.changed) { keepOriginal(); return; }
        if (!isFinite(dur) || dur <= 0) { giveUp('source has no duration'); return; }

        // Only now is a shrink certain, so this is where the progress overlay belongs — a map
        // that turns out to already fit must never flash a bar at all.
        if (h.onStart) h.onStart({ srcW: srcW, srcH: srcH, outW: fit.w, outH: fit.h });

        var canvas = document.createElement('canvas');
        canvas.width = fit.w;
        canvas.height = fit.h;
        var ctx = canvas.getContext('2d');

        // captureStream(0) = this stream produces a frame only when asked, so the output's
        // frame count is exactly the number of source frames drawn.
        stream = canvas.captureStream(0);
        var track = stream.getVideoTracks()[0];
        if (!track || !track.requestFrame) { giveUp('canvas stream has no frame control'); return; }

        var chunks = [];
        try {
          rec = new MediaRecorder(stream, {
            mimeType: MAP_CONVERT_MIME,
            videoBitsPerSecond: MAP_CONVERT_BITRATE,
          });
        } catch (err) { giveUp(err && err.message); return; }

        rec.ondataavailable = function(e) { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onerror = function() { giveUp('recorder failed'); };
        rec.onstop = function() {
          if (settled) return;
          settled = true;
          var blob = new Blob(chunks, { type: 'video/mp4' });
          cleanup();
          if (!blob.size) {
            resolve({ file: file, srcW: srcW, srcH: srcH, outW: srcW, outH: srcH, converted: false });
            return;
          }
          var base = String(file.name || 'map').replace(/\.[^.]+$/, '') || 'map';
          resolve({
            file: new File([blob], base + '.mp4', { type: 'video/mp4' }),
            srcW: srcW, srcH: srcH, outW: fit.w, outH: fit.h, converted: true,
          });
        };

        // ⚠ REALTIME PACING IS WHAT MAKES THE OUTPUT PLAY AT THE RIGHT SPEED. Driving
        // requestFrame() faster writes wrong duration metadata, and for a map that loops forever
        // wrong duration is wrong speed. requestVideoFrameCallback also only sees presented frames.
        video.playbackRate = 1;

        function pump() {
          rvfc = null;
          if (settled || !video) return;
          armStall();
          try {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            track.requestFrame();
          } catch (err) { giveUp(err && err.message); return; }
          if (onProgress && dur > 0) onProgress(Math.min(100, (video.currentTime / dur) * 100));
          if (video.requestVideoFrameCallback) rvfc = video.requestVideoFrameCallback(pump);
        }

        video.onended = function() {
          if (settled) return;
          if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
          if (rvfc != null && video.cancelVideoFrameCallback) {
            video.cancelVideoFrameCallback(rvfc); rvfc = null;
          }
          if (onProgress) onProgress(100);
          // A short delay before stopping: the last requestFrame has to reach the encoder,
          // and stop() discards anything still in flight.
          setTimeout(function() {
            if (settled) return;
            if (rec && rec.state !== 'inactive') { try { rec.stop(); } catch (err) { giveUp(err && err.message); } }
            else giveUp('recorder closed early');
          }, 150);
        };

        if (!video.requestVideoFrameCallback) { giveUp('no requestVideoFrameCallback'); return; }
        rec.start();
        armStall();
        video.play().then(function() { rvfc = video.requestVideoFrameCallback(pump); })
                    .catch(function(err) { giveUp(err && err.message); });
      };

      video.src = url;
    } catch (err) {
      giveUp(err && err.message);
    }
  });
}

// ─── Export guard (Node require for tests; no-op in browser) ─────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fitInsideBox };
}
