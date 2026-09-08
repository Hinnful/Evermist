'use strict';

/*
 * Mutation targets, DERIVED FROM FUNCTION NAMES rather than written as line numbers.
 *
 * ⚠ THE OLD stryker.conf.json HELD LINE RANGES, AND EVERY EDIT ABOVE A TARGET MOVED THEM. Nothing
 * checked them, so a stale range mutates whichever code has since slid into those lines — the run
 * still reports a score, and the score is about the wrong functions. Every range here is computed
 * from the source at load time instead, so it cannot drift.
 *
 * WHAT IS LISTED: the exported, unit-tested kernels and nothing else. Mutating a whole file points
 * the run at code no test can reach — module globals, DOM handlers — and those survivors are
 * permanently unkillable, which is what made an earlier full-file config unreadable. See
 * docs/decisions/testing-and-the-rig.md.
 *
 * A name that no longer exists throws here rather than being skipped, and test/structure.test.js
 * checks the same list without running Stryker.
 */

const { targetsFor, MUTATE_TARGETS } = require('./tools/mutation-targets');

module.exports = {
  testRunner: 'command',
  commandRunner: { command: 'npm test' },
  coverageAnalysis: 'off',
  reporters: ['clear-text', 'progress'],
  mutate: targetsFor(MUTATE_TARGETS),
};
