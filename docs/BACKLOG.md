---
name: project-backlog
description: "Open work only. 12 open items; IDs run to 163."
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

`package.json` is at **3.13.3**. **4.0.0 lands when every item under 4.0 below is
built** (PRODUCT.md). Items under ANY TIME ship as 3.x patches and never hold 4.0 up. 2.12.0 to 2.15.3 are the
vector editing epic, now closed: two selection levels, curved walls, the bounding box,
copy/paste/duplicate, a radius on a curved corner, and shapes drawn as coloured areas.

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

Each item ends with its tags: category, release, then where it shows. An item takes at most two
categories. Effort and risk are judged once an item is picked, not here.

- **Prep** - makes getting a session ready faster, more scalable or easier to maintain.
- **Play** - the same, at the table during a session.
- **Campaign** - spans sessions: the world, its places, its notes. The 5.0 work.
- **Polish** - a visible gap or small QoL fix the DM would notice.
- **Upkeep** - checks, CI, docs: nothing the DM sees ships.
- **Bug** - the app does something wrong.

---

# ANY TIME

### 46. A second effect material needs a look, not a code change
The shader reads all six colour stops from the material record (`src/render/effectMaterials.js`),
so a new material is a record and nothing else - ramp, warmth, swatch.
**WHAT IS LEFT IS A LOOK CALL, and it is the DM's.** What the second material is, what it burns
like, and what its button says. `acid` was deleted rather than shipped last time.
The second material also brings the searchable material palette settled in item 113's prototype
(`.claude/private/design/item-113/effect-presets.html`): the flame button with a corner tick opens
it above the row. Not built with one material, per CLAUDE.md.
**Play · any time · DM + Player**

### 144. A phone remote for the DM
Filed 2026-09-29 as a DESIGN DISCUSSION. The DM stands up, walks and gestures, with a remote in
hand for a few controls: sounds, reveals, a scene change. **Open:** which controls, and how a phone
reaches an offline desktop app. Nothing on the phone reaches the TV except through the app.
Kept out of the 4.0 gate because its size is unknown.
**Play · 4.x · Phone**

### 116. Clouds drifting over the map
Filed 2026-09-24. Purely visual, for mood: cloud shadows passing over the revealed map on the TV.
**Needs /spec:** the look, whether it is per scene, and whether the DM sees it. **It adds GPU cost
on the Player**, and split view with an animated map is where the Player has stalled before, so
judge it in that case too.
Mood, not speed: no release until the DM decides.
**Play · Player**

### 152. The logo mark without violet
Filed 2026-10-03 on the DM's instruction. 3.12.0 took violet out of every window, the splash and
the start screen, and left the logo mark violet in About and on the splash, where it matches the
app icon file. Redrawing it means the mark in `about.js` and `splash.html` and the icon files
together, so the installed icon and the in-app mark stay one picture.
**Polish · Both**

### 157. Bring the frozen files under the house-rule limits
Filed 2026-10-07. `test/houseRules.allow.json` and `eslint-suppressions.json` list what was over a
limit when the limits became tests: six files over 600 lines, eight functions over 120, thirteen
comment blocks over 8 lines and four unused imports in `electron/`. Each split is its own
restructuring task on the DM's yes, one file at a time, taken when a feature already touches that
file; the unused imports ride the next release. Done when both lists are empty.
**Upkeep · any time · no visible change**

### 162. Release 4.0.0 in four stages
Filed 2026-10-08, rewritten 2026-10-09 as the handoff for the 4.0 release. Everything since 3.13.3 sits on branch
`wip/notes-left-panel`, committed locally and never pushed: the notes panel, the world map with places and roads,
Two maps, and the Scene library's removal. PRODUCT.md's "4.0.0 also carries the world map" says why it is 4.0.
The DM's order. Commit to the working branch freely; push nothing before stage 4. The rig is the DM's to allow per session.
- **Stage 1, analysis: DONE 2026-10-09.** A UX audit found 7 blockers and about 15 gaps. All are fixed, each proved red
  then green. Before the fixes the full rig regression passed 36 of 45. The "after 4.0" gaps the audit found are not
  filed; propose them to the DM in stage 3.
- **Stage 2, code review: DONE 2026-10-09.** Four Sonnet reviewers and a fifth sorting the rig reds. Five app bugs
  fixed, each proved red then green: a scene opened from the world map came up with the last scene's room picked; the
  right-click Delete on the open scene switched the TV; a Two maps column filled from the map had its notes overwritten
  by the previous scene's; moving a scene card or reshaping a place cut the road ends stuck to it; Ctrl+Z on a place
  dropped it instead of keeping it picked as a room does. Rollback to 3.13.3 and backup round-trips were traced clean.
  The rest of the reds were stale checks, now repaired: `world-map`, `world-roads`, `notes-panel`, `two-maps` and
  smoke all pass.
- **Stage 3, README and docs: DONE 2026-10-09.** README rewritten for 4.0 with five animated WebP clips recorded off-screen
  on the DM's own maps; item 121 closed. Item 140 cut to what is left after 4.0, the ledger's early world map entries point
  at their replacements, and two comments name the right files. The recording found one bug, fixed: a module fill left the
  room's notes field at its old height. The stage 1 audit's "after 4.0" list was lost with that session.
- **Stage 4, release.** 4.0.0 on a `release/4.0.0` branch through `/commit`, one commit; watch CI, fix, amend, push
  again. `npm test` fails the changelog version check until CI regenerates `changelogData.js`; that is expected.
