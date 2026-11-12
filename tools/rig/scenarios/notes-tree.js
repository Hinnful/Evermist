'use strict';

// notes-tree.js - THE NOTES TREE: THE SAME LIST PATTERN (spec notes-tree, DoD 1-9, 11, 12).
//
// One app with no Google client. Built through the app's own stores: the map "Замок" (a 2400x1600 picture) with the
// rooms "Зал" (revealed), an unnamed hidden room, an unnamed revealed room and "Кухня" (hidden); six more maps; the
// Campaign groups "Север" (holding the smaller "Крепость") and "Юг"; the map "Башня" inside "Север"; two roads, one
// holding "Мельница"; three monsters with a note; two lore entries. The pointer, the drags, Ctrl+R and Ctrl+Z are real
// input events (CDP Input), so hover, elementFromPoint, the hold timer and focus are the app's own.
//
// THE CRITERIA ARE THIS HEADER. Each line has its check beneath it.
//
//   1. Every row but a section title shows ⋯ under the pointer, holding its right-click menu's rows; a room and a map
//      also hold Move to group, a Campaign group does not; a section title has no ⋯.
//   2. Rooms, maps, Campaign groups, roads, monsters and lore reorder by drag, with the blue line showing mid-drag.
//   3. A room held on another room makes a Notes group with its name field open; its ⋯ holds Rename and Ungroup; the
//      last room dragged out removes it. A monster held on another makes one too.
//   4. A lore entry dropped on another's middle nests inside it.
//   5. With the Campaign open, a map dropped on "Юг" joins it with its card inside the outline; one dropped after a
//      map inside "Север" joins "Север" clear of "Крепость"; one dropped among the loose maps leaves every outline. The
//      road's map is never a grouping target and never regrouped. With the Campaign shut, a map dropped on "Север"
//      joins it, clear of the nested "Крепость".
//   6. A map held on a loose map lands beside it, an outline wraps both, and the group's name field opens in the tree.
//  6a. Ctrl+Z with the tree focused undoes the last drop: the card and group back (Campaign open), the new group gone
//      and the card back (Campaign shut), the nested join undone (Campaign shut).
//   7. A Campaign group dragged over another's middle does not nest; it reorders.
//   8. Moving rooms changes no fog pixel and no room in the map's own list; an unnamed room keeps "Room 3".
//   9. A room Claude adds lands last; a room deleted and brought back by the map's Ctrl+Z, a map restored from the
//      Trash and a monster whose note comes back take their old place.
//  11. A room's Delete asks first; a map's goes to the Trash with the undo toast.
//  12. Claude's read_notes_order and set_notes_order read and set the rooms' order and Notes groups.

const lib = require('../lib');
const kit = require('../backupKit');

const q = JSON.stringify;
const box = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const ROOMS = [
  { id: 1, uid: 'uH', name: 'Зал', mode: 'reveal', cornerRadius: 0, vertices: box(100, 100, 700, 700) },
  { id: 2, uid: 'uA', name: '', mode: 'shroud', cornerRadius: 0, vertices: box(900, 100, 1300, 500) },
  { id: 3, uid: 'uB', name: '', mode: 'reveal', cornerRadius: 0, vertices: box(100, 900, 500, 1300) },
  { id: 4, uid: 'uK', name: 'Кухня', mode: 'shroud', cornerRadius: 0, vertices: box(900, 900, 1300, 1300) },
];
const CENTRES = [[400, 400], [1100, 300], [300, 1100], [1100, 1100], [1800, 1200]];

