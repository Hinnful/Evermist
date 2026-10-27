'use strict';

// check-notes.js - refuses release notes that break a rule a machine can check.
// Usage: node .claude/commit/check-notes.js [notes-file]   (default: this session's runs/<id>/notes.txt)
// The privacy rules in notes.md are not checkable here; the session still owns them.

const fs = require('fs');
const path = require('path');

const RULES = path.join(__dirname, 'notes.md');
const file = process.argv[2] || path.join(__dirname, 'runs', process.env.CLAUDE_CODE_SESSION_ID || 'local', 'notes.txt');

const block = fs.readFileSync(RULES, 'utf8').replace(/\r/g, '').match(/```filler-words\n([\s\S]*?)```/);
if (!block) {
  console.error(`check-notes: no filler-words block in ${RULES}`);
  process.exit(2);
}
const filler = block[1].split('\n').map(s => s.trim()).filter(Boolean);
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fillerRe = new RegExp(`\\b(${filler.map(escape).join('|')})\\b`, 'gi');

const lines = fs.readFileSync(file, 'utf8').replace(/\r/g, '').trim().split('\n');
const summary = lines[0] || '';
const description = lines.slice(1).filter(l => l.trim());
const faults = [];

if (!summary.trim()) faults.push('line 1: no Summary');
if (summary.length > 70) faults.push(`line 1: Summary is ${summary.length} characters, limit 70`);
if (description.length > 8) faults.push(`Description is ${description.length} lines, limit 8: an intro and 7 points`);
// An intro sentence, then "* " points: the What's new panel draws the intro above a list.
if (description[0] && description[0].startsWith('* ')) faults.push('line 2: the first Description line is the intro sentence, not a point');
description.slice(1).forEach(l => { if (!l.startsWith('* ')) faults.push(`a line after the intro is not a "* " point: ${l}`); });
lines.forEach((l, i) => {
  if (/[—–]/.test(l)) faults.push(`line ${i + 1}: em-dash or en-dash, use " - ": ${l}`);
  if (/\bClaude\b/i.test(l)) faults.push(`line ${i + 1}: "Claude", say "AI assistant": ${l}`);
  for (const m of l.matchAll(fillerRe)) faults.push(`line ${i + 1}: filler "${m[1]}": ${l}`);
});

if (faults.length) {
  console.error(`check-notes: ${faults.length} fault(s) in ${file}\n  ` + faults.join('\n  '));
  process.exit(1);
}
