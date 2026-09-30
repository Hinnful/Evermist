'use strict';

// build-changelog.js — writes src/ui/changelogData.js from the release commits in git history.
//
// A release commit IS the release notes: its subject is "<version> - <note>" and its body is the
// description GitHub publishes verbatim. Both are copied here, so the panel in the app and the
// page on GitHub carry the same words and nobody maintains a second copy.
//
// Run it after the version-bump commit and amend: the newest entry is that commit's own message.
// Output is a plain <script> global, not JSON — fetch() of a local file is blocked on file://.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'src', 'ui', 'changelogData.js');
const RELEASE = /^(\d+\.\d+\.\d+) - (.+)$/;
const UNIT = '\x1f', RECORD = '\x1e';

// A published commit message cannot change without rewriting main, so a corrected body for
// one lives here, keyed by version, and replaces what the commit says.
const CORRECTED_BODY = {
  '1.7.1': "A mixed caves-and-rooms map came back with one giant polygon covering most of\nthe map plus three \"rooms\" that were freestanding rock formations, and two real\nrooms silently missing. The cave map now gives 13 rooms, all real, none\nfalse.\n\nTelling a room from solid rock\n- A run of walls that closes on itself carrying no portal anywhere does not\n  bound a room. It is rock, or the cave's own shell. Every real room reaches\n  somewhere through a doorway, so its walls arrive as an open chain that closes\n  only once the portals are unioned in.\n- Measured rather than guessed: on the cave export the false rooms scored 100%,\n  100% and 84% of their outline in doorless wall and every real room scored\n  exactly zero. So the test is \"any at all\" and there is no size threshold to\n  tune, which was the trap the winding-not-area lesson already warned about.\n- It judges a whole connected run of walls, not one room, so a windowless cellar\n  or a prison cell keeps its building's doors and survives. Only a structure\n  isolated from everything else is refused. A floor that is one sealed room -\n  an attic reached by a hatch - comes back empty rather than wrong.\n- vttDoorlessWalls + vttRingOnDoorlessWall in vttPlan.js, with a keepDoorless\n  opt-out and a refusedSolid count on the result. Computed on the wall-only\n  graph, T-split first, or a door in one wall leaves the other three looking\n  like an untouched ring and the whole building is refused.\n\nRooms that open onto a cave were being lost\n- Both ends of such a room's open side bridged sideways into the rock a few feet\n  away, nearer than each other. That glues the wall to the cave, closes nothing,\n  and spends the ends so the real partner is never found. 8 of the 10 bridges on\n  the cave map were that mistake, and widening the reach could not fix it.\n- Doorless walls are now excluded as bridge targets, so the two sides of an\n  opening can find each other.\n- Their ends sit 3.7 and 4.3 squares apart, past the 2.5 a lone stub is allowed,\n  so a mutual pair - both ends picking each other - now reaches\n  VTT_CLOSE_PAIR_MAX 5. That is much better evidence than a stub projecting onto\n  some wall's mid-span, which keeps the tight ceiling. Tightening the base\n  ceiling tightens both, so closeGapMax 0 still means no closing at all.\n- VTT_OPEN_WALL_MAX_GAP 4 to 6, to stay above the widest thing closing reaches.\n\nTests\n- Second real fixture: test/fixtures/cave-map.dd2vtt, a real cave map\n  export with its 9MB embedded JPEG blanked, 30KB on disk.\n- 12 new cases covering the cave map, the sealed-vault and attic behaviour, the\n  rock-steals-a-stub bug, and the two ceilings. 424 green.\n- Two existing synthetic sheds had no door on them, which the new rule correctly\n  reads as rock, so they were given the door a real export always has.\n\nAlso\n- tools/inspect-plan.js: dumps a .dd2vtt's arrays, graph and every face with\n  area and winding before classification. Outside the build glob. This is how\n  the diagnosis was done.\n- Docs: the floor-plan section of ARCHITECTURE.md covers cave handling, two new\n  entries in DECISIONS.md, and the binding rules added to the floor-plan skill.\n\nKnown and accepted: the cave's own chambers are one continuous space with no\nwall between them, so nothing in the file says where one ends. Cutting the\ncavern polygon by hand is the intended route. A bridged opening is a straight\ncut across the mouth.",
};

const git = (args) => execFileSync('git', args, { encoding: 'utf8', cwd: ROOT });

const tags = new Set(git(['tag']).split('\n').map(t => t.trim()).filter(Boolean));

const entries = [];
for (const record of git(['log', '--pretty=format:%ad' + UNIT + '%s' + UNIT + '%b' + RECORD, '--date=short']).split(RECORD)) {
  const [date, subject, body] = record.replace(/^\n/, '').split(UNIT);
  const m = subject && subject.match(RELEASE);
  if (!m) continue;
  const entry = { version: m[1], date: date, note: m[2], body: CORRECTED_BODY[m[1]] || (body || '').trim() };
  // Only a TAGGED version has a page on GitHub. An untagged one is a version that never
  // released, and a link to it would 404 from inside the app.
  if (tags.has('v' + m[1])) entry.tag = 'v' + m[1];
  entries.push(entry);
}

if (!entries.length) {
  console.error('build-changelog: no release commits found — refusing to write an empty changelog');
  process.exit(1);
}

const body = entries.map(e => '  ' + JSON.stringify(e) + ',').join('\n');

fs.writeFileSync(OUT, `'use strict';

// changelogData.js — GENERATED by tools/build-changelog.js. Never edit by hand; the next
// release overwrites it. Newest first.

const CHANGELOG_REPO = 'https://github.com/Hinnful/Evermist';

const CHANGELOG = [
${body}
];
`, 'utf8');

console.log('build-changelog: wrote ' + entries.length + ' entries, ' +
            entries.filter(e => e.tag).length + ' with a release page, newest ' + entries[0].version);
