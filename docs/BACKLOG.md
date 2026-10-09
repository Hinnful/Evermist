---
name: project-backlog
description: "Open work only. 11 open items; IDs run to 169."
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

`package.json` is at **4.0.0**: play at the table plus the world map (PRODUCT.md). **5.0.0 is campaigns**, the
items under 5.0 below. Items under ANY TIME ship as 4.x patches and never hold 5.0 up. 2.12.0 to 2.15.3 are the
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
file; the unused imports go out in 4.0.1 with item 160. Done when both lists are empty.
**Upkeep · any time · no visible change**

### 160. "Walk only" stays English in the Russian bestiary
Filed 2026-10-08. The bestiary's Movement filter shows "Walk only" in Russian mode, while Fly,
Swim, Climb and Burrow are translated. The string is missing from `src/i18n/ru.js`; add it there.
Ships as 4.0.1 with 157's unused imports.
**Polish · any time · DM only**

### 166. A scene card over a place's corner blocks the corner
Filed 2026-10-08 in item 140, split out 2026-10-09. When a scene's print sits over a corner handle of a place being
edited, a press grabs the card and the corner cannot be dragged until the map pans. The corner should win while the
place is open for editing.
**Polish · 4.x · DM only**

### 167. A hint when a scene card is dropped partly outside a place
Filed 2026-10-08 in item 140, split out 2026-10-09. A card belongs to a place only when all of it sits inside the
outline, so a card dropped a few pixels over the edge leaves the place with no sign of why. **Open:** the cue - the
outline lighting while the card is fully in, or the card nudged inside on drop.
**Polish · 4.x · DM only**

---

# 5.0 - CAMPAIGNS

### 161. The gallery: one app-wide store of images
Filed 2026-10-08, rewritten 2026-10-09. A window of every image the DM keeps, still or animated (GIF and WebP included),
tied to no map, place, scene or room. It answers a monster that chases the party through several scenes: its picture
goes to the TV from the gallery, wherever the party is, without being placed in every room it passes.
- **The DM adds, names, finds and removes pictures there**, and drops a file on the window to add one. Any picture goes
  to the TV from the gallery. The TV's picture mode stays.
- **Room pictures go.** The room's picture strip and its "Add a picture" button are removed, and the pictures rooms
  hold today move into the gallery in a one-time migration. A backup carries the gallery once.
- Open for /spec: the window's look and where it opens from; whether removing a picture asks first; `/rollback` must
  leave the previous release able to open a scene whose room pictures moved out.
**Campaign · 5.0 · DM only**

### 164. The party flag on the world map
Filed 2026-09-29 in item 140, split out 2026-10-09. The DM drags a flag onto the scene or place the party is in. It is
apart from the open scene, since the DM preps scenes the party is not in, and scenes the party has visited look
different. **Look, settled 2026-10-08:** the Ping tool's bezel pared down to a thin gold ring with four diamonds,
turning slowly around the scene, with the mist thinning around it. **Open for /spec:** what "visited" looks like, and
whether the flag rides a backup. The TV never shows it.
**Campaign · 5.0 · DM only**

### 142. An MCP server, so an AI can prepare a session
Filed 2026-09-29 as a DISCUSSION. An AI client reads and writes the campaign: import a module,
place rooms, fill notes, build fights. The app works fully without it, which is what the
DECISIONS.md \"LLM in the loop\" rejection asked for. It exposes the campaign's shape as 4.0.0 ships it:
world map › place › scene › room, notes at each level, and roads.
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
