'use strict';

// The command guards: screen, rig, main and builder. Each refusal is asserted both ways, the spellings
// that must be refused and the nearest commands that must pass.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const screen = require('../.claude/hooks/guard-screen.js');
const rig = require('../.claude/hooks/guard-rig.js');
const main = require('../.claude/hooks/guard-main.js');
const builder = require('../.claude/hooks/guard-builder.js');

const run = (guard, command) => guard.verdict({ tool_input: { command } });
const ABS_EXE = '"C:\\Users\\hinnf\\OneDrive\\Рабочий стол\\Evermist\\dist\\win-unpacked\\Evermist.exe"';

describe('screen guard', () => {
  const launches = [
    'npm start', 'npm.cmd start', 'npm run-script start', 'npm --prefix . start', 'yarn start',
    'node tools/lab.js', 'node ./tools/lab.js', 'node "C:\\a b\\Evermist\\tools\\lab.js"',
    'npx electron .', 'npx --yes electron .', 'npm exec electron .', 'electron main.js', 'electron',
    'node node_modules/electron/cli.js .', './node_modules/.bin/electron .', 'node_modules\\.bin\\electron.cmd .',
    'cmd /c npm start', 'bash -c "npm start"', 'Start-Process npm -ArgumentList start',
    'echo hi & npm start', '& npm start', '(npm start)', 'cd x && npm start',
    'dist/win-unpacked/Evermist.exe', '& "dist\\win-unpacked\\Evermist.exe"',
    'Start-Process "dist\\win-unpacked\\Evermist.exe"', 'start "" "dist\\win-unpacked\\Evermist.exe"',
    ABS_EXE, '& ' + ABS_EXE, '"dist/Evermist Setup 2.4.0.exe"',
    'npm run stress', 'npm run memprobe', 'npm run lab',
  ];
  for (const cmd of launches) {
    it('refuses ' + cmd, () => assert.ok(run(screen, cmd), cmd));
  }

  const visible = [
    'npm run rig -- fog --visible', 'node tools/rig/run.js fog --visible', 'node ./tools/rig/run.js fog --visible',
    'npm --silent run rig -- fog --visible', 'npm run-script rig -- fog --visible',
  ];
  for (const cmd of visible) {
    it('refuses the visible rig: ' + cmd, () => assert.match(run(screen, cmd).what, /visible/));
  }

  const fine = [
    'npm test', 'npm run lint', 'npm install', 'npx eslint src', 'npx electron-builder --win --dir',
    'electron --version', 'echo "npm start"', 'git commit -m "never npm start"',
    'npm run rig -- fog', 'npm run rig -- fog --exe "dist/win-unpacked/Evermist.exe"',
    'node ./tools/rig/run.js fog', 'ls dist/win-unpacked/Evermist.exe', 'Get-FileHash ' + ABS_EXE,
    'npm run rig -- fog 2>&1', 'cat <<EOF\nnpm start\nEOF',
  ];
  for (const cmd of fine) {
    it('allows ' + cmd.split('\n')[0], () => assert.equal(run(screen, cmd), null, cmd));
  }
});

