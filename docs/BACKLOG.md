---
name: project-backlog
description: "Open work only. 13 open items; IDs run to 249."
metadata: 
  node_type: memory
  type: project
  originSessionId: 2307b124-0cab-4d5a-971b-72ac3a56f517
  modified: 2026-08-25T19:50:46.330Z
---

**Open items only.** Each doc answers one question and this file answers *what's next*. Rejected
ideas and settled technical calls live in `docs/DECISIONS.md`; scope, positioning and versioning
in `docs/PRODUCT.md`; how the app works in `docs/ARCHITECTURE.md`; the rules in `CLAUDE.md`; and
settled calls about the slash commands in `docs/decisions/process.md`. **Before
proposing anything, check DECISIONS.md and PRODUCT.md** - recommending something already killed,
or something ruled out of scope, is the most expensive mistake here, because it looks fresh and
burns a session.

**⚠️ THE RULE THIS FILE KEEPS BREAKING, re-set 2026-08-09.** Nothing that is already decided,
already shipped, or already refused belongs here - not "for the reasoning", not as a record.
The file had grown to 897 lines of which most was narrative about closed work, and items that
were never asked for had hardened into blockers by being carried forward. **An item earns its
place only if someone could pick it up and do it.** If it needs writing down but nobody can act
on it, it goes to DECISIONS.md or nowhere.

- **Freeze rule:** freeze means no PUSH to prod (no new `.exe` to the TV). Building locally is
  always fine.
- Line numbers drift. Re-grep before acting.
- Version state lives in one place below. `git tag --list` alone shows only LOCAL tags, which
  once cost a day of believing a shipped release was unreleased.
- This file is `docs/BACKLOG.md`, the public list of open work. `/brief` reads it and `/commit`
  writes it.
- **Every doc this file points at has a guard hook** (2026-08-10). If one fires while you are
  filing, its message says what to fix and whether to fix it now; follow that rather than
  reverting the edit.

## ⚑ Where the versions are

`package.json` is at **4.17.0**. **The 5.0 epic comes first** (2026-10-30): the items under "The prep pipeline" below,
in their order. They make Evermist a whole prep pipeline with the AI assistant, plus notes and search for play.
Every other item carries no release tag. **The MCP epic closed on 2026-10-28 with 4.13.0.** The First User Experience
epic closed on 2026-10-25 with its done test still unrun. 2.12.0 to 2.15.3 are the vector editing epic, now closed: two selection
levels, curved walls, the bounding box, copy/paste/duplicate, a radius on a curved corner, and shapes drawn as
coloured areas.

**A version is no longer a decision to release; it IS the release.** Bump `package.json` and the
change ships once the gate is green. Docs and tooling commits bump nothing.

**⚠ NOTHING IS PUSHED TO `main`.** It is protected and refuses a direct push from anyone. A change
goes to a `release/<version>` or `change/<slug>` branch with a pull request, and the pipeline
fast-forwards `main` onto it once the gate is green. **ONE VERSION IS ONE COMMIT**: a red gate fix
amends that commit and force-pushes the branch. The release notes are read off the commit that SET
the version, not off the top of the branch.

**Read `git log` and `gh release list` before believing any of this.** `git tag --list` alone
shows only LOCAL tags, which once cost a day of believing a shipped release was unreleased.

- **Treat the feature bars as an ORDER, never as booked numbers.**
- **Size releases conservatively.** A release that rebuilt the whole Player scene transition was
  still a patch.

## Categories

Each item ends with its tags: category, then where it shows. An item takes at most two
categories. Effort and risk are judged once an item is picked, not here.

- **Prep** - makes getting a session ready faster, more scalable or easier to maintain.
- **Play** - the same, at the table during a session.
- **Campaign** - spans sessions: the world, its places, its notes.
- **Polish** - a visible gap or small QoL fix the DM would notice.
- **Upkeep** - checks, CI, docs: nothing the DM sees ships.
- **Bug** - the app does something wrong.
- **First use** - lowers what a new DM must learn before the first session.

