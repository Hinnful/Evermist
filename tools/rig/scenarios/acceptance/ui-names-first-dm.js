'use strict';

// ui-names-first-dm.js — THE INTERFACE NAMES ITS THINGS FOR A DM WHO HAS NEVER SEEN IT.
//
// THE GOAL OF THIS FEATURE: the bottom toolbar and the dock rail say what they are in words. The
// scene bar's shape button reads Room and the Campaign's reads Group, the Campaign's add button
// reads Map without shouting in solid blue, every rail button carries its name, and Grid leads the
// Map settings pane. A fresh start draws rectangles.
//
// Covers: index.html, src/shapes/shapeMenu.js, src/state.js, src/css/dock.css, src/css/toolbar.css,
// src/i18n/ru.js.
//
// THE CRITERIA ARE THIS HEADER. Each lettered line has its checks under a marker carrying its letter.
//
//   A. On a map in Rooms mode the shape button shows the word Room and a tooltip starting "Room -
//      hides part of the map from the players"; on the Campaign it shows Group with a tooltip
//      starting "Group - gathers maps together"; in Effects mode it shows no label.
//   B. On a fresh start the Rooms shape and the Campaign's Group shape are the rectangle.
//   C. The Campaign's add button shows the word Map and is not solid blue.
//   D. Every rail button shows a text label, in order Campaign, Notes, Bestiary, Map settings, Music,
//      Sounds, Pictures, Fights, Settings, Help; Map settings takes two lines.
//   E. Grid is the first section of the Map settings pane.
//   F. In Russian the rail and the shape button read Russian.
//
// ⚠ THE LIBRARY STARTS EMPTY, so the app opens on the Campaign; B and the Group half of A read it before any map exists.

const lib = require('../../lib');

const PAGE = `
globalThis.__unVis = el => !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
globalThis.__unShape = () => {
  const b = document.getElementById('btn-shape'), l = b.querySelector('.tb-shape-label');
  return { label: __unVis(l) ? l.textContent.trim() : '', title: b.title, worn: _worn };
};
globalThis.__unRail = () => [...document.querySelectorAll('.rail-btn')].filter(__unVis).map(b => {
  const l = b.querySelector('.rail-lbl');
  return { id: b.id, text: __unVis(l) ? l.textContent.trim() : '', h: l ? l.getBoundingClientRect().height : 0 };
});
`;

const EN = ['Campaign', 'Notes', 'Bestiary', 'Map settings', 'Music', 'Sounds', 'Pictures', 'Fights', 'Settings', 'Help'];
const RU = ['Кампания', 'Заметки', 'Бестиарий', 'Настройки карты', 'Музыка', 'Звуки', 'Картинки', 'Сражения', 'Настройки', 'Справка'];

