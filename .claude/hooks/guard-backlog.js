#!/usr/bin/env node
'use strict';

/*
 * Backlog hygiene guard — the backlog holds OPEN items only.
 *
 * WHY: the backlog reached 897 lines, most of it narrative about closed work,
 * and the damage was not untidiness. Two failures came out of it directly. A
 * proposal that was never asked for hardened into a blocker purely by being
 * carried forward across wrap cycles, and was then reported as the last gate on
 * a major version. And settled features kept reappearing as items, so the same
 * closed question got re-answered.
 *
 * The rule, in the user's words: keep the backlog to open tasks only, and remove
 * anything closed in any way until a problem is reported. Settled reasoning
 * belongs in docs/DECISIONS.md, which exists for exactly that and is already read
 * as a rejection filter.
 *
 * WHY A HOOK AND NOT A WRITTEN RULE: this repo has already run the experiment.
 * "Don't grow the inline blob" had a hook and held for months; "don't write
 * history in CLAUDE.md" had no hook and failed completely, which is the same
 * failure this file is about, one file over. A rule about a file that only an
 * agent writes needs a check at write time or it decays.
 *
 * Two rules:
 *
 *  1. NO CLOSED ITEMS — an item ("###" heading) whose heading or body carries a
 *     completion marker. This is the rule the user actually stated, and it is
 *     meant to be fixed in the turn that trips it: delete the item.
 *
 *     Deliberately scoped to items. Markers above the first "###" are untouched,
 *     because the file's header carries the 2.0.0 ingredient table, where the
 *     shipped entries ARE the live reference — they are how you read what is
 *     left. Ban them there and the bar becomes unreadable.
 *
 *     "DEFERRED", "PARKED" and "BLOCKED" are deliberately NOT markers. Those are
 *     open items with low priority or a missing input, confirmed by the user:
 *     they stay, and deleting them would lose real work.
 *
 *  2. SIZE — a line ceiling, warned once per crossing. Rule 1 cannot see the
 *     failure that actually cost the most, because the invented blocker carried
 *     no marker at all: it was a well-formed open item that should not have
 *     existed. Nothing can detect that automatically, so the backstop is total
 *     size, which is what makes the file worth re-reading in full.
 *
 * Exit 2 is used because it is the only channel that reaches the model. Fail-open
 * by design: any internal error exits 0. A broken guard must never wedge editing.
 */

const fs = require('fs');
const path = require('path');

const STATE = path.join(__dirname, 'backlog-baseline.json');
const TARGET = 'project-backlog.md';

const DEFAULTS = {
  maxLines: 450,
  reWarnEveryLines: 120,
  headBodyLines: 2,
};

/*
 * Word markers are matched case-sensitively on their upper-case form, because
 * that is how a status is written here and it keeps ordinary prose ("the fix is
 * done in one line") from tripping the guard.
 */
const WORD_MARKERS = [
  'SHIPPED',
  'DONE',
  'CLOSED',
  'REVERTED',
  'DEPRECATED',
  'FIXED',
  'COMPLETE',
  'DO NOT RE-FILE',
];

const NOTE =
  'Thresholds for the backlog hygiene guard. The backlog holds OPEN items only; ' +
  'anything closed belongs in docs/DECISIONS.md or nowhere. "warnedLines" records ' +
  'the size already reported so the notice fires once and never nags; clear it to ' +
  'hear about size again.';

function readStdin() {
  try {
    // Strip a leading BOM: JSON.parse throws on one, and a shell that adds it
    // would silently turn this guard into a no-op.
    const raw = fs.readFileSync(0, 'utf8').replace(/^﻿/, '');
    return raw && raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    return {
      config: Object.assign({}, DEFAULTS, s.config || {}),
      warnedLines: typeof s.warnedLines === 'number' ? s.warnedLines : 0,
    };
  } catch {
    return { config: Object.assign({}, DEFAULTS), warnedLines: 0 };
  }
}

function writeState(state) {
  try {
    fs.writeFileSync(
      STATE,
      JSON.stringify(
        { config: state.config, note: NOTE, warnedLines: state.warnedLines },
        null,
        2
      ) + '\n'
    );
  } catch {
    /* fail-open */
  }
}

function isGuarded(fp) {
  try {
    return path.basename(String(fp)).toLowerCase() === TARGET;
  } catch {
    return false;
  }
}

/*
 * Which markers does one line carry? Struck-through text counts on its own: a
 * "~~item~~ superseded" line is the exact shape the old file bloated with.
 */
function markersIn(line) {
  const hits = [];
  if (line.indexOf('✅') !== -1) hits.push('✅');
  if (/~~[^~]+~~/.test(line)) hits.push('~~struck-through text~~');
  for (const m of WORD_MARKERS) {
    if (line.indexOf(m) !== -1) hits.push(m);
  }
  return hits;
}

