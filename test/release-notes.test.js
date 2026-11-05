'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { notesCommit } = require('../tools/release-notes.js');

describe('which commit holds the release notes', () => {
  const log = [
    { sha: 'c', subject: 'Fix the rig' },
    { sha: 'b', subject: '5.3.0 - Fog themes' },
    { sha: 'a', subject: '5.3.0 - Fog themes, starting with Ice' },
  ];

  it('takes the newest commit titled with the version, not the one that set it', () => {
    assert.equal(notesCommit('5.3.0', log, 'a'), 'b');
  });

  it('falls back to the commit that set the version', () => {
    assert.equal(notesCommit('5.4.0', log, 'a'), 'a');
  });

  it('falls back to HEAD when nothing matches and nothing set it', () => {
    assert.equal(notesCommit('5.4.0', log, ''), 'HEAD');
  });

  it('does not match a longer version that shares the prefix', () => {
    assert.equal(notesCommit('5.3', log, ''), 'HEAD');
  });
});
