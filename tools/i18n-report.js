'use strict';

// i18n-report.js — English interface text with no Russian entry in src/i18n/ru.js, sentences
// still glued from pieces, and Russian entries nothing uses any more. The first two fail
// test/i18nGaps.test.js, and so the release; the CLI always exits 0. The scan reads source text,
// so it can list a string that never reaches the screen.
//
//   node tools/i18n-report.js           the lists
//   node tools/i18n-report.js --json    the missing keys as JSON

const fs = require('fs');
const path = require('path');
const { i18nKey } = require('../src/i18n/i18nPlan');

const ROOT = path.join(__dirname, '..');

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', mdash: '—',
  ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', times: '×', larr: '←',
  rarr: '→', uarr: '↑', darr: '↓', deg: '°', bull: '•', copy: '©', minus: '−' };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(/^#x/i.test(e) ? parseInt(e.slice(2), 16) : +e.slice(1))
               : (ENT[e] !== undefined ? ENT[e] : m));
const ESC = { n: '\n', t: '\t', r: '' };
const unescapeJs = s => s.replace(/\\(u\{[0-9a-f]+\}|u[0-9a-f]{4}|x[0-9a-f]{2}|.)/gi, (m, e) =>
  /^[ux]./i.test(e) && e.length > 1 ? String.fromCodePoint(parseInt(e.replace(/[ux{}]/gi, ''), 16))
                                    : (ESC[e] !== undefined ? ESC[e] : e));

