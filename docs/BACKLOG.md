---
name: project-backlog
description: "Open work only. 3 open items; IDs run to 283."
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

`package.json` is at **5.7.0**: music syncs through Google Drive, Settings shows how full the Drive is, and the floor plan card shows the plan's file name. **5.6.0** rebuilt Map settings in plain words with dashed and dotted grid lines, and a door placed with the Door tool fades in on the TV. **5.5.2** made doors a quarter cell deep and glowing on the TV, and lets a map picture a sync replaced be restored. **5.5.1** fixed Export and Import of a large library. **5.5.0** added Google Drive sync. **The 5.0 epic, the prep pipeline, closed on 2026-10-31 with 5.0.0**: search,
the Notes window, links, the AI assistant filling notes, the new logo and the README. No item carries a release tag.
**The MCP epic closed on 2026-10-28 with 4.13.0.** The First User Experience
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

# EVERYTHING ELSE

### 259. Time of day
Filed 2026-11-04. A list of its own beside Weather (day, dusk, night), so a sunny preset on a night map stops being a
mismatch the DM has to avoid. Floated by the DM while weather was settled; nothing about it is designed yet.
**Needs a design round.**
**Play · Player**


### 276. Google's sign-in calls Evermist an unverified app
Filed 2026-11-07, with 5.5.0. Connect to Google shows Google's "unverified app" warning until Google reviews the app's
brand; that review needs the privacy policy on a domain the project owner proves to own (today `PRIVACY.md` sits on
github.com). Every DM who connects sees the warning first.
**First use · Polish · DM only**


### 283. A trash that works without Google Drive
Filed 2026-11-08, with 5.6.2. Without sync, a deleted map is gone after the next delete or a restart; only the toast's
Undo brings it back. The DM wants Recently deleted on every computer, with or without Google Drive: a deleted map stays
30 days with Restore and Empty now, and with sync on a delete or restore reaches the other computer. Settings' Recently
deleted line in Campaign already exists; today it shows only with sync. Care points: a deleted map keeps its picture or
video on disk for 30 days, and after a `/rollback` the previous release must neither show a trashed map as a normal one
nor lose it. Needs `/spec` before building.
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