/*
 * Attribute lines to their "###" item and report the ones that read as closed.
 *
 * Two scoping decisions, both learned by getting them wrong first:
 *
 * ONLY THE TOP OF AN ITEM IS ITS STATUS. A closed item announces itself in the
 * heading or the line under it. A marker deeper in the body is almost always a
 * cross-reference warning — "the obvious fix is already REVERTED, there is a
 * comment saying not to re-add it" — which is the most valuable sentence in an
 * open item and must survive. Scanning whole bodies flagged exactly that and
 * would have had a live item deleted, so the check stops after headBodyLines
 * non-blank lines.
 *
 * AN ITEM ENDS AT ANY HEADING, not just the next "###". The last item otherwise
 * swallows every trailing section to the end of the file, and inherits their
 * markers.
 */
function findClosedItems(text, headBodyLines) {
  const lines = text.split(/\r?\n/);
  const closed = [];
  let item = null;
  let bodySeen = 0;

  for (const line of lines) {
    if (/^###\s+/.test(line)) {
      item = { name: line.replace(/^###\s+/, '').trim(), hits: [] };
      bodySeen = 0;
      closed.push(item);
      for (const h of markersIn(line)) {
        if (item.hits.indexOf(h) === -1) item.hits.push(h);
      }
      continue;
    }
    if (/^#{1,2}\s+/.test(line)) {
      item = null; // a new section closes the previous item
      continue;
    }
    if (!item) continue; // header, or between sections
    if (line.trim() === '') continue;
    if (bodySeen >= headBodyLines) continue;
    bodySeen += 1;
    for (const h of markersIn(line)) {
      if (item.hits.indexOf(h) === -1) item.hits.push(h);
    }
  }

  return closed.filter((i) => i.hits.length > 0);
}

function main() {
  const payload = readStdin();
  const fp = payload && payload.tool_input && payload.tool_input.file_path;
  if (!fp || !isGuarded(fp)) process.exit(0);

  let text;
  try {
    text = fs.readFileSync(String(fp), 'utf8');
  } catch {
    process.exit(0); // unreadable -> nothing to guard
  }

  const state = readState();
  const cfg = state.config;
  const notices = [];

  // Rule 1 — closed items. Fix in this turn.
  const closed = findClosedItems(text, cfg.headBodyLines);
  if (closed.length > 0) {
    const list = closed
      .map((i) => '  - "' + i.name + '" carries ' + i.hits.join(', '))
      .join('\n');
    notices.push(
      'BACKLOG GUARD — fix this in the current turn.\n\n' +
        closed.length +
        (closed.length === 1 ? ' item reads as closed:\n' : ' items read as closed:\n') +
        list +
        '\n\nThe backlog holds OPEN items only — work someone could pick up and do ' +
        'today. Anything already decided, shipped or refused goes to ' +
        'docs/DECISIONS.md, which is read as a rejection filter before anything is ' +
        'proposed, or it goes nowhere.\n\n' +
        'THE FIX IS TO DELETE THE ITEM, not to reword the marker. If the reasoning ' +
        'is worth keeping, move it to DECISIONS.md as one entry first.\n\n' +
        'Low priority is NOT closed. An item the user simply has not picked yet, ' +
        'or one waiting on a file from them, is open and stays — do not delete ' +
        'those, and do not mark them.\n'
    );
  }

  // Rule 2 — total size. A notice, once per crossing.
  const lineCount = text.split(/\r?\n/).length;
  const sizeTrigger = state.warnedLines
    ? state.warnedLines + cfg.reWarnEveryLines
    : cfg.maxLines;
  if (lineCount > sizeTrigger) {
    state.warnedLines = lineCount;
    notices.push(
      'BACKLOG NOTICE — your edit is correct. Do NOT revert it, and do NOT ' +
        'restructure the file in this turn.\n\n' +
        'The backlog is at ' +
        lineCount +
        ' lines (ceiling ' +
        cfg.maxLines +
        ').\nIt reached 897 once, and the cost was not untidiness: a proposal ' +
        'nobody had asked for survived in it long enough to be reported as the ' +
        'last blocker on a major version, because nothing that long gets re-read ' +
        'whole.\n\n' +
        'No marker can catch that — a bad item is well-formed. The only remedy is ' +
        'the user reading the list. Report the size and offer a triage pass; let ' +
        'them decide what goes. To move the ceiling, edit config.maxLines in ' +
        '.claude/hooks/backlog-baseline.json.\n'
    );
  }

  writeState(state);

  if (notices.length === 0) process.exit(0);

  process.stderr.write(notices.join('\n'));
  process.exit(2);
}

main();
