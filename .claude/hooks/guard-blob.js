#!/usr/bin/env node
'use strict';

/*
 * index.html guard — keeps the inline <script> from growing back, and keeps CSS
 * out of the head entirely.
 *
 * WHY: CLAUDE.md's hard rules are "never add feature logic to the inline blob;
 * new concerns go in a src/ module" and "index.html has no <style> block; CSS
 * lives in src/css/". Prose alone doesn't stop a future session under pressure.
 * This is the teeth.
 *
 * WHAT: a PostToolUse hook (see .claude/settings.json). After any Edit/Write to
 * index.html it enforces two rules:
 *
 *  1. SCRIPT — measures the LAST inline <script> region (the big trailing blob,
 *     NOT the one-liner and NOT the <script src=...> tags) by non-blank line count.
 *       - shrank or unchanged -> pass, and ratchet the baseline DOWN so progress locks in
 *       - grew                -> block, so the new JS moves into a module this turn
 *
 *  2. STYLE — fails if a <style> element appears BEFORE <body>. The 1366-line
 *     head stylesheet was split into src/css/*.css; a new one must not creep back.
 *     Scoped to the pre-<body> region on purpose: index.html is full of inline
 *     SVG, and an <svg> may legally carry its own <style>. The accepted tradeoff
 *     is that a <style> inside <body> isn't caught — this rule is about the head.
 *
 * Violations exit 2 with a message fed back to Claude so it corrects them in the
 * same turn. Both rules are reported together when both trip.
 *
 * The script count is scoped to the script region, so growing the HTML/UI above
 * it never trips rule 1. Only JS creeping back does.
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

// True if a <style> element appears before <body>. Deliberately NOT a whole-file
// check: the body is full of inline SVG, which may legally carry its own <style>.
function hasHeadStyle(html) {
  const bodyAt = html.search(/<body[\s>]/i);
  const head = bodyAt === -1 ? html : html.slice(0, bodyAt);
  return /<style[\s>]/i.test(head);
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

  const problems = [];

  // Rule 2: no <style> in the head.
  if (hasHeadStyle(html)) {
    problems.push(
      'STYLE GUARD: index.html has a <style> element before <body>.\n' +
        'CLAUDE.md hard rule: index.html carries no stylesheet — CSS lives in ' +
        'src/css/*.css, linked with <link rel="stylesheet">. Move the rules you ' +
        'just added into the src/css file that owns that concern (base, ' +
        'controlPanel, toolbar, roomCard, playerPane, legend, sceneManager, ' +
        'overlays) and redo the edit. A genuinely new concern gets a new file in ' +
        'src/css/ plus a <link> in the existing load order.\n'
    );
  }

  // Rule 1: the inline <script> only ever shrinks.
  const cur = countBlobLines(html);
  if (cur != null) {
    const baseline = readBaseline();
    if (baseline == null) {
      writeBaseline(cur); // first run: adopt current as the ceiling
    } else if (cur <= baseline) {
      if (cur < baseline) writeBaseline(cur); // ratchet down — lock in de-blobbing
    } else {
      problems.push(
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
    }
  }

  if (problems.length === 0) process.exit(0);

  // Block with feedback so Claude corrects it this turn.
  process.stderr.write(problems.join('\n'));
  process.exit(2);
}

main();
