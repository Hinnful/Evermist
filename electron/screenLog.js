'use strict';
// screenLog.js — screens.log: every screen list the main process reads in the first seconds after launch,
// one line per change. It exists so a TV that is not found can be explained after the fact. The log is
// replaced on each launch and nothing on screen changes. Plain Node apart from register(): unit-tested.

const path = require('path');
const fs = require('fs');
const { pickTv } = require('../src/player/tvPick.js');

const SCREEN_LOG_MS = 10000;
const SCREEN_POLL_MS = 1000;

// Which screen the app would treat as the TV, with no remembered pick: its id, 'ask' with the candidates, or 'none'.
function tvLabel(displays, dmId) {
  const pick = pickTv(displays, dmId, null);
  if (pick.kind === 'one') return String(pick.display.id);
  if (pick.kind === 'ask') return 'ask(' + pick.candidates.map(d => d.id).join(',') + ')';
  return 'none';
}

// The line's text without its timestamp: two reads with the same body are no change.
function screenBody(displays, dmId) {
  const list = displays || [];
  const rows = list.map(d => 'id=' + d.id + ' bounds=' + d.bounds.x + ',' + d.bounds.y + ',' + d.bounds.width + 'x' + d.bounds.height +
    ' scale=' + d.scaleFactor + ' internal=' + !!d.internal);
  return ['screens=' + list.length, 'dm=' + dmId, 'tv=' + tvLabel(list, dmId)].concat(rows).join(' | ');
}

// A reader of the list: `take` returns the line to write, or null when the list has not changed since the last read.
function screenLogger() {
  let last = null;
  return function take(displays, dmId, now) {
    const body = screenBody(displays, dmId);
    if (body === last) return null;
    last = body;
    return new Date(now).toISOString() + ' ' + body + '\n';
  };
}

function register(ctx) {
  const { screen } = require('electron');
  const file = path.join(ctx.logsDir, 'screens.log');
  try { fs.writeFileSync(file, ''); } catch (_) { return; }
  const take = screenLogger();
  const read = () => {
    try {
      const win = ctx.getDmWin();
      const b = win && !win.isDestroyed() ? win.getBounds() : null;
      const dm = b ? screen.getDisplayNearestPoint({ x: b.x + Math.floor(b.width / 2), y: b.y + Math.floor(b.height / 2) }) : screen.getPrimaryDisplay();
      const line = take(screen.getAllDisplays(), dm.id, Date.now());
      if (line) fs.appendFileSync(file, line);
    } catch (_) {}
  };
  read();
  const timer = setInterval(read, SCREEN_POLL_MS);
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(ev, read);
  setTimeout(() => {
    clearInterval(timer);
    for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) screen.removeListener(ev, read);
  }, SCREEN_LOG_MS);
}

module.exports = { register, screenBody, screenLogger, tvLabel, SCREEN_LOG_MS };
