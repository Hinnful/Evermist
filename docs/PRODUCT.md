# Product

What Evermist is, who it is for, and what it will never do. Open this before proposing a
feature, before deciding whether an idea belongs in the app at all, and before writing
anything a user reads.

This file is written in the **declarative present**: what the product is and is not. How the
app works lives in [ARCHITECTURE.md](ARCHITECTURE.md), why the code is shaped the way it is in
[DECISIONS.md](DECISIONS.md), and the rules you must obey in [CLAUDE.md](../CLAUDE.md). A
past-tense sentence about something that was tried belongs in DECISIONS.md, not here.

**Status tags:** `SETTLED` (this is the shape, don't redesign it) · `REJECTED` (proposed, then
ruled out of scope) · `PARKED` (wanted, deferred).

**Adding an entry:** one heading, a status, and at most a short paragraph. A hook enforces
that budget.

**Write about the product, never about the people.** This file is public. No "the user", no
"he/she said", no "I recommended", no quoted remarks from a chat log. What a reader needs is
what the product does and why that held.

---

## What this is

### Evermist is a prep tool that also runs the game · `SETTLED` (positioning)
"Run cool maps on a TV" described the app until prep automation landed. With a map, its floor
plan and the module's text, preparing a session is most of the way to automatic, and each of
the three is useful alone: hand-drawn rooms still auto-populate from module text, and a floor
plan still draws rooms with no module. The framing is **prep efficiently, run beautifully**.
A positioning call rather than a scope expansion; the VTT line below is unchanged.

### The target is prep time, not mid-session time · `SETTLED` (scope call)
The app exists to make preparing maps fast. Mid-session is deliberately prep-free: that is when
the game gets run, not authored. Rooms only get drawn during play when prep was skipped
entirely, and prep gets skipped when the tools make it slow, so on-the-fly drawing is a symptom
rather than the workflow to optimise. **Do not propose in-play authoring aids**, and do not
read the habit of drawing mid-session as evidence that prep is fine.

---

## The line it will not cross

### The VTT line · `SETTLED`
No tokens, no initiative, no character sheets. Map, fog, grid, two screens.

**The test that decides new cases: could a physical object at the table do this job better?**
If yes, it doesn't ship. Minis, initiative trackers and dice all lose to their physical
counterparts, and finding, printing and painting a mini is part of the hobby rather than a
chore to automate away. Digital tokens exist only because online play has no alternative.

**Combinatorial explosion is what qualifies an exception**, not merely being an effect. A wall
of fire is any length at any angle and one spell of hundreds, so a pencil on the map is a
stand-in rather than a better option.

### Map effects are areas, not creatures · `SETTLED` (scope call)
Difficult terrain, persistent damage zones, light radius, Wall of Fire. No identity, no turn
order, no mini that moves each round, so this does **not** cross the VTT line. It reuses the
existing polygon tools, the Select tool and the card, and needs one genuinely new piece of
plumbing: a channel to the Player that does not exist today.

**Call them effects, never tokens** - in code, docs and UI. The word drags the conversation
back to creature markers every time anyone returns to it, and the creature question is settled.
They also get their own array, never mixed into `polygons`.

### No automatic cave subdivision, ever · `SETTLED` (scope call)
Where one cave ends and the next begins is judged by eye, and the same map divided twice by the
same person comes out differently. There is no ground truth for code to approximate, so any
shipped answer would replace a judgement call with an arbitrary one, and editing a machine's
arbitrary shape is slower than drawing your own.

The route to per-chamber rooms is the **split/scissors tool** rather than detection. The cavern
outline is edge-accurate, so two cuts across the narrow necks give geometry that is already
right. That promotes split over merge in the polygon-editing work.

---

### Blanking the Player screen · `REJECTED` (2026-09-07)
Proposed as one toggle covering the Player view in black. The app already answers it twice: the
fog's scene transition closes the whole view, and Manual mode holds the Player on whatever it was
last given. A third way to hide the screen is a third thing to remember mid-session.

---

### The Player screen shows no text of the app's own · `SETTLED` (2026-09-11)
The Player screen carries the map and the fog over it. No wordmark, no status line, no instruction,
at any moment - the seconds before the first map has decoded included, where the empty state is
drifting fog alone. A name on the TV reads as a title screen to the people at the table, and a
status line reads as a fault.

The DM window keeps that card's text. It names the app and points at the scene menu, which is
chrome for the person driving.

## What the features are for

### Auto-polygons: prefer missing a room over producing a bad one · `SETTLED` (design)
A skipped room costs exactly what today costs. A slightly-wrong one costs **more** than today,
because fixing someone else's shape is slower than drawing your own. Tune toward refusing
rather than guessing.

