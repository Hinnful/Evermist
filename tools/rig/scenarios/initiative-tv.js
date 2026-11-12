'use strict';

// initiative-tv.js — THE TURN ORDER ON THE TV (BACKLOG 290, design H1).
//
// THE CRITERIA ARE THIS HEADER. Each has its check beneath it, in the same order. The fight is written into the open
// fight's rows the way the table's own writers leave them; Start fight is the fight table's own button.
//
//   1. At start the button reads Start fight, not pressed, and the Player window has no panel.
//   2. After Start fight the button reads End fight, pressed, and the Player draws every row of the open fight in the
//      table's own order (not sorted by initiative), rows with no initiative and monsters at 0 HP included: allies by
//      name, enemies back to back as one slot with a count, slots numbered 1, 2, 3.
//   2b. The Player has Alegreya loaded from the app's own file, and the names were laid out in it, not in the fallback.
//   3. Names are 2.7% of the Player window's height.
//   4. A rename in the table reaches the TV within one second, and so do a monster added and a monster deleted.
//   4b. A monster's line is the word "Monster" with its count, in red whatever the fog theme.
//   5. The panel follows the map's fog theme: Default, then Blood after a pick on the DM's map. Screenshotted in both.
//   6. After End fight the button reads Start fight and the panel is gone, its frame loop stopped.
//   7. Started, the last living monster going to 0 HP ends the fight by itself: the panel leaves the TV and the
//      button reads Start fight.
//   8. The undo toast says "All monsters are down. The turn order left the TV." with no trash icon.
//   9. Undo starts the fight again and the panel is back on the TV with the monster still at 0 HP; the fight stays
//      started until a monster lives again and goes down.
//   9b. The toast's × closes it, with no map delete pending, and the fight stays ended.
//   10. With two maps the panel shows once, in the shell, and in neither half.

const path = require('path');
const lib = require('../lib');

// Селестия sits first though her initiative is lower, so a sorted list would put Алистер first.
// The ghoul at 0 HP, the ghost with no initiative and the last ghost stand back to back, so they are one slot ×3.
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
  { n: 4, name: 'Вотан', count: 0 }, { n: 5, name: null, count: 3 },
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

  // ── 2 ──
  // The ghoul's stat block holds its 9 max HP, and the row's "- 9" takes it to 0.
  await dm.evaluate(`cbState.rows = ${JSON.stringify(ROWS)};
    cbState.rows.find(r => r.id === 905).sb = Object.assign(combatBlankBlock('', 'Гуль'), { hp: '9' });
    cbSetOpen(true); document.getElementById('cb-tv').click(); 0`);
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
  const sawAdd = await lib.poll(async () => (await player.evaluate(`_inp.drawn.length === 5 && _inp.drawn[4].count === 4`)) || null, 3000, 25);
  rig.check(sawAdd && Date.now() - added <= 1000, '4: an added monster did not reach the TV within a second: ' + await player.evaluate(DRAWN));
  const removed = Date.now();
  await dm.evaluate(`cbState.rows = cbState.rows.filter(r => r.id !== 920 && r.id !== 908); 0`);
  const sawDel = await lib.poll(async () => (await player.evaluate(`_inp.drawn.length === 5 && _inp.drawn[4].count === 2`)) || null, 3000, 25);
  rig.check(sawDel && Date.now() - removed <= 1000, '4: deleted monsters did not leave the TV within a second: ' + await player.evaluate(DRAWN));
  await dm.evaluate(`cbState.rows.push(${JSON.stringify(ROWS.find(r => r.id === 908))}); 0`);
  await lib.settle(player, `${DRAWN} === ${JSON.stringify(JSON.stringify(WANT.map(w => w.name === 'Вотан' ? Object.assign({}, w, { name: 'Вотан Рыжий' }) : w)))}`, 5000);

  // ── 4b ──
  const word = await player.evaluate(`JSON.stringify(_inp.slots.filter(s => s.name == null).map(s => _inpMonsterText(s)))`);
  rig.check(word === JSON.stringify(['Monster ×2', 'Monster ×3']), '4b: the monster lines read ' + word);
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
  await dm.evaluate(`cbState.rows.find(r => r.id === 930).hp = '- 7'; 0`);
  await lib.settle(dm, `!_itvOn`, 3000);
  await lib.settle(player, `_inp.slots === null`, 5000);
  const auto = await dm.evaluate(BUTTON);
  rig.check(auto.on === false && auto.pressed === 'false' && auto.text === 'Start fight', '7: the fight did not end by itself: ' + JSON.stringify(auto));
  rig.check(await player.evaluate(`_inp.slots === null && _inp.canvas.hidden`), '7: the turn order is still on the TV after the last monster went down');

  // ── 8 ──
  const toast = await dm.evaluate(`(() => { const t = document.getElementById('scene-undo-toast');
    return { shown: t.style.display !== 'none' && t.offsetParent !== null, msg: t.querySelector('.undo-msg').textContent,
      trash: getComputedStyle(t.querySelector('.i-trash')).display }; })()`);
  rig.check(toast.shown && toast.msg === 'All monsters are down. The turn order left the TV.', '8: the toast did not say the fight ended: ' + JSON.stringify(toast));
  rig.check(toast.trash === 'none', '8: the toast shows the trash icon: ' + JSON.stringify(toast));

  // ── 9 ──
  await dm.evaluate(`document.querySelector('#scene-undo-toast .undo-btn').click(); 0`);
  await lib.settle(dm, `_itvOn`, 5000);
  await lib.settle(player, `!!_inp.drawn && _inp.drawn.length === 2`, 5000);
  const back = await dm.evaluate(BUTTON);
  rig.check(back.on === true && back.text === 'End fight', '9: Undo did not start the fight again: ' + JSON.stringify(back));
  rig.check(await player.evaluate(`JSON.stringify(_inp.drawn)`) === JSON.stringify([WANT[0], { n: 2, name: null, count: 1 }]), '9: Undo did not put the turn order back, the downed monster in its place: ' + await player.evaluate(DRAWN));
  await lib.hold(1000, 'four ticks of the clock with the monster still down, long enough to end it again');
  rig.check(await dm.evaluate(`_itvOn`), '9: the fight ended again with no monster coming back to life');
  await dm.evaluate(`cbState.rows.find(r => r.id === 930).hp = ''; 0`);
  await lib.settle(dm, `!!_itvLiving && _itvLiving.living === 1`, 5000);
  await dm.evaluate(`cbState.rows.find(r => r.id === 930).hp = '- 7'; 0`);
  await lib.settle(dm, `!_itvOn`, 3000);
  rig.check(await dm.evaluate(`!_itvOn`), '9: the monster back to life and down again did not end the fight');

  // ── 9b ──
  await lib.settle(dm, `document.getElementById('scene-undo-toast').style.display !== 'none'`, 3000);
  await dm.evaluate(`document.querySelector('#scene-undo-toast .undo-x').click(); 0`);
  await lib.settle(dm, `document.getElementById('scene-undo-toast').style.display === 'none'`, 2000);
  const closed = await dm.evaluate(`({ shown: document.getElementById('scene-undo-toast').style.display !== 'none', on: _itvOn })`);
  rig.check(!closed.shown && !closed.on, "9b: the toast's × did not close it: " + JSON.stringify(closed));

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
};
