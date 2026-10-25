'use strict';

// world-map-fan.js — A GROUP SHOWS THE MAPS IT HOLDS (backlog 218): a count on its name plate and a hand of cards.
//
// THE GOAL OF THIS FEATURE: zoomed out on the Campaign, the DM sees what a place holds without zooming in, and
// without a grid of prints crossing walls or covering the name (that was built three times and removed).
//
// The hand is src/world/worldMapFan.js; its placement is wmFanSpot in worldMapPlan.js.
//
// THE CRITERIA ARE THIS HEADER, in the order of the checks below.
//
//   1. A place's name plate carries the number of maps it holds as a pill after the name; a place with no maps has
//      no pill. Renaming edits the name alone: the pill is not part of the editable text and survives the rename.
//      A name the place has room for shows whole, never cut short with an ellipsis.
//   2. A place shows its first three maps as cards, and a fourth card reading "+N" when it holds more than three.
//   3. Every card lies inside its place's outline, and clear of the name plate.
//   4. A place too small for a hand shows none, and keeps its count.
//   5. Zoomed in to the scenes level no hand is shown.
//   6. A click on a card picks that map; a click on "+N" picks the place; a double-click on a card opens that map.
//
// ⚠ 6 OPENS A SCENE, so it runs last. ⚠ THE FLY AFTER A CARD CLICK STARTS A MOMENT LATE, because a double-click
// must be able to cancel it; a scenario waits for it before moving the camera.

const lib = require('../../lib');
const MAP_W = 900, MAP_H = 600;

const PAGE = `
globalThis.__fcCam = (name, z) => { const c = _wmPlaces().find(p => p.name === name).centre; _wmCam = { cx: c.x, cy: c.y, z }; _wmApplyCam(); worldMapRefresh(); };
globalThis.__fcFan = name => document.querySelector('.wm-fan[data-place="' + name.replace(/"/g, '\\\\"') + '"]');
globalThis.__fcShown = name => { const f = __fcFan(name); return !!f && getComputedStyle(f).display !== 'none'; };
globalThis.__fcCards = name => { const f = __fcFan(name); return f ? [...f.querySelectorAll('.wm-fc')].map(c => (c.classList.contains('wm-fmore') ? c.textContent : 'map')) : []; };
globalThis.__fcRect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
globalThis.__fcMouse = (type, el, o) => { const r = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent(type, Object.assign({ clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, bubbles: true, cancelable: true, button: 0 }, o || {}))); };
globalThis.__fcClick = (el, detail) => { __fcMouse('mousedown', el); __fcMouse('mouseup', el); __fcMouse('click', el, { detail: detail || 1 }); };
globalThis.__fcHead = name => [...document.querySelectorAll('.wm-hl')].find(e => e.dataset.place === name);
`;

