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

// A test or a rig scenario edited to turn a run green must be named in disclosure.txt.
const isTestEdit = (p) => /^(test\/|tools\/rig\/scenarios\/)/.test(norm(p));

function disclosureCheck({ amend, paths, disclosure }) {
  if (!amend) return null;
  const text = norm(disclosure || '');
  const missing = paths.map(norm).filter((p) => isTestEdit(p) && !text.includes(p));
  if (!missing.length) return null;
  return 'this amend edits ' + missing.join(', ') + ' without disclosing it. Write one line per file to disclosure.txt in this session\'s run folder: which test, and why the old expectation was wrong.';
}

module.exports = { notesHash, runDir, sessionIds, isFromDm, yesCheck, backlogCheck, disclosureCheck, isTestEdit };
