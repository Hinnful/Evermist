#!/usr/bin/env node
'use strict';

/*
 * Blob guard — keeps the inline <script> in index.html from growing again.
 *
 * WHY: CLAUDE.md's hard rule is "never add feature logic to the inline blob;
 * new concerns go in a src/ module." Prose alone doesn't stop a future session
 * under pressure. This is the teeth.
 *
 * WHAT: a PostToolUse hook (see .claude/settings.json). After any Edit/Write to
 * index.html it measures the LAST inline <script> region (the big trailing blob,
 * NOT the one-liner and NOT the <script src=...> tags) by non-blank line count.
 *
 *   - shrank or unchanged  -> pass, and ratchet the baseline DOWN so progress locks in
 *   - grew                 -> exit 2 with a message fed back to Claude, so it moves the
 *                             new JS into a module and re-does the edit in the same turn
 *
 * The count is scoped to the script region, so growing the HTML/CSS above it
 * (adding UI markup, styles) never trips this. Only JS creeping back does.
 *
 * Fail-open by design: any internal error exits 0. A broken guard must never
 * wedge the user's ability to edit.
 */

const fs = require('fs');
const path = require('path');

const INDEX = path.join(__dirname, '..', '..', 'index.html');
const BASELINE = path.join(__dirname, 'blob-baseline.json');

function readStdin() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw && raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// Count non-blank lines inside the last inline <script> ... </script> (no src attr).
function countBlobLines(html) {
  const open = html.lastIndexOf('<script>');
  if (open === -1) return null;
  const close = html.indexOf('</script>', open);
  if (close === -1) return null;
  return html
    .slice(open + '<script>'.length, close)
    .split(/\r?\n/)
    .filter(l => l.trim() !== '').length;
}

function readBaseline() {
  try {
    return JSON.parse(fs.readFileSync(BASELINE, 'utf8')).maxLines;
  } catch {
    return null;
  }
}

function writeBaseline(n) {
  try {
    fs.writeFileSync(
      BASELINE,
      JSON.stringify(
        {
          maxLines: n,
          note:
            'Max allowed non-blank lines in the index.html inline <script>. ' +
            'Auto-ratchets DOWN as the blob shrinks. If a growth is genuine ' +
            'wiring/init (rare, e.g. a new canvas DOM ref), bump this number.',
        },
        null,
        2
      ) + '\n'
    );
  } catch {
    /* fail-open */
  }
}

function main() {
  // Only care about edits to index.html. If the payload names another file, skip fast.
  const payload = readStdin();
  const fp = payload && payload.tool_input && payload.tool_input.file_path;
  if (fp && path.basename(String(fp).replace(/\\/g, '/')) !== 'index.html') {
    process.exit(0);
  }

  let html;
  try {
    html = fs.readFileSync(INDEX, 'utf8');
  } catch {
    process.exit(0); // no index.html reachable -> nothing to guard
  }

  const cur = countBlobLines(html);
  if (cur == null) process.exit(0); // couldn't locate the region -> don't interfere

  let baseline = readBaseline();
  if (baseline == null) {
    writeBaseline(cur); // first run: adopt current as the ceiling
    process.exit(0);
  }

  if (cur <= baseline) {
    if (cur < baseline) writeBaseline(cur); // ratchet down — lock in de-blobbing
    process.exit(0);
  }

  // Grew. Block with feedback so Claude corrects it this turn.
  process.stderr.write(
    'BLOB GUARD: the inline <script> in index.html grew from ' +
      baseline +
      ' to ' +
      cur +
      ' non-blank lines.\n' +
      'CLAUDE.md hard rule: new feature logic must live in a src/ module, not the ' +
      'inline blob (the blob is wiring/init only). Move the JS you just added into ' +
      'the right src/ module (or a new one) and redo the edit.\n' +
      'If this addition is genuinely wiring/init (rare — e.g. a new canvas DOM ref), ' +
      'raise "maxLines" to ' +
      cur +
      ' in .claude/hooks/blob-baseline.json.\n'
  );
  process.exit(2);
}

main();
