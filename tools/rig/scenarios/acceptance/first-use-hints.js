'use strict';

// first-use-hints.js — THE HINTS FOR GROUPS, EFFECTS, MUSIC, SOUNDS AND FIGHTS.
// Covers src/ui/hintsCues.js, hints.js (_hintNear), hintsPlan.js and their hooks (music.js, combatTracker.js, combatStatBlock.js,
// sceneSwitch.js, toolbar.js, worldMapOpenBar.js). Items 203, 204, 205 and 212 of the first-use-cues spec.
//
//   G. With the Campaign up, three maps and no group, the groups hint sits above the Group button, which blinks. A group
//      existing closes it.
//   F. Opening a map the first time shows no effects hint; the second time shows it above the Fog / Effects switch, which
//      blinks, and the count is kept in localStorage. Entering Effects closes it; a third map shows nothing.
//   M. Opening the Music pane with no tracks shows the music hint beside the pane's Add buttons. A track being added closes it.
//   S. A track starting shows the sounds hint beside the Sounds rail button, which blinks. Opening Sounds closes it.
//   X. Opening the fight table on an empty fight shows the fight hint at Add creature, above the table. Adding a creature
//      closes it and shows the stat-block hint under that row. Opening the stat block closes that.
//   H. With Hints off, none of them shows.
//
// ⚠ THE LIBRARY STARTS EMPTY, so the app opens on the Campaign. The picker's own handler is fed a real FileList. The tracks are
// written as WAV into the profile's music folder, as music.js does.

const fs = require('fs');
const path = require('path');

const lib = require('../../lib');

const MAP_W = 900, MAP_H = 600;
const NAMES = ['Cellar', 'Attic', 'Bridge'];
const up = id => '!!document.querySelector(".hintcall-' + id + '")';

function wav(seconds) {
  const rate = 8000, samples = rate * seconds, buf = Buffer.alloc(44 + samples);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate, 28);
  buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34); buf.write('data', 36); buf.writeUInt32LE(samples, 40);
  for (let i = 0; i < samples; i++) buf[44 + i] = 128 + Math.round(40 * Math.sin(i / 8));
  return buf;
}

