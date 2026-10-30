'use strict';

// /commit's enforcement: the verdicts behind ship.js, check-notes.js and the release hooks. Each
// refusal is asserted both ways, a case that is refused and the nearest case that is not.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../.claude/commit/shipRules.js');
const { notesFaults, namesFromCampaign } = require('../.claude/commit/check-notes.js');
const { verdict, makesTag } = require('../.claude/hooks/guard-ship.js');
const { markerFor } = require('../.claude/hooks/record-markers.js');
const { remaining, decide, MAX_BLOCKS } = require('../.claude/hooks/stop-checklist.js');
const { isPackaged } = require('../tools/build-files.js');

const T0 = Date.parse('2026-10-30T10:00:00Z');
const stamp = (text) => ({ time: new Date(T0).toISOString(), hash: rules.notesHash(text) });
const NOTES = '4.15.0 - Something new\nIntro line\n\n* A point\n';

describe('ship.js yes-check', () => {
  const base = { stamp: stamp(NOTES), currentHash: rules.notesHash(NOTES), lastUserMs: T0 + 1000, amend: false, paths: ['src/ui/dock.js'], isPackaged };

  it('passes when the notes passed unchanged and the DM wrote after', () => {
    assert.equal(rules.yesCheck(base), null);
  });
  it('refuses notes that never passed the checker', () => {
    assert.match(rules.yesCheck({ ...base, stamp: null }), /check-notes/);
  });
  it('refuses notes edited after they passed', () => {
    assert.match(rules.yesCheck({ ...base, currentHash: rules.notesHash(NOTES + 'x') }), /changed after/);
  });
  it('refuses when the DM has not written since the notes passed', () => {
    assert.match(rules.yesCheck({ ...base, lastUserMs: T0 - 1 }), /new message/);
    assert.match(rules.yesCheck({ ...base, lastUserMs: T0 }), /new message/);
    assert.match(rules.yesCheck({ ...base, lastUserMs: NaN }), /new message/);
  });
  it('does not mind a CRLF save of the same notes', () => {
    assert.equal(rules.notesHash(NOTES), rules.notesHash(NOTES.replace(/\n/g, '\r\n')));
  });
  it('lets an amend that ships nothing skip the yes, and holds one that does', () => {
    const noYes = { ...base, stamp: null, amend: true };
    assert.equal(rules.yesCheck({ ...noYes, paths: ['tools/rig/run.js', 'test/x.test.js'] }), null);
    assert.match(rules.yesCheck({ ...noYes, paths: ['tools/rig/run.js', 'src/ui/dock.js'] }), /check-notes/);
    assert.match(rules.yesCheck({ ...noYes, paths: [] }), /check-notes/);
  });
});

describe('ship.js backlog and disclosure checks', () => {
  it('refuses a new release without the backlog, and passes with it or the flag', () => {
    const a = { branch: 'release/4.15.0', paths: ['package.json'], noBacklog: false, amend: false };
    assert.match(rules.backlogCheck(a), /BACKLOG/);
    assert.equal(rules.backlogCheck({ ...a, paths: ['package.json', 'docs/BACKLOG.md'] }), null);
    assert.equal(rules.backlogCheck({ ...a, noBacklog: true }), null);
    assert.equal(rules.backlogCheck({ ...a, branch: 'change/docs' }), null);
    assert.equal(rules.backlogCheck({ ...a, amend: true }), null);
  });

  it('refuses an amend that edits a test or scenario unless disclosure.txt names it', () => {
    const a = { amend: true, paths: ['tools/rig/scenarios/acceptance/fog.js', 'test/fog.test.js', 'tools/rig/run.js'], disclosure: '' };
    assert.match(rules.disclosureCheck(a), /fog\.js, test\/fog\.test\.js without/);
    assert.match(rules.disclosureCheck({ ...a, disclosure: 'tools/rig/scenarios/acceptance/fog.js: wrong expectation' }), /test\/fog\.test\.js without/);
    assert.equal(rules.disclosureCheck({ ...a, disclosure: 'tools/rig/scenarios/acceptance/fog.js and test/fog.test.js: old expectation was wrong' }), null);
    assert.equal(rules.disclosureCheck({ ...a, amend: false }), null);
    assert.equal(rules.disclosureCheck({ ...a, paths: ['tools/rig/run.js'] }), null);
  });
});

