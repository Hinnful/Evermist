'use strict';

// ship.js - /commit's tail: commit, the branch rules, push, pull request.
// Usage: node .claude/commit/ship.js [--slug <name>] [--amend] -- <path>...
// An untagged version goes to release/<version>; anything else to change/<slug>.
// Every stage checks whether it is already done, so a re-run after a stop repeats nothing.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// The repo is the one this is run in, never the one this file sits in: a test copy of the
// script run from its real path would otherwise commit and push in the real repo.
const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const DIR = path.join(ROOT, '.claude', 'commit');
// Each session keeps its own run folder: two sessions share this checkout, and one shared
// notes.txt let the second overwrite or resume the first's release.
const RUN = path.join(DIR, 'runs', process.env.CLAUDE_CODE_SESSION_ID || 'local');
const LEGACY_NOTES = path.join(DIR, 'notes.txt');
const NOTES = fs.existsSync(path.join(RUN, 'notes.txt')) || !fs.existsSync(LEGACY_NOTES) ? path.join(RUN, 'notes.txt') : LEGACY_NOTES;

// Node on Windows runs the real gh.exe even with a stub earlier on PATH, so a test swaps gh here.
const GH = process.env.EVERMIST_GH ? [process.execPath, process.env.EVERMIST_GH] : ['gh'];

const git = (args, opts = {}) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', ...opts }).trim();
const gh = (args) => execFileSync(GH[0], [...GH.slice(1), ...args], { cwd: ROOT, encoding: 'utf8' }).trim();

function parseArgs(argv) {
  const sep = argv.indexOf('--');
  const flags = sep < 0 ? argv : argv.slice(0, sep);
  const paths = sep < 0 ? [] : argv.slice(sep + 1);
  const si = flags.indexOf('--slug');
  return { slug: si >= 0 ? flags[si + 1] : '', amend: flags.includes('--amend'), paths };
}

// The version on disk may be another session's uncommitted bump; it counts only when this commit carries it.
function branchFor(slug, paths) {
  const own = paths.some((p) => p.replace(/\\/g, '/') === 'package.json');
  const version = JSON.parse(own ? fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8') : git(['show', 'HEAD:package.json'])).version;
  if (!git(['tag', '-l', `v${version}`])) {
    // A change pushed over an unreleased bump would release that version with this commit's notes.
    if (!own) throw new Error(`${version} is committed but not released yet; ship this once release/${version} lands`);
    return `release/${version}`;
  }
  if (!/^[\w.-]+$/.test(slug || '')) throw new Error(`v${version} is already released, so this goes to change/<slug>; pass --slug`);
  return `change/${slug}`;
}

function readNotes() {
  const lines = fs.readFileSync(NOTES, 'utf8').replace(/\r/g, '').split('\n');
  const summary = lines[0].trim();
  const description = lines.slice(1).join('\n').trim();
  if (!summary) throw new Error(`no Summary on line 1 of ${NOTES}`);
  return { summary, description, message: description ? `${summary}\n\n${description}\n` : `${summary}\n` };
}

function tmpFile(name, text) {
  const f = path.join(os.tmpdir(), `evermist-ship-${process.pid}-${name}`);
  fs.writeFileSync(f, text);
  return f;
}

const headMessage = () => git(['log', '-1', '--format=%B']).replace(/\r/g, '').trim();
const dirty = (paths) => paths.length > 0 && git(['status', '--porcelain', '--', ...paths]) !== '';
const staged = (paths) => paths.length > 0 && git(['diff', '--cached', '--name-only', '--', ...paths]) !== '';

function remoteSha(branch) {
  const line = git(['ls-remote', '--heads', 'origin', `refs/heads/${branch}`]);
  return line ? line.split(/\s+/)[0] : '';
}

function stageCommit({ branch, paths, amend }, notes) {
  if (!dirty(paths) && headMessage() === notes.message.trim()) return 'already committed';
  // A second commit on a pushed branch puts two commits under one version.
  if (!amend && remoteSha(branch)) throw new Error(`${branch} is already on origin; a fix to it re-runs with --amend`);
  if (paths.length) git(['add', '--', ...paths]);
  const msg = tmpFile('msg', notes.message);
  // Commit the named paths only: another session's staged edits share this index.
  const only = paths.length ? ['--', ...paths] : [];
  if (amend) {
    git(['commit', '--amend', '-F', msg, ...only]);
    return 'amended';
  }
  if (!staged(paths)) throw new Error('nothing staged for the paths given, and HEAD is not this commit');
  git(['commit', '-F', msg, ...only]);
  return 'committed';
}

// The land job refuses a branch that does not contain main, but only after the whole gate ran.
function stageBase() {
  try {
    git(['merge-base', '--is-ancestor', 'origin/main', 'HEAD']);
  } catch {
    throw new Error('HEAD does not contain origin/main; merge it in first');
  }
  return 'contains origin/main';
}

// CI's guards job runs the same script; a red one there costs a whole gate and an amend.
function stageGuards() {
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'check-guards.js')], { cwd: ROOT, stdio: 'pipe' });
  return 'pass';
}