const PAGE = `
globalThis.__nrow = key => document.querySelector('#nw-tl .nw-row[data-key="' + CSS.escape(key) + '"]');
globalThis.__kids = key => { const n = notesTreeFind(_ntRoot, key); return n ? n.children.map(c => c.key) : null; };
globalThis.__names = key => { const n = notesTreeFind(_ntRoot, key); return n ? n.children.map(c => c.kind === 'ngroup' ? c.name + '[' + c.children.map(m => m.name).join(',') + ']' : c.name) : null; };
globalThis.__open = keys => { _ntOpen.clear(); for (const k of keys) _ntOpen.add(k); ntRefresh(); return 0; };
globalThis.__openAll = () => { for (const k of notesTreeFoldable(_ntRoot)) _ntOpen.add(k); ntRefresh(); return 0; };
globalThis.__pt = (el, f) => { const r = el.getBoundingClientRect(); return { x: r.left + Math.min(r.width / 2, 60), y: r.top + r.height * (f == null ? 0.5 : f) }; };
// Both rows in view, their midpoint in the middle of the list, so the drag never sits in the edge band that scrolls it.
globalThis.__pair = (a, b, fb) => { const box = __lib.getBoundingClientRect(), z = box.width / __lib.offsetWidth || 1;
  const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
  __lib.scrollTop += ((Math.min(ra.top, rb.top) + Math.max(ra.bottom, rb.bottom)) / 2 - (box.top + box.height / 2)) / z;
  return [__pt(a), __pt(b, fb)]; };
globalThis.__lib = document.getElementById('nw-tl');
globalThis.__menu = () => [...document.querySelectorAll('.lib-menu:not(.lib-sub) > .sm-mi')].map(b => b.querySelector('.nm').textContent + '|' + b.querySelector('.ky').textContent);
globalThis.__pick = label => [...document.querySelectorAll('.lib-menu .sm-mi')].find(b => b.querySelector('.nm').textContent === label);
globalThis.__dialog = () => { const ok = document.getElementById('cd-ok'); return ok && ok.offsetParent !== null ? document.getElementById('cd-title').textContent : null; };
globalThis.__scene = name => allScenes.find(s => s.name === name);
globalThis.__in = (name, place) => { const s = __scene(name); const rec = worldPlaceByName(place); return !!rec && wmRectInPoly(wmCardRect(s.worldPos), wmOutline(rec)); };
globalThis.__home = name => { const out = Object.create(null); for (const r of worldPlaceRecords()) out[r.name] = wmOutline(r); return wmPlaceOf(wmCardRect(__scene(name).worldPos), out); };
globalThis.__key = name => 'map:' + __scene(name).id;
0`;

