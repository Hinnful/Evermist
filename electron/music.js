'use strict';
// music.js — the music folder as the library: what is in it, what a paste of a link finds, and
// the downloader that fills it.

const { ipcMain, shell, app } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');

let sendTo, isSafeId;

function register(ctx) {
  ({ sendTo, isSafeId } = ctx);
  musicDir = ctx.musicDir;
}

// --- Music library + downloader IPC ---

// The music folder IS the library, so there is no database to migrate.
// ⚠ `music` sits beside `maps`, which nothing may ever delete from.
let musicDir;
let ytdlpBin = null;

const YTDLP_ASSET = process.platform === 'win32' ? 'yt-dlp.exe'
                  : process.platform === 'darwin' ? 'yt-dlp_macos'
                  : 'yt-dlp_linux';

const MUSIC_EXTS = ['.m4a', '.webm', '.mp3', '.opus', '.ogg', '.oga', '.wav', '.flac', '.aac', '.mp4'];

// ⚠ A NAME FROM THE RENDERER IS NOT A PATH. A track name carries spaces and Cyrillic, so it
// cannot use `isSafeId`; this containment check stands in for it.
function musicPath(name) {
  if (typeof name !== 'string' || !name || name.length > 300) return null;
  if (name.indexOf('/') !== -1 || name.indexOf('\\') !== -1 || name.indexOf('\0') !== -1) return null;
  if (name === '.' || name === '..') return null;
  if (MUSIC_EXTS.indexOf(path.extname(name).toLowerCase()) === -1) return null;
  const full = path.resolve(musicDir, name);
  if (full !== path.join(path.resolve(musicDir), name)) return null;
  return full;
}

ipcMain.handle('music-list', async () => {
  try {
    const names = await fs.promises.readdir(musicDir);
    const out = [];
    for (const n of names) {
      if (MUSIC_EXTS.indexOf(path.extname(n).toLowerCase()) === -1) continue;
      try {
        const full = path.join(musicDir, n);
        const st = await fs.promises.stat(full);
        if (!st.isFile()) continue;
        // ⚠ pathToFileURL, not a path joined in the renderer: it escapes the spaces and
        // non-ASCII every downloaded title carries.
        out.push({ name: n, size: st.size, url: pathToFileURL(full).href });
      } catch {}
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  } catch { return []; }
});

ipcMain.handle('music-delete', async (_event, name) => {
  const full = musicPath(name);
  if (!full) throw new Error('Not a track in the music folder.');
  await fs.promises.unlink(full);
  return true;
});

function ytdlpBundled() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'yt-dlp', YTDLP_ASSET)
    // ⚠ vendor/ SITS AT THE REPO ROOT, and this file does not. postinstall writes it there.
    : path.join(__dirname, '..', 'vendor', 'yt-dlp', YTDLP_ASSET);
}

// ⚠ THE APP RUNS THE COPY IN userData, never the one inside the install - see DECISIONS.
function ensureYtdlp() {
  const dir = path.join(app.getPath('userData'), 'bin');
  const dest = path.join(dir, YTDLP_ASSET);
  try {
    if (fs.statSync(dest).size > 1024 * 1024) { ytdlpBin = dest; return; }
  } catch (_) {}
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(ytdlpBundled(), dest);
    if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
    ytdlpBin = dest;
  } catch (err) {
    ytdlpBin = null;
    console.error('[music] yt-dlp unavailable: ' + ((err && err.message) || err));
  }
}

// ⚠ ONLY AN ADDRESS THIS FUNCTION BUILT reaches yt-dlp's argv, or a pasted string starting with
// `-` is command execution from the main process. Each call also carries `--ignore-config` and a
// `--`. See DECISIONS.
function ytdlpTarget(kind, id, raw) {
  if (kind === 'video' && /^[A-Za-z0-9_-]{11}$/.test(id || '')) {
    return 'https://www.youtube.com/watch?v=' + id;
  }
  if (kind === 'playlist' && /^[A-Za-z0-9_-]{13,64}$/.test(id || '')) {
    return 'https://www.youtube.com/playlist?list=' + id;
  }
  try {
    const u = new URL(String(raw));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch (_) { return null; }
}

const YTDLP_COMMON = ['--ignore-config', '--no-warnings', '--no-colors'];

// yt-dlp's own words, cut to the one line that says why; its whole stderr is a wall.
function ytdlpReason(err) {
  const line = String(err || '').split(/\r?\n/).find(l => /^ERROR:/.test(l));
  return line ? line.replace(/^ERROR:\s*/, '').trim().slice(0, 300) : '';
}

// An argument ARRAY and no shell, which is what keeps a URL off a command line.
function runYtdlp(args, onLine, onSpawn) {
  return new Promise((resolve, reject) => {
    if (!ytdlpBin) {
      reject(new Error('The downloader is missing. Reinstalling Evermist restores it.'));
      return;
    }
    const child = spawn(ytdlpBin, args, { windowsHide: true });
    if (onSpawn) onSpawn(child);
    let out = '', err = '', tail = '';
    child.stdout.on('data', d => {
      out += d;
      if (!onLine) return;
      tail += d;
      const lines = tail.split(/\r?\n/);
      tail = lines.pop();
      for (const l of lines) onLine(l);
    });
    child.stderr.on('data', d => { err += d; });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve(out);
      else reject(new Error(ytdlpReason(err) || ('the downloader exited with code ' + code)));
    });
  });
}

