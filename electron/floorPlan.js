'use strict';
// floorPlan.js — the Universal VTT floor plan sitting beside a map on disk, which is the only place
// the app looks for one.

const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

function register(ctx) {
}

// --- Floor plan sibling lookup ---

// Dungeon Alchemist writes a `.dd2vtt` beside the map it exports, and `.uvtt` and `.df2vtt` hold the
// same JSON, so the renderer only asks whether this map came with one. The first that reads wins.
//
// ⚠ DELIBERATELY NARROW: main derives the sibling path itself and reads nothing else, because a
// floor plan is untrusted input. Returns null on ANY failure — a rejection strands the import.
const PLAN_EXTENSIONS = ['.dd2vtt', '.uvtt', '.df2vtt'];
ipcMain.handle('find-floor-plan', async (_event, mapPath) => {
  if (typeof mapPath !== 'string' || !mapPath) return null;
  const stem = path.join(path.dirname(mapPath), path.basename(mapPath, path.extname(mapPath)));
  for (const ext of PLAN_EXTENSIONS) {
    try {
      return { name: path.basename(stem + ext), text: await fs.promises.readFile(stem + ext, 'utf8') };
    } catch { /* not this one */ }
  }
  return null;
});

module.exports = { register };