Two consequences that still govern. **Do not look for walls by appearance** - Dungeon Alchemist
walls can be dark, light, grass, snowy or cave stone, so any "walls are dark lines" approach is
dead on arrival. And the button is **inverted**: pressing it creates nothing, it lights up
candidate outlines that become real on click, so bad input is free.

### Map effects indicate an area, they are not rendered art · `SETTLED` (design)
An effect marks WHERE an area effect sits so combat stays legible; it is a tool, not a beautiful
VFX. It is drawn as a flaming border - the shape's outline burning inward with dissolving tongues,
over a faint fill, with sparks and smoke, and the map grid relit inside the zone so covered squares
stay countable. Clipped to the true shape so a circle stays a circle. Typed by material (fire, acid,
...), never per-spell: the combinatorics rule out a spell library, about a dozen types cover the
list, and size is drawn or typed. No metrics on the shape - no rounds, damage or duration, just the
area. Whole-room fill is out of scope: rare in play, and easier to paint into the map in Dungeon
Alchemist. Two looks were tried and dropped before this one - a filled seamless "material" per type,
and a lit interior grid - see DECISIONS.

### Doorways between rooms are derived, everything else is marked by hand · `SETTLED` (2026-09-01, reverses "never derived")
Players reading a revealed room across the table see its outline before they see anything inside
it, and a rectangle with no break in it says the room is sealed. A door is a notch of cleared fog
one grid square wide, which changes that outline.

Draw Rooms now marks every portal sitting on a wall two derived rooms share. A portal near only
one room is a window or an outside entrance and produces nothing. That filter is what answers the
old refusal: a secret passage into rock or open ground is never derived, and a doorway between two
rooms the plan already draws is not a secret the map was keeping. Reviewing a map before revealing
a room is part of prep either way. The Door tool still marks everything else, still works on a map
with no plan, and still removes a wrong guess in one click.

### Scene folders are list navigation, not map layers · `SETTLED`
Parked once as "batching three or four maps together", which measured the wrong thing. The
value is navigating a scene list that has outgrown its container: sixteen scenes in a thin
vertical strip with names truncated, so picking one is guesswork. A multi-storey building is
simply the case that produces sixteen scenes. The work is drag-and-drop into folders with no
change to what a scene is.

### Two maps at once is in scope, and it is about the minis · `SETTLED` (2026-09-10)
Evermist shows one map at a time everywhere else, and that stays true of the Player screen's
own behaviour. What is in scope is two maps SIDE BY SIDE, because a fight in a multi-storey
building moves between floors and switching the scene leaves every physical mini standing on
the wrong room. The value is that a mini never moves because a map changed, so both maps stay
live, and one Player window carries both floors with a chasm painted between them.
Two is the number, not "many": it is the case at the table, and each extra column costs a whole
copy of the app's memory. There is no compositing of the two maps into one image, no shared
camera and no layers - a floor is a scene, exactly as it already was.
**A map never reaches the TV unchosen.** The second column opens empty and shows fog until a map
is picked for it, because filling it with whichever map came next put a floor on the players'
screen nobody asked for. The band between the two floors carries fixed numbers with no control
over it, the same call the fire effect's look already took.

### Compression is opt-in, and the original is never the app's to lose · `SETTLED` (scope call)
Shrinking an oversized animated map at import is off until switched on, and it stays off for
anyone who never looks. The reason is not caution about the code: the app cannot know what
machine a map will be played on, and Evermist is public, so a default that re-encodes someone's
map is a guess about their hardware made at their expense. The people who need it are on weak
laptops and will find one switch; the people who do not need it should never be touched.
It is also a one-way door by design. Evermist replaces what it stores and keeps no original,
because the master archive is the Dungeon Alchemist project the map was exported from, and
duplicating a 100MB clip to hedge would double the cost the feature exists to cut. Anything that
reads as "Evermist lost my map quality" has to be traceable to a switch someone threw.

### Music is a mid-session control, and it passes the physical-object test · `SETTLED` (scope call)
The scope line above optimises for prep time and argues against mid-session *authoring*. Picking
a track is not authoring. The deciding test settles it: no physical object at the table plays
music, so the app wins that one outright. This is the same reasoning that licensed map effects,
which are placed during play. Do not read the prep-time line as a ban on in-play controls.

### Music never enters the backup zip · `SETTLED` (scope call)
A hundred hour-long tracks is about 5.5GB, and a backup is meant to be portable. The music
folder sits outside the scene store, so a restore on a fresh machine brings scenes and no music.
Adding it later would be one more folder to walk rather than a migration.

### Music is not grouped, and tracks always loop · `SETTLED` (scope call)
Typing three letters into the filter beats collapsing folders when a whole campaign is one
playlist, so subfolder groups were designed and dropped. Grouping starts earning its place at a
second campaign in one library. Looping has no switch either: an ambient track that stops
mid-scene is never what anyone wanted.

### No next or previous track · `SETTLED` (scope call)
A hundred ambient loops have no order a Next button could follow. The list is the control.

