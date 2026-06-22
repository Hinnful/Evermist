# Evermist

A client-side web app for displaying D&D dungeon maps on a TV with fog of war.
No backend, no VTT features (tokens, initiative) — just map + fog + grid + two screens (DM view and Player view).

Packaged as a portable Windows `.exe` via Electron.

## Running

```bash
npm install     # one-time, after cloning (re-creates node_modules)
npm start       # launch the Electron desktop app
npm run build   # build the portable .exe
```

Browser testing: `npx serve .` then open `http://localhost:3000` (Player view opens as a second window).

## Note on map files

Map media (`.webm` / `.mp4`) and the portable `evermist-data/` folder are **not** stored in this repo — they're large binaries that live on disk next to the app. Cloning this repo gives you the code only; add your own maps through the app.

See [CLAUDE.md](CLAUDE.md) for full architecture documentation.
