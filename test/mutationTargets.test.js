'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// The mutation run's targets used to be hand-written line ranges in stryker.conf.json. Every edit
// above one moved it, nothing checked it, and the run then scored whatever had slid into those
// lines. tools/mutation-targets.js holds the NAMES and derives the ranges; these checks are what
// make a rename or an unexport loud without waiting for a mutation run.

const { MUTATE_TARGETS, targetsFor } = require('../tools/mutation-targets');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

describe('the mutation run points at real functions', () => {

  it('finds every named target in its file', () => {
    assert.doesNotThrow(() => targetsFor(MUTATE_TARGETS));
  });

  // A target the unit suite cannot reach has mutants nothing could ever kill, which is what
  // made an earlier whole-file config unreadable. Reachable means exported, or called by
  // something in the same file that is - deriveFogColors is how the two hex helpers are hit.
  it('mutates only functions the unit suite can reach', () => {
    const unreachable = [];
    for (const [file, names] of Object.entries(MUTATE_TARGETS)) {
      const src = read(file);
      const exportsFrom = src.slice(src.indexOf('module.exports'));
      for (const n of names) {
        const named = new RegExp('\\b' + n + '\\b').test(exportsFrom);
        const calls = (src.match(new RegExp('\\b' + n + '\\s*\\(', 'g')) || []).length;
        // one match is the declaration itself; a second is a caller
        if (!named && calls < 2) unreachable.push(file + ' -> ' + n);
      }
    }
    assert.deepEqual(unreachable, [],
      'mutation targets no test can reach, so their mutants survive whatever anyone writes');
  });

  it('gives each target a whole function, opening line to closing brace', () => {
    for (const range of targetsFor(MUTATE_TARGETS)) {
      const [file, span] = range.split(':');
      const [a, b] = span.split('-').map(Number);
      const lines = read(file).split(/\r?\n/);
      assert.match(lines[a - 1], /^(?:async )?function \w/, range + ' does not open on a function');
      assert.equal(lines[b - 1].trim(), '}', range + ' does not close on a brace');
      assert.ok(b > a, range + ' is empty');
    }
  });

  it('is what stryker.conf.js actually hands to the runner', () => {
    const conf = require('../stryker.conf.js');
    assert.deepEqual(conf.mutate, targetsFor(MUTATE_TARGETS));
    assert.ok(conf.mutate.length > 0, 'the mutation run has no targets at all');
  });

  // tools/ is absent from build.files on purpose, and a config that reached into the installer
  // would ship the whole harness with it.
  it('keeps the target list out of the installer', () => {
    const pkg = JSON.parse(read('package.json'));
    const shipped = (pkg.build && pkg.build.files) || [];
    assert.ok(!shipped.some(p => String(p).startsWith('tools/')),
      'build.files ships something under tools/');
  });
});
