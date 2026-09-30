'use strict';

// ship.js - /commit's tail: commit, changelog, branch cleanup, push, pull request.
// Usage: node .claude/commit/ship.js --branch <release/x|change/y> [--amend] -- <path>...
// Every stage checks whether it is already done, so a re-run after a stop repeats nothing.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// The repo is the one this is run in, never the one this file sits in: a test copy of the
// script run from its real path would otherwise commit and push in the real repo.
const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const DIR = path.join(ROOT, '.claude', 'commit');
const RUN = path.join(DIR, 'run.json');
const NOTES = path.join(DIR, 'notes.txt');

// Node on Windows runs the real gh.exe even with a stub earlier on PATH, so a test swaps gh here.
const GH = process.env.EVERMIST_GH ? [process.execPath, process.env.EVERMIST_GH] : ['gh'];

const git = (args, opts = {}) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', ...opts }).trim();
const gh = (args) => execFileSync(GH[0], [...GH.slice(1), ...args], { cwd: ROOT, encoding: 'utf8' }).trim();

function parseArgs(argv) {
  const sep = argv.indexOf('--');
  const flags = sep < 0 ? argv : argv.slice(0, sep);
  const paths = sep < 0 ? [] : argv.slice(sep + 1);
  const bi = flags.indexOf('--branch');
  return { branch: bi >= 0 ? flags[bi + 1] : '', amend: flags.includes('--amend'), paths };
}

function readRun() {
  try { return JSON.parse(fs.readFileSync(RUN, 'utf8')); } catch { return {}; }
}

function writeRun(patch) {
  const run = { ...readRun(), ...patch, head: git(['rev-parse', 'HEAD']) };
  fs.writeFileSync(RUN, JSON.stringify(run, null, 2) + '\n');
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

function stageChangelog() {
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  if (git(['tag', '-l', `v${version}`])) return `v${version} is tagged, no bump`;
  const out = 'src/ui/changelogData.js';
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build-changelog.js')], { cwd: ROOT, stdio: 'ignore' });
  if (!git(['status', '--porcelain', '--', out])) return 'changelog already carries this commit';
  git(['add', '--', out]);
  git(['commit', '--amend', '--no-edit']);
  return 'changelog amended in';
}

function stageCleanup() {
  const current = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const inWorktree = new Set(git(['worktree', 'list', '--porcelain']).split('\n')
    .filter(l => l.startsWith('branch refs/heads/')).map(l => l.slice('branch refs/heads/'.length)));
  const merged = git(['for-each-ref', '--merged', 'origin/main', '--format=%(refname:short)', 'refs/heads/'])
    .split('\n').map(s => s.trim()).filter(Boolean);
  const deleted = [], kept = [];
  for (const b of merged) {
    if (b === 'main' || b === current || inWorktree.has(b)) continue;
    try { git(['branch', '-d', b], { stdio: 'pipe' }); deleted.push(b); } catch { kept.push(b); }
  }
  if (kept.length) console.error(`ship.js: could not delete ${kept.join(', ')} - left in place`);
  return deleted.length ? `deleted ${deleted.join(', ')}` : 'no merged branches';
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
  if (!/^(release|change)\/[\w.-]+$/.test(opts.branch)) {
    throw new Error(`--branch must be release/<version> or change/<slug>, got "${opts.branch}"`);
  }
  const notes = readNotes();
  git(['fetch', '--prune', 'origin'], { stdio: 'pipe' });
  writeRun({ branch: opts.branch });
  const stages = [
    ['commit', () => stageCommit(opts, notes)],
    ['changelog', stageChangelog],
    ['cleanup', stageCleanup],
    ['push', () => stagePush(opts)],
    ['pr', () => stagePr(opts, notes)],
  ];
  let url = '';
  for (const [name, fn] of stages) {
    let result;
    try { result = fn(); } catch (e) {
      console.error(`ship.js: FAILED at ${name}: ${(e.stderr || e.message || e).toString().trim()}`);
      process.exit(1);
    }
    if (name === 'pr') url = result;
    console.log(`${name}: ${result}`);
    writeRun({ stage: name });
  }
  console.log(`${git(['rev-parse', '--short', 'HEAD'])} ${url}`);
}

try { main(); } catch (e) {
  console.error(`ship.js: ${e.message}`);
  process.exit(1);
}