---

# THE PREP PIPELINE - THE 5.0 EPIC

Opened 2026-10-30. **The endgame:** a DM hands the AI assistant a module PDF and a folder of maps and gets back maps in
a group, with rooms, notes, fights and linked factions and lore, reviewed and undone as one run. At the table, one
search finds anything and notes link to each other. Evermist stays a map presenter and prep pipeline, never a
worldbuilding tool: no timelines, calendars, family trees or relationship graphs, and nothing that tracks the session
for the DM. The items go one at a time, in this order, and the epic closes with 244, which marks 5.0.0. The look for
240 and 241 is agreed in a clickable prototype, `.claude/private/design/item-195/notes-v2.html` on the DM's machine.

### 242. The AI assistant fills the notes model
Filed 2026-10-30. Tools for the AI assistant to create factions and lore, nest them, write mentions and read "Appears
in", so a module PDF plus a map folder becomes maps in a group with rooms, notes, fights and linked entries. It preps one
session's chapters at a time, never a whole book. Its notes tools already read and write mentions in their stored form,
`@[Name](kind:id)`, unchanged.
**Prep · DM only**

### 243. One review and one undo for a big AI assistant prep run
Filed 2026-10-30. A prep run is hundreds of changes, and the AI assistant's undo keeps the last 30. After a run the DM
sees one summary of what it made and changed, and one button undoes the whole run. **Blocked on a discussion** of the
whole item, starting from whether Evermist is even open while the AI assistant works.
**Prep · DM only**

### 244. README and GIFs for 5.0
Filed 2026-10-30. Once 238 to 243 have shipped, re-record every README GIF with the new interface, and add a new one
only where it shows something the others do not. The README does not advertise the AI assistant's prep. "Nothing
leaves your computer" stays, with one sentence: Evermist works fully offline, and connecting the AI assistant is
optional. Claude records the GIFs with the test app off screen. This release is 5.0.0, the shape 3.0.0 and 4.0.0 took.
**Upkeep · Both**

---

# EVERYTHING ELSE

### 249. Open the Notes window when a room is picked
Filed 2026-10-30. Today a room picked with the Notes window shut leaves it shut and marks nothing on the rail, as the
Bestiary and the fight table do. Opening the window on a pick is the other option. Decide after watching how the DM and
testers use the window.
**Polish · DM only**

### 247. The backup scenario needs a second try on Windows and macOS
Filed 2026-10-30. It reran in 3 recent gate runs: a stopped backup left its file behind, or was not stopped. Find
whether the scenario or the app is at fault, then fix it or retire the check.
**Upkeep · DM only**

### 248. Time how long search takes to open on a big library
Filed 2026-10-30. Search reads every map's rooms and notes the first time it opens, and caches them. Item 239's spec
asked for a rig note of that open time on a library of many maps, so a slowdown shows up; it was not added.
**Upkeep · DM only**

### 245. The music scenario needs a second try on Windows
Filed 2026-10-30. It reran in 3 recent Windows gate runs: the DM window did not answer within 30s and the music read
as stopped early. Find whether the scenario or the app stalls, then fix it or retire the check.
**Upkeep · DM only**

### 246. The claude-grid and claude-fog scenarios need a second try on macOS
Filed 2026-10-30. claude-grid reran in 4 recent macOS gate runs and claude-fog in 3 (2026-10-31): the Player received
an `anim-params` message while the AI assistant changed the grid, effects, lights or fog. Decide whether that message
is allowed through, then fix the app or both checks.
**Upkeep · DM and Player**

### 236. Move to Electron 45
Filed 2026-10-27. Evermist runs on Electron 43, which stops getting security fixes when Electron 46 ships, about
two months out. Move to 45, then run the full rig set and a packaged build before it ships.
**Upkeep · DM and Player**

### 144. A phone remote for the DM
Filed 2026-09-29 as a DESIGN DISCUSSION. The DM stands up, walks and gestures, with a remote in
hand for a few controls: sounds, reveals, a scene change. **Open:** which controls, and how a phone
reaches an offline desktop app. Nothing on the phone reaches the TV except through the app.
**Play · Phone**

