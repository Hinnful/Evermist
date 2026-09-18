'use strict';
// diagLog.js — the playback log every window writes to, its rotation on start and the archives
// it keeps.

const { ipcMain, app } = require('electron');
const path = require('path');
const fs = require('fs');



function register(ctx) {
  logsDir = ctx.logsDir;
}

// --- Diagnostic log IPC ---

let logsDir;

const _diagModeFiles = { dm: 'video-diag-dm.log', player: 'video-diag-player.log' };

// One long-lived append stream per mode. ⚠ Never appendFileSync: during a stall both windows emit
// dozens of events a second, and synchronous writes back up the main process and starve the video
// pipeline, amplifying the stall being observed.
const _diagStreams = {};

function _diagStream(mode) {
  const filename = _diagModeFiles[mode];
  if (!filename || !logsDir) return null; // reject unknown modes; silently drop before app.whenReady
  if (!_diagStreams[mode]) {
    _diagStreams[mode] = fs.createWriteStream(path.join(logsDir, filename), { flags: 'a' });
    _diagStreams[mode].on('error', () => {});
  }
  return _diagStreams[mode];
}

// On each launch, retire the previous log to a dated archive. The logs write continuously whenever
// a video plays, so append mode grows without bound. The live session keeps the stable filename;
// history is dated.
//
// ⚠ PRUNED BY TOTAL SIZE, NEVER BY COUNT. A stall is chased by restarting, and a count evicts
// the session holding the fault within a few of them.
const DIAG_LOG_BUDGET = 500 * 1024 * 1024;

function _rotateDiagLogs() {
  if (!logsDir) return;
  const pad = n => String(n).padStart(2, '0');
  for (const filename of Object.values(_diagModeFiles)) {
    const base = filename.replace(/\.log$/, ''); // e.g. 'video-diag-dm'
    const current = path.join(logsDir, filename);
    // Archive the previous session's log under a name dated to when it last wrote.
    try {
      const stat = fs.statSync(current);
      if (stat.size > 0) {
        const m = new Date(stat.mtimeMs);
        const stamp = `${m.getFullYear()}-${pad(m.getMonth() + 1)}-${pad(m.getDate())}` +
          `_${pad(m.getHours())}-${pad(m.getMinutes())}-${pad(m.getSeconds())}`;
        fs.renameSync(current, path.join(logsDir, `${base}-${stamp}.log`));
      }
    } catch {} // no current log yet — first run
  }
  _pruneDiagArchives();
}

// Newest first, kept until the running total passes the budget. The newest is never dropped, so a
// session larger than the whole budget survives the launch after it.
function _pruneDiagArchives() {
  const bases = Object.values(_diagModeFiles).map(f => f.replace(/\.log$/, ''));
  const found = [];
  try {
    for (const name of fs.readdirSync(logsDir)) {
      if (!name.endsWith('.log') || !bases.some(b => name.startsWith(b + '-'))) continue;
      const full = path.join(logsDir, name);
      try { const st = fs.statSync(full); found.push({ full, size: st.size, at: st.mtimeMs }); } catch {}
    }
  } catch { return; }
  found.sort((a, b) => b.at - a.at);
  let kept = 0;
  found.forEach((f, i) => {
    kept += f.size;
    if (i > 0 && kept > DIAG_LOG_BUDGET) { try { fs.unlinkSync(f.full); } catch {} }
  });
}

ipcMain.on('diag-append-line', (_event, mode, line) => {
  const stream = _diagStream(mode);
  if (stream) stream.write(line + '\n');
});

module.exports = { register, _rotateDiagLogs };
