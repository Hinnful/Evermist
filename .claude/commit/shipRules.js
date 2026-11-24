'use strict';

// shipRules.js - the pure verdicts behind ship.js, check-notes.js and the release-checklist hooks.
// Each returns an error string, or null when the rule holds. No disk, no git, no clock.

const crypto = require('crypto');
const path = require('path');

const norm = (p) => String(p).replace(/\\/g, '/');

// The notes as ship.js will commit them, so a CRLF save or a trailing newline is not an edit.
const notesHash = (text) => crypto.createHash('sha256').update(String(text).replace(/\r/g, '').trim()).digest('hex');

// The folder a session keeps its run state in; ids reach it from a hook's stdin and from the env.
const runDir = (root, id) => path.join(root, '.claude', 'commit', 'runs', String(id || 'local'));

// Every id this session may be known by: a hook's stdin id and the env id are meant to match.
const sessionIds = (payload, env) => Array.from(new Set([payload && payload.session_id, env && env.CLAUDE_CODE_SESSION_ID].filter(Boolean)));

// ⚠ UserPromptSubmit also fires for a subagent's hand-back, a task notification and an app event, and
// none of those is the DM: counting them let a finishing subagent approve the notes.
const NOT_THE_DM = /^\s*(?:<system-reminder>\s*)?(?:Another Claude session sent a message|<agent-message|<task-notification|\[SYSTEM NOTIFICATION|<ci-monitor-event|<side-sessions-event|<scheduled-task)/;
const isFromDm = (prompt) => typeof prompt === 'string' && prompt.trim() !== '' && !NOT_THE_DM.test(prompt);

// The DM's yes: notes that passed the checker unchanged, then a message of theirs after that.
// An amend touching nothing that ships carries a fix, not new news, so it needs no yes.
function yesCheck({ stamp, currentHash, lastUserMs, amend, paths, isPackaged }) {
  if (amend && paths.length && !paths.some((p) => isPackaged(norm(p)))) return null;
  const how = 'Show the notes to the DM and wait for their yes in a new message, then run ship.js again.';
  if (!stamp || !stamp.time) return 'the notes have not passed check-notes.js in this session. Run it first. ' + how;
  if (stamp.hash !== currentHash) return 'notes.txt changed after check-notes.js passed it. Run the checker again. ' + how;
  const passedMs = Date.parse(stamp.time);
  if (!(lastUserMs > passedMs)) return 'the DM has not sent a message since the notes passed. ' + how;
  return null;
}

// An amend keeps the backlog the first commit carried, so only a fresh release is held to it.
function backlogCheck({ branch, paths, noBacklog, amend }) {
  if (noBacklog || amend || !branch.startsWith('release/')) return null;
  if (paths.some((p) => norm(p) === 'docs/BACKLOG.md')) return null;
  return 'a release must carry docs/BACKLOG.md (close what shipped, file what was deferred). Add it to the paths, or pass --no-backlog when the backlog truly has nothing to change.';
}

// The Definition of Done's numbered lines, each with its continuation lines joined.
function dodLines(text) {
  const m = String(text).replace(/\r/g, '').match(/^## Definition of Done\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
  if (!m) return null;
  const lines = [];
  for (const row of m[1].split('\n')) {
    const n = row.match(/^(\d+)\.\s+(.*)$/);
    if (n) lines.push({ n: +n[1], text: n[2] });
    else if (lines.length && /^\s+\S/.test(row)) lines[lines.length - 1].text += ' ' + row.trim();
    else if (lines.length && !row.trim()) lines.push(null);
  }
  return lines.filter(Boolean);
}

// How a line was proven, as the session marked it after checking: the rig doing what the DM does, a unit
// test for pure logic, the DM's eye, or a part nothing can reach with the check made around it.
const VERDICT = /\[(?:rig|unit):\s*[^\]\s][^\]]*\]\s*$|\[eye\]\s*$|\[unreachable:\s*[^;\]]+;\s*around:\s*[^\]\s][^\]]*\]\s*$/;
// A line the DM acts on reads "does → sees"; only a unit-tested line may be about logic alone.
const USER_LINE = /→/;

