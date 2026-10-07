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
const NOTES = path.join(DIR, 'notes.txt');

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

function branchFor(slug) {
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  if (!git(['tag', '-l', `v${version}`])) return `release/${version}`;
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
const staged = () => git(['diff', '--cached', '--name-only']) !== '';

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
  if (amend) {
    git(['commit', '--amend', '-F', msg]);
    return 'amended';
  }
  if (!staged()) throw new Error('nothing staged for the paths given, and HEAD is not this commit');
  git(['commit', '-F', msg]);
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
  opts.branch = branchFor(opts.slug);
  const notes = readNotes();
  const stages = [
    ['base', stageBase],
    ['commit', () => stageCommit(opts, notes)],
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