// Words a DM reads, not identifiers, selectors, paths or markup.
const PROSE = s => /[A-Za-z]{2}/.test(s) && !/[{}=;<>\\#"]|^\W|\.(js|css|html|png|webm|mp4|zip|json)\b|^[a-z]+[A-Z]\w*$|^[a-z_]+$/.test(s) &&
  !/^[a-z0-9 ]*-[a-z0-9 -]*$|^(Key[A-Z]|Digit\d|Bracket|Slash|Escape|Enter|Arrow)|^use strict$|\d(px|s|deg)\b|\b(px|deg)\b|rgba?\(|system-ui|monospace|gradient\(|forwards/.test(s) &&
  (/\s/.test(s.trim()) || /^[A-Z][a-z]/.test(s));
const QUIET = /document\.title|giveUp\(|new Error\(|console\.|_diag|diagLog|_mpLog|stressLog|throw new|require\(|querySelector|getElementById|closest\(|classList|addEventListener|dataset\.|\.code ===|\.key ===|postMessage|localStorage|sessionStorage|type: '|new RegExp|\.test\(|\.match\(|\.replace\(|\bmode: '|kind: '|mimeType|extensions: \[/;

// Keys, units and names that read the same in Russian.
const SAME = /^(English|[A-Z]|(Ctrl|Shift) [A-Z]|Ctrl\+D|Del|Esc|px|1080p|2K|4K|Evermist|EVERMIST|github\.com\/\S+)$/;

const found = new Map();                 // key → first place it was seen
const plural = new Map();
const glued = [];
const literals = new Set();
const add = (raw, where) => {
  if (raw.includes('${')) return;
  const k = i18nKey(raw);
  if (k && /[A-Za-z]/.test(k) && !SAME.test(k) && !found.has(k)) found.set(k, where);
};

function scanHtml(html, where) {
  html = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, '');
  for (const m of html.matchAll(/\b(?:title|placeholder|aria-label)\s*=\s*(["'])(.*?)\1/g)) add(decode(m[2]), where);
  for (const chunk of html.replace(/<[^>]*>/g, '\u0000').split('\u0000')) if (!/[<>"=`]/.test(chunk)) add(decode(chunk), where);
}


// 'a ' + 'b' is one sentence on screen, so the scan reads it as one.
function joinLiterals(code) {
  const pair = /(['"])((?:\\.|(?!\1)[^\\\n])*)\1\s*\+\s*\n?\s*(['"])((?:\\.|(?!\3)[^\\\n])*)\3/;
  for (let m; (m = code.match(pair));) {
    const v = (unescapeJs(m[2]) + unescapeJs(m[4])).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
    code = code.slice(0, m.index) + "'" + v + "'" + code.slice(m.index + m[0].length);
  }
  return code;
}

// Every string and template in the file, templates nested inside ${} included, with where each
// starts. Regex literals are stepped over so a quote inside one does not open a string.
function literalsOf(code) {
  const out = [];
  let i = 0;
  const regexOk = () => { let j = i - 1; while (j >= 0 && /\s/.test(code[j])) j--; return j < 0 || /[(,=:[!&|?{};+\-*%<>~^]/.test(code[j]) || /\breturn$/.test(code.slice(Math.max(0, j - 5), j + 1)); };
  function str(q) {
    const start = i++;
    while (i < code.length && code[i] !== q && code[i] !== '\n') i += code[i] === '\\' ? 2 : 1;
    out.push({ start, index: start, tpl: false, raw: code.slice(start + 1, i) });
    i++;
  }
  function tpl() {
    const start = i++;
    let raw = '';
    while (i < code.length && code[i] !== '`') {
      if (code[i] === '\\') { raw += code.slice(i, i + 2); i += 2; continue; }
      if (code[i] === '$' && code[i + 1] === '{') { const from = i; i += 2; expr(); raw += code.slice(from, i); continue; }
      raw += code[i++];
    }
    i++;
    out.push({ start, index: start, tpl: true, raw });
  }
  function expr() {
    for (let depth = 1; i < code.length;) {
      const c = code[i];
      if (c === "'" || c === '"') str(c);
      else if (c === '`') tpl();
      else if (c === '{') { depth++; i++; }
      else if (c === '}') { i++; if (!--depth) return; }
      else i++;
    }
  }
  while (i < code.length) {
    const c = code[i];
    if (c === "'" || c === '"') str(c);
    else if (c === '`') tpl();
    else if (c === '/' && regexOk()) {
      i++;
      for (let cls = false; i < code.length && code[i] !== '\n' && (cls || code[i] !== '/'); i++) {
        if (code[i] === '\\') i++; else if (code[i] === '[') cls = true; else if (code[i] === ']') cls = false;
      }
      i++;
    } else i++;
  }
  return out;
}

function scanJs(src, where) {
  const code = joinLiterals(src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s\/\/ .*$/gm, ''));
  for (const m of code.matchAll(/\bt\.plural\((?:[^,()]|\([^()]*\))+,\s*(['"])((?:\\.|(?!\1)[^\\])*?)\1/g)) {
    plural.set(i18nKey(unescapeJs(m[2])), where);
  }
  for (const m of literalsOf(code)) {
    const lineStart = code.lastIndexOf('\n', m.index) + 1, lineEnd = code.indexOf('\n', m.index);
    const line = code.slice(lineStart, lineEnd < 0 ? code.length : lineEnd);
    {
      const tpl = m.tpl, raw = m.raw, v = unescapeJs(raw);
      literals.add(i18nKey(v));
      const before = code.slice(lineStart, m.index), after = code.slice(m.index + raw.length + 2, lineEnd < 0 ? code.length : lineEnd);
      if (/\bt\.plural\([^()]*(\([^()]*\)[^()]*)*$/.test(before) || /[=!]==?\s*$/.test(before)) continue;
      if (/\bt\([^()]*$/.test(before)) { add(v, where); continue; }
      if (QUIET.test(line)) continue;
      if (/<\w[^>]*>/.test(v)) {
        if (!tpl || !v.includes('${')) scanHtml(v, where);
        else for (const part of v.split(/\$\{(?:[^{}]|\{[^{}]*\})*\}/)) scanHtml(part.replace(/^[^<>]*>/, ''), where);
        continue;
      }
      if (tpl && v.includes('${')) {
        const bare = v.replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, ' ').replace(/\s+/g, ' ').trim();
        if (/[A-Za-z]{3,} [a-z]{2,}/.test(bare) && PROSE(bare)) glued.push([where, v]);
        continue;
      }
      if (!PROSE(v.trim())) continue;
      if ((/\+\s*$/.test(before) && /^\s*[^+\s,;)\]]/.test(after) === false) || /^\s*\+\s*[A-Za-z_(]/.test(after)) {
        if (/\+\s*$/.test(before) && !/['"]\s*\+\s*$/.test(before) || /^\s*\+\s*[A-Za-z_(]/.test(after)) glued.push([where, v]);
      }
      add(v, where);
    }
  }
}

// Kernels, shaders and the main process write no DOM; their strings only count as used, since
// the window can pass them through t() (a size label, a main-process error). mcpTools.js answers
// Claude, which reads English.
const QUIET_FILE = /^(ru|changelogData|(music|combat|fight|bestiary|i18n|vtt|mcp)Plan|mcpTools|statBlockParse|statBlockBook|attackLine|multiattack|pdfLayout|fogGeometry|effectShader|playerFogPass|dmFogLayer|renderer|videoDiag)\.js$/;

// The whole scan, once per call. test/i18nGaps.test.js fails the release on any missing entry or
// glued sentence; the CLI below prints the same lists.
function i18nGaps() {
  found.clear(); plural.clear(); glued.length = 0; literals.clear();
  scanHtml(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), 'index.html');
  (function walk(dir) {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) { if (f.name !== 'dev') walk(p); continue; }
      if (!f.name.endsWith('.js')) continue;
      const src = fs.readFileSync(p, 'utf8');
      if (QUIET_FILE.test(f.name)) for (const m of literalsOf(src)) literals.add(i18nKey(unescapeJs(m.raw)));
      else scanJs(src, path.relative(ROOT, p).replace(/\\/g, '/'));
    }
  })(path.join(ROOT, 'src'));
  for (const f of fs.readdirSync(path.join(ROOT, 'electron'))) {
    for (const m of literalsOf(fs.readFileSync(path.join(ROOT, 'electron', f), 'utf8'))) literals.add(i18nKey(unescapeJs(m.raw)));
  }

  const ruSrc = fs.readFileSync(path.join(ROOT, 'src/i18n/ru.js'), 'utf8');
  const { RU, RU_PLURAL } = new Function(ruSrc + '\nreturn { RU, RU_PLURAL };')();
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  const missing = [...found].filter(([k]) => !has(RU, k));
  const missingPlural = [...plural].filter(([k]) => !has(RU_PLURAL, k));
  const unused = Object.keys(RU).filter(k => !found.has(k) && !literals.has(k));
  const unusedPlural = Object.keys(RU_PLURAL).filter(k => !plural.has(k));
  return { missing, missingPlural, glued: glued.slice(), unused, unusedPlural };
}

module.exports = { i18nGaps };

if (require.main === module) {
  const { missing, missingPlural, glued, unused, unusedPlural } = i18nGaps();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ missing: missing.map(([k, w]) => [k, w]), plural: missingPlural.map(([k]) => k) }, null, 1));
  } else {
    console.log(`No Russian entry (${missing.length + missingPlural.length}):`);
    for (const [k, w] of missing) console.log(`  ${w}: ${JSON.stringify(k)}`);
    for (const [k, w] of missingPlural) console.log(`  ${w}: plural ${JSON.stringify(k)}`);
    console.log(`\nGlued from pieces, so it reaches the screen in English - use t() with {names} (${glued.length}):`);
    for (const [w, v] of glued) console.log(`  ${w}: ${JSON.stringify(v)}`);
    console.log(`\nRussian entries nothing uses (${unused.length + unusedPlural.length}):`);
    for (const k of unused) console.log(`  ${JSON.stringify(k)}`);
    for (const k of unusedPlural) console.log(`  plural ${JSON.stringify(k)}`);
  }
}
