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
const crypto = require('crypto');

const YTDLP_TAG = '2026.08.19';

// ⚠ MOVE THESE WITH THE TAG, from that release's SHA2-256SUMS. A tag pins a name, not content:
// release assets can be re-uploaded, and whatever comes down ships in every installer.
const ASSETS = {
  win32: { name: 'yt-dlp.exe', sha256: '66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a' },
  darwin: { name: 'yt-dlp_macos', sha256: '0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202' },
  linux: { name: 'yt-dlp_linux', sha256: '58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a' },
};

// postinstall runs in every CI job, so a stalled download must end the try, not hang the job.
const IDLE_MS = 60 * 1000;
const TRIES = 3;

function get(url, depth) {
  if (depth > 8) return Promise.reject(new Error('too many redirects'));
  return new Promise((resolve, reject) => {
    const req = https.get(url, res => {
      const code = res.statusCode;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        resolve(get(new URL(res.headers.location, url).toString(), depth + 1));
        return;
      }
      if (code !== 200) { res.resume(); reject(new Error('HTTP ' + code + ' for ' + url)); return; }
      resolve(res);
    });
    req.on('error', reject);
    req.setTimeout(IDLE_MS, () => req.destroy(new Error('no data for ' + IDLE_MS / 1000 + 's from ' + url)));
  });
}

function sha256Of(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function download(url, tmp) {
  const res = await get(url, 0);
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    res.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    res.on('error', reject);
    res.on('close', () => { if (!res.complete) reject(new Error('download cut off')); });
  });
}

async function main() {
  const asset = ASSETS[process.platform];
  if (!asset) {
    console.error('[yt-dlp] no build for platform ' + process.platform + ' — music downloads will not work here');
    return;
  }

  const dir = path.join(__dirname, '..', 'vendor', 'yt-dlp');
  const dest = path.join(dir, asset.name);
  const stamp = path.join(dir, 'VERSION');
  fs.mkdirSync(dir, { recursive: true });

  // Present AND the pinned content: leave it. Moving the pin above re-downloads.
  try {
    if (sha256Of(dest) === asset.sha256) {
      console.log('[yt-dlp] present: ' + asset.name + ' ' + YTDLP_TAG);
      return;
    }
  } catch (_) {}

  const url = 'https://github.com/yt-dlp/yt-dlp/releases/download/' + YTDLP_TAG + '/' + asset.name;
  // Write to a temp name and rename, so an interrupted download never leaves a truncated binary.
  const tmp = dest + '.part';
  for (let i = 1; ; i++) {
    console.log('[yt-dlp] downloading ' + asset.name + ' ' + YTDLP_TAG + '… (try ' + i + ' of ' + TRIES + ')');
    try {
      await download(url, tmp);
      break;
    } catch (err) {
      try { fs.unlinkSync(tmp); } catch (_) {}
      if (i >= TRIES) throw err;
      console.error('[yt-dlp] ' + err.message + ', retrying');
    }
  }

  const got = sha256Of(tmp);
  if (got !== asset.sha256) {
    fs.unlinkSync(tmp);
    throw new Error(asset.name + ' ' + YTDLP_TAG + ' has SHA-256 ' + got + ', expected ' + asset.sha256);
  }

  fs.renameSync(tmp, dest);
  if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
  fs.writeFileSync(stamp, YTDLP_TAG + '\n');
  console.log('[yt-dlp] ' + asset.name + ' ' + YTDLP_TAG + ' ready (' + Math.round(fs.statSync(dest).size / 1048576) + ' MB, checksum verified)');
}

main().catch(err => {
  console.error('[yt-dlp] FAILED: ' + (err && err.message ? err.message : err));
  console.error('[yt-dlp] Music downloads need this binary. Fix the network and run `npm install` again.');
  process.exit(1);
});