describe('check-notes privacy', () => {
  const words = { filler: ['finally'], privateWords: ['he', 'my', 'fixture', 'guard hook', 'rig'], names: [], allowed: [] };

  it('refuses a private word as a whole word, in any case', () => {
    assert.equal(notesFaults('1.0.0 - A\nHe found it\n', words).length, 1);
    assert.equal(notesFaults('1.0.0 - A\nFrom my map\n', words).length, 1);
    assert.equal(notesFaults('1.0.0 - A\nThe guard hook\n', words).length, 1);
  });
  it('passes the same words inside other words', () => {
    assert.deepEqual(notesFaults('1.0.0 - Shell the heritage\nA rigid fixtures\n', words), []);
  });
  it('refuses a name from the DM\'s data, case-sensitive and 4 characters or more', () => {
    const w = { ...words, names: ['Karnak', 'Orc', 'Dun'] };
    assert.equal(notesFaults('1.0.0 - A\nThe Karnak map\n', w).length, 1);
    assert.deepEqual(notesFaults('1.0.0 - A\nThe karnak map, an Orc, a Dune\n', w), []);
  });
  it('lets an allowed name through', () => {
    assert.deepEqual(notesFaults('1.0.0 - A\nThe Karnak map\n', { ...words, names: ['Karnak'], allowed: ['Karnak'] }), []);
  });
  it('still refuses what it refused before', () => {
    assert.equal(notesFaults('1.0.0 - A\nIt finally works\n', words).length, 1);
  });
  it('reads names out of a list_campaign reply', () => {
    const reply = JSON.stringify({ places: [{ name: 'Karnak', scenes: ['Crypt', 'Lower Vault'] }], scenesWithoutPlace: ['Inn'], roads: [{ name: 'Old Road', from: 'Karnak', to: 'Inn' }], fights: ['Ambush'], bestiaryMonsters: 12 });
    assert.deepEqual(namesFromCampaign(reply).sort(), ['Ambush', 'Crypt', 'Karnak', 'Lower Vault', 'Old Road']);
    assert.deepEqual(namesFromCampaign('not json'), []);
  });
});

describe('guard-ship', () => {
  const run = (command) => verdict({ tool_input: { command } });

  it('refuses any push, merge, new tag and release edit', () => {
    for (const c of ['git push', 'git push origin HEAD:refs/heads/main', 'git push --tags', 'git -C . push origin x', 'cd x && git push -f',
      'gh pr merge 12 --squash', 'git tag v1.2.3', 'git tag -a v1.2.3 -m x', 'git tag -f v1', 'gh release create v1', 'gh release edit v1 --draft=false', 'gh release upload v1 a.exe']) {
      assert.ok(run(c), c + ' should be refused');
    }
  });
  it('allows reading, listing and deleting', () => {
    for (const c of ['git status', 'git tag', 'git tag -l', 'git tag --list "v4.*"', 'git tag -d v1.2.3', 'git tag --contains HEAD', 'gh release list', 'gh release view v1', 'gh release delete v1 --yes',
      'gh pr list', 'gh pr view 3', 'git commit -m "no push here"', 'node .claude/commit/ship.js -- a', 'node tools/rollback.js v1.2.3', 'git fetch --tags']) {
      assert.equal(run(c), null, c + ' should pass');
    }
  });
  it('does not read text about a push as a push', () => {
    assert.equal(run('cat <<EOF\ngit push origin main\nEOF'), null);
    assert.equal(run('echo git push'), null);
  });
  it('tells a tag from a listing', () => {
    assert.equal(makesTag([]), false);
    assert.equal(makesTag(['-l', 'v*']), false);
    assert.equal(makesTag(['v1']), true);
    assert.equal(makesTag(['-a', 'v1']), true);
  });
});

