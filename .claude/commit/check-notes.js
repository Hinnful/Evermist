'use strict';

// check-notes.js - refuses release notes that break a rule a machine can check.
// Usage: node .claude/commit/check-notes.js [notes-file]   (default: this session's runs/<id>/notes.txt)
// With no file (a session, not CI) a pass is stamped for ship.js's yes-check, and the repeat flakes are listed.

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { notesHash } = require('./shipRules.js');

const RULES = path.join(__dirname, 'notes.md');
const ROOT = path.join(__dirname, '..', '..');
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function wordList(rulesText, tag) {
  const m = rulesText.replace(/\r/g, '').match(new RegExp('```' + tag + '\\n([\\s\\S]*?)```'));
  return m ? m[1].split('\n').map((s) => s.trim()).filter(Boolean) : null;
}

// Whole-word matches of `words` in each line, as faults. Case-insensitive unless `exact`.
function wordFaults(lines, words, label, exact) {
  if (!words.length) return [];
  const re = new RegExp('(?<![\\w])(' + words.map(escape).join('|') + ')(?![\\w])', exact ? 'g' : 'gi');
  const out = [];
  lines.forEach((l, i) => { for (const m of l.matchAll(re)) out.push(`line ${i + 1}: ${label} "${m[1]}": ${l}`); });
  return out;
}

// The names in a list_campaign reply: groups, maps, roads, fights.
function namesFromCampaign(reply) {
  let data;
  try { data = typeof reply === 'string' ? JSON.parse(reply) : reply; } catch { return []; }
  const names = new Set();
  const add = (v) => { if (typeof v === 'string') names.add(v.trim()); };
  const walk = (v) => {
    if (Array.isArray(v)) { v.forEach((x) => (typeof x === 'string' ? add(x) : walk(x))); return; }
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (['name', 'from', 'to'].includes(k)) add(x);
      else if (Array.isArray(x) || (x && typeof x === 'object')) walk(x);
    }
  };
  walk(data);
  return Array.from(names).filter((n) => n.length >= 4);
}

// Where the running app keeps its address: Electron's userData, which sits under the product or package name.
function addressFile() {
  const home = os.homedir();
  const base = process.platform === 'win32' ? process.env.APPDATA
    : process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support')
      : process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  if (!base) return null;
  return ['evermist', 'Evermist'].map((n) => path.join(base, n, 'mcp.json')).find((f) => fs.existsSync(f)) || null;
}

// Silent when the app is closed or this is CI: there is no data to check against.
function campaignNames() {
  return new Promise((resolve) => {
    let at;
    try { at = JSON.parse(fs.readFileSync(addressFile(), 'utf8')); } catch { return resolve([]); }
    const body = JSON.stringify({ tool: 'list_campaign', args: {} });
    const req = http.request({ host: '127.0.0.1', port: at.port, path: '/call', method: 'POST', timeout: 4000,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-evermist-token': at.token } }, (res) => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { out += c; });
      res.on('end', () => { try { resolve(namesFromCampaign(JSON.parse(out).text)); } catch { resolve([]); } });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
    req.end(body);
  });
}

// Every fault a notes text carries. `names` and the word lists arrive ready, so this stays pure.
function notesFaults(text, { filler, privateWords = [], names = [], allowed = [] }) {
  const lines = text.replace(/\r/g, '').trim().split('\n');
  const summary = lines[0] || '';
  const description = lines.slice(1).filter((l) => l.trim());
  const faults = [];

  if (!summary.trim()) faults.push('line 1: no Summary');
  if (summary.length > 70) faults.push(`line 1: Summary is ${summary.length} characters, limit 70`);
  if (description.length > 8) faults.push(`Description is ${description.length} lines, limit 8: an intro and 7 points`);
  // An intro sentence, then "* " points: the What's new panel draws the intro above a list.
  if (description[0] && description[0].startsWith('* ')) faults.push('line 2: the first Description line is the intro sentence, not a point');
  description.slice(1).forEach((l) => { if (!l.startsWith('* ')) faults.push(`a line after the intro is not a "* " point: ${l}`); });
  lines.forEach((l, i) => {
    if (/[—–]/.test(l)) faults.push(`line ${i + 1}: em-dash or en-dash, use " - ": ${l}`);
    if (/\bClaude\b/i.test(l)) faults.push(`line ${i + 1}: "Claude", say "AI assistant": ${l}`);
  });
  faults.push(...wordFaults(lines, filler, 'filler', false));
  faults.push(...wordFaults(lines, privateWords, 'private word', false));
  faults.push(...wordFaults(lines, names.filter((n) => n.length >= 4 && !allowed.includes(n)), 'the DM\'s own name', true));
  return faults;
}

// The rig's repeat flakes, for the backlog proposal. Information only: no network is a warning, never a fail.
function listFlakes() {
  const run = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'rig-ci.js'), 'flakes'], { cwd: ROOT, encoding: 'utf8', timeout: 180000 });
  if (run.error || run.status !== 0) { console.log('flakes: could not be read (' + ((run.error && run.error.message) || (run.stderr || '').trim().split('\n')[0] || 'exit ' + run.status) + ')'); return; }
  console.log('flakes (information only):\n' + run.stdout.trim());
}

async function main() {
  const session = !process.argv[2];
  const id = process.env.CLAUDE_CODE_SESSION_ID || 'local';
  const file = process.argv[2] || path.join(__dirname, 'runs', id, 'notes.txt');
  const rulesText = fs.readFileSync(RULES, 'utf8');
  const filler = wordList(rulesText, 'filler-words');
  const privateWords = wordList(rulesText, 'private-words');
  const allowed = wordList(rulesText, 'allowed-names');
  if (!filler || !privateWords || !allowed) {
    console.error(`check-notes: ${RULES} needs filler-words, private-words and allowed-names blocks`);
    process.exit(2);
  }
  const text = fs.readFileSync(file, 'utf8');
  const faults = notesFaults(text, { filler, privateWords, names: await campaignNames(), allowed });
  if (faults.length) {
    console.error(`check-notes: ${faults.length} fault(s) in ${file}\n  ` + faults.join('\n  '));
    process.exit(1);
  }
  if (!session) return;
  fs.writeFileSync(path.join(path.dirname(file), 'notes-passed.json'), JSON.stringify({ time: new Date().toISOString(), hash: notesHash(text) }) + '\n');
  console.log('check-notes: pass');
  listFlakes();
}

if (require.main === module) main();

module.exports = { notesFaults, namesFromCampaign, wordList };