module.exports = async function firstUseHints(rig) {
  const dm = rig.dm;
  await dm.evaluate("_hintQuietMs = 0; 0");   // Got it on open-map is followed at once by groups
  const gone = id => lib.settle(dm, '!' + up(id), 8000);
  const geo = (id, anchor) => dm.evaluate(`(() => { const h = document.querySelector('.hintcall-${id}'), a = document.querySelector(${JSON.stringify(anchor)});
    if (!h || !a) return null; const r = h.getBoundingClientRect(), b = a.getBoundingClientRect();
    return { text: h.textContent, above: r.bottom <= b.top + 1, below: r.top >= b.bottom - 1, left: r.right <= b.left + 1,
      blink: a.classList.contains('hintcall-blink'), seen: localStorage.getItem('evermist.hintsSeen'), ok: h.querySelector('.hintcall-ok').textContent }; })()`);

  await lib.settle(dm, 'worldMapOpen && !_wmAnim', 30000);
  const map = await rig.fixtures.tableMap(dm, rig.fixtureDir, { w: MAP_W, h: MAP_H });
  await dm.evaluate('globalThis.__fx = ' + await rig.fixtures.asFileExpr(dm, map) + '; 0');
  const files = NAMES.map(n => 'dt.items.add(new File([__fx], ' + JSON.stringify(n + '.mp4') + ', { type: __fx.type }));').join(' ');
  await dm.evaluate('(() => { const inp = document.getElementById("wm-file-input"); const dt = new DataTransfer(); ' + files +
                    ' inp.files = dt.files; inp.dispatchEvent(new Event("change", { bubbles: true })); return 0; })()', 180000);
  await dm.waitFor('allScenes.length === ' + NAMES.length, 180000, 'the maps to reach the library');
  await lib.settle(dm, '!_wmAnim && worldMapPicked().length === 1', 30000);

  // G. RED BY DESIGN: written against the fix, never re-proved
  await lib.settle(dm, up('open-map'), 8000);
  await dm.evaluate('document.querySelector(".hintcall-open-map .hintcall-ok").click(); 0');
  await lib.settle(dm, up('groups'), 8000);
  const groups = await geo('groups', '#btn-shape');
  rig.check(groups && /Gather maps into a group/.test(groups.text) && /A map dropped inside joins it\./.test(groups.text) && /a village, a dungeon, one tavern/.test(groups.text),
            'three maps and no group showed no groups hint with its words: ' + JSON.stringify(groups));
  rig.check(groups && groups.above && groups.blink && /groups/.test(groups.seen), 'the groups hint is not above the Group button, or it does not blink, or was not recorded: ' + JSON.stringify(groups));
  await dm.evaluate('worldPlaceCreate(wmRectShape(-300, -200, 100, 100)); worldMapRefresh(); 0');
  await gone('groups');
  rig.check(!(await dm.evaluate(up('groups'))), 'a group existing left the groups hint up');

  // F. RED BY DESIGN: written against the fix, never re-proved
  const ids = await dm.evaluate('JSON.stringify(allScenes.map(s => s.id))').then(JSON.parse);
  await dm.evaluate('worldMapOpenScene(' + JSON.stringify(ids[0]) + '); 0');
  await lib.settle(dm, 'currentScene && currentScene.id === ' + JSON.stringify(ids[0]) + ' && !worldMapOpen && fogCoverT === 0', 60000);
  await lib.hold(1200, 'an effects hint, if the first map were enough, would be up by now');
  rig.check(!(await dm.evaluate(up('effects'))) && await dm.evaluate('localStorage.getItem("evermist.mapOpens")') === '1',
            'the first map opened showed the effects hint, or did not count it');
  await dm.evaluate('hintClose(); switchScene(' + JSON.stringify(ids[1]) + '); 0', 120000);
  await lib.settle(dm, 'currentScene && currentScene.id === ' + JSON.stringify(ids[1]) + ' && fogCoverT === 0', 60000);
  await lib.settle(dm, up('effects'), 8000);
  const fx = await geo('effects', '#btn-effects');
  rig.check(fx && /Fire, acid and light/.test(fx.text) && /Click Effects to draw a fire, a cone of acid or a light\. The players see it on the TV\./.test(fx.text),
            'the second map opened showed no effects hint with its words: ' + JSON.stringify(fx));
  rig.check(fx && fx.above && fx.blink && /effects/.test(fx.seen), 'the effects hint is not above the Effects button, or it does not blink: ' + JSON.stringify(fx));
  rig.check(await dm.evaluate('localStorage.getItem("evermist.mapOpens")') === '2', 'the count of maps opened was not kept in localStorage');
  await dm.evaluate('setPlaceMode("effects"); 0');
  await gone('effects');
  rig.check(!(await dm.evaluate(up('effects'))), 'entering Effects left the effects hint up');
  await dm.evaluate('setPlaceMode("rooms"); switchScene(' + JSON.stringify(ids[2]) + '); 0', 120000);
  await lib.settle(dm, 'currentScene && currentScene.id === ' + JSON.stringify(ids[2]) + ' && fogCoverT === 0', 60000);
  await lib.hold(1200, 'a second effects hint, if the first did not stay spent, would be up by now');
  rig.check(!(await dm.evaluate(up('effects'))), 'a third map showed the effects hint again');

  // M. RED BY DESIGN: written against the fix, never re-proved
  await dm.evaluate('hintClose(); dockOpen("music"); 0');
  await lib.settle(dm, up('music'), 8000);
  const music = await dm.evaluate(`(() => { const h = document.querySelector('.hintcall-music'), d = document.getElementById('dock');
    if (!h) return null; return { text: h.textContent, leftOfDock: h.getBoundingClientRect().right <= d.getBoundingClientRect().left + 1 }; })()`);
  rig.check(music && /Add your music/.test(music.text) && /Add files from this computer, or paste a YouTube link\. A track loops until you pick another\./.test(music.text),
            'the empty Music pane showed no music hint with its words: ' + JSON.stringify(music));
  rig.check(music && music.leftOfDock, 'the music hint is not beside the dock: ' + JSON.stringify(music));
  const musicDir = path.join(rig.profileDir, 'music');
  fs.mkdirSync(musicDir, { recursive: true });
  fs.writeFileSync(path.join(musicDir, 'Village of Barovia [aBcDeFgHiJk].wav'), wav(30));
  await dm.evaluate('_muRefreshTracks(); 0');
  await gone('music');
  rig.check(!(await dm.evaluate(up('music'))), 'a track being added left the music hint up');

  // S. RED BY DESIGN: written against the fix, never re-proved
  await lib.settle(dm, '_muTracks.length === 1', 8000);
  await dm.evaluate('_muPlay(_muTracks[0]); 0');
  await lib.settle(dm, up('sounds'), 8000);
  const sounds = await geo('sounds', '#dock-tab-sounds');
  rig.check(sounds && /Sounds play over the music/.test(sounds.text) && /Open Sounds for a door, a scream or thunder\. Each click plays one more\./.test(sounds.text),
            'a track starting showed no sounds hint with its words: ' + JSON.stringify(sounds));
  rig.check(sounds && sounds.left && sounds.blink, 'the sounds hint is not beside the Sounds rail button, or it does not blink: ' + JSON.stringify(sounds));
  await dm.evaluate('dockOpen("sounds"); 0');
  await gone('sounds');
  rig.check(!(await dm.evaluate(up('sounds'))), 'opening Sounds left the sounds hint up');

  // X. RED BY DESIGN: written against the fix, never re-proved
  await dm.evaluate('hintClose(); cbSetOpen(true); 0');
  await lib.settle(dm, up('fight'), 8000);
  const fight = await geo('fight', '#cb-add');
  rig.check(fight && /Run a fight here/.test(fight.text) && /Add creatures from the Bestiary, then sort by initiative\. HP takes sums like 45-12\./.test(fight.text),
            'the empty fight table showed no fight hint with its words: ' + JSON.stringify(fight));
  rig.check(fight && fight.below && fight.ok === 'Got it', 'the fight hint is not at Add creature, or has no Got it: ' + JSON.stringify(fight));
  rig.check(await dm.evaluate('+getComputedStyle(document.querySelector(".hintcall-fight")).zIndex > +getComputedStyle(document.getElementById("cb-fight")).zIndex'),
            'the fight hint sits under the fight table');
  await dm.evaluate('document.getElementById("cb-add").click(); 0');
  await lib.settle(dm, up('stat-block'), 8000);
  const stat = await dm.evaluate(`(() => { const h = document.querySelector('.hintcall-stat-block'), row = document.querySelector('#cb-list .cb-row');
    if (!h || !row) return null; return { text: h.textContent, under: h.getBoundingClientRect().top >= row.getBoundingClientRect().bottom - 1, fight: !!document.querySelector('.hintcall-fight') }; })()`);
  rig.check(stat && /Its stat block is one click away/.test(stat.text) && /Press the book on a row to read or edit that creature\./.test(stat.text),
            'the first creature added showed no stat-block hint with its words: ' + JSON.stringify(stat));
  rig.check(stat && stat.under && !stat.fight, 'the stat-block hint is not under the new row, or the fight hint stayed up: ' + JSON.stringify(stat));
  await dm.evaluate('document.querySelector("#cb-list .cb-row [data-b=stat]").click(); 0');
  await gone('stat-block');
  rig.check(!(await dm.evaluate(up('stat-block'))), 'opening the stat block left the stat-block hint up');

  // H. RED BY DESIGN: written against the fix, never re-proved
  await dm.evaluate('cbSetOpen(false); localStorage.setItem("evermist.hintsOff", "1"); localStorage.removeItem("evermist.hintsSeen"); hintClose();' +
                    ' cbState.rows = []; cbSetOpen(true); 0');
  await lib.hold(1200, 'a fight hint, if Hints off let one show, would be up by now');
  rig.check(!(await dm.evaluate('!!document.querySelector(".hintcall")')), 'a hint showed with Hints switched off');
  await dm.evaluate('localStorage.removeItem("evermist.hintsOff"); cbSetOpen(false); 0');
  rig.byEye('each hint sits clear of what it points at, in English and in Russian');
};
