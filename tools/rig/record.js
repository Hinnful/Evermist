#!/usr/bin/env node
'use strict';
// Records one README animation off-screen and encodes it into assets/<name>.webp.
//
//   node tools/rig/record.js <clip> [--encode]   clip: reveal | world-map | draw-rooms | module-text | two-maps | notes | search
//
// The recording is the `record` scenario (scenarios/record.js) run once in the rig, which parks every window
// off-screen. It films the DM and Player windows with CDP Page.startScreencast into the OS temp dir; this file then
// lays the frames on one timeline and lets ffmpeg composite and encode them. Never --visible, never a set.
// The maps are COPIED INTO the rig's throwaway profile by the app's own import (createNewScene) from the DM's
// source folder; the DM's library in %APPDATA%/Evermist is never opened.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const DESKTOP_MAPS = path.join(os.homedir(), 'OneDrive', 'Рабочий стол', 'D&D Maps');
const MODULE_PDF = path.join(ROOT, '.claude', 'private', 'fixtures', 'books', 'mod', 'EN-DeathHouse.pdf');
const WIDTH = 1000;
let FPS = 25;    // set per clip: a tick is a whole number of milliseconds, so 20 or 25

// scen: the clip inside scenarios/record.js. layout: how the windows share the picture. fps and q: the frame rate and
// WebP quality that bring the file near 10 MB; a moving map under the windows needs fewer frames.
const CLIPS = {
  'reveal':      { scen: 'hero',    layout: 'inset', fps: 25, q: 80, dm: '1280x720', tv: '1280x720' },
  'world-map':   { scen: 'world',   layout: 'dm',    fps: 20, q: 68, dm: '1280x720' },
  'draw-rooms':  { scen: 'rooms',   layout: 'dm',    fps: 25, q: 68, dm: '1280x720', cuts: [[0, 0.9]] },
  'module-text': { scen: 'module',  layout: 'dm',    fps: 20, q: 70, dm: '1280x720' },
  'two-maps':    { scen: 'twomaps', layout: 'tv',    fps: 25, q: 80, dm: '1280x720', tv: '1280x720', cuts: [[3.6, 6.4], [8.6, 10.6]] },
  'notes':       { scen: 'notes',   layout: 'dm',    fps: 20, q: 50, dm: '1280x720' },
  'search':      { scen: 'search',  layout: 'dm',    fps: 25, q: 80, dm: '1280x720' },
};

// Frames of one source dir (list.txt from the scenario) as [{ file, t }] in seconds.
function readFrames(dir) {
  const lines = fs.readFileSync(path.join(dir, 'list.txt'), 'utf8').split('\n');
  let t = Number(fs.readFileSync(path.join(dir, 'start.txt'), 'utf8'));
  const out = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    if (!lines[i].startsWith('file') || !lines[i + 1].startsWith('duration')) continue;
    out.push({ file: /'(.*)'/.exec(lines[i])[1], t });
    t += Number(lines[i + 1].slice(9));
  }
  return { frames: out, end: t };
}

// For each output tick, the index of the latest frame of the source at or before it.
function indexAt(src, t0, n) {
  const idx = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + i / FPS;
    while (k + 1 < src.frames.length && src.frames[k + 1].t <= t) k++;
    idx.push(k);
  }
  return idx;
}

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg failed');
}