module.exports = async function notesTree(rig) {
  const dm = rig.dm;
  const ev = (x, ms) => dm.evaluate(x, ms);
  const mouse = (type, p, o) => dm.send('Input.dispatchMouseEvent', Object.assign({ type, x: Math.round(p.x), y: Math.round(p.y),
    button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 }, o || {}));
  const hover = p => mouse('mouseMoved', p, { button: 'none', buttons: 0 });
  const click = async p => { await hover(p); await mouse('mousePressed', p); await mouse('mouseReleased', p); };
  const rightClick = async p => { await hover(p); await mouse('mousePressed', p, { button: 'right', buttons: 2 }); await mouse('mouseReleased', p, { button: 'right' }); };
  const drag = async (from, to, mid) => {
    await hover(from);
    await mouse('mousePressed', from);
    for (let k = 1; k <= 8; k++) await mouse('mouseMoved', { x: from.x + (to.x - from.x) * k / 8, y: from.y + (to.y - from.y) * k / 8 });
    let seen = null;
    if (mid) seen = await mid();
    await mouse('mouseReleased', to);
    return seen;
  };
  const key = async (k, code, vk, mods) => {
    await dm.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods || 0 });
    await dm.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods || 0 });
  };
  const type = async text => { await dm.send('Input.insertText', { text }); await key('Enter', 'Enter', 13); };
  const row = k => `__nrow(${q(k)})`;
  const dragTo = async (a, b, fy, mid) => { const [f, t] = await ev(`__pair(${row(a)}, ${row(b)}, ${fy == null ? 'null' : fy})`); return drag(f, t, mid); };
  const line = () => lib.settle(dm, `!!document.querySelector('#nw-tl .lib-line') && !document.querySelector('#nw-tl .lib-line').hidden`, 3000);
  const lit = () => lib.settle(dm, `!!document.querySelector('#nw-tl .lib-merge')`, 3000);
  const join = () => lib.settle(dm, `!!document.querySelector('#nw-tl .lib-join')`, 3000);
  const undo = async () => { await ev(`__lib.focus(); 0`); await key('z', 'KeyZ', 90, 2); };
  const claude = (tool, args) => ev(`_mcpAnswer(${q({ tool, args })})`, 60000);
  const said = r => (r && typeof r.text === 'string' ? r.text : q(r));

  await lib.installHelpers(dm);
  await kit.install(dm);
  const names = ['Замок', 'Лес', 'Луг', 'Пещера', 'Деревня', 'Мельница', 'Башня'];
  const ids = await ev(`(async () => {
    const out = {};
    for (const [i, n] of ${q(names)}.entries()) {
      const f = await __bk.noiseFile(n, i ? 400 : 2400, i ? 300 : 1600, i + 2, 0.8);
      out[n] = (await addMapsToLibrary([f], { x: 4000 + i * 400, y: 4000 }, true)).ids[0];
    }
    await __bk.editScene(out['Замок'], s => { s.polygons = ${q(ROOMS)}; s.nextPolygonId = 5; });
    worldPlaceSet('Север', { vertices: ${q(box(0, 0, 1200, 1200))} });
    worldPlaceSet('Крепость', { vertices: ${q(box(100, 100, 500, 500))} });
    worldPlaceSet('Юг', { vertices: ${q(box(1500, 0, 2300, 800))} });
    const spots = { 'Башня': [800, 800], 'Замок': [0, 2000], 'Лес': [400, 2000], 'Луг': [800, 2000], 'Пещера': [1200, 2000], 'Деревня': [1600, 2000], 'Мельница': [2400, 2400] };
    for (const n of Object.keys(spots)) await worldSceneSet(out[n], { worldPos: { x: spots[n][0], y: spots[n][1] } });
    worldAssignAll();
    for (const [n, note] of [['Волк', 'серый'], ['Гоблин', 'зелёный'], ['Дракон', 'красный']]) { const b = cbNewBlock(n); b.notes = note; }
    cbSave();
    notesEntryAdd('lore', 'Боги', 'lore');
    notesEntryAdd('lore', 'Мифы', 'lore');
    return out;
  })()`, 240000);
  for (const [from, to, name] of [['Север', 'Юг', 'Тракт'], ['Юг', 'Крепость', 'Тропа']]) {
    const r = await claude('create_road', { from, to, name });
    rig.check(!r.isError, 'setup: the road ' + name + ' was not made: ' + said(r));
  }
  const held = await claude('set_road_maps', { name: 'Тракт', add: ['Мельница'] });
  rig.check(!held.isError, 'setup: "Мельница" did not go on the road: ' + said(held));
  const Z = ids['Замок'];
  await ev(`switchScene(${q(Z)})`, 60000);
  await lib.settle(dm, `!!currentScene && currentScene.id === ${q(Z)} && fogCoverT === 0 && !fogTransRafId && !fogDirty`, 60000);
  await ev(`(async () => { nwShow(); await searchReadScenes(); ntRefresh(); return 0; })()`, 60000);
  await ev(PAGE);
  await ev('__openAll()');
  const R = n => 'room:' + Z + ':' + n;
  const fogNow = () => ev(`(${q(CENTRES)}).map(([x, y]) => __rigFog(x, y))`);
  const fog0 = await fogNow();
  rig.check(fog0[0] < 128 && fog0[1] > 200 && fog0[2] < 128 && fog0[3] > 200, 'setup: the rooms\' fog is not as drawn: ' + q(fog0));
  const uids0 = await ev('polygons.map(p => p.uid)');

  // 1
  await lib.step(rig, '1', async () => {
    const rows = [R(4), 'map:' + Z, 'place:Север', 'campaign'];
    for (const k of rows) {
      await hover(await ev(`(() => { ${row(k)}.scrollIntoView({ block: 'center' }); return __pt(${row(k)}); })()`));
      const shown = await ev(`[...__lib.querySelectorAll('.nw-row')].filter(r => r.querySelector('.lib-more') && getComputedStyle(r.querySelector('.lib-more')).display !== 'none').map(r => r.dataset.key)`);
      rig.check(q(shown) === q([k]), '1: ⋯ shows on ' + q(shown) + ', not only on the row under the pointer ' + k);
    }
    rig.check(await ev(`!document.querySelector('#nw-tl .nw-row.sec .lib-more')`), '1: a section title carries ⋯');
    const menuOf = async (k, how) => {
      const p = await ev(`(() => { ${row(k)}.scrollIntoView({ block: 'center' }); return __pt(${row(k)}); })()`);
      if (how === 'right') await rightClick(p);
      else {
        await hover(p);
        await click(await ev(`(() => { const r = ${row(k)}.querySelector('.lib-more').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`));
      }
      const m = await ev('__menu()');
      await key('Escape', 'Escape', 27);
      return m;
    };
    const room = await menuOf(R(4)), roomRight = await menuOf(R(4), 'right');
    rig.check(q(room) === q(['Rename|Ctrl+R', 'Move to group|›', 'Show on map|', 'Delete|']), '1: a room\'s ⋯ lists ' + q(room));
    rig.check(q(room) === q(roomRight), '1: the room\'s right-click menu ' + q(roomRight) + ' is not its ⋯ ' + q(room));
    const map = await menuOf('map:' + ids['Лес']);
    rig.check(map.includes('Move to group|›') && map[0] === 'Rename|Ctrl+R', '1: a map\'s ⋯ lists ' + q(map));
    const place = await menuOf('place:Юг');
    rig.check(!place.some(r => r.startsWith('Move to group')) && place.includes('Delete|'), '1: a Campaign group\'s ⋯ lists ' + q(place));
    const road = await menuOf('map:' + ids['Мельница']);
    rig.check(!road.some(r => r.startsWith('Move to group')), '1: the road\'s map offers Move to group: ' + q(road));
  });

  // 2 and 8
  await lib.step(rig, '2 + 8', async () => {
    await ev(`__open([${q('map:' + Z)}, 'place:Север'])`);
    const shown = await dragTo(R(4), R(1), 0.15, line);
    rig.check(shown, '2: no blue line showed while a room was dragged');
    rig.check(q(await ev(`__kids(${q('map:' + Z)})`)) === q([R(4), R(1), R(2), R(3)]), '2: the room did not land above "Зал": ' + q(await ev(`__names(${q('map:' + Z)})`)));
    await dragTo(R(3), R(4), 0.15);
    const nm = await ev(`__names(${q('map:' + Z)})`);
    rig.check(q(nm) === q(['Room 3', 'Кухня', 'Зал', 'Room 2']), '8: the moved unnamed room lost its label, or did not move: ' + q(nm));

    await dragTo('map:' + ids['Пещера'], 'map:' + ids['Лес'], 0.15);
    const camp = await ev(`__kids('campaign')`);
    rig.check(camp.indexOf('map:' + ids['Пещера']) === camp.indexOf('map:' + ids['Лес']) - 1, '2: the map did not land above "Лес": ' + q(camp));
    // 7
    const before = await ev(`__kids('campaign')`);
    const nested = await dragTo('place:Юг', 'place:Север', 0.5, async () => (await join()) || (await lit()));
    rig.check(!nested, '7: a Campaign group lit as a target over another group\'s middle');
    rig.check(q(await ev(`__kids('campaign')`)) === q(before) && await ev(`!__kids('place:Север').includes('place:Юг')`), '7: a group dropped on another\'s middle changed the tree');
    await dragTo('place:Юг', 'place:Север', 0.15);
    const after = await ev(`__kids('campaign')`);
    rig.check(after.indexOf('place:Юг') === after.indexOf('place:Север') - 1, '2/7: the group "Юг" did not move above "Север": ' + q(after));

    await ev(`__open(['sec:roads', 'sec:monster', 'sec:lore'])`);
    const roads0 = await ev(`__names('sec:roads')`);
    await dragTo('road:' + await ev(`worldRoadRecords().find(r => r.name === 'Тропа').uid`), 'road:' + await ev(`worldRoadRecords().find(r => r.name === 'Тракт').uid`), 0.15);
    rig.check(q(await ev(`__names('sec:roads')`)) === q(['Тропа', 'Тракт']), '2: the road did not move: ' + q(roads0) + ' -> ' + q(await ev(`__names('sec:roads')`)));
    const mon = k => ev(`'monster:' + Object.values(cbState.blocks).find(b => b.name === ${q(k)}).id`);
    await dragTo(await mon('Дракон'), await mon('Волк'), 0.15);
    rig.check(q(await ev(`__names('sec:monster')`)) === q(['Дракон', 'Волк', 'Гоблин']), '2: the monster did not move: ' + q(await ev(`__names('sec:monster')`)));
    const lore = k => ev(`'entry:' + notesEntriesAll().find(e => e.name === ${q(k)}).id`);
    await dragTo(await lore('Мифы'), await lore('Боги'), 0.15);
    rig.check(q(await ev(`__names('sec:lore')`)) === q(['Мифы', 'Боги']), '2: the lore entry did not move: ' + q(await ev(`__names('sec:lore')`)));
    // 4
    const into = await dragTo(await lore('Мифы'), await lore('Боги'), 0.5, join);
    rig.check(into, '4: a lore entry over another\'s middle did not light it');
    rig.check(await ev(`notesEntriesAll().find(e => e.name === 'Мифы').parent === notesEntriesAll().find(e => e.name === 'Боги').id`), '4: the lore entry did not nest');
  });

  // 3
  await lib.step(rig, '3', async () => {
    await ev(`__open([${q('map:' + Z)}])`);
    const heldLit = await dragTo(R(2), R(1), 0.5, lit);
    rig.check(heldLit, '3: held over the middle of "Зал", the target did not light');
    const editing = await lib.settle(dm, `document.activeElement && !!document.activeElement.closest('#nw-tl .nw-tn')`, 5000);
    rig.check(editing, '3: the new Notes group\'s name field is not open');
    await type('Крыло');
    await ev('__openAll()');
    const nm = await ev(`__names(${q('map:' + Z)})`);
    rig.check(nm.includes('Крыло[Зал,Room 2]'), '3: the hold did not make the group "Крыло" of the two, target first: ' + q(nm));
    const gk = await ev(`notesTreeFind(_ntRoot, ${q('map:' + Z)}).children.find(c => c.kind === 'ngroup').key`);
    await hover(await ev(`__pt(${row(gk)})`));
    await click(await ev(`(() => { const r = ${row(gk)}.querySelector('.lib-more').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`));
    const gm = await ev('__menu()');
    await key('Escape', 'Escape', 27);
    rig.check(q(gm) === q(['Rename|Ctrl+R', 'Ungroup|']), '3: the Notes group\'s ⋯ lists ' + q(gm));
    await dragTo(R(1), R(3), 0.15);
    rig.check(await ev(`notesTreeFind(_ntRoot, ${q(gk)}) !== null`), '3 setup: the group went with one room still in it');
    await dragTo(R(2), R(3), 0.15);
    rig.check(await ev(`notesTreeFind(_ntRoot, ${q(gk)}) === null && !notesOrderGet(${q('map:' + Z)}).order.some(k => k[0] === '#')`), '3: the group stayed after its last room left');
    const mon = k => ev(`'monster:' + Object.values(cbState.blocks).find(b => b.name === ${q(k)}).id`);
    await ev(`__open(['sec:monster'])`);
    await dragTo(await mon('Гоблин'), await mon('Волк'), 0.5, lit);
    await lib.settle(dm, `document.activeElement && !!document.activeElement.closest('#nw-tl .nw-tn')`, 5000);
    await type('Стая');
    await ev('__openAll()');
    rig.check((await ev(`__names('sec:monster')`)).includes('Стая[Волк,Гоблин]'), '3: two monsters did not make a Notes group: ' + q(await ev(`__names('sec:monster')`)));
  });

  // 8
  await lib.step(rig, '8', async () => {
    await lib.settle(dm, '!fogDirty && !fogTransRafId', 10000);
    const fog1 = await fogNow();
    rig.check(fog1.every((v, i) => Math.abs(v - fog0[i]) <= 2), '8: the fog changed after rooms moved in Notes: ' + q(fog0) + ' -> ' + q(fog1));
    rig.check(q(await ev('polygons.map(p => p.uid)')) === q(uids0), '8: the map\'s own room list changed: ' + q(await ev('polygons.map(p => p.uid)')));
    await ev('doAutoSave()', 60000);
    const stored = await ev(`sceneStore.loadScene(${q(Z)}).then(r => r.polygons.map(p => p.uid))`, 20000);
    rig.check(q(stored) === q(uids0), '8: the saved map\'s rooms were reordered: ' + q(stored));
  });

  // 5 and 6a with the Campaign open
  await lib.step(rig, '5 open', async () => {
    await ev('worldMapShow(); 0');
    await lib.settle(dm, 'worldMapOpen && !_wmAnim', 20000);
    await ev(`__open(['place:Север', 'place:Юг'])`);
    const pos0 = await ev(`({ ...__scene('Лес').worldPos })`);
    const into = await dragTo(await ev(`__key('Лес')`), 'place:Юг', 0.5, join);
    rig.check(into, '5: "Юг" did not light under a dragged map');
    rig.check(await ev(`__scene('Лес').group === 'Юг' && __in('Лес', 'Юг') && __kids('place:Юг').includes(__key('Лес'))`), '5: the map dropped on "Юг" did not join it inside its outline: ' + q(await ev(`({ g: __scene('Лес').group, p: __scene('Лес').worldPos })`)));
    // 6a, open
    await undo();
    const back = await ev(`({ g: __scene('Лес').group, p: __scene('Лес').worldPos })`);
    rig.check(back.g === '' && back.p.x === pos0.x && back.p.y === pos0.y, '6a: Ctrl+Z with the Campaign open did not put the card back: ' + q(back) + ' was ' + q(pos0));
    await dragTo(await ev(`__key('Лес')`), 'place:Юг', 0.5, join);

    await ev(`__open(['place:Север'])`);
    await dragTo(await ev(`__key('Пещера')`), await ev(`__key('Башня')`), 0.85);
    const kids = await ev(`__kids('place:Север')`);
    rig.check(await ev(`__scene('Пещера').group === 'Север' && __home('Пещера') === 'Север'`) && kids.indexOf(await ev(`__key('Пещера')`)) === kids.indexOf(await ev(`__key('Башня')`)) + 1,
      '5: a map dropped after "Башня" did not join "Север" clear of "Крепость", just after it: ' + q({ g: await ev(`__scene('Пещера').group`), home: await ev(`__home('Пещера')`), kids }));
    await dragTo(await ev(`__key('Башня')`), await ev(`__key('Луг')`), 0.15);
    rig.check(await ev(`__scene('Башня').group === '' && __home('Башня') === '' && __kids('campaign').includes(__key('Башня'))`), '5: a map dropped among the loose maps did not leave every outline: ' + q(await ev(`({ g: __scene('Башня').group, home: __home('Башня') })`)));
    const aims = await ev(`[ntDragAim(__key('Мельница'), 'place:Юг', 'middle'), ntDragAim(__key('Луг'), __key('Мельница'), 'middle'),
      ntDragAim(__key('Мельница'), __key('Пещера'), 'before'), ntDragAim(__key('Мельница'), __key('Луг'), 'before')]`);
    rig.check(q(aims) === q([null, null, null, 'line']), '5: the road\'s map is grouped or grouped with: ' + q(aims));
    await ev('worldMapHide(); 0');
    await lib.settle(dm, '!worldMapOpen', 20000);
  });

  // 5 nested, 6 and 6a with the Campaign shut
  await lib.step(rig, '5 shut, 6, 6a', async () => {
    rig.check(await ev('!worldMapOpen'), '5 setup: the Campaign is still open');
    const pos0 = await ev(`({ ...__scene('Деревня').worldPos })`);
    await dragTo(await ev(`__key('Деревня')`), 'place:Север', 0.5, join);
    rig.check(await ev(`__scene('Деревня').group === 'Север' && __home('Деревня') === 'Север'`), '5: with the Campaign shut, the map dropped on "Север" is in ' + q(await ev(`__home('Деревня')`)) + ', not "Север" clear of "Крепость"');
    await undo();
    const back = await ev(`({ g: __scene('Деревня').group, p: __scene('Деревня').worldPos })`);
    rig.check(back.g === '' && back.p.x === pos0.x && back.p.y === pos0.y, '6a: Ctrl+Z with the Campaign shut did not undo the nested join: ' + q(back));

    const camp0 = await ev(`__kids('campaign')`), lugKey = await ev(`__key('Луг')`), derKey = await ev(`__key('Деревня')`);
    const luk0 = await ev(`({ ...__scene('Луг').worldPos })`);
    const heldLit = await dragTo(await ev(`__key('Луг')`), await ev(`__key('Деревня')`), 0.5, lit);
    rig.check(heldLit, '6: a loose map did not light under a held map');
    const fresh = await ev(`__scene('Деревня').group`);
    const st = await ev(`({ l: __scene('Луг').worldPos, d: __scene('Деревня').worldPos, lg: __scene('Луг').group, step: WM_STEP_X })`);
    rig.check(!!fresh && st.lg === fresh && st.l.x === st.d.x + st.step && st.l.y === st.d.y && await ev(`__in('Луг', ${q(fresh)}) && __in('Деревня', ${q(fresh)})`),
      '6: the pair did not make a group wrapping both with the card beside the target: ' + q({ fresh, st }));
    const naming = await lib.settle(dm, `document.activeElement && !!document.activeElement.closest(${q('.nw-row[data-key="place:' + fresh + '"]')})`, 5000);
    rig.check(naming, '6: the new group\'s name field did not open in the tree');
    await type('Поляна');
    const camp1 = await ev(`__kids('campaign')`);
    rig.check(await ev(`!!worldPlaceByName('Поляна') && __scene('Луг').group === 'Поляна'`) && camp1.indexOf('place:Поляна') === camp0.filter(k => k !== lugKey).indexOf(derKey),
      '6: the group was not named "Поляна" where the target stood: ' + q(camp1));
    await undo();
    const gone = await ev(`({ place: !!worldPlaceByName('Поляна'), lg: __scene('Луг').group, dg: __scene('Деревня').group, l: __scene('Луг').worldPos })`);
    rig.check(!gone.place && gone.lg === '' && gone.dg === '' && gone.l.x === luk0.x && gone.l.y === luk0.y, '6a: Ctrl+Z with the Campaign shut did not take the new group back: ' + q(gone));
  });

  // 11 and 9
  await lib.step(rig, '11 + 9', async () => {
    await ev(`__open([${q('map:' + Z)}])`);
    await rightClick(await ev(`(() => { ${row(R(4))}.scrollIntoView({ block: 'center' }); return __pt(${row(R(4))}); })()`));
    await click(await ev(`(() => { const r = __pick('Delete').getBoundingClientRect(); return { x: r.left + 10, y: r.top + r.height / 2 }; })()`));
    rig.check(await lib.settle(dm, '__dialog() !== null', 5000), '11: a room\'s Delete did not ask');
    await ev(`document.getElementById('cd-cancel').click(); 0`);
    rig.check(await ev(`polygons.some(p => p.uid === 'uK')`), '11: Cancel deleted the room');

    const del = await ev(`__key('Пещера')`);
    await ev(`__open(['place:Север'])`);
    const north0 = await ev(`__kids('place:Север')`);
    await rightClick(await ev(`(() => { ${row(del)}.scrollIntoView({ block: 'center' }); return __pt(${row(del)}); })()`));
    await click(await ev(`(() => { const r = __pick('Delete').getBoundingClientRect(); return { x: r.left + 10, y: r.top + r.height / 2 }; })()`));
    rig.check(await ev('__dialog() === null'), '11: a map\'s Delete asked');
    rig.check(await lib.settle(dm, `!__scene('Пещера') && document.getElementById('scene-undo-toast').style.display !== 'none'`, 5000), '11: the map did not go with the undo toast');
    await ev('commitPendingDelete(); 0');
    const listed = await lib.poll(async () => (await ev(`sceneTrash.list().then(l => l.some(e => e.id === ${q(ids['Пещера'])}))`, 20000)) || null, 20000, 300);
    rig.check(!!listed, '11: the deleted map is not in the Trash');
    await ev(`sceneTrash.restore(${q(ids['Пещера'])})`, 60000);
    await lib.settle(dm, `!!__scene('Пещера')`, 20000);
    await ev(`(async () => { await searchReadScenes(); ntRefresh(); __open(['place:Север']); return 0; })()`, 30000);
    rig.check(q(await ev(`__kids('place:Север')`)) === q(north0), '9: the restored map did not take its old place in "Север": ' +
      q(await ev(`__kids('place:Север')`)) + ' was ' + q(north0));

    await ev(`__open([${q('map:' + Z)}])`);
    const r0 = await ev(`__names(${q('map:' + Z)})`);
    const made = await claude('create_room', { name: 'Замок', room: 'Ниша', fog: 'hidden', outline: [[70, 70], [80, 70], [80, 80], [70, 80]] });
    rig.check(!made.isError, '9 setup: Claude did not draw a room: ' + said(made));
    await ev(`(async () => { await searchReadScenes(); ntRefresh(); return 0; })()`, 30000);
    const r1 = await ev(`__names(${q('map:' + Z)})`);
    rig.check(q(r1) === q(r0.concat(['Ниша'])), '9: the room Claude added did not land last: ' + q(r1));
    await ev(`(() => { setPlaceMode('rooms'); setShape('select'); selectedPolygonId = polygons.find(p => p.uid === 'uH').id; deleteSelectedPolygon(); ntRefresh(); return 0; })()`);
    rig.check(!(await ev(`__names(${q('map:' + Z)})`)).includes('Зал'), '9 setup: the room did not go');
    await ev('undo(); ntRefresh(); 0');
    rig.check(q(await ev(`__names(${q('map:' + Z)})`)) === q(r1), '9: the room brought back by Ctrl+Z did not take its old place: ' + q(await ev(`__names(${q('map:' + Z)})`)));
    await ev(`__open(['sec:monster'])`);
    const m0 = await ev(`__names('sec:monster')`);
    await ev(`(() => { const b = Object.values(cbState.blocks).find(x => x.name === 'Дракон'); b.notes = ''; cbSave(); ntRefresh(); return 0; })()`);
    rig.check(!(await ev(`__names('sec:monster')`)).includes('Дракон'), '9 setup: the monster with no note stayed in the tree');
    await ev(`(() => { const b = Object.values(cbState.blocks).find(x => x.name === 'Дракон'); b.notes = 'снова'; cbSave(); ntRefresh(); return 0; })()`);
    rig.check(q(await ev(`__names('sec:monster')`)) === q(m0), '9: the monster re-entering the tree did not take its old place: ' + q(await ev(`__names('sec:monster')`)) + ' was ' + q(m0));
  });

  // 12
  await lib.step(rig, '12', async () => {
    const read = await claude('read_notes_order', { level: 'map', name: 'Замок' });
    const rows = read.isError ? null : JSON.parse(read.text).rows.map(r => r.name);
    rig.check(q(rows) === q(await ev(`notesTreeFind(_ntRoot, ${q('map:' + Z)}).children.flatMap(c => c.kind === 'ngroup' ? c.children.map(m => m.name) : [c.name])`)),
      '12: read_notes_order does not read the tree: ' + said(read));
    const set = await claude('set_notes_order', { level: 'map', name: 'Замок', order: ['Ниша', 'Зал'], groups: [{ name: 'Подвал', items: ['Кухня', 'Room 3'] }] });
    rig.check(!set.isError, '12: set_notes_order failed: ' + said(set));
    await ev('__openAll()');
    const nm = await ev(`__names(${q('map:' + Z)})`);
    rig.check(nm[0] === 'Ниша' && nm[1] === 'Зал' && nm.includes('Подвал[Кухня,Room 3]'), '12: set_notes_order did not reach the tree: ' + q(nm));
    const again = await claude('read_notes_order', { level: 'map', name: 'Замок' });
    rig.check(!again.isError && JSON.parse(again.text).rows.some(r => r.name === 'Кухня' && r.notesGroup === 'Подвал'), '12: read_notes_order does not name the Notes group: ' + said(again));
    rig.check(q(await ev('polygons.filter(p => p.uid !== polygons[polygons.length - 1].uid).map(p => p.uid)')) === q(uids0), '12: Claude\'s order reordered the map\'s rooms');
    const undone = await claude('undo_last_change', {});
    rig.check(!undone.isError && !(await ev(`__names(${q('map:' + Z)})`)).some(n => n.startsWith('Подвал')), '12: undo_last_change did not take the order back: ' + said(undone));
  });

  rig.byEye('One look at a copy of the DM\'s own library in the Notes tree: many maps, floor-plan maps with many unnamed rooms.');
};
