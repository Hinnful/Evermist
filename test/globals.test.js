'use strict';

// The browser scripts share one global scope, and eslint's no-redeclare is off so they can, which
// leaves two rules unchecked by lint: a name declared twice silently takes the later copy, and
// shared mutable state has one home, src/state.js (CLAUDE.md).

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const espree = require('espree');
// eslint's own scope analyser, installed with eslint.
const eslintScope = require('eslint-scope');
const ALLOW = require('./globals.allow.json');

const ROOT = path.join(__dirname, '..');
const PAGES = ['index.html', 'stage.html', 'splash.html'];
const STATE = 'src/state.js';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const parse = (text) => espree.parse(text, { ecmaVersion: 'latest', sourceType: 'script', range: true });

function walk(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = dir + '/' + e.name;
    return e.isDirectory() ? walk(rel) : e.name.endsWith('.js') ? [rel] : [];
  });
}

function pageScripts(page) {
  return [...read(page).matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1])
    .filter((s) => s.startsWith('src/') && s.endsWith('.js'));
}

function bound(pattern, out) {
  if (!pattern) return out;
  if (pattern.type === 'Identifier') out.push(pattern.name);
  else if (pattern.type === 'ObjectPattern') pattern.properties.forEach((p) => bound(p.value || p.argument, out));
  else if (pattern.type === 'ArrayPattern') pattern.elements.forEach((e) => bound(e, out));
  else if (pattern.type === 'RestElement') bound(pattern.argument, out);
  else if (pattern.type === 'AssignmentPattern') bound(pattern.left, out);
  return out;
}

// Every top-level declaration as { name, kind }. `var { a } = typeof module !== 'undefined' ?
// require(...) : window` redeclares a global on purpose so the file also loads in Node; it is skipped.
function topLevel(text, ast) {
  const out = [];
  for (const n of ast.body) {
    if (n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') {
      out.push({ name: n.id.name, kind: n.type === 'FunctionDeclaration' ? 'function' : 'class' });
    } else if (n.type === 'VariableDeclaration') {
      for (const d of n.declarations) {
        const init = d.init ? text.slice(d.init.range[0], d.init.range[1]) : '';
        if (/typeof module\b/.test(init) && /\brequire\(/.test(init)) continue;
        for (const name of bound(d.id, [])) out.push({ name, kind: n.kind });
      }
    }
  }
  return out;
}

const parsed = new Map();
function load(rel) {
  if (!parsed.has(rel)) {
    const text = read(rel);
    parsed.set(rel, { text, ast: parse(text) });
  }
  return parsed.get(rel);
}

// The names declared twice in one file.
function duplicatesIn(rel) {
  const { text, ast } = load(rel);
  const seen = new Map();
  for (const { name } of topLevel(text, ast)) seen.set(name, (seen.get(name) || 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([name, n]) => rel + ' declares ' + name + ' ' + n + ' times');
}

// The function names declared in two scripts one page loads.
function crossFileFunctions(page) {
  const owners = new Map();
  for (const rel of pageScripts(page)) {
    const { text, ast } = load(rel);
    for (const { name, kind } of topLevel(text, ast)) {
      if (kind !== 'function') continue;
      if (!owners.has(name)) owners.set(name, new Set());
      owners.get(name).add(rel);
    }
  }
  return [...owners].filter(([, s]) => s.size > 1)
    .map(([name, s]) => page + ' loads ' + name + ' from ' + [...s].join(' and '));
}

// Every module-level `let` outside src/state.js that another script on the same page writes:
// a Map of "file" -> Map of name -> Set of writing files.
function crossFileWrites() {
  const found = new Map();
  for (const page of PAGES) {
    const scripts = pageScripts(page);
    const owner = new Map();
    for (const rel of scripts) {
      if (rel === STATE) continue;
      for (const n of load(rel).ast.body) {
        if (n.type !== 'VariableDeclaration' || n.kind !== 'let') continue;
        for (const d of n.declarations) for (const name of bound(d.id, [])) owner.set(name, rel);
      }
    }
    for (const rel of scripts) {
      const scope = eslintScope.analyze(load(rel).ast, { ecmaVersion: 2022, sourceType: 'script' });
      for (const ref of scope.globalScope.through) {
        const name = ref.identifier.name;
        const home = owner.get(name);
        if (!ref.isWrite() || !home || home === rel) continue;
        if (!found.has(home)) found.set(home, new Map());
        if (!found.get(home).has(name)) found.get(home).set(name, new Set());
        found.get(home).get(name).add(rel);
      }
    }
  }
  return found;
}

describe('house rules: global declarations', () => {
  it('declares no top-level name twice in one file', () => {
    const faults = [...walk('src'), ...walk('electron')].flatMap(duplicatesIn);
    assert.deepEqual(faults, [],
      'the later declaration silently wins and the earlier one is dead code. Keep the copy that runs ' +
      '(the last one) and delete the other:\n' + faults.join('\n'));
  });

  for (const page of PAGES) {
    it('declares no function twice across the scripts ' + page + ' loads', () => {
      const faults = crossFileFunctions(page);
      assert.deepEqual(faults, [],
        'the script loaded later silently replaces the other. Rename one, or keep one copy in the ' +
        'module that owns it:\n' + faults.join('\n'));
    });
  }
});

describe('house rules: shared state lives in src/state.js', () => {
  const found = crossFileWrites();

  it('writes no module-level let from another file unless allowlisted', () => {
    const faults = [];
    for (const [home, names] of found) {
      for (const [name, writers] of names) {
        if ((ALLOW[home] || []).includes(name)) continue;
        faults.push(home + ': ' + name + ' is written from ' + [...writers].join(', '));
      }
    }
    assert.deepEqual(faults, [],
      'shared mutable state has one home. Move the binding to src/state.js; only when the DM agreed ' +
      'to keep it where it is, add it to test/globals.allow.json under its file:\n' + faults.join('\n'));
  });

  it('allowlists only names that are still written from another file', () => {
    const stale = [];
    for (const [home, names] of Object.entries(ALLOW)) {
      for (const name of names) if (!(found.get(home) && found.get(home).has(name))) stale.push(home + ': ' + name);
    }
    assert.deepEqual(stale, [],
      'these are no longer written from another file. Delete their entries in test/globals.allow.json, ' +
      'which may only shrink:\n' + stale.join('\n'));
  });
});
