'use strict';

// fakeInput.js - finds an action a scenario fakes instead of performing it. run.js refuses to run a scenario
// that fakes more than fakeInput.allow.json grants it (no grant for a new file), because a JS .click() or a
// synthetic event passes where the DM's own click fails: a search "typed" by script passed 44 checks while the
// real field never took focus. Act through user.js. A line that only sets the stage and is no action of the
// DM's (a file the native picker would hand over, a muted speaker) ends with a `// setup: <why>` comment.

const FAKES = [
  [/\.click\(\s*\)/, 'a JS .click()'],
  [/\bdispatchEvent\s*\(/, 'a synthetic event'],
  [/\bnew\s+(?:Mouse|Keyboard|Pointer|Wheel|Focus|Input|Touch|Drag)Event\b/, 'a synthetic event'],
  [/\.focus\(\s*\)/, 'a JS .focus()'],
  [/\.value\s*=(?!=)/, 'a value set by script'],
  [/__rig(?:Drag|Key|Mouse|Click)\b/, 'a fake-input helper'],
];

function fakeActions(source) {
  const found = [];
  String(source).split('\n').forEach((text, i) => {
    if (/\/\/\s*setup:\s*\S/.test(text)) return;
    const code = text.replace(/^\s*\/\/.*$/, '');
    for (const [re, what] of FAKES) {
      if (re.test(code)) { found.push({ line: i + 1, what, text: text.trim().slice(0, 120) }); break; }
    }
  });
  return found;
}

// The verdict run.js acts on: null, or why the scenario may not run.
function fakeVerdict(rel, source, allow) {
  const found = fakeActions(source);
  const granted = (allow && allow[rel]) || 0;
  if (found.length <= granted) return null;
  return rel + ' fakes ' + found.length + ' action(s)' + (granted ? ', ' + granted + ' allowed until it is rewritten' : '') +
    '. Act through tools/rig/user.js, or end a line that only sets the stage with `// setup: <why>`:\n' +
    found.map((f) => '  ' + f.line + ': ' + f.what + ': ' + f.text).join('\n');
}

module.exports = { fakeActions, fakeVerdict };
