'use strict';

// initiative-tv.js — THE TURN ORDER ON THE TV (BACKLOG 290, design H1).
//
// THE CRITERIA ARE THIS HEADER. Each has its check beneath it, in the same order. The fight is written into the open
// fight's rows the way the table's own writers leave them; Start fight is the fight table's own button.
//
//   1. At start the button reads Start fight, not pressed, and the Player window has no panel.
//   1b. The fight table's header fits Sort, Start fight, Add creature and Close at the default width, in English and
//       with the Russian labels, with the fight's name not cut. Measured and noted.
//   2. After Start fight the button reads End fight, pressed, and the Player draws the open fight in the table's own
//      order (not sorted by initiative): every ally by name, an enemy only with an initiative and above 0 HP, enemies
//      back to back as one slot with a count, slots numbered 1, 2, 3.
//   2b. The Player has Alegreya loaded from the app's own file, and the names were laid out in it, not in the fallback.
//   3. Names are 2.7% of the Player window's height.
//   4. A rename in the table reaches the TV within one second, and so do a monster added, a monster deleted, and an
//      initiative typed for a monster that had none.
//   4b. A monster's line is the word "Monster", with its count past one, in red whatever the fog theme.
//   5. The panel follows the map's fog theme: Default, then Blood after a pick on the DM's map. Screenshotted in both.
//   6. After End fight the button reads Start fight and the panel is gone, its frame loop stopped.
//   7. Started, the last living monster going to 0 HP does NOT end the fight: the button still reads End fight, no
//      toast shows, and the monster leaves the TV while the player stays. Healed, it comes back.
//   8. Sort is lit while the rows are out of initiative order; a click puts them in order, and it greys with the
//      tooltip "The rows are already in initiative order".
//   9. A row's Enemy | Ally switch lights its side, and a click on the other half switches it. The first two enemy
//      rows with an empty HP field show the samples "-12 damage" and "+5 healing", and no other row does. A
//      stat-block AC shows in the table, editable, and a new number lands in that row's copy and lights its Save.
//   10. With two maps the panel shows once, in the shell, and in neither half.
//   11. The fight table on the DM screen, in Russian, screenshotted for the DM's eye: rows out of order with Sort lit
//       and the HP samples, then after Sort with Sort greyed, then a hovered enemy row showing its actions.
//   11b. A hovered row's actions are exactly the side switch (a devil and an angel), Duplicate and ⋯. A real click on
//       ⋯ opens the row's menu with Open stat block and Delete, the actions staying up; a second click closes it.
//       Neither that click nor one on Duplicate lights the Attacks cell's focus ring, which reads as an edit.
//   11c. Three real clicks at one spot, measured once before the first, on Duplicate make three copies below the
//       row, so the button is back under the pointer after each. A real click on an enemy row's angel makes it an ally.

const path = require('path');
const lib = require('../lib');

// Селестия sits first though her initiative is lower, so a sorted list would put Алистер first.
// The ghoul at 0 HP and the ghost with no initiative stay off the TV, so the last ghost is a slot of its own.
const ROWS = [
  { id: 906, init: '9', name: 'Селестия', side: 'ally', hp: '', ac: '', conds: [] },
  { id: 901, init: '18', name: 'Алистер', side: 'ally', hp: '', ac: '', conds: [] },
  { id: 902, init: '16', name: 'Призрак', side: 'enemy', hp: '', ac: '', conds: [] },
  { id: 903, init: '15', name: 'Призрак 2', side: 'enemy', hp: '', ac: '', conds: [] },
  { id: 904, init: '12', name: 'Вотан', side: 'ally', hp: '', ac: '', conds: [] },
  { id: 905, init: '10', name: 'Гуль', side: 'enemy', hp: '- 9', ac: '', conds: [] },
  { id: 907, init: '', name: 'Призрак 4', side: 'enemy', hp: '', ac: '', conds: [] },
  { id: 908, init: '5', name: 'Призрак 3', side: 'enemy', hp: '', ac: '', conds: [] },
];
const WANT = [
  { n: 1, name: 'Селестия', count: 0 }, { n: 2, name: 'Алистер', count: 0 }, { n: 3, name: null, count: 2 },
  { n: 4, name: 'Вотан', count: 0 }, { n: 5, name: null, count: 1 },
];
const DRAWN = 'JSON.stringify(_inp && _inp.drawn)';

