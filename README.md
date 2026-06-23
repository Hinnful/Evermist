# Evermist

**English** · [Русский](README.ru.md)

A desktop app for running D&D battle maps on a TV, with **fog of war** you paint live from a second screen.

[![Latest release](https://img.shields.io/github/v/release/Hinnful/Evermist?label=download&sort=semver)](../../releases/latest)
[![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux-7c6fb0)](../../releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

No accounts, no servers, no subscriptions. Everything runs locally on your machine: point one window at your laptop, the other at the TV your players see, and reveal the dungeon as they explore it.

> **What it is *not*:** a full virtual tabletop. There are no tokens, no initiative tracker, no dice. Evermist does one thing — show a map and hide parts of it — and tries to do it beautifully.

## Features

- **Two synced screens** — a DM view you control and a clean Player view (no buttons, no cursor) for the TV.
- **Painterly fog of war** — soft, animated cloud fog, not flat black. Reveal with a brush or draw reveal/shroud regions as editable shapes.
- **Square & hex grids** — adjustable size, offset, color, and opacity.
- **Static and video maps** — drop in a JPG/PNG, or an animated MP4/WebM map (e.g. from Dungeon Alchemist).
- **Scenes** — save multiple maps and switch between them mid-session with a fade transition.
- **Handles big maps** — built to stay smooth on 10000×6000 maps.

## Download

Grab the latest installer for your system from the [**Releases**](../../releases/latest) page:

| System | File | Notes |
|--------|------|-------|
| Windows | `Evermist-<version>.exe` | Portable — no install, just double-click to run |
| macOS | `Evermist-<version>.dmg` | Universal (Intel & Apple Silicon) |
| Linux | `Evermist-<version>.AppImage` | Make it executable, then run |

### First-time open

Evermist is free and **not code-signed** (signing certificates cost money), so your operating system shows a one-time security warning the first time you open it. This is normal for indie software. Here's how to get past it:

- **Windows:** if you see *“Windows protected your PC”*, click **More info → Run anyway**.
- **macOS:** if you see *“Evermist can't be opened because Apple cannot check it…”*, **right-click the app → Open**, then click **Open** in the dialog. (Double-clicking won't give you the option the first time.)
- **Linux:** make the AppImage executable (`chmod +x Evermist-*.AppImage`, or *Properties → Permissions → Allow executing file as program*), then run it.

Your system remembers the choice, so this only happens once.

## Getting started

Once Evermist is open you'll see the **DM window** — this is your control screen, the one your players never see.

1. **Open the Player window.** In the right sidebar, under **Player**, click **Open Window**. A second, button-free window appears. This is what your players see — drag it onto your TV (or second monitor) and click **Fullscreen**.
2. **Load a map.** Drag a map file (JPG, PNG, MP4, or WebM) straight onto the DM window. It loads as a new scene and starts **fully covered by fog**.
3. **Reveal the map.** Pick a tool from the top toolbar and uncover where the party can see:
   - **Brush** — paint fog away freehand (adjust size with `[` and `]`).
   - **Rectangle / Circle / Polygon** — draw a clean reveal region, ideal for rooms and corridors.
   - **Reveal / Shroud** — toggle whether a shape *uncovers* or *re-hides* an area (handy for closing a door behind the party).
   - **Select (V)** — move, reshape, or delete regions you've already drawn.
4. **Match the grid.** In the right sidebar's **Grid** section, switch between square and hex and adjust the size/offset until it lines up with your map's grid.
5. **Push it to the TV.** With **Auto** on (under Player), every change you make appears on the Player screen automatically. Prefer manual control? Turn Auto off and hit **Send ▶** (or press `Space`) when you're ready to reveal the next room. **Sync View** snaps the player's camera to match yours.
6. **Switch maps mid-session.** Open the **Scenes** panel to save several maps and jump between them with a smooth fade — great for moving from the tavern to the dungeon without breaking immersion.

> **Tip:** press `?` in the DM window any time to see the full list of keyboard shortcuts.

## Running from source

No build step — it's vanilla JS in an Electron shell.

```bash
npm install     # one-time, after cloning
npm start       # launch the desktop app
```

Build an installer for your current platform:

```bash
npm run build         # Windows portable .exe
npm run build:mac     # macOS .dmg
npm run build:linux   # Linux AppImage
```

Releases for all three platforms are built automatically by GitHub Actions when a `v*` tag is pushed — see [`.github/workflows/release.yml`](.github/workflows/release.yml).

## A note on map files

Map media (`.webm` / `.mp4`) and the app's local data folder are **not** part of this repo — they live on disk next to the app. Cloning gives you the code only; add your own maps through the app.

## Architecture

Curious how the fog rendering or the two-window sync works? See [CLAUDE.md](CLAUDE.md) for a full architecture walkthrough.

## License

[MIT](LICENSE) — free to use, modify, and share.