**Upkeep · 4.0 · Both**

### 163. World map toolbar polish
Filed 2026-10-09 at the DM's word: the world map's toolbar, as built, is a no-go. It is the scene's own bar with tools
swapped in: Select, Shape, Merge or Cut out or Split, Straighten, then Add a scene, Road and Find.
Agreed 2026-10-09 and built: three clusters, as the scene's bar groups its tools - Select, the drawing tools, the boolean
operations and Road; then Add a scene and Find; then Straighten. Add a scene wears a plus. Road is a tool, so it wears
the solid blue. Find is built too: a result list under the field, grouped Places, Scenes and Roads, with a count, finding
scenes outside the view. It matches names only; notes text is a later step.
**Polish · 4.0 · DM only**

### 160. "Walk only" stays English in the Russian bestiary
Filed 2026-10-08. The bestiary's Movement filter shows "Walk only" in Russian mode, while Fly,
Swim, Climb and Burrow are translated. The string is missing from `src/i18n/ru.js`; add it there.
**Polish · any time · DM only**

---

# 5.0 - CAMPAIGNS

### 161. The gallery: one app-wide store of images
Filed 2026-10-08. A window of every image the DM keeps, linked to no scene. It replaces today's room
pictures, which each scene stores in its own record and which the previous release's autosave trims
when no room uses them.
- **One store, every picture once.** Rooms, scenes and places link to a picture and never hold its
  bytes, so one picture of a castle serves many. Today's room pictures move into it in a one-time
  migration. A backup carries the store once.
- **The DM adds, names, finds and removes pictures there**, and drops a file on the window to add one.
  A picture can go to the TV from the gallery without belonging to any room.
- **The old room-picture strip and its "Add a picture" button are removed**, replaced by picking from
  the gallery. The TV's picture mode stays.
- Open for /spec: how a room, scene or place picks and shows a linked picture; whether deleting a
  picture that is linked asks first; `/rollback` must keep room pictures visible to the previous release.
**Campaign · 5.0 · DM only**

### 140. The world map after 4.0: the party flag and the rough edges
Filed 2026-09-29, cut down 2026-10-09: the world map, places, roads, the notes panel and the Scene library's removal ship
in 4.0.0. Every settled call is in decisions/ui-and-control-panel.md, from "The world map v1" on. What is left:
- **The party flag.** The DM drags a flag onto the scene or place the party is in. It is apart from the open scene, since
  the DM preps scenes the party is not in. Scenes the party has visited look different. **Look, settled 2026-10-08:** the
  Ping tool's bezel pared down to a thin gold ring with four diamonds, turning slowly around the scene, and the mist thins
  around it.
- **A switch to turn the world map's mist off**, at the DM's word.
- **Pictures on a place** wait for the gallery (item 161).
- **Rough edges found while building**, each a small fix or a UX call: a scene card over a corner handle blocks it until
  the map pans; a card dropped partly outside a place is out with no hint of how far; Alt+drag does not copy a place.

**The TV never shows the world map, a place or a road.** Auto-filling places from the module is
NOT a promise.
**Campaign · 5.0 · DM only**

### 142. An MCP server, so an AI can prepare a session
Filed 2026-09-29 as a DISCUSSION. An AI client reads and writes the campaign: import a module,
place rooms, fill notes, build fights. The app works fully without it, which is what the
DECISIONS.md \"LLM in the loop\" rejection asked for. Waits for 140 part 2, because it exposes the
campaign's shape: world map › place › scene › room, notes at each level, and roads.
**Campaign · 5.0 · DM only**

---

# BUGS

None open.

---

# LIVE RULES THAT ARE NOT ITEMS

Kept here because forgetting them causes damage, and they have no other trigger.

- **NEVER delete anything in `%APPDATA%/Evermist/maps`.** A scene delete in the UI calls
  `deleteVideoFile`, so any "clean up unreferenced files" pass would destroy the whole map
  library. Unreferenced files there are normal and have been dismissed as a concern.
- **Auto-polygons is DONE as v1.** A change to it comes only with a specific problem or a bug
  report from the table. Do not open a
  speculative improvement session on it. Item 1 is the exception, because it was asked for
  unprompted.
- **ROOMS are prep work** - they only get drawn mid-session when prep was skipped entirely.
  **EFFECTS are the opposite and this is not a contradiction: they are placed DURING play and
  persist, which is the entire point of them.** A cone of acid a zombie just vomited, fire still
  burning on dry grass. Do not generalise the rooms rule into a ban on in-play tools; that was
  done once and it wrongly argued against the effects feature the DM asked for.
- **The one real test for any in-play tool: can physical media do it better?** Nobody carries 120
  differently painted cones to the table, so the app wins that one. Where a token or a scrap of
  paper genuinely wins, don't build it.
- **Ground truth on the DM's maps:** all Dungeon Alchemist exports; primary case is INTERIORS with
  rooms sharing walls and connected by doorways; 7-12 rooms per floor, ~20 in the cellar, ~10
  maps total. **Wall colour is not a usable signal** - DA walls can be dark, light, grass, snowy
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
- **CLAUDE.md rules for map effects land WITH the code**, not before: effects get their own
  array, never mixed into `polygons`. Already reasoned out in DECISIONS.md, so state it tersely
  and pay the bytes once.
