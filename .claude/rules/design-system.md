---
paths:
  - "src/**"
  - "index.html"
  - "stage.html"
---

# The design system

Loaded when you work on the interface. It holds every look rule: shape, fill, colour, line, tokens, sizes,
contrast, which selector is which atom. Layout and behaviour per screen stay in the `dm-ui` skill.
`test/designSystem.test.js` reads the tables below whose first column is Radius, Height, Style, Gap, Atom,
Outside, Text, Motion, Curve, Loop or Exempt, so each list lives here once. `test/designSystem.allow.json` holds what the CSS may still
break, counted per file; a count may only shrink, and a new entry is a decision for this file.

## Four axes

Every element answers four questions, each from a closed set. An element that needs an answer the set lacks
is a decision for this file, never a one-off.

| Axis | Question | Answers | Never |
|---|---|---|---|
| Shape | How do I interact with it? | the shape rule below | promises what is not there: a pill with no hover details, a plate that does not press |
| Fill | How important is it? | primary (solid blue), secondary (grey plate), tertiary (no fill until hover) | says whether it is picked |
| Colour | What state is it in? | blue tint: picked, on, mode in hand; solid blue: press this; red: danger; amber: warning | colours an action at rest, except the primary |
| Line | Where is focus, what is being edited? | the keyboard focus ring, the edit ring of a field, the insertion line of a drag | frames a thing or a button at rest |

## The shape rule

- **A plate round one label is a press.** Radius 6.
- **A frame round several things is a container**: a menu, a well, a group's frame, a toast at radius 8; a
  window, pane or the dock at 10.
- **A pill is hover for details.** Only a thing whose hover shows more wears one (a spell, a condition, a challenge
  rating). A spell wears it ahead of its details, until spell descriptions exist.
- **A sunk rectangle is a field you type into.** The well's pick-one pill never wraps a field.
- **A lone icon is a press**, and at rest it has no plate; the plate comes only with a state.
- **Plain text is text.** A count is plain dim text, never a badge.
- **A circle or a dot is an indicator.** A status word is a dot and the word.
- **A dashed outline is empty or unrecognised**: a drop zone, an attack the reader did not parse.

**The one exception: a control over a picture keeps a dark plate at rest**, or it vanishes on snow or in the
dark: the minimap's buttons (`.tv-ov`), ⋯ on a Pictures tile (`.ga-th .lib-more`), a column's close over the
map (`.pane-close`), and two marks: a Pictures tile's "TV" (a dot and the word, `.ga-tile.on .ga-th::after`) and the L
or R on a Campaign card a column holds (`.wm-card[data-col]::after`).

**Outside the system: the switch, the checkbox, the colour swatch, the slider and the scrollbar.** Everyone knows
them from other programs; the system does not redraw them and the shape, colour and radius rules skip their
selectors (the Outside table). A yes/no is always the switch, never a two-item well.

**Show on TV is always solid blue**, TV found or not: blue says press this, and the line under it says whether
a TV is found.

## Tokens

Colours come from `:root` in `base.css` and nowhere else. Surfaces are unchanged by the system. Three things stay
literal: a near-black shadow, veil or dark ground behind a picture (every channel 26 or under, never as text
colour), and white text on a solid fill laid by the same rule.

