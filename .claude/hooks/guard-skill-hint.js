#!/usr/bin/env node
'use strict';

/*
 * Skill trigger for the rule clusters that were moved out of CLAUDE.md.
 *
 * WHY: a pointer in CLAUDE.md is not a trigger - a link only fires if someone is
 * already reading that section, which is how ARCHITECTURE.md drifted seven modules
 * stale. Rules that left CLAUDE.md need something that fires on its own. This maps
 * the file about to be edited to the skill that owns its rules, and hands Claude a
 * line saying to load it.
 *
 * Non-blocking by design: `additionalContext` reaches the model on the next request
 * without denying the tool call, so a bad match costs one line, never a wedged edit.
 * Fires once per skill per session; the marker is keyed by session_id.
 *
 * Fail-open by design - any internal error exits 0 silently.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// basename -> skill slug. fog.js is here for half-shroud, main.js for the pdfjs
// asar resolution; neither is a DM-UI or module-text file by name.
const OWNERS = {
  'roompanel.js': 'dm-ui',
  'controlpanel.js': 'dm-ui',
  'toolbar.js': 'dm-ui',
  'toolbar.css': 'dm-ui',
  'fog.js': 'dm-ui',
  'moduletext.js': 'module-text',
  'pdflayout.js': 'module-text',
  'pdfextract.js': 'module-text',
  'main.js': 'module-text',
  'vttplan.js': 'floor-plan',
  'floorplan.js': 'floor-plan',
};

const BLURB = {
  'dm-ui':
    'room card layout and placement, room labels, half-shroud, and toolbar/control-panel button identity',
  'module-text':
    'module parsing, the heading/sub-location rules, PDF extraction, packaging traps, and the import panel',
  'floor-plan':
    'the UVTT coordinate convention, winding-not-area classification, and what the import refuses to do',
};

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
  return path.join(os.tmpdir(), 'evermist-skill-hint-' + safe + '.json');
}

function alreadyFired(file, slug) {
  try {
    const fired = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(fired) && fired.indexOf(slug) !== -1;
  } catch {
    return false;
  }
}

function markFired(file, slug) {
  try {
    let fired = [];
    try {
      const prev = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(prev)) fired = prev;
    } catch {
      /* first hit this session */
    }
    fired.push(slug);
    fs.writeFileSync(file, JSON.stringify(fired));
  } catch {
    /* fail-open: worst case the hint repeats */
  }
}

function main() {
  const payload = readStdin();
  const fp = payload && payload.tool_input && payload.tool_input.file_path;
  if (!fp) process.exit(0);

  const base = path.basename(String(fp).replace(/\\/g, '/')).toLowerCase();
  const slug = OWNERS[base];
  if (!slug) process.exit(0);

  const marker = markerPath(payload.session_id);
  if (alreadyFired(marker, slug)) process.exit(0);
  markFired(marker, slug);

  const msg =
    'SKILL HINT: ' +
    path.basename(String(fp).replace(/\\/g, '/')) +
    ' is governed by rules that live in the `' +
    slug +
    '` skill, not in CLAUDE.md. Load it with the Skill tool before editing - it ' +
    'carries the binding rules for ' +
    (BLURB[slug] || 'this file') +
    '. If you have already read it this session, ignore this.';

  // stderr reaches the transcript on a non-blocking error path; stdout is what the
  // model actually sees. Only the JSON is authoritative.
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'defer',
        additionalContext: msg,
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
