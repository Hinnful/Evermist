#!/usr/bin/env node
'use strict';

/*
 * Rig trigger — shipped code changed, and no scenario moved with it.
 *
 * WHY: CLAUDE.md's Testing section already says to run the rig before handing over a change to
 * shipped code, and docs/DECISIONS.md already records why that is not enough on its own — "a
 * pointer is not a trigger". A rule only fires if someone is already reading the section it sits
 * in. This fires on the edit itself.
 *
 * WHAT: a PostToolUse hook (see .claude/settings.json). After an Edit/Write to any file under
 * src/, if nothing under tools/rig/scenarios/ has been touched in the working tree, it hands
 * Claude one line saying so.
 *
 * ⚠ IT HINTS, IT DOES NOT BLOCK. Most src/ edits genuinely need no new scenario — a shipped fix
 * covered by an existing one, a comment, a mutation check being put back. A hard block on every
 * src/ edit is a hook that gets commented out inside a week, and then the rule is gone for good.
 * So this exits 0 and speaks once, unlike the five ratchets beside it which exit 2.
 *
 * ⚠ NEVER ADD permissionDecision, HERE OR IN ANY OTHER HOOK. The only accepted values are
 * allow/deny/ask; anything else parks the tool call unrun and ends the turn mid-edit.
 *
 * FIRES ONCE PER SESSION, keyed by session_id from the hook payload (verified present on
 * PostToolUse, alongside cwd, tool_name and tool_input). The marker lives under the OS temp dir:
 * rig output never goes in the working tree, and neither does a marker about it.
 *
 * NO BASELINE FILE, unlike the other five. This is a state check against the working tree, not a
 * ratchet against a recorded number, so there is nothing to record.
 *
 * Fail-open by design - any internal error, or any git that will not answer, exits 0 silently.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SCENARIO_DIR = 'tools/rig/scenarios';

function readStdin() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw && raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function markerPath(sessionId) {
  const safe = String(sessionId || 'nosession').replace(/[^A-Za-z0-9_-]/g, '');
  return path.join(os.tmpdir(), 'evermist-scenario-hint-' + safe + '.json');
}

// Relative, posix, or null when the edit landed outside this repo (a scratch file, another
// project). Resolved rather than string-matched, so a path with .. or a different drive letter
// case cannot smuggle itself in.
function repoRelative(filePath) {
  try {
    const rel = path.relative(ROOT, path.resolve(String(filePath)));
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return rel.replace(/\\/g, '/');
  } catch {
    return null;
  }
}

// Anything at all under tools/rig/scenarios/ showing in the working tree — modified, staged or
// untracked. --porcelain covers all three, which matters because a NEW scenario file is the
// normal shape of this work and is untracked until it is committed.
function scenarioTouched() {
  const r = spawnSync('git', ['status', '--porcelain', '--', SCENARIO_DIR],
                      { cwd: ROOT, encoding: 'utf8' });
  if (r.error || r.status !== 0 || typeof r.stdout !== 'string') return null;  // cannot tell
  return r.stdout.split(/\r?\n/).some(l => l.trim() !== '');
}

function main() {
  const payload = readStdin();
  const fp = payload && payload.tool_input && payload.tool_input.file_path;
  if (!fp) process.exit(0);

  const rel = repoRelative(fp);
  if (!rel || !rel.startsWith('src/')) process.exit(0);

  // Cannot tell -> stay quiet. A guard that guesses is worse than one that is silent.
  const touched = scenarioTouched();
  if (touched === null || touched === true) process.exit(0);

  const marker = markerPath(payload.session_id);
  if (fs.existsSync(marker)) process.exit(0);
  try {
    fs.writeFileSync(marker, JSON.stringify({ firedFor: rel }));
  } catch {
    process.exit(0);   // cannot mark -> would repeat every edit, so say nothing at all
  }

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext:
          'RIG HINT: ' + rel + ' is shipped code, and nothing under ' + SCENARIO_DIR + '/ has ' +
          'changed in this working tree.\n\n' +
          'If this change is a bug fix, reproduce the bug with a scenario BEFORE fixing it — ' +
          '`npm run rig -- <name>` is about ten seconds to a verdict. If it is a feature, its ' +
          'acceptance scenario is part of the build, not a follow-up, and it has to be seen RED ' +
          'once: break the line under it, confirm the FAIL names the right check, put the line ' +
          'back. A scenario written after the code has only ever seen green and proves nothing.\n\n' +
          'Nothing to add is a perfectly good answer — an existing scenario already covering it, ' +
          'a comment, or a mutation check being restored. This is said once per session either ' +
          'way. Rules: the `rig` skill.',
      },
    })
  );
  process.exit(0);
}

try {
  main();
} catch {
  process.exit(0);
}