// Titles only. `--playlist-end` caps a runaway list.
// ⚠ A SECOND PASTE KILLS THE FIRST READ. The panel looks a link up as it is pasted, so two
// reads can be in flight; without this the slower one wins and the list shows the wrong playlist.
let ytdlpLookupChild = null;

ipcMain.handle('music-lookup', async (_event, req) => {
  const kind = req && req.kind === 'playlist' ? 'playlist' : 'video';
  const target = ytdlpTarget(kind, req && req.id, req && req.raw);
  if (!target) throw new Error('That link cannot be read.');
  const args = kind === 'playlist'
    ? YTDLP_COMMON.concat(['--flat-playlist', '--dump-json', '--playlist-end', '400', '--', target])
    : YTDLP_COMMON.concat(['--no-playlist', '--dump-json', '--', target]);
  if (ytdlpLookupChild) { try { ytdlpLookupChild.kill(); } catch (_) {} }
  const out = await runYtdlp(args, null, c => { ytdlpLookupChild = c; })
    .finally(() => { ytdlpLookupChild = null; });
  const entries = [];
  let title = '';
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch (_) { continue; }
    if (!j.id) continue;
    if (!title && j.playlist_title) title = j.playlist_title;
    entries.push({
      id: j.id,
      title: j.title || j.id,
      duration: j.duration || 0,
      size: j.filesize_approx || j.filesize || 0,
      // Carried because a non-YouTube id gives `ytdlpTarget` nothing to rebuild.
      url: j.webpage_url || j.url || '',
    });
  }
  if (!entries.length) throw new Error('Nothing at that link could be read as audio.');
  return { title: title, entries: entries };
});

// ⚠ AUDIO ONLY AND NO CONVERSION, which keeps ffmpeg out of the installer. Sorted by quality
// and NOT by container: Chromium decodes both AAC-in-m4a and Opus-in-webm natively, so a
// container preference would take 128k AAC over a higher-bitrate Opus on the same upload.
// The protocol filter excludes HLS manifests, which are segments rather than a file and would
// need ffmpeg to join.
const MUSIC_FORMAT = 'bestaudio[protocol^=http]';

ipcMain.handle('music-download', async (event, req) => {
  const id = req && req.id;
  const target = ytdlpTarget('video', id, req && req.url);
  if (!target) throw new Error('That track has no address this can download.');
  // ⚠ The ID IN THE NAME is what the have-it check reads back, so nothing predicts yt-dlp's
  // sanitisation. `--windows-filenames` is strict on every platform and keeps Cyrillic.
  const args = YTDLP_COMMON.concat([
    '-f', MUSIC_FORMAT,
    '--no-playlist',
    '--newline',
    '--windows-filenames',
    '--trim-filenames', '180',
    '--no-overwrites',
    '--progress-template', 'download:EVMPROGRESS %(progress._percent_str)s',
    '--paths', musicDir,
    '-o', '%(title)s [%(id)s].%(ext)s',
    '--', target,
  ]);
  await runYtdlp(args, line => {
    const m = /^EVMPROGRESS\s+([\d.]+)%/.exec(line.trim());
    if (m) sendTo(event.sender, 'music-progress', { id: id, percent: parseFloat(m[1]) });
  });
  return true;
});

// The installed version and the newest release, so the panel can hide its Update button when
// there is nothing to update to. The tag comes off the redirect on GitHub's /latest URL, which
// needs no API token and no JSON. Either half answers null rather than failing the call.
ipcMain.handle('music-ytdlp-latest', async () => {
  const current = await runYtdlp(['--version']).then(v => v.trim()).catch(() => null);
  let latest = null;
  try {
    latest = await new Promise((resolve, reject) => {
      const req = https.request('https://github.com/yt-dlp/yt-dlp/releases/latest',
        { method: 'HEAD' }, res => {
          res.resume();
          const loc = res.headers.location || '';
          resolve(loc.split('/').filter(Boolean).pop() || null);
        });
      req.on('error', reject);
      req.setTimeout(6000, () => req.destroy(new Error('timed out')));
      req.end();
    });
  } catch (_) {}
  return { current: current, latest: latest };
});

// ⚠ NEVER AUTOMATIC — PRODUCT.md's rule that nothing installs without the button covers a
// tool the app spawns too.
ipcMain.handle('music-ytdlp-update', async () => {
  const out = await runYtdlp(['--ignore-config', '--no-warnings', '-U']);
  return String(out).trim().split(/\r?\n/).slice(-2).join(' ').slice(0, 200);
});

module.exports = { register, ensureYtdlp };
