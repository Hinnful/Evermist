#!/usr/bin/env node
'use strict';

/*
 * End-of-release checklist. After ship.js pushed, a turn may not end until the CI monitor is armed
 * and the chat carries the release's Summary line as its title: both were prose in push.md and both
 * got skipped.
 *
 * Stop; exit 2 keeps the session working and feeds stderr to the model. After MAX_BLOCKS blocks for
 * the same push it lets go and says so, so a tool that cannot do its part never loops forever.
 * Fail-open on any internal error.
 */

const path = require('path');
const { readStdin, readJson, writeJson, ROOT } = require('./guard-lib');
const { runDir, sessionIds } = require('../commit/shipRules');

const MAX_BLOCKS = 3;

// What is still undone for a push, as a list of instructions; empty when the checklist is complete.
// `armed` and `renamed` are the markers' parsed JSON, or null when missing.
function remaining(pushed, armed, renamed) {
  if (!pushed || !pushed.time) return [];
  const since = Date.parse(pushed.time);
  const fresh = (m) => m && Date.parse(m.time) >= since;
  const todo = [];
  if (!fresh(armed)) todo.push('arm the CI monitor: mcp__ccd_pr__get_status then mcp__ccd_pr__set_monitor auto_fix true');
  if (!fresh(renamed) || renamed.text !== pushed.summary) {
    todo.push('rename the chat to: ' + pushed.summary + ' with mcp__ccd_session_mgmt__set_session_title (load it with ToolSearch first)');
  }
  return todo;
}

// 'block' keeps the session going, 'release' lets go after too many blocks, 'quiet' has nothing to say.
function decide(todo, blocksSoFar) {
  if (!todo.length) return 'quiet';
  return blocksSoFar >= MAX_BLOCKS ? 'release' : 'block';
}

function main() {
  const p = readStdin();
  for (const id of sessionIds(p, process.env)) {
    const dir = runDir(ROOT, id);
    const pushed = readJson(path.join(dir, 'pushed.json'), null);
    if (!pushed) continue;
    const todo = remaining(pushed, readJson(path.join(dir, 'monitor-armed'), null), readJson(path.join(dir, 'renamed'), null));
    const counter = path.join(dir, 'stop-blocks.json');
    const seen = readJson(counter, {});
    const blocks = seen.push === pushed.time + pushed.branch ? seen.count : 0;
    const what = decide(todo, blocks);
    if (what === 'quiet') return;
    if (what === 'release') {
      process.stdout.write(JSON.stringify({ systemMessage: 'Release checklist still open after ' + MAX_BLOCKS + ' reminders, so this stop was allowed: ' + todo.join('; ') }));
      return;
    }
    writeJson(counter, { push: pushed.time + pushed.branch, count: blocks + 1 });
    process.stderr.write('RELEASE CHECKLIST - ' + pushed.branch + ' is pushed, and the turn cannot end yet. Still to do:\n- ' + todo.join('\n- ') + '\n');
    process.exit(2);
  }
}

if (require.main === module) {
  try {
    main();
  } catch {
    process.exit(0);
  }
}

module.exports = { remaining, decide, MAX_BLOCKS };