describe('release checklist hooks', () => {
  const pushed = { summary: '4.15.0 - Something new', branch: 'release/4.15.0', time: '2026-10-30T10:00:00.000Z' };
  const after = (text) => ({ time: '2026-10-30T10:05:00.000Z', text });

  it('names a marker only for the calls that leave one', () => {
    assert.deepEqual(markerFor('mcp__ccd_pr__set_monitor', { auto_fix: true }), { file: 'monitor-armed', text: 'armed' });
    assert.equal(markerFor('mcp__ccd_pr__set_monitor', { auto_fix: false }), null);
    assert.deepEqual(markerFor('mcp__ccd_session_mgmt__set_session_title', { title: 'T' }), { file: 'renamed', text: 'T' });
    assert.equal(markerFor('Bash', { command: 'ls' }), null);
  });
  it('lists what is left after a push, and nothing once both are done', () => {
    assert.equal(remaining(pushed, null, null).length, 2);
    assert.match(remaining(pushed, null, after(pushed.summary))[0], /arm the CI monitor/);
    assert.match(remaining(pushed, after('armed'), null)[0], /rename the chat to: 4\.15\.0 - Something new/);
    assert.deepEqual(remaining(pushed, after('armed'), after(pushed.summary)), []);
  });
  it('wants the markers again when they predate the push or carry another title', () => {
    const old = { time: '2026-10-30T09:00:00.000Z', text: 'armed' };
    assert.equal(remaining(pushed, old, { ...old, text: pushed.summary }).length, 2);
    assert.equal(remaining(pushed, after('armed'), after('Another title')).length, 1);
  });
  it('is quiet when nothing was pushed', () => {
    assert.deepEqual(remaining(null, null, null), []);
  });
  it('blocks up to the limit, then lets go', () => {
    const todo = ['x'];
    assert.equal(decide(todo, 0), 'block');
    assert.equal(decide(todo, MAX_BLOCKS - 1), 'block');
    assert.equal(decide(todo, MAX_BLOCKS), 'release');
    assert.equal(decide([], 0), 'quiet');
  });
  it('reads the same ids from a hook payload and the environment', () => {
    assert.deepEqual(rules.sessionIds({ session_id: 'a' }, { CLAUDE_CODE_SESSION_ID: 'a' }), ['a']);
    assert.deepEqual(rules.sessionIds({ session_id: 'a' }, { CLAUDE_CODE_SESSION_ID: 'b' }), ['a', 'b']);
    assert.deepEqual(rules.sessionIds({}, {}), []);
  });

  it('hands the session a pull request command that survives quotes in the Summary', () => {
    assert.equal(rules.prCreateCommand('change/x', "The DM's map", '.claude\\commit\\runs\\a\\pr-body.md'),
      "gh pr create --base main --head 'change/x' --title 'The DM'\\''s map' --body-file '.claude/commit/runs/a/pr-body.md'");
  });

  it('counts only the DM\'s own messages as a possible yes', () => {
    assert.equal(rules.isFromDm('yes, push it'), true);
    assert.equal(rules.isFromDm('Another Claude session sent a message:\n<agent-message from="x">done</agent-message>'), false);
    assert.equal(rules.isFromDm('<task-notification>\n<status>completed</status>'), false);
    assert.equal(rules.isFromDm('[SYSTEM NOTIFICATION - NOT USER INPUT]'), false);
    assert.equal(rules.isFromDm('<system-reminder>\n[SYSTEM NOTIFICATION - NOT USER INPUT]\n<task-notification>'), false);
    assert.equal(rules.isFromDm('<ci-monitor-event>red</ci-monitor-event>'), false);
    assert.equal(rules.isFromDm(''), false);
  });
});