// ⚠ THE GUARDS READ THE WORKING TREE, and CI reads the commit. A guarded file edited after the notes
// were agreed, or one a guard just ratcheted down, passes here and is absent from the commit.
const GUARDED = ['index.html', 'CLAUDE.md', '.claude/hooks/blob-baseline.json', '.claude/hooks/claudemd-baseline.json'];

function stageGuardInputs({ paths }) {
  // git() trims its output, so the first line's status column may be gone: take the path after the status.
  const dirtyFiles = git(['status', '--porcelain', '--', ...GUARDED]).split('\n').filter(Boolean).map((l) => l.replace(/^\s*\S+\s+/, ''));
  const left = dirtyFiles.filter((f) => !paths.some((p) => p.replace(/\\/g, '/') === f));
  if (left.length) throw new Error('the guards just judged edits the commit will not carry: ' + left.join(', ') + '. Pass them to ship.js, or revert them.');
  return 'the commit carries every guarded edit';
}

// A second session may be mid-edit in this checkout, so what is left is reported, not refused.
// The report names it to the DM: a left-behind edit nobody mentions is work that gets forgotten.
function stageClean() {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== 'main') throw new Error(`HEAD is on ${branch}; all work ships from main`);
  const left = git(['status', '--porcelain']).split('\n').filter(Boolean).map((l) => l.replace(/^\s*\S+\s+/, ''));
  return left.length ? 'LEFT BEHIND, name each to the DM: ' + left.join(', ') : 'nothing left behind';
}

function stageAgree({ branch }) {
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'check-release.js'), branch], { cwd: ROOT, stdio: 'pipe' });
  return 'branch, version and files agree';
}

function stagePush({ branch, amend }) {
  const head = git(['rev-parse', 'HEAD']);
  const remote = remoteSha(branch);
  if (remote === head) return 'already pushed';
  const refspec = `HEAD:refs/heads/${branch}`;
  if (!remote) {
    git(['push', 'origin', refspec], { stdio: 'pipe' });
    return 'pushed';
  }
  if (!amend) throw new Error(`origin/${branch} is ${remote.slice(0, 7)}, HEAD is ${head.slice(0, 7)}; re-run with --amend to force-push the amended commit`);
  git(['push', `--force-with-lease=refs/heads/${branch}:${remote}`, 'origin', refspec], { stdio: 'pipe' });
  return 'force-pushed';
}

function stagePr({ branch }, notes) {
  const open = JSON.parse(gh(['pr', 'list', '--head', branch, '--state', 'open', '--json', 'url']) || '[]');
  if (open.length) return open[0].url;
  const body = tmpFile('body', notes.description);
  return gh(['pr', 'create', '--base', 'main', '--head', branch, '--title', notes.summary, '--body-file', body]);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  git(['fetch', '--prune', '--tags', 'origin'], { stdio: 'pipe' });
  opts.branch = branchFor(opts.slug, opts.paths);
  const notes = readNotes();
  const stages = [
    ['base', stageBase],
    ['guards', stageGuards],
    ['guard inputs', () => stageGuardInputs(opts)],
    ['commit', () => stageCommit(opts, notes)],
    ['clean', stageClean],
    ['agree', () => stageAgree(opts)],
    ['push', () => stagePush(opts)],
    ['pr', () => stagePr(opts, notes)],
  ];
  let url = '';
  for (const [name, fn] of stages) {
    let result;
    try { result = fn(); } catch (e) {
      console.error(`ship.js: FAILED at ${name}: ${(e.stdout || '').toString().trim()} ${(e.stderr || e.message || e).toString().trim()}`.trim());
      process.exit(1);
    }
    if (name === 'pr') url = result;
    console.log(`${name}: ${result}`);
  }
  console.log(`${opts.branch} ${git(['rev-parse', '--short', 'HEAD'])} ${url}`);
}

try { main(); } catch (e) {
  console.error(`ship.js: ${e.message}`);
  process.exit(1);
}