// An animated WebP from still WebP frames, each kept whole. ffmpeg's own animated encoder lets a block that barely
// changed keep its old pixels, which turns the drifting fog into smeared blocks.
function muxAnimated(files, durationsMs, w, h, dest) {
  const u24 = v => Buffer.from([v & 255, (v >> 8) & 255, (v >> 16) & 255]);
  const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
  const chunk = (id, body) => Buffer.concat([Buffer.from(id), u32(body.length), body, body.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  const parts = [
    chunk('VP8X', Buffer.concat([Buffer.from([0x02, 0, 0, 0]), u24(w - 1), u24(h - 1)])),
    chunk('ANIM', Buffer.concat([Buffer.alloc(4), Buffer.from([0, 0])])),
  ];
  files.forEach((f, i) => {
    const still = fs.readFileSync(f);
    if (still.toString('latin1', 12, 16) !== 'VP8 ') throw new Error(f + ' is not a plain lossy frame');
    const head = Buffer.concat([u24(0), u24(0), u24(w - 1), u24(h - 1), u24(durationsMs[i]), Buffer.from([0x02])]);
    parts.push(chunk('ANMF', Buffer.concat([head, still.subarray(12)])));
  });
  const body = Buffer.concat(parts);
  fs.writeFileSync(dest, Buffer.concat([Buffer.from('RIFF'), u32(body.length + 4), Buffer.from('WEBP'), body]));
}

function encode(name, layout, work) {
  FPS = Number(process.env.REC_FPS) || CLIPS[name].fps;
  const dm = layout !== 'tv' && fs.existsSync(path.join(work, 'dm', 'list.txt')) ? readFrames(path.join(work, 'dm')) : null;
  const tv = fs.existsSync(path.join(work, 'tv', 'list.txt')) ? readFrames(path.join(work, 'tv')) : null;
  const srcs = [dm, tv].filter(Boolean);
  const t0 = Math.min(...srcs.map(s => s.frames[0].t));
  const t1 = Math.max(...srcs.map(s => s.end - 0.5 + 0.3));
  const n = Math.round((t1 - t0) * FPS);
  const crop = JSON.parse(fs.readFileSync(path.join(work, 'crop.json'), 'utf8'));
  const idx = srcs.map(s => indexAt(s, t0, n));
  // Only the ticks where a window painted something new become frames; the rest stretch the one before.
  // `cuts` drops dead stretches (seconds from the start) the app needs and a viewer does not, like a window loading.
  const cuts = CLIPS[name].cuts || [];
  const keep = [];
  for (let i = 0; i < n; i++) if (!cuts.some(([a, b]) => i / FPS >= a && i / FPS < b)) keep.push(i);
  const starts = [];
  for (let j = 0; j < keep.length; j++) if (j === 0 || idx.some(a => a[keep[j]] !== a[keep[j - 1]])) starts.push(j);
  const ticks = starts.map((s, i) => (i + 1 < starts.length ? starts[i + 1] : keep.length) - s);
  const inputs = [];
  for (const [id, s, ix] of [['dm', dm, dm && idx[0]], ['tv', tv, idx[srcs.length - 1]]]) {
    if (!s) continue;
    const lines = [];
    starts.forEach((st, i) => lines.push("file '" + s.frames[ix[keep[st]]].file + "'", 'duration ' + (ticks[i] / FPS).toFixed(5)));
    lines.push(lines[lines.length - 2]);
    const list = path.join(work, id + '-cfr.txt');
    fs.writeFileSync(list, lines.join('\n'));
    inputs.push('-f', 'concat', '-safe', '0', '-i', list);
  }
  const even = v => Math.round(v / 2) * 2;
  const cropDm = 'crop=' + crop.w + ':' + crop.h + ':' + crop.x + ':0';
  let graph;
  if (layout === 'dm') graph = '[0:v]' + cropDm + ',scale=' + WIDTH + ':-2[o]';
  else if (layout === 'tv') graph = '[0:v]scale=' + WIDTH + ':-2[o]';
  else {
    // The TV full frame, the DM window inset at the bottom right.
    graph = '[0:v]' + cropDm + ',scale=' + even(WIDTH * 0.33) + ':-2,pad=iw+4:ih+4:2:2:color=0x1b1b22[dm];' +
            '[1:v]scale=' + WIDTH + ':-2[tv];[tv][dm]overlay=W-w-14:H-h-14[o]';
  }
  const frames = path.join(work, 'frames');
  fs.rmSync(frames, { recursive: true, force: true });
  fs.mkdirSync(frames);
  const q = process.env.REC_QUALITY || String(CLIPS[name].q);
  ffmpeg([...inputs, '-filter_complex', graph, '-map', '[o]', '-fps_mode', 'passthrough', '-c:v', 'libwebp', '-q:v', q,
          '-compression_level', '6', '-preset', process.env.REC_PRESET || 'picture', path.join(frames, '%05d.webp')]);
  // The concat demuxer needs one closing file line to honour the last duration, which comes out as one extra frame.
  const files = fs.readdirSync(frames).sort().map(f => path.join(frames, f)).slice(0, starts.length);
  if (files.length !== starts.length) throw new Error('ffmpeg wrote ' + files.length + ' frames for ' + starts.length + ' changes');
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', files[0]], { encoding: 'utf8' });
  const [w, h] = probe.stdout.trim().split(',').map(Number);
  const dest = path.join(ROOT, 'assets', name + '.webp');
  muxAnimated(files, ticks.map(k => Math.round(k * 1000 / FPS)), w, h, dest);
  const mb = (fs.statSync(dest).size / 1e6).toFixed(1);
  console.log('wrote ' + dest + ' - ' + mb + ' MB, ' + (keep.length / FPS).toFixed(1) + ' s, ' + files.length + ' frames');
}

// The world map shows most of its maps as prints, stills cut from the DM's animated files: [name, file, widest side to scale to (0 = native)].
// A map with a floor plan stays native, since the plan is read against the picture's pixels.
const VW = 'Evermist WebM 150 + VTT Full Walls';
const STILLS = {
  'world-map': [['mill', 'Мельница, бой/' + VW + '/Мельница, бой.webm', 3000],
                ['road', 'Холм Былого, Дорога/' + VW + '/Холм Былого, Дорога.webm', 3000]],
};

function makeStills(list, maps, dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [n, rel, side] of list) {
    const scale = side ? ['-vf', "scale='min(" + side + ",iw)':-2"] : [];
    ffmpeg(['-ss', '1', '-i', path.join(maps, rel), '-frames:v', '1', ...scale, '-q:v', '2', path.join(dir, n + '.jpg')]);
  }
}

function main() {
  const name = process.argv[2];
  const clip = CLIPS[name];
  if (!clip) { console.error('usage: node tools/rig/record.js <' + Object.keys(CLIPS).join('|') + '>'); process.exit(2); }
  const out = path.join(os.tmpdir(), 'evermist-record', name);
  // --encode runs the encoder again on the frames of the last recording, to tune size and quality.
  if (process.argv[3] === '--encode') return encode(name, clip.layout, path.join(out, clip.scen));
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const maps = process.env.REC_MAPS || DESKTOP_MAPS;
  if (STILLS[name]) makeStills(STILLS[name], maps, path.join(out, 'stills'));
  const env = { ...process.env, REC_STILLS: path.join(out, 'stills'), REC_CLIP: clip.scen, REC_OUT: out, REC_MAPS: maps,
                REC_MODULE: MODULE_PDF };
  const args = [path.join(__dirname, 'run.js'), 'record', '--dm-size', clip.dm, '--out', path.join(out, 'rig')];
  if (clip.tv) args.push('--player-size', clip.tv);
  const r = spawnSync(process.execPath, args, { cwd: ROOT, env, stdio: 'inherit' });
  if (r.status !== 0) { console.error('the recording run failed'); process.exit(r.status || 1); }
  // The scenario writes its frames to <out>/<scen>/{dm,tv}; the encoder wants them under one folder.
  encode(name, clip.layout, path.join(out, clip.scen));
}

if (require.main === module) main();