| Token | Value | Role |
|---|---|---|
| `--g-text` | #e4e6ea | main text, a name, a number |
| `--g-body` | #c8ccd3 | reading text (stat block, notes, a message); meta inside a picked, pressed or selected-hovered element |
| `--g-dim` | #9aa0aa | a label, meta, a placeholder, helper text, an icon at rest |
| `--g-mute` | #757a83 | only disabled, spent, separators (›) and the fight table's HP sample |
| `--b-icon` | #5cb1ff | text and icon on the tint; every thin indicator that must hold 3:1: the focus ring, the rename edit ring (`--plate-edit-ring`), insertion and drop lines, picked rings |
| `--b-solid` | #0a72bf | the primary fill, and only a fill |
| `--b-solid-h` | #0a76c4 | primary hover |
| `--b-solid-p` | #0868ad | primary pressed |
| `--b-tint` / `--b-tint-h` | rgba(12,140,233,.2) / .28 | picked, on, mode in hand / its hover |
| `--r-text` | #ff8a8a | danger under the pointer, an error |
| `--r-tint` | rgba(240,82,82,.16) | destructive tertiary hover |
| `--r-tint-p` | rgba(240,82,82,.26) | destructive tertiary pressed |
| `--r-solid` / `-h` / `-p` | #c9443a / #bb3a31 / #ad352d | a delete question's last button: rest, hover, pressed |
| `--y-text` / `--y-tint` | #f2c46d / rgba(242,176,60,.14) | a warning, a creature's condition, a recharge |
| `--live` | #5fbf8a | on the TV now, connected: a picture on the TV, a connected service's dot |
| `--g-bg` | #1e1e21 | window, pane, menu |
| `--g-raised` | #26272b | toast, tooltip, message bar, a row's plate |
| `--g-field` | #2a2b2f | plate, field, well, tile |
| `--g-hover` | #313237 | hover on a plate or a row |
| `--g-pick` | #45474e | pressed, the picked value in a well, a group's frame |
| `--g-line` | #2c2d31 | every line and divider |
| `--g-lay-raised` / `-field` / `-pick` | white at .04 / .058 / .185 | a plate inside a row the pointer lights; over `--g-bg` each is the grey it is named after |
| `--pop-shadow` / `--win-shadow` | | what pops over a pane (menu, toast, tooltip, a row's action bar) / a window; nothing that lies in its layer (dock, toolbar, tile) has a shadow |

The name plate's `--plate-*` tokens are one skin for every name the DM can rename and stay as they are.

**The domain set keeps its own colours**: enemy and ally, the three fog clouds, the damage types, the effect
material, the slot crystal and the brand mark. The interface palette and the shape rule do not reach them; their
tokens sit in `base.css` beside the interface's, and only these selectors use them.

| Domain | Tokens | Selectors |
|---|---|---|
| Enemy and ally | `--enemy` `--enemy-tint` `--enemy-line` `--ally` `--ally-tint` `--ally-line` | `.side-enemy` `.side-ally` `[data-side="enemy"]` `[data-side="ally"]` |
| Fog clouds (Reveal green, Half teal, Hide purple) | `--cloud-reveal` `--cloud-half` `--cloud-hide`, each with `-tint`, Reveal and Hide with `-glow` | `[data-dir="reveal"]` `[data-dir="half"]` `[data-dir="shroud"]` `#fp-frame[data-kind` |
| Damage types | set per type in JS as `--c` | `.cb-pill .pd` |
| Recharge | `--recharge` | `.cb-pill .pr` |
| Effect material | `--material-default`, under the material's own `--fx-col` | `.fx-shape.active` |
| Slot crystal | `--crystal` `--crystal-top` `--crystal-off` | `.sp-pp` |
| Brand mark | `--brand-word` | `.about-mark` `.about-wordmark` |

A change of hue is not on the table: the palette is unified and lifted for contrast, never recoloured.

## Scales

Heights bind the selectors the atom registry names; a layout size (a pane, a list, a canvas) is free. Type sizes
and gaps bind every rule in every stylesheet. `var()` and `calc()` values are exempt, and the test reads px values
only.

| Height | For |
|---|---|
| `20` | a small thing: a challenge rating, a condition |
| `24` | a dense control: an icon in a row, an item inside a well, a thing in text |
| `28` | the default control: a button, a field, a well, a menu row |
| `32` | a table or list row |
| `36` | the one large primary button on a screen (Show on TV) |

Window headers are 48 in a window and 42 in the dock, and the rail's highlight is a 34x30 square; the registry
gives those atoms their own height.

| Radius | For |
|---|---|
| `0` | a square edge |
| `4` | a checkbox, a key, an item inside a small well |
| `6` | every action and field, a menu row, a well item |
| `8` | a menu, a toast, a tooltip, a well, a container frame |
| `10` | a window, a pane, the dock |
| `50%` | an indicator, a round button |
| `999px` | a thing drawn as a pill |

| Style | Size | Weight | Where |
|---|---|---|---|
| Rail label | `9.5` | 500 | the names under the rail's icons |
| Meta | `11` | 400-500 | a count, a key, a badge, the dim sub-header over a control |
| Control | `12` | 500 | a button, a well, a field, a list row, a switch row's label |
| Plain text | `12` | 400 | a menu, a toast, a window's text |
| Reading | `13` | 400, line height 1.6 | the stat block, notes |
| Section title | `14` | 600 | a dock section's title, a group's title in a window, a note's title |
| Window title | `16` | 600 | a window's header, the dock pane's header |
| Section heading | `19` | 700 | Actions, Traits |
| Page title | `21-24` | 700 | a monster's name: 24, 21 in a narrow window |
| Number | `28-34` | 800 | AC, HP, abilities |

**Each level is a visible step**: a title is at least 2px larger than what sits under it, never only bolder.

| Gap | For |
|---|---|
| `0` | rows of one list, switch rows of one group |
| `2` | a well round its items |
| `4` | a sub-header to the control it names, an icon to its label inside a small thing |
| `6` | an icon to its label, controls in a row |
| `8` | controls in a row, cards in a grid |
| `12` | a section title to its content, groups in a row |
| `16` | blocks of one section, a window's padding |
| `24` | blocks of a page |

`gap`, `row-gap` and `column-gap` take a value from the Gap table. Padding and margin inside an atom come with the
atom.

**Proximity**: a label sits nearer the thing it names than anything else. A sub-header stands 4 from its control
and 16 from the block above; a section title 12 from its content. Switch rows of one group touch, 28 each, and
read as one list.

**Alignment: one row, one line.** Texts in one row stand on one shared baseline, whatever their sizes. A text more
than 1.5× smaller than the row's main (largest) text does not share its line: it goes on its own line, as a label above
a number or a source under a name. An icon, a plate, a switch or a button centres on the capitals of the row's main
text, by the middle of its box; a glyph with no capitals by its ink. Beside a block of two or more lines of text (a
name over its source, a title over its description), a box centres on the block as laid out, from its first line's
line box top to its last line's line box bottom (a line trimmed by `text-box` ends at its trim), as `align-items:
center` places it; a single line keeps its capitals' middle. Text in a plate centres on cap height (`text-box:
trim-both cap alphabetic`), and the plate centres on the row; a row centres its items (`align-items: center`) with each
text trimmed to its capitals, never a pixel nudge. A glyph with no capitals beside text (✓ › → × + ·, an arrow key) is
an icon from `icons.js`, which centres by its box, never a text character or CSS `content`. A button, a link and every
atom below are box items, filled or not: their text is not a bare text. The rig's `design-sweep` fails a row whose bare
texts are more than 1.5× apart in size or that writes a capless glyph as text (`lib.alignSweep`), and, read off 4x
screenshots (`lib.inkSweep`) averaged over where the row can land, a row whose texts' baselines differ by more than one
device pixel, or whose box, icon or glyph stands more than 0.25px off the main text's capitals (or a block's line boxes), a box by
its painted edges and an icon by its ink (in a row with no text, boxes against each other by their layout or painted
edges); and a vertical divider that stops short of its container's top or bottom.

The interface font is the system's; Alegreya is the TV's alone. **No
uppercase**: a heading is sentence case. Text in a button, a plate or beside an icon centres on cap height
(`text-box: trim-both cap alphabetic`), never on baseline maths. **No coloured stripe on a block's left
edge** (`border-left` in a colour); a divider is a grey line.

## Atoms

An atom is the smallest piece a screen is built from, with one look and one size. This registry says which
selector is which atom; a new control joins a row here before it ships. A Type cell binds the atom's type size.

| Atom | Selectors | Own heights | Type |
|---|---|---|---|
| Primary button | `.sm-hbtn.primary` `.tv-go` `#btn-edit-done` `.wm-bar-open` | | |
| Secondary button | `.sm-hbtn` `.cp-btn` `.cp-btn-outline` `.dk-load` `.dk-fit` `.dk-intbtn` `.dk-addb` `.tv-btn` `.bs-f` `.cb-save` `.nw-newb` | | |
| Tertiary button | `.dk-bare` `.dk-card-acts button` | | |
| Destructive button | `.sm-hbtn.danger` `.cp-btn-danger` `.dk-danger` | | |
| Icon button | `.sm-bare` `.sm-x` `.cb-iconbtn` `.bs-ib` `.nw-ib` `.cp-adv-close` `.cp-iconbtn` `.lib-more` `.lib-edit` `.pane-close` `.tv-ov` `.cp-stepbtn` `.pl-play` | | |
| Link | `.bs-link` `.dk-link` | | |
| Well | `.cp-seg` `.cp-tabs` `.fx-track` `.cb-side-switch` | | |
| Well item | `.cp-segtab` `.mode-btn` | | |
| Tool | `.tool-btn` `.tb-toggle` `.tb-chev` `.rf-door` | | |
| Field | `.sm-field` `.cp-field` `.tvs-field` `.sz-field` `.cp-chip` `.cp-chip-pre` `#mat-find` `#corner-field` `.rp-name` `.bs-pop select` | | |
| Number stepper | `.cp-stepper` `.dk-stepper` | | |
| Thing | `.cb-pill > span` `.cb-chip` `.bs-crb` `.cb-addcond` `.sp-sp` | | |
| Status word | `.sm-chip` `.bs-new` | | |
| Thing control | `.sp-lv` | | |
| Key | `kbd` | | |
| Menu row | `.sm-mi` `.dd-it` `.cf-item` `.cf-new` `.cb-menu div` `.bs-menu .it` `.bs-pop .o` `.rp-mt-opt` `.mt-tile` | | |
| List row | `.sm-row` `.mu-row` `.nw-row` `.sr-row` `.lib-gh` `.lg-row` `.cl-row` `.dk-file` `.dk-src` | | |
| Table cell | `.bs-t td` `.bs-t th` `.cb-cell` | | |
| Window header | `.sm-whead` `.cb-head` `.bsw-head` `.nw-head` `.dk-head` | `48` `42` | |
| Window title | `.sm-wtitle` `.dk-head .cp-adv-title` | | `16` |
| Section title | `#dock .cp-label` `.nw-row.sec` `.nw-appears .aph` | | `14` |
| Sub-header | `.dk-sub` | | `11` |
| Switch row | `.dk-swrow` | `28` | |
| Switch row label | `.dk-swrow > span` | | `12` |
| Rail square | `.rail-ind` | `30` | |

| Outside | Selectors |
|---|---|
| Switch | `.dk-switch` |
| Checkbox | `.sm-tick` `.bs-cb` `.cb-menu .box` |
| Colour swatch | `.cp-swatch` `.dk-swatch` `.cp-hue` `.cp-alpha` `.cp-sv-canvas` `.cp-sv-cursor` |
| Slider | `.cp-slider` `.ev-slider` `input[type=range]` `input[type="range"]` |
| Scrollbar | `::-webkit-scrollbar` |

### Button identity

- **Three tiers and a destructive kind.** Primary is solid blue, the action a window or row exists for (more
  than one may show; the rule marks what to press). Secondary is the grey plate (`--g-field`). Tertiary has no
  fill until hover, and sits only inside something that already reads as clickable: a pane, a header, a row, a well.
- **Solid blue is press this, the blue tint is picked.** `test/blueMeaning.test.js` holds the list of what may
  be solid. The tint with a `--b-icon` icon marks what is on or in hand: the tool, the row under the pointer in
  any list, a ticked box, the active column chip, snap, straighten, the edit row's Select, Pen or Bend, Two maps,
  the open rail tab, the Door button while Door is armed, a closed eye. A picked value in a well (`--g-pick`), a field
  and an open eye stay grey. A repair in force wears its own colour: Merge green, Cut out red, Split yellow.
- **Grey surfaces, no outlines.** Fields and buttons are filled grey, hover one step lighter; a control that
  writes its own hex drifts. No button has an outline at rest.
- **Destructive has no fill and carries the trash**, red only under the pointer (`--r-text` on `--r-tint`), and
  sits on the right of every footer, dialog and list toolbar. A delete question's last button is solid red
  (`--r-solid`); nothing else destructive is red at rest.
- **Controls are 28, 24 in dense places.** In a window `.sm-hbtn` is
  secondary, `.primary` the window's main action, `.danger` the destructive kind, `.sm-bare` an icon button. Close
  is the same icon button: 28 in a window, 24 in the dock and in rows.
- **An icon beside a label is centred in the row and never moved**: the label trims to its capitals, so the two
  centres meet. Icons come from `icons.js` (`uiIcon`). A text action that resets wears its icon ("↺ Reset", `uiIcon('reset')`).

### Wells and dividers

- **A well is a pick-one**: field grey, radius 8, 2px padding, the pick lifted on `--g-pick` with a soft shadow
  for a value, the blue tint for a mode or tool in hand. It is 28 tall with 24 items at radius 6.
- **One divider rule app-wide**: 1px of the line token, edge to edge across its container (a bar's full height,
  a menu's or the rail's full width, a field's full height), with no margin of its own; a menu's padding is
  cancelled with negative side margins so the line touches both edges. In a toolbar strip it keeps 8px clear on
  each side.

### Row heights

A list row and a table row are 32; the Notes tree's rows are 28. A menu row is 28.

## States

Every action has rest, hover, pressed, picked, disabled and focus. "Can be pressed" is the tier's rest look, not
a state of its own.

| Tier | Rest | Hover | Pressed |
|---|---|---|---|
| Primary | `--b-solid` | `--b-solid-h` (lighter) | `--b-solid-p` (darker) |
| Secondary | `--g-field` | `--g-hover` | `--g-pick` |
| Tertiary | none | `--g-field` | `--g-hover` |
| Destructive tertiary | none | `--r-tint` | `--r-tint-p` |
| Solid red | `--r-solid` | `--r-solid-h` | `--r-solid-p` |

Pressed is one step further from rest than hover: lighter for the grey tiers on this dark ground. **Disabled** is
40% opacity, no hover change, and a tooltip saying why. **Focus** is a 2px `--b-icon` ring with a 2px offset, on
keyboard focus only. **Picked** is the blue tint with blue text or icon; icons do not thicken for it.

**No state swallows a plate.** A plate inside a row that lights under the pointer or carries a state (open,
ticked) is a layer (`--g-lay-*`), so it moves with the row and stands off it in every state. A plate on a surface
that never changes stays a plain grey. A row with a state keeps it under the pointer and takes the state's own
hover: open `--b-tint-h`, ticked `--g-hover`. `lib.hoverSweep` in the `design-sweep` scenario forces `:hover` on
everything a hover rule repaints and fails a plate that merges with what it lies on, or stands off it worse under
the pointer while below 1.3:1.

## Contrast

WCAG 2 relative luminance; a tint is composed over `--g-bg`. Main and reading text (`--g-text`, `--g-body`)
holds 7:1 on every surface it sits on. State text (`--b-icon`, `--r-text`, `--y-text`), labels, meta and
placeholders hold 4.5:1, white on the solid buttons and their hover too. Icons and thin indicators hold 3:1.
Meta inside a picked, pressed or selected-hovered element uses `--g-body`, since `--g-dim` falls short there.
Exempt and kept dim on purpose: disabled, spent, separators, and the fight table's HP sample ("-12 damage"),
which stays dim so it never reads as real damage.

The test checks each pair below against the values in `base.css`.

| Text | On | At least |
|---|---|---|
| `--g-text` | `--g-bg` | 7 |
| `--g-text` | `--g-raised` | 7 |
| `--g-text` | `--g-field` | 7 |
| `--g-text` | `--g-hover` | 7 |
| `--g-text` | `--g-pick` | 7 |
| `--g-text` | `--b-tint` | 7 |
| `--g-text` | `--b-tint-h` | 7 |
| `--g-body` | `--g-bg` | 7 |
| `--g-body` | `--g-raised` | 7 |
| `--g-body` | `--g-field` | 7 |
| `--g-body` | `--g-hover` | 7 |
| `--g-body` | `--g-pick` | 4.5 |
| `--g-body` | `--b-tint` | 7 |
| `--g-body` | `--b-tint-h` | 7 |
| `--plate-text` | `--plate-bg` | 7 |
| `--plate-text` | `--plate-bg-hover` | 7 |
| `--g-dim` | `--g-bg` | 4.5 |
| `--g-dim` | `--g-raised` | 4.5 |
| `--g-dim` | `--g-field` | 4.5 |
| `--g-dim` | `--g-hover` | 4.5 |
| `--g-dim` | `--b-tint` | 4.5 |
| `--g-dim` | `--r-tint` | 4.5 |
| `--b-icon` | `--g-bg` | 4.5 |
| `--b-icon` | `--g-field` | 4.5 |
| `--b-icon` | `--g-hover` | 4.5 |
| `--b-icon` | `--b-tint` | 4.5 |
| `--b-icon` | `--b-tint-h` | 4.5 |
| `--plate-sel-text` | `--plate-sel-bg` | 4.5 |
| `--r-text` | `--g-bg` | 4.5 |
| `--r-text` | `--g-raised` | 4.5 |
| `--r-text` | `--r-tint` | 4.5 |
| `--r-text` | `--r-tint-p` | 4.5 |
| `--y-text` | `--g-bg` | 4.5 |
| `--y-text` | `--g-raised` | 4.5 |
| `--y-text` | `--y-tint` | 4.5 |
| `white` | `--b-solid` | 4.5 |
| `white` | `--b-solid-h` | 4.5 |
| `white` | `--b-solid-p` | 4.5 |
| `white` | `--r-solid` | 4.5 |
| `white` | `--r-solid-h` | 4.5 |
| `white` | `--r-solid-p` | 4.5 |
| `--b-icon` | `--g-pick` | 3 |
| `--plate-edit-ring` | `--plate-edit-bg` | 3 |
| `--b-solid` | `--g-bg` | 3 |
| `--live` | `--g-bg` | 3 |

## Molecules

A molecule is atoms in one order, taken whole rather than redrawn per screen.

- **Window header**: the title, tertiary icon buttons, close last.
- **Window footer**: secondary, then the primary or destructive one; the main one always on the right, and one
  only.
- **Menu**: one skin for every menu (`.sm-menu`), at the UI's zoom like every window: 28 rows, a check on the left only in a menu that
  ticks a row, the key on the right, a line
  between groups, the destructive row last, marked by its place and its red under the pointer, with no trash icon so
  the names keep one column. One width, 200. The row under the pointer wears the blue tint, a
  destructive one `--r-text` on `--r-tint`.
- **List row**: icon, name, meta, and ⋯ on hover. **⋯ opens the row's menu, with Delete last.** A right-click
  opens the same menu only where a right-click menu already exists; never in Music and Sounds, where the
  right-click stops or pauses. Picked is the tint; playing now is a grey plate.
- **Table row**: cells that are fields, an action bar on hover, 32 tall, hover `--g-hover`.
- **Dock section**: a title, its switch, sub-headers, wells and fields; 10/14 padding, a line under it.
  Switch rows sit together as one block after the wells and fields, never between them.
- **Header row**: the title, a text button and a switch, all on the title's centre line.
- **Popover**: an 8-radius surface of buttons and fields, 200, 260 or 320 wide.
- **Add**: one look everywhere a list grows, the secondary plate with the + icon and the word (`.dk-addb`): Music,
  Sounds, Pictures, the Notes tree's New, an empty Campaign.
- **Empty state**: a title at 14, one line of text, the Add plate, the same in every library and on an empty Campaign
  (`.ui-empty`, `libEmptyState`).
- **Toast**: text, a link action, close; bottom centre with a timer line.
- **Rename in place**: one look, the name plate's edit ring (`--plate-edit-bg` with a 1.5px inset
  `--plate-edit-ring`).

## Motion

Every surface that opens and closes moves by its kind, through `motion.js` and nothing else; the values are the
`--m-*` tokens in `base.css`, which the test holds to these tables. `test/designSystem.test.js` also reads the
Motion, Curve, Loop and Exempt tables, and fails any `transition` or `animation` in a stylesheet that is not on a
token, the hover colour, a Loop or an Exempt selector, and any `.animate(`, `style.transition` or `style.animation`
in `src/` outside `motion.js`, `player/playerMap.js` (the Player's scene cover) and `scenes/sceneDelete.js` (the undo
timer bar).

| Motion | In | Out | From | How |
|---|---|---|---|---|
| `menu` | `90ms` | `60ms` | what was pressed or right-clicked | there at once, no fade in: grows from scale .96 at the point nearest its trigger; fades out to .98 |
| `popup` | `90ms` | `60ms` | its anchor (a room, an effect, a control) | there at once, no fade in: 4px toward its anchor and .96; fades out half that |
| `window` | `150ms` | `100ms` | its rail button or opener | 20px toward the trigger and .96, from the window's point nearest it; leaves the same way, and the trigger glows once |
| `pane` | `160ms` | `110ms` | the rail | slides 24px from the rail's side, no scale |
| `pane-switch` | `90ms` | | | the content fades in; the pane does not move |
| `dialog` | `140ms` | `100ms` | the centre | .96 from the centre, the backdrop darkening on the same time; leaves to .98 |
| `toast` | `150ms` | `100ms` | the bottom | rises 12px; leaves 6px |
| `layer` | `50ms` | `40ms` | the whole screen | the Campaign: a full-screen layer, fades in at once over the map and out the same way; its camera flies on its own |
| `bar` | `90ms` | `60ms` | the toolbar | a row over the toolbar (the brush, effects, door and edit rows): there at once, rises 6px out of the toolbar; goes back down |
| `list` | `180ms` | | | a row glides to its new place on `--m-move` |
| `hover` | `120ms` | | | a colour or background change under the pointer |
| `still` | | | | what never opens or closes: the rail, bars, the minimap, rows of controls |

| Curve | Value | Use |
|---|---|---|
| `--m-enter` | `cubic-bezier(0, 0, 0, 1)` | everything that opens: starts at once, settles softly |
| `--m-exit` | `cubic-bezier(0, 0, .2, 1)` | everything that closes: starts at once, like an opening; a slow start reads as lag |
| `--m-move` | `cubic-bezier(0, 0, .2, 1)` | what starts and ends on screen: a row, a progress bar; starts at once |
| `opacity` | `linear` in, `--m-exit` out | on its own track; on the way in it is done by a third of the movement, on the way out it fades on the exit curve |

The rules:

- **A surface comes from its trigger and leaves to it.** Opened from code with no trigger, a window comes from its
  rail button and anything else from the centre.
- **Exit is about two thirds of enter.** Opacity is done by a third of the movement on the way in, so nothing hangs
  see-through over the map.
- **Never from scale 0, and no bounce or spring anywhere**: nothing here has momentum.
- **Interruptible.** Closed while opening, a surface turns back from where it stands; a reopen cancels a pending
  hide, and the surface stays open.
- **Open state flips at the press; only the picture lingers.** Code asks `motionOpen(el)`, never `hidden` or
  `style.display`, and a leaving surface takes no clicks.
- **What never moves**: the hover colour (it changes, at 120ms), a drag under the pointer, typing, the map and its
  fog, a scene switch, the TV and the Player.
- **Measured from the press, every time.** A surface is fully seen within its fade plus 50ms of the press (a menu, popup or
  bar, which do not fade, within 50ms), and at rest within its entry plus 50ms. `design-sweep` times every inventory
  entry from the real click, or from the call for one code opens, lists the times and fails one over. It reads times on
  frames, so each limit carries one frame for the reading, and a late surface is opened twice more and judged on the
  middle of the three.
- **A new surface takes its kind.** A surface no kind fits is a decision for this file.

| Loop | Keyframes | What |
|---|---|---|
| Spinners | `bsSpin` `muSpin` `tvSpin` | something is being read |
| Pulses | `tvPulse` | a live dot |
| Breathe | `tvBreathe` | the minimap while the TV is live |
| Bob | `wpBob` | the party marker on the Campaign |
| Music bars | `plBar` | the player's level bars |
| Search bar | `srSlide` | the search reading maps |
| Hint blink | `hintcallBlink` | the control a hint points at, three times |

| Exempt | Selectors | Why |
|---|---|---|
| Scene cover and switch | `#scene-fade` `#dm-switch-veil` | the map's own tuned motion |
| TV picture | `#tv-picture` | the TV's |
| Campaign cards | `.wm-card` `.wm-fc` `.wm-lm` | the Campaign's own glide |
| Party marker | `.wp-here` `.wmist-hole` | its glide and the mist hole that follows it |
| Minimap | `#minimap-canvas` | the minimap's own dimming |
| Switch knob | `.dk-switch` | the knob slides as everywhere else |
| Chevrons | `.car` `.sm-chev` `.nw-tw` | a fold's chevron turns |
| Column frame | `.pane-col::after` | the toolbar's column highlight |

## Building a screen

1. Name each element by its role: action, choice, field, thing, indicator, surface.
2. Take that role's atom. If none fits, stop: that is a decision for this file.
3. For an action, pick a tier; one primary per area of the screen.
4. Take states from the state table and values only from the tokens.
5. A repeated set of atoms is a molecule; take it whole.
