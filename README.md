# Evermist

**English** · [Русский](README.ru.md)

An app for D&D: puts maps on a TV and adds **fog of war** that can be wiped away live from a second screen.

![Revealing fog on the player view](assets/reveal.gif)

[![Latest release](https://img.shields.io/github/v/release/Hinnful/Evermist?label=download&sort=semver)](../../releases/latest)
[![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux-7c6fb0)](../../releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Everything runs locally - one window stays on the laptop, the other goes out to a TV or projector for the players. The dungeon opens up gradually, as the party explores.

> **IMPORTANT: this is not a full VTT.** No tokens, no initiative tracker, no dice. Evermist does one thing - show a map and hide parts of it. But it does that part beautifully.

## Features

- **Two screens, in sync.** A DM window and a clean player window (no buttons, no cursor) for the TV.
- **Living fog of war.** Soft, with animated clouds, not a flat black fill. Wiped away with a brush, or set reveal and hide regions as separate shapes that can be edited later.
- **Grid.** Type (squares or hexes), size, offset, color, and opacity are all adjustable.
- **Static and animated maps.** Supports JPG/PNG, or animated MP4/WebM maps (for example, from Dungeon Alchemist).
- **Scenes.** Save several maps and switch between them mid-game, with a smooth transition.
- **Big maps.** Runs smoothly even on 10000×6000 maps.

## See it in action

**Animated maps** - video maps (water, torchlight) play live under the fog.

![Animated map playing under the fog](assets/animated-map.gif)

**Shape tools** - carve out clean rooms with rectangle, circle, and polygon reveals.

![Drawing reveal and shroud regions](assets/tools.gif)

## Download

Grab the latest version from [**Releases**](../../releases/latest):

| System | File | Notes |
|--------|------|-------|
| Windows | `Evermist-<version>.exe` | Portable, no install needed, just runs |
| macOS | `Evermist-<version>.dmg` | Universal (Intel and Apple Silicon) |
| Linux | `Evermist-<version>.AppImage` | Make the file executable, then run |

### First launch

On first launch the OS shows a one-time security warning. Evermist is free and **not code-signed** - signing certificates cost money.

- **Windows:** if "Windows protected your PC" appears, click "More info", then "Run anyway".
- **macOS:** if "Evermist can't be opened because Apple cannot check it…" appears, right-click the app, choose "Open", then "Open" again in the dialog. (A normal double-click won't offer this the first time.)
- **Linux:** make the AppImage executable (`chmod +x Evermist-*.AppImage`, or Properties → Permissions → Allow executing file as program), then run it as usual.

The OS remembers the choice, so this only happens once.

## Getting started

When Evermist opens, the **DM window** appears. This is the control panel.

1. **Open the player window.** In the right sidebar, under **Player**, click **Open Window**. A second window appears, no buttons - this is what the players see. Drag it to a TV or second monitor, and click **Fullscreen**.
2. **Load a map.** Drag a map file (JPG, PNG, MP4, or WebM) straight into the DM window. It loads as a new scene and starts fully covered by fog.
3. **Open up the map.** Pick a tool from the top toolbar and reveal what the party can see:
   - **Brush** - wipes fog away by hand (size changes with `[` and `]`).
   - **Rectangle / Circle / Polygon** - draw a clean region, handy for rooms and corridors.
   - **Reveal / Shroud** - sets whether a shape uncovers an area or hides it again (for example, to close a door behind the party).
   - **Select (V)** - move, edit, and delete existing regions.
4. **Set up the grid.** In the **Grid** section on the right, switch the grid type (squares or hexes) and match the size and offset to the map's grid.
5. **Send it to the TV.** With **Auto** on (Player section), every change shows up on the player screen right away. For manual control - turn Auto off and hit **Send ▶** (or `Space`) when it's time to reveal the next room. The **Sync View** button matches the player's camera to the DM's.
6. **Switch maps mid-game.** In the **Scenes** panel, save several maps and switch between them with a smooth fade. Handy when the party moves from the tavern to the dungeon without breaking the mood.

> **Tip:** the `?` key in the DM window shows the full list of keyboard shortcuts.

## Running from source

No build step - it's plain JavaScript in an Electron shell.

```bash
npm install     # one-time, after cloning
npm start       # launch the app
```

Build an installer for the current platform:

```bash
npm run build         # Windows portable .exe
npm run build:mac     # macOS .dmg
npm run build:linux   # Linux AppImage
```

GitHub Actions builds all three platforms automatically on a `v*` tag push (see [`.github/workflows/release.yml`](.github/workflows/release.yml)).

## About map files

The map files (`.webm` / `.mp4`) and the app's data folder aren't part of the repo, they sit on disk next to the program. Cloning gives the code only. Maps get added through the app itself.

## Architecture

Curious how the fog rendering or the two-window sync works? The full architecture walkthrough is in [CLAUDE.md](CLAUDE.md).

## License

[MIT](LICENSE) - free to use, modify, and share.