module.exports = async function uiNamesFirstDm(rig) {
  let dm = rig.dm;
  await lib.settle(dm, 'worldMapOpen && !_wmAnim', 30000);
  await dm.evaluate(PAGE);

  // ── B ─────────────────────────────────────────────────
  const fresh = await dm.evaluate('({ rooms: roomsShape, worn: _worn })');
  // RED ON: roomsShape and _worn set back to 'poly' (state.js, shapeMenu.js) - 2026-10-22
  rig.check(fresh.rooms === 'rect' && fresh.worn === 'btn-rect',
    'B: a fresh start does not draw rectangles: ' + JSON.stringify(fresh));

  // ── A (Rooms and Effects) ─────────────────────────────────────────────────
  await lib.openMap(rig, { w: 900, h: 600 });
  await dm.evaluate(PAGE);
  await dm.evaluate('worldMapShow(); 0');
  await lib.settle(dm, 'worldMapOpen && !_wmAnim && !document.body.classList.contains("wm-empty")', 15000);
  await dm.evaluate('new Promise(r => setTimeout(r, 60))');
  const fresh2 = await dm.evaluate('({ ...__unShape(), open: worldMapOpen })');
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(fresh2.open && fresh2.label === 'Group' && fresh2.title.startsWith('Group - gathers maps together'),
    'A: the Campaign shape button is not labelled Group: ' + JSON.stringify(fresh2));
  const add = await dm.evaluate(`(() => {
    const b = document.getElementById('wm-add'), l = b.querySelector('.tb-shape-label');
    const probe = document.createElement('button'); probe.className = 'sm-hbtn primary'; document.body.appendChild(probe);
    const solid = getComputedStyle(probe).backgroundColor; probe.remove();
    return { text: __unVis(l) ? l.textContent.trim() : '', bg: getComputedStyle(b).backgroundColor, solid };
  })()`);
  // RED ON: the 'tb-labeled' class removed from #wm-add (index.html) - 2026-10-22
  rig.check(add.text === 'Map', 'C: the Campaign add button does not show the word Map: ' + JSON.stringify(add));
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(!!add.solid && add.bg !== add.solid, 'C: the Campaign add button is solid blue: ' + JSON.stringify(add));

  await dm.evaluate('worldMapHide(); setPlaceMode("rooms"); 0');
  await lib.settle(dm, '!worldMapOpen && !_wmAnim', 15000);
  const rooms = await dm.evaluate('__unShape()');
  // RED ON: the 'Room' label branch removed from refreshShapeButton (shapeMenu.js) - 2026-10-22
  rig.check(rooms.label === 'Room' && rooms.title.startsWith('Room - hides part of the map from the players'),
    'A: the Rooms shape button is not labelled Room: ' + JSON.stringify(rooms));
  await dm.evaluate('setPlaceMode("effects"); 0');
  await lib.settle(dm, 'placeMode === "effects"', 8000);
  const fx = await dm.evaluate('__unShape()');
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(fx.label === 'Room' && fx.title.startsWith('Room - leave Effects'), 'A: the Room button changed in Effects mode: ' + JSON.stringify(fx));
  rig.check(await dm.evaluate('(() => { const b = document.getElementById("btn-effects"), l = b.querySelector(".tb-shape-label"); return __unVis(l) && l.textContent.trim() === "Effects" && b.title.startsWith("Effects (E)"); })()'),
            'A: the Effects button is not labelled Effects');
  await dm.evaluate('setPlaceMode("rooms"); 0');

  // ── D ─────────────────────────────────────────────────────────────────────
  const rail = await dm.evaluate('__unRail()');
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(JSON.stringify(rail.map(r => r.text)) === JSON.stringify(EN),
    'D: the rail labels do not read ' + EN.join(', ') + ': ' + JSON.stringify(rail.map(r => r.text)));
  const lines = id => dm.evaluate(`(() => { const r = document.createRange(); r.selectNodeContents(document.querySelector('#${id} .rail-lbl'));
    return new Set([...r.getClientRects()].map(x => Math.round(x.top))).size; })()`);
  const one = await lines('btn-world'), two = await lines('dock-tab-scene');
  // RED ON: '.rail-lbl-2' dropped from the Map settings label (index.html) - 2026-10-22
  rig.check(one === 1 && two === 2,
    'D: Map settings does not take two lines (Campaign ' + one + ' line, Map settings ' + two + ')');

  // ── E ─────────────────────────────────────────────────────────────────────
  const first = await dm.evaluate('document.querySelector("#dock-pane-scene .cp-group").id');
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(first === 'cp-sec-grid', 'E: Grid is not the first section of Map settings: ' + first);

  // ── F ─────────────────────────────────────────────────────────────────────
  await dm.evaluate('document.querySelector(".about-lang [data-lang=\\"ru\\"]").click(); 0');
  dm = await rig.restart();
  await lib.installHelpers(dm);
  await dm.evaluate(PAGE);
  await lib.settle(dm, 'typeof currentScene !== "undefined" && !!currentScene', 30000);
  await dm.evaluate('(worldMapOpen ? 0 : worldMapShow()); 0');
  await lib.settle(dm, 'worldMapOpen && !_wmAnim', 15000);
  await dm.evaluate('new Promise(r => setTimeout(r, 60))');
  const ruRail = await dm.evaluate('__unRail().map(r => r.text)');
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(JSON.stringify(ruRail) === JSON.stringify(RU),
    'F: the Russian rail reads ' + JSON.stringify(ruRail));
  const ruGroup = await dm.evaluate('__unShape().label');
  await dm.evaluate('worldMapHide(); setPlaceMode("rooms"); 0');
  await lib.settle(dm, '!worldMapOpen && !_wmAnim', 15000);
  await dm.evaluate('new Promise(r => setTimeout(r, 60))');
  const ruRoom = await dm.evaluate('__unShape().label');
  // RED BY DESIGN: written against the feature, never re-proved
  rig.check(ruGroup === 'Группа' && ruRoom === 'Комната',
    'F: the shape button reads ' + ruGroup + ' / ' + ruRoom + ' in Russian');
};