describe('rig guard', () => {
  it('refuses a set however the rig is spelled', () => {
    for (const cmd of ['npm run rig', 'npm run rig -- regression', 'node ./tools/rig/run.js a b',
      'npm --silent run rig -- a b', 'npm run-script rig -- smoke', 'cmd /c npm run rig -- a b',
      'npm run rig -- blockers', 'npm run rig -- launch', 'npm run rig -- smoke --low-priority',
      'npm run rig -- regression --low-priority', 'npm run rig -- a b --low-priority']) {
      assert.ok(run(rig, cmd), cmd);
    }
  });
  it('allows a look', () => {
    for (const cmd of ['npm run rig -- fog', 'node ./tools/rig/run.js fog', 'npm run rig -- --shot ".dock"',
      'npm run rig -- fog 2>&1', 'npm run rig -- blockers --low-priority --exe x',
      'npm run rig -- launch --low-priority --exe x']) {
      assert.equal(run(rig, cmd), null, cmd);
    }
  });
  it('gives a builder two looks and refuses the third', () => {
    const p = { agent_type: 'builder', tool_input: { command: 'npm run rig -- fog' } };
    assert.equal(rig.builderVerdict(p, 0), null);
    assert.equal(rig.builderVerdict(p, 1), null);
    assert.ok(rig.builderVerdict(p, 2));
    assert.ok(rig.builderVerdict({ ...p, tool_input: { command: 'npm run rig -- fog; npm run rig -- grid' } }, 1));
  });
  it('refuses a rig run while another is going, and nothing else', () => {
    const p = { tool_input: { command: 'npm run rig -- fog' } };
    assert.ok(rig.busyVerdict(p, 1));
    assert.equal(rig.busyVerdict(p, 0), null);
    assert.equal(rig.busyVerdict({ tool_input: { command: 'npm test' } }, 1), null);
  });
  it('leaves the main session and other commands uncounted', () => {
    assert.equal(rig.builderVerdict({ tool_input: { command: 'npm run rig -- fog' } }, 9), null);
    assert.equal(rig.builderVerdict({ agent_type: 'scout', tool_input: { command: 'npm run rig -- fog' } }, 9), null);
    assert.equal(rig.builderVerdict({ agent_type: 'builder', tool_input: { command: 'npm test' } }, 9), null);
  });
});

describe('builder guard', () => {
  const BRIEF = [
    '**Cause:** the cleanup deletes a blob whose record has not arrived yet; the rig log shows it.',
    '**Change:** skip blobs with no record younger than an hour in syncRemote.js.',
    '**Done-check:** syncPlan.test.js case fails before the change and passes after it.',
  ].join('\n');
  const launch = (input) => builder.verdict({ tool_name: 'Agent', tool_input: { subagent_type: 'builder', ...input } });
  it('allows a full brief on Opus or the default model', () => {
    assert.equal(launch({ prompt: BRIEF }), null);
    assert.equal(launch({ prompt: BRIEF, model: 'opus' }), null);
  });
  it('refuses a brief missing a field or with an empty one', () => {
    assert.ok(launch({ prompt: 'Fix the failing sync-travel check C.' }));
    assert.ok(launch({ prompt: BRIEF.replace(/\*\*Cause:\*\*.*\n/, '') }));
    assert.ok(launch({ prompt: BRIEF.replace(/(Done-check:\*\*).*/, '$1 tbd') }));
  });
  it('allows Sonnet only with a Mechanical: field', () => {
    assert.ok(launch({ prompt: BRIEF, model: 'sonnet' }));
    assert.equal(launch({ prompt: BRIEF + '\nMechanical: renames one constant in two files, exact diff given.', model: 'sonnet' }), null);
    assert.ok(launch({ prompt: BRIEF + '\nMechanical: renames one constant in two files.', model: 'haiku' }));
  });
  it('leaves other agents alone', () => {
    assert.equal(builder.verdict({ tool_name: 'Agent', tool_input: { subagent_type: 'scout', prompt: 'find x' } }), null);
    assert.equal(builder.verdict({ tool_name: 'Bash', tool_input: { command: 'ls' } }), null);
  });
});

describe('main guard', () => {
  const away = [
    'git checkout feature-x', 'git checkout HEAD~3', 'git checkout 85b4c67', 'git checkout -', 'git checkout --detach',
    'git checkout -b foo', 'git -C . checkout -b foo', 'git -C "C:\\a b" checkout feature-x',
    'git -C . worktree add ../x', 'git switch foo', 'git -c core.x=1 switch foo', 'git branch foo', 'git stash',
    'git checkout .',
  ];
  for (const cmd of away) {
    it('refuses ' + cmd, () => assert.ok(run(main, cmd), cmd));
  }
  const fine = [
    'git checkout main', 'git checkout -- src/a.js', 'git checkout HEAD -- src/a.js', 'git -C . status',
    'git switch main', 'git branch', 'git branch -d old', 'git stash list', 'git checkout main 2>/dev/null',
  ];
  for (const cmd of fine) {
    it('allows ' + cmd, () => assert.equal(run(main, cmd), null, cmd));
  }
});
