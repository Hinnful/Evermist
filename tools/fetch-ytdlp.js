'use strict';

// fetch-ytdlp.js — downloads yt-dlp for THIS platform into vendor/yt-dlp/, from `postinstall`.
// The music downloader spawns it; see src/music.js and the `extraResources` block in
// package.json. Outside the build glob and gitignored, because a 17MB binary per platform must
// not enter a public repo.
//
// ⚠ THE TAG IS PINNED, the way lib/pixi.min.js is. A floating "latest" makes two builds of one
// release tag ship different binaries. The copy the app RUNS lives in userData and updates from
// the download panel's own button, so pinning here costs nothing at the table.
//
// ⚠ FAILS HARD on purpose. A soft failure ships an installer whose download button does nothing,
// and that is the silent-packaging-failure class CLAUDE.md warns about. Re-run `npm install`.

const fs = require('fs');
const path = require('path');
const https = require('https');

const YTDLP_TAG = '2026.08.19';

const ASSETS = {
  win32: 'yt-dlp.exe',
  darwin: 'yt-dlp_macos',
  linux: 'yt-dlp_linux',
};

const MIN_BYTES = 1024 * 1024;

function get(url, depth) {
  if (depth > 8) return Promise.reject(new Error('too many redirects'));
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      const code = res.statusCode;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        resolve(get(new URL(res.headers.location, url).toString(), depth + 1));
        return;
      }
      if (code !== 200) { res.resume(); reject(new Error('HTTP ' + code + ' for ' + url)); return; }
      resolve(res);
    }).on('error', reject);
  });
}

async function main() {
  const asset = ASSETS[process.platform];
  if (!asset) {
    console.error('[yt-dlp] no build for platform ' + process.platform + ' — music downloads will not work here');
    return;
  }

  const dir = path.join(__dirname, '..', 'vendor', 'yt-dlp');
  const dest = path.join(dir, asset);
  const stamp = path.join(dir, 'VERSION');
  fs.mkdirSync(dir, { recursive: true });

  // Present AND the pinned version: leave it. A different version re-downloads, so moving the
  // pin above is all it takes to change what ships.
  try {
    if (fs.statSync(dest).size >= MIN_BYTES &&
        fs.readFileSync(stamp, 'utf8').trim() === YTDLP_TAG) {
      console.log('[yt-dlp] present: ' + asset + ' ' + YTDLP_TAG);
      return;
    }
  } catch (_) {}

  const url = 'https://github.com/yt-dlp/yt-dlp/releases/download/' + YTDLP_TAG + '/' + asset;
  console.log('[yt-dlp] downloading ' + asset + ' ' + YTDLP_TAG + '…');
  const res = await get(url, 0);

  // Write to a temp name and rename, so an interrupted download never leaves a truncated binary
  // that passes the size check on the next install.
  const tmp = dest + '.part';
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    res.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    res.on('error', reject);
  });

  const size = fs.statSync(tmp).size;
  if (size < MIN_BYTES) {
    fs.unlinkSync(tmp);
    throw new Error('downloaded ' + size + ' bytes, expected at least ' + MIN_BYTES);
  }

  fs.renameSync(tmp, dest);
  if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
  fs.writeFileSync(stamp, YTDLP_TAG + '\n');
  console.log('[yt-dlp] ' + asset + ' ' + YTDLP_TAG + ' ready (' + Math.round(size / 1048576) + ' MB)');
}

main().catch(err => {
  console.error('[yt-dlp] FAILED: ' + (err && err.message ? err.message : err));
  console.error('[yt-dlp] Music downloads need this binary. Fix the network and run `npm install` again.');
  process.exit(1);
});
