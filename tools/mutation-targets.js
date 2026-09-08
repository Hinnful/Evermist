'use strict';

/*
 * Which functions the mutation run mutates, and where they currently sit.
 *
 * The names are the source of truth; the line ranges are read out of the files every time. That
 * is the whole point: a hand-written range goes stale on the next edit above it and nothing
 * notices, because Stryker still reports a score for whatever moved into those lines.
 *
 * Outside package.json's build.files, like everything else in tools/.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Every exported kernel the unit suite actually reaches. Anything not exported cannot be tested,
// so mutating it only produces survivors no test could ever kill.
const MUTATE_TARGETS = {
  'src/tools.js':        ['pointInPolygon', 'distPointToSegment', 'segmentsIntersect'],
  'src/video.js':        ['computeOptimalTextureSize', 'coverageFactorFor',
                          'mapRegionForTexture', 'clampRegionToMap'],
  'src/display.js':      ['normalizeDisplayRecord'],
  'src/undo.js':         ['evictUndoStack', 'evictUndoPair'],
  'src/backup.js':       ['resolveSceneName', 'mapExtFromScene'],
  'src/sceneManager.js': ['escHtml'],
  // ⚠ deriveFogColors and its two helpers are PARKED at 58%, deliberately (see
  // docs/decisions/testing-and-the-rig.md). They stay in the run so the figure keeps being
  // reported; closing them needs a decided colour table, not more arithmetic.
  'src/fogGeometry.js':  ['coneVertices', '_hexToHsl', '_hslToHex', 'deriveFogColors'],
};

// The 1-based [first, last] lines of a top-level `function name(...) { ... }`, found by matching
// the declaration and then the closing brace in column 0. Every target is written that way, so
// there is no need to parse JavaScript to locate one.
function spanOf(lines, name, where) {
  const head = new RegExp('^(?:async )?function ' + name.replace(/\$/g, '\\$') + '\\s*\\(');
  const start = lines.findIndex(l => head.test(l));
  if (start === -1) throw new Error('mutation target ' + where + ' has no function ' + name);
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === '}') return [start + 1, i + 1];
  }
  throw new Error('mutation target ' + where + ':' + name + ' never closes at column 0');
}

// { file: [names] } → the `mutate` globs Stryker takes, one per function.
function targetsFor(targets) {
  const out = [];
  for (const [file, names] of Object.entries(targets)) {
    // A trailing CR stops the closing brace matching column 0, and this tree is CRLF.
    const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split(/\r?\n/);
    for (const n of names) {
      const [a, b] = spanOf(lines, n, file);
      out.push(file + ':' + a + '-' + b);
    }
  }
  return out;
}

module.exports = { MUTATE_TARGETS, targetsFor, spanOf };
