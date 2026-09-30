'use strict';

// Whether a repo path ships, by `package.json` build.files. test/structure.test.js and
// tools/check-release.js both answer that question, so neither keeps its own copy of the glob.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function patterns(pkg) {
  pkg = pkg || JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return (pkg.build && pkg.build.files) || [];
}

// electron-builder glob semantics, narrowed to what build.files actually uses.
// `**` crosses directories, `*` does not, and a leading `!` excludes.
function toRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { out += '.*'; i++; if (glob[i + 1] === '/') i++; }
      else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + out + '$');
}

// ⚠ LAST MATCH WINS, so a `!` pattern followed by a narrower include still ships the
// named file - which is exactly how pdfjs-dist is carved down to three paths.
function isPackaged(rel, list) {
  let shipped = false;
  for (const p of list || patterns()) {
    const negated = p.startsWith('!');
    if (toRegExp(negated ? p.slice(1) : p).test(rel)) shipped = !negated;
  }
  return shipped;
}

module.exports = { patterns, toRegExp, isPackaged };
