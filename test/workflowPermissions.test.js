'use strict';

// CI's token, held to what each job needs. A job that runs `npm ci` runs every dependency's install
// script, so it must never hold a token that can push to main or publish a release. A called
// workflow's own top-level block caps what its caller hands it.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const DIR = path.join(__dirname, '..', '.github', 'workflows');
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.yml'));
const flows = Object.fromEntries(files.map((f) => [f, yaml.load(fs.readFileSync(path.join(DIR, f), 'utf8'))]));

const RANK = { none: 0, read: 1, write: 2 };
const INSTALL = /\bnpm\s+(?:ci|install|i)\b/;

// No block at all means the repository default, which may be write.
function contents(perms, inherited) {
  if (perms === undefined) return inherited;
  if (perms === 'write-all') return RANK.write;
  if (perms === 'read-all') return RANK.read;
  return RANK[perms.contents || 'none'];
}

const installs = (job) => (job.steps || []).some((s) => typeof s.run === 'string' && INSTALL.test(s.run));
const calledOnly = (wf) => Object.keys(wf.on || {}).every((k) => k === 'workflow_call');

// Every installing job, with the most contents access it can hold when entered from `cap`.
function reach(file, cap, via, out) {
  const wf = flows[file];
  const top = Math.min(cap, contents(wf.permissions, cap));
  for (const [id, job] of Object.entries(wf.jobs)) {
    const level = Math.min(top, contents(job.permissions, top));
    const where = via + file + ' ' + id;
    const local = typeof job.uses === 'string' && job.uses.match(/^\.\/\.github\/workflows\/(.+)$/);
    if (local) reach(local[1], level, where + ' -> ', out);
    else if (installs(job)) out.push({ where, level });
  }
  return out;
}

describe('workflow permissions', () => {
  const found = [];
  for (const f of files) if (!calledOnly(flows[f])) reach(f, RANK.write, '', found);

  it('finds the jobs that install dependencies', () => {
    assert.ok(found.some((j) => j.where.startsWith('release.yml verify')), 'release.yml verify runs npm ci');
  });

  it('gives no installing job contents: write', () => {
    const bad = found.filter((j) => j.level >= RANK.write).map((j) => j.where);
    assert.deepEqual(bad, [], 'these jobs run npm install scripts with a token that can push; give the job or ' +
      'its workflow `permissions: contents: read` and grant write only to the jobs that push or publish');
  });

  it('pins softprops/action-gh-release to a commit', () => {
    const uses = [];
    for (const wf of Object.values(flows)) {
      for (const job of Object.values(wf.jobs)) {
        for (const s of job.steps || []) {
          if (typeof s.uses === 'string' && s.uses.startsWith('softprops/action-gh-release')) uses.push(s.uses);
        }
      }
    }
    assert.ok(uses.length > 0, 'release.yml uses softprops/action-gh-release');
    for (const u of uses) {
      assert.match(u, /@[0-9a-f]{40}$/, u + ' rides a movable tag; pin it to the full commit SHA');
    }
  });
});
