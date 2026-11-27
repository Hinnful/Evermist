# Architecture - how the app tests itself

Split out of [ARCHITECTURE.md](../ARCHITECTURE.md): unit tests, the house rules and the test rig, in the present tense.

Two things, answering different questions.

**The unit tests** (`npm test`) cover arithmetic and geometry: fitting a map inside a box,
insetting a polygon, turning a floor plan's walls into rooms, putting a PDF's text back in
reading order. Plain functions, values in and values out. Nothing that touches the screen.
They also check the packaging: every script and stylesheet the app loads has to be one the
installer actually ships, because a file left out fails silently rather than erroring.

**The rig** (`npm run rig`) covers everything the running app has to be looked at to know.
It starts the real app the way you do, waits for it to finish loading, then drives it from the
outside over the Chrome DevTools Protocol: import a map, flip a switch, open the Player window,
reveal an area. Then it reads back what actually happened. Each scenario reports as it finishes,
so a long run shows where it is, and the last line is the verdict: PASS or FAIL.
About ten seconds start to finish.
On a Linux desktop session the rig runs every app on one virtual KWin screen of its own, and stops if there is none; elsewhere it uses the screen it is given.

The whole suite also runs on every release, against the installed application rather than the
source - see "How a version reaches you" below.

Driving the app's *own* Electron shell is the point. An earlier harness stood up a second shell
of its own, which meant none of the file-handling existed and half the app died on a missing
handler the moment it touched disk. It also could not see the Player window at all, so the
app's central promise, that what the DM reveals is what the table sees, had never been checked
by anything but a person.

- Each run gets a throwaway copy of the app's storage under the system temp folder, so a test
  can import maps and restore backups without ever touching your real library.
- The test maps are drawn and recorded by the app itself at the start of a run, so nothing
  binary is stored in the project and no real map has to be pointed at.
- Every acceptance scenario runs on an **animated** map, because that is the only kind you
  use. The suite used to run on still images, which meant it proved the app worked in a
  case that never happens and said nothing about the one that always does. The two are
  genuinely different inside: your window hands the video to the browser to draw, the
  Player has to repaint its picture from it every frame, fog lies over a moving image,
  and panning moves the video rather than the graphics layer. A clip is recorded once
  per run and shared, so covering the real case costs seconds, not minutes.
- Screenshots, generated maps and the throwaway storage all stay out of the project folder.
- `tools/` ships in the repository but not inside the installer, so none of this reaches you.
- A run no longer takes the machine. Both windows are parked off the side of the screen and
  keep drawing there, so you can carry on working while one is going. `--visible` leaves them
  on screen when you want to watch.
- Every run uses the same window size as the build server, down to the pixel. A run here and
  a run on the release gate are the same run. Before this, checks that depended on the window
  size passed here and failed there, and each one cost a twenty-minute run to find.
- A scenario that gives up part way through is reported and the run carries on. One stuck wait
  used to end the whole thing, so a long run came back naming one problem and hiding the rest.
  A scenario that hangs rather than gives up is abandoned after five minutes and the run moves
  to the next one, so a single stuck file can no longer spend the whole run saying so.
- No scenario waits a fixed number of milliseconds for something to happen. It waits for the
  thing itself - a value to arrive, a crossfade to finish, a window to repaint - and gives up
  with a bound. A hundred fixed waits were the largest reason a run could pass here and fail on
  the slower build server. The handful that remain are the opposite case, where the check is
  that something does *not* happen, and each one has to say in writing why it waits as long as
  it does.

One set of scenarios gates a release: **blockers**, a few journeys whose failure would stop the DM at
the table (the app launches, a map is prepared, a table session runs, work is kept). Each file's pass
criteria are written in plain English at the top. A criterion that can only be judged by eye stays
in the file and is reported as unchecked rather than quietly dropped. Any other scenario is a
one-off probe run by name.

Two scenarios stand apart from the rest. One closes the app and opens it again on a library
that already has maps in it, which is what you do between sessions and what nothing else could
reach - every other scenario starts on an empty library by design. The other runs the handful
of things that depend on the window's shape at three different window sizes, from a laptop to
a wide monitor, so pinning every other run to one size costs no coverage.

An acceptance file covers one whole feature and ends at the Player window. It opens with the
feature's goal in a sentence - "the DM draws a shape with any tool, in any fog mode, and the
players see the result" - and every check either serves that sentence or does not belong. The
many combinations a feature allows are swept on the DM, where they are cheap; the Player is
then checked once per distinct outcome, because everything crosses to it through one message
and checking each combination there would prove the same delivery over and over.

Two things keep the rig from being a tool nobody remembers. Editing anything the app ships now
raises a one-line reminder if no scenario moved with it, which is a hint and not a refusal -
plenty of changes genuinely need no new scenario. And a scenario is only believed once it has
been made to **fail**: the code under it is deliberately broken, the failure is read to check it
names the right thing, and the code goes back. One written after the code it covers has only
ever seen a pass, which is not the same as working.

## What checks what

| Check | Runs | Enforces |
|---|---|---|
| Guard hooks in `.claude/hooks/` | On every edit in a Claude session | Doc size and shape, the inline script, comment share, repeated sentences, module size, skill hints, the screen, rig sets while building, stashes |
| `tools/check-guards.js` | CI, every push | The blocking guards over the whole tree, whoever edited it |
| `npm test` | CI, every push; `/commit` | App logic, packaging, and the prose rules in `test/rules.test.js` |
| `tools/check-release.js` | CI, `decide` | Branch, version and release-title agreement |
| `tools/check-guards.js` | `/commit` | The same guards CI runs, before the push |
| The rig's blocker set | CI on three platforms, every one blocking | The app starts, preps a map, runs a table session and keeps the DM's work |
| `test/designSystem.test.js` | CI, every push; `/commit` | Colours, radii, type sizes, gaps and atom sizes against `.claude/rules/design-system.md` |
| The rig's `design-sweep` | CI, on a change to the interface, Linux; a trial that warns and never blocks | Every inventory entry in every state: one text size per row and no capless glyph as text; on the rendered pixels, averaged over where the window can land, icons, plates and switches within 0.25px of the capitals and texts of one size on one baseline; no plate merging with its row or swallowed by its hover, no native control, text 6px clear of a control's side, nothing moving when a state changes, menus one size |
| `guard-board.js` (`tools/board-check.js`) | Every Artifact publish of a page that links `src/css/` | A mockup board's rows against the same alignment checks as `design-sweep`, in a window that never shows; a faulty board is refused with its rows named, so the DM sees only clean boards and has nothing to do |
| `check-notes.js` | `/commit` | Release-note mechanics |
| `guard-builder.js` | Every builder launch | A brief's four fields, an `Accept:` of what the DM does → sees |
| `ship.js --accept` | `/commit`, every release | Every DoD line of every shipped spec marked as proven, user lines written as does → sees |
| `permissions.deny` in `.claude/settings.json` | Always | No Chrome browser tool |

A habit that keeps slipping earns a check in this table.
