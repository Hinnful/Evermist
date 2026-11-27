# Architecture - weather

Split out of [ARCHITECTURE.md](../ARCHITECTURE.md): rain, snow and the other weather layers, in the present tense.

Each map carries one weather preset: No weather, Rain, Storm, Snowfall, Blizzard or Fair weather. The
DM picks the preset and nothing else; there is no strength or wind control. `weather.js` draws it with
one shader (`weatherShader.js`), a full-screen mesh between the map and the fog, so it shows on
revealed ground only. `weatherPlan.js` holds the numbers.

- **Strength wanders on its own.** Rain and snow swell and ease every minute or two, and soft heavy
  patches drift across. Lightning belongs to Storm. Fair weather has light cloud shadows, slow sunbeams
  and one small gust of short wind streaks every 20 to 40 seconds.
- **The ground follows the sky.** Puddles fill in about a minute and dry in about 2.5; settled snow builds
  in about 3 minutes and melts in about 5, faster under rain. Spots come from noise, a brown dirt colour
  and darkness, because maps carry no height data. A map that opens with a preset starts at its settled
  level; build-up happens only on a change during play.
- **Never inside a room**, whatever its fog mode, and rooms carry no switch. The Player gets a PNG
  room mask at the fog stencil's scale, geometry only, and still receives no room records. Storm and
  Blizzard darkness still dims a room's inside.
- **Two strengths.** The DM screen shows a third of full; the players' view (held H) shows full. On an
  animated map the DM screen draws rough puddle and snow shapes and the TV the exact ones.
- **A change fades over 8 seconds** and reaches the TV at once, like a fog colour change, never held for
  Send.
- **Saved** as the scene field `weather`; absent means none. It is its own edit-stamp part and rides in
  the backup manifest. For Claude's map edits and undo it joins the fog look's part. The previous release
  ignores the field, so a backup made on it drops the weather. Claude's `weather` and `fogTheme` map parts each undo alone.

**Time of day** gives every map four picks, None, Day, Dusk and Night, each one fixed filter with the same
numbers on every map (`timeOfDayPlan.js`, in linear light, its contrast turning about a fixed luminance rather than
the map's own). It is the first stage of the weather pass: the map pixel is graded, then the weather runs on it, so
weather and fog draw on top and lights and effects, drawn above the pass, are untouched. The pass draws whenever
Time of day is not None, even with No weather. Day lifts the dark parts everywhere, rooms included, and takes the
map's own lamp orange off the ground through a lamp mask built from one downscaled still. Dusk and Night change
everything outside rooms and add a warm glow just outside each one, from the room mask blurred; inside a room a dark
interior stays as drawn and bright ground dims a little. Both textures are built once per map or room change
(`timeOfDay.js`). Strength, the 8-second fade (old and new grades blended), the push to the TV without Send, the
saved field `timeOfDay` (absent is None, its own edit-stamp part, in the backup manifest) and Claude's own part
that undoes alone all follow Weather. On the DM's animated map, a video under the canvas, Day is a CSS filter on the
video and Dusk and Night a tint fitted on mid grey with the rooms cut out; the TV gets the exact filter.
