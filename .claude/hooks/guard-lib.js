#!/usr/bin/env node
'use strict';

/*
 * Shared helpers for the doc guards. Plain CommonJS require - the "no ES modules"
 * rule is about the browser app on file://, not about these Node hooks.
 *
 * Everything here is fail-safe rather than fail-loud: a helper that cannot answer
 * returns the empty result, so a caller's worst case is a guard that stays quiet.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function readStdin() {
  try {
    // Strip a leading BOM: JSON.parse throws on one, and a shell that adds it
    // would silently turn the calling guard into a no-op.
    const raw = fs.readFileSync(0, 'utf8').replace(/^﻿/, '');
    return raw && raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// Repo-relative, forward-slashed. Null if the path escapes the repo, which is how
// a guard tells an in-repo doc from a private file in the memory dir.
function toRel(fp) {
  try {
    const rel = path.relative(ROOT, path.resolve(String(fp)));
    if (!rel || rel.startsWith('..')) return null;
    return rel.replace(/\\/g, '/');
  } catch {
    return null;
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  try {
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
  } catch {
    /* fail-open */
  }
}

function fmt(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/*
 * Attribute every line to its "##" section and "###" entry.
 *
 * Content before the first "##" is the file's preamble, not a topic, so it is
 * excluded from the distribution rule - otherwise the header skews the share of
 * every real section. The denominator stays the whole file, because that is the
 * real reading cost.
 *
 * Entries carry their line numbers so a content check can name a location.
 */
function analyze(text) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  const entries = [];
  let sec = null;
  let ent = null;

  lines.forEach((line, i) => {
    const bytes = Buffer.byteLength(line) + 1;

    if (/^##\s+/.test(line)) {
      sec = { name: line.replace(/^##\s+/, '').trim(), bytes: 0 };
      sections.push(sec);
      ent = null;
      return;
    }
    if (/^###\s+/.test(line)) {
      ent = {
        name: line.replace(/^###\s+/, '').trim(),
        heading: line,
        line: i + 1,
        lines: 0,
        body: [],
      };
      entries.push(ent);
      if (sec) sec.bytes += bytes;
      return;
    }

    if (sec) sec.bytes += bytes;
    if (ent) {
      if (line.trim() !== '') ent.lines += 1;
      ent.body.push({ text: line, line: i + 1 });
    }
  });

  return { bytes: Buffer.byteLength(text), lineCount: lines.length, sections, entries };
}

/*
 * Person references in a public doc.
 *
 * Scoped to entry bodies and headings on purpose: a file's own preamble states the
 * rule by quoting the banned phrases ('no "he/she said"'), and scanning it would
 * make every guarded file fire on its own instructions.
 *
 * "the user" is deliberately NOT a marker. It has a legitimate technical sense -
 * "the user's maps", "have the user do a manual step" - and banning it produced
 * only false positives. Third-person pronouns and first-person judgement verbs are
 * what actually indicate a chat log leaking in.
 */
const PERSON_RE =
  /(^|[^A-Za-z0-9])(he|his|him|she|her|hers)([^A-Za-z0-9]|$)|\b(I|we)\s+(recommend|recommended|judged|decided|agreed|chose|think|thought|proposed|suggested)\b/i;

function findPersonRefs(entries) {
  const hits = [];
  for (const e of entries) {
    const lines = [{ text: e.heading, line: e.line }].concat(e.body);
    for (const l of lines) {
      if (PERSON_RE.test(l.text)) hits.push({ entry: e.name, line: l.line, text: l.text.trim() });
    }
  }
  return hits;
}

/*
 * Whole-file variant, for a doc that is prose rather than tagged entries and so
 * carries no preamble quoting the banned phrases.
 */
function findPersonRefsInText(text) {
  const hits = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (PERSON_RE.test(line)) hits.push({ entry: null, line: i + 1, text: line.trim() });
  });
  return hits;
}

/*
 * An entry with no status tag. The tag is what makes the file a lookup table: it
 * says whether a reader is looking at the current shape or at something already
 * killed. An untagged entry reads as prose and gets skimmed past.
 */
function findUntagged(entries, tags) {
  return entries.filter((e) => !tags.some((t) => e.heading.indexOf('`' + t + '`') !== -1));
}

/*
 * Past-tense narrative in a file that is supposed to be imperative present tense.
 *
 * The markers are deliberately few and high-signal. Broader ones were considered and
 * left out because they have honest uses in a rule: "no longer" and "previously" both
 * describe current behaviour, and "used to" appears inside a live migration rule.
 * A guard that cries wolf gets ignored, which costs more than the cases it catches.
 */
const NARRATIVE_RE =
  /\d{4}-\d{2}-\d{2}|\b(?:originally|an earlier version|(?:was|were)\s+(?:rejected|tried))\b/i;

/*
 * Scans "##" sections only, skipping any named in skipSections and any fenced block.
 *
 * Content before the first "##" is skipped for the same reason guard-ledger skips a
 * ledger preamble: that is where a file states which mood belongs where, and it has to
 * quote past-tense phrasing to route it away. A fence is code, not prose.
 *
 * Lines are tested singly AND joined with the line after, because these files are hard
 * wrapped at ~90 chars and a three-word marker straddles a break often enough to matter.
 * The reported line is where the marker starts.
 */
function findNarrative(text, skipSections) {
  const skip = (skipSections || []).map((s) => s.toLowerCase());
  const lines = text.split(/\r?\n/);
  const hits = [];
  let inSection = false;
  let fenced = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;

    if (/^##\s+/.test(line)) {
      inSection = skip.indexOf(line.replace(/^##\s+/, '').trim().toLowerCase()) === -1;
      continue;
    }
    if (!inSection) continue;

    const own = line.match(NARRATIVE_RE);
    if (own) {
      hits.push({ line: i + 1, marker: own[0], text: line.trim() });
      continue;
    }

    // Nothing on this line, so try the wrap. The join is only reported when the NEXT
    // line is clean on its own - otherwise the marker sits wholly on that line and
    // reporting here would name the wrong one and count it twice.
    const next = lines[i + 1] === undefined || /^(?:#{2,3}\s+|```)/.test(lines[i + 1]) ? '' : lines[i + 1];
    if (!next || NARRATIVE_RE.test(next)) continue;
    const m = (line + ' ' + next).match(NARRATIVE_RE);
    if (m) hits.push({ line: i + 1, marker: m[0], text: line.trim() });
  }
  return hits;
}

/*
 * Shipped JavaScript: the exact set `package.json` build.files carries, minus the
 * vendored `lib/pixi.min.js`. A comment figure that counted a minified library
 * would measure the library.
 */
function shippedJs() {
  const out = [];
  for (const f of ['main.js', 'preload.js']) {
    if (fs.existsSync(path.join(ROOT, f))) out.push(f);
  }
  const walk = (dir) => {
    let items;
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of items) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) out.push(path.relative(ROOT, p).replace(/\\/g, '/'));
    }
  };
  walk(path.join(ROOT, 'src'));
  return out;
}

