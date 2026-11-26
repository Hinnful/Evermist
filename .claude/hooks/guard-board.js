#!/usr/bin/env node
'use strict';

/*
 * Board guard - a mockup board is measured against the alignment rule before it is published, and a board with a
 * misaligned row is refused with the rows named, so the DM never sees that version.
 *
 * A board is a local .html page that links the app's own stylesheets (a `src/css/` href), published with the
 * Artifact tool's file_path. Any other page (a report, a plain document) passes unread: its prose was never laid out
 * by the rule, and the sweep floods on it. tools/board-check.js does the measuring, in a window that never shows.
 *
 * PreToolUse on Artifact; exit 2 is the only channel that reaches the model. Silent on a clean board. Fail-open: a
 * check that cannot run lets the publish through and says why.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { readStdin, ROOT } = require('./guard-lib');

// The board file a publish would send, or null when the call publishes no board.
function target(p) {
  const input = (p && p.tool_input) || {};
  if (p.tool_name !== 'Artifact' || (input.action && input.action !== 'publish')) return null;
  if (input.type_url || input.asset || !/\.html?$/i.test(String(input.file_path || ''))) return null;
  let html = '';
  try { html = fs.readFileSync(path.resolve(input.file_path), 'utf8'); } catch { return null; }
  return /<link\b[^>]*href=["'][^"']*src\/css\/[^"']*\.css/i.test(html) ? path.resolve(input.file_path) : null;
}

function main() {
  const file = target(readStdin());
  if (!file) process.exit(0);
  const run = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'board-check.js'), file], { encoding: 'utf8', timeout: 80000 });
  if (run.status === 0) process.exit(0);
  if (run.status === 1) {
    process.stderr.write('BOARD GUARD - refused: the board has rows that break design-system.md "Alignment".\n\n' + run.stdout.trim() +
      '\n\nFix each named row on the board, then publish again. Nothing reached the DM.\n');
    process.exit(2);
  }
  const why = run.error ? run.error.message : ((run.stdout || '') + (run.stderr || '')).trim() || 'exit ' + run.status;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse',
    additionalContext: 'Board guard: the alignment check could not run, so this board was published unchecked: ' + why } }));
  process.exit(0);
}

if (require.main === module) {
  try {
    main();
  } catch {
    process.exit(0);
  }
}

module.exports = { target };
