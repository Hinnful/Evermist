#!/usr/bin/env node
'use strict';

/*
 * Leaves the two markers the Stop hook looks for after a release: the CI monitor was armed, and the
 * chat was renamed (with the title it got).
 *
 * PostToolUse on set_monitor and set_session_title; fail-open on any internal error.
 */

const fs = require('fs');
const path = require('path');
const { readStdin, ROOT } = require('./guard-lib');
const { runDir, sessionIds } = require('../commit/shipRules');

// Which marker a finished tool call leaves, or null. Arming the monitor off means nothing was armed.
function markerFor(tool, input) {
  if (/set_monitor$/.test(tool || '')) return input && input.auto_fix === true ? { file: 'monitor-armed', text: 'armed' } : null;
  if (/set_session_title$/.test(tool || '')) return input && typeof input.title === 'string' ? { file: 'renamed', text: input.title } : null;
  return null;
}

function main() {
  const p = readStdin();
  const m = markerFor(p.tool_name, p.tool_input);
  if (!m) return;
  const stamp = JSON.stringify({ time: new Date().toISOString(), text: m.text });
  for (const id of sessionIds(p, process.env)) {
    fs.mkdirSync(runDir(ROOT, id), { recursive: true });
    fs.writeFileSync(path.join(runDir(ROOT, id), m.file), stamp + '\n');
  }
}

if (require.main === module) {
  try {
    main();
  } catch {
    process.exit(0);
  }
}

module.exports = { markerFor };