### 116. Clouds drifting over the map
Filed 2026-09-24. Purely visual, for mood: cloud shadows passing over the revealed map on the TV.
**Needs /spec:** the look, whether it is per scene, and whether the DM sees it. **It adds GPU cost
on the Player**, and split view with an animated map is where the Player has stalled before, so
judge it in that case too.
Mood, not speed.
**Play · Player**

### 152. The logo mark without violet
Filed 2026-10-03 on the DM's instruction. 3.12.0 took violet out of every window, the splash and
the start screen, and left the logo mark violet in About and on the splash, where it matches the
app icon file. Redrawing it means the mark in `about.js` and `splash.html` and the icon files
together, so the installed icon and the in-app mark stay one picture.
**In progress (2026-10-30):** the direction is a new mark, not a recolour: a hex grid of uneven lit tiles that fades
into a solid edge. Still open: rounded square or circle, navy or app blue. Prototypes and the ruled-out directions
are in `.claude/private/design/item-152/` on the DM's machine.
**Polish · Both**

### 189. Doors follow a hex grid
Filed 2026-10-17, low priority. On a square grid a door snaps to the map's own grid cells. On a hex grid, and on any
diagonal wall, the Door tool cuts the wall into cell-sized steps from the room's corner instead, so a door can sit
across two hexes. Decide what a door one hex wide means on a hex wall, then make the preview and the click follow it.
**Needs /spec.**
**Polish · DM + Player**

---

# LIVE RULES THAT ARE NOT ITEMS

Kept here because forgetting them causes damage, and they have no other trigger.

- **NEVER delete anything in `%APPDATA%/Evermist/maps`.** A scene delete in the UI calls
  `deleteVideoFile`, so any "clean up unreferenced files" pass would destroy the whole map
  library. Unreferenced files there are normal and have been dismissed as a concern.
- **Auto-polygons is DONE as v1.** A change to it comes only with a specific problem or a bug
  report from the table. Do not open a
  speculative improvement session on it.
- **ROOMS are prep work** - they only get drawn mid-session when prep was skipped entirely.
  **EFFECTS are the opposite and this is not a contradiction: they are placed DURING play and
  persist, which is the entire point of them.** A cone of acid a zombie just vomited, fire still
  burning on dry grass. Do not generalise the rooms rule into a ban on in-play tools; that was
  done once and it wrongly argued against the effects feature the DM asked for.
- **The one real test for any in-play tool: can physical media do it better?** Nobody carries 120
  differently painted cones to the table, so the app wins that one. Where a token or a scrap of
  paper genuinely wins, don't build it.
- **Ground truth on the DM's maps:** all Dungeon Alchemist exports; primary case is INTERIORS with
  rooms sharing walls and connected by doorways; 7-12 rooms per floor, ~20 in the cellar, a few
  dozen maps. **Wall colour is not a usable signal** - DA walls can be dark, light, grass, snowy
  or cave stone. Never commit a `.webm`.
- **`tools/inspect-plan.js`** is the first thing to reach for on any floor-plan report.
  `node tools/inspect-plan.js <file>.dd2vtt`. Outside the build glob - keep it that way.
- **IF UNSURE ON A DRAWING OR EDITING CALL, COPY FIGMA** - a standing rule from the DM, right about 90% of
  the time. Do not simplify Figma's shape. A departure from Figma is written down as one.
- **The DM DOES use keyboard shortcuts** (2026-09-17, reverses the old rule outright). Figma's
  own keys are muscle memory.
  Take a key from Figma where Figma has one; invent one only when Figma does not.
- **EVERY SHIPPING COMMIT RELEASES.** The old "releases are RARE, 1-2 per minor" rule is dead as
  of 2026-09-08. A commit gets a local smoke pass; the full regression set runs in CI against the
  packaged `.exe` and gates the release. Never ask the DM to verify or regress-test an `.exe`.
