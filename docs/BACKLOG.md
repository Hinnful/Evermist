---
name: project-backlog
description: "Open work only. 17 open items; IDs run to 236."
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

`package.json` is at **4.12.0**. **No release has a planned scope** (2026-10-13): the DM bumps the major when
they decide to, so items carry no release tag. **The MCP epic comes first.** The First User Experience
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

# CLAUDE DOES THE PREP - THE MCP EPIC

Opened 2026-10-25. **The endgame:** Claude does everything a DM can do in Evermist except play. Play is what
changes the TV now or acts at the table: opening or sending a map, two maps, showing a picture, playing music or
sounds, TV setup, sync, ping, and the open fight's HP, conditions and initiative. Anything else is prep, and a
doubtful case is settled case by case from that logic. A fight is prep while it is built: placing monsters is
prep, taking away is play. **Deletes are allowed, with no trash:** the DM is told plainly that Claude can delete,
each delete waits for their yes, and undo lasts until Evermist closes. A trash and a saved history were rejected
as overengineering. Today Claude covers about two fifths of prep. The chapters go one at a time, in this order.
The open calls on scope are settled in PRODUCT.md, "Claude's ground rules".

### 227. Claude draws rooms and doors
Claude draws, names, writes notes for, reshapes and deletes rooms, merges, cuts and splits them, and marks doors,
on a map that is not on the TV. Each change is one undo step.
**Prep · DM only**

### 228. Claude sets the fog
Claude sets each room hidden, half or revealed, opens or closes an area, reveals or hides the whole map, and sets
the fog's drift and tint, on a map that is not on the TV.
**Prep · DM only**

### 229. Claude loads floor plans and module text
Claude loads a .dd2vtt floor plan and takes rooms, doors, lights and grid from it before its own outlines. It loads
a module text or PDF and links rooms to its entries; the app itself still never assigns.
**Prep · DM only**

### 230. Claude sets the grid, effects and lights
Grid on or off, its type and look, fitting it to the map; placing, changing and deleting effects; drawing lights
or taking them from a floor plan, and turning them on or off.
**Prep · DM only**

### 231. Claude fills the Campaign gaps
Groups of any shape, a map at an exact spot, editing, renaming and deleting roads, a map on or off a road, road
notes, the backdrop's size, opacity and position, and adding maps from a zip.
**Prep · DM only**

### 232. Claude fills the fight and bestiary gaps
Duplicating a fight, a row's details before the fight starts, and editing, deleting, duplicating and importing
bestiary monsters from an Evermist file.
**Prep · DM only**

### 233. Claude keeps the music library
Adding tracks from files or YouTube links, deleting tracks, and music groups. Playing stays play.
**Prep · DM only**

---

# EVERYTHING ELSE

### 234. The hints-next-map check fails at random
Filed 2026-10-25. The rig scenario `hints-next-map` needed a rerun in 4 recent CI runs on Windows (count of 2026-10-27). It fails on the
"Ready for the next map?" toast: the Campaign button does not blink, or the toast was not recorded. Find whether the
check reads too early or the app misses the blink, then fix the check or retire it.
**Upkeep · DM only**

### 235. The Campaign toolbar, redesigned
Filed 2026-10-25. Roads sit under the Groups tool, which reads as if a road were a kind of group, and item 184's
Straight walls sits alone over the drawing tools. Decide what the Campaign's toolbar holds and in what order, including
whether the party marker gets a button there (today only the right-click menu places it). **Needs a look-and-feel
pass.**
**Polish · DM only**

### 236. Move to Electron 45
Filed 2026-10-27. Evermist runs on Electron 43, which stops getting security fixes when Electron 46 ships, about
two months out. Move to 45, then run the full rig set and a packaged build before it ships.
**Upkeep · DM and Player**

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
