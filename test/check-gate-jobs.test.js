'use strict';

// Main moves only when every leg of the run passed. The fixtures are real job lists: 5.14.5's first
// attempt, where GitHub never started the Mac rig and main moved anyway, a green release, and a docs change.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { gateProblems, TAIL } = require('../tools/check-gate-jobs.js');

const fixture = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'gate-jobs', n + '.json'), 'utf8'));
const RELEASE = ['Gate', 'Prove updates'];
const flow = yaml.load(fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'release.yml'), 'utf8'));

describe('the gate legs check', () => {
  it('stops the run where the Mac rig never started', () => {
    assert.deepEqual(gateProblems(fixture('mac-never-started'), RELEASE), ['Gate / Mac ended cancelled.']);
  });

  it('lands a release whose every leg passed', () => {
    assert.deepEqual(gateProblems(fixture('release-green'), RELEASE), []);
  });

  it('lands a docs change whose gate was skipped as not needed', () => {
    assert.deepEqual(gateProblems(fixture('change-no-gate')), []);
  });

  it('refuses a gate that had to run and was skipped', () => {
    const out = gateProblems(fixture('change-no-gate'), RELEASE);
    assert.ok(out.includes('Gate ended skipped.'), out.join('\n'));
    assert.ok(out.includes('Prove updates had to run and has no legs.'), out.join('\n'));
  });

  it('refuses a skipped, failed or unfinished leg', () => {
    for (const leg of [
      { status: 'completed', conclusion: 'skipped' },
      { status: 'completed', conclusion: 'failure' },
      { status: 'completed', conclusion: 'timed_out' },
      { status: 'completed', conclusion: null },
      { status: 'queued', conclusion: null },
    ]) {
      const jobs = fixture('release-green').map((j) => (j.name === 'Gate / Mac' ? { ...j, ...leg } : j));
      assert.equal(gateProblems(jobs, RELEASE).length, 1, JSON.stringify(leg));
    }
  });

  it('refuses an empty job list', () => {
    assert.equal(gateProblems([]).length, 1);
  });

  it('skips exactly the jobs that run after it, by their release.yml names', () => {
    assert.deepEqual(TAIL, [flow.jobs.land.name, flow.jobs.publish.name, flow.jobs.cleanup.name]);
  });

  it('runs inside land, before main moves, with a positive check on every call', () => {
    const steps = flow.jobs.land.steps.map((s) => s.run || '');
    const check = steps.findIndex((r) => r.includes('tools/check-gate-jobs.js'));
    const push = steps.findIndex((r) => r.includes('git push origin'));
    assert.ok(check >= 0 && check < push, 'the leg check must run before the push to main');
    assert.equal(flow.jobs.land.permissions.actions, 'read');
    for (const call of ['gate', 'gate-rig', 'update']) {
      assert.ok(flow.jobs.land.if.includes(`needs.${call}.result == 'success'`), call + ' needs a positive check');
    }
    assert.doesNotMatch(flow.jobs.land.if, /!= 'failure'|!= 'cancelled'|always\(\)/,
      '"not failure and not cancelled" let a leg GitHub never started through');
  });
});
