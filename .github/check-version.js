#!/usr/bin/env node
'use strict';

/*
 * Refuse a release whose tag and package.json disagree.
 *
 * WHY: bumping "version" to match the tag is a hand step in CLAUDE.md with nothing
 * checking it. A mismatch still builds, still uploads, and ships an installer whose
 * About box reports a version that was never released — invisible until a user
 * quotes it back in a bug report.
 *
 * Not shipped: .github/ is absent from package.json build.files.
 */

const { version } = require('../package.json');

const tag = process.env.TAG || '';
const want = tag.replace(/^v/, '');

if (!tag) {
  console.error('No TAG in the environment — this step expects github.ref_name.');
  process.exit(1);
}

if (version !== want) {
  console.error('Tag ' + tag + ' does not match package.json version ' + version + '.');
  console.error('Bump "version" to ' + want + ' on main, then re-tag.');
  process.exit(1);
}

console.log('Tag ' + tag + ' matches package.json version ' + version + '.');
