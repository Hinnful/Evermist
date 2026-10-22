---
name: project-backlog
description: "Open work only. 25 open items; IDs run to 213."
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

`package.json` is at **4.6.6**. **No release has a planned scope** (2026-10-13): the DM bumps the major when
they decide to, so items carry no release tag. **The First User Experience epic comes first**: Evermist is about to be
shared, and new features wait while it runs. 2.12.0 to 2.15.3 are the vector editing epic, now closed: two selection
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

# FIRST USER EXPERIENCE - THE NEXT FOCUS

### 172. The epic: a new DM finds what Evermist already has
Filed 2026-10-12, diagnosis rewritten 2026-10-13 from the first new DM's questions while preparing a one-shot.
Evermist is about to go to other DMs, for their feedback and requests. **The features a new DM needs exist; the DM
cannot find them or read what they do.** Every question that DM asked had an answer in the app. Three causes repeat:
Scene Control groups its controls by the app's objects (Player, Fog, Rooms, Lights), not by the DM's tasks; the
labels use the app's words, not the DM's ("TV", "what the players see"); and every control carries the same visual
weight, so the one that matters sits unmarked among the ones that do not. A tutorial does not fix it: the interface
stays as heavy.
**The test for every item below.** Sasha has played for two years and DMs for the first time. They bring four
JPEGs of poor quality with no grid and no floor plan, a TV with an HDMI cable, a playlist, and a module PDF or rough
notes. With no help and no reading, Sasha gets the four maps in, puts one on the TV fogged, reveals part of it, plays
music, and switches to another map. Anything Sasha meets on the way that does not serve that path counts against the
epic. The same path must not slow an experienced DM or hide the deeper features.
**Out of the first evening:** floor plans, the bestiary, effects and light, vector editing. Sasha finds them later.
**Out of this epic:** what a DM sees before installing. That is distribution, and it comes later.
**First use · DM + Player**

### 203. First-time hints for Music and Sounds
Filed 2026-10-18 as a DESIGN DISCUSSION. **First of the hint items**: music is part of almost every game. No hint
says how to get a track in, play it, or that a sound plays over the music. Built on the first-time hints
(`hints.js`): one toast per action, where the action happens, each shown once ever. **Open:** which moments earn a
hint (the pane opened empty, the first track added, the first sound), what each says, and how it fits item 199.
**First use · DM only**

### 204. First-time hints for the Bestiary and the fight table
Filed 2026-10-18 as a DESIGN DISCUSSION, wanted but not urgent. Neither says what it is for or where to start: adding
a monster, putting it in a fight, reading its stat block. **Open:** which moments earn a hint, and what each says.
**First use · DM only**

### 205. First-time hints for groups on the Campaign
Filed 2026-10-18 as a DESIGN DISCUSSION, wanted but not urgent. Nothing says the Campaign can gather maps into
groups: drawing one, a map dropped inside it belonging to it, its name and notes. **Open:** which moments earn a hint,
and what each says.
**First use · DM only**

### 206. A ping without a middle button
Filed 2026-10-19, deferred from the touchpad release (4.6.4). A ping needs Ctrl+middle-click, and a touchpad has no
middle button, so a DM on a laptop cannot ping. `P` pings the map at the cursor (`ui/input.js`, `render/ping.js`).
The shortcut list in `index.html` names it.
**Play · First use · DM + Player**

### 199. Local music files can get into the app
Filed 2026-10-18 from the item 172 audit. The empty Music pane says "drop audio files into the app's music folder",
and nothing says where that folder is. The pane takes no drop and has no add button, so a DM with local files has no
way in. YouTube links work. **Needs /spec:** a picker that copies files into the music folder, a button that opens
the folder, or both. The folder stays flat (PRODUCT, "Music groups are made in the app").
**First use · DM only**

### 200. Opening a map does not put it on the TV
Filed 2026-10-18 from the item 172 audit; the DM has met it too. In Auto sync, opening a map sends it to the TV at
once (`sceneSwitch.js`), so a DM cannot look at the next map privately. Manual sync holds it, but Manual sits behind
the minimap's "…" menu and also holds every reveal. **Needs /spec:** how the DM opens a map without the TV following,
and how the map then goes to the TV.
**First use · Play · DM + Player**

### 208. The TV is not found when its cable was plugged in before Evermist started
Filed 2026-10-22 from a new DM's first evening on a Mac. With HDMI already connected, Evermist starts and reports no
TV; unplugging, starting Evermist, then plugging in finds it. The display list is likely read once and never
listens for the screen that was there at launch (`electron/displays.js`, `player/tvControl.js`).
**Bug · DM + Player**

### 209. The Campaign does not zoom out far enough, or pan, to reach every map
Filed 2026-10-22 from a new DM on a touchpad. Maps beyond the window could only be found by shrinking the window;
zoom out should reach about 130% of all maps. **Check first** whether the touchpad support in 4.6.4 fixed it.
**Bug · DM only**

### 210. Hints follow what the library holds, not the DM's first action
Filed 2026-10-22. A DM whose maps Claude made never sees the first-map hints, because they start from a hand-made
first action. A hint that reads the state (a map with no rooms, rooms never shown on the TV) reaches that DM too.
**Waits for the interface rework**; the hint set will change with it.
**First use · DM only**

### 211. Right-click actions on a map, a group and the empty Campaign
Filed 2026-10-22. A new DM looks for actions on the object: create a group here, add maps into a group, open a
map's notes. The Campaign has a right-click menu (`world/worldMapMenu.js`); **Needs /spec:** what each object's
menu holds, with every item still reachable from a visible button.
**First use · DM only**

