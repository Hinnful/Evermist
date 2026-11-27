'use strict';

// The design sweep's pass, stamped with the app's files it ran on. ship.js refuses a release whose app files changed
// since the last clean sweep, so the sweep runs once per release, at /commit, and never slows an iteration.

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Rewritten by every npm test and rig run, and changes no screen.
const SKIP = new Set(['src/ui/changelogData.js']);
const APP = ['src', 'index.html', 'stage.html', 'splash.html'];

const isApp = (p) => { const n = String(p).replace(/\\/g, '/'); return !SKIP.has(n) && (n.startsWith('src/') || /^(index|stage|splash)\.html$/.test(n)); };

function appHash(root) {
  const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '--', ...APP], { cwd: root, encoding: 'utf8' })
    .split('\n').filter((f) => f && !SKIP.has(f)).sort();
  const h = crypto.createHash('sha256');
  for (const f of files) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) continue;
    h.update(f + '\0');
    h.update(fs.readFileSync(p));
    h.update('\0');
  }
  return h.digest('hex');
}

module.exports = { isApp, appHash };
