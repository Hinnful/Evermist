'use strict';

// ship.js - /commit's tail: commit, the branch rules, push, pull request.
// Usage: node .claude/commit/ship.js [--slug <name>] [--amend] [--no-backlog] [--accept <spec>]... -- <path>...
// An untagged version goes to release/<version>; anything else to change/<slug>.
// Every stage checks whether it is already done, so a re-run after a stop repeats nothing.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const rules = require('./shipRules.js');
const { runRoot } = require('./runRoot.js');
const { isPackaged } = require('../../tools/build-files.js');

// The repo is the one this is run in, never the one this file sits in: a test copy of the
// script run from its real path would otherwise commit and push in the real repo.
const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const DIR = path.join(ROOT, '.claude', 'commit');
// Each session keeps its own run folder, in the main checkout whatever worktree this runs in: one shared
// notes.txt let a second session overwrite or resume the first's release.
const RUN = rules.runDir(runRoot(ROOT) || ROOT, process.env.CLAUDE_CODE_SESSION_ID);
const STAMP = path.join(RUN, 'notes-passed.json');
const PUSHED = path.join(RUN, 'pushed.json');
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
  const accept = flags.flatMap((f, i) => (f === '--accept' && flags[i + 1] ? [flags[i + 1]] : []));
  return { slug: si >= 0 ? flags[si + 1] : '', amend: flags.includes('--amend'), noBacklog: flags.includes('--no-backlog'), accept, paths };
}

