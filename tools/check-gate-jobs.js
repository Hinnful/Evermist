#!/usr/bin/env node
'use strict';

/*
 * Did every job in this run pass? release.yml's land job asks before it moves main.
 *
 *   gh api repos/<repo>/actions/runs/<id>/attempts/<n>/jobs --paginate --jq '.jobs[]' \
 *     | node tools/check-gate-jobs.js [--need Gate] [--need "Prove updates"]
 *
 * ⚠ `needs.<call>.result` IS NOT ENOUGH. A called workflow's result folds its matrix legs into one
 * word, and a leg GitHub never started (no runner) came back as neither failure nor cancelled, so
 * main moved with the Mac rig unrun. The run's own job list carries every leg's conclusion.
 *
 * `--need <name>` says that call had to run: it may not be skipped and must have legs.
 */

// The jobs that run after this check, itself first. A test holds these to release.yml's names.
const TAIL = ['Move main to this commit', 'Publish the release', 'Delete the release branch'];

function gateProblems(jobs, need = []) {
  const problems = [];
  for (const job of jobs) {
    if (TAIL.includes(job.name)) continue;
    const leg = job.name.includes(' / ');
    if (job.status !== 'completed') {
      problems.push(job.name + ' is ' + job.status + ', not finished.');
    } else if (job.conclusion === 'skipped' && !leg && !need.includes(job.name)) {
      continue;
    } else if (job.conclusion !== 'success') {
      problems.push(job.name + ' ended ' + (job.conclusion || 'with no conclusion') + '.');
    }
  }
  for (const name of need) {
    if (!jobs.some((j) => j.name.startsWith(name + ' / '))) problems.push(name + ' had to run and has no legs.');
  }
  if (!jobs.length) problems.push('the run lists no jobs at all.');
  return problems;
}

function main() {
  const need = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--need') need.push(argv[++i]);
  const text = require('fs').readFileSync(0, 'utf8').trim();
  const jobs = text.startsWith('[') ? JSON.parse(text) : text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  for (const j of jobs) console.log((j.conclusion || j.status) + '\t' + j.name);
  const problems = gateProblems(jobs, need);
  if (problems.length) {
    console.error('\nmain stays where it is:\n  ' + problems.join('\n  '));
    process.exit(1);
  }
  console.log('\nEvery gate leg passed.');
}

if (require.main === module) main();

module.exports = { gateProblems, TAIL };
