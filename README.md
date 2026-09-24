# Evermist

[![Latest release](https://img.shields.io/github/v/release/Hinnful/Evermist?label=download&sort=semver)](../../releases/latest)
[![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux-7c6fb0)](../../releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Evermist is for DMs who run their games in person, with a TV on the table and minis on the map. You prepare and run everything from your laptop. The TV shows your players the map with fog of war, grid and effects. Evermist is free, and it will stay free, forever

If your group plays online, Evermist is not what you're looking for. Players don't connect to it, and it has no tokens and no dice

![Revealing fog on the player view](assets/reveal.gif)

## Prepare the session

### Draw rooms of any shape

Draw a room with any outline you need. Double-click it to edit: drag corners and walls, curve a wall, round a corner, or cut a hole for a pillar. Join rooms together or cut one in two. Rooms can be copied, pasted, and moved between scenes

![Drawing reveal and shroud regions](assets/tools.gif)

#### Let the floor plan draw them

Some map editors can export a map's walls as a Universal VTT `.dd2vtt` file. Save that file in the same folder as the map, and Evermist offers to draw every room and door for you. It sizes the grid from the same file

### Write notes for every room

Each room has a name and your notes. They stay on your laptop and never reach the TV. Room names also show on your map

#### Auto-fill notes from the module

If you run a published adventure, load it as a `.pdf` or `.txt`. Evermist finds every numbered location in the book, such as `K12. The Chapel`. Start typing "chapel" in a room's name field and pick it from the list. The room's name and description fill in from the book

![Filling a room's name and notes from the module text](assets/module-text.gif)

### Set up the fog and the grid

Each scene keeps its own fog colour and movement. A dungeon can sit under navy mist and a swamp under a sickly green one. The grid can be square or hex, in any colour or width. To calibrate it to the map, drag across a few of the map's own cells. Room corners can snap to the grid as you draw

### Keep your scenes in order

Scenes sort into groups and can be searched by name. To move your prep to another computer, back up the scenes you need into one `.zip` and restore it there

## Run the session

### Put the map on the TV

1. Connect the TV to your laptop over HDMI and set the display to extend your desktop
2. Open the Player window from the Player tab and drag it onto the TV
3. Click Fullscreen

The minimap in the DM window shows which part of the map is on the TV. Drag it to move the TV's view

![The DM window](assets/dm-window.png)

### Reveal rooms as the party explores

Every room can be fully Shrouded, Revealed or Half-shrouded for places the party visited, but left

Manual mode lets you prepare the next reveal in private. The TV doesn't update the picture until you press Send. Switching maps is animated with the fog, so the TV never goes black

### Show two floors at once

When a fight spreads across two floors, split the screen and show both maps side by side. Each floor keeps its own fog and its own view

### Play music from the same window

Paste a YouTube video or playlist link during prep, and Evermist downloads the tracks to your laptop. At the table, pick a track and it fades in and loops until you choose another

### Mark spell areas on the map

When a spell covers an area, draw it straight onto the map with the same tools you use for rooms. Circles, cones and walls of any shape all work. The grid stays visible inside the area, so everyone can count the squares it covers

### Play animated maps

Evermist plays MP4 and WebM maps as well as still images. Wherever the fog is cleared, the water keeps moving and the torches keep flickering

![Animated map playing under the fog](assets/animated-map.gif)

Press `?` in the DM window to see every keyboard shortcut

## Download

Download the latest version from [**Releases**](../../releases/latest):

| System | File | Notes |
|--------|------|-------|
| Windows | `Evermist-Setup-<version>.exe` | Installs in one click, then keeps itself up to date |
| macOS | `Evermist-<version>.dmg` | Universal (Intel and Apple Silicon). Download each new version by hand |
| Linux | `Evermist-<version>.AppImage` | Make the file executable, then run. Keeps itself up to date |

An update downloads in the background and installs only when you press Restart to update

Evermist isn't code-signed (signing certificates cost money), so your OS shows a one-time security warning the first time you open it. It's harmless

<details>
<summary>Getting past the first-launch warning</summary>

- **Windows:** if "Windows protected your PC" appears, click "More info", then "Run anyway"
- **macOS:** if "Evermist can't be opened because Apple cannot check it…" appears, right-click the app, choose "Open", then "Open" again in the dialog. (A normal double-click won't offer this the first time.)
- **Linux:** make the AppImage executable (`chmod +x Evermist-*.AppImage`, or Properties → Permissions → Allow executing file as program), then run it as usual

The OS remembers your choice, so this only happens once
</details>

## Nothing leaves your computer

No account, no cloud, no tracking. Evermist goes online for two things only. The Windows and Linux builds check GitHub for updates, and a music link you paste downloads from YouTube. Everything else works without an internet connection

Your maps and scenes sit on your own disk. Module PDFs get read in a separate locked-down process that can't touch your files

## Running from source

No build step. It's plain JavaScript in an Electron shell

```bash
npm install     # one-time, after cloning
npm start       # launch the app
```

Build an installer for the current platform:

```bash
npm run build         # Windows installer .exe
npm run build:mac     # macOS .dmg
npm run build:linux   # Linux AppImage
```

GitHub Actions builds all three platforms and publishes the release (see [`.github/workflows/release.yml`](.github/workflows/release.yml))

Want to know how the fog rendering or the two-window sync works? [ARCHITECTURE.md](docs/ARCHITECTURE.md) explains it in plain English

## License

[MIT](LICENSE) - free to use, modify, and share

Have a great session
