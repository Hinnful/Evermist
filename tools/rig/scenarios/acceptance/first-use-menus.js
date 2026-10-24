'use strict';

// first-use-menus.js — THE CAMPAIGN'S RIGHT-CLICK MENUS GAIN NEW GROUP HERE, ADD MAPS HERE…, AND NOTES.
// Covers src/world/worldMapMenu.js, worldMapEdit.js (_wmAddLand), worldMapPlan.js (wmGroupRectAt) and src/notes/notesPanel.js
// (a map picked on the Campaign). Item 211 of the first-use-cues spec.
//
//   A. Empty ground reads Add maps here…, New group here, Background picture…, Show everything. New group here makes a rectangle group centred on the click,
//      sized for one map card, named as a group drawn by hand, with rename started where its name shows. One undo removes it.
//      Background picture… presses Settings' own Choose image… button.
//   B. A group reads Rename, Fit in view, Add maps here…, Notes, then Delete group. Add maps here… puts the maps added next inside that group.
//   C. Notes on a group opens the Notes pane on that group's level.
//   D. A map reads Open, Rename, (Take out of its group), Export this map, Notes, then Delete map. Notes picks it and opens the Notes
//      pane on its level without opening it; the notes typed save to the map. A map in a group offers Campaign, group, map.
//
// ⚠ THE LIBRARY STARTS EMPTY, so the app opens on the Campaign. THE FILE PICKER CANNOT BE DRIVEN (the rig skill): the input's own click is
// stubbed so the row's real code runs up to it, and the picker's own handler is then fed a real FileList.
// ⚠ BY EYE: the rows in Russian, and the rename box on the new group.

const lib = require('../../lib');

const MAP_W = 900, MAP_H = 600;
const PAGE = `
globalThis.__fmClient = (x, y) => { const v = _wmView(); return { x: (x - _wmCam.cx) * _wmCam.z + v.w / 2, y: (y - _wmCam.cy) * _wmCam.z + v.h / 2 }; };
globalThis.__fmMenuAt = (cx, cy, el) => (el || document.getElementById('wm')).dispatchEvent(new MouseEvent('contextmenu', { clientX: cx, clientY: cy, button: 2, bubbles: true, cancelable: true }));
globalThis.__fmRows = () => [...document.querySelectorAll('.wm-menu .sm-mi')].map(b => b.textContent + (b.disabled ? ' (off)' : ''));
globalThis.__fmPress = label => [...document.querySelectorAll('.wm-menu .sm-mi')].find(b => b.textContent === label).click();
globalThis.__fmCard = name => [...document.querySelectorAll('.wm-card')].find(c => c.querySelector('.wm-nm').textContent === name);
globalThis.__fmFiles = names => { const inp = document.getElementById('wm-file-input'); const dt = new DataTransfer();
  names.forEach(n => dt.items.add(new File([globalThis.__fx], n + '.mp4', { type: globalThis.__fx.type }))); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); return 0; };
0`;