// The version on disk may be another session's uncommitted bump; it counts only when this commit carries it.
// An amend folds a fix into the version commit, which carries the bump already.
const namesPackage = (paths) => paths.some((p) => p.replace(/\\/g, '/') === 'package.json');
function headBumps() {
  try { return git(['diff', '--name-only', 'HEAD~1', 'HEAD', '--', 'package.json']) !== ''; } catch { return false; }
}
function branchFor(slug, paths, amend) {
  const named = namesPackage(paths);
  const own = named || (amend && headBumps());
  const version = JSON.parse(named ? fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8') : git(['show', 'HEAD:package.json'])).version;
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

// ⚠ A FAILED UPDATE MUST NOT STOP A RELEASE: offline or a registry outage only warns, and ships the old Electron.
function stageElectron(opts, notes) {
  const committed = headMessage() === notes.message.trim();
  if (!rules.updatesElectron({ branch: opts.branch, committed })) return committed ? 'HEAD is this commit, Electron kept' : 'not a release, Electron untouched';
  const lockAt = (ref) => { try { return rules.lockedElectron(JSON.parse(git(['show', ref + ':package-lock.json']))); } catch { return null; } };
  try {
    // npm is npm.cmd on Windows, which only a shell finds.
    execFileSync('npm', ['update', 'electron'], { cwd: ROOT, stdio: 'pipe', shell: process.platform === 'win32' });
  } catch (e) {
    console.warn('electron: WARNING npm update electron failed, releasing without it: ' + (e.stderr || e.message || e).toString().trim().split('\n')[0]);
  }
  const lockDirty = dirty(['package-lock.json']);
  opts.paths = rules.withLock(opts.paths, lockDirty);
  let now = null;
  try { now = rules.lockedElectron(JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'))); } catch { /* reported as null */ }
  const was = lockAt('HEAD');
  return `Electron ${was} -> ${now}` + (lockDirty ? ', package-lock.json staged' : ', lock unchanged');
}

function stageCommit({ branch, paths, amend }, notes) {
  if (!dirty(paths) && headMessage() === notes.message.trim()) return 'already committed';
  // A second commit on a pushed branch puts two commits under one version.
  if (!amend && remoteSha(branch)) throw new Error(`${branch} is already on origin; a fix to it re-runs with --amend`);
  // A path already removed by git rm or git mv is in neither the tree nor the index, and git add refuses it.
  const present = paths.filter((p) => fs.existsSync(path.join(ROOT, p)));
  const gone = paths.filter((p) => !present.includes(p));
  if (present.length) git(['add', '--', ...present]);
  if (gone.length) git(['rm', '--cached', '--ignore-unmatch', '-q', '--', ...gone]);
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

// ⚠ PARALLEL RELEASES. Another session's release or change in CI moves main when it lands, and a push in that
// window can neither land nor keep its version. So this waits for it, then catches up with main, replaying this
// commit's bump on main's version and renumbering the Summary to match. The DM's yes stands: it covers the text.
const isAncestor = (a, b) => { try { git(['merge-base', '--is-ancestor', a, b]); return true; } catch { return false; } };

function inFlight() {
  let own = '';
  try { own = JSON.parse(readText(PUSHED)).branch; } catch { /* this session never pushed */ }
  return git(['ls-remote', '--heads', 'origin', 'refs/heads/release/*', 'refs/heads/change/*']).split('\n').filter(Boolean)
    .map((l) => l.split(/\s+/)[1].replace('refs/heads/', '')).filter((b) => b !== own);
}

function stageBase(opts, notes) {
  const busy = inFlight();
  if (busy.length) {
    const refs = busy.map((b) => 'refs/heads/' + b).join(' ');
    throw new Error(`WAIT: ${busy.join(', ')} is in CI and moves main when it lands. Wait for it with the Monitor tool, then run ship.js again:\n  until [ -z "$(git ls-remote --heads origin ${refs})" ]; do sleep 30; done`);
  }
  if (isAncestor('origin/main', 'HEAD')) return 'contains origin/main';
  if (!isAncestor('HEAD', 'origin/main')) {
    if (git(['status', '--porcelain', '--untracked-files=no']) !== '') {
      throw new Error('main moved, HEAD holds commits origin/main lacks, and the tree has edits: commit or drop the edits, then run ship.js again to rebase');
    }
    try { git(['rebase', 'origin/main'], { stdio: 'pipe' }); } catch (e) {
      const files = (() => { try { return git(['diff', '--name-only', '--diff-filter=U']); } catch { return ''; } })();
      try { git(['rebase', '--abort'], { stdio: 'pipe' }); } catch { /* nothing to abort */ }
      throw new Error('main moved, and rebasing onto it conflicts in: ' + (files.split('\n').join(', ') || 'unknown files') + '. Resolve by hand, then run ship.js again');
    }
    return 'rebased onto origin/main';
  }
  // HEAD is behind main. A bumped package.json would block the fast-forward, so the bump is set aside and replayed.
  const pkg = path.join(ROOT, 'package.json');
  const bumped = namesPackage(opts.paths) && dirty(['package.json']);
  let raw = null;
  let kind = null;
  if (bumped) {
    raw = fs.readFileSync(pkg, 'utf8');
    const { version: was, ...headRest } = JSON.parse(git(['show', 'HEAD:package.json']));
    const { version: mine, ...myRest } = JSON.parse(raw);
    if (JSON.stringify(headRest) !== JSON.stringify(myRest)) throw new Error('main moved, and package.json changes more than the version: catch up with origin/main by hand');
    kind = rules.bumpKind(was, mine);
    git(['checkout', 'HEAD', '--', 'package.json']);
  }
  try {
    git(['merge', '--ff-only', 'origin/main'], { stdio: 'pipe' });
  } catch (e) {
    if (raw !== null) fs.writeFileSync(pkg, raw);
    throw new Error('main moved, and edits here overlap its changes: ' + (e.stderr || e.message).toString().trim().split('\n').slice(0, 6).join(' '));
  }
  if (!kind) return 'caught up with origin/main';
  const next = rules.bump(JSON.parse(fs.readFileSync(pkg, 'utf8')).version, kind);
  fs.writeFileSync(pkg, fs.readFileSync(pkg, 'utf8').replace(/("version"\s*:\s*")[^"]+(")/, `$1${next}$2`));
  const text = rules.renumber(readText(NOTES), next);
  fs.writeFileSync(NOTES, text);
  Object.assign(notes, readNotes());
  return `caught up with origin/main; this release is now ${next}`;
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
// Any local branch may ship: stageBase checks it holds origin/main, and the push goes by refspec.
function stageClean() {
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

// What the end-of-release hooks read: the Summary, the branch and when it first went up. A re-push of the
// same branch keeps the first time, so a fix amended in does not ask for the monitor and the rename again.
function stageRecord({ branch }, notes) {
  let first = new Date().toISOString();
  try {
    const old = JSON.parse(fs.readFileSync(PUSHED, 'utf8'));
    if (old.branch === branch) first = old.time;
  } catch { /* no earlier push */ }
  fs.writeFileSync(PUSHED, JSON.stringify({ summary: notes.summary, branch, sha: git(['rev-parse', 'HEAD']), time: first }, null, 2) + '\n');
  for (const f of [NOTES, STAMP]) { try { fs.rmSync(f, { force: true }); } catch { /* a locked file must not fail the record */ } }
  return 'recorded; notes.txt cleared';
}

const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const must = (fault, ok) => { if (fault) throw new Error(fault); return ok; };

// A re-run after the whole tail finished: notes.txt is gone, and pushed.json names HEAD.
function alreadyShipped() {
  if (fs.existsSync(NOTES)) return false;
  try { return JSON.parse(readText(PUSHED)).sha === git(['rev-parse', 'HEAD']); } catch { return false; }
}

// The DM's yes guards the commit and the push. A re-run with both already done only opens the pull request.
function stageYes({ branch, paths, amend }, notes) {
  const committed = !dirty(paths) && headMessage() === notes.message.trim();
  if (committed && remoteSha(branch) === git(['rev-parse', 'HEAD'])) return 'nothing left to approve';
  let stamp = null;
  try { stamp = JSON.parse(readText(STAMP)); } catch { /* never passed */ }
  const last = Date.parse(readText(path.join(RUN, 'last-user-message')).trim());
  return must(rules.yesCheck({ stamp, currentHash: rules.notesHash(readText(NOTES)), lastUserMs: last, amend, paths, isPackaged }), 'the DM said yes after the notes passed');
}

// ⚠ THE SESSION OPENS THE PULL REQUEST, NOT THIS SCRIPT. The app arms Auto-fix only for a pull request it
// watched the session open; one opened from in here was refused on every release from 2026-10-28.
function stagePr({ branch }, notes) {
  const open = JSON.parse(gh(['pr', 'list', '--head', branch, '--state', 'open', '--json', 'url,number']) || '[]')[0] || null;
  let ownBranch = null;
  try { ownBranch = JSON.parse(readText(PUSHED)).branch; } catch { /* this session never pushed */ }
  const body = path.join(RUN, 'pr-body.md');
  fs.writeFileSync(body, notes.description + '\n');
  const step = rules.prStep({ open, ownBranch, branch, title: notes.summary, bodyFile: path.relative(ROOT, body) });
  return step.url || 'NOT OPEN BY THIS SESSION - run this yourself in Bash: ' + step.run;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  git(['fetch', '--prune', '--tags', 'origin'], { stdio: 'pipe' });
  if (alreadyShipped()) { console.log('already shipped: ' + PUSHED); return; }
  const notes = readNotes();
  // Catching up comes first: until it does, the version on disk may be one another release already took.
  const stages = [
    ['base', () => stageBase(opts, notes)],
    ['branch', () => { opts.branch = branchFor(opts.slug, opts.paths, opts.amend); return opts.branch; }],
    ['yes', () => stageYes(opts, notes)],
    ['backlog', () => must(rules.backlogCheck(opts), 'carried')],
    ['acceptance', () => must(rules.acceptCheck({ ...opts, accept: opts.accept.map((f) => ({ file: f, text: readText(path.resolve(ROOT, f)) })) }), 'every DoD line proven')],
    ['disclosure', () => must(rules.disclosureCheck({ ...opts, disclosure: readText(path.join(RUN, 'disclosure.txt')) }), 'none needed')],
    ['guards', stageGuards],
    ['guard inputs', () => stageGuardInputs(opts)],
    ['electron', () => stageElectron(opts, notes)],
    ['commit', () => stageCommit(opts, notes)],
    ['clean', stageClean],
    ['agree', () => stageAgree(opts)],
    ['push', () => stagePush(opts)],
    ['pr', () => stagePr(opts, notes)],
    ['record', () => stageRecord(opts, notes)],
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