// A release ships only when every DoD line of every spec it carries says how it was proven.
function acceptCheck({ branch, amend, accept }) {
  if (amend || !String(branch).startsWith('release/')) return null;
  if (!accept || !accept.length) return 'a release needs --accept <spec> for each item it ships: the spec whose Definition of Done was checked, line by line. A small item gets a short spec too.';
  const bad = [];
  for (const { file, text } of accept) {
    const lines = dodLines(text);
    if (!lines || !lines.length) { bad.push(file + ': no numbered Definition of Done'); continue; }
    const open = lines.filter((l) => !VERDICT.test(l.text)).map((l) => l.n);
    if (open.length) bad.push(file + ': line ' + open.join(', ') + ' carries no [rig: …], [unit: …], [eye] or [unreachable: …; around: …]');
    const flat = lines.filter((l) => /\[(rig|eye|unreachable)/.test(l.text) && !USER_LINE.test(l.text)).map((l) => l.n);
    if (flat.length) bad.push(file + ': line ' + flat.join(', ') + ' is not written as what the DM does → what the DM sees');
  }
  return bad.length ? 'acceptance not proven - ' + bad.join('; ') : null;
}

// A test or a rig scenario edited to turn a run green must be named in disclosure.txt.
const isTestEdit = (p) => /^(test\/|tools\/rig\/scenarios\/)/.test(norm(p));

function disclosureCheck({ amend, paths, disclosure }) {
  if (!amend) return null;
  const text = norm(disclosure || '');
  const missing = paths.map(norm).filter((p) => isTestEdit(p) && !text.includes(p));
  if (!missing.length) return null;
  return 'this amend edits ' + missing.join(', ') + ' without disclosing it. Write one line per file to disclosure.txt in this session\'s run folder: which test, and why the old expectation was wrong.';
}

// Every release pulls the newest Electron the package.json range allows; a change/** commit never touches it.
// Once HEAD is this release's commit it keeps its Electron: a re-run, or an amend, would otherwise
// pull one published since and commit it twice under one version.
const updatesElectron = ({ branch, committed }) => String(branch).startsWith('release/') && !committed;

// The lock rides in the commit only when it differs from HEAD, so a re-run after the commit stages nothing.
function withLock(paths, lockDirty) {
  if (!lockDirty || paths.some((p) => norm(p) === 'package-lock.json')) return paths;
  return paths.concat('package-lock.json');
}

// The Electron a package-lock.json installs, or null when it has none.
const lockedElectron = (lock) => ((((lock && lock.packages) || {})['node_modules/electron']) || {}).version || null;

// The pull request command the session runs itself, quoted for a POSIX shell.
const shq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
const prCreateCommand = (branch, title, bodyFile) =>
  ['gh pr create --base main --head', shq(branch), '--title', shq(title), '--body-file', shq(String(bodyFile).replace(/\\/g, '/'))].join(' ');

// ⚠ THE APP ARMS AUTO-FIX ONLY FOR A PULL REQUEST IT WATCHED THIS SESSION OPEN. A release retried from
// a new session found the old session's pull request still open, reused it, and could not arm the
// monitor. Keep an open one only when this session pushed the branch before; close any other and open anew.
function prStep({ open, ownBranch, branch, title, bodyFile }) {
  if (open && ownBranch === branch) return { url: open.url };
  const create = prCreateCommand(branch, title, bodyFile);
  if (!open) return { run: create };
  return { run: 'gh pr close ' + open.number + ' --comment ' + shq('Superseded by a pull request this session opens, so its CI monitor can be armed.') + ' && ' + create };
}

module.exports = { dodLines, acceptCheck, updatesElectron, withLock, lockedElectron, prStep, prCreateCommand, notesHash, runDir, sessionIds, isFromDm, yesCheck, backlogCheck, disclosureCheck, isTestEdit };
