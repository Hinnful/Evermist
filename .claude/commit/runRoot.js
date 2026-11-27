'use strict';

// The checkout that holds every session's run folder: always the MAIN checkout, whichever worktree a
// session works in. The hooks and ship.js find their checkout differently, and a yes recorded in one
// folder and read from another refused correct yeses.

const { execFileSync } = require('child_process');
const path = require('path');

function runRoot(cwd) {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: cwd || process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return path.dirname(common);
  } catch {
    return null;
  }
}

module.exports = { runRoot };