module.exports = async function initiativeTv(rig) {
  const dm = rig.dm;
  await lib.importWithPlan(rig, 'Initiative');
  const player = await rig.player();
  await lib.settle(player, 'typeof fogCoverT !== "undefined" && fogCoverT === 0', 60000);

  // ── 1 ──
  const BUTTON = `(() => { const b = document.getElementById('cb-tv');
    return { on: _itvOn, pressed: b.getAttribute('aria-pressed'), text: b.textContent.trim(), icon: b.querySelector('svg').getAttribute('class') }; })()`;
  const start = await dm.evaluate(BUTTON);
  rig.check(start.on === false && start.pressed === 'false' && start.text === 'Start fight' && start.icon === 'i-play',
    '1: the button does not read Start fight at start: ' + JSON.stringify(start));
  rig.check(await player.evaluate(`!document.getElementById('initiative-tv')`), '1: the Player has a panel before Start fight was pressed');

  // ── 1b ──
  // The ghoul's stat block holds its 9 max HP, and the row's "- 9" takes it to 0.
  await dm.evaluate(`cbState.rows = ${JSON.stringify(ROWS)};
    cbState.rows.find(r => r.id === 905).sb = Object.assign(combatBlankBlock('', 'Гуль'), { hp: '9' });
    cbSetOpen(true); 0`);
  const HEAD = `(() => { const h = document.querySelector('#cb-fight .cb-head'), nm = document.querySelector('#cb-fightpick .nm');
    return { head: Math.round(h.getBoundingClientRect().width), over: h.scrollWidth - h.clientWidth, name: nm.textContent, cut: nm.scrollWidth - nm.clientWidth,
      btns: ['cb-sort', 'cb-tv', 'cb-add'].map(id => Math.round(document.getElementById(id).getBoundingClientRect().width)) }; })()`;
  const headEn = await dm.evaluate(HEAD);
  const RU_LABELS = `[['cb-sort', 'Sort'], ['cb-tv', 'Start fight'], ['cb-add', 'Add creature']].forEach(([id, k]) => {
    const sp = document.querySelector('#' + id + ' span'); sp.dataset.en = sp.textContent; sp.textContent = RU[k]; }); 0`;
  await dm.evaluate(RU_LABELS);
  const headRu = await dm.evaluate(HEAD);
  await dm.evaluate(`document.querySelectorAll('#cb-fight .cb-head [data-en]').forEach(sp => { sp.textContent = sp.dataset.en; delete sp.dataset.en; }); 0`);
  rig.note('1b: header English ' + JSON.stringify(headEn) + ', Russian ' + JSON.stringify(headRu));
  rig.check(headEn.over <= 0 && headEn.cut <= 0 && headRu.over <= 0 && headRu.cut <= 0,
    '1b: the header does not fit at the default width: English ' + JSON.stringify(headEn) + ', Russian ' + JSON.stringify(headRu));

  // ── 2 ──
  await dm.evaluate(`document.getElementById('cb-tv').click(); 0`);
  const started = await dm.evaluate(BUTTON);
  rig.check(started.pressed === 'true' && started.text === 'End fight' && started.icon === 'i-stop', '2: the button does not read End fight: ' + JSON.stringify(started));
  await lib.settle(player, `${DRAWN} === ${JSON.stringify(JSON.stringify(WANT))}`, 10000);
  const drawn = await player.evaluate(DRAWN);
  rig.check(drawn === JSON.stringify(WANT), '2: the Player drew ' + drawn + ', want ' + JSON.stringify(WANT));
  rig.check(await player.evaluate(`!_inp.canvas.hidden && !!_inp.raf`), '2: the panel canvas is hidden or its loop is not running');

  // ── 2b ──
  // The panel's one column ends at its widest name, so its box gives back the width the names were measured at.
  const face = await player.evaluate(`(() => {
    const c = document.createElement('canvas').getContext('2d'), names = _inp.geo.items.map(it => it.s.name != null ? it.s.name : _inpMonsterText(it.s));
    const widest = f => { c.font = '700 ' + INP_U + 'px ' + f; return Math.max(...names.map(n => c.measureText(n).width)); };
    return { check: document.fonts.check('700 20px Alegreya'), loaded: [...document.fonts].some(f => f.family.replace(/"/g, '') === 'Alegreya' && f.status === 'loaded'),
      cols: _inp.geo.cols, used: _inp.geo.box[2] - _inp.geo.items[0].ix, alegreya: widest('Alegreya'), fallback: widest(INP_FONT.replace(/^Alegreya, /, '')) };
  })()`);
  rig.note('2b: widest name ' + face.used.toFixed(1) + ' px as laid out, ' + face.alegreya.toFixed(1) + ' in Alegreya, ' + face.fallback.toFixed(1) + ' in the fallback');
  rig.check(face.check && face.loaded, '2b: Alegreya is not loaded in the Player: ' + JSON.stringify(face));
  rig.check(face.cols === 1 && Math.abs(face.used - face.alegreya) < 0.5 && Math.abs(face.alegreya - face.fallback) > 1,
    '2b: the names were not laid out in Alegreya: ' + JSON.stringify(face));

  // ── 3 ──
  const size = await player.evaluate(`({ px: _inp.namePx, h: innerHeight })`);
  rig.note('3: names ' + size.px.toFixed(2) + ' px in a ' + size.h + ' px window');
  rig.check(Math.abs(size.px - size.h * 0.027) < 0.01, '3: names are ' + size.px + ' px, want 2.7% of ' + size.h);

  // ── 4 ──
  const t0 = Date.now();
  await dm.evaluate(`cbState.rows.find(r => r.id === 904).name = 'Вотан Рыжий'; 0`);
  const renamed = await lib.poll(async () => (await player.evaluate(`!!_inp.drawn.find(d => d.name === 'Вотан Рыжий')`)) || null, 3000, 25);
  const took = Date.now() - t0;
  rig.note('4: the rename reached the TV in ' + took + ' ms');
  rig.check(renamed && took <= 1000, '4: the rename did not reach the TV within a second (' + took + ' ms)');

  const added = Date.now();
  await dm.evaluate(`cbState.rows.push({ id: 920, init: '11', name: 'Гуль 2', side: 'enemy', hp: '', ac: '', conds: [] }); 0`);
  const sawAdd = await lib.poll(async () => (await player.evaluate(`_inp.drawn.length === 5 && _inp.drawn[4].count === 2`)) || null, 3000, 25);
  rig.check(sawAdd && Date.now() - added <= 1000, '4: an added monster did not reach the TV within a second: ' + await player.evaluate(DRAWN));
  const removed = Date.now();
  await dm.evaluate(`cbState.rows = cbState.rows.filter(r => r.id !== 920 && r.id !== 908); 0`);
  const sawDel = await lib.poll(async () => (await player.evaluate(`_inp.drawn.length === 4 && _inp.drawn[3].name === 'Вотан Рыжий'`)) || null, 3000, 25);
  rig.check(sawDel && Date.now() - removed <= 1000, '4: deleted monsters did not leave the TV within a second: ' + await player.evaluate(DRAWN));
  // The ghost with no initiative gets one and joins the TV; taking it away again takes it off.
  const typed = Date.now();
  await dm.evaluate(`cbState.rows.find(r => r.id === 907).init = '7'; 0`);
  const sawInit = await lib.poll(async () => (await player.evaluate(`_inp.drawn.length === 5 && _inp.drawn[4].count === 1`)) || null, 3000, 25);
  rig.check(sawInit && Date.now() - typed <= 1000, '4: a monster given an initiative did not reach the TV within a second: ' + await player.evaluate(DRAWN));
  await dm.evaluate(`cbState.rows.find(r => r.id === 907).init = ''; cbState.rows.push(${JSON.stringify(ROWS.find(r => r.id === 908))}); 0`);
  await lib.settle(player, `${DRAWN} === ${JSON.stringify(JSON.stringify(WANT.map(w => w.name === 'Вотан' ? Object.assign({}, w, { name: 'Вотан Рыжий' }) : w)))}`, 5000);

  // ── 4b ──
  const word = await player.evaluate(`JSON.stringify(_inp.slots.filter(s => s.name == null).map(s => _inpMonsterText(s)))`);
  rig.check(word === JSON.stringify(['Monster ×2', 'Monster']), '4b: the monster lines read ' + word);
  // Red pixels on each line as drawn: a monster line is mostly red, a player's name has none.
  const RED_ON = (theme) => `(() => {
    const cp = _inp.copies['${theme}'], c = cp && cp.text; if (!c) return null;
    const g = c.getContext('2d'), m = _inp.masks, D = c.height / (m.box[3] - m.box[1]);
    return _inp.geo.items.map(it => {
      const y = Math.round((it.y - m.box[1]) * D), x0 = Math.round(it.ix * D), d = g.getImageData(x0, y - 3, Math.round(120 * D / 2), 6).data;
      let red = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] > 170 && d[i + 1] < 90 && d[i + 2] < 90) red++;
      return { monster: it.s.name == null, red };
    });
  })()`;
  const reds = await player.evaluate(RED_ON('default'));
  rig.check(reds && reds.every(r => r.monster ? r.red > 5 : r.red === 0), '4b: monster lines are not red in Default: ' + JSON.stringify(reds));

  // ── 5 ──
  await lib.settle(player, `_inp.themes[0] === 'default' && _inp.themes[1] === 'default'`, 5000);
  rig.check(await player.evaluate(`_inp.themes.join()`) === 'default,default', '5: the panel is not in Default: ' + await player.evaluate(`_inp.themes.join()`));
  const shotDefault = path.join(rig.outDir, 'initiative-tv-default.png');
  await player.screenshot(shotDefault);
  await dm.evaluate(`setFogTheme('blood'); 0`);
  await lib.settle(player, `_inp.themes[0] === 'blood' && _inp.themes[1] === 'blood'`, 5000);
  rig.check(await player.evaluate(`_inp.themes.join()`) === 'blood,blood', '5: the panel did not follow the map to Blood: ' + await player.evaluate(`_inp.themes.join()`));
  await lib.settle(player, `!!_inp.copies.blood && !!_inp.copies.blood.text`, 5000);
  const redsBlood = await player.evaluate(RED_ON('blood'));
  rig.check(redsBlood && redsBlood.every(r => r.monster ? r.red > 5 : r.red === 0), '4b: monster lines are not red in Blood: ' + JSON.stringify(redsBlood));
  await lib.settle(player, `!!_inp.copies.blood && !!_inp.copies.blood.text`, 5000);
  const shotBlood = path.join(rig.outDir, 'initiative-tv-blood.png');
  await player.screenshot(shotBlood);
  rig.note('5: screenshots ' + shotDefault + ' and ' + shotBlood);
  rig.byEye('5: the haze reads as the map\'s fog in Default and Blood, and the names read from the table');

  // ── 6 ──
  await dm.evaluate(`document.getElementById('cb-tv').click(); 0`);
  await lib.settle(player, `_inp.slots === null`, 5000);
  const off = await player.evaluate(`({ hidden: _inp.canvas.hidden, raf: _inp.raf, slots: _inp.slots })`);
  rig.check(off.hidden && !off.raf && off.slots === null, '6: the panel is still up after End fight: ' + JSON.stringify(off));
  const ended = await dm.evaluate(BUTTON);
  rig.check(ended.pressed === 'false' && ended.text === 'Start fight', '6: the button does not read Start fight after End fight: ' + JSON.stringify(ended));

  // ── 7 ──
  // One ally and one monster; the monster's typed line takes it from 7 to 0.
  const FOE = { id: 930, init: '14', name: 'Гуль', side: 'enemy', hp: '', ac: '', conds: [] };
  await dm.evaluate(`cbState.rows = ${JSON.stringify([ROWS[0], FOE])};
    cbState.rows.find(r => r.id === 930).sb = Object.assign(combatBlankBlock('', 'Гуль'), { hp: '7' });
    document.getElementById('cb-tv').click(); 0`);
  await lib.settle(player, `!!_inp.drawn && _inp.drawn.length === 2`, 10000);
  rig.check(await player.evaluate(DRAWN) === JSON.stringify([WANT[0], { n: 2, name: null, count: 1 }]), '7: the fight did not start with the player and the monster: ' + await player.evaluate(DRAWN));
  await dm.evaluate(`cbState.rows.find(r => r.id === 930).hp = '- 7'; 0`);
  await lib.settle(player, `!!_inp.drawn && _inp.drawn.length === 1`, 5000);
  await lib.hold(1000, 'four ticks of the clock with the last monster down, long enough for the fight to end by itself');
  const kept = await dm.evaluate(BUTTON);
  rig.check(kept.on === true && kept.pressed === 'true' && kept.text === 'End fight', '7: the fight ended when the last monster went down: ' + JSON.stringify(kept));
  rig.check(await dm.evaluate(`document.getElementById('scene-undo-toast').style.display === 'none'`), '7: a toast showed when the last monster went down');
  rig.check(await player.evaluate(DRAWN) === JSON.stringify([WANT[0]]), '7: the TV does not show the player alone with the monster down: ' + await player.evaluate(DRAWN));
  await dm.evaluate(`cbState.rows.find(r => r.id === 930).hp = ''; 0`);
  await lib.settle(player, `!!_inp.drawn && _inp.drawn.length === 2`, 5000);
  rig.check(await player.evaluate(DRAWN) === JSON.stringify([WANT[0], { n: 2, name: null, count: 1 }]), '7: the healed monster did not come back to the TV: ' + await player.evaluate(DRAWN));
  await dm.evaluate(`document.getElementById('cb-tv').click(); 0`);
  await lib.settle(player, `_inp.slots === null`, 5000);

  // ── 8 ──
  const SORT = `(() => { const b = document.getElementById('cb-sort');
    return { lit: b.classList.contains('lit'), off: b.getAttribute('aria-disabled'), title: b.title, ids: cbState.rows.map(r => r.id) }; })()`;
  await dm.evaluate(`cbState.rows = ${JSON.stringify(ROWS)}; cbRender(); 0`);
  const unsorted = await dm.evaluate(SORT);
  rig.check(unsorted.lit && unsorted.off === 'false' && unsorted.title === 'Sort by initiative', '8: Sort is not lit over rows out of order: ' + JSON.stringify(unsorted));
  await dm.evaluate(`document.getElementById('cb-sort').click(); 0`);
  const sorted = await dm.evaluate(SORT);
  rig.check(JSON.stringify(sorted.ids) === JSON.stringify([901, 902, 903, 904, 905, 906, 908, 907]), '8: Sort did not put the rows in initiative order: ' + JSON.stringify(sorted.ids));
  rig.check(!sorted.lit && sorted.off === 'true' && sorted.title === 'The rows are already in initiative order', '8: Sort did not grey once the rows were in order: ' + JSON.stringify(sorted));

  // ── 9 ──
  const SIDE = `[...document.querySelectorAll('#cb-list .cb-row[data-id="902"] .cb-side-switch .cp-segtab.active')].map(b => b.dataset.side).join()`;
  rig.check(await dm.evaluate(SIDE) === 'enemy', '9: the enemy row does not light Enemy: ' + await dm.evaluate(SIDE));
  await dm.evaluate(`document.querySelector('#cb-list .cb-row[data-id="902"] .cb-side-switch [data-side="ally"]').click(); 0`);
  const switched = await dm.evaluate(`({ side: cbState.rows.find(r => r.id === 902).side, lit: ${SIDE} })`);
  rig.check(switched.side === 'ally' && switched.lit === 'ally', '9: a click on Ally did not switch the row: ' + JSON.stringify(switched));
  // The enemies in table order are now 903, 905 (typed HP), 908, 907 (no max HP): the samples sit on 903 and 908.
  await dm.evaluate(`for (const id of [903, 908]) cbState.rows.find(r => r.id === id).sb = Object.assign(combatBlankBlock('', 'Призрак'), { hp: '30' }); cbRender(); 0`);
  const samples = await dm.evaluate(`JSON.stringify([...document.querySelectorAll('#cb-list .cb-row')].map(el => [Number(el.dataset.id), el.querySelector('[data-f="hp"]').placeholder]).filter(x => x[1]))`);
  rig.check(samples === JSON.stringify([[903, '-12 damage'], [908, '+5 healing']]), '9: the HP samples are not on the first two empty enemy rows: ' + samples);
  await dm.evaluate(`Object.assign(cbState.rows.find(r => r.id === 903).sb, { ac: '15 (natural armor)' }); cbRender(); 0`);
  const AC = `document.querySelector('#cb-list .cb-row[data-id="903"] [data-f="ac"]')`;
  const acBefore = await dm.evaluate(`({ value: ${AC}.value, readonly: ${AC}.readOnly, bold: getComputedStyle(${AC}).fontWeight })`);
  rig.check(acBefore.value === '15' && !acBefore.readonly && Number(acBefore.bold) >= 600, '9: the stat-block AC does not show, editable and bold: ' + JSON.stringify(acBefore));
  await dm.evaluate(`cbOpenStat(cbState.rows.find(r => r.id === 903)); const i = ${AC}; i.value = '12'; i.dispatchEvent(new Event('input', { bubbles: true })); 0`);
  const acAfter = await dm.evaluate(`(() => { const r = cbState.rows.find(r => r.id === 903), save = document.querySelector('#cb-stat [data-save]');
    return { sb: r.sb.ac, changed: r.sbChanged, save: !save.disabled, bestiary: Object.values(cbState.blocks).some(b => /^12(?!\d)/.test(b.ac || '')) }; })()`);
  rig.check(acAfter.sb === '12 (natural armor)' && acAfter.changed && acAfter.save && !acAfter.bestiary, '9: a new AC did not land in the row\'s copy alone: ' + JSON.stringify(acAfter));
  await dm.evaluate(`cbCloseStat(); 0`);

  // ── 10 ──
  await lib.step(rig, '10: two maps', async () => {
    await dm.evaluate(`document.getElementById('cb-tv').click(); 0`);
    await dm.evaluate('toggleTwoMaps()', 60000);
    const half = await rig.stageHalf('A');
    await rig.stageHalf('B');
    const shell = `parent.document.getElementById('initiative-tv')`;
    await lib.settle(half, `!!${shell} && !${shell}.hidden`, 10000);
    const seen = await half.evaluate(`({ shell: !!${shell} && !${shell}.hidden, shells: parent.document.querySelectorAll('#initiative-tv').length,
      halves: [...parent.document.querySelectorAll('iframe')].map(f => !!f.contentDocument.getElementById('initiative-tv')) })`);
    rig.check(seen.shell && seen.shells === 1 && seen.halves.every(h => !h), '10: the panel does not show once, in the shell: ' + JSON.stringify(seen));
    await dm.evaluate(`document.getElementById('cb-tv').click(); 0`);
    await lib.settle(half, `${shell}.hidden`, 5000);
    rig.check(await half.evaluate(`${shell}.hidden`), '10: the shell kept the panel after End fight');
  });

  // ── 11 ──
  await lib.step(rig, '11: the table in Russian', async () => {
    const ru = await lib.inRussian(rig);
    const foe = (id, init, name, hp, ac, typed) => ({ id, init, name, side: 'enemy', hp: typed || '', ac, conds: [],
      sb: { hp, ac } });
    const rows = [foe(951, '13', 'Огр', '59', '11'), foe(952, '12', 'Гоблин 1', '7', '15'),
      { id: 953, init: '18', name: 'Алистер', side: 'ally', hp: '', ac: '', conds: [] }, foe(954, '9', 'Волк', '11', '13', '- 4'),
      { id: 955, init: '15', name: 'Вотан', side: 'ally', hp: '', ac: '', conds: [] }];
    await ru.evaluate(`cbState.rows = ${JSON.stringify(rows)}.map(r => (r.sb = Object.assign(combatBlankBlock('', r.name), r.sb || {}), r)); cbSetOpen(true); cbRender(); 0`);
    await lib.settle(ru, `document.getElementById('cb-sort').textContent.includes('Сортировать')`, 5000);
    const clip = async () => ru.evaluate(`(() => { const r = document.getElementById('cb-fight').getBoundingClientRect();
      return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: Math.min(r.width, innerWidth - Math.max(0, r.left)), height: r.height }; })()`);
    const shot = async name => { const f = path.join(rig.outDir, name); await ru.screenshot(f, await clip()); rig.note('11: ' + f); };
    rig.check(await ru.evaluate(`document.getElementById('cb-sort').classList.contains('lit')`), '11: Sort is not lit over rows out of order');
    await shot('fight-table-a-unsorted.png');
    await ru.evaluate(`document.getElementById('cb-sort').click(); 0`);
    await lib.settle(ru, `document.getElementById('cb-sort').getAttribute('aria-disabled') === 'true'`, 3000);
    await lib.settle(ru, `![...document.querySelectorAll('#cb-list .cb-row.moved')].some(el => el.getAnimations().length)`, 3000);
    await shot('fight-table-b-sorted.png');
    const at = await ru.evaluate(`(() => { const r = document.querySelector('#cb-list .cb-row[data-id="952"] .cb-cell.name').getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    await ru.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y, button: 'none' });
    await lib.settle(ru, `getComputedStyle(document.querySelector('#cb-list .cb-row[data-id="952"] .cb-acts')).display === 'flex'`, 3000);
    rig.check(await ru.evaluate(`getComputedStyle(document.querySelector('#cb-list .cb-row[data-id="952"] .cb-acts')).display === 'flex'`), '11: the hovered row does not show its actions');
    await shot('fight-table-c-hover.png');

    // ── 11b ──
    const ACTS = `document.querySelector('#cb-list .cb-row[data-id="952"] .cb-acts')`;
    const acts = await ru.evaluate(`[...${ACTS}.children].map(el => el.dataset.b || el.className + ':' +
      [...el.children].map(h => h.dataset.side + '/' + h.querySelector('svg').getAttribute('class') + (h.classList.contains('active') ? '*' : '')).join())`);
    rig.check(JSON.stringify(acts) === JSON.stringify(['cp-tabs cb-side-switch:enemy/i-devil*,ally/i-angel', 'dup', 'more']),
      '11b: the hovered row\'s actions are not the switch, Duplicate and ⋯: ' + JSON.stringify(acts));
    const centre = sel => ru.evaluate(`(() => {
      const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const click = async p => {
      await ru.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' });
      await ru.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
      await ru.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    };
    const more = await centre('#cb-list .cb-row[data-id="952"] [data-b="more"]');
    await click(more);
    await lib.settle(ru, `!!document.getElementById('cb-menu')`, 3000);
    const menu = await ru.evaluate(`(() => { const m = document.getElementById('cb-menu'), has = k => !!m && [...m.querySelectorAll('[data-i]')].some(d => d.textContent.includes(RU[k] || k));
      return { open: !!m, stat: has('Open stat block'), del: has('Delete'), shown: getComputedStyle(${ACTS}).display, owner: document.querySelector('#cb-list .cb-row[data-id="952"] [data-b="more"]').classList.contains('open') }; })()`);
    rig.check(menu.open && menu.stat && menu.del && menu.shown === 'flex' && menu.owner, '11b: ⋯ did not open the row\'s menu with Open stat block and Delete: ' + JSON.stringify(menu));
    const RING = `getComputedStyle(document.querySelector('#cb-list .cb-row[data-id="952"] .cb-cell.atk')).boxShadow`;
    const ringMore = await ru.evaluate(RING);
    // What the ring reads as with a button focused, so the check below can tell it apart from no ring.
    const ringForced = await ru.evaluate(`(() => { const b = document.querySelector('#cb-list .cb-row[data-id="952"] [data-b="dup"]'), a = document.activeElement;
      b.focus(); const v = ${RING}; b.blur(); if (a && a.focus) a.focus(); return v; })()`);
    rig.note('11b: Attacks cell box-shadow after a click on ⋯: ' + ringMore + '; with a button focused: ' + ringForced);
    rig.check(ringForced !== 'none' && ringMore === 'none', '11b: a click on ⋯ lit the Attacks cell\'s focus ring: ' + ringMore);
    await shot('fight-table-d-menu.png');
    await click(more);
    await lib.hold(200, 'a second click on ⋯ has to close the menu, not reopen it');
    rig.check(await ru.evaluate(`!document.getElementById('cb-menu')`), '11b: a second click on ⋯ did not close the menu');

    // ── 11c ──
    const before = await ru.evaluate(`cbState.rows.map(r => r.id)`);
    const dup = await centre('#cb-list .cb-row[data-id="952"] [data-b="dup"]');
    for (let i = 1; i <= 3; i++) {
      await click(dup);
      await lib.settle(ru, `cbState.rows.length === ${before.length + i}`, 3000);
    }
    const ringDup = await ru.evaluate(RING);
    rig.check(ringDup === 'none', '11c: a click on Duplicate lit the Attacks cell\'s focus ring: ' + ringDup);
    const after = await ru.evaluate(`cbState.rows.map(r => r.id)`), at952 = after.indexOf(952);
    const copies = after.filter(id => !before.includes(id));
    rig.check(copies.length === 3 && JSON.stringify(after.slice(at952 + 1, at952 + 4).sort()) === JSON.stringify(copies.slice().sort()),
      '11c: three clicks on Duplicate did not make three copies below the row: ' + JSON.stringify({ before, after }));
    await ru.send('Input.dispatchMouseEvent', Object.assign({ type: 'mouseMoved', button: 'none' }, await centre('#cb-list .cb-row[data-id="951"] .cb-cell.name')));
    await lib.settle(ru, `getComputedStyle(document.querySelector('#cb-list .cb-row[data-id="951"] .cb-acts')).display === 'flex'`, 3000);
    const angel = await centre('#cb-list .cb-row[data-id="951"] .cb-side-switch [data-side="ally"]');
    await click(angel);
    await lib.settle(ru, `cbState.rows.find(r => r.id === 951).side === 'ally'`, 3000);
    rig.check(await ru.evaluate(`cbState.rows.find(r => r.id === 951).side`) === 'ally', '11c: a click on the angel did not make the enemy row an ally');
    rig.byEye('11: the fight table reads well in Russian: Sort lit and greyed, the HP samples, the devil | angel switch, Duplicate and ⋯, the ⋯ menu');
  });
};
