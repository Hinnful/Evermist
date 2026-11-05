'use strict';

/*
 * Which commit holds a version's release notes.
 *
 *   node tools/release-notes.js <version>     prints the sha
 *
 * The newest commit whose subject starts "<version> - ", else the commit that added the version
 * line to package.json, else HEAD. Newest wins because a red gate's fix, or a rewrite of the
 * notes, lands on top of the commit that set the version; tools/build-changelog.js agrees.
 * release.yml (decide, publish) and check-release.js read it here, so they cannot drift apart.
 */

const { execFileSync } = require('child_process');

// commits: [{ sha, subject }] newest first. setter: the sha that added the version line, or ''.
function notesCommit(version, commits, setter) {
  const hit = commits.find((c) => c.subject.startsWith(version + ' - '));
  return hit ? hit.sha : (setter || 'HEAD');
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

// The commit that ADDED this version line; -S alone also matches the commit that removed it.
function versionSetter(version) {
  const needle = '"version": "' + version + '"';
  const shas = git('log', '--format=%H', '-S' + needle, '--', 'package.json').split('\n').filter(Boolean);
  return shas.find((c) => git('show', c, '--', 'package.json').split('\n')
    .some((l) => l.startsWith('+') && l.includes(needle))) || '';
}

function notesCommitFor(version) {
  const commits = git('log', '--format=%H%x09%s').split('\n').filter(Boolean).map((l) => {
    const i = l.indexOf('\t');
    return { sha: l.slice(0, i), subject: l.slice(i + 1) };
  });
  return notesCommit(version, commits, versionSetter(version));
}

if (require.main === module) {
  const version = process.argv[2];
  if (!version) { console.error('usage: node tools/release-notes.js <version>'); process.exit(1); }
  console.log(notesCommitFor(version));
}

module.exports = { notesCommit, versionSetter, notesCommitFor };
