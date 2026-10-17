'use strict';
// lab.js — `npm start`, from this checkout. `npm start lab` runs it on a library of its own beside
// the real one, for testing without touching the campaign; `npm start lab:reset` empties that library
// first, for a first-time DM's view. Dev only: tools/ never ships. The single-instance lock lives in
// the data folder, so the lab runs beside the installed Evermist.

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LAB_FOLDER = 'Evermist Lab';

function appDataDir() {
  if (process.platform === 'win32') return process.env.APPDATA;
  if (process.platform === 'darwin') return path.join(process.env.HOME, 'Library', 'Application Support');
  return process.env.XDG_CONFIG_HOME || path.join(process.env.HOME, '.config');
}

const args = process.argv.slice(2);
const reset = args.includes('lab:reset') || args.includes('--reset');
const lab = reset || args.includes('lab');
const labDir = path.join(appDataDir(), LAB_FOLDER);

// ⚠ The real library is a sibling of this folder: delete only a path whose last part is the lab's.
if (reset && path.basename(labDir) === LAB_FOLDER) {
  fs.rmSync(labDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  console.log('Lab emptied.');
}
if (lab) console.log('Evermist Lab: ' + labDir);

const electron = require(path.join(ROOT, 'node_modules', 'electron'));
const child = spawn(electron, ['.'].concat(lab ? ['--user-data-dir=' + labDir] : []), { cwd: ROOT, stdio: 'inherit' });
child.on('exit', code => process.exit(code || 0));
