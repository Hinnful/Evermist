# Evermist

A desktop app for running D&D battle maps on a TV, with **fog of war** you paint live from a second screen.

No accounts, no servers, no subscriptions — everything runs locally on your machine. Point one window at your laptop, the other at the TV your players see, and reveal the dungeon as they explore it.

> **What it is not:** a full virtual tabletop. There are no tokens, no initiative tracker, no dice. Evermist does one thing — show a map and hide parts of it — and tries to do it beautifully.

<!-- TODO: add a screenshot or GIF here. A short clip of painting fog away to reveal a room sells the whole app. -->

## Features

- **Two synced screens** — a DM view you control and a clean Player view (no buttons, no cursor) for the TV.
- **Painterly fog of war** — soft, animated cloud fog, not flat black. Reveal with a brush or draw reveal/shroud regions as editable shapes.
- **Square & hex grids** — adjustable size, offset, color, and opacity.
- **Static and video maps** — drop in a JPG/PNG, or an animated MP4/WebM map (e.g. from Dungeon Alchemist).
- **Scenes** — save multiple maps and switch between them mid-session with a fade transition.
- **Handles big maps** — built to stay smooth on 10000×6000 maps.

## Download

Grab the latest installer for your system from the [**Releases**](../../releases) page:

| System | File |
|--------|------|
| Windows | `Evermist-<version>.exe` (portable — no install, just run it) |
| macOS | `Evermist-<version>.dmg` |
| Linux | `Evermist-<version>.AppImage` |

### First-time open

Evermist is a free app and is **not code-signed**, so your operating system will show a one-time security warning the first time you open it. This is normal for indie software — here's how to get past it:

- **Windows:** if you see *"Windows protected your PC"*, click **More info → Run anyway**.
- **macOS:** if you see *"Evermist can't be opened because Apple cannot check it…"*, **right-click the app → Open**, then click **Open** in the dialog. (Double-clicking won't give you the option the first time.)
- **Linux:** make the AppImage executable (`chmod +x Evermist-*.AppImage`) or check *Properties → Permissions → Allow executing file as program*, then run it.

Your system remembers the choice, so this only happens once.

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
