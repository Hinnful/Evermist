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
};
