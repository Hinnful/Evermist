'use strict';

// musicPlan.js — pure kernel for the music library: link parsing, filenames, the filter and the
// fade curve. No DOM, no Electron, no I/O. Unit-tested; see test/musicPlan.test.js.

const _MU_ID = /^[A-Za-z0-9_-]{11}$/;
const _MU_LIST = /^[A-Za-z0-9_-]{13,}$/;

// A link copied while a playlist is open carries BOTH a video id and a list id, and the video
// wins: the DM copied that video, so fetching the list behind their back downloads a hundred
// tracks nobody asked for. Anything that is not YouTube passes through verbatim, because yt-dlp
// handles a long list of other sites and none of them needs an id parsed out.
function parseMusicUrl(raw) {
  const none = { mode: null, videoId: null, playlistId: null, url: null };
  if (typeof raw !== 'string') return none;
  const text = raw.trim();
  if (!text) return none;

  let u;
  try { u = new URL(text); } catch (_) { return none; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return none;

  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const isYouTube = host === 'youtube.com' || host === 'm.youtube.com' ||
                    host === 'music.youtube.com' || host === 'youtu.be';
  if (!isYouTube) return { mode: 'video', videoId: null, playlistId: null, url: text };

  const listRaw = u.searchParams.get('list');
  const playlistId = listRaw && _MU_LIST.test(listRaw) ? listRaw : null;

  let videoId = null;
  const vRaw = u.searchParams.get('v');
  if (vRaw && _MU_ID.test(vRaw)) videoId = vRaw;
  if (!videoId) {
    // youtu.be/ID, /shorts/ID, /live/ID and /embed/ID all carry the id as the last segment.
    const segs = u.pathname.split('/').filter(Boolean);
    const last = segs.length ? segs[segs.length - 1] : '';
    const bare = host === 'youtu.be' && segs.length === 1;
    const known = segs.length === 2 && (segs[0] === 'shorts' || segs[0] === 'live' || segs[0] === 'embed');
    if ((bare || known) && _MU_ID.test(last)) videoId = last;
  }

  if (videoId) return { mode: 'video', videoId: videoId, playlistId: playlistId, url: text };
  if (playlistId) return { mode: 'playlist', videoId: null, playlistId: playlistId, url: text };
  return none;
}

// ⚠ The app NEVER predicts what yt-dlp will name a file: its sanitisation is per-OS and changes
// between releases, so a predicted name stops matching and the have-it check starts lying.
function videoIdFromFileName(fileName) {
  if (typeof fileName !== 'string') return null;
  const m = fileName.match(/\[([A-Za-z0-9_-]{11})\](?:\.[A-Za-z0-9]{1,5})?$/);
  return m ? m[1] : null;
}

// What the track list shows: the file's own name without its extension and without the id the
// have-it check rides on.
function displayName(fileName) {
  if (typeof fileName !== 'string') return '';
  let name = fileName.replace(/\.[A-Za-z0-9]{1,5}$/, '');
  name = name.replace(/\s*\[[A-Za-z0-9_-]{11}\]$/, '');
  return name.trim() || fileName;
}

// The filter box. It matches the DISPLAY name, so four characters of a video id cannot pull up
// a track whose title has nothing to do with them. `toLocaleLowerCase` because a title can be
// Cyrillic and the app already claims a Russian audience.
function filterTracks(tracks, query) {
  if (!Array.isArray(tracks)) return [];
  const q = typeof query === 'string' ? query.trim().toLocaleLowerCase() : '';
  if (!q) return tracks.slice();
  return tracks.filter(t => {
    const shown = t && typeof t.display === 'string' ? t.display
                : t && typeof t.name === 'string' ? t.name : '';
    return shown.toLocaleLowerCase().indexOf(q) !== -1;
  });
}

// Equal-power fade. Two LINEAR ramps dip audibly in the middle of a crossfade, because power
// goes as the square of amplitude; two phases that sum to 1 keep a² + b² === 1 throughout.
function fadeLevel(phase) {
  const p = Math.min(1, Math.max(0, Number(phase) || 0));
  return Math.sin(p * Math.PI / 2);
}

// The inverse, so a fade reversed part-way resumes from where it is instead of jumping.
function fadePhase(level) {
  const v = Math.min(1, Math.max(0, Number(level) || 0));
  return Math.asin(v) / (Math.PI / 2);
}

// yt-dlp versions are dates (2026.08.19), so a plain string compare orders them. Anything that
// does not look like one answers false rather than offering an update nobody can trust.
function ytdlpOutdated(current, latest) {
  const ok = v => typeof v === 'string' && /^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/.test(v.trim());
  if (!ok(current) || !ok(latest)) return false;
  return latest.trim() > current.trim();
}

function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = n => (n < 10 ? '0' + n : String(n));
  return h > 0 ? h + ':' + pad(m) + ':' + pad(sec) : m + ':' + pad(sec);
}

function formatBytes(bytes) {
  const b = Number(bytes);
  if (!isFinite(b) || b <= 0) return '';
  if (b < 1024 * 1024) return Math.round(b / 1024) + ' KB';
  if (b < 1024 * 1024 * 1024) return Math.round(b / (1024 * 1024)) + ' MB';
  return (b / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseMusicUrl, videoIdFromFileName, displayName, filterTracks,
    fadeLevel, fadePhase, ytdlpOutdated, formatDuration, formatBytes,
  };
}
