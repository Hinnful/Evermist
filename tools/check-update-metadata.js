'use strict';

// check-update-metadata.js — asserts a build's update pointer is intact, before a release goes up.
//
//   node tools/check-update-metadata.js dist/latest.yml
//
// ⚠ THIS IS THE ONE RELEASE FAILURE THAT IS BOTH SILENT AND PERMANENT. An installed copy never
// browses the releases; it fetches this file and reads the newest version, the installer's name,
// its size and its checksum. Missing or wrong, the update check reports "no update" with no error
// and every installed copy stops updating for good. It also breaks the rollback path, which walks
// people BACK through the same file on the previous release.
//
// Outside package.json's build.files, so it never ships. Fails hard: exit 1 with what is wrong.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/check-update-metadata.js <path to latest*.yml>');
  process.exit(1);
}

const problems = [];
const abs = path.resolve(ROOT, file);
const dir = path.dirname(abs);

if (!fs.existsSync(abs)) {
  console.error('MISSING: ' + file + ' was never written. electron-updater has nothing to read, ' +
                'so every installed copy would silently stop finding updates.');
  process.exit(1);
}

const text = fs.readFileSync(abs, 'utf8');
// Flat `key: value` lines and a `files:` list. Regex rather than a YAML parser, because the rig
// and the tools take no dependencies.
const scalar = k => {
  const m = new RegExp('^' + k + ':\\s*(.+?)\\s*$', 'm').exec(text);
  return m ? m[1].replace(/^['"]|['"]$/g, '') : null;
};

const want = require(path.join(ROOT, 'package.json')).version;
const got = scalar('version');
if (got !== want) {
  problems.push('version says ' + JSON.stringify(got) + ' where package.json says ' +
                JSON.stringify(want) + '. An installed copy would compare against the wrong number.');
}

// Every installer named anywhere in the file has to be sitting beside it, or the download 404s
// after the update prompt has already appeared.
const named = new Set();
for (const m of text.matchAll(/^\s*(?:-\s*)?(?:url|path):\s*(.+?)\s*$/gm)) {
  named.add(m[1].replace(/^['"]|['"]$/g, ''));
}
if (!named.size) problems.push('names no installer at all, so there is nothing to download.');
for (const name of named) {
  if (!fs.existsSync(path.join(dir, decodeURIComponent(name)))) {
    problems.push('names ' + name + ', which is not in ' + path.basename(dir) +
                  ' — the update prompt would appear and the download would fail.');
  }
}

if (!/sha512:\s*\S+/.test(text)) {
  problems.push('carries no sha512, so a truncated download would install unchecked.');
}

if (problems.length) {
  console.error('UPDATE METADATA BROKEN in ' + file + ':');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

console.log(file + ': version ' + got + ', ' + named.size + ' installer(s) present, sha512 set.');