/*
 * Classify every line as 'code', 'comment' or 'blank'.
 *
 * A line carrying code AND a trailing comment counts as CODE, so trailing notes stay
 * free and the figure measures the comments that occupy a line of their own.
 * Quotes are tracked because a string may hold "//" or "/*", which would otherwise
 * flip block state and mis-count the rest of the file.
 */
function classifyLines(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let block = false;

  for (const line of lines) {
    let i = 0;
    let sawCode = false;
    let sawComment = false;
    let quote = null;

    while (i < line.length) {
      const c = line[i];
      const d = line[i + 1];

      if (block) {
        sawComment = true;
        if (c === '*' && d === '/') {
          block = false;
          i += 2;
          continue;
        }
        i++;
        continue;
      }
      if (quote) {
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === quote) quote = null;
        sawCode = true;
        i++;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        quote = c;
        sawCode = true;
        i++;
        continue;
      }
      if (c === '/' && d === '/') {
        sawComment = true;
        break;
      }
      if (c === '/' && d === '*') {
        block = true;
        sawComment = true;
        i += 2;
        continue;
      }
      if (!/\s/.test(c)) sawCode = true;
      i++;
    }

    // A template literal spanning lines would otherwise leak its state; treating each
    // line as self-contained can only under-count, never invent a comment.
    quote = null;
    out.push(sawCode ? 'code' : sawComment ? 'comment' : 'blank');
  }
  return out;
}

/*
 * Codebase-wide comment share, plus the per-file breakdown a report needs.
 * Blank lines sit outside both sides of the ratio.
 */
function commentStats(files) {
  const perFile = [];
  let comments = 0;
  let code = 0;

  for (const rel of files || shippedJs()) {
    let text;
    try {
      text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    } catch {
      continue;
    }
    const kinds = classifyLines(text);
    const c = kinds.filter((k) => k === 'comment').length;
    const k = kinds.filter((k2) => k2 === 'code').length;
    comments += c;
    code += k;
    perFile.push({ file: rel, comments: c, code: k, pct: k + c === 0 ? 0 : (100 * c) / (k + c) });
  }

  const total = comments + code;
  return { comments, code, pct: total === 0 ? 0 : (100 * comments) / total, perFile };
}

/* Strip comments and blank lines, leaving the code a diff can compare verbatim. */
function pureCode(text) {
  const lines = text.split(/\r?\n/);
  const kinds = classifyLines(text);
  return lines.filter((_, i) => kinds[i] === 'code').join('\n');
}

module.exports = {
  ROOT,
  readStdin,
  toRel,
  readJson,
  writeJson,
  fmt,
  analyze,
  findPersonRefs,
  findPersonRefsInText,
  findUntagged,
  findNarrative,
  shippedJs,
  classifyLines,
  commentStats,
  pureCode,
};