### 212. A new DM does not find effects
Filed 2026-10-22. Fire, acid and light sit behind the Fog / Effects switch at the bar's end, and a new DM never
meets them during prep. **Open:** where effects show themselves to a DM who has never switched modes.
**First use · DM only**

### 213. Show on TV stays a live button while no TV is found
Filed 2026-10-22. The minimap's solid blue Show on TV sits above "No TV found", so pressing it says nothing about
what it will do (`player/tvControl.js`).
**Polish · DM only**

---

# CLAUDE DOES THE PREP

### 207. Claude sees the map and preps its rooms
Filed 2026-10-19, the part of the Claude prep work 4.6.5 left. Claude can make scenes but cannot yet see them, so it
cannot draw rooms or place anything on a map. Prep only; nothing reaches the TV, every change takes one undo step.
- **Test first:** Claude gets a small picture of a scene with its rooms drawn on it, positions in percent of the map.
  On three of the DM's real maps, check how close Claude's room outlines land. The result sizes the rest.
- **Rooms and fog:** Claude creates, reshapes and deletes rooms, names them and writes their notes from a module or
  the DM's notes, and sets each one hidden, half or revealed. Claude reveals or hides the whole map or an area. It
  works on a scene that is not open, through the saved scene.
- **Floor plan and module:** Claude loads a .dd2vtt floor plan (rooms, lights, grid) and uses it before its own
  outlines. Claude imports a module PDF and links rooms to its entries; the app itself still never assigns.
- **Effects and lights:** Claude places, changes and deletes them.
**Prep · DM only**

---

# EVERYTHING ELSE

### 184. Straight walls sits alone over the world map's drawing tools
Filed 2026-10-16. With the repairs gone from places, the row over a place tool holds one icon, Straight walls, and it
looks stranded. Decide what that row is for on the world map: give it company that earns its place, fold Straight walls
somewhere else, or drop the row. **Needs a look-and-feel pass.**
**Polish · DM only**

### 187. Two new effect materials: a plain area, and difficult terrain
Filed 2026-10-16. An area that only marks where something happens, such as Slow or Silence, and Difficult terrain.
Vines, snow and mud look different but play the same, so Difficult terrain may be one material. Each is its own
material record (`effectMaterials.js`), since a colour picker per effect was rejected. **Needs /spec:** the look of
each, and whether Difficult terrain needs an effect at all.
**Play · DM + Player**

### 180. The toolbar shows which mode it is in
Filed 2026-10-13 from item 175's sketch. The sketch moves Fog / Effects into a side tab at the right end of the toolbar,
a cloud over a flame, and a new DM may not read either icon. A glow around the whole toolbar, cool for Fog and the
effect outlines' orange for Effects, would say the mode without the DM reading the switch. The glow was tried in the
sketch (`.claude/private/design/item-175/fog-home.html`) and set aside until there is time to judge its look.
**Needs /spec:** the look of each mode, and how strong it is on dark and bright maps.
**Polish · DM only**

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
**Polish · Both**

### 157. Bring the frozen files under the house-rule limits
Filed 2026-10-07. `test/houseRules.allow.json` and `eslint-suppressions.json` list what was over a
limit when the limits became tests: six files over 600 lines, eight functions over 120 and thirteen
comment blocks over 8 lines. Each split is its own
restructuring task on the DM's yes, one file at a time, taken when a feature already touches that
file; the unused imports are done. Done when both lists are empty.
**Upkeep · no visible change**

### 164. The party flag on the world map
Filed 2026-09-29 in item 140, split out 2026-10-09. The DM drags a flag onto the scene or place the party is in. It is
apart from the open scene, since the DM preps scenes the party is not in, and scenes the party has visited look
different. **Look, settled 2026-10-08:** the Ping tool's bezel pared down to a thin gold ring with four diamonds,
turning slowly around the scene, with the mist thinning around it. **Open for /spec:** what "visited" looks like, and
whether the flag rides a backup. The TV never shows it.
**Campaign · DM only**

### 189. Doors follow a hex grid
Filed 2026-10-17, low priority. On a square grid a door snaps to the map's own grid cells. On a hex grid, and on any
diagonal wall, the Door tool cuts the wall into cell-sized steps from the room's corner instead, so a door can sit
across two hexes. Decide what a door one hex wide means on a hex wall, then make the preview and the click follow it.
**Needs /spec.**
**Polish · DM + Player**

### 195. Notes as linked Markdown files
Filed 2026-10-17 as a DESIGN DISCUSSION. Keep notes in `.md` files, Obsidian-style, so they can grow links between
notes, references and mentions. References to read first: Obsidian and Morrow (github.com/Aarav2709/Morrow). Notes
today live in the app's database (DECISIONS, "Notes are stored as a scene field and one campaign value"), so files on
disk mean a new storage design that the previous release can still roll back over. Waits for the First User
Experience epic.
**Campaign · DM only**

### 196. Balance the Linux rig shards
Filed 2026-10-18. A release waits about 23 minutes, and Linux sets that time. In the 4.6.2 run one Linux shard took 21
minutes while the others took 10 to 18, and every Windows and Mac shard finished within 11. The dealing in
`gate.yml` deals named slow scenarios first, then every Nth by name, so it ignores how long each scenario takes.
Linux only advises, but `land` still waits for it. More Linux jobs was rejected (DECISIONS, "Windows is dealt six
ways": its time is software GL, not queueing), so this is about dealing the same scenarios more evenly, for example
by the times the shard reports already record. Done when the slowest Linux shard sits near the others.
**Upkeep · no visible change**

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