module.exports = async function worldMapFanFeature(rig) {
  const dm = rig.dm;
  const map = await rig.fixtures.tableMap(dm, rig.fixtureDir, { w: MAP_W, h: MAP_H });
  const expr = await rig.fixtures.asFileExpr(dm, map);
  const named = n => '(f => new File([f], ' + JSON.stringify(n) + ', { type: f.type }))(' + expr + ')';
  const id = {};
  for (const n of ['Big 1', 'Big 2', 'Big 3', 'Big 4', 'Pair 1', 'Pair 2', 'Solo', 'Speck', 'Tight']) {
    await dm.evaluate('createNewScene(' + named(n + '.mp4') + ')', 120000);
    await dm.waitFor('currentScene && currentScene.name === ' + JSON.stringify(n), 120000, 'the import of ' + n);
    id[n] = await dm.evaluate('currentScene.id');
  }
  await dm.evaluate(PAGE);
  await dm.evaluate('dockOpen(null); 0');

  // Four places holding 4, 2, 1 and 1 maps, one holding none. The Speck's place is a card and a little room.
  const rect = (x0, y0, x1, y1) => 'wmRectShape(' + [x0, y0, x1, y1].join(',') + ')';
  const at = (n, x, y) => 'worldSceneSet(' + JSON.stringify(id[n]) + ', { worldPos: { x: ' + x + ', y: ' + y + ' } });';
  await dm.evaluate('worldMapShow(); 0');
  await lib.settle(dm, '!_wmAnim', 15000);
  const made = JSON.parse(await dm.evaluate(`JSON.stringify((() => {
    ${[at('Big 1', 140, 300), at('Big 2', 272, 300), at('Big 3', 404, 300), at('Big 4', 536, 300), at('Pair 1', 1400, 250), at('Pair 2', 1532, 250), at('Solo', 2500, 250), at('Speck', 3265, 250), at('Tight', 5260, 130)].join('\n')}
    const out = { big: worldPlaceCreate(${rect(0, 0, 900, 600)}), pair: worldPlaceCreate(${rect(1200, 0, 1900, 500)}), solo: worldPlaceCreate(${rect(2200, 0, 2900, 500)}),
      speck: worldPlaceCreate(${rect(3200, 200, 3330, 300)}), none: worldPlaceCreate(${rect(3600, 0, 4300, 400)}),
      tight: worldPlaceCreate(${rect(5000, 0, 5520, 260)}) };
    worldAssignAll(); worldMapRefresh(); return out; })())`));
  await lib.settle(dm, '!_wmAnim', 15000);
  const Z = 0.4;
  const camOn = async name => { await dm.evaluate('__fcCam(' + JSON.stringify(name) + ', ' + Z + '); 0'); };

  // ── 1. The count on the plate, and a rename that leaves it alone ───────────
  // RED ON: the count's text set to '' in _wmDrawPlace (worldMap.js) - 2026-10-25
  const pills = JSON.parse(await dm.evaluate(`JSON.stringify(Object.fromEntries(Object.entries(${JSON.stringify(made)}).map(([k, name]) => {
    const h = __fcHead(name), c = h.querySelector('.wm-hc');
    return [k, { pill: c.textContent, shown: getComputedStyle(c).display !== 'none', name: h.querySelector('.wm-hn').textContent === name }]; })))`));
  rig.check(pills.big.pill === '4' && pills.pair.pill === '2' && pills.solo.pill === '1' && pills.speck.pill === '1',
            'a place\'s plate does not count its maps: ' + JSON.stringify(pills));
  rig.check(pills.big.shown && pills.big.name, 'the pill is hidden or the name element holds more than the name: ' + JSON.stringify(pills.big));
  rig.check(pills.none.pill === '' && !pills.none.shown, 'a place with no maps shows a pill: ' + JSON.stringify(pills.none));

  // RED BY DESIGN: written against the fix, never re-proved
  await camOn(made.big);
  await lib.settle(dm, 'document.getAnimations().every(a => a.effect.getComputedTiming().iterations === Infinity)', 8000);
  // RED ON: the +2 slack taken out of _wmPlateAt's measure (worldMap.js) - 2026-10-25
  // A name that fits by a hair ellipsizes at some zooms and not others, so several are read.
  const whole = [];
  for (const z of [0.3, 0.36, 0.42, 0.5, 0.6]) {
    await dm.evaluate('__fcCam(' + JSON.stringify(made.big) + ', ' + z + '); 0');
    whole.push(await dm.evaluate(`(() => { const n = __fcHead(${JSON.stringify(made.big)}).querySelector('.wm-hn'); return { z: ${z}, sw: n.scrollWidth, cw: n.clientWidth }; })()`));
  }
  rig.check(whole.every(w => w.sw <= w.cw), 'a place with room for its name shows it cut short: ' + JSON.stringify(whole.filter(w => w.sw > w.cw)));
  await camOn(made.big);
  const edit = await dm.evaluate(`(() => { const name = ${JSON.stringify(made.big)}; _wmRenameStart(_wmEls.get('h' + name), 'place', name);
    const h = __fcHead(name); return { text: _wmEditing.textContent, name, own: _wmEditing === h.querySelector('.wm-hn'), editable: _wmEditing.isContentEditable,
      pillHidden: getComputedStyle(h.querySelector('.wm-hc')).display === 'none' }; })()`);
  rig.check(edit.own && edit.editable && edit.text === edit.name && edit.pillHidden,
            'rename does not edit the name alone: ' + JSON.stringify(edit));
  await dm.evaluate('_wmEditing.textContent = "Great Hall"; _wmEditing.dispatchEvent(new KeyboardEvent("keydown", { code: "Enter", key: "Enter", bubbles: true, cancelable: true })); 0');
  const renamed = await dm.evaluate(`(() => { const h = __fcHead('Great Hall'); return h ? { pill: h.querySelector('.wm-hc').textContent, name: h.querySelector('.wm-hn').textContent,
    maps: allScenes.filter(s => s.group === 'Great Hall').length, editing: !!_wmEditing } : null; })()`);
  rig.check(renamed && renamed.pill === '4' && renamed.name === 'Great Hall' && renamed.maps === 4 && !renamed.editing,
            'after a rename the plate lost its count or took it into the name: ' + JSON.stringify(renamed));
  made.big = 'Great Hall';

  // ── 2. The cards: three maps and a +N ──────────────────────────────────────
  // RED ON: worldMapFanLayout skipping every place (`continue` for `if (!memo.spot) continue`, worldMapFan.js) - 2026-10-25
  const cards = {};
  for (const k of ['big', 'pair', 'solo']) { await camOn(made[k]); cards[k] = JSON.parse(await dm.evaluate('JSON.stringify(__fcCards(' + JSON.stringify(made[k]) + '))')); }
  rig.check(cards.big.length === 4 && cards.big[3] === '+1' && cards.big.slice(0, 3).every(c => c === 'map'),
            'a place holding four maps does not show three cards and a "+1": ' + JSON.stringify(cards.big));
  rig.check(cards.pair.length === 2 && cards.pair.every(c => c === 'map') && cards.solo.length === 1,
            'a place holding two maps does not show two cards, or one map one card: ' + JSON.stringify(cards));
  const first = await dm.evaluate(`JSON.stringify([...__fcFan(${JSON.stringify(made.big)}).querySelectorAll('.wm-fc[data-id]')].map(c => c.dataset.id)) === JSON.stringify(allScenes.filter(s => s.group === ${JSON.stringify(made.big)}).slice(0, 3).map(s => s.id))`);
  rig.check(first, 'the cards are not the first three maps in library order');

  // ── 3. Inside the outline, clear of the plate ──────────────────────────────
  // RED BY DESIGN (inside): written against the fix, never re-proved
  // RED ON (clear): the plate's box passed to wmFanSpot as null; a short place then centres its hand over the name - 2026-10-25
  for (const k of ['big', 'pair', 'solo', 'tight']) {
    await camOn(made[k]);
    const r = JSON.parse(await dm.evaluate(`JSON.stringify((() => { const name = ${JSON.stringify(made[k])}, plate = __fcRect(__fcHead(name)), outline = wmOutline(worldPlaceByName(name));
      return [...__fcFan(name).querySelectorAll('.wm-fc')].map(c => { const b = __fcRect(c), a = _wmToWorld(b.x, b.y), z = _wmToWorld(b.x + b.w, b.y + b.h);
        return { inside: wmRectInPoly({ x: a.x, y: a.y, w: z.x - a.x, h: z.y - a.y }, outline),
          clear: b.x + b.w <= plate.x || b.x >= plate.x + plate.w || b.y + b.h <= plate.y || b.y >= plate.y + plate.h }; }); })())`));
    rig.check(r.length > 0 && r.every(c => c.inside), 'a card of ' + made[k] + ' lies outside the place\'s outline: ' + JSON.stringify(r));
    rig.check(r.every(c => c.clear), 'a card of ' + made[k] + ' covers the name plate: ' + JSON.stringify(r));
  }

  // ── 4. A place too small shows no hand and keeps its count ─────────────────
  // RED ON (count): the count's text set to '' in _wmDrawPlace (worldMap.js) - 2026-10-25
  await camOn(made.speck);
  const speck = await dm.evaluate(`({ fan: __fcShown(${JSON.stringify(made.speck)}), cards: __fcCards(${JSON.stringify(made.speck)}).length,
    pill: __fcHead(${JSON.stringify(made.speck)}).querySelector('.wm-hc').textContent })`);
  rig.check(!speck.fan && speck.pill === '1', 'a place too small for a hand shows one, or lost its count: ' + JSON.stringify(speck));
  rig.check(!(await dm.evaluate(`__fcShown(${JSON.stringify(made.none)})`)), 'a place with no maps shows a hand');

  // ── 5. Zoomed in, no hand ──────────────────────────────────────────────────
  // RED ON: `#wm.scenes .wm-fan` taken out of the hiding rule (worldMap.css) - 2026-10-25
  await dm.evaluate('__fcCam(' + JSON.stringify(made.big) + ', 1.2); 0');
  const near = await dm.evaluate(`[...document.querySelectorAll('.wm-fan')].filter(f => getComputedStyle(f).display !== 'none').length`);
  rig.check(near === 0, 'zoomed in to the scenes, ' + near + ' hands still show');

  // ── 6. Click, click on +N, double-click ────────────────────────────────────
  // RED BY DESIGN: written against the fix, never re-proved
  await camOn(made.big);
  await dm.evaluate(`__fcClick(__fcFan(${JSON.stringify(made.big)}).querySelectorAll('.wm-fc[data-id]')[1]); 0`);
  const picked = await dm.evaluate(`({ id: worldMapSel.sceneId, want: __fcFan(${JSON.stringify(made.big)}).querySelectorAll('.wm-fc[data-id]')[1].dataset.id, drag: !!_wmDrag, pan: _wm.classList.contains('panning') })`);
  rig.check(picked.id && picked.id === picked.want && !picked.drag && !picked.pan, 'a click on a card did not pick that map: ' + JSON.stringify(picked));
  await lib.hold(500, 'the click waits to see whether it is a double, then flies');
  await lib.settle(dm, '!_wmAnim', 15000);
  await camOn(made.big);
  await dm.evaluate('worldMapSelect({ sceneId: null, place: "" }); 0');
  await dm.evaluate(`__fcClick(__fcFan(${JSON.stringify(made.big)}).querySelector('.wm-fmore')); 0`);
  await lib.settle(dm, '!_wmAnim', 15000);
  rig.check(await dm.evaluate(`worldMapSel.place === ${JSON.stringify(made.big)} && !worldMapSel.sceneId`), 'a click on "+N" did not pick the place');
  await camOn(made.pair);
  const target = await dm.evaluate(`__fcFan(${JSON.stringify(made.pair)}).querySelector('.wm-fc[data-id]').dataset.id`);
  await dm.evaluate(`(() => { const c = __fcFan(${JSON.stringify(made.pair)}).querySelector('.wm-fc[data-id]'); __fcClick(c, 1); __fcClick(c, 2); __fcMouse('dblclick', c); return 0; })()`);
  await lib.settle(dm, '!worldMapOpen && !!currentScene', 30000);
  rig.check(await dm.evaluate('!worldMapOpen && currentScene.id === ' + JSON.stringify(target)), 'a double-click on a card did not open that map');
};
