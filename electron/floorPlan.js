'use strict';
// floorPlan.js — the .dd2vtt sitting beside a map on disk, which is the only place the app looks
// for one.

const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

function register(ctx) {
}

// --- Floor plan sibling lookup ---

// Dungeon Alchemist writes a `.dd2vtt` floor plan beside the map it exports, so the renderer only
// asks whether this map came with one.
//
// ⚠ DELIBERATELY NARROW: main derives the sibling path itself and reads nothing else, because a
// floor plan is untrusted input. Returns null on ANY failure — a rejection strands the import.
ipcMain.handle('find-floor-plan', async (_event, mapPath) => {
  try {
    if (typeof mapPath !== 'string' || !mapPath) return null;
    const planPath = path.join(
      path.dirname(mapPath),
      path.basename(mapPath, path.extname(mapPath)) + '.dd2vtt'
    );
    return { name: path.basename(planPath), text: await fs.promises.readFile(planPath, 'utf8') };
  } catch {
    return null;
  }
});

module.exports = { register };