### The grid has no offset field · `SETTLED` (2026-09-09, scope call)
Two number boxes for X and Y phase were the only way to move the grid onto a map's own lines.
They are gone. A typed number cannot be aimed at a line, so the DM was reading a value off
nothing and nudging until it looked right; the calibration gesture is aimed at the line itself.
Grid Reset still returns the phase to zero, so nothing is a one-way door. Cell size keeps its
slider, because a size is a quantity someone can hold an opinion about and a phase is not.

### Distinctive fog identities · `PARKED`
The most interesting idea in its batch and too big for now. The shape when it lands: "bloody /
icy / acidic / rusty" are not tint values, they are combinations of knobs the cloud engine
already has (cell size, warp radius, warp strength, anim speed, base and tint colour, opacity).

---

## Versions and releases

### A major version marks a state worth celebrating · `SETTLED`
2.0.0 was originally tied to finishing the core of prep automation, and was deliberately
redefined. A major version should mark a state that can actually be shipped and celebrated, and
auto-polygons is an explicit hypothesis test that may fail, which is a bad thing to hang a major
bump on. 2.0.0 became the UI polish batch plus accumulated fixes, carrying the consolidated
README rewrite.

### Size releases conservatively · `SETTLED`
2.0.0 skipped 1.8 and 1.9 and landed on a docs-only commit, because a release tag has to match
`package.json` and that release published five versions together. A major version marking a
positioning shift outranks "bump only when the shipped app changes" for one commit. **This is
not a precedent for reaching for big numbers.** A release that rebuilt the whole Player scene
transition was still a patch.

### Every shipping commit is released, and the one human gate is a yes · `SETTLED` (2026-09-08)
A version bump used to mean "installable" and a tag meant "released". They are the same decision
now: bump the version and it ships, once CI has driven the packaged app through the whole rig
suite. Docs and tooling commits bump nothing and release nothing.

The point is to take the author out of the loop everywhere a machine can stand in. What is left
for a person is the yes on a commit's notes, and noticing at the table that something is wrong -
which no test can do, and which is why the ability to pull a release back matters more here than
a slower cadence would.

**This reverses "publishing stays a hand gesture" and "a version bump is not an intent to
release"**, both settled a day earlier. See DECISIONS for what changed the trade.

### A bad release is pulled back, and the app is allowed to go backwards · `SETTLED` (2026-09-08)
Shipping every commit means a mistake reaches people in fifteen minutes rather than whenever
someone chose to publish. The answer is not a slower pipeline, it is a recovery that works: the
release and its tag get deleted, and every installed copy is offered the previous version through
the same Restart button it already uses.

That is a promise about the app, not just about the pipeline. **An installed copy must always be
able to reach the newest release, in either direction.** It is why `latest*.yml` is checked on
every platform before anything is uploaded, and why the check treats a missing update pointer as
a release failure rather than a warning.

### An update never installs itself · `SETTLED` (2026-09-07)
A new version downloads in the background, and it applies only when the Restart to update button
is pressed. No other action may trigger it, quitting the app included. `autoInstallOnAppQuit`
stays `false`.

The app is opened to run a game in front of people. A version that arrives because the app was
closed the night before is a version nobody chose and nobody checked, and the place it first
runs is the table. Downloading early is free, so the button stays instant.

---

## The README and user-facing text

### The README gets one consolidated rewrite, never a paragraph per feature · `SETTLED`
Both `README.md` and `README.ru.md` are rewritten in a single pass when they are rewritten at
all. A per-feature paragraph accretes into a changelog nobody reads.

### The README leads with prep, and the floor plan comes last · `SETTLED`
The page opens on who it is for (DMs running TTRPGs in person) and states the app is free in the
first paragraph. Feature sections are ordered by **how likely a reader is to have the thing**,
not by how impressive it is: rooms and notes, then module import, then homebrew, then the floor
plan. **Promoting auto-drawn rooms to the top would be a regression.** The common reader has a
JPG out of a book and no `.dd2vtt`, and an unexplained file extension on the first screen reads
as "not for me". The floor-plan section opens on the condition rather than the filename for the
same reason.

### README conventions that look like mistakes · `SETTLED`
Four things a later edit would plausibly "fix" and should not:
- **"Room" is the only word for a drawn area**, never "shape" or "outline"; `Draw Rooms` is the
  button label, so docs and UI have to agree.
- **`assets/dm-window.png` shows no visible fog, deliberately.** DM fog sits at low opacity by
  design and the Player fog is already carried by `reveal.gif`.
- **The Russian README keeps UI labels in English** (Revealed, Shrouded, Half-shrouded, Player,
  Fullscreen, Manual), because translating them sends a reader hunting for absent buttons.
- **No image splits a paragraph**, and paragraphs carry no trailing full stop.