module.exports = async function firstUseMenus(rig) {
  const dm = rig.dm;
  await lib.settle(dm, 'worldMapOpen && !_wmAnim', 30000);
  await dm.evaluate(PAGE);
  const map = await rig.fixtures.tableMap(dm, rig.fixtureDir, { w: MAP_W, h: MAP_H });
  await dm.evaluate('globalThis.__fx = ' + await rig.fixtures.asFileExpr(dm, map) + '; 0');
  await dm.evaluate('__fmFiles(["Cellar", "Attic"]); 0', 180000);
  await dm.waitFor('allScenes.length === 2', 180000, 'the maps to reach the library');
  await lib.settle(dm, '!_wmAnim && worldMapPicked().length === 1', 30000);
  await dm.evaluate('document.getElementById("wm-file-input").click = () => {}; hintClose(); localStorage.setItem("evermist.hintsOff", "1"); 0');
  const rows = () => dm.evaluate('__fmRows()');
  const idOf = name => dm.evaluate('allScenes.find(s => s.name === ' + JSON.stringify(name) + ').id');

  // A. RED BY DESIGN: written against the fix, never re-proved
  const click = JSON.parse(await dm.evaluate('JSON.stringify(_wmToWorld(60, 140))'));
  await dm.evaluate('__fmMenuAt(60, 140); 0');
  rig.check(JSON.stringify(await rows()) === JSON.stringify(['Add maps here…', 'New group here', 'Background picture…', 'Show everything']), 'the ground\'s menu is wrong: ' + JSON.stringify(await rows()));
  await dm.evaluate('__fmPress("New group here"); 0');
  const made = JSON.parse(await dm.evaluate(`JSON.stringify((() => { const rec = worldPlaceRecords()[0]; if (!rec) return null; const b = wmPolyBounds(wmOutline(rec)), r = wmGroupRectAt({ x: 0, y: 0 });
    return { n: worldPlaceRecords().length, name: rec.name, cx: b.x + b.w / 2, cy: b.y + b.h / 2, w: b.w, h: b.h, rw: r.w, rh: r.h, editing: !!_wmEditing, shown: _wmNameShown(rec.name) }; })())`));
  rig.check(made && made.n === 1 && Math.abs(made.cx - click.x) < 1 && Math.abs(made.cy - click.y) < 1, 'New group here did not make one group centred on the click: ' + JSON.stringify([made, click]));
  rig.check(made && Math.abs(made.w - made.rw) < 1 && Math.abs(made.h - made.rh) < 1, 'the new group is not sized for one map card: ' + JSON.stringify(made));
  rig.check(made && /^New group/.test(made.name), 'the new group is not named like one drawn by hand: ' + JSON.stringify(made));
  rig.check(made && made.editing === made.shown, 'rename did not start on the new group where its name shows: ' + JSON.stringify(made));
  if (made && made.editing) await dm.evaluate('_wmEditing.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", key: "Escape", bubbles: true, cancelable: true })); 0');
  await dm.evaluate('worldUndo(); 0');
  rig.check(await dm.evaluate('worldPlaceRecords().length') === 0, 'one undo did not remove the new group');
  // The picker is native, so the press is caught on its way down and stopped before it opens one.
  await dm.evaluate(`globalThis.__fmBg = 0; window.addEventListener('click', e => { if (e.target.closest && e.target.closest('#wm-bg-pick')) { globalThis.__fmBg++; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
    __fmMenuAt(60, 140); __fmPress("Background picture…"); 0`);
  // RED ON: the Background picture… row removed (worldMapMenu.js _wmGroundRows) — 2026-10-25
  rig.check(await dm.evaluate('globalThis.__fmBg') === 1, 'Background picture… did not press Settings\' Choose image… button');

  // B. RED BY DESIGN: written against the fix, never re-proved
  await dm.evaluate('__fmMenuAt(60, 140); __fmPress("New group here"); if (_wmEditing) _wmEditing.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", key: "Escape", bubbles: true, cancelable: true })); 0');
  const group = await dm.evaluate('worldPlaceRecords()[0].name');
  await dm.evaluate('(() => { const p = __fmClient(' + click.x + ', ' + click.y + '); __fmMenuAt(p.x, p.y); return 0; })()');
  rig.check(JSON.stringify((await rows()).map(r => r.replace(/^Rename \(off\)$/, 'Rename'))) === JSON.stringify(['Rename', 'Fit in view', 'Add maps here…', 'Notes', 'Delete group']),
            'a group\'s menu is wrong: ' + JSON.stringify(await rows()));
  await dm.evaluate('__fmPress("Add maps here…"); 0');
  rig.check(await dm.evaluate('_wmAddIn') === group, 'Add maps here… did not aim the next maps at the group: ' + await dm.evaluate('_wmAddIn'));
  await dm.evaluate('__fmFiles(["Cave"]); 0', 180000);
  await dm.waitFor('allScenes.some(s => s.name === "Cave")', 180000, 'the added map to reach the library');
  await lib.settle(dm, '!_wmAnim', 30000);
  const cave = JSON.parse(await dm.evaluate(`JSON.stringify((() => { const s = allScenes.find(x => x.name === 'Cave'), rec = worldPlaceByName(${JSON.stringify(group)});
    return { group: s.group, inside: !!rec && wmRectInPoly(wmCardRect(s.worldPos), wmOutline(rec)), aim: _wmAddIn }; })())`));
  rig.check(cave.group === group && cave.inside && cave.aim === '', 'the map added from the group\'s menu did not land inside it and belong to it: ' + JSON.stringify(cave));

  // C. RED BY DESIGN: written against the fix, never re-proved
  await dm.evaluate('(() => { const p = __fmClient(' + click.x + ', ' + (click.y - 70) + '); __fmMenuAt(p.x, p.y); return 0; })()');
  await dm.evaluate('__fmPress("Notes"); 0');
  await lib.settle(dm, 'dockActivePane() === "notes" && document.querySelector("#np-crumbs .np-crumb.on")', 8000);
  const gnotes = await dm.evaluate(`(() => ({ pane: dockActivePane(), on: (document.querySelector('#np-crumbs .np-crumb.on') || {}).dataset && document.querySelector('#np-crumbs .np-crumb.on').dataset.level,
    labels: [...document.querySelectorAll('#np-crumbs .np-crumb')].map(b => b.textContent), hidden: document.getElementById('np-field').hidden }))()`);
  rig.check(gnotes.pane === 'notes' && gnotes.on === 'place' && gnotes.labels[1] === group && !gnotes.hidden, 'Notes on a group did not open the Notes pane on that group: ' + JSON.stringify(gnotes));

  // D. RED BY DESIGN: written against the fix, never re-proved
  const attic = await idOf('Attic');
  await dm.evaluate('__fmMenuAt(0, 0, __fmCard("Attic").firstChild); 0');
  const mrows = await rows();
  rig.check(JSON.stringify(mrows.map(r => r.replace(/ \(off\)$/, ''))) === JSON.stringify(['Open', 'Rename', 'Export this map', 'Notes', 'Delete map']), 'a map\'s menu is wrong: ' + JSON.stringify(mrows));
  await dm.evaluate('__fmPress("Notes"); 0');
  await lib.settle(dm, 'document.querySelector("#np-crumbs .np-crumb.on") && document.querySelector("#np-crumbs .np-crumb.on").dataset.level === "scene"', 8000);
  const mnotes = await dm.evaluate(`(() => ({ pane: dockActivePane(), on: (document.querySelector('#np-crumbs .np-crumb.on') || {}).dataset && document.querySelector('#np-crumbs .np-crumb.on').dataset.level,
    levels: [...document.querySelectorAll('#np-crumbs .np-crumb')].map(b => b.dataset.level), open: worldMapOpen, cur: currentScene === null, picked: worldMapPicked() }))()`);
  rig.check(mnotes.pane === 'notes' && mnotes.on === 'scene' && mnotes.levels.join() === 'campaign,scene', 'Notes on a map did not open the Notes pane on that map: ' + JSON.stringify(mnotes));
  rig.check(mnotes.open && mnotes.cur && mnotes.picked.length === 1 && mnotes.picked[0] === attic, 'Notes on a map opened it, or did not pick it: ' + JSON.stringify(mnotes));
  await dm.evaluate('(() => { const f = document.getElementById("np-field"); f.value = "A damp stair."; f.dispatchEvent(new Event("input", { bubbles: true })); notesPanelSettle(); return 0; })()');
  const saved = await lib.poll(async () => { const n = await dm.evaluate('sceneStore.loadScene(' + JSON.stringify(attic) + ').then(r => r && r.notes)'); return n === 'A damp stair.' ? { n } : null; }, 8000);
  rig.check(!!saved, 'the notes typed for a map picked on the Campaign did not save to the map');
  await dm.evaluate('worldMapSelect({ sceneId: null, place: "" }); worldMapSelect({ sceneId: ' + JSON.stringify(attic) + ', place: "" }); notesLevelPick = "scene"; refreshRoomPanel(); 0');
  await lib.settle(dm, 'document.getElementById("np-field").value === "A damp stair."', 8000);
  rig.check(await dm.evaluate('document.getElementById("np-field").value') === 'A damp stair.', 'the map\'s saved notes do not come back when it is picked again');
  const inGroup = await idOf('Cave');
  await dm.evaluate('worldMapSelect({ sceneId: ' + JSON.stringify(inGroup) + ', place: "" }); 0');
  await lib.settle(dm, 'document.querySelectorAll("#np-crumbs .np-crumb").length === 3', 8000);
  rig.check(await dm.evaluate('[...document.querySelectorAll("#np-crumbs .np-crumb")].map(b => b.dataset.level).join()') === 'campaign,place,scene',
            'a map in a group does not offer Campaign, group and map');
  rig.byEye('the new rows in Russian, and the rename box on a group made from the ground\'s menu');
};
